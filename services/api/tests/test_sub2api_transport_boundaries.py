"""No-network transport regressions using synthetic sockets, responses, and secrets."""

import hashlib
import http.client
import json
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import sub2api_text_transport as module
from aijian_api.gateway_transport import GatewayChatMessage, GatewayTextRequest
from aijian_api.sub2api_text_transport import Sub2APITextSuccess, Sub2APITextTransport
from pydantic import SecretStr


def request():
    return GatewayTextRequest(
        model="synthetic-model",
        messages=[GatewayChatMessage(role="user", content="synthetic text")],
        bearer_token=SecretStr("synthetic-test-only"),
    )


def response_payload(**fields):
    return {
        "id": "synthetic-response",
        "model": "synthetic-model",
        "choices": [{"message": {"content": "Synthetic reply"}, "finish_reason": "stop"}],
        **fields,
    }


@pytest.fixture
def connection(monkeypatch):
    """Replace all construction before dispatch; unexpected real networking must fail."""
    value = Mock()
    body = json.dumps(response_payload()).encode()
    value.getresponse.return_value.status = 200
    value.getresponse.return_value.getheader.side_effect = lambda name: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(body)),
    }.get(name)
    value.getresponse.return_value.read.side_effect = [body[:12], body[12:], b""]
    monkeypatch.setattr(module, "_PinnedHTTPSConnection", Mock(return_value=value))
    monkeypatch.setattr(module, "_LiteralLoopbackHTTPConnection", Mock(return_value=value))
    monkeypatch.setattr(module, "local_loopback_route_clear", Mock(return_value=True))
    monkeypatch.setattr(
        Sub2APITextTransport, "_resolve_public_address", Mock(return_value="8.8.8.8")
    )
    monkeypatch.setattr(
        module.socket, "create_connection", Mock(side_effect=AssertionError("network forbidden"))
    )
    monkeypatch.setattr(
        module.socket, "getaddrinfo", Mock(side_effect=AssertionError("DNS forbidden"))
    )
    return value


@pytest.mark.parametrize(
    "base_url,origin_mode",
    [
        ("https://synthetic.example", "PUBLIC_HTTPS"),
        ("http://127.0.0.1:8765", "LOCAL_LOOPBACK_HTTP"),
    ],
)
def test_success_sends_one_bounded_post_and_returns_exact_body_evidence(
    connection, base_url, origin_mode
):
    result = Sub2APITextTransport().dispatch(
        base_url=base_url, origin_mode=origin_mode, request=request()
    )
    assert isinstance(result, Sub2APITextSuccess)
    assert result.text == "Synthetic reply"
    assert (
        result.raw_response_sha256
        == "sha256:" + hashlib.sha256(result.raw_response_body).hexdigest()
    )
    connection.connect.assert_called_once()
    connection.putrequest.assert_called_once_with(
        "POST", "/v1/chat/completions", skip_accept_encoding=True
    )
    connection.endheaders.assert_called_once()
    assert json.loads(connection.endheaders.call_args.args[0]) == {
        "model": "synthetic-model",
        "messages": [{"role": "user", "content": "synthetic text"}],
        "stream": False,
    }
    connection.close.assert_called_once()
    assert "synthetic-test-only" not in repr(result)
    assert result.usage_tokens is None


@pytest.mark.parametrize(
    "phase,error,kind,code",
    [
        ("connect", OSError("failure"), "NOT_DISPATCHED", "CONNECTION_FAILED"),
        ("connect", TimeoutError(), "NOT_DISPATCHED", "CONNECTION_FAILED"),
        ("putrequest", http.client.HTTPException(), "REMOTE_UNKNOWN", "DISPATCH_INTERRUPTED"),
        ("endheaders", OSError(), "REMOTE_UNKNOWN", "DISPATCH_INTERRUPTED"),
        ("getresponse", TimeoutError(), "REMOTE_UNKNOWN", "RESPONSE_TIMEOUT"),
        ("getresponse", OSError(), "REMOTE_UNKNOWN", "RESPONSE_INTERRUPTED"),
        ("read", TimeoutError(), "REMOTE_UNKNOWN", "RESPONSE_TIMEOUT"),
        ("read", http.client.HTTPException(), "REMOTE_UNKNOWN", "RESPONSE_INTERRUPTED"),
    ],
)
def test_phase_failure_never_reconnects_or_replays(connection, phase, error, kind, code):
    target = connection.getresponse.return_value if phase == "read" else connection
    getattr(target, phase).side_effect = error
    result = Sub2APITextTransport().dispatch(
        base_url="https://synthetic.example", request=request()
    )
    assert (result.kind, result.code) == (kind, code)
    connection.connect.assert_called_once()
    assert connection.endheaders.call_count <= 1
    connection.close.assert_called_once()


