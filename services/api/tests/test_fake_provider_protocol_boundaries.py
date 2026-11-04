"""Synthetic pipe responses and process handles; no subprocess is started."""

import io
import json
import subprocess
from unittest.mock import Mock

import pytest
from aijian_api import fake_provider as provider


@pytest.fixture
def channel(tmp_path, monkeypatch):
    client = provider.FakeProviderProcess(tmp_path / "unused.db", trusted_root=tmp_path)
    process = Mock(stdin=io.StringIO(), stdout=io.StringIO(), stderr=io.StringIO())
    process.poll.return_value = None
    process.wait.return_value = 7
    client._process = process
    future = Mock()
    future.result.return_value = '{"request_id":1,"ok":true,"result":{}}\n'
    reader = Mock()
    reader.submit.return_value = future
    monkeypatch.setattr(provider, "ThreadPoolExecutor", lambda **_: reader)
    return client, process, future, reader


@pytest.mark.parametrize(
    "response",
    [
        {"request_id": 1, "ok": False},
        {"request_id": 1, "ok": False, "code": 1, "message": "safe"},
        {"request_id": 1, "ok": False, "code": "SAFE", "message": None},
        {"request_id": 1, "ok": 1, "result": {}},
        {"request_id": 1, "ok": True, "result": {}, "extra": 1},
        {"request_id": 1, "ok": True, "result": []},
        {"request_id": True, "ok": True, "result": {}},
        {"request_id": 2, "ok": True, "result": {}},
        [],
    ],
)
def test_protocol_requires_exact_response_identity_and_closed_schema(channel, response):
    client, process, future, reader = channel
    future.result.return_value = json.dumps(response) + "\n"
    with pytest.raises(provider.FakeProviderError):
        client._request("query", {"job_id": "job_" + "1" * 32})
    assert client._request_id == 1
    assert len(process.stdin.getvalue().splitlines()) == 1
    reader.shutdown.assert_called_once_with(wait=False, cancel_futures=True)


@pytest.mark.parametrize("kind", ["json", "unterminated", "oversize", "empty", "timeout"])
def test_transport_failures_do_not_retry_request(channel, kind):
    client, process, future, reader = channel
    future.result.return_value = {
        "json": "{\n",
        "unterminated": "{}",
        "oversize": "x" * (16 * 1024) + "\n",
        "empty": "",
        "timeout": "",
    }[kind]
    if kind == "timeout":
        future.result.side_effect = provider.FutureTimeoutError()
    with pytest.raises(provider.FakeProviderError):
        client._request("query", {})
    assert len(process.stdin.getvalue().splitlines()) == 1
    assert process.kill.call_count == int(kind in {"unterminated", "oversize", "timeout"})
    reader.shutdown.assert_called_once_with(wait=False, cancel_futures=True)


@pytest.mark.parametrize("kind", ["exhausted", "oversize", "broken_pipe"])
def test_request_failures_never_start_reader(channel, kind):
    client, process, _future, reader = channel
    payload = {}
    if kind == "exhausted":
        client._request_id = 2**63 - 1
    elif kind == "oversize":
        payload = {"value": "x" * (16 * 1024)}
    else:
        process.stdin = Mock()
        process.stdin.write.side_effect = BrokenPipeError("synthetic closed pipe")
    with pytest.raises((provider.FakeProviderError, ValueError)):
        client._request("query", payload)
    reader.submit.assert_not_called()


@pytest.mark.parametrize("process_present", [False, True])
def test_crash_cleanup_is_bounded_even_without_a_handle(channel, process_present):
    client, process, _future, _reader = channel
    if process_present:
        process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 5), 9]
    else:
        client._process = None
    error = client._crashed("query", {})
    assert isinstance(error, provider.FakeProviderProcessCrashed)
    assert client.last_exit_code == (9 if process_present else None)
    assert process.kill.call_count == int(process_present)


def test_discard_closes_other_pipes_when_one_close_fails(channel):
    client, process, _future, _reader = channel
    process.stdin = Mock()
    process.stdin.close.side_effect = OSError("synthetic close error")
    process.stdout = None
    client._discard_process()
    assert client._process is None
    assert process.stderr.closed


@pytest.mark.parametrize(
    "field,value",
    [
        ("job_id", "bad"),
        ("idempotency_key", "bad key"),
        ("request_hash", "bad"),
        ("status", "RUNNING"),
        ("accepted_at", "bad"),
        ("accepted_at", "2026-10-10T00:00:00"),
        ("status", None),
    ],
)
def test_job_record_is_strict_and_requires_timezone(field, value):
    record = dict(
        job_id="job_" + "1" * 32,
        idempotency_key="synthetic",
        request_hash="sha256:" + "a" * 64,
        status="ACCEPTED",
        accepted_at="2026-10-10T00:00:00Z",
    )
    record[field] = value
    with pytest.raises(provider.FakeProviderError, match="invalid job record"):
        provider._job(record)
