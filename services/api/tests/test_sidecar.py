import json
import socket
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api import sidecar
from aijian_api.sidecar import PROTOCOL_VERSION, create_handshake, create_listener, create_token


def test_listener_uses_an_os_assigned_ipv4_loopback_port() -> None:
    listener, port = create_listener()
    try:
        host, actual_port = listener.getsockname()
        assert host == "127.0.0.1"
        assert port == actual_port
        assert 1 <= port <= 65535
        assert listener.family == socket.AF_INET
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

    listener = FakeListener()
    server = FakeServer()
    thread = FakeThread()
    monkeypatch.setattr(sidecar, "create_listener", lambda: (listener, 43123))
    monkeypatch.setattr(sidecar, "create_token", lambda: "z" * 43)
    monkeypatch.setattr(sidecar.os, "getpid", lambda: 7654)
    monkeypatch.setattr(sidecar.uvicorn, "Server", lambda _config: server)
    monkeypatch.setattr(sidecar.threading, "Thread", lambda **_kwargs: thread)

    sidecar.run()

    output_lines = capsys.readouterr().out.splitlines()
    assert len(output_lines) == 1
    assert json.loads(output_lines[0]) == create_handshake(port=43123, token="z" * 43, pid=7654)
    assert server.sockets == [listener]
    assert thread.started is True
    assert listener.closed is True
