"""Production sidecar composition for exact reviewed native MLT releases.

The trusted release list is intentionally empty. No user/renderer/environment
profile can populate it. Source composition exists; Windows acceptance does not.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import struct
import sys
import threading
import time
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

from aijian_api import external_media_process as protected
from aijian_api.native_preview_materials import (
    NativePreviewSourceLease,
    prepare_native_preview_sources,
)
from aijian_api.native_preview_private_contracts import PrivatePrepare, digest, encode_opening
from aijian_api.native_preview_windows_job import NativeJobError, NativeWindowsJob
from aijian_api.repository import StudioRepository
from aijian_api.runtime_resources import media_toolchain_lock_path


@dataclass(frozen=True, slots=True)
class NativeRelease:
    # Complete literals established by future binary/source/license/Windows review.
    # This is internal application policy, not a manifest supplied by the caller.
    profile_json: str
    pe_receipt_json: str


ADMITTED_NATIVE_RELEASES: tuple[NativeRelease, ...] = ()


class NativePreviewUnavailable(ValueError):
    """No reviewed installed native release is admitted."""


def _installed_root() -> Path:
    if os.name != "nt" or not bool(getattr(sys, "frozen", False)):
        raise NativePreviewUnavailable("Native release requires the installed Windows sidecar")
    # Existing packaged resolver binds resources to this exact executable.
    return media_toolchain_lock_path().parent.parent / "native" / "mlt-preview-v1"


def _profile(release: NativeRelease, expected_hash: str) -> tuple[dict[str, Any], object]:
    profile: dict[str, Any] = json.loads(release.profile_json)
    receipt: object = json.loads(release.pe_receipt_json)
    if (
        digest(profile) != expected_hash
        or digest(receipt) != "sha256:" + profile["pe_closure_receipt_sha256"]
    ):
        raise NativePreviewUnavailable("Native release differs from its trusted full digest")
    if (
        profile["distribution_status"] != "REVIEWED_RELEASE"
        or profile["schema_version"] != 1
        or profile["host_file"] != "aivora-mlt-preview-host.exe"
        or profile["network_disabled_build"] is not True
        or not 7 <= len(profile["files"]) <= 256
    ):
        raise NativePreviewUnavailable("Native release is not closed reviewed material")
    names: set[str] = set()
    total = 0
    for file in profile["files"]:
        name, size, sha = file["relative_path"], file["byte_size"], file["sha256"]
        if (
            set(file) != {"relative_path", "byte_size", "sha256"}
            or not isinstance(name, str)
            or not re.fullmatch(r"[a-z0-9_.-]+(?:\\[a-z0-9_.-]+)*", name)
            or any(p in {".", ".."} for p in name.split("\\"))
            or name in names
            or isinstance(size, bool)
            or not isinstance(size, int)
            or not 0 < size <= 512 * 1024 * 1024
            or not isinstance(sha, str)
            or not re.fullmatch(r"[0-9a-f]{64}", sha)
        ):
            raise NativePreviewUnavailable("Native release file inventory is unsafe")
        names.add(name)
        total += size
    source_receipts = [
        f
        for f in profile["files"]
        if f["relative_path"] == "licenses\\source-build-receipt.json"
        and f["sha256"] == profile["license_source_receipt_sha256"]
    ]
    if total > 2 * 1024 * 1024 * 1024 or len(source_receipts) != 1:
        raise NativePreviewUnavailable("Complete held source/license/build receipt is missing")
    return profile, receipt


class _Prepared:
    def __init__(
        self,
        repository: StudioRepository,
        request: PrivatePrepare,
        release: NativeRelease,
        output: Callable[[str, bytes], None],
    ) -> None:
        self.repository, self.request, self.release_policy = repository, request, release
        self.lock = threading.RLock()
        self.job = NativeWindowsJob(output)  # Registered before any partial native action.
        self.session = ExitStack()
        self.held = ExitStack()
        self.source: NativePreviewSourceLease | None = None
        self.material: dict[str, Any] = {}
        self.receipt: object = None
        self.files: dict[str, BinaryIO] = {}
        self.cwd: Path | None = None
        self.env: Any = None
        self.launched = False
        self.stopped = False
        self.released = False
        self._directories: set[Path] = set()

    def _hold_directories(self, api: Any, path: Path) -> None:
        for directory in (*reversed(path.parents), path):
            if directory not in self._directories:
                if len(self._directories) >= 4096:
                    raise NativePreviewUnavailable("Native held directory count is out of bounds")
                self.held.enter_context(protected._hold_directory(api, directory))
                self._directories.add(directory)

    def _hold(self, api: Any, path: Path, sha: str, size: int) -> BinaryIO:
        self._hold_directories(api, path.parent)
        stream = self.held.enter_context(protected._hold_executable(api, path))
        stream.seek(0, os.SEEK_END)
        if stream.tell() != size or protected._hash_stream(stream) != sha:
            raise NativePreviewUnavailable(
                "Native held bytes differ from reviewed or selected bytes"
            )
        stream.seek(0)
        return stream

    def prepare(self) -> dict[str, Any]:
        with self.lock:
            self.request.opening.check()
            profile, self.receipt = _profile(self.release_policy, self.request.profile_hash)
            root = _installed_root()
            self.cwd, self.env = self.session.enter_context(protected.external_process_session())
            self.source = prepare_native_preview_sources(
                self.repository, self.request.opening.plan, private_session=self.cwd
            )
            api = protected._api()
            for directory in (root, root / "modules", root / "data"):
                self._hold_directories(api, directory)
            runtime = []
            for file in profile["files"]:
                path = root.joinpath(*file["relative_path"].split("\\"))
                self.files[file["relative_path"]] = self._hold(
                    api, path, file["sha256"], file["byte_size"]
                )
                runtime.append(
                    {"path": str(path), "sha256": file["sha256"], "byte_size": file["byte_size"]}
                )
            sources = []
            workspace = self.repository.database_path.parent.absolute()
            originals: set[Path] = set()
            for source in self.source.sources:
                original = workspace / "media-assets" / "blobs" / source.sha256[:2] / source.sha256
                if original not in originals:
                    self._hold(api, original, source.sha256, source.byte_size)
                    originals.add(original)
                self._hold(api, source.path, source.sha256, source.byte_size)
                sources.append(
                    {
                        "asset_id": source.asset_id,
                        "asset_version_id": source.asset_version_id,
                        "path": str(source.path),
                        "sha256": source.sha256,
                        "byte_size": source.byte_size,
                    }
                )
            self.material = {
                "profile_hash": self.request.profile_hash,
                "profile": profile,
                "runtime_root": str(root),
                "framework_path": str(root / profile["framework_file"]),
                "module_directory": str(root / "modules"),
                "data_directory": str(root / "data"),
                "runtime_files": runtime,
                "sources": sources,
            }
            # The existing binary encoder capability is independently enforced before any process.
            encode_opening(self.request.opening, self.material)
            return {"material": self.material, "pe_receipt": self.receipt}

    def read(self, name: str, offset: int, length: int) -> str:
        with self.lock:
            if (
                self.released
                or self.launched
                or name not in self.files
                or not 1 <= length <= 65_536
            ):
                raise ValueError("Private held-byte read is unavailable")
            stream = self.files[name]
            size = next(
                f["byte_size"]
                for f in self.material["profile"]["files"]
                if f["relative_path"] == name
            )
            if not 0 <= offset < size or offset + length > size:
                raise ValueError("Private held-byte read is out of bounds")
            stream.seek(offset)
            data = stream.read(length)
            if len(data) != length:
                raise ValueError("Private held-byte read is truncated")
            return base64.b64encode(data).decode("ascii")

    def launch(self, packet: bytes) -> None:
        with self.lock:
            if (
                self.released
                or self.stopped
                or self.launched
                or self.source is None
                or self.cwd is None
            ):
                raise ValueError("Native lease cannot launch again")
            if packet != encode_opening(self.request.opening, self.material):
                raise ValueError("Private OPEN differs from this exact owned source")
            opening_path = self.cwd / "opening.bin"
            with opening_path.open("xb") as write:
                write.write(packet)
                write.flush()
                os.fsync(write.fileno())
            held_opening = self._hold(
                protected._api(), opening_path, hashlib.sha256(packet).hexdigest(), len(packet)
            )
            self.launched = True  # Includes a partial start or failed dispatch; never replay.
            cwd = self.cwd
            self.source.dispatch_under_admission(
                lambda: self.job.start(
                    Path(self.material["runtime_root"]) / self.material["profile"]["host_file"],
                    held_opening,
                    cwd,
                    self.env,
                )
            )

    def stop(self, timeout: float = 30) -> None:
        deadline = time.monotonic() + timeout
        self.job.request_stop()
        if not self.lock.acquire(timeout=max(0, deadline - time.monotonic())):
            raise NativeJobError("Native preparation/dispatch is still pending")
        try:
            self.job.stop_and_wait(max(0, deadline - time.monotonic()))
            self.stopped = True
        finally:
            self.lock.release()

    def dispose(self) -> None:
        with self.lock:
            if self.released:
                return
            if self.launched and not self.stopped:
                raise NativeJobError(
                    "Native owner has not proved zero processes and joined workers"
                )
            if not self.stopped:
                self.stop()
            self.held.close()
            if self.source is not None:
                self.source.release(owned_processes_stopped=True)
            self.session.close()
            self.released = True


class NativePreviewOwner:
    """Actual sidecar owner used by parent-pipe dispatch and shutdown."""

    def __init__(
        self, repository: StudioRepository, stream: Callable[[str, int, str, bytes], None]
    ) -> None:
        self.repository, self.stream = repository, stream
        self._lock = threading.RLock()
        self._output_lock = threading.RLock()
        self._leases: dict[str, _Prepared] = {}
        self._sequences: dict[str, int] = {}
        self._closing = False

    def _output(self, lease_id: str, kind: str, data: bytes) -> None:
        # Allocate and emit in the same order across stdout/stderr/exit workers.
        # This is separate from the manager ownership lock, so cancellation and
        # shutdown can still reach a worker blocked on the parent's output pipe.
        with self._output_lock:
            owner = self._leases[lease_id]
            if owner.job._closing.is_set():
                return
            sequence = self._sequences[lease_id] + 1
            self._sequences[lease_id] = sequence
            self.stream(lease_id, sequence, kind, data)

    def dispatch(self, operation: str, payload: object) -> dict[str, Any]:
        if operation == "prepare":
            request = PrivatePrepare.model_validate(payload)
            request.opening.check()
            releases = [
                r
                for r in ADMITTED_NATIVE_RELEASES
                if digest(json.loads(r.profile_json)) == request.profile_hash
            ]
            if len(releases) != 1:
                return {"kind": "UNAVAILABLE"}  # Before resource/native/directory/byte access.
            with self._lock:
                if self._closing or len(self._leases) >= 4:
                    return {"kind": "REFUSED"}
                lease_id = "npl_" + secrets.token_hex(16)
                prepared_owner = _Prepared(
                    self.repository,
                    request,
                    releases[0],
                    lambda kind, data: self._output(lease_id, kind, data),
                )
                self._leases[lease_id] = prepared_owner
                self._sequences[lease_id] = 0
            try:
                value = prepared_owner.prepare()
                return {"kind": "OK", "value": {"lease_id": lease_id, **value}}
            except BaseException:
                # No native dispatch yet, but even preparation cleanup must settle.
                try:
                    prepared_owner.stop()
                    prepared_owner.dispose()
                except BaseException:
                    return {"kind": "UNKNOWN"}
                with self._lock:
                    self._leases.pop(lease_id, None)
                    self._sequences.pop(lease_id, None)
                return {"kind": "REFUSED"}
        if not isinstance(payload, dict) or not re.fullmatch(
            r"npl_[0-9a-f]{32}", str(payload.get("lease_id"))
        ):
            return {"kind": "REFUSED"}
        with self._lock:
            owner = self._leases.get(payload["lease_id"])
            if owner is None or (self._closing and operation not in {"stop", "release"}):
                return {"kind": "REFUSED"}
        if operation == "read" and set(payload) == {
            "lease_id",
            "relative_path",
            "offset",
            "length",
        }:
            if (
                type(payload["offset"]) is not int
                or type(payload["length"]) is not int
                or not isinstance(payload["relative_path"], str)
            ):
                return {"kind": "REFUSED"}
            chunk = owner.read(payload["relative_path"], payload["offset"], payload["length"])
            return {"kind": "OK", "value": {"lease_id": payload["lease_id"], "bytes": chunk}}
        if operation in {"launch", "write"} and set(payload) == {"lease_id", "bytes"}:
            text = payload["bytes"]
            if not isinstance(text, str) or len(text) > 174_772:
                return {"kind": "REFUSED"}
            packet = base64.b64decode(text, validate=True)
            if (
                not 12 <= len(packet) <= 131_076
                or struct.unpack_from("<I", packet)[0] != len(packet) - 4
            ):
                return {"kind": "REFUSED"}
            if operation == "launch":
                owner.launch(packet)
            else:
                if struct.unpack_from("<II", packet, 4) != (1, 3):
                    return {"kind": "REFUSED"}
                owner.job.write(packet)
            return {"kind": "OK", "value": {"lease_id": payload["lease_id"]}}
        if operation == "stop" and set(payload) == {"lease_id"}:
            owner.stop()
            return {
                "kind": "OK",
                "value": {
                    "lease_id": payload["lease_id"],
                    "start_settled": True,
                    "zero_active": True,
                    "readers_joined": True,
                    "owner_closed": True,
                },
            }
        if operation == "release" and set(payload) == {"lease_id"}:
            owner.dispose()
            with self._lock:
                self._leases.pop(payload["lease_id"], None)
                self._sequences.pop(payload["lease_id"], None)
            return {"kind": "OK", "value": {"lease_id": payload["lease_id"]}}
        return {"kind": "REFUSED"}

    def shutdown_and_wait(self, timeout: float = 30) -> None:
        deadline = time.monotonic() + timeout
        with self._lock:
            self._closing = True
            leases = tuple(self._leases.values())
        failures = []
        for owner in leases:
            try:
                owner.stop(max(0, deadline - time.monotonic()))
                owner.dispose()
            except BaseException as error:
                failures.append(error)
        if failures:
            raise NativeJobError(
                "Native owners remain unconfirmed; retain workspace ownership"
            ) from failures[0]
