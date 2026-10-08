from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from aijian_api.gateway_transport import (
    CPA_GATEWAY_HOST,
    CPA_GATEWAY_PATH,
    CPA_GATEWAY_PORT,
    GatewayChatMessage,
    GatewayTextRequest,
    GatewayTextTransport,
)
from pydantic import ValidationError


class _CaptureServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, handler_type: type[BaseHTTPRequestHandler]) -> None:
        super().__init__((CPA_GATEWAY_HOST, CPA_GATEWAY_PORT), handler_type)
        self.requests: list[dict[str, object]] = []
        self.response_status = 200
        self.response_headers: dict[str, str] = {"Content-Type": "application/json"}
        self.response_body = (
            b'{"id":"chat_1","model":"gpt-test",'
            b'"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}'
        )
        self.delay_seconds = 0.0
        self.disconnect = False


class _Handler(BaseHTTPRequestHandler):
    server: _CaptureServer

    def do_POST(self) -> None:  # noqa: N802
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.requests.append(
            {"path": self.path, "headers": dict(self.headers.items()), "body": body}
        )
        if self.server.delay_seconds:
            time.sleep(self.server.delay_seconds)
        if self.server.disconnect:
            self.close_connection = True
            return
        self.send_response(self.server.response_status)
        for name, value in self.server.response_headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(self.server.response_body)))
        self.end_headers()
        self.wfile.write(self.server.response_body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


@pytest.fixture
def gateway_server() -> Iterator[_CaptureServer]:
    try:
        server = _CaptureServer(_Handler)
    except OSError as error:
        pytest.skip(f"local CPA test port unavailable: {error}")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=1)
        server.server_close()


def _request() -> GatewayTextRequest:
    return GatewayTextRequest(
        model="gpt-test",
        messages=[{"role": "user", "content": "synthetic request"}],
        bearer_token="test-only-secret-token",
    )


def test_serializes_one_canonical_nonstream_bearer_request(gateway_server: _CaptureServer) -> None:
    result = GatewayTextTransport(connect_timeout_seconds=0.2, read_timeout_seconds=0.2).dispatch(
        _request()
    )

    assert result.kind == "SUCCEEDED"
    assert result.text == "ok"
    assert len(gateway_server.requests) == 1
    captured = gateway_server.requests[0]
    assert captured["path"] == CPA_GATEWAY_PATH
    assert captured["headers"]["Authorization"] == "Bearer test-only-secret-token"
    assert captured["headers"]["Accept"] == "application/json"
    payload = json.loads(captured["body"])
    assert payload == {
        "model": "gpt-test",
        "messages": [{"role": "user", "content": "synthetic request"}],
        "stream": False,
    }


def test_rejects_credential_or_content_from_repr_and_invalid_input() -> None:
    request = _request()
    assert "test-only-secret-token" not in repr(request)
    assert "synthetic request" not in repr(request)
    with pytest.raises(ValidationError):
        GatewayTextRequest(model="", messages=[], bearer_token="short")
    with pytest.raises(ValueError):
        GatewayTextTransport(total_timeout_seconds=float("nan"))


def test_returns_remote_error_once_for_rate_limit_and_redirect(
    gateway_server: _CaptureServer,
) -> None:
    gateway_server.response_status = 429
    gateway_server.response_body = b'{"error":{"message":"do not expose"}}'
    result = GatewayTextTransport(connect_timeout_seconds=0.2, read_timeout_seconds=0.2).dispatch(
        _request()
    )
    assert result.kind == "REMOTE_ERROR"
    assert result.code == "RATE_LIMITED"
    assert len(gateway_server.requests) == 1

    gateway_server.response_status = 302
    gateway_server.response_headers = {"Location": "http://127.0.0.1:9999/evil"}
    redirect = GatewayTextTransport(connect_timeout_seconds=0.2, read_timeout_seconds=0.2).dispatch(
        _request()
    )
    assert redirect.kind == "REMOTE_ERROR"
    assert redirect.code == "REDIRECT_REJECTED"
    assert len(gateway_server.requests) == 2


def test_rejects_over_limit_response_and_model_substitution(gateway_server: _CaptureServer) -> None:
    gateway_server.response_headers = {"Content-Type": "application/json", "X-Test": "ignored"}
    gateway_server.response_body = b"x" * (GatewayTextTransport.MAX_RESPONSE_BYTES + 1)
    oversized = GatewayTextTransport(
        connect_timeout_seconds=0.2, read_timeout_seconds=0.2
    ).dispatch(_request())
    assert oversized.kind == "REMOTE_ERROR"
    assert oversized.code == "RESPONSE_TOO_LARGE"

    gateway_server.response_body = (
        b'{"id":"chat_1","model":"unexpected-model","choices":[{"message":{"content":"ok"}}]}'
    )
    substituted = GatewayTextTransport(
        connect_timeout_seconds=0.2, read_timeout_seconds=0.2
    ).dispatch(_request())
    assert substituted.kind == "REMOTE_ERROR"
    assert substituted.code == "RESPONSE_INVALID"


