"""Offline, append-only authorization boundary for remote workflow attempts.

This module stores typed authorization evidence only. It never opens a provider
connection or reads a vault; a runtime must recheck the durable consume receipt.
"""

import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from pathlib import Path
from types import MappingProxyType
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from aijian_api.agent_skill_contracts import ArtifactProposalV1, canonical_sha256
from aijian_api.artifact_proposal_store import (
    ArtifactProposalConflictError,
    PersistedArtifactProposal,
    _persist_in_connection,
    _reject_sensitive_proposal_fields,
)
from aijian_api.remote_execution_evidence_contracts import (
    RemoteEvidenceDecisionV1,
    RemoteExecutionBindingV1,
    RemoteExecutionEvidenceBundleV1,
    RemoteExecutionGrantCoreV1,
    grant_core_hash,
)
from aijian_api.remote_execution_evidence_verifier import (
    RemoteEvidenceVerifier,
    evaluate_remote_execution_evidence,
)
from aijian_api.repository import StudioRepository
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.task_ledger_agent_runs import (
    mark_agent_skill_run_failed,
    mark_agent_skill_run_needs_review,
    mark_agent_skill_run_running,
)
from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import ClaimedTask, LeaseLostError, timestamp, utc_now
from aijian_api.task_ledger_snapshots import read_agent_skill_snapshot


class RemoteAuthorizationError(ValueError):
    """A typed authorization is absent, stale, denied, or already consumed."""


@dataclass(frozen=True, slots=True)
class TrustedRemoteCompositionPolicy:
    """Current trusted policy supplied independently of a grant or task snapshot."""

    endpoint_binding: str
    transport_contract_hash: str
    dispatch_class: str
    requested_additional_budget_micros: int
    approved_currency: str
    policy_version: str


type RemoteCompositionPolicyReader = Callable[[], TrustedRemoteCompositionPolicy]


@dataclass(frozen=True, slots=True)
class RemoteAuthorizationSnapshot:
    authorization_id: str
    revision: int
    event_kind: str
    grant_core: RemoteExecutionGrantCoreV1
    grant_core_hash: str


@dataclass(frozen=True, slots=True)
class RemoteDispatchPermit:
    """Offline receipt only; it contains no provider credential or response body."""

    claim: ClaimedTask
    authorization_id: str
    grant_core_hash: str
    evidence_binding_hash: str


@dataclass(frozen=True, slots=True)
class RemoteDispatchSnapshotDraft:
    """Trusted, immutable task facts; never derived from an authorization grant."""

    connection_id: str
    connection_revision: int
    approved_model_id: str
    endpoint_binding: str
    transport_contract_hash: str
    dispatch_class: str
    requested_additional_budget_micros: int
    approved_currency: str
    policy_version: str
    context_manifest_id: str
    context_manifest_hash: str
    scope: Mapping[str, object]

    def __post_init__(self) -> None:
        _RemoteDispatchSnapshotInput.model_validate(
            {
                "connection_id": self.connection_id,
                "connection_revision": self.connection_revision,
                "approved_model_id": self.approved_model_id,
                "endpoint_binding": self.endpoint_binding,
                "transport_contract_hash": self.transport_contract_hash,
                "dispatch_class": self.dispatch_class,
                "requested_additional_budget_micros": self.requested_additional_budget_micros,
                "approved_currency": self.approved_currency,
                "policy_version": self.policy_version,
                "context_manifest_id": self.context_manifest_id,
                "context_manifest_hash": self.context_manifest_hash,
            }
        )
        object.__setattr__(
            self,
            "scope",
            _freeze_dispatch_scope(_validated_dispatch_scope(self.dispatch_class, self.scope)),
        )

    def scope_json(self) -> str:
        return json.dumps(
            _json_ready(self.scope), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )

    def input_scope_hash(self) -> str:
        return canonical_sha256(json.loads(self.scope_json()))

    def snapshot_hash(self, *, project_id: str, attempt_id: str) -> str:
        return canonical_sha256(
            {
                "attempt_id": attempt_id,
                "project_id": project_id,
                "connection_id": self.connection_id,
                "connection_revision": self.connection_revision,
                "approved_model_id": self.approved_model_id,
                "endpoint_binding": self.endpoint_binding,
                "transport_contract_hash": self.transport_contract_hash,
                "dispatch_class": self.dispatch_class,
                "requested_additional_budget_micros": self.requested_additional_budget_micros,
                "approved_currency": self.approved_currency,
                "policy_version": self.policy_version,
                "context_manifest_id": self.context_manifest_id,
                "context_manifest_hash": self.context_manifest_hash,
                "input_scope_hash": self.input_scope_hash(),
            }
        )


def authorization_snapshot_from_grant(
    grant: RemoteExecutionGrantCoreV1,
) -> RemoteAuthorizationSnapshot:
    return RemoteAuthorizationSnapshot(
        authorization_id=grant.authorization_id,
        revision=grant.grant_revision,
        event_kind="ISSUE",
        grant_core=grant,
        grant_core_hash=grant_core_hash(grant),
    )


