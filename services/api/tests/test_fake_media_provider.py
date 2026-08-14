from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from aijian_api.fake_media_provider import (
    FAKE_HTTP_429_RETRY_AFTER_SECONDS,
    FAKE_MEDIA_AUTH_HEADER_SENTINEL,
    FAKE_MEDIA_SECRET_SENTINEL,
    FAKE_MEDIA_SIGNED_URL_SENTINEL,
    FakeAsyncMediaProvider,
)
from aijian_api.media_provider_runtime import (
    MediaProviderRequest,
    MediaSubmitAccepted,
    MediaSubmitFailure,
    media_operation_for_capability,
)
from aijian_api.provider_runtime import ProviderProtocolError
from pydantic import ValidationError

NOW = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)
CAPABILITIES = ("IMAGE", "VIDEO", "SPEECH")


def media_request_payload(
    *,
    capability: str = "IMAGE",
    request_id: str = "22222222-2222-2222-2222-222222222222",
    idempotency_key: str = "media-job-1",
) -> dict[str, object]:
    return {
        "operation": media_operation_for_capability(capability),  # type: ignore[arg-type]
        "capability": capability,
        "request_id": request_id,
        "provider_connection_id": "pcn_" + "a" * 32,
        "provider_account_id": "acct_media_main",
        "model_id": "fake-media-v1",
        "idempotency_key": idempotency_key,
        "prompt": "雾城旧站夜景，冷色调",
        "timeout_ms": 60_000,
    }


def media_request(**kwargs: object) -> MediaProviderRequest:
    return MediaProviderRequest.model_validate(media_request_payload(**kwargs))  # type: ignore[arg-type]


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_fake_media_submit_is_deterministic_per_capability(capability: str) -> None:
    provider = FakeAsyncMediaProvider()
    request = media_request(capability=capability, idempotency_key=f"{capability}-1")

    first = provider.submit(request)
    second = provider.submit(request)

    assert isinstance(first, MediaSubmitAccepted)
    assert first == second
    assert first.provider_job_id.startswith("mjob_")
    assert first.provider_request_id.startswith("mreq_")
    assert provider.submit_count_for(request) == 2


@pytest.mark.parametrize(
    ("fault", "code", "retryable", "http_status", "retry_after", "acceptance"),
    [
        ("http_401", "AUTH_ERROR", False, 401, None, "CONFIRMED_NOT_ACCEPTED"),
        (
            "http_429",
            "RATE_LIMITED",
            True,
            429,
            FAKE_HTTP_429_RETRY_AFTER_SECONDS,
            "CONFIRMED_NOT_ACCEPTED",
        ),
        ("http_500", "REMOTE_UNAVAILABLE", True, 500, None, "CONFIRMED_NOT_ACCEPTED"),
        ("http_502", "REMOTE_UNAVAILABLE", True, 502, None, "CONFIRMED_NOT_ACCEPTED"),
        ("http_503", "REMOTE_UNAVAILABLE", True, 503, None, "CONFIRMED_NOT_ACCEPTED"),
        ("http_504", "REMOTE_UNAVAILABLE", True, 504, None, "CONFIRMED_NOT_ACCEPTED"),
        ("moderation", "REFUSED", False, None, None, "CONFIRMED_NOT_ACCEPTED"),
        ("dispatch_ambiguous", "REMOTE_UNKNOWN", False, None, None, "DISPATCH_AMBIGUOUS"),
    ],
)
@pytest.mark.parametrize("capability", CAPABILITIES)
def test_fake_media_submit_fault_matrix(
    fault: str,
    code: str,
    retryable: bool,
    http_status: int | None,
    retry_after: int | None,
    acceptance: str,
    capability: str,
) -> None:
    provider = FakeAsyncMediaProvider(
        submit_fault=fault,  # type: ignore[arg-type]
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
    )
    request = media_request(capability=capability, idempotency_key=f"{capability}-{fault}")
    result = provider.submit(request)

    assert isinstance(result, MediaSubmitFailure)
    assert result.acceptance == acceptance
    assert result.error.code == code
    assert result.error.retryable is retryable
    assert result.error.http_status == http_status
    assert result.error.retry_after_seconds == retry_after
    assert result.usage is None
    serialized = json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
    for sentinel in (
        FAKE_MEDIA_SECRET_SENTINEL,
        FAKE_MEDIA_SIGNED_URL_SENTINEL,
        FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        "Authorization",
        "api_key",
    ):
        assert sentinel not in serialized
        assert sentinel not in result.error.message


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_fake_media_callback_hides_signed_url_and_secrets(capability: str) -> None:
    provider = FakeAsyncMediaProvider(
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
    )
    request = media_request(capability=capability)
    accepted = provider.submit(request)
    assert isinstance(accepted, MediaSubmitAccepted)
    event = provider.build_callback(request, now=NOW, outcome="succeeded")

    assert event.status == "SUCCEEDED"
    assert event.result is not None
    assert event.result.asset_ref.startswith("fake_media_")
    assert event.result.content_hash.startswith("sha256:")
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in event.result.asset_ref
    dumped = json.dumps(event.model_dump(mode="json"), ensure_ascii=False)
    assert FAKE_MEDIA_SECRET_SENTINEL not in dumped
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in dumped
    assert FAKE_MEDIA_AUTH_HEADER_SENTINEL not in dumped
    assert "token=" not in dumped


def test_fake_media_provider_rejects_callback_without_job() -> None:
    provider = FakeAsyncMediaProvider()
    with pytest.raises(ProviderProtocolError, match="no accepted job"):
        provider.build_callback(media_request(), now=NOW)


def test_media_request_rejects_capability_operation_mismatch() -> None:
    payload = media_request_payload(capability="IMAGE")
    payload["operation"] = "video.generate"
    with pytest.raises(ValidationError, match="requires capability"):
        MediaProviderRequest.model_validate(payload)


def test_diagnostics_blob_excludes_secrets_and_request_payload() -> None:
    provider = FakeAsyncMediaProvider(
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
    )
    request = media_request()
    provider.submit(request)
    blob = json.dumps(provider.diagnostics_blob(), ensure_ascii=False)
    assert FAKE_MEDIA_SECRET_SENTINEL not in blob
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in blob
    assert FAKE_MEDIA_AUTH_HEADER_SENTINEL not in blob
    assert str(request.request_id) not in blob
    assert "api_key" not in blob
