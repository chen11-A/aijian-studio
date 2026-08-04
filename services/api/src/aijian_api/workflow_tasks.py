"""Deterministic workflow and attempt states shared by ledgers and executors."""

import re
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal

type ExecutionMode = Literal["local", "remote"]
type NodeState = Literal[
    "BLOCKED",
    "PENDING",
    "RUNNING",
    "RECONCILIATION_REQUIRED",
    "NEEDS_REVIEW",
    "SUCCEEDED",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "SUPERSEDED",
]
type AttemptState = Literal[
    "READY",
    "LEASED",
    "RUNNING",
    "SUBMIT_INTENT",
    "SUBMITTING",
    "WAITING_REMOTE",
    "REMOTE_UNKNOWN",
    "SUCCEEDED",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "NOT_SUBMITTED",
]
type RetryDisposition = Literal[
    "SAFE_LOCAL_RETRY",
    "PROVIDER_CONFIRMED_NOT_ACCEPTED",
    "NON_RETRYABLE",
    "REMOTE_UNKNOWN",
]
type RecoveryAction = Literal[
    "RECOVER_EXPIRED_LEASE",
    "RESUME_SAME_ATTEMPT",
    "QUERY_PROVIDER",
    "QUARANTINE_REMOTE_UNKNOWN",
    "RECONCILE",
    "NONE",
]

NODE_STATES: tuple[NodeState, ...] = (
    "BLOCKED",
    "PENDING",
    "RUNNING",
    "RECONCILIATION_REQUIRED",
    "NEEDS_REVIEW",
    "SUCCEEDED",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "SUPERSEDED",
)
ATTEMPT_STATES: tuple[AttemptState, ...] = (
    "READY",
    "LEASED",
    "RUNNING",
    "SUBMIT_INTENT",
    "SUBMITTING",
    "WAITING_REMOTE",
    "REMOTE_UNKNOWN",
    "SUCCEEDED",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "NOT_SUBMITTED",
)

_SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_NODE_TRANSITIONS: dict[NodeState, frozenset[NodeState]] = {
    "BLOCKED": frozenset({"PENDING", "CANCELLED", "SUPERSEDED"}),
    "PENDING": frozenset({"RUNNING", "CANCELLED", "SUPERSEDED"}),
    "RUNNING": frozenset(
        {
            "RECONCILIATION_REQUIRED",
            "NEEDS_REVIEW",
            "SUCCEEDED",
            "FAILED",
            "CANCEL_REQUESTED",
        }
    ),
    "RECONCILIATION_REQUIRED": frozenset({"RUNNING", "SUCCEEDED", "FAILED"}),
    "NEEDS_REVIEW": frozenset({"SUCCEEDED", "FAILED", "SUPERSEDED"}),
    "SUCCEEDED": frozenset({"SUPERSEDED"}),
    "FAILED": frozenset({"PENDING", "SUPERSEDED"}),
    "CANCEL_REQUESTED": frozenset({"CANCELLED", "SUCCEEDED", "FAILED", "RECONCILIATION_REQUIRED"}),
    "CANCELLED": frozenset(),
    "SUPERSEDED": frozenset(),
}
_ATTEMPT_TRANSITIONS: dict[AttemptState, frozenset[AttemptState]] = {
    "READY": frozenset({"LEASED", "CANCELLED"}),
    "LEASED": frozenset({"RUNNING", "FAILED", "CANCEL_REQUESTED"}),
    "RUNNING": frozenset({"SUBMIT_INTENT", "SUCCEEDED", "FAILED", "CANCEL_REQUESTED"}),
    "SUBMIT_INTENT": frozenset({"SUBMITTING", "FAILED", "CANCEL_REQUESTED"}),
    "SUBMITTING": frozenset({"WAITING_REMOTE", "REMOTE_UNKNOWN", "FAILED", "CANCEL_REQUESTED"}),
    "WAITING_REMOTE": frozenset({"SUCCEEDED", "FAILED", "CANCEL_REQUESTED", "REMOTE_UNKNOWN"}),
    "REMOTE_UNKNOWN": frozenset({"WAITING_REMOTE", "SUCCEEDED", "NOT_SUBMITTED"}),
    "SUCCEEDED": frozenset(),
    "FAILED": frozenset(),
    "CANCEL_REQUESTED": frozenset({"CANCELLED", "SUCCEEDED", "FAILED", "REMOTE_UNKNOWN"}),
    "CANCELLED": frozenset(),
    "NOT_SUBMITTED": frozenset(),
}
_REMOTE_PROTOCOL_STATES: frozenset[AttemptState] = frozenset(
    {"SUBMIT_INTENT", "SUBMITTING", "WAITING_REMOTE", "REMOTE_UNKNOWN", "NOT_SUBMITTED"}
)


