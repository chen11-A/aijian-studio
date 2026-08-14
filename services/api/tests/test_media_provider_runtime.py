from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from aijian_api.fake_media_provider import (
    FAKE_HTTP_429_RETRY_AFTER_SECONDS,
    FAKE_MEDIA_AUTH_HEADER_SENTINEL,
    FAKE_MEDIA_SECRET_SENTINEL,
    FAKE_MEDIA_SIGNED_URL_SENTINEL,
    FakeAsyncMediaProvider,
)
from aijian_api.media_provider_runtime import (
    AsyncMediaAttemptHarness,
    MediaCallbackEvent,
    MediaProviderRequest,
    MediaResultHandle,
    MediaSubmitAccepted,
    MediaSubmitFailure,
    ResultUrlExpiryPolicy,
    build_remote_media_attempt,
    materialize_result_handle,
    media_operation_for_capability,
    media_request_fingerprint,
    raise_for_submit_failure,
    retry_disposition_for_callback_failure,
    retry_disposition_for_failure,
    sanitize_provider_failure_error,
)
from aijian_api.provider_runtime import (
    ProviderFailureError,
    ProviderNonRetryableError,
    ProviderRetryableError,
    RemoteUnknownProviderError,
)
from aijian_api.workflow_tasks import (
    InvalidTaskTransitionError,
    NodeRun,
    ProviderCapabilities,
    TaskAttempt,
    recovery_action_for_attempt,
)
from pydantic import ValidationError
from test_fake_media_provider import media_request, media_request_payload

NOW = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)
HASH_A = f"sha256:{'c' * 64}"
CAPABILITIES = ("IMAGE", "VIDEO", "SPEECH")


def pending_node(*, max_attempts: int = 3) -> NodeRun:
    return NodeRun(
        id="node_media_1",
        workflow_run_id="wfr_media_1",
        node_key="media.generate",
        node_type="media.generate",
        state="PENDING",
        input_fingerprint=HASH_A,
        idempotency_key="media:generate:1",
        attempt_count=0,
        max_attempts=max_attempts,
        active_attempt_id=None,
        output_version_id=None,
        revision=1,
        created_at=NOW,
        updated_at=NOW,
    )


def harness_for(
    request: MediaProviderRequest,
    *,
    max_attempts: int = 3,
    attempt_id: str = "att_media_1",
) -> AsyncMediaAttemptHarness:
    node, attempt = build_remote_media_attempt(
        node=pending_node(max_attempts=max_attempts),
        attempt_id=attempt_id,
        request=request,
        now=NOW,
        capabilities=ProviderCapabilities(True, True),
    )
    return AsyncMediaAttemptHarness(node=node, attempt=attempt, request=request)


def assert_no_secret_leak(payload: object) -> None:
    serialized = json.dumps(
        payload if isinstance(payload, dict) else payload,  # type: ignore[arg-type]
        default=str,
        ensure_ascii=False,
    )
    for sentinel in (
        FAKE_MEDIA_SECRET_SENTINEL,
        FAKE_MEDIA_SIGNED_URL_SENTINEL,
        FAKE_MEDIA_AUTH_HEADER_SENTINEL,
    ):
        assert sentinel not in serialized


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_successful_submit_enters_waiting_remote_protocol(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"ok-{capability}")
    provider = FakeAsyncMediaProvider(
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
    )
    harness = harness_for(request)
    expected_fingerprint = media_request_fingerprint(request)
    accepted = provider.submit(request)
    snapshot = harness.apply_submit_result(accepted, now=NOW)

    assert snapshot.attempt.state == "WAITING_REMOTE"
    assert snapshot.attempt.provider_job_id == accepted.provider_job_id  # type: ignore[union-attr]
    assert snapshot.attempt.dispatch_started_at == NOW
    assert snapshot.provider_request_id == accepted.provider_request_id  # type: ignore[union-attr]
    assert snapshot.submit_count == 1
    assert snapshot.attempt.request_fingerprint == expected_fingerprint
    assert snapshot.attempt.provider_idempotency_key == request.idempotency_key
    assert snapshot.attempt.provider_capabilities == ProviderCapabilities(True, True)
    assert_no_secret_leak(accepted.model_dump(mode="json"))