@pytest.mark.parametrize(
    "status,code",
    [
        (301, "REDIRECT_REJECTED"),
        (399, "REDIRECT_REJECTED"),
        (429, "RATE_LIMITED"),
        (500, "REMOTE_REJECTED"),
        (204, "REMOTE_REJECTED"),
    ],
)
def test_http_errors_are_not_redirected_or_retried(connection, status, code):
    response = connection.getresponse.return_value
    response.status = status
    result = Sub2APITextTransport().dispatch(
        base_url="https://synthetic.example", request=request()
    )
    assert (result.kind, result.code, result.status_code) == ("REMOTE_ERROR", code, status)
    response.read.assert_not_called()
    connection.endheaders.assert_called_once()
    connection.close.assert_called_once()


@pytest.mark.parametrize(
    "headers,chunks,kind,code",
    [
        ({"Content-Type": "text/html"}, [], "REMOTE_ERROR", "RESPONSE_INVALID"),
        ({}, [], "REMOTE_ERROR", "RESPONSE_INVALID"),
        (
            {"Content-Type": "application/json", "Content-Length": "bad"},
            [],
            "REMOTE_UNKNOWN",
            "RESPONSE_INTERRUPTED",
        ),
        (
            {"Content-Type": "application/json", "Content-Length": "-1"},
            [],
            "REMOTE_ERROR",
            "RESPONSE_TOO_LARGE",
        ),
        (
            {"Content-Type": "application/json", "Content-Length": str(1024 * 1024 + 1)},
            [],
            "REMOTE_ERROR",
            "RESPONSE_TOO_LARGE",
        ),
        (
            {"Content-Type": "application/json"},
            [b"x" * (1024 * 1024), b"x"],
            "REMOTE_ERROR",
            "RESPONSE_TOO_LARGE",
        ),
        (
            {"Content-Type": "application/json"},
            [b"invalid", b""],
            "REMOTE_ERROR",
            "RESPONSE_INVALID",
        ),
    ],
)
def test_response_validation_has_bounded_reads(connection, headers, chunks, kind, code):
    response = connection.getresponse.return_value
    response.getheader.side_effect = headers.get
    response.read.side_effect = chunks
    result = Sub2APITextTransport().dispatch(
        base_url="https://synthetic.example", request=request()
    )
    assert (result.kind, result.code) == (kind, code)
    assert all(call.args == (64 * 1024,) for call in response.read.call_args_list)
    connection.close.assert_called_once()


@pytest.mark.parametrize("value", [True, "1", 0, -1, float("nan"), float("inf"), 61])
@pytest.mark.parametrize(
    "field", ["connect_timeout_seconds", "read_timeout_seconds", "total_timeout_seconds"]
)
def test_invalid_timeout_never_constructs_transport(field, value):
    with pytest.raises(ValueError, match="finite positive"):
        Sub2APITextTransport(**{field: value})


def test_total_timeout_must_cover_one_phase():
    with pytest.raises(ValueError, match="one transport phase"):
        Sub2APITextTransport(total_timeout_seconds=1)


@pytest.mark.parametrize(
    "bad_request",
    [
        None,
        object(),
        GatewayTextRequest.model_construct(
            model="synthetic-model", messages=(), bearer_token=SecretStr("synthetic-test-only")
        ),
    ],
)
def test_invalid_request_does_not_construct_connection(connection, bad_request):
    result = Sub2APITextTransport().dispatch(
        base_url="https://synthetic.example", request=bad_request
    )
    assert (result.kind, result.code) == ("NOT_DISPATCHED", "REQUEST_INVALID")
    module._PinnedHTTPSConnection.assert_not_called()