class RemoteExecutionAuthorizationStore:
    """Offline store with atomic consume-before-dispatch and candidate persistence."""

    def __init__(
        self,
        database_path: Path,
        *,
        id_factory: Callable[[str], str],
        clock: Callable[[], datetime] = utc_now,
        connection_timeout: timedelta = timedelta(seconds=5),
        composition_policy_reader: RemoteCompositionPolicyReader | None = None,
    ) -> None:
        if connection_timeout <= timedelta(0):
            raise ValueError("connection timeout must be positive")
        self._database_path = database_path
        self._id_factory = id_factory
        self._clock = clock
        self._timeout = connection_timeout.total_seconds()
        self._composition_policy_reader = composition_policy_reader
        StudioRepository(database_path, connection_timeout=connection_timeout)

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self._database_path, timeout=self._timeout, isolation_level=None
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(f"PRAGMA busy_timeout = {max(1, int(self._timeout * 1000))}")
        return connection

    def issue(
        self,
        *,
        binding: RemoteExecutionBindingV1,
        envelope: RemoteExecutionEvidenceBundleV1,
        verifier: RemoteEvidenceVerifier | None,
    ) -> RemoteAuthorizationSnapshot:
        now = self._clock()
        binding = RemoteExecutionBindingV1.model_validate(binding)
        decision = evaluate_remote_execution_evidence(
            verifier=verifier, binding=binding, envelope=envelope, now=now
        )
        if decision.status != "ALLOW":
            raise RemoteAuthorizationError(f"remote evidence denied: {decision.code}")
        snapshot = authorization_snapshot_from_grant(binding.grant)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if (
                connection.execute(
                    "SELECT 1 FROM remote_execution_authorization_snapshots "
                    "WHERE authorization_id = ?",
                    (snapshot.authorization_id,),
                ).fetchone()
                is not None
            ):
                raise RemoteAuthorizationError("authorization identifier is already issued")
            _append_snapshot(connection, snapshot, decision, timestamp(now))
            connection.commit()
            return snapshot
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def revoke(self, authorization_id: str) -> RemoteAuthorizationSnapshot:
        return self._append_lifecycle(authorization_id, "REVOKE")

    def expire(self, authorization_id: str) -> RemoteAuthorizationSnapshot:
        return self._append_lifecycle(authorization_id, "EXPIRE")

    def _append_lifecycle(
        self, authorization_id: str, event_kind: str
    ) -> RemoteAuthorizationSnapshot:
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            latest, decision = _read_latest_snapshot(connection, authorization_id)
            if latest.event_kind in {"REVOKE", "EXPIRE"}:
                raise RemoteAuthorizationError("authorization is already terminal")
            snapshot = replace(latest, revision=latest.revision + 1, event_kind=event_kind)
            _append_snapshot(connection, snapshot, decision, timestamp(self._clock()))
            connection.commit()
            return snapshot
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def begin_remote_dispatch(
        self, *, claim: ClaimedTask, authorization_id: str, expected_authorization_revision: int
    ) -> RemoteDispatchPermit:
        """Commit RUNNING -> SUBMIT_INTENT -> SUBMITTING and CONSUME before runtime use."""
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now = self._clock()
            now_text = timestamp(now)
            project_id = _assert_live_remote_claim(
                connection, claim, now_text=now_text, allowed_statuses={"RUNNING"}
            )
            latest, decision = _read_latest_snapshot(connection, authorization_id)
            if latest.revision != expected_authorization_revision:
                raise RemoteAuthorizationError("authorization revision is stale")
            snapshot = read_agent_skill_snapshot(connection, claim, now_text=now_text)
            dispatch_snapshot = _read_dispatch_snapshot(
                connection,
                claim.attempt_id,
                require_current_provider=True,
                require_current_truth=True,
            )
            _assert_current_composition_policy(self._composition_policy_reader, dispatch_snapshot)
            _assert_dispatchable(
                latest,
                decision,
                claim=claim,
                project_id=project_id,
                dispatch_snapshot=dispatch_snapshot,
                now=now,
                consumed=False,
            )
            consumed = replace(latest, revision=latest.revision + 1, event_kind="CONSUME")
            _append_snapshot(
                connection,
                consumed,
                decision,
                now_text,
                attempt_id=claim.attempt_id,
                lease_generation=claim.lease_generation,
            )
            intent = connection.execute(
                """UPDATE workflow_attempts
                SET status = 'SUBMIT_INTENT', revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'RUNNING' AND revision = ?
                RETURNING revision""",
                (now_text, claim.attempt_id, claim.attempt_revision),
            ).fetchone()
            if intent is None:
                raise LeaseLostError("remote attempt is no longer running")
            mark_agent_skill_run_running(connection, snapshot, now_text=now_text)
            submitting = connection.execute(
                """UPDATE workflow_attempts
                SET status = 'SUBMITTING', dispatch_started_at = ?, revision = revision + 1,
                    updated_at = ?
                WHERE attempt_id = ? AND status = 'SUBMIT_INTENT' AND revision = ?
                RETURNING revision""",
                (now_text, now_text, claim.attempt_id, int(intent["revision"])),
            ).fetchone()
            if submitting is None:
                raise LeaseLostError("remote submit intent was lost")
            _event(
                connection,
                self._id_factory,
                claim,
                "attempt",
                claim.attempt_id,
                "RUNNING",
                "SUBMIT_INTENT",
                "remote.authorization.consumed",
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                claim,
                "attempt",
                claim.attempt_id,
                "SUBMIT_INTENT",
                "SUBMITTING",
                "remote.submit.prepared",
                now_text,
            )
            connection.commit()
            return RemoteDispatchPermit(
                replace(claim, attempt_revision=int(submitting["revision"])),
                authorization_id,
                latest.grant_core_hash,
                decision.binding_hash,
            )
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def recheck_dispatch_permit(self, permit: RemoteDispatchPermit) -> None:
        """Require the exact latest CONSUME receipt immediately before runtime dispatch."""
        connection = self._open()
        try:
            connection.execute("BEGIN")
            now = self._clock()
            project_id = _assert_live_remote_claim(
                connection, permit.claim, now_text=timestamp(now), allowed_statuses={"SUBMITTING"}
            )
            dispatch_snapshot = _read_dispatch_snapshot(
                connection,
                permit.claim.attempt_id,
                require_current_provider=True,
                require_current_truth=True,
            )
            _assert_current_composition_policy(self._composition_policy_reader, dispatch_snapshot)
            latest, decision = _read_latest_snapshot(connection, permit.authorization_id)
            if latest.grant_core_hash != permit.grant_core_hash:
                raise RemoteAuthorizationError("authorization core changed")
            if decision.binding_hash != permit.evidence_binding_hash:
                raise RemoteAuthorizationError("authorization evidence binding changed")
            _assert_consume_fence(connection, permit)
            _assert_dispatchable(
                latest,
                decision,
                claim=permit.claim,
                project_id=project_id,
                dispatch_snapshot=dispatch_snapshot,
                now=now,
                consumed=True,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def record_remote_candidate(
        self,
        *,
        permit: RemoteDispatchPermit,
        proposal: ArtifactProposalV1,
        provider_response_id: str,
    ) -> PersistedArtifactProposal:
        """Persist proposal, provider response ID, review state, and task completion atomically."""
        if not provider_response_id.strip() or len(provider_response_id) > 512:
            raise ValueError("provider response identifier is required and bounded")
        proposal = ArtifactProposalV1.model_validate(proposal.model_dump(mode="json"))
        try:
            _reject_sensitive_proposal_fields(proposal.payload)
        except ValueError as error:
            raise ArtifactProposalConflictError(
                "proposal contains a sensitive persisted field"
            ) from error
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now = self._clock()
            now_text = timestamp(now)
            project_id = _assert_live_remote_claim(
                connection, permit.claim, now_text=now_text, allowed_statuses={"SUBMITTING"}
            )
            latest, _latest_decision = _read_latest_snapshot(connection, permit.authorization_id)
            consumed, decision = _read_consumed_snapshot(connection, permit.authorization_id)
            snapshot = read_agent_skill_snapshot(connection, permit.claim, now_text=now_text)
            dispatch_snapshot = _read_dispatch_snapshot(
                connection,
                permit.claim.attempt_id,
                require_current_provider=False,
                require_current_truth=False,
            )
            if consumed.grant_core_hash != permit.grant_core_hash:
                raise RemoteAuthorizationError("candidate authorization core changed")
            if decision.binding_hash != permit.evidence_binding_hash:
                raise RemoteAuthorizationError("candidate evidence binding changed")
            _assert_consume_fence(connection, permit)
            _assert_dispatchable(
                consumed,
                decision,
                claim=permit.claim,
                project_id=project_id,
                dispatch_snapshot=dispatch_snapshot,
                now=now,
                consumed=True,
                allow_after_dispatch=True,
            )
            stale_after_dispatch = _dispatch_truth_is_stale(
                connection,
                permit.claim.attempt_id,
                dispatch_snapshot,
                self._composition_policy_reader,
            )
            payload = proposal.model_dump(mode="json")
            persisted = _persist_in_connection(
                connection,
                claim=permit.claim,
                proposal=proposal,
                proposal_json=json.dumps(
                    payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ),
                proposal_hash=canonical_sha256(payload),
                now_text=now_text,
            )
            mark_agent_skill_run_needs_review(
                connection, snapshot, proposal_id=persisted.proposal.proposal_id, now_text=now_text
            )
            attempt = connection.execute(
                """UPDATE workflow_attempts
                SET status = 'REMOTE_REVIEW_PENDING', provider_response_id = ?,
                    revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'SUBMITTING' AND revision = ?
                  AND output_version_id IS NULL
                RETURNING revision""",
                (
                    provider_response_id,
                    now_text,
                    permit.claim.attempt_id,
                    permit.claim.attempt_revision,
                ),
            ).fetchone()
            node = connection.execute(
                """UPDATE workflow_node_runs
                SET status = 'NEEDS_REVIEW', revision = revision + 1, updated_at = ?
                WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
                  AND revision = ?
                RETURNING revision""",
                (
                    now_text,
                    permit.claim.node_run_id,
                    permit.claim.attempt_id,
                    permit.claim.node_revision,
                ),
            ).fetchone()
            task = connection.execute(
                """UPDATE task_ledger
                SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
                WHERE task_id = ? AND status = 'LEASED' AND lease_owner = ?
                  AND lease_token = ? AND lease_generation = ? AND revision = ?
                RETURNING revision""",
                (
                    now_text,
                    permit.claim.task_id,
                    permit.claim.lease_owner,
                    permit.claim.lease_token,
                    permit.claim.lease_generation,
                    permit.claim.task_revision,
                ),
            ).fetchone()
            if attempt is None or node is None or task is None:
                raise LeaseLostError("candidate state changed during review transition")
            candidate_reason = (
                "remote.candidate.revoked_after_dispatch"
                if latest.event_kind in {"REVOKE", "EXPIRE"}
                else "remote.candidate.stale_after_dispatch"
                if stale_after_dispatch
                else "remote.candidate.received"
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "attempt",
                permit.claim.attempt_id,
                "SUBMITTING",
                "REMOTE_REVIEW_PENDING",
                candidate_reason,
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "node",
                permit.claim.node_run_id,
                "RUNNING",
                "NEEDS_REVIEW",
                "remote.candidate.needs_review",
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "task",
                permit.claim.task_id,
                "LEASED",
                "COMPLETED",
                "remote.candidate.persisted",
                now_text,
            )
            connection.commit()
            return persisted
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def fail_remote_attempt(
        self,
        *,
        permit: RemoteDispatchPermit,
        error_code: str,
        provider_response_id: str | None,
    ) -> None:
        """Record a post-dispatch failure without creating a proposal or output version."""
        if not error_code.strip() or len(error_code) > 160:
            raise ValueError("remote error code is required and bounded")
        if provider_response_id is not None and (
            not provider_response_id.strip() or len(provider_response_id) > 512
        ):
            raise ValueError("provider response identifier is invalid")
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now_text = timestamp(self._clock())
            project_id = _assert_live_remote_claim(
                connection,
                permit.claim,
                now_text=now_text,
                allowed_statuses={"SUBMITTING"},
            )
            _assert_consume_fence(connection, permit)
            consumed, decision = _read_consumed_snapshot(connection, permit.authorization_id)
            dispatch_snapshot = _read_dispatch_snapshot(
                connection,
                permit.claim.attempt_id,
                require_current_provider=False,
                require_current_truth=False,
            )
            if consumed.grant_core_hash != permit.grant_core_hash:
                raise RemoteAuthorizationError("failure authorization core changed")
            if decision.binding_hash != permit.evidence_binding_hash:
                raise RemoteAuthorizationError("failure evidence binding changed")
            _assert_dispatchable(
                consumed,
                decision,
                claim=permit.claim,
                project_id=project_id,
                dispatch_snapshot=dispatch_snapshot,
                now=self._clock(),
                consumed=True,
                allow_after_dispatch=True,
            )
            latest, _ = _read_latest_snapshot(connection, permit.authorization_id)
            stale_after_dispatch = _dispatch_truth_is_stale(
                connection,
                permit.claim.attempt_id,
                dispatch_snapshot,
                self._composition_policy_reader,
            )
            failure_reason = (
                "remote.failure.revoked_after_dispatch"
                if latest.event_kind in {"REVOKE", "EXPIRE"}
                else "remote.failure.stale_after_dispatch"
                if stale_after_dispatch
                else "remote.failure.recorded"
            )
            snapshot = read_agent_skill_snapshot(connection, permit.claim, now_text=now_text)
            mark_agent_skill_run_failed(connection, snapshot, now_text=now_text)
            attempt = connection.execute(
                """
                UPDATE workflow_attempts
                SET status = 'FAILED', retry_disposition = 'NON_RETRYABLE',
                    error_code = ?, provider_response_id = COALESCE(?, provider_response_id),
                    finished_at = ?, revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'SUBMITTING' AND revision = ?
                  AND output_version_id IS NULL
                RETURNING revision
                """,
                (
                    error_code,
                    provider_response_id,
                    now_text,
                    now_text,
                    permit.claim.attempt_id,
                    permit.claim.attempt_revision,
                ),
            ).fetchone()
            node = connection.execute(
                """
                UPDATE workflow_node_runs
                SET status = 'FAILED', revision = revision + 1, updated_at = ?
                WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
                  AND revision = ? AND output_version_id IS NULL
                RETURNING revision
                """,
                (
                    now_text,
                    permit.claim.node_run_id,
                    permit.claim.attempt_id,
                    permit.claim.node_revision,
                ),
            ).fetchone()
            task = connection.execute(
                """
                UPDATE task_ledger
                SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
                WHERE task_id = ? AND status = 'LEASED' AND lease_owner = ?
                  AND lease_token = ? AND lease_generation = ? AND revision = ?
                RETURNING revision
                """,
                (
                    now_text,
                    permit.claim.task_id,
                    permit.claim.lease_owner,
                    permit.claim.lease_token,
                    permit.claim.lease_generation,
                    permit.claim.task_revision,
                ),
            ).fetchone()
            if attempt is None or node is None or task is None:
                raise LeaseLostError("remote failure state changed during completion")
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "attempt",
                permit.claim.attempt_id,
                "SUBMITTING",
                "FAILED",
                error_code,
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "node",
                permit.claim.node_run_id,
                "RUNNING",
                "FAILED",
                "remote.attempt.failed",
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "task",
                permit.claim.task_id,
                "LEASED",
                "COMPLETED",
                failure_reason,
                now_text,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def quarantine_remote_unknown(
        self, *, permit: RemoteDispatchPermit, provider_response_id: str | None
    ) -> None:
        """Atomically quarantine an uncertain remote result without redispatching it."""
        if provider_response_id is not None and (
            not provider_response_id.strip() or len(provider_response_id) > 512
        ):
            raise ValueError("provider response identifier is invalid")
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now_text = timestamp(self._clock())
            project_id = _assert_quarantinable_remote_claim(connection, permit.claim)
            _assert_consume_fence(connection, permit)
            consumed, decision = _read_consumed_snapshot(connection, permit.authorization_id)
            dispatch_snapshot = _read_dispatch_snapshot(
                connection,
                permit.claim.attempt_id,
                require_current_provider=False,
                require_current_truth=False,
            )
            if consumed.grant_core_hash != permit.grant_core_hash:
                raise RemoteAuthorizationError("unknown authorization core changed")
            if decision.binding_hash != permit.evidence_binding_hash:
                raise RemoteAuthorizationError("unknown evidence binding changed")
            _assert_dispatchable(
                consumed,
                decision,
                claim=permit.claim,
                project_id=project_id,
                dispatch_snapshot=dispatch_snapshot,
                now=self._clock(),
                consumed=True,
                allow_after_dispatch=True,
            )
            attempt = connection.execute(
                """UPDATE workflow_attempts SET status = 'REMOTE_UNKNOWN',
                       retry_disposition = 'REMOTE_UNKNOWN',
                       provider_response_id = COALESCE(?, provider_response_id),
                       revision = revision + 1, updated_at = ?
                   WHERE attempt_id = ? AND status = 'SUBMITTING' AND revision = ?
                     AND output_version_id IS NULL RETURNING revision""",
                (
                    provider_response_id,
                    now_text,
                    permit.claim.attempt_id,
                    permit.claim.attempt_revision,
                ),
            ).fetchone()
            node = connection.execute(
                """UPDATE workflow_node_runs SET status = 'RECONCILIATION_REQUIRED',
                       revision = revision + 1, updated_at = ?
                   WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
                     AND revision = ? AND output_version_id IS NULL RETURNING revision""",
                (
                    now_text,
                    permit.claim.node_run_id,
                    permit.claim.attempt_id,
                    permit.claim.node_revision,
                ),
            ).fetchone()
            task = connection.execute(
                """UPDATE task_ledger SET status = 'COMPLETED', revision = revision + 1,
                       updated_at = ? WHERE task_id = ? AND status = 'LEASED'
                     AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
                     AND revision = ? RETURNING revision""",
                (
                    now_text,
                    permit.claim.task_id,
                    permit.claim.lease_owner,
                    permit.claim.lease_token,
                    permit.claim.lease_generation,
                    permit.claim.task_revision,
                ),
            ).fetchone()
            if attempt is None or node is None or task is None:
                raise LeaseLostError("remote unknown state changed during quarantine")
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "attempt",
                permit.claim.attempt_id,
                "SUBMITTING",
                "REMOTE_UNKNOWN",
                "remote.unknown.quarantined",
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "node",
                permit.claim.node_run_id,
                "RUNNING",
                "RECONCILIATION_REQUIRED",
                "remote.reconciliation.required",
                now_text,
            )
            _event(
                connection,
                self._id_factory,
                permit.claim,
                "task",
                permit.claim.task_id,
                "LEASED",
                "COMPLETED",
                "remote.unknown.quarantined",
                now_text,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _append_snapshot(
    connection: sqlite3.Connection,
    snapshot: RemoteAuthorizationSnapshot,
    decision: RemoteEvidenceDecisionV1,
    now_text: str,
    *,
    attempt_id: str | None = None,
    lease_generation: int | None = None,
) -> None:
    if grant_core_hash(snapshot.grant_core) != snapshot.grant_core_hash:
        raise RemoteAuthorizationError("authorization core hash is invalid")
    connection.execute(
        """INSERT INTO remote_execution_authorization_snapshots (
            authorization_id, revision, event_kind, grant_core_json, grant_core_hash,
            evidence_binding_hash, evidence_decision_json, attempt_id, lease_generation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            snapshot.authorization_id,
            snapshot.revision,
            snapshot.event_kind,
            json.dumps(
                snapshot.grant_core.model_dump(mode="json"),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
            snapshot.grant_core_hash,
            decision.binding_hash,
            json.dumps(
                decision.model_dump(mode="json"),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
            attempt_id,
            lease_generation,
            now_text,
        ),
    )


def _read_latest_snapshot(
    connection: sqlite3.Connection, authorization_id: str
) -> tuple[RemoteAuthorizationSnapshot, RemoteEvidenceDecisionV1]:
    row = connection.execute(
        "SELECT * FROM remote_execution_authorization_snapshots "
        "WHERE authorization_id = ? ORDER BY revision DESC LIMIT 1",
        (authorization_id,),
    ).fetchone()
    if row is None:
        raise RemoteAuthorizationError("authorization was not issued")
    try:
        core = RemoteExecutionGrantCoreV1.model_validate_json(str(row["grant_core_json"]))
        decision = RemoteEvidenceDecisionV1.model_validate_json(str(row["evidence_decision_json"]))
    except (json.JSONDecodeError, ValueError) as error:
        raise RemoteAuthorizationError("stored authorization is malformed") from error
    stored_hash = str(row["grant_core_hash"])
    if grant_core_hash(core) != stored_hash:
        raise RemoteAuthorizationError("stored authorization core hash is invalid")
    return RemoteAuthorizationSnapshot(
        str(row["authorization_id"]),
        int(row["revision"]),
        str(row["event_kind"]),
        core,
        stored_hash,
    ), decision


def _read_consumed_snapshot(
    connection: sqlite3.Connection, authorization_id: str
) -> tuple[RemoteAuthorizationSnapshot, RemoteEvidenceDecisionV1]:
    row = connection.execute(
        """SELECT * FROM remote_execution_authorization_snapshots
        WHERE authorization_id = ? AND event_kind = 'CONSUME' ORDER BY revision DESC LIMIT 1""",
        (authorization_id,),
    ).fetchone()
    if row is None:
        raise RemoteAuthorizationError("authorization was not consumed")
    try:
        core = RemoteExecutionGrantCoreV1.model_validate_json(str(row["grant_core_json"]))
        decision = RemoteEvidenceDecisionV1.model_validate_json(str(row["evidence_decision_json"]))
    except (json.JSONDecodeError, ValueError) as error:
        raise RemoteAuthorizationError("stored consume is malformed") from error
    stored_hash = str(row["grant_core_hash"])
    if grant_core_hash(core) != stored_hash:
        raise RemoteAuthorizationError("stored consume core hash is invalid")
    return RemoteAuthorizationSnapshot(
        str(row["authorization_id"]), int(row["revision"]), "CONSUME", core, stored_hash
    ), decision


def _read_dispatch_snapshot(
    connection: sqlite3.Connection,
    attempt_id: str,
    *,
    require_current_provider: bool,
    require_current_truth: bool,
) -> RemoteDispatchSnapshotDraft:
    row = connection.execute(
        "SELECT * FROM remote_dispatch_snapshots WHERE attempt_id = ?", (attempt_id,)
    ).fetchone()
    if row is None:
        raise RemoteAuthorizationError("remote dispatch snapshot is missing")
    try:
        draft = RemoteDispatchSnapshotDraft(
            connection_id=str(row["connection_id"]),
            connection_revision=int(row["connection_revision"]),
            approved_model_id=str(row["approved_model_id"]),
            endpoint_binding=str(row["endpoint_binding"]),
            transport_contract_hash=str(row["transport_contract_hash"]),
            dispatch_class=str(row["scope_kind"]),
            requested_additional_budget_micros=int(row["requested_additional_budget_micros"]),
            approved_currency=str(row["approved_currency"]),
            policy_version=str(row["policy_version"]),
            context_manifest_id=str(row["context_manifest_id"]),
            context_manifest_hash=str(row["context_manifest_hash"]),
            scope=json.loads(str(row["scope_json"])),
        )
        if not isinstance(draft.scope, Mapping):
            raise ValueError("scope is not an object")
        if draft.input_scope_hash() != str(row["input_scope_hash"]):
            raise ValueError("scope hash mismatch")
        if draft.snapshot_hash(project_id=str(row["project_id"]), attempt_id=attempt_id) != str(
            row["snapshot_hash"]
        ):
            raise ValueError("snapshot hash mismatch")
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise RemoteAuthorizationError("remote dispatch snapshot is malformed") from error
    if require_current_truth:
        _assert_dispatch_scope_matches_database(connection, attempt_id, draft)
    if require_current_provider:
        _assert_current_provider_metadata(connection, draft)
    return draft


def validate_remote_dispatch_snapshot_in_connection(
    connection: sqlite3.Connection, attempt_id: str
) -> None:
    """Validate a newly inserted remote snapshot against current local task truth."""
    _read_dispatch_snapshot(
        connection,
        attempt_id,
        require_current_provider=True,
        require_current_truth=True,
    )


def _assert_dispatch_scope_matches_database(
    connection: sqlite3.Connection, attempt_id: str, draft: RemoteDispatchSnapshotDraft
) -> None:
    row = connection.execute(
        """
        SELECT attempt.input_hash, snapshot.snapshot_json,
               context.context_manifest_id, context.manifest_hash
        FROM workflow_attempts AS attempt
        JOIN workflow_attempt_snapshots AS snapshot ON snapshot.attempt_id = attempt.attempt_id
        JOIN skill_runs AS skill
          ON skill.skill_run_id = json_extract(snapshot.snapshot_json, '$.skill_run_id')
        JOIN agent_context_manifests AS context
          ON context.context_manifest_id = skill.context_manifest_id
        WHERE attempt.attempt_id = ?
        """,
        (attempt_id,),
    ).fetchone()
    if row is None:
        raise RemoteAuthorizationError("remote dispatch snapshot is detached from task truth")
    if (
        str(row["context_manifest_id"]) != draft.context_manifest_id
        or str(row["manifest_hash"]) != draft.context_manifest_hash
    ):
        raise RemoteAuthorizationError("remote dispatch context changed")
    if draft.dispatch_class == "FORMAL_CONTENT_EXECUTION":
        if str(draft.scope["input_hash"]) != str(row["input_hash"]):
            raise RemoteAuthorizationError("remote dispatch input changed")
        accepted = connection.execute(
            """
            SELECT version.content_hash, version.content_json
            FROM artifact_versions AS version
            JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
            WHERE artifact.project_id = ? AND artifact.artifact_type = 'source_manifest'
              AND version.version_id = ? AND head.accepted_version_id = version.version_id
            """,
            (
                connection.execute(
                    "SELECT project_id FROM remote_dispatch_snapshots WHERE attempt_id = ?",
                    (attempt_id,),
                ).fetchone()[0],
                str(draft.scope["accepted_manifest_version_id"]),
            ),
        ).fetchone()
        if accepted is None or str(accepted["content_hash"]) != str(
            draft.scope["accepted_manifest_content_hash"]
        ):
            raise RemoteAuthorizationError("remote dispatch accepted manifest changed")
        if str(draft.scope["context_manifest_hash"]) != draft.context_manifest_hash:
            raise RemoteAuthorizationError("remote dispatch scope context is inconsistent")
        try:
            manifest = SourceManifestContentV1.model_validate(
                json.loads(str(accepted["content_json"]))
            )
        except (json.JSONDecodeError, ValidationError) as error:
            raise RemoteAuthorizationError("accepted source manifest is malformed") from error
        document = next(
            (
                item
                for item in manifest.documents
                if item.source_document_id == str(draft.scope["source_document_id"])
            ),
            None,
        )
        block_ids = tuple(
            str(value) for value in cast(list[object], draft.scope["source_block_ids"])
        )
        spans = tuple(
            tuple(cast(list[int], value))
            for value in cast(list[object], draft.scope["span_bounds"])
        )
        if len(block_ids) != len(spans) or len(set(block_ids)) != len(block_ids):
            raise RemoteAuthorizationError("remote dispatch source scope is inconsistent")
        if document is None:
            raise RemoteAuthorizationError("remote dispatch source document changed")
        blocks = {block.source_block_id: block for block in document.blocks}
        for block_id, (start, end) in zip(block_ids, spans, strict=True):
            block = blocks.get(block_id)
            if block is None or start < block.start_byte or end > block.end_byte:
                raise RemoteAuthorizationError("remote dispatch source block or span changed")


def _assert_current_provider_metadata(
    connection: sqlite3.Connection, draft: RemoteDispatchSnapshotDraft
) -> None:
    row = connection.execute(
        "SELECT revision, enabled, models_json FROM provider_connections WHERE connection_id = ?",
        (draft.connection_id,),
    ).fetchone()
    if row is None or int(row["enabled"]) != 1 or int(row["revision"]) != draft.connection_revision:
        raise RemoteAuthorizationError("remote provider metadata changed")
    try:
        models = json.loads(str(row["models_json"]))
    except json.JSONDecodeError as error:
        raise RemoteAuthorizationError("remote provider metadata is malformed") from error
    if not any(
        isinstance(item, dict) and item.get("model_id") == draft.approved_model_id
        for item in models
    ):
        raise RemoteAuthorizationError("remote provider model is no longer approved")


def _assert_current_composition_policy(
    reader: RemoteCompositionPolicyReader | None, draft: RemoteDispatchSnapshotDraft
) -> None:
    if reader is None:
        raise RemoteAuthorizationError("trusted remote composition policy is unavailable")
    try:
        policy = reader()
    except Exception as error:
        raise RemoteAuthorizationError(
            "trusted remote composition policy is unavailable"
        ) from error
    if not isinstance(policy, TrustedRemoteCompositionPolicy) or (
        policy.endpoint_binding != draft.endpoint_binding
        or policy.transport_contract_hash != draft.transport_contract_hash
        or policy.dispatch_class != draft.dispatch_class
        or policy.requested_additional_budget_micros != draft.requested_additional_budget_micros
        or policy.approved_currency != draft.approved_currency
        or policy.policy_version != draft.policy_version
    ):
        raise RemoteAuthorizationError("trusted remote composition policy changed")


def _dispatch_truth_is_stale(
    connection: sqlite3.Connection,
    attempt_id: str,
    draft: RemoteDispatchSnapshotDraft,
    composition_policy_reader: Callable[[], TrustedRemoteCompositionPolicy] | None,
) -> bool:
    try:
        _assert_dispatch_scope_matches_database(connection, attempt_id, draft)
        _assert_current_provider_metadata(connection, draft)
        _assert_current_composition_policy(composition_policy_reader, draft)
    except RemoteAuthorizationError:
        return True
    return False


def _assert_quarantinable_remote_claim(connection: sqlite3.Connection, claim: ClaimedTask) -> str:
    """Fence an unknown-result write to the original lease identity, even after expiry."""
    row = connection.execute(
        """SELECT attempt.execution_mode, attempt.status, workflow.project_id
        FROM task_ledger AS task
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id
        WHERE task.task_id = ? AND task.attempt_id = ? AND task.status = 'LEASED'
          AND task.lease_owner = ? AND task.lease_token = ? AND task.lease_generation = ?
          AND task.revision = ? AND attempt.node_run_id = ? AND attempt.revision = ?
          AND node.workflow_run_id = ? AND node.active_attempt_id = ?
          AND node.status = 'RUNNING' AND node.revision = ?""",
        (
            claim.task_id,
            claim.attempt_id,
            claim.lease_owner,
            claim.lease_token,
            claim.lease_generation,
            claim.task_revision,
            claim.node_run_id,
            claim.attempt_revision,
            claim.workflow_run_id,
            claim.attempt_id,
            claim.node_revision,
        ),
    ).fetchone()
    if row is None:
        raise LeaseLostError("remote unknown lease identity is stale")
    if str(row["execution_mode"]) != "remote" or str(row["status"]) != "SUBMITTING":
        raise RemoteAuthorizationError("claim is not in the required remote state")
    return str(row["project_id"])


def _assert_live_remote_claim(
    connection: sqlite3.Connection, claim: ClaimedTask, *, now_text: str, allowed_statuses: set[str]
) -> str:
    row = connection.execute(
        """SELECT attempt.execution_mode, attempt.status, workflow.project_id
        FROM task_ledger AS task
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id
        WHERE task.task_id = ? AND task.attempt_id = ? AND task.status = 'LEASED'
          AND task.lease_owner = ? AND task.lease_token = ? AND task.lease_generation = ?
          AND task.revision = ? AND task.lease_expires_at > ?
          AND attempt.node_run_id = ? AND attempt.revision = ?
          AND node.workflow_run_id = ? AND node.active_attempt_id = ?
          AND node.status = 'RUNNING' AND node.revision = ?""",
        (
            claim.task_id,
            claim.attempt_id,
            claim.lease_owner,
            claim.lease_token,
            claim.lease_generation,
            claim.task_revision,
            now_text,
            claim.node_run_id,
            claim.attempt_revision,
            claim.workflow_run_id,
            claim.attempt_id,
            claim.node_revision,
        ),
    ).fetchone()
    if row is None:
        raise LeaseLostError("task lease is stale or expired")
    if str(row["execution_mode"]) != "remote" or str(row["status"]) not in allowed_statuses:
        raise RemoteAuthorizationError("claim is not in the required remote state")
    return str(row["project_id"])


def _assert_consume_fence(connection: sqlite3.Connection, permit: RemoteDispatchPermit) -> None:
    row = connection.execute(
        """SELECT 1 FROM remote_execution_authorization_snapshots
        WHERE authorization_id = ? AND event_kind = 'CONSUME'
          AND attempt_id = ? AND lease_generation = ?""",
        (permit.authorization_id, permit.claim.attempt_id, permit.claim.lease_generation),
    ).fetchone()
    if row is None:
        raise RemoteAuthorizationError("authorization consume does not match this lease")


def _assert_dispatchable(
    snapshot: RemoteAuthorizationSnapshot,
    decision: RemoteEvidenceDecisionV1,
    *,
    claim: ClaimedTask,
    project_id: str,
    dispatch_snapshot: RemoteDispatchSnapshotDraft,
    now: datetime,
    consumed: bool,
    allow_after_dispatch: bool = False,
) -> None:
    if snapshot.event_kind != ("CONSUME" if consumed else "ISSUE"):
        raise RemoteAuthorizationError("authorization lifecycle does not permit dispatch")
    if decision.status != "ALLOW" or decision.code != "EVIDENCE_VERIFIED":
        raise RemoteAuthorizationError("authorization evidence is not allowed")
    if not allow_after_dispatch and (
        now >= snapshot.grant_core.expires_at or now >= decision.valid_until
    ):
        raise RemoteAuthorizationError("authorization has expired")
    if snapshot.grant_core.project_id != project_id:
        raise RemoteAuthorizationError("authorization project does not match task")
    if snapshot.grant_core.input_scope_hash != dispatch_snapshot.input_scope_hash():
        raise RemoteAuthorizationError("authorization input scope does not match task")
    if snapshot.grant_core.connection_id != dispatch_snapshot.connection_id:
        raise RemoteAuthorizationError("authorization connection does not match task")
    if snapshot.grant_core.connection_revision != dispatch_snapshot.connection_revision:
        raise RemoteAuthorizationError("authorization connection revision does not match task")
    if snapshot.grant_core.approved_model_id != dispatch_snapshot.approved_model_id:
        raise RemoteAuthorizationError("authorization model does not match task")
    if snapshot.grant_core.endpoint_binding != dispatch_snapshot.endpoint_binding:
        raise RemoteAuthorizationError("authorization endpoint does not match task")
    if snapshot.grant_core.transport_contract_hash != dispatch_snapshot.transport_contract_hash:
        raise RemoteAuthorizationError("authorization transport does not match task")
    if snapshot.grant_core.dispatch_class != dispatch_snapshot.dispatch_class:
        raise RemoteAuthorizationError("authorization dispatch class does not match task")
    if (
        snapshot.grant_core.requested_additional_budget_micros
        != dispatch_snapshot.requested_additional_budget_micros
        or snapshot.grant_core.approved_currency != dispatch_snapshot.approved_currency
        or snapshot.grant_core.policy_version != dispatch_snapshot.policy_version
    ):
        raise RemoteAuthorizationError("authorization policy does not match task")
    if consumed:
        # Latest event carries the only valid attempt and lease fence for this grant.
        if snapshot.authorization_id != snapshot.grant_core.authorization_id:
            raise RemoteAuthorizationError("authorization identity mismatch")
    del claim


def _event(
    connection: sqlite3.Connection,
    factory: Callable[[str], str],
    claim: ClaimedTask,
    entity_kind: Literal["node", "attempt", "task"],
    entity_id: str,
    from_status: str,
    to_status: str,
    reason: str,
    now_text: str,
) -> None:
    append_event(
        connection,
        factory,
        entity_kind,
        entity_id,
        from_status,
        to_status,
        reason,
        now_text,
        actor_kind="worker",
        actor_id=claim.lease_owner,
        lease_generation=claim.lease_generation,
    )


class _DispatchScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class _RemoteDispatchSnapshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    connection_id: str = Field(pattern=r"^pcn_[0-9a-f]{32}$")
    connection_revision: int = Field(ge=1, le=2_147_483_647)
    approved_model_id: str = Field(min_length=1, max_length=256)
    endpoint_binding: str = Field(pattern=r"^CPA_LOOPBACK_V1$")
    transport_contract_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    dispatch_class: str = Field(pattern=r"^(FORMAL_CONTENT_EXECUTION|SYNTHETIC_CAPABILITY_PROBE)$")
    requested_additional_budget_micros: int = Field(ge=0)
    approved_currency: str = Field(pattern=r"^USD$")
    policy_version: str = Field(min_length=1, max_length=128)
    context_manifest_id: str = Field(pattern=r"^ctx_[0-9a-f]{32}$")
    context_manifest_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class _FormalDispatchScope(_DispatchScope):
    input_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    context_manifest_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    accepted_manifest_version_id: str = Field(min_length=1, max_length=128)
    accepted_manifest_content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_document_id: str = Field(min_length=1, max_length=128)
    source_block_ids: list[str] = Field(min_length=1, max_length=10_000)
    span_bounds: list[list[int]] = Field(min_length=1, max_length=10_000)


class _SyntheticProbeScope(_DispatchScope):
    synthetic_bytes_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    probe_scope: str = Field(min_length=1, max_length=256)


def _validated_dispatch_scope(
    dispatch_class: str, scope: Mapping[str, object]
) -> dict[str, object]:
    try:
        validated: _DispatchScope
        if dispatch_class == "FORMAL_CONTENT_EXECUTION":
            validated = _FormalDispatchScope.model_validate(dict(scope))
            for start, end in validated.span_bounds:
                if start < 0 or end <= start:
                    raise ValueError("formal scope span bounds are invalid")
        elif dispatch_class == "SYNTHETIC_CAPABILITY_PROBE":
            validated = _SyntheticProbeScope.model_validate(dict(scope))
        else:
            raise ValueError("unsupported remote dispatch class")
    except (TypeError, ValidationError, ValueError) as error:
        raise ValueError("remote dispatch scope is malformed") from error
    return validated.model_dump(mode="json")


def _freeze_dispatch_scope(value: object) -> object:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {str(key): _freeze_dispatch_scope(item) for key, item in value.items()}
        )
    if isinstance(value, list):
        return tuple(_freeze_dispatch_scope(item) for item in value)
    return value


def _json_ready(value: object) -> object:
    if isinstance(value, Mapping):
        return {str(key): _json_ready(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_json_ready(item) for item in value]
    return value
