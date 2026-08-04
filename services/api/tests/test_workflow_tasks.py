from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from aijian_api.workflow_tasks import (
    ATTEMPT_STATES,
    NODE_STATES,
    AttemptState,
    ExecutionMode,
    InvalidTaskTransitionError,
    NodeRun,
    NodeState,
    ProviderCapabilities,
    RetryDisposition,
    TaskAttempt,
    TaskLease,
    TransitionEvidence,
    recovery_action_for_attempt,
    transition_attempt,
    transition_node,
)

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def node(
    *,
    state: NodeState = "PENDING",
    attempt_count: int = 0,
    max_attempts: int = 2,
    active_attempt_id: str | None = None,
    output_version_id: str | None = None,
) -> NodeRun:
    return NodeRun(
        id="node_render_preview",
        workflow_run_id="wfr_golden_short",
        node_key="render.preview",
        node_type="render.preview",
        state=state,
        input_fingerprint=HASH_A,
        idempotency_key="golden-short:render.preview:sha256-a",
        attempt_count=attempt_count,
        max_attempts=max_attempts,
        active_attempt_id=active_attempt_id,
        output_version_id=output_version_id,
        revision=1,
        created_at=NOW,
        updated_at=NOW,
    )


def attempt(
    *,
    mode: ExecutionMode = "local",
    state: AttemptState = "READY",
    provider_job_id: str | None = None,
    dispatch_started_at: datetime | None = None,
    retry_disposition: RetryDisposition | None = None,
    output_version_id: str | None = None,
    capabilities: ProviderCapabilities | None = None,
) -> TaskAttempt:
    return TaskAttempt(
        id="att_render_preview_1",
        node_run_id="node_render_preview",
        attempt_number=1,
        execution_mode=mode,
        state=state,
        input_fingerprint=HASH_A,
        request_fingerprint=HASH_B,
        provider_account_id="account-main" if mode == "remote" else None,
        provider_idempotency_key="idem-render-1" if mode == "remote" else None,
        provider_capabilities=capabilities,
        provider_job_id=provider_job_id,
        dispatch_started_at=dispatch_started_at,
        retry_disposition=retry_disposition,
        output_version_id=output_version_id,
        revision=1,
        created_at=NOW,
        updated_at=NOW,
    )


def test_node_and_attempt_state_contracts_are_separate() -> None:
    assert "REMOTE_UNKNOWN" not in NODE_STATES
    assert "RECONCILIATION_REQUIRED" not in ATTEMPT_STATES
    assert set(NODE_STATES) >= {"PENDING", "RUNNING", "NEEDS_REVIEW", "SUCCEEDED"}
    assert set(ATTEMPT_STATES) >= {"SUBMIT_INTENT", "SUBMITTING", "REMOTE_UNKNOWN"}


def test_node_binds_exactly_one_new_attempt_when_started() -> None:
    pending = node()

    running = transition_node(
        pending,
        "RUNNING",
        now=NOW,
        evidence=TransitionEvidence(attempt_id="att_render_preview_1"),
    )

    assert running.active_attempt_id == "att_render_preview_1"
    assert running.attempt_count == 1
    assert running.revision == 2
    assert pending.attempt_count == 0

    with pytest.raises(InvalidTaskTransitionError, match="bind an attempt"):
        transition_node(pending, "RUNNING", now=NOW)

    with pytest.raises(InvalidTaskTransitionError, match="attempts exhausted"):
        transition_node(
            replace(pending, attempt_count=2),
            "RUNNING",
            now=NOW,
            evidence=TransitionEvidence(attempt_id="att_render_preview_3"),
        )


def test_node_success_requires_committed_output_version() -> None:
    running = node(state="RUNNING", attempt_count=1, active_attempt_id="att_render_preview_1")

    with pytest.raises(InvalidTaskTransitionError, match="output version"):
        transition_node(running, "SUCCEEDED", now=NOW)

    succeeded = transition_node(
        running,
        "SUCCEEDED",
        now=NOW,
        evidence=TransitionEvidence(output_version_id="ver_preview_1"),
    )
    assert succeeded.output_version_id == "ver_preview_1"


def test_failed_node_retries_only_with_safe_evidence_and_capacity() -> None:
    failed = node(state="FAILED", attempt_count=1, active_attempt_id="att_render_preview_1")

    with pytest.raises(InvalidTaskTransitionError, match="safe retry"):
        transition_node(failed, "PENDING", now=NOW)

    pending = transition_node(
        failed,
        "PENDING",
        now=NOW,
        evidence=TransitionEvidence(retry_disposition="SAFE_LOCAL_RETRY"),
    )
    assert pending.attempt_count == 1

    with pytest.raises(InvalidTaskTransitionError, match="attempts exhausted"):
        transition_node(
            replace(failed, attempt_count=2),
            "PENDING",
            now=NOW,
            evidence=TransitionEvidence(retry_disposition="SAFE_LOCAL_RETRY"),
        )