def test_local_portproxy_rejection_stops_before_connection(connection):
    module.local_loopback_route_clear.return_value = False
    result = Sub2APITextTransport().dispatch(
        base_url="http://127.0.0.1:8765", origin_mode="LOCAL_LOOPBACK_HTTP", request=request()
    )
    assert (result.kind, result.code) == ("NOT_DISPATCHED", "CONNECTION_FAILED")
    module._LiteralLoopbackHTTPConnection.assert_not_called()
    connection.endheaders.assert_not_called()


def test_dns_failure_stops_before_connection(connection):
    Sub2APITextTransport._resolve_public_address.side_effect = OSError("synthetic DNS failure")
    result = Sub2APITextTransport().dispatch(
        base_url="https://synthetic.example", request=request()
    )
    assert (result.kind, result.code) == ("NOT_DISPATCHED", "CONNECTION_FAILED")
    module._PinnedHTTPSConnection.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [],
        {},
        {"id": ""},
        {"id": "x" * 513},
        {"model": "another"},
        {"choices": []},
        {"choices": [None]},
        {"choices": [{"message": None}]},
        {"choices": [{"message": {"content": 4}}]},
        {"choices": [{"message": {"content": "ok"}, "finish_reason": 1}]},
    ],
)
def test_malformed_success_is_never_accepted(payload):
    candidate = response_payload(**payload) if isinstance(payload, dict) else payload
    result = Sub2APITextTransport._parse_success(json.dumps(candidate).encode(), "synthetic-model")
    if payload == {}:
        assert result.kind == "SUCCEEDED"
    else:
        assert (result.kind, result.code) == ("REMOTE_ERROR", "RESPONSE_INVALID")


@pytest.mark.parametrize("body", [b"{", b"\xff"])
def test_invalid_json_and_utf8_are_closed_errors(body):
    result = Sub2APITextTransport._parse_success(body, "synthetic-model")
    assert result.code == "RESPONSE_INVALID"


@pytest.mark.parametrize(
    "usage,expected",
    [
        (None, None),
        ({"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}, (2, 3, 5)),
        ({}, (None, None, None)),
        ({"total_tokens": True}, None),
        ({"total_tokens": -1}, None),
        ({"total_tokens": 10**12 + 1}, None),
    ],
)
def test_usage_is_optional_bounded_evidence_not_a_charge(usage, expected):
    result = Sub2APITextTransport._parse_success(
        json.dumps(response_payload(usage=usage)).encode(), "synthetic-model"
    )
    assert isinstance(result, Sub2APITextSuccess)
    assert result.usage_tokens == expected


@pytest.mark.parametrize(
    "stdout,returncode,expected",
    [
        ("", 0, True),
        ("127.0.0.1 8765 10.0.0.1 443", 0, False),
        ("127.0.0.1 9999 10.0.0.1 443", 0, True),
        ("unparsed headings", 0, True),
        ("", 1, False),
    ],
)
def test_windows_portproxy_guard_reads_only_synthetic_command_output(
    monkeypatch, stdout, returncode, expected
):
    monkeypatch.setattr(module.sys, "platform", "win32")
    command = Mock(return_value=SimpleNamespace(stdout=stdout, returncode=returncode))
    monkeypatch.setattr(module.subprocess, "run", command)
    assert module.local_loopback_route_clear("http://127.0.0.1:8765") is expected
    assert command.call_args.args[0] == ["netsh", "interface", "portproxy", "show", "all"]
    assert command.call_args.kwargs["timeout"] == 2.0


@pytest.mark.parametrize(
    "error", [OSError(), ValueError(), UnicodeError(), subprocess.TimeoutExpired("synthetic", 2)]
)
def test_portproxy_inspection_failure_is_not_clear(monkeypatch, error):
    monkeypatch.setattr(module.sys, "platform", "win32")
    monkeypatch.setattr(module.subprocess, "run", Mock(side_effect=error))
    assert not module.local_loopback_route_clear("http://127.0.0.1:8765")