@pytest.mark.parametrize(
    ("fault", "code", "retryable", "disposition", "attempt_state", "node_state"),
    [
        ("http_401", "AUTH_ERROR", False, "NON_RETRYABLE", "FAILED", "FAILED"),
        ("http_429", "RATE_LIMITED", True, "SAFE_LOCAL_RETRY", "FAILED", "FAILED"),
        ("http_500", "REMOTE_UNAVAILABLE", True, "SAFE_LOCAL_RETRY", "FAILED", "FAILED"),
        ("http_502", "REMOTE_UNAVAILABLE", True, "SAFE_LOCAL_RETRY", "FAILED", "FAILED"),
        ("http_503", "REMOTE_UNAVAILABLE", True, "SAFE_LOCAL_RETRY", "FAILED", "FAILED"),
        ("http_504", "REMOTE_UNAVAILABLE", True, "SAFE_LOCAL_RETRY", "FAILED", "FAILED"),
        ("moderation", "REFUSED", False, "NON_RETRYABLE", "FAILED", "FAILED"),
        (
            "dispatch_ambiguous",
            "REMOTE_UNKNOWN",
            False,
            "REMOTE_UNKNOWN",
            "REMOTE_UNKNOWN",
            "RECONCILIATION_REQUIRED",
        ),
    ],
)
@pytest.mark.parametrize("capability", CAPABILITIES)
def test_submit_fault_matrix_through_harness(
    fault: str,
    code: str,
    retryable: bool,
    disposition: str,
    attempt_state: str,
    node_state: str,
    capability: str,
) -> None:
    request = media_request(capability=capability, idempotency_key=f"{capability}-{fault}")
    provider = FakeAsyncMediaProvider(
        submit_fault=fault,  # type: ignore[arg-type]
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
    )
    harness = harness_for(request)
    result = provider.submit(request)
    snapshot = harness.apply_submit_result(result, now=NOW)

    assert snapshot.attempt.state == attempt_state
    assert snapshot.node.state == node_state
    assert snapshot.last_error is not None
    assert snapshot.last_error.code == code
    assert snapshot.last_error.retryable is retryable
    assert snapshot.attempt.retry_disposition == disposition
    assert snapshot.finalized_outputs == 0
    if fault == "http_429":
        assert snapshot.last_error.retry_after_seconds == FAKE_HTTP_429_RETRY_AFTER_SECONDS
    if fault == "dispatch_ambiguous":
        assert not harness.can_open_local_retry()
        assert recovery_action_for_attempt(snapshot.attempt) == "RECONCILE"
    assert_no_secret_leak(result.model_dump(mode="json"))
    assert_no_secret_leak(snapshot.last_error.model_dump(mode="json"))


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_duplicate_callback_is_idempotent(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"dup-{capability}")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    accepted = provider.submit(request)
    harness.apply_submit_result(accepted, now=NOW)
    event = provider.build_callback(request, now=NOW, outcome="succeeded")

    first = harness.apply_callback(event, now=NOW, output_version_id="ver_media_1")
    second = harness.apply_callback(event, now=NOW, output_version_id="ver_media_1")

    assert first.disposition == "APPLIED"
    assert second.disposition == "DUPLICATE_IGNORED"
    assert first.snapshot.finalized_outputs == 1
    assert second.snapshot.finalized_outputs == 1
    assert second.snapshot.attempt.state == "SUCCEEDED"
    assert second.snapshot.node.state == "SUCCEEDED"


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_stale_callback_cannot_regress_terminal_state(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"stale-{capability}")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    success = provider.build_callback(request, now=NOW, outcome="succeeded")
    harness.apply_callback(success, now=NOW, output_version_id="ver_media_1")

    stale_failure = provider.build_callback(
        request,
        now=NOW,
        outcome="failed",
        event_id_suffix="stale",
        force_event_seq=0,
    )
    applied = harness.apply_callback(stale_failure, now=NOW)

    assert applied.disposition == "STALE_IGNORED"
    assert applied.snapshot.attempt.state == "SUCCEEDED"
    assert applied.snapshot.finalized_outputs == 1