def test_node_reconciliation_cannot_resume_without_explicit_evidence() -> None:
    quarantined = node(
        state="RECONCILIATION_REQUIRED",
        attempt_count=1,
        active_attempt_id="att_render_preview_1",
    )

    with pytest.raises(InvalidTaskTransitionError, match="reconciliation"):
        transition_node(quarantined, "RUNNING", now=NOW)

    running = transition_node(
        quarantined,
        "RUNNING",
        now=NOW,
        evidence=TransitionEvidence(reconciliation_confirmed=True),
    )
    assert running.attempt_count == 1
    assert running.active_attempt_id == "att_render_preview_1"


def test_node_rejects_transitions_not_in_its_business_state_machine() -> None:
    with pytest.raises(InvalidTaskTransitionError, match="node transition"):
        transition_node(node(), "SUCCEEDED", now=NOW)


def test_remote_attempt_persists_intent_and_dispatch_before_waiting() -> None:
    ready = attempt(mode="remote")
    leased = transition_attempt(ready, "LEASED", now=NOW)
    running = transition_attempt(leased, "RUNNING", now=NOW)
    intent = transition_attempt(running, "SUBMIT_INTENT", now=NOW)

    with pytest.raises(InvalidTaskTransitionError, match="dispatch start"):
        transition_attempt(intent, "SUBMITTING", now=NOW)

    submitting = transition_attempt(
        intent,
        "SUBMITTING",
        now=NOW,
        evidence=TransitionEvidence(dispatch_started_at=NOW),
    )
    with pytest.raises(InvalidTaskTransitionError, match="provider job id"):
        transition_attempt(submitting, "WAITING_REMOTE", now=NOW)

    waiting = transition_attempt(
        submitting,
        "WAITING_REMOTE",
        now=NOW,
        evidence=TransitionEvidence(provider_job_id="provider-job-42"),
    )
    assert waiting.dispatch_started_at == NOW
    assert waiting.provider_job_id == "provider-job-42"


@pytest.mark.parametrize("target", ["READY", "LEASED", "RUNNING", "SUBMIT_INTENT", "SUBMITTING"])
def test_remote_unknown_can_never_return_to_a_runnable_or_submit_state(
    target: AttemptState,
) -> None:
    uncertain = attempt(mode="remote", state="REMOTE_UNKNOWN", retry_disposition="REMOTE_UNKNOWN")

    with pytest.raises(InvalidTaskTransitionError):
        transition_attempt(uncertain, target, now=NOW)


def test_remote_unknown_requires_authoritative_reconciliation() -> None:
    uncertain = attempt(mode="remote", state="REMOTE_UNKNOWN", retry_disposition="REMOTE_UNKNOWN")

    with pytest.raises(InvalidTaskTransitionError, match="reconciliation"):
        transition_attempt(
            uncertain,
            "WAITING_REMOTE",
            now=NOW,
            evidence=TransitionEvidence(provider_job_id="provider-job-42"),
        )

    waiting = transition_attempt(
        uncertain,
        "WAITING_REMOTE",
        now=NOW,
        evidence=TransitionEvidence(
            provider_job_id="provider-job-42",
            reconciliation_confirmed=True,
        ),
    )
    assert waiting.provider_job_id == "provider-job-42"

    not_submitted = transition_attempt(
        uncertain,
        "NOT_SUBMITTED",
        now=NOW,
        evidence=TransitionEvidence(
            reconciliation_confirmed=True,
            retry_disposition="PROVIDER_CONFIRMED_NOT_ACCEPTED",
        ),
    )
    assert not_submitted.retry_disposition == "PROVIDER_CONFIRMED_NOT_ACCEPTED"

    with pytest.raises(InvalidTaskTransitionError, match="confirm"):
        transition_attempt(
            uncertain,
            "NOT_SUBMITTED",
            now=NOW,
            evidence=TransitionEvidence(reconciliation_confirmed=True),
        )

    succeeded = transition_attempt(
        uncertain,
        "SUCCEEDED",
        now=NOW,
        evidence=TransitionEvidence(
            reconciliation_confirmed=True,
            output_version_id="ver_preview_1",
        ),
    )
    assert succeeded.output_version_id == "ver_preview_1"


def test_remote_recovery_distinguishes_idempotency_from_lookup() -> None:
    submitting = attempt(
        mode="remote",
        state="SUBMITTING",
        dispatch_started_at=NOW,
        capabilities=ProviderCapabilities(True, False),
    )
    assert recovery_action_for_attempt(submitting) == "RESUME_SAME_ATTEMPT"

    query_only = replace(
        submitting,
        provider_capabilities=ProviderCapabilities(False, True),
    )
    assert recovery_action_for_attempt(query_only) == "QUERY_PROVIDER"

    unsupported = replace(
        submitting,
        provider_capabilities=ProviderCapabilities(False, False),
    )
    assert recovery_action_for_attempt(unsupported) == "QUARANTINE_REMOTE_UNKNOWN"
    assert recovery_action_for_attempt(attempt()) == "NONE"
    assert recovery_action_for_attempt(replace(attempt(), state="LEASED")) == (
        "RECOVER_EXPIRED_LEASE"
    )
    assert (
        recovery_action_for_attempt(
            attempt(mode="remote", state="REMOTE_UNKNOWN", retry_disposition="REMOTE_UNKNOWN")
        )
        == "RECONCILE"
    )


