"""Typed async media provider boundary and deterministic remote-attempt harness.

Covers IMAGE / VIDEO / SPEECH submission, callback application, and expiring
result handling without network I/O or production vendor adapters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from aijian_api.artifacts import canonical_content_hash
from aijian_api.provider_runtime import (
    ProviderFailureError,
    ProviderNonRetryableError,
    ProviderProtocolError,
    ProviderRetryableError,
    RemoteUnknownProviderError,
    public_provider_error_code,
)
from aijian_api.workflow_tasks import (
    AttemptState,
    InvalidTaskTransitionError,
    NodeRun,
    ProviderCapabilities,
    RetryDisposition,
    TaskAttempt,
    TransitionEvidence,
    recovery_action_for_attempt,
    transition_attempt,
    transition_node,
)

type MediaCapability = Literal["IMAGE", "VIDEO", "SPEECH"]
type MediaOperation = Literal["image.generate", "video.generate", "speech.synthesize"]
type MediaCallbackStatus = Literal["SUCCEEDED", "FAILED", "CANCELLED"]
type MediaCallbackDisposition = Literal[
    "APPLIED",
    "DUPLICATE_IGNORED",
    "STALE_IGNORED",
    "REJECTED_MISMATCH",
    "QUARANTINED_MISMATCH",
]
type ResultUrlExpiryAction = Literal["FAIL_PERMANENT"]

_CAPABILITY_BY_OPERATION: dict[MediaOperation, MediaCapability] = {
    "image.generate": "IMAGE",
    "video.generate": "VIDEO",
    "speech.synthesize": "SPEECH",
}
_OPERATION_BY_CAPABILITY: dict[MediaCapability, MediaOperation] = {
    capability: operation for operation, capability in _CAPABILITY_BY_OPERATION.items()
}
_TERMINAL_ATTEMPT_STATES: frozenset[AttemptState] = frozenset(
    {"SUCCEEDED", "FAILED", "CANCELLED", "NOT_SUBMITTED"}
)
_CALLBACK_ACTIVE_STATES: frozenset[AttemptState] = frozenset(
    {"SUBMITTING", "WAITING_REMOTE", "CANCEL_REQUESTED"}
)
_ASSET_REF_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")
_OPAQUE_PROVIDER_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")
_URL_IN_TEXT = re.compile(r"(?:https?|s3|gs|azure)://\S+", re.IGNORECASE)
_GENERIC_SCHEME_URL = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+", re.IGNORECASE)
_BEARER_IN_TEXT = re.compile(r"Bearer\s+\S+", re.IGNORECASE)
_API_KEY_IN_TEXT = re.compile(r"\bsk-[A-Za-z0-9_-]+\b")
_TOKEN_ASSIGN_IN_TEXT = re.compile(r"(?i)\btoken=[^\s&]+")
_API_KEY_ASSIGN_IN_TEXT = re.compile(r"(?i)\bapi[_-]?key=[^\s&]+")
_SENSITIVE_DETAIL_MARKERS = (
    "://",
    "token=",
    "Bearer",
    "api_key",
    "api-key",
    "sk-",
    "Authorization",
)
_ALLOWED_FAILURE_DETAIL_KEYS = frozenset({"source", "fault", "http_status"})


class _StrictMediaModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class MediaProviderUsage(_StrictMediaModel):
    units: int = Field(ge=0)
    unit_kind: Literal["images", "video_seconds", "characters"]


class MediaProviderRequest(_StrictMediaModel):
    operation: MediaOperation
    capability: MediaCapability
    request_id: UUID
    provider_connection_id: str = Field(pattern=r"^pcn_[0-9a-f]{32}$")
    provider_account_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    model_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    idempotency_key: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    prompt: str = Field(min_length=1, max_length=20_000)
    timeout_ms: int = Field(ge=1, le=600_000)

    @model_validator(mode="after")
    def validate_capability_operation(self) -> MediaProviderRequest:
        expected = _CAPABILITY_BY_OPERATION[self.operation]
        if self.capability != expected:
            raise ValueError(
                f"operation {self.operation} requires capability {expected}, not {self.capability}"
            )
        return self


class MediaResultHandle(_StrictMediaModel):
    """Opaque media result reference. Signed URLs never appear on this contract."""

    asset_ref: str = Field(min_length=1, max_length=200)
    content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    expires_at: datetime | None = None
    media_kind: MediaCapability

    @field_validator("asset_ref")
    @classmethod
    def reject_url_shaped_asset_ref(cls, value: str) -> str:
        if not _ASSET_REF_PATTERN.fullmatch(value):
            raise ValueError("asset_ref must be an opaque identifier")
        lowered = value.lower()
        if any(marker in lowered for marker in ("://", "?", "#", "token=", "bearer")):
            raise ValueError("asset_ref must not contain URL or credential material")
        return value


class MediaSubmitAccepted(_StrictMediaModel):
    kind: Literal["accepted"] = "accepted"
    acceptance: Literal["ACCEPTED"] = "ACCEPTED"
    request_id: UUID
    provider_request_id: str = Field(min_length=1, max_length=200)
    provider_job_id: str = Field(min_length=1, max_length=200)
    latency_ms: int = Field(ge=0)


class MediaSubmitFailure(_StrictMediaModel):
    kind: Literal["failure"] = "failure"
    acceptance: Literal["CONFIRMED_NOT_ACCEPTED", "DISPATCH_AMBIGUOUS"]
    request_id: UUID
    error: ProviderFailureError
    usage: MediaProviderUsage | None = None
    latency_ms: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_acceptance_alignment(self) -> MediaSubmitFailure:
        if self.acceptance == "DISPATCH_AMBIGUOUS" and self.error.code != "REMOTE_UNKNOWN":
            raise ValueError("dispatch ambiguity must use REMOTE_UNKNOWN")
        if self.acceptance == "CONFIRMED_NOT_ACCEPTED" and self.error.code == "REMOTE_UNKNOWN":
            raise ValueError("confirmed-not-accepted cannot use REMOTE_UNKNOWN")
        if self.acceptance == "DISPATCH_AMBIGUOUS" and self.error.retryable:
            raise ValueError("dispatch ambiguity must not be marked retryable")
        return self


MediaSubmitResult = Annotated[
    MediaSubmitAccepted | MediaSubmitFailure,
    Field(discriminator="kind"),
]
MEDIA_SUBMIT_RESULT_ADAPTER: TypeAdapter[MediaSubmitResult] = TypeAdapter(MediaSubmitResult)


class MediaCallbackEvent(_StrictMediaModel):
    event_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    event_seq: int = Field(ge=0)
    provider_job_id: str = Field(min_length=1, max_length=200)
    provider_request_id: str = Field(min_length=1, max_length=200)
    provider_account_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    request_id: UUID
    status: MediaCallbackStatus
    result: MediaResultHandle | None = None
    error: ProviderFailureError | None = None
    usage: MediaProviderUsage | None = None
    observed_at: datetime

    @model_validator(mode="after")
    def validate_status_payload(self) -> MediaCallbackEvent:
        if self.status == "SUCCEEDED":
            if self.result is None:
                raise ValueError("succeeded callback requires a result handle")
            if self.error is not None:
                raise ValueError("succeeded callback cannot carry an error")
        else:
            if self.result is not None:
                raise ValueError("non-success callback cannot carry a result handle")
            if self.status == "FAILED" and self.error is None:
                raise ValueError("failed callback requires an error")
        return self


class ResultUrlExpiryPolicy(_StrictMediaModel):
    """Permanent failure on expiry; never redownload, log signed URLs, or regenerate."""

    action: ResultUrlExpiryAction = "FAIL_PERMANENT"
    allow_silent_redownload: Literal[False] = False
    allow_auto_regenerate: Literal[False] = False
    allow_log_signed_url: Literal[False] = False


DEFAULT_RESULT_URL_EXPIRY_POLICY = ResultUrlExpiryPolicy()


def media_operation_for_capability(capability: MediaCapability) -> MediaOperation:
    return _OPERATION_BY_CAPABILITY[capability]


def media_request_fingerprint(request: MediaProviderRequest) -> str:
    return canonical_content_hash(request.model_dump(mode="json"))


def validate_media_submit_result(
    request: MediaProviderRequest,
    result: MediaSubmitAccepted | MediaSubmitFailure,
) -> MediaSubmitAccepted | MediaSubmitFailure:
    if result.request_id != request.request_id:
        raise ProviderProtocolError("Media provider submit result request ID does not match")
    return result


def validate_media_callback_identity(
    *,
    request: MediaProviderRequest,
    provider_job_id: str | None,
    provider_request_id: str | None,
    event: MediaCallbackEvent,
) -> str | None:
    """Return a stable mismatch reason, or None when the callback matches the attempt."""

    if event.request_id != request.request_id:
        return "callback request identity mismatch"
    if event.provider_account_id != request.provider_account_id:
        return "callback provider account mismatch"
    if provider_job_id is not None and event.provider_job_id != provider_job_id:
        return "callback provider job mismatch"
    if provider_request_id is not None and event.provider_request_id != provider_request_id:
        return "callback provider request mismatch"
    return None


def raise_for_submit_failure(failure: MediaSubmitFailure) -> None:
    """Map a confirmed or ambiguous submit failure into runtime exceptions."""

    if failure.acceptance == "DISPATCH_AMBIGUOUS" or failure.error.code == "REMOTE_UNKNOWN":
        raise RemoteUnknownProviderError(failure.error.message)
    if failure.error.retryable:
        raise ProviderRetryableError(
            failure.error.message,
            code=failure.error.code,
            retry_after_seconds=failure.error.retry_after_seconds,
        )
    raise ProviderNonRetryableError(failure.error.message, code=failure.error.code)


def retry_disposition_for_failure(error: ProviderFailureError) -> RetryDisposition:
    """Map a confirmed-not-accepted submit failure for local retry policy."""

    if error.code == "REMOTE_UNKNOWN":
        return "REMOTE_UNKNOWN"
    if error.retryable:
        return "SAFE_LOCAL_RETRY"
    return "NON_RETRYABLE"


def retry_disposition_for_callback_failure(error: ProviderFailureError) -> RetryDisposition:
    """Callback failures after remote accept never open a fresh billable submit retry."""

    if error.code == "REMOTE_UNKNOWN":
        return "REMOTE_UNKNOWN"
    return "NON_RETRYABLE"


def materialize_result_handle(
    handle: MediaResultHandle,
    *,
    now: datetime,
    policy: ResultUrlExpiryPolicy = DEFAULT_RESULT_URL_EXPIRY_POLICY,
) -> MediaResultHandle:
    """Materialize an opaque result. Expired handles fail permanently without redownload."""

    del policy  # policy fields are compile-time false; present for contract clarity
    # Re-validate opacity in case callers construct handles outside model_validate.
    if not _ASSET_REF_PATTERN.fullmatch(handle.asset_ref):
        raise ProviderProtocolError("Media result asset_ref is not opaque")
    if handle.expires_at is not None and now >= handle.expires_at:
        raise ProviderNonRetryableError(
            "Media result handle expired before materialization",
            code="RESULT_EXPIRED",
        )
    return handle


def redact_media_diagnostics(text: str, *, forbidden: tuple[str, ...] = ()) -> str:
    """Strip known secrets and common credential/URL shapes from diagnostic strings."""

    redacted = text
    for token in forbidden:
        if token:
            redacted = redacted.replace(token, "[redacted]")
    redacted = _URL_IN_TEXT.sub("[redacted-url]", redacted)
    redacted = _GENERIC_SCHEME_URL.sub("[redacted-url]", redacted)
    redacted = _BEARER_IN_TEXT.sub("[redacted-auth]", redacted)
    redacted = _API_KEY_IN_TEXT.sub("[redacted-key]", redacted)
    redacted = _TOKEN_ASSIGN_IN_TEXT.sub("token=[redacted]", redacted)
    redacted = _API_KEY_ASSIGN_IN_TEXT.sub("api_key=[redacted]", redacted)
    return redacted


def sanitize_provider_identity(value: str | None) -> str | None:
    """Keep only opaque provider identity strings; drop URL/credential-shaped values."""

    if value is None:
        return None
    if not _OPAQUE_PROVIDER_ID_PATTERN.fullmatch(value):
        return None
    lowered = value.lower()
    if any(marker in lowered for marker in ("://", "?", "#", "token=", "bearer", "api_key")):
        return None
    return value


def sanitize_provider_request_id(provider_request_id: str | None) -> str | None:
    """Alias for request-id opacity checks used by failure projections."""

    return sanitize_provider_identity(provider_request_id)


def sanitize_provider_failure_error(error: ProviderFailureError) -> ProviderFailureError:
    """Drop/scrub credential-bearing message, ids, and detail fields before persistence."""

    safe_details: dict[str, str] = {}
    for key, value in error.details.items():
        if key not in _ALLOWED_FAILURE_DETAIL_KEYS:
            continue
        if any(marker in value for marker in _SENSITIVE_DETAIL_MARKERS):
            continue
        safe_details[key] = redact_media_diagnostics(value)
    return ProviderFailureError(
        code=error.code,
        message=redact_media_diagnostics(error.message)[:1000] or "provider failure",
        retryable=error.retryable,
        provider_request_id=sanitize_provider_identity(error.provider_request_id),
        details=safe_details,
        http_status=error.http_status,
        retry_after_seconds=error.retry_after_seconds,
    )


@dataclass(frozen=True, slots=True)
class MediaHarnessSnapshot:
    node: NodeRun
    attempt: TaskAttempt
    request: MediaProviderRequest
    provider_request_id: str | None = None
    provider_job_id: str | None = None
    applied_event_ids: frozenset[str] = field(default_factory=frozenset)
    latest_event_seq: int | None = None
    output_version_id: str | None = None
    result: MediaResultHandle | None = None
    last_error: ProviderFailureError | None = None
    last_callback_disposition: MediaCallbackDisposition | None = None
    submit_count: int = 0
    finalized_outputs: int = 0


@dataclass(frozen=True, slots=True)
class MediaCallbackApplication:
    snapshot: MediaHarnessSnapshot
    disposition: MediaCallbackDisposition


class AsyncMediaAttemptHarness:
    """Drives one remote media attempt through the shared workflow state machine."""

    def __init__(
        self,
        *,
        node: NodeRun,
        attempt: TaskAttempt,
        request: MediaProviderRequest,
        result_url_policy: ResultUrlExpiryPolicy = DEFAULT_RESULT_URL_EXPIRY_POLICY,
    ) -> None:
        if attempt.execution_mode != "remote":
            raise ValueError("async media harness requires a remote attempt")
        if media_request_fingerprint(request) != attempt.request_fingerprint:
            raise ValueError("request fingerprint does not match the attempt")
        if attempt.provider_account_id != request.provider_account_id:
            raise ValueError("provider account does not match the attempt")
        self._result_url_policy = result_url_policy
        self._snapshot = MediaHarnessSnapshot(node=node, attempt=attempt, request=request)

    @property
    def snapshot(self) -> MediaHarnessSnapshot:
        return self._snapshot

    def begin_submission(self, *, now: datetime) -> MediaHarnessSnapshot:
        attempt = self._snapshot.attempt
        if attempt.state == "RUNNING":
            attempt = transition_attempt(attempt, "SUBMIT_INTENT", now=now)
        if attempt.state == "SUBMIT_INTENT":
            attempt = transition_attempt(
                attempt,
                "SUBMITTING",
                now=now,
                evidence=TransitionEvidence(dispatch_started_at=now),
            )
        elif attempt.state != "SUBMITTING":
            raise InvalidTaskTransitionError(
                f"cannot begin media submission from attempt state {attempt.state}"
            )
        self._snapshot = replace(self._snapshot, attempt=attempt)
        return self._snapshot

    def apply_submit_result(
        self,
        result: MediaSubmitAccepted | MediaSubmitFailure,
        *,
        now: datetime,
    ) -> MediaHarnessSnapshot:
        validated = validate_media_submit_result(self._snapshot.request, result)
        snapshot = self.begin_submission(now=now)
        submit_count = snapshot.submit_count + 1
        if isinstance(validated, MediaSubmitAccepted):
            provider_job_id = sanitize_provider_identity(validated.provider_job_id)
            provider_request_id = sanitize_provider_identity(validated.provider_request_id)
            if provider_job_id is None or provider_request_id is None:
                raise ProviderProtocolError(
                    "accepted media submit returned non-opaque provider identity"
                )
            attempt = transition_attempt(
                snapshot.attempt,
                "WAITING_REMOTE",
                now=now,
                evidence=TransitionEvidence(provider_job_id=provider_job_id),
            )
            self._snapshot = replace(
                snapshot,
                attempt=attempt,
                provider_request_id=provider_request_id,
                provider_job_id=provider_job_id,
                submit_count=submit_count,
                last_error=None,
            )
            return self._snapshot

        disposition = retry_disposition_for_failure(validated.error)
        safe_error = sanitize_provider_failure_error(validated.error)
        if validated.acceptance == "DISPATCH_AMBIGUOUS":
            attempt = transition_attempt(snapshot.attempt, "REMOTE_UNKNOWN", now=now)
            node = transition_node(
                snapshot.node,
                "RECONCILIATION_REQUIRED",
                now=now,
                evidence=TransitionEvidence(retry_disposition="REMOTE_UNKNOWN"),
            )
            self._snapshot = replace(
                snapshot,
                node=node,
                attempt=attempt,
                submit_count=submit_count,
                last_error=safe_error,
            )
            return self._snapshot

        attempt = transition_attempt(
            snapshot.attempt,
            "FAILED",
            now=now,
            evidence=TransitionEvidence(retry_disposition=disposition),
        )
        node = transition_node(
            snapshot.node,
            "FAILED",
            now=now,
            evidence=TransitionEvidence(retry_disposition=disposition),
        )
        self._snapshot = replace(
            snapshot,
            node=node,
            attempt=attempt,
            submit_count=submit_count,
            last_error=safe_error,
        )
        return self._snapshot

    def request_cancel(self, *, now: datetime) -> MediaHarnessSnapshot:
        attempt = transition_attempt(self._snapshot.attempt, "CANCEL_REQUESTED", now=now)
        node = transition_node(self._snapshot.node, "CANCEL_REQUESTED", now=now)
        self._snapshot = replace(self._snapshot, node=node, attempt=attempt)
        return self._snapshot

    def apply_callback(
        self,
        event: MediaCallbackEvent,
        *,
        now: datetime,
        output_version_id: str | None = None,
    ) -> MediaCallbackApplication:
        snapshot = self._snapshot
        if event.event_id in snapshot.applied_event_ids:
            updated = replace(snapshot, last_callback_disposition="DUPLICATE_IGNORED")
            self._snapshot = updated
            return MediaCallbackApplication(snapshot=updated, disposition="DUPLICATE_IGNORED")

        if snapshot.latest_event_seq is not None and event.event_seq < snapshot.latest_event_seq:
            updated = replace(snapshot, last_callback_disposition="STALE_IGNORED")
            self._snapshot = updated
            return MediaCallbackApplication(snapshot=updated, disposition="STALE_IGNORED")

        if snapshot.attempt.state in _TERMINAL_ATTEMPT_STATES:
            updated = replace(snapshot, last_callback_disposition="STALE_IGNORED")
            self._snapshot = updated
            return MediaCallbackApplication(snapshot=updated, disposition="STALE_IGNORED")

        mismatch = validate_media_callback_identity(
            request=snapshot.request,
            provider_job_id=snapshot.provider_job_id or snapshot.attempt.provider_job_id,
            provider_request_id=snapshot.provider_request_id,
            event=event,
        )
        if mismatch is not None:
            return self._apply_identity_mismatch(snapshot, event, mismatch, now=now)

        applied_ids = frozenset({*snapshot.applied_event_ids, event.event_id})
        if event.status == "SUCCEEDED":
            if event.result is None:
                raise ProviderProtocolError("succeeded callback requires a result handle")
            if event.result.media_kind != snapshot.request.capability:
                return self._apply_identity_mismatch(
                    snapshot,
                    event,
                    "callback media kind mismatch",
                    now=now,
                )
            try:
                handle = materialize_result_handle(
                    event.result,
                    now=now,
                    policy=self._result_url_policy,
                )
            except ProviderNonRetryableError as error:
                failure = ProviderFailureError(
                    code=error.code,
                    message=error.args[0] if error.args else "result expired",
                    retryable=False,
                    provider_request_id=snapshot.provider_request_id,
                    details={"source": "result_url_expiry"},
                )
                return self._apply_terminal_failure(
                    snapshot,
                    failure,
                    now=now,
                    applied_event_ids=applied_ids,
                    event_seq=event.event_seq,
                )
            except ProviderProtocolError as error:
                failure = ProviderFailureError(
                    code="PROTOCOL_ERROR",
                    message=str(error),
                    retryable=False,
                    provider_request_id=snapshot.provider_request_id,
                    details={"source": "result_handle_validation"},
                )
                return self._apply_terminal_failure(
                    snapshot,
                    failure,
                    now=now,
                    applied_event_ids=applied_ids,
                    event_seq=event.event_seq,
                )

            if not output_version_id:
                raise InvalidTaskTransitionError(
                    "output version is required before media callback success"
                )

            attempt = snapshot.attempt
            safe_event_job = sanitize_provider_identity(event.provider_job_id)
            safe_event_request = sanitize_provider_identity(event.provider_request_id)
            if safe_event_job is None:
                return self._apply_identity_mismatch(
                    snapshot,
                    event,
                    "callback provider job identity is not opaque",
                    now=now,
                )
            if safe_event_request is None:
                return self._apply_identity_mismatch(
                    snapshot,
                    event,
                    "callback provider request identity is not opaque",
                    now=now,
                )
            provider_job_id = snapshot.provider_job_id or attempt.provider_job_id or safe_event_job
            provider_request_id = snapshot.provider_request_id or safe_event_request
            # Remote accept may race ahead of local WAITING_REMOTE persistence.
            if attempt.state == "SUBMITTING":
                attempt = transition_attempt(
                    attempt,
                    "WAITING_REMOTE",
                    now=now,
                    evidence=TransitionEvidence(provider_job_id=provider_job_id),
                )
            # Cancel-vs-completion race: success while CANCEL_REQUESTED finalizes SUCCEEDED.
            attempt = transition_attempt(
                attempt,
                "SUCCEEDED",
                now=now,
                evidence=TransitionEvidence(
                    provider_job_id=provider_job_id,
                    output_version_id=output_version_id,
                ),
            )
            node = transition_node(
                snapshot.node,
                "SUCCEEDED",
                now=now,
                evidence=TransitionEvidence(output_version_id=output_version_id),
            )
            updated = replace(
                snapshot,
                node=node,
                attempt=attempt,
                provider_job_id=provider_job_id,
                provider_request_id=provider_request_id,
                applied_event_ids=applied_ids,
                latest_event_seq=event.event_seq,
                output_version_id=output_version_id,
                result=handle,
                finalized_outputs=snapshot.finalized_outputs + 1,
                last_error=None,
                last_callback_disposition="APPLIED",
            )
            self._snapshot = updated
            return MediaCallbackApplication(snapshot=updated, disposition="APPLIED")

        if event.status == "CANCELLED":
            if snapshot.attempt.state not in {"CANCEL_REQUESTED", "WAITING_REMOTE"}:
                updated = replace(snapshot, last_callback_disposition="STALE_IGNORED")
                self._snapshot = updated
                return MediaCallbackApplication(snapshot=updated, disposition="STALE_IGNORED")
            source_attempt = snapshot.attempt
            if source_attempt.state == "WAITING_REMOTE":
                source_attempt = transition_attempt(source_attempt, "CANCEL_REQUESTED", now=now)
            attempt = transition_attempt(source_attempt, "CANCELLED", now=now)
            node = snapshot.node
            if node.state not in {"CANCEL_REQUESTED", "CANCELLED"}:
                node = transition_node(node, "CANCEL_REQUESTED", now=now)
            if node.state == "CANCEL_REQUESTED":
                node = transition_node(node, "CANCELLED", now=now)
            updated = replace(
                snapshot,
                node=node,
                attempt=attempt,
                applied_event_ids=applied_ids,
                latest_event_seq=event.event_seq,
                last_error=None,
                last_callback_disposition="APPLIED",
            )
            self._snapshot = updated
            return MediaCallbackApplication(snapshot=updated, disposition="APPLIED")

        if event.error is None:
            raise ProviderProtocolError("failed callback requires an error")
        return self._apply_terminal_failure(
            snapshot,
            sanitize_provider_failure_error(event.error),
            now=now,
            applied_event_ids=applied_ids,
            event_seq=event.event_seq,
        )

    def can_open_local_retry(self) -> bool:
        snapshot = self._snapshot
        if snapshot.attempt.state != "FAILED":
            return False
        if snapshot.node.state != "FAILED":
            return False
        if snapshot.last_error is None or not snapshot.last_error.retryable:
            return False
        if snapshot.node.attempt_count >= snapshot.node.max_attempts:
            return False
        disposition = snapshot.attempt.retry_disposition
        return disposition in {"SAFE_LOCAL_RETRY", "PROVIDER_CONFIRMED_NOT_ACCEPTED"}

    def open_local_retry(
        self,
        *,
        now: datetime,
        next_attempt: TaskAttempt,
    ) -> MediaHarnessSnapshot:
        if not self.can_open_local_retry():
            raise InvalidTaskTransitionError("local retry is not permitted for this media attempt")
        if next_attempt.attempt_number != self._snapshot.attempt.attempt_number + 1:
            raise InvalidTaskTransitionError("retry attempt number must advance by one")
        if next_attempt.request_fingerprint != self._snapshot.attempt.request_fingerprint:
            raise InvalidTaskTransitionError("retry must preserve the request fingerprint")
        if next_attempt.execution_mode != "remote":
            raise InvalidTaskTransitionError("media retry remains remote")
        node = transition_node(
            self._snapshot.node,
            "PENDING",
            now=now,
            evidence=TransitionEvidence(retry_disposition=self._snapshot.attempt.retry_disposition),
        )
        node = transition_node(
            node,
            "RUNNING",
            now=now,
            evidence=TransitionEvidence(attempt_id=next_attempt.id),
        )
        leased = transition_attempt(next_attempt, "LEASED", now=now)
        running_attempt = transition_attempt(leased, "RUNNING", now=now)
        self._snapshot = MediaHarnessSnapshot(
            node=node,
            attempt=running_attempt,
            request=self._snapshot.request,
            submit_count=self._snapshot.submit_count,
        )
        return self._snapshot

    def recovery_action(self) -> str:
        return recovery_action_for_attempt(self._snapshot.attempt)

    def public_error_code(self) -> str | None:
        if self._snapshot.last_error is None:
            return None
        return public_provider_error_code(self._snapshot.last_error.code)

    def _apply_identity_mismatch(
        self,
        snapshot: MediaHarnessSnapshot,
        event: MediaCallbackEvent,
        mismatch: str,
        *,
        now: datetime,
    ) -> MediaCallbackApplication:
        applied_ids = frozenset({*snapshot.applied_event_ids, event.event_id})
        if snapshot.attempt.state not in _CALLBACK_ACTIVE_STATES:
            # Dedupe redelivery only; do not advance seq watermark on reject.
            updated = replace(
                snapshot,
                applied_event_ids=applied_ids,
                last_callback_disposition="REJECTED_MISMATCH",
            )
            self._snapshot = updated
            return MediaCallbackApplication(snapshot=updated, disposition="REJECTED_MISMATCH")

        attempt = transition_attempt(
            snapshot.attempt,
            "REMOTE_UNKNOWN",
            now=now,
            evidence=TransitionEvidence(retry_disposition="REMOTE_UNKNOWN"),
        )
        node = (
            snapshot.node
            if snapshot.node.state == "RECONCILIATION_REQUIRED"
            else transition_node(
                snapshot.node,
                "RECONCILIATION_REQUIRED",
                now=now,
                evidence=TransitionEvidence(retry_disposition="REMOTE_UNKNOWN"),
            )
        )
        updated = replace(
            snapshot,
            node=node,
            attempt=attempt,
            applied_event_ids=applied_ids,
            latest_event_seq=event.event_seq,
            last_callback_disposition="QUARANTINED_MISMATCH",
            last_error=ProviderFailureError(
                code="PROTOCOL_ERROR",
                message=mismatch,
                retryable=False,
                provider_request_id=snapshot.provider_request_id,
                details={"source": "media_callback_mismatch"},
            ),
        )
        self._snapshot = updated
        return MediaCallbackApplication(snapshot=updated, disposition="QUARANTINED_MISMATCH")

    def _apply_terminal_failure(
        self,
        snapshot: MediaHarnessSnapshot,
        error: ProviderFailureError,
        *,
        now: datetime,
        applied_event_ids: frozenset[str],
        event_seq: int,
    ) -> MediaCallbackApplication:
        # Post-accept callback failures must not open SAFE_LOCAL_RETRY resubmits.
        disposition = retry_disposition_for_callback_failure(error)
        safe_error = sanitize_provider_failure_error(error)
        attempt = transition_attempt(
            snapshot.attempt,
            "FAILED",
            now=now,
            evidence=TransitionEvidence(retry_disposition=disposition),
        )
        node = transition_node(
            snapshot.node,
            "FAILED",
            now=now,
            evidence=TransitionEvidence(retry_disposition=disposition),
        )
        updated = replace(
            snapshot,
            node=node,
            attempt=attempt,
            applied_event_ids=applied_event_ids,
            latest_event_seq=event_seq,
            last_error=safe_error,
            last_callback_disposition="APPLIED",
        )
        self._snapshot = updated
        return MediaCallbackApplication(snapshot=updated, disposition="APPLIED")


def build_remote_media_attempt(
    *,
    node: NodeRun,
    attempt_id: str,
    request: MediaProviderRequest,
    now: datetime,
    capabilities: ProviderCapabilities | None = None,
) -> tuple[NodeRun, TaskAttempt]:
    """Create a remote attempt bound to a RUNNING node for the media harness."""

    if node.state != "PENDING":
        raise InvalidTaskTransitionError("remote media attempt requires a PENDING node")
    fingerprint = media_request_fingerprint(request)
    attempt = TaskAttempt(
        id=attempt_id,
        node_run_id=node.id,
        attempt_number=node.attempt_count + 1,
        execution_mode="remote",
        state="READY",
        input_fingerprint=node.input_fingerprint,
        request_fingerprint=fingerprint,
        provider_account_id=request.provider_account_id,
        provider_idempotency_key=request.idempotency_key,
        provider_capabilities=capabilities
        or ProviderCapabilities(
            supports_idempotency_key=True,
            supports_lookup_by_client_request_id=True,
        ),
        provider_job_id=None,
        dispatch_started_at=None,
        retry_disposition=None,
        output_version_id=None,
        revision=1,
        created_at=now,
        updated_at=now,
    )
    running_node = transition_node(
        node,
        "RUNNING",
        now=now,
        evidence=TransitionEvidence(attempt_id=attempt_id),
    )
    leased = transition_attempt(attempt, "LEASED", now=now)
    running_attempt = transition_attempt(leased, "RUNNING", now=now)
    return running_node, running_attempt