@pytest.mark.parametrize("capability", CAPABILITIES)
@pytest.mark.parametrize(
    "mismatch_kind",
    ["provider_job_id", "provider_account_id", "provider_request_id", "request_id"],
)
def test_wrong_identity_callback_is_quarantined(capability: str, mismatch_kind: str) -> None:
    request = media_request(
        capability=capability,
        idempotency_key=f"mismatch-{capability}-{mismatch_kind}",
    )
    provider = FakeAsyncMediaProvider(
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
    )
    harness = harness_for(request, attempt_id=f"att_{capability}_{mismatch_kind}")
    harness.apply_submit_result(provider.submit(request), now=NOW)

    overrides: dict[str, object] = {"event_id_suffix": mismatch_kind}
    if mismatch_kind == "provider_job_id":
        overrides["provider_job_id"] = "mjob_not_the_real_job"
    elif mismatch_kind == "provider_account_id":
        overrides["provider_account_id"] = "acct_other"
    elif mismatch_kind == "provider_request_id":
        overrides["provider_request_id"] = "mreq_not_the_real_request"
    else:
        overrides["request_id_override"] = UUID("33333333-3333-3333-3333-333333333333")

    wrong = provider.build_callback(request, now=NOW, outcome="succeeded", **overrides)  # type: ignore[arg-type]
    first = harness.apply_callback(wrong, now=NOW, output_version_id="ver_x")
    assert first.disposition == "QUARANTINED_MISMATCH"
    assert first.snapshot.attempt.state == "REMOTE_UNKNOWN"
    assert first.snapshot.node.state == "RECONCILIATION_REQUIRED"
    assert first.snapshot.finalized_outputs == 0
    assert wrong.event_id in first.snapshot.applied_event_ids
    assert_no_secret_leak(
        first.snapshot.last_error.model_dump(mode="json") if first.snapshot.last_error else {}
    )

    second = harness.apply_callback(wrong, now=NOW, output_version_id="ver_x")
    assert second.disposition == "DUPLICATE_IGNORED"
    assert second.snapshot.attempt.state == "REMOTE_UNKNOWN"
    assert second.snapshot.finalized_outputs == 0


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_cancel_vs_completion_race_prefers_completion(capability: str) -> None:
    """Documented policy: success callback while CANCEL_REQUESTED finalizes SUCCEEDED."""

    request = media_request(capability=capability, idempotency_key=f"race-{capability}")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    harness.request_cancel(now=NOW)
    assert harness.snapshot.attempt.state == "CANCEL_REQUESTED"

    event = provider.build_callback(request, now=NOW, outcome="succeeded")
    applied = harness.apply_callback(event, now=NOW, output_version_id="ver_media_race")

    assert applied.disposition == "APPLIED"
    assert applied.snapshot.attempt.state == "SUCCEEDED"
    assert applied.snapshot.node.state == "SUCCEEDED"
    assert applied.snapshot.finalized_outputs == 1


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_cancel_ack_after_request_cancels_deterministically(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"cancel-{capability}")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    harness.request_cancel(now=NOW)
    event = provider.build_callback(request, now=NOW, outcome="cancelled")
    applied = harness.apply_callback(event, now=NOW)

    assert applied.disposition == "APPLIED"
    assert applied.snapshot.attempt.state == "CANCELLED"
    assert applied.snapshot.node.state == "CANCELLED"
    assert applied.snapshot.finalized_outputs == 0


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_result_url_expiry_fails_without_regeneration_or_url_leak(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"expire-{capability}")
    provider = FakeAsyncMediaProvider(
        signed_result_url=FAKE_MEDIA_SIGNED_URL_SENTINEL,
        authorization_header=FAKE_MEDIA_AUTH_HEADER_SENTINEL,
    )
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    event = provider.build_callback(request, now=NOW, outcome="expired_result")
    applied = harness.apply_callback(event, now=NOW, output_version_id="ver_should_not_commit")

    assert applied.disposition == "APPLIED"
    assert applied.snapshot.attempt.state == "FAILED"
    assert applied.snapshot.last_error is not None
    assert applied.snapshot.last_error.code == "RESULT_EXPIRED"
    assert applied.snapshot.last_error.retryable is False
    assert applied.snapshot.finalized_outputs == 0
    assert applied.snapshot.result is None
    assert_no_secret_leak(event.model_dump(mode="json"))
    assert_no_secret_leak(applied.snapshot.last_error.model_dump(mode="json"))
    policy = ResultUrlExpiryPolicy()
    assert policy.allow_auto_regenerate is False
    assert policy.allow_silent_redownload is False
    assert policy.allow_log_signed_url is False


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_dispatch_ambiguous_never_auto_resubmits(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"ambig-{capability}")
    provider = FakeAsyncMediaProvider(submit_fault="dispatch_ambiguous")
    harness = harness_for(request)
    failure = provider.submit(request)
    harness.apply_submit_result(failure, now=NOW)

    assert harness.snapshot.attempt.state == "REMOTE_UNKNOWN"
    assert harness.can_open_local_retry() is False
    with pytest.raises(InvalidTaskTransitionError, match="local retry is not permitted"):
        next_attempt = TaskAttempt(
            id="att_media_retry",
            node_run_id=harness.snapshot.node.id,
            attempt_number=2,
            execution_mode="remote",
            state="READY",
            input_fingerprint=HASH_A,
            request_fingerprint=media_request_fingerprint(request),
            provider_account_id=request.provider_account_id,
            provider_idempotency_key=request.idempotency_key,
            provider_capabilities=ProviderCapabilities(True, True),
            provider_job_id=None,
            dispatch_started_at=None,
            retry_disposition=None,
            output_version_id=None,
            revision=1,
            created_at=NOW,
            updated_at=NOW,
        )
        harness.open_local_retry(now=NOW, next_attempt=next_attempt)
    assert provider.submit_count_for(request) == 1


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_rate_limit_retry_exhausts_without_duplicate_finalization(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"retry-{capability}")
    provider = FakeAsyncMediaProvider(submit_fault="http_429")
    harness = harness_for(request, max_attempts=2)

    first_failure = provider.submit(request)
    harness.apply_submit_result(first_failure, now=NOW)
    assert harness.can_open_local_retry() is True

    next_attempt = TaskAttempt(
        id="att_media_2",
        node_run_id=harness.snapshot.node.id,
        attempt_number=2,
        execution_mode="remote",
        state="READY",
        input_fingerprint=HASH_A,
        request_fingerprint=media_request_fingerprint(request),
        provider_account_id=request.provider_account_id,
        provider_idempotency_key=request.idempotency_key,
        provider_capabilities=ProviderCapabilities(True, True),
        provider_job_id=None,
        dispatch_started_at=None,
        retry_disposition=None,
        output_version_id=None,
        revision=1,
        created_at=NOW,
        updated_at=NOW,
    )
    harness.open_local_retry(now=NOW + timedelta(seconds=1), next_attempt=next_attempt)
    second_failure = provider.submit(request)
    harness.apply_submit_result(second_failure, now=NOW + timedelta(seconds=2))

    assert harness.snapshot.node.attempt_count == 2
    assert harness.snapshot.attempt.state == "FAILED"
    assert harness.can_open_local_retry() is False
    assert harness.snapshot.finalized_outputs == 0
    assert provider.submit_count_for(request) == 2
    assert harness.snapshot.last_error is not None
    assert harness.snapshot.last_error.code == "RATE_LIMITED"


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_raise_for_submit_failure_maps_runtime_exceptions(capability: str) -> None:
    request = media_request(capability=capability)
    provider = FakeAsyncMediaProvider(submit_fault="http_401")
    failure = provider.submit(request)
    assert isinstance(failure, MediaSubmitFailure)
    with pytest.raises(ProviderNonRetryableError) as non_retryable:
        raise_for_submit_failure(failure)
    assert non_retryable.value.code == "AUTH_ERROR"

    provider = FakeAsyncMediaProvider(submit_fault="http_429")
    failure = provider.submit(request)
    assert isinstance(failure, MediaSubmitFailure)
    with pytest.raises(ProviderRetryableError) as retryable:
        raise_for_submit_failure(failure)
    assert retryable.value.code == "RATE_LIMITED"
    assert retryable.value.retry_after_seconds == FAKE_HTTP_429_RETRY_AFTER_SECONDS

    provider = FakeAsyncMediaProvider(submit_fault="dispatch_ambiguous")
    failure = provider.submit(request)
    assert isinstance(failure, MediaSubmitFailure)
    with pytest.raises(RemoteUnknownProviderError):
        raise_for_submit_failure(failure)