def test_remote_attempt_cannot_skip_submission_boundary() -> None:
    running = transition_attempt(
        transition_attempt(attempt(mode="remote"), "LEASED", now=NOW),
        "RUNNING",
        now=NOW,
    )

    with pytest.raises(InvalidTaskTransitionError, match="submission boundary"):
        transition_attempt(
            running,
            "SUCCEEDED",
            now=NOW,
            evidence=TransitionEvidence(output_version_id="ver_preview_1"),
        )


def test_local_attempt_cannot_enter_remote_protocol() -> None:
    running = transition_attempt(
        transition_attempt(attempt(), "LEASED", now=NOW),
        "RUNNING",
        now=NOW,
    )

    with pytest.raises(InvalidTaskTransitionError, match="execution mode"):
        transition_attempt(running, "SUBMIT_INTENT", now=NOW)


def test_local_attempt_success_requires_and_records_committed_output() -> None:
    running = transition_attempt(
        transition_attempt(attempt(), "LEASED", now=NOW),
        "RUNNING",
        now=NOW,
    )
    with pytest.raises(InvalidTaskTransitionError, match="output version"):
        transition_attempt(running, "SUCCEEDED", now=NOW)

    succeeded = transition_attempt(
        running,
        "SUCCEEDED",
        now=NOW,
        evidence=TransitionEvidence(output_version_id="ver_preview_1"),
    )
    assert succeeded.output_version_id == "ver_preview_1"


def test_remote_unknown_transition_sets_quarantine_disposition() -> None:
    submitting = attempt(mode="remote", state="SUBMITTING", dispatch_started_at=NOW)

    uncertain = transition_attempt(submitting, "REMOTE_UNKNOWN", now=NOW)

    assert uncertain.retry_disposition == "REMOTE_UNKNOWN"


def test_provider_job_id_is_immutable_after_persistence() -> None:
    waiting = attempt(mode="remote", state="WAITING_REMOTE", provider_job_id="provider-job-42")

    with pytest.raises(InvalidTaskTransitionError, match="cannot be replaced"):
        transition_attempt(
            waiting,
            "SUCCEEDED",
            now=NOW,
            evidence=TransitionEvidence(
                provider_job_id="provider-job-99",
                output_version_id="ver_preview_1",
            ),
        )


def test_lease_requires_fencing_identity_and_forward_expiry() -> None:
    lease = TaskLease(
        owner="worker-1",
        token="random-token-1",
        generation=2,
        heartbeat_at=NOW,
        expires_at=NOW + timedelta(seconds=30),
    )
    assert lease.generation == 2

    with pytest.raises(ValueError, match="expiry"):
        replace(lease, expires_at=NOW)
    with pytest.raises(ValueError, match="owner and token"):
        replace(lease, owner="")
    with pytest.raises(ValueError, match="generation"):
        replace(lease, generation=0)


def test_domain_records_reject_invalid_hashes_and_state_invariants() -> None:
    with pytest.raises(ValueError, match="input fingerprint"):
        replace(node(), input_fingerprint="not-a-hash")
    with pytest.raises(ValueError, match="attempt count"):
        replace(node(), attempt_count=3, max_attempts=2)
    with pytest.raises(ValueError, match="max attempts"):
        replace(node(), max_attempts=0)
    with pytest.raises(ValueError, match="revision"):
        replace(node(), revision=0)
    with pytest.raises(ValueError, match="active attempt"):
        replace(node(), state="RUNNING")
    with pytest.raises(ValueError, match="output version"):
        replace(node(), state="SUCCEEDED")

    with pytest.raises(ValueError, match="request fingerprint"):
        replace(attempt(), request_fingerprint="not-a-hash")
    with pytest.raises(ValueError, match="attempt number"):
        replace(attempt(), attempt_number=0)
    with pytest.raises(ValueError, match="revision"):
        replace(attempt(), revision=0)
    with pytest.raises(ValueError, match="local attempt"):
        attempt(mode="local", state="SUBMIT_INTENT")
    with pytest.raises(ValueError, match="dispatch boundary"):
        attempt(mode="remote", state="SUBMITTING")
    with pytest.raises(ValueError, match="provider job id"):
        attempt(mode="remote", state="WAITING_REMOTE")
    with pytest.raises(ValueError, match="quarantined"):
        attempt(mode="remote", state="REMOTE_UNKNOWN")
    with pytest.raises(ValueError, match="output version"):
        attempt(state="SUCCEEDED")
