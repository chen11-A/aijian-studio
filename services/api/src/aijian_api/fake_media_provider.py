"""Deterministic offline fake for async IMAGE / VIDEO / SPEECH provider jobs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Literal
from uuid import UUID

from aijian_api.media_provider_runtime import (
    MediaCallbackEvent,
    MediaProviderRequest,
    MediaProviderUsage,
    MediaResultHandle,
    MediaSubmitAccepted,
    MediaSubmitFailure,
    validate_media_submit_result,
)
from aijian_api.provider_runtime import (
    ProviderErrorCode,
    ProviderFailureError,
    ProviderProtocolError,
)

type FakeMediaSubmitFault = Literal[
    "http_401",
    "http_429",
    "http_500",
    "http_502",
    "http_503",
    "http_504",
    "moderation",
    "dispatch_ambiguous",
]
type FakeMediaCallbackOutcome = Literal[
    "succeeded",
    "failed",
    "cancelled",
    "expired_result",
]

FAKE_HTTP_429_RETRY_AFTER_SECONDS = 2
FAKE_MEDIA_SECRET_SENTINEL = "sk-fake-media-provider-sentinel-do-not-leak"
FAKE_MEDIA_SIGNED_URL_SENTINEL = (
    "https://signed.example/result?token=sig-fake-media-token-do-not-leak"
)
FAKE_MEDIA_AUTH_HEADER_SENTINEL = f"Bearer {FAKE_MEDIA_SECRET_SENTINEL}"

_UNIT_KIND_BY_CAPABILITY = {
    "IMAGE": "images",
    "VIDEO": "video_seconds",
    "SPEECH": "characters",
}


@dataclass
class _AcceptedJob:
    request: MediaProviderRequest
    provider_request_id: str
    provider_job_id: str
    event_seq: int = 0


@dataclass
class FakeAsyncMediaProvider:
    """In-memory async media provider that never performs network I/O."""

    submit_fault: FakeMediaSubmitFault | None = None
    callback_outcome: FakeMediaCallbackOutcome = "succeeded"
    result_ttl: timedelta = timedelta(hours=1)
    # Internal credential material is present only to prove redaction.
    authorization_header: str = FAKE_MEDIA_AUTH_HEADER_SENTINEL
    signed_result_url: str = FAKE_MEDIA_SIGNED_URL_SENTINEL
    _jobs: dict[str, _AcceptedJob] = field(default_factory=dict)
    _submit_count_by_idempotency: dict[str, int] = field(default_factory=dict)

    def submit(
        self,
        request: MediaProviderRequest | dict[str, object],
    ) -> MediaSubmitAccepted | MediaSubmitFailure:
        parsed = MediaProviderRequest.model_validate(request)
        # Touch secret material so leak regressions are meaningful, not vacuous.
        _ = (self.authorization_header, self.signed_result_url, FAKE_MEDIA_SECRET_SENTINEL)
        idem_key = _idempotency_identity(parsed)
        self._submit_count_by_idempotency[idem_key] = (
            self._submit_count_by_idempotency.get(idem_key, 0) + 1
        )
        if self.submit_fault is not None:
            return validate_media_submit_result(parsed, _submit_failure(parsed, self.submit_fault))

        provider_request_id = _provider_request_id(parsed)
        provider_job_id = _provider_job_id(parsed)
        existing = self._jobs.get(provider_job_id)
        if existing is not None:
            return validate_media_submit_result(
                parsed,
                MediaSubmitAccepted(
                    request_id=parsed.request_id,
                    provider_request_id=existing.provider_request_id,
                    provider_job_id=existing.provider_job_id,
                    latency_ms=0,
                ),
            )
        self._jobs[provider_job_id] = _AcceptedJob(
            request=parsed,
            provider_request_id=provider_request_id,
            provider_job_id=provider_job_id,
        )
        return validate_media_submit_result(
            parsed,
            MediaSubmitAccepted(
                request_id=parsed.request_id,
                provider_request_id=provider_request_id,
                provider_job_id=provider_job_id,
                latency_ms=0,
            ),
        )

    def submit_count_for(self, request: MediaProviderRequest) -> int:
        return self._submit_count_by_idempotency.get(_idempotency_identity(request), 0)

    def build_callback(
        self,
        request: MediaProviderRequest,
        *,
        now: datetime,
        outcome: FakeMediaCallbackOutcome | None = None,
        event_id_suffix: str = "0",
        force_event_seq: int | None = None,
        provider_job_id: str | None = None,
        provider_request_id: str | None = None,
        provider_account_id: str | None = None,
        request_id_override: UUID | None = None,
    ) -> MediaCallbackEvent:
        parsed = request
        job_id = provider_job_id or _provider_job_id(parsed)
        job = self._jobs.get(job_id)
        if job is None and provider_job_id is None:
            raise ProviderProtocolError("Fake media provider has no accepted job for callback")
        resolved_outcome = outcome or self.callback_outcome
        if force_event_seq is not None:
            seq = force_event_seq
        elif job is not None:
            seq = job.event_seq + 1
            job.event_seq = seq
        else:
            seq = 1
        provider_request = provider_request_id or (
            job.provider_request_id if job is not None else _provider_request_id(parsed)
        )
        account = provider_account_id or parsed.provider_account_id
        request_id = parsed.request_id if request_id_override is None else request_id_override
        event_id = f"evt_{_digest(f'{job_id}:{seq}:{event_id_suffix}')[:24]}"

        if resolved_outcome == "succeeded":
            handle = _result_handle(
                parsed,
                now=now,
                ttl=self.result_ttl,
                signed_url=self.signed_result_url,
            )
            return MediaCallbackEvent(
                event_id=event_id,
                event_seq=seq,
                provider_job_id=job_id,
                provider_request_id=provider_request,
                provider_account_id=account,
                request_id=request_id,
                status="SUCCEEDED",
                result=handle,
                usage=_usage(parsed),
                observed_at=now,
            )
        if resolved_outcome == "expired_result":
            handle = _result_handle(
                parsed,
                now=now,
                ttl=timedelta(seconds=-1),
                signed_url=self.signed_result_url,
            )
            return MediaCallbackEvent(
                event_id=event_id,
                event_seq=seq,
                provider_job_id=job_id,
                provider_request_id=provider_request,
                provider_account_id=account,
                request_id=request_id,
                status="SUCCEEDED",
                result=handle,
                usage=_usage(parsed),
                observed_at=now,
            )
        if resolved_outcome == "cancelled":
            return MediaCallbackEvent(
                event_id=event_id,
                event_seq=seq,
                provider_job_id=job_id,
                provider_request_id=provider_request,
                provider_account_id=account,
                request_id=request_id,
                status="CANCELLED",
                observed_at=now,
            )
        return MediaCallbackEvent(
            event_id=event_id,
            event_seq=seq,
            provider_job_id=job_id,
            provider_request_id=provider_request,
            provider_account_id=account,
            request_id=request_id,
            status="FAILED",
            error=ProviderFailureError(
                code="REFUSED",
                message="Fake media provider callback failure",
                retryable=False,
                provider_request_id=provider_request,
                details={"source": "fake_media_provider"},
            ),
            observed_at=now,
        )

    def diagnostics_blob(self) -> dict[str, object]:
        """Return a redaction-safe projection used by tests and harness diagnostics."""

        return {
            "jobs": sorted(self._jobs),
            "submit_counts": dict(self._submit_count_by_idempotency),
            # Secrets exist only on the private object, never in diagnostics.
        }


def _submit_failure(
    request: MediaProviderRequest,
    fault: FakeMediaSubmitFault,
) -> MediaSubmitFailure:
    code_by_fault: dict[FakeMediaSubmitFault, ProviderErrorCode] = {
        "http_401": "AUTH_ERROR",
        "http_429": "RATE_LIMITED",
        "http_500": "REMOTE_UNAVAILABLE",
        "http_502": "REMOTE_UNAVAILABLE",
        "http_503": "REMOTE_UNAVAILABLE",
        "http_504": "REMOTE_UNAVAILABLE",
        "moderation": "REFUSED",
        "dispatch_ambiguous": "REMOTE_UNKNOWN",
    }
    retryable_by_fault = {
        "http_401": False,
        "http_429": True,
        "http_500": True,
        "http_502": True,
        "http_503": True,
        "http_504": True,
        "moderation": False,
        "dispatch_ambiguous": False,
    }
    http_status_by_fault: dict[FakeMediaSubmitFault, int | None] = {
        "http_401": 401,
        "http_429": 429,
        "http_500": 500,
        "http_502": 502,
        "http_503": 503,
        "http_504": 504,
        "moderation": None,
        "dispatch_ambiguous": None,
    }
    http_status = http_status_by_fault[fault]
    details = {"source": "fake_media_provider", "fault": fault}
    if http_status is not None:
        details["http_status"] = str(http_status)
    # Secrets are intentionally in scope and must not appear in the typed failure.
    _ = (
        FAKE_MEDIA_SECRET_SENTINEL,
        FAKE_MEDIA_SIGNED_URL_SENTINEL,
        FAKE_MEDIA_AUTH_HEADER_SENTINEL,
    )
    error = ProviderFailureError(
        code=code_by_fault[fault],
        message=f"Fake media provider injected {fault.replace('_', ' ')}",
        retryable=retryable_by_fault[fault],
        provider_request_id=_provider_request_id(request),
        details=details,
        http_status=http_status,
        retry_after_seconds=(FAKE_HTTP_429_RETRY_AFTER_SECONDS if fault == "http_429" else None),
    )
    if fault == "dispatch_ambiguous":
        return MediaSubmitFailure(
            acceptance="DISPATCH_AMBIGUOUS",
            request_id=request.request_id,
            error=error,
            usage=None,
            latency_ms=0,
        )
    return MediaSubmitFailure(
        acceptance="CONFIRMED_NOT_ACCEPTED",
        request_id=request.request_id,
        error=error,
        usage=None,
        latency_ms=0,
    )


def _result_handle(
    request: MediaProviderRequest,
    *,
    now: datetime,
    ttl: timedelta,
    signed_url: str,
) -> MediaResultHandle:
    # Signed URL is consumed only to derive an opaque asset ref digest; never stored.
    digest = _digest(f"{request.capability}:{request.idempotency_key}:{signed_url}")
    return MediaResultHandle(
        asset_ref=f"fake_media_{digest[:32]}",
        content_hash=f"sha256:{digest}",
        expires_at=now + ttl,
        media_kind=request.capability,
    )


def _usage(request: MediaProviderRequest) -> MediaProviderUsage:
    units = max(1, len(request.prompt) // 8)
    return MediaProviderUsage(
        units=units,
        unit_kind=_UNIT_KIND_BY_CAPABILITY[request.capability],  # type: ignore[arg-type]
    )


def _provider_request_id(request: MediaProviderRequest) -> str:
    return f"mreq_{_digest(_idempotency_identity(request))[:28]}"


def _provider_job_id(request: MediaProviderRequest) -> str:
    return f"mjob_{_digest(_idempotency_identity(request) + ':job')[:28]}"


def _idempotency_identity(request: MediaProviderRequest) -> str:
    return (
        f"{request.provider_connection_id}:{request.provider_account_id}:"
        f"{request.model_id}:{request.idempotency_key}:{request.operation}"
    )


def _digest(value: str) -> str:
    return sha256(value.encode()).hexdigest()