def test_materialize_result_handle_expiry_policy() -> None:
    handle = MediaResultHandle(
        asset_ref="fake_media_abc",
        content_hash=f"sha256:{'d' * 64}",
        expires_at=NOW - timedelta(seconds=1),
        media_kind="IMAGE",
    )
    with pytest.raises(ProviderNonRetryableError) as error:
        materialize_result_handle(handle, now=NOW)
    assert error.value.code == "RESULT_EXPIRED"
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in str(error.value)

    live = handle.model_copy(update={"expires_at": NOW + timedelta(hours=1)})
    assert materialize_result_handle(live, now=NOW) == live


def test_result_expired_failure_error_is_non_retryable() -> None:
    with pytest.raises(ValidationError, match="RESULT_EXPIRED must never be marked retryable"):
        ProviderFailureError(
            code="RESULT_EXPIRED",
            message="expired",
            retryable=True,
        )
    assert (
        retry_disposition_for_failure(
            ProviderFailureError(code="RESULT_EXPIRED", message="expired", retryable=False)
        )
        == "NON_RETRYABLE"
    )


def test_media_request_fingerprint_is_stable() -> None:
    payload = media_request_payload()
    first = media_request_fingerprint(MediaProviderRequest.model_validate(payload))
    second = media_request_fingerprint(MediaProviderRequest.model_validate(payload))
    assert first == second
    assert first.startswith("sha256:")