class InvalidTaskTransitionError(RuntimeError):
    """Raised when a requested state change violates the frozen workflow contract."""


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    supports_idempotency_key: bool
    supports_lookup_by_client_request_id: bool


@dataclass(frozen=True, slots=True)
class TransitionEvidence:
    attempt_id: str | None = None
    provider_job_id: str | None = None
    output_version_id: str | None = None
    dispatch_started_at: datetime | None = None
    retry_disposition: RetryDisposition | None = None
    reconciliation_confirmed: bool = False


@dataclass(frozen=True, slots=True)
class NodeRun:
    id: str
    workflow_run_id: str
    node_key: str
    node_type: str
    state: NodeState
    input_fingerprint: str
    idempotency_key: str
    attempt_count: int
    max_attempts: int
    active_attempt_id: str | None
    output_version_id: str | None
    revision: int
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        _validate_hash(self.input_fingerprint, "input fingerprint")
        if not 0 <= self.attempt_count <= self.max_attempts:
            raise ValueError("attempt count must be between zero and max attempts")
        if self.max_attempts < 1:
            raise ValueError("max attempts must be at least one")
        if self.revision < 1:
            raise ValueError("revision must be at least one")
        if self.state == "RUNNING" and not self.active_attempt_id:
            raise ValueError("running node must identify its active attempt")
        if self.state == "SUCCEEDED" and not self.output_version_id:
            raise ValueError("succeeded node must identify its output version")


@dataclass(frozen=True, slots=True)
class TaskAttempt:
    id: str
    node_run_id: str
    attempt_number: int
    execution_mode: ExecutionMode
    state: AttemptState
    input_fingerprint: str
    request_fingerprint: str
    provider_account_id: str | None
    provider_idempotency_key: str | None
    provider_capabilities: ProviderCapabilities | None
    provider_job_id: str | None
    dispatch_started_at: datetime | None
    retry_disposition: RetryDisposition | None
    output_version_id: str | None
    revision: int
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        _validate_hash(self.input_fingerprint, "input fingerprint")
        _validate_hash(self.request_fingerprint, "request fingerprint")
        if self.attempt_number < 1:
            raise ValueError("attempt number must be at least one")
        if self.revision < 1:
            raise ValueError("revision must be at least one")
        if self.execution_mode == "local" and self.state in _REMOTE_PROTOCOL_STATES:
            raise ValueError("local attempt cannot hold a remote protocol state")
        if self.state == "SUBMITTING" and not self.dispatch_started_at:
            raise ValueError("submitting attempt must record the dispatch boundary")
        if self.state == "WAITING_REMOTE" and not self.provider_job_id:
            raise ValueError("waiting remote attempt must have a provider job id")
        if self.state == "REMOTE_UNKNOWN" and self.retry_disposition != "REMOTE_UNKNOWN":
            raise ValueError("remote unknown attempt must remain quarantined")
        if self.state == "SUCCEEDED" and not self.output_version_id:
            raise ValueError("succeeded attempt must identify its output version")


@dataclass(frozen=True, slots=True)
class TaskLease:
    owner: str
    token: str
    generation: int
    expires_at: datetime
    heartbeat_at: datetime

    def __post_init__(self) -> None:
        if not self.owner.strip() or not self.token.strip():
            raise ValueError("lease owner and token must not be empty")
        if self.generation < 1:
            raise ValueError("lease generation must be at least one")
        if self.expires_at <= self.heartbeat_at:
            raise ValueError("lease expiry must be after its heartbeat")


def transition_node(
    node: NodeRun,
    target: NodeState,
    *,
    now: datetime,
    evidence: TransitionEvidence | None = None,
) -> NodeRun:
    transition_evidence = evidence or TransitionEvidence()
    if target not in _NODE_TRANSITIONS[node.state]:
        raise InvalidTaskTransitionError(f"node transition {node.state} -> {target} is not allowed")
    if node.state == "FAILED" and target == "PENDING":
        _validate_node_retry(node, transition_evidence)
    if node.state == "RECONCILIATION_REQUIRED" and target == "RUNNING":
        if not transition_evidence.reconciliation_confirmed:
            raise InvalidTaskTransitionError("manual reconciliation evidence is required")

    active_attempt_id = node.active_attempt_id
    attempt_count = node.attempt_count
    if target == "RUNNING" and node.state in {"PENDING", "RECONCILIATION_REQUIRED"}:
        if node.state == "PENDING":
            if attempt_count >= node.max_attempts:
                raise InvalidTaskTransitionError("task attempts exhausted")
            if not transition_evidence.attempt_id:
                raise InvalidTaskTransitionError("running node must bind an attempt id")
            attempt_count += 1
            active_attempt_id = transition_evidence.attempt_id
    output_version_id = transition_evidence.output_version_id or node.output_version_id
    if target == "SUCCEEDED" and not output_version_id:
        raise InvalidTaskTransitionError("output version is required before node success")

    return replace(
        node,
        state=target,
        attempt_count=attempt_count,
        active_attempt_id=active_attempt_id,
        output_version_id=output_version_id,
        revision=node.revision + 1,
        updated_at=now,
    )


