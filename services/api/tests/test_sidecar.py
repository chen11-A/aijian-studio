import builtins
import json
import os
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from time import monotonic, sleep
from types import SimpleNamespace
from typing import Any, Self

import pytest
from aijian_api import sidecar
from aijian_api.security import SIDECAR_ORIGIN
from aijian_api.sidecar import PROTOCOL_VERSION, create_handshake, create_listener, create_token
from test_proposal_run_create_api import accepted_source, create_payload


def encode_json(value: object) -> bytes:
    return json.dumps(value).encode("utf-8")


class RemoteResponse:
    def __init__(self, status_code: int, body: bytes, headers: Any) -> None:
        self.status_code = status_code
        self._body = body
        self.headers = headers

    def json(self) -> dict[str, Any]:
        return json.loads(self._body)


class RemoteClient:
    def __init__(self, base_url: str, headers: dict[str, str]) -> None:
        self._base_url = base_url
        self._headers = headers

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def get(self, path: str, *, headers: dict[str, str] | None = None) -> RemoteResponse:
        return self._request("GET", path, headers=headers)

    def post(
        self,
        path: str,
        *,
        json: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> RemoteResponse:
        body = None if json is None else encode_json(json)
        return self._request("POST", path, body=body, headers=headers)

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> RemoteResponse:
        merged_headers = {**self._headers, **(headers or {})}
        if body is not None:
            merged_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self._base_url + path,
            data=body,
            headers=merged_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return RemoteResponse(response.status, response.read(), response.headers)
        except urllib.error.HTTPError as error:
            return RemoteResponse(error.code, error.read(), error.headers)


def test_listener_uses_an_os_assigned_ipv4_loopback_port() -> None:
    listener, port = create_listener()
    try:
        host, actual_port = listener.getsockname()
        assert host == "127.0.0.1"
        assert port == actual_port
        assert 1 <= port <= 65535
        assert listener.family == socket.AF_INET
        assert listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) == 1
    finally:
        listener.close()


def test_token_has_at_least_256_bits_of_random_material() -> None:
    tokens = {create_token() for _ in range(20)}

    assert len(tokens) == 20
    assert all(len(token) >= 43 for token in tokens)


def test_handshake_is_a_single_strict_json_line_without_paths() -> None:
    handshake = create_handshake(port=43123, token="t" * 43, pid=7654)
    encoded = json.dumps(handshake, separators=(",", ":"), sort_keys=True)

    assert handshake == {
        "event": "ready",
        "host": "127.0.0.1",
        "pid": 7654,
        "port": 43123,
        "protocol_version": PROTOCOL_VERSION,
        "token": "t" * 43,
    }
    assert "\n" not in encoded
    assert str(Path.cwd()) not in encoded


def test_parent_pipe_eof_requests_a_graceful_server_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    server = SimpleNamespace(should_exit=False)
    monkeypatch.setattr(sidecar.sys, "stdin", SimpleNamespace(buffer=BytesIO()))

    sidecar._stop_when_parent_pipe_closes(server)

    assert server.should_exit is True