def test_callback_event_validation_rules() -> None:
    base = {
        "event_id": "evt_1",
        "event_seq": 1,
        "provider_job_id": "mjob_1",
        "provider_request_id": "mreq_1",
        "provider_account_id": "acct_1",
        "request_id": "22222222-2222-2222-2222-222222222222",
        "observed_at": NOW.isoformat(),
    }
    with pytest.raises(ValidationError, match="requires a result handle"):
        MediaCallbackEvent.model_validate({**base, "status": "SUCCEEDED"})
    with pytest.raises(ValidationError, match="requires an error"):
        MediaCallbackEvent.model_validate({**base, "status": "FAILED"})


def test_moderation_does_not_invent_usage() -> None:
    provider = FakeAsyncMediaProvider(submit_fault="moderation")
    failure = provider.submit(media_request())
    assert isinstance(failure, MediaSubmitFailure)
    assert failure.usage is None
    assert failure.error.code == "REFUSED"


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_operation_capability_matrix(capability: str) -> None:
    operation = media_operation_for_capability(capability)  # type: ignore[arg-type]
    request = MediaProviderRequest.model_validate(
        media_request_payload(capability=capability, idempotency_key=capability)
    )
    assert request.operation == operation
    assert request.capability == capability


def test_out_of_order_callback_seq_is_ignored_while_waiting() -> None:
    request = media_request(idempotency_key="order-1")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    newer = provider.build_callback(
        request,
        now=NOW,
        outcome="failed",
        force_event_seq=5,
        event_id_suffix="new",
    )
    harness.apply_callback(newer, now=NOW)
    assert harness.snapshot.attempt.state == "FAILED"

    older_success = provider.build_callback(
        request,
        now=NOW,
        outcome="succeeded",
        force_event_seq=1,
        event_id_suffix="old",
    )
    applied = harness.apply_callback(older_success, now=NOW, output_version_id="ver_old")
    assert applied.disposition == "STALE_IGNORED"
    assert applied.snapshot.attempt.state == "FAILED"
    assert applied.snapshot.finalized_outputs == 0


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_success_callback_during_submitting_promotes_then_succeeds(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"submit-race-{capability}")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    accepted = provider.submit(request)
    assert isinstance(accepted, MediaSubmitAccepted)
    harness.begin_submission(now=NOW)
    assert harness.snapshot.attempt.state == "SUBMITTING"

    event = provider.build_callback(request, now=NOW, outcome="succeeded")
    applied = harness.apply_callback(event, now=NOW, output_version_id="ver_submit_race")

    assert applied.disposition == "APPLIED"
    assert applied.snapshot.attempt.state == "SUCCEEDED"
    assert applied.snapshot.node.state == "SUCCEEDED"
    assert applied.snapshot.provider_job_id == accepted.provider_job_id
    assert applied.snapshot.provider_request_id == accepted.provider_request_id
    assert applied.snapshot.finalized_outputs == 1