def transition_attempt(
    attempt: TaskAttempt,
    target: AttemptState,
    *,
    now: datetime,
    evidence: TransitionEvidence | None = None,
) -> TaskAttempt:
    transition_evidence = evidence or TransitionEvidence()
    if target not in _ATTEMPT_TRANSITIONS[attempt.state]:
        raise InvalidTaskTransitionError(
            f"attempt transition {attempt.state} -> {target} is not allowed"
        )
    if attempt.execution_mode == "local" and target in _REMOTE_PROTOCOL_STATES:
        raise InvalidTaskTransitionError("target state is incompatible with local execution mode")
    if attempt.execution_mode == "remote" and attempt.state == "RUNNING" and target == "SUCCEEDED":
        raise InvalidTaskTransitionError(
            "remote attempt must cross the persisted submission boundary"
        )

    _validate_reconciliation(attempt, target, transition_evidence)
    provider_job_id = _provider_job_id(attempt, target, transition_evidence)
    dispatch_started_at = transition_evidence.dispatch_started_at or attempt.dispatch_started_at
    if target == "SUBMITTING" and not dispatch_started_at:
        raise InvalidTaskTransitionError(
            "dispatch start must be persisted before network submission"
        )
    output_version_id = transition_evidence.output_version_id or attempt.output_version_id
    if target == "SUCCEEDED" and not output_version_id:
        raise InvalidTaskTransitionError("output version is required before attempt success")

    retry_disposition = transition_evidence.retry_disposition or attempt.retry_disposition
    if target == "REMOTE_UNKNOWN":
        retry_disposition = "REMOTE_UNKNOWN"
    if target == "NOT_SUBMITTED" and retry_disposition != "PROVIDER_CONFIRMED_NOT_ACCEPTED":
        raise InvalidTaskTransitionError("provider must confirm that the request was not accepted")

    return replace(
        attempt,
        state=target,
        provider_job_id=provider_job_id,
        dispatch_started_at=dispatch_started_at,
        retry_disposition=retry_disposition,
        output_version_id=output_version_id,
        revision=attempt.revision + 1,
        updated_at=now,
    )


def recovery_action_for_attempt(attempt: TaskAttempt) -> RecoveryAction:
    if attempt.state == "REMOTE_UNKNOWN":
        return "RECONCILE"
    if attempt.execution_mode == "local" and attempt.state in {"LEASED", "RUNNING"}:
        return "RECOVER_EXPIRED_LEASE"
    if attempt.execution_mode != "remote" or attempt.state != "SUBMITTING":
        return "NONE"
    capabilities = attempt.provider_capabilities
    if capabilities and capabilities.supports_idempotency_key:
        return "RESUME_SAME_ATTEMPT"
    if capabilities and capabilities.supports_lookup_by_client_request_id:
        return "QUERY_PROVIDER"
    return "QUARANTINE_REMOTE_UNKNOWN"


def _validate_node_retry(node: NodeRun, evidence: TransitionEvidence) -> None:
    if evidence.retry_disposition not in {
        "SAFE_LOCAL_RETRY",
        "PROVIDER_CONFIRMED_NOT_ACCEPTED",
    }:
        raise InvalidTaskTransitionError("failed node requires explicit safe retry evidence")
    if node.attempt_count >= node.max_attempts:
        raise InvalidTaskTransitionError("task attempts exhausted")


def _validate_reconciliation(
    attempt: TaskAttempt,
    target: AttemptState,
    evidence: TransitionEvidence,
) -> None:
    if attempt.state != "REMOTE_UNKNOWN":
        return
    if target in {"WAITING_REMOTE", "SUCCEEDED", "NOT_SUBMITTED"}:
        if not evidence.reconciliation_confirmed:
            raise InvalidTaskTransitionError("manual or authoritative reconciliation is required")


def _provider_job_id(
    attempt: TaskAttempt,
    target: AttemptState,
    evidence: TransitionEvidence,
) -> str | None:
    if (
        attempt.provider_job_id
        and evidence.provider_job_id is not None
        and evidence.provider_job_id != attempt.provider_job_id
    ):
        raise InvalidTaskTransitionError("provider job id cannot be replaced")
    provider_job_id = evidence.provider_job_id or attempt.provider_job_id
    if target == "WAITING_REMOTE" and not provider_job_id:
        raise InvalidTaskTransitionError("provider job id is required before waiting")
    return provider_job_id


def _validate_hash(value: str, label: str) -> None:
    if not _SHA256_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a canonical sha256 value")