def test_timeout_or_disconnect_after_dispatch_is_remote_unknown(
    gateway_server: _CaptureServer,
) -> None:
    gateway_server.delay_seconds = 0.2
    timeout = GatewayTextTransport(
        connect_timeout_seconds=0.05, read_timeout_seconds=0.05
    ).dispatch(_request())
    assert timeout.kind == "REMOTE_UNKNOWN"
    assert len(gateway_server.requests) == 1

    gateway_server.delay_seconds = 0.0
    gateway_server.disconnect = True
    disconnected = GatewayTextTransport(
        connect_timeout_seconds=0.2, read_timeout_seconds=0.2
    ).dispatch(_request())
    assert disconnected.kind == "REMOTE_UNKNOWN"
    assert len(gateway_server.requests) == 2


def test_connection_before_dispatch_is_distinct(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Connection:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            return

        def connect(self) -> None:
            raise TimeoutError("synthetic connect timeout")

        def close(self) -> None:
            return

    monkeypatch.setattr("aijian_api.gateway_transport.http.client.HTTPConnection", _Connection)
    result = GatewayTextTransport(connect_timeout_seconds=0.05, read_timeout_seconds=0.05).dispatch(
        _request()
    )
    assert result.kind == "NOT_DISPATCHED"
    assert result.code == "CONNECTION_FAILED"


def test_total_deadline_is_enforced_before_response_read(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Response:
        status = 200

        def getheader(self, name: str) -> str | None:
            return "application/json" if name == "Content-Type" else None

        def read(self, _size: int) -> bytes:
            raise AssertionError("response.read must not run after the total deadline")

    class _Connection:
        sock = None

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            return

        def connect(self) -> None:
            return

        def putrequest(self, *_args: object, **_kwargs: object) -> None:
            return

        def putheader(self, *_args: object, **_kwargs: object) -> None:
            return

        def endheaders(self, _body: bytes) -> None:
            return

        def getresponse(self) -> _Response:
            return _Response()

        def close(self) -> None:
            return

    ticks = iter((100.0, 100.01, 100.20))
    monkeypatch.setattr("aijian_api.gateway_transport.monotonic", lambda: next(ticks))
    monkeypatch.setattr("aijian_api.gateway_transport.http.client.HTTPConnection", _Connection)
    result = GatewayTextTransport(
        connect_timeout_seconds=0.1,
        read_timeout_seconds=0.1,
        total_timeout_seconds=0.1,
    ).dispatch(_request())
    assert result.kind == "REMOTE_UNKNOWN"
    assert result.code == "RESPONSE_TIMEOUT"


def test_mutated_messages_do_not_escape_as_an_uncaught_dispatch_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Connection:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("invalid request must not construct HTTPConnection")

    request = _request()
    request.messages.append({"role": "user", "content": "late mutation"})  # type: ignore[arg-type]
    monkeypatch.setattr("aijian_api.gateway_transport.http.client.HTTPConnection", _Connection)
    result = GatewayTextTransport(connect_timeout_seconds=0.05, read_timeout_seconds=0.05).dispatch(
        request
    )
    assert result.kind == "NOT_DISPATCHED"
    assert result.code == "REQUEST_INVALID"


def test_mutated_typed_messages_over_64_are_rejected_before_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Connection:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("oversized message collection must not construct HTTPConnection")

    request = _request()
    request.messages.extend(
        GatewayChatMessage(role="user", content=f"message-{index}") for index in range(64)
    )
    monkeypatch.setattr("aijian_api.gateway_transport.http.client.HTTPConnection", _Connection)
    result = GatewayTextTransport(connect_timeout_seconds=0.05, read_timeout_seconds=0.05).dispatch(
        request
    )
    assert result.kind == "NOT_DISPATCHED"
    assert result.code == "REQUEST_INVALID"


def test_mutated_utf8_request_over_512_kib_is_rejected_before_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Connection:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("oversized UTF-8 request must not construct HTTPConnection")

    request = _request()
    request.messages[:] = [
        GatewayChatMessage(role="user", content="雨" * (256 * 1024)),
        GatewayChatMessage(role="assistant", content="停" * (256 * 1024)),
        GatewayChatMessage(role="user", content="之前" * (128 * 1024)),
    ]
    monkeypatch.setattr("aijian_api.gateway_transport.http.client.HTTPConnection", _Connection)
    result = GatewayTextTransport(connect_timeout_seconds=0.05, read_timeout_seconds=0.05).dispatch(
        request
    )
    assert result.kind == "NOT_DISPATCHED"
    assert result.code == "REQUEST_INVALID"