@pytest.mark.parametrize("capability", CAPABILITIES)
def test_post_accept_callback_failure_does_not_open_local_retry(capability: str) -> None:
    request = media_request(capability=capability, idempotency_key=f"cb-fail-{capability}")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    event = MediaCallbackEvent(
        event_id=f"evt_retryable_{capability}",
        event_seq=1,
        provider_job_id=harness.snapshot.provider_job_id or "",
        provider_request_id=harness.snapshot.provider_request_id or "",
        provider_account_id=request.provider_account_id,
        request_id=request.request_id,
        status="FAILED",
        error=ProviderFailureError(
            code="RATE_LIMITED",
            message="upstream rate limited after accept",
            retryable=True,
            http_status=429,
            retry_after_seconds=2,
            details={"source": "adversarial_callback"},
        ),
        observed_at=NOW,
    )
    applied = harness.apply_callback(event, now=NOW)

    assert applied.disposition == "APPLIED"
    assert applied.snapshot.attempt.state == "FAILED"
    assert applied.snapshot.attempt.retry_disposition == "NON_RETRYABLE"
    assert applied.snapshot.last_error is not None
    assert applied.snapshot.last_error.retryable is True
    assert harness.can_open_local_retry() is False


def test_adversarial_callback_error_payload_is_sanitized() -> None:
    request = media_request(idempotency_key="sanitize-1")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    adversarial_request_id = FAKE_MEDIA_SIGNED_URL_SENTINEL
    event = MediaCallbackEvent(
        event_id="evt_adversarial",
        event_seq=1,
        provider_job_id=harness.snapshot.provider_job_id or "",
        provider_request_id=harness.snapshot.provider_request_id or "",
        provider_account_id=request.provider_account_id,
        request_id=request.request_id,
        status="FAILED",
        error=ProviderFailureError(
            code="REFUSED",
            message=(
                f"rejected body Authorization {FAKE_MEDIA_AUTH_HEADER_SENTINEL} "
                f"url={FAKE_MEDIA_SIGNED_URL_SENTINEL} key={FAKE_MEDIA_SECRET_SENTINEL} "
                f"token=sig-leak api_key=leaked s3://bucket/object?token=abc"
            ),
            retryable=False,
            provider_request_id=adversarial_request_id,
            details={
                "source": "provider",
                "raw_body": FAKE_MEDIA_SIGNED_URL_SENTINEL,
                "Authorization": FAKE_MEDIA_AUTH_HEADER_SENTINEL,
            },
        ),
        observed_at=NOW,
    )
    applied = harness.apply_callback(event, now=NOW)
    assert applied.snapshot.last_error is not None
    dumped = applied.snapshot.last_error.model_dump(mode="json")
    assert_no_secret_leak(dumped)
    assert dumped.get("provider_request_id") is None
    assert adversarial_request_id not in json.dumps(dumped, ensure_ascii=False)
    assert "Authorization" not in dumped["details"]
    assert "raw_body" not in dumped["details"]
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in dumped["message"]
    assert "token=sig-leak" not in dumped["message"]
    assert "api_key=leaked" not in dumped["message"]
    assert "s3://bucket" not in dumped["message"]


def test_success_callback_rejects_url_shaped_provider_identity() -> None:
    request = media_request(idempotency_key="opaque-id-1")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.begin_submission(now=NOW)
    assert harness.snapshot.attempt.state == "SUBMITTING"

    # Build a structurally valid success payload, then replace identity with signed URLs.
    provider.submit(request)
    base = provider.build_callback(request, now=NOW, outcome="succeeded")
    assert base.result is not None
    adversarial = base.model_copy(
        update={
            "provider_job_id": FAKE_MEDIA_SIGNED_URL_SENTINEL,
            "provider_request_id": FAKE_MEDIA_SIGNED_URL_SENTINEL,
            "event_id": "evt_url_identity",
            "event_seq": 1,
        }
    )
    applied = harness.apply_callback(adversarial, now=NOW, output_version_id="ver_should_not")
    assert applied.disposition == "QUARANTINED_MISMATCH"
    assert applied.snapshot.attempt.state == "REMOTE_UNKNOWN"
    assert applied.snapshot.finalized_outputs == 0
    assert applied.snapshot.provider_job_id is None
    assert applied.snapshot.provider_request_id is None
    dump = {
        "provider_job_id": applied.snapshot.provider_job_id,
        "provider_request_id": applied.snapshot.provider_request_id,
        "attempt_job": applied.snapshot.attempt.provider_job_id,
        "last_error": (
            applied.snapshot.last_error.model_dump(mode="json")
            if applied.snapshot.last_error is not None
            else None
        ),
    }
    assert_no_secret_leak(dump)
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in json.dumps(dump, default=str)


