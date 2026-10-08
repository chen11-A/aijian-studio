"""Managed local-only Fake Provider process for deterministic recovery tests."""

import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock
from types import TracebackType
from typing import Literal, Self, TextIO, cast

from aijian_api.fake_provider_paths import validate_fake_provider_database_path

type FakeProviderFault = Literal[
    "before_persist_error",
    "before_persist_crash",
    "after_persist_crash",
]

_FAULTS = frozenset({"before_persist_error", "before_persist_crash", "after_persist_crash"})
_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_HASH_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_JOB_PATTERN = re.compile(r"^job_[0-9a-f]{32}$")
_MAX_MESSAGE_BYTES = 16 * 1024


class FakeProviderError(RuntimeError):
    """Base class for Fake Provider protocol failures."""


class FakeProviderRejected(FakeProviderError):
    """The Fake Provider returned an explicit, non-transport rejection."""


class FakeProviderProcessCrashed(FakeProviderError):
    """The Fake Provider exited before returning an authoritative response."""


@dataclass(frozen=True, slots=True)
class FakeProviderJob:
    job_id: str
    idempotency_key: str
    request_hash: str
    status: str
    accepted_at: str


class FakeProviderProcess:
    """Serialize requests to one separately managed, restartable worker process."""

    def __init__(
        self,
        database_path: Path,
        *,
        trusted_root: Path,
        request_timeout_seconds: float = 5.0,
    ) -> None:
        resolved = validate_fake_provider_database_path(
            database_path,
            trusted_root=trusted_root,
        )
        if request_timeout_seconds <= 0:
            raise ValueError("Fake Provider request timeout must be positive")
        self._database_path = resolved
        self._request_timeout_seconds = request_timeout_seconds
        self._trusted_root = trusted_root.resolve()
        self._process: subprocess.Popen[str] | None = None
        self._last_exit_code: int | None = None
        self._request_id = 0
        self._lock = Lock()

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def pid(self) -> int:
        if not self.is_running or self._process is None:
            raise RuntimeError("Fake Provider is not running")
        return self._process.pid

    @property
    def last_exit_code(self) -> int | None:
        return self._last_exit_code

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.stop()

    def start(self) -> None:
        with self._lock:
            if self.is_running:
                return
            self._discard_process()
            self._last_exit_code = None
            worker = Path(__file__).with_name("fake_provider_worker.py")
            environment = {
                name: value
                for name in ("SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL")
                if (value := os.environ.get(name)) is not None
            }
            environment["PYTHONUTF8"] = "1"
            environment["PYTHONNOUSERSITE"] = "1"
            environment["PYTHONPATH"] = str(worker.parent.parent)
            creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            self._process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "aijian_api.fake_provider_worker",
                    str(self._database_path),
                    str(self._trusted_root),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="strict",
                bufsize=1,
                env=environment,
                creationflags=creation_flags,
            )

    def stop(self) -> None:
        with self._lock:
            process = self._process
            if process is None:
                return
            if process.poll() is None:
                try:
                    self._request_unlocked("shutdown", {})
                except FakeProviderError:
                    process.terminate()
                try:
                    self._last_exit_code = process.wait(timeout=self._request_timeout_seconds)
                except subprocess.TimeoutExpired:
                    process.kill()
                    self._last_exit_code = process.wait(timeout=self._request_timeout_seconds)
            else:
                self._last_exit_code = process.returncode
            self._discard_process()

    def submit(
        self,
        idempotency_key: str,
        request_hash: str,
        *,
        fault: FakeProviderFault | None = None,
    ) -> FakeProviderJob:
        if _KEY_PATTERN.fullmatch(idempotency_key) is None:
            raise ValueError("idempotency key has invalid format or length")
        if _HASH_PATTERN.fullmatch(request_hash) is None:
            raise ValueError("request hash must be a lowercase sha256 digest")
        if fault is not None and fault not in _FAULTS:
            raise ValueError("fault mode is not supported")
        payload: dict[str, object] = {
            "idempotency_key": idempotency_key,
            "request_hash": request_hash,
        }
        if fault is not None:
            payload["fault"] = fault
        response = self._request("submit", payload)
        return _job(response)

    def query(self, job_id: str) -> FakeProviderJob:
        if _JOB_PATTERN.fullmatch(job_id) is None:
            raise ValueError("job id has invalid format or length")
        return _job(self._request("query", {"job_id": job_id}))

    def _request(self, operation: str, payload: dict[str, object]) -> dict[str, object]:
        with self._lock:
            return self._request_unlocked(operation, payload)

    def _request_unlocked(self, operation: str, payload: dict[str, object]) -> dict[str, object]:
        if not self.is_running:
            raise FakeProviderProcessCrashed("Fake Provider process is not running")
        process = cast(subprocess.Popen[str], self._process)
        stdin = cast(TextIO, process.stdin)
        stdout = cast(TextIO, process.stdout)
        self._request_id += 1
        if self._request_id > 2**63 - 1:
            raise FakeProviderError("Fake Provider request identity space is exhausted")
        request = {"request_id": self._request_id, "operation": operation, **payload}
        serialized = json.dumps(request, ensure_ascii=True, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > _MAX_MESSAGE_BYTES:
            raise ValueError("Fake Provider request exceeds protocol limit")
        try:
            stdin.write(serialized + "\n")
            stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise self._crashed(operation, payload) from error

        reader = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fake-provider-read")
        future = reader.submit(stdout.readline, _MAX_MESSAGE_BYTES + 2)
        try:
            line = future.result(timeout=self._request_timeout_seconds)
        except FutureTimeoutError as error:
            process.kill()
            self._last_exit_code = process.wait(timeout=self._request_timeout_seconds)
            raise FakeProviderProcessCrashed(
                f"Fake Provider timed out during {operation}"
            ) from error
        finally:
            reader.shutdown(wait=False, cancel_futures=True)
        if not line:
            raise self._crashed(operation, payload)
        if not line.endswith("\n") or len(line.encode("utf-8")) > _MAX_MESSAGE_BYTES:
            process.kill()
            self._last_exit_code = process.wait(timeout=self._request_timeout_seconds)
            raise FakeProviderError("Fake Provider response exceeds the protocol limit")
        try:
            response = json.loads(line)
        except (ValueError, RecursionError) as error:
            raise FakeProviderError("Fake Provider returned invalid JSON") from error
        if (
            not isinstance(response, dict)
            or type(response.get("request_id")) is not int
            or response.get("request_id") != self._request_id
        ):
            raise FakeProviderError("Fake Provider response identity did not match")
        if response.get("ok") is False:
            if response.keys() != {"request_id", "ok", "code", "message"}:
                raise FakeProviderError("Fake Provider rejection had an invalid schema")
            code = response.get("code", "PROTOCOL_ERROR")
            message = response.get("message", "Fake Provider rejected the request")
            if not isinstance(code, str) or not isinstance(message, str):
                raise FakeProviderError("Fake Provider rejection had an invalid schema")
            raise FakeProviderRejected(f"{code}: {message}")
        if response.get("ok") is not True or response.keys() != {"request_id", "ok", "result"}:
            raise FakeProviderError("Fake Provider response had an invalid schema")
        result = response.get("result")
        if not isinstance(result, dict):
            raise FakeProviderError("Fake Provider response did not contain an object result")
        return cast(dict[str, object], result)

    def _crashed(self, operation: str, payload: dict[str, object]) -> FakeProviderProcessCrashed:
        process = self._process
        exit_code = None
        if process is not None:
            try:
                exit_code = process.wait(timeout=self._request_timeout_seconds)
            except subprocess.TimeoutExpired:
                process.kill()
                exit_code = process.wait(timeout=self._request_timeout_seconds)
            self._last_exit_code = exit_code
        fault = payload.get("fault")
        context = f" during {fault}" if isinstance(fault, str) else f" during {operation}"
        return FakeProviderProcessCrashed(
            f"Fake Provider process crashed{context}; exit_code={exit_code}"
        )

    def _discard_process(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass


def _job(payload: dict[str, object]) -> FakeProviderJob:
    fields = FakeProviderJob.__dataclass_fields__.keys()
    if payload.keys() != fields:
        raise FakeProviderError("Fake Provider returned an invalid job record")
    values = {name: payload.get(name) for name in fields}
    if not all(isinstance(value, str) for value in values.values()):
        raise FakeProviderError("Fake Provider returned an invalid job record")
    typed = cast(dict[str, str], values)
    if (
        _JOB_PATTERN.fullmatch(typed["job_id"]) is None
        or _KEY_PATTERN.fullmatch(typed["idempotency_key"]) is None
        or _HASH_PATTERN.fullmatch(typed["request_hash"]) is None
        or typed["status"] != "ACCEPTED"
    ):
        raise FakeProviderError("Fake Provider returned an invalid job record")
    try:
        accepted_at = datetime.fromisoformat(typed["accepted_at"].replace("Z", "+00:00"))
    except ValueError as error:
        raise FakeProviderError("Fake Provider returned an invalid job record") from error
    if accepted_at.tzinfo is None or accepted_at.utcoffset() is None:
        raise FakeProviderError("Fake Provider returned an invalid job record")
    return FakeProviderJob(**typed)