def test_run_emits_one_handshake_and_closes_the_reserved_listener(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    class FakeListener:
        closed = False

        def close(self) -> None:
            self.closed = True

    class FakeServer:
        should_exit = False
        sockets: list[object] | None = None

        def run(self, *, sockets: list[object]) -> None:
            self.sockets = sockets

    class FakeThread:
        started = False

        def __init__(self, **_: object) -> None:
            pass

        def start(self) -> None:
            self.started = True

    class FakeWorker:
        started = False
        stopped = False

        def start(self) -> None:
            self.started = True

        def stop(self) -> None:
            self.stopped = True

    listener = FakeListener()
    server = FakeServer()
    thread = FakeThread()
    worker = FakeWorker()
    monkeypatch.setattr(sidecar, "create_listener", lambda: (listener, 43123))
    monkeypatch.setattr(sidecar, "create_token", lambda: "z" * 43)
    monkeypatch.setattr(sidecar.os, "getpid", lambda: 7654)
    monkeypatch.setattr(sidecar.uvicorn, "Server", lambda _config: server)
    monkeypatch.setattr(sidecar.threading, "Thread", lambda **_kwargs: thread)
    monkeypatch.setattr(sidecar, "create_local_fake_worker", lambda _database: worker)

    sidecar.run()

    output_lines = capsys.readouterr().out.splitlines()
    assert len(output_lines) == 1
    assert json.loads(output_lines[0]) == create_handshake(port=43123, token="z" * 43, pid=7654)
    assert server.sockets == [listener]
    assert thread.started is True
    assert worker.started is True
    assert worker.stopped is True
    assert listener.closed is True


def test_handshake_output_failure_stops_worker_and_closes_listener(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeListener:
        closed = False

        def close(self) -> None:
            self.closed = True

    class FakeWorker:
        stopped = False

        def start(self) -> None:
            pass

        def stop(self) -> None:
            self.stopped = True

    listener = FakeListener()
    worker = FakeWorker()
    monkeypatch.setattr(sidecar, "create_listener", lambda: (listener, 43123))
    monkeypatch.setattr(sidecar, "create_token", lambda: "z" * 43)
    monkeypatch.setattr(
        sidecar.uvicorn,
        "Server",
        lambda _config: SimpleNamespace(should_exit=False, run=lambda **_kwargs: None),
    )
    monkeypatch.setattr(
        sidecar.threading,
        "Thread",
        lambda **_kwargs: SimpleNamespace(start=lambda: None),
    )
    monkeypatch.setattr(sidecar, "create_local_fake_worker", lambda _database: worker)
    monkeypatch.setattr(
        builtins, "print", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("closed pipe"))
    )

    with pytest.raises(OSError, match="closed pipe"):
        sidecar.run()

    assert worker.stopped is True
    assert listener.closed is True


def test_real_sidecar_process_starts_and_stops_its_explicit_worker_with_parent_pipe(
    tmp_path: Path,
) -> None:
    environment = os.environ.copy()
    environment["AIJIAN_DATA_DIR"] = str(tmp_path)
    source_path = str(Path.cwd() / "services" / "api" / "src")
    environment["PYTHONPATH"] = os.pathsep.join(
        part
        for part in (
            source_path,
            *(entry for entry in sys.path if "site-packages" in entry),
            environment.get("PYTHONPATH", ""),
        )
        if part
    )
    process = subprocess.Popen(
        [getattr(sys, "_base_executable", sys.executable), "-m", "aijian_api.sidecar"],
        cwd=Path.cwd(),
        env=environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdout is not None
    assert process.stdin is not None
    assert process.stderr is not None
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            line = pool.submit(process.stdout.readline).result(timeout=10)
        handshake = json.loads(line)
        assert handshake["event"] == "ready"
        assert handshake["host"] == "127.0.0.1"
        assert (tmp_path / "workspace.sqlite3").exists()
        with RemoteClient(
            f"http://127.0.0.1:{handshake['port']}",
            {
                "Authorization": f"Bearer {handshake['token']}",
                "Origin": SIDECAR_ORIGIN,
            },
        ) as client:
            deadline = monotonic() + 5
            while monotonic() < deadline:
                try:
                    if client.get("/api/v1/health").status_code == 200:
                        break
                except urllib.error.URLError:
                    pass
                sleep(0.02)
            else:
                raise AssertionError("real Sidecar did not become healthy")
            source = accepted_source(client)
            project_id = source[0]
            response = client.post(
                f"/api/v1/projects/{project_id}/proposal-runs",
                json=create_payload(source),
                headers={"Idempotency-Key": "real-sidecar-worker-v1"},
            )
            assert response.status_code == 201
            assert (
                client.post(
                    f"/api/v1/projects/{project_id}/proposal-runs",
                    json=create_payload(source),
                    headers={"Idempotency-Key": "real-sidecar-worker-v1"},
                ).status_code
                == 200
            )
            deadline = monotonic() + 15
            while monotonic() < deadline:
                queue = client.get(f"/api/v1/projects/{project_id}/tasks").json()["data"]
                task = next(
                    (item for item in queue["tasks"] if item["proposal_id"] is not None),
                    None,
                )
                if task is not None and task["task"]["status"] == "COMPLETED":
                    break
                sleep(0.02)
            else:
                process.stdin.close()
                process.wait(timeout=5)
                raise AssertionError(
                    "real Sidecar worker did not complete the Fake proposal: "
                    + process.stderr.read()
                    + " stdout="
                    + process.stdout.read()
                )
            assert task is not None and task["node"]["status"] == "NEEDS_REVIEW"
            assert task["proposal_id"].startswith("prp_")
        if not process.stdin.closed:
            process.stdin.close()
        assert process.wait(timeout=5) == 0
        assert "Traceback" not in process.stderr.read()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