def test_rejected_mismatch_does_not_poison_event_seq_watermark() -> None:
    """High-seq REJECTED_MISMATCH must not block a later legitimate low-seq success."""

    request = media_request(idempotency_key="reject-seq-1")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    assert harness.snapshot.attempt.state == "RUNNING"

    poison = MediaCallbackEvent(
        event_id="evt_poison_high_seq",
        event_seq=99,
        provider_job_id="mjob_foreign",
        provider_request_id="mreq_foreign",
        provider_account_id="acct_other",
        request_id=UUID("33333333-3333-3333-3333-333333333333"),
        status="FAILED",
        error=ProviderFailureError(
            code="REFUSED",
            message="foreign callback",
            retryable=False,
        ),
        observed_at=NOW,
    )
    rejected = harness.apply_callback(poison, now=NOW)
    assert rejected.disposition == "REJECTED_MISMATCH"
    assert poison.event_id in rejected.snapshot.applied_event_ids
    assert rejected.snapshot.latest_event_seq is None
    assert rejected.snapshot.attempt.state == "RUNNING"

    accepted = provider.submit(request)
    harness.apply_submit_result(accepted, now=NOW)
    success = provider.build_callback(
        request,
        now=NOW,
        outcome="succeeded",
        force_event_seq=1,
        event_id_suffix="legit",
    )
    applied = harness.apply_callback(success, now=NOW, output_version_id="ver_after_reject")
    assert applied.disposition == "APPLIED"
    assert applied.snapshot.attempt.state == "SUCCEEDED"
    assert applied.snapshot.finalized_outputs == 1
    assert applied.snapshot.latest_event_seq == 1

    # Same mismatched event remains deduped without needing a seq watermark.
    again = harness.apply_callback(poison, now=NOW)
    assert again.disposition == "DUPLICATE_IGNORED"


def test_media_kind_mismatch_is_quarantined() -> None:
    request = media_request(capability="IMAGE", idempotency_key="kind-mismatch")
    provider = FakeAsyncMediaProvider()
    harness = harness_for(request)
    harness.apply_submit_result(provider.submit(request), now=NOW)
    event = provider.build_callback(request, now=NOW, outcome="succeeded")
    assert event.result is not None
    wrong_kind = event.model_copy(
        update={"result": event.result.model_copy(update={"media_kind": "VIDEO"})}
    )
    applied = harness.apply_callback(wrong_kind, now=NOW, output_version_id="ver_kind")
    assert applied.disposition == "QUARANTINED_MISMATCH"
    assert applied.snapshot.attempt.state == "REMOTE_UNKNOWN"
    assert applied.snapshot.finalized_outputs == 0


def test_url_shaped_asset_ref_is_rejected() -> None:
    with pytest.raises(ValidationError, match="opaque identifier"):
        MediaResultHandle(
            asset_ref=FAKE_MEDIA_SIGNED_URL_SENTINEL,
            content_hash=f"sha256:{'e' * 64}",
            media_kind="IMAGE",
        )


def test_callback_failure_disposition_never_safe_local_retry() -> None:
    retryable = ProviderFailureError(
        code="REMOTE_UNAVAILABLE",
        message="upstream blip",
        retryable=True,
        http_status=503,
    )
    assert retry_disposition_for_failure(retryable) == "SAFE_LOCAL_RETRY"
    assert retry_disposition_for_callback_failure(retryable) == "NON_RETRYABLE"
    sanitized = sanitize_provider_failure_error(
        ProviderFailureError(
            code="REFUSED",
            message=f"see {FAKE_MEDIA_SIGNED_URL_SENTINEL}",
            retryable=False,
            details={"source": "x", "url": FAKE_MEDIA_SIGNED_URL_SENTINEL},
        )
    )
    assert FAKE_MEDIA_SIGNED_URL_SENTINEL not in sanitized.message
    assert "url" not in sanitized.details
