"""Single-call Sub2API evidence store sharing the workflow and proposal database."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from aijian_api.agent_skill_contracts import ArtifactProposalV2, canonical_sha256
from aijian_api.contracts import CreateProposalRunRequest
from aijian_api.provider_contracts import (
    Sub2APIOriginMode,
    sub2api_origin_binding,
    validate_sub2api_origin,
)
from aijian_api.repository import StudioRepository
from aijian_api.sub2api_source_extract_contracts import (
    Sub2APICallApprovalData,
    Sub2APIUnknownCostV1,
    Sub2APISourceExtractRunData,
    Sub2APISourceExtractScopeData,
    Sub2APISourceExtractSelectionData,
)
from aijian_api.sub2api_source_extract_policy import (
    Sub2APICallApprovalV1,
    Sub2APIDispatchFacts,
    match_sub2api_approval,
)
from aijian_api.task_ledger_agent_runs import (
    mark_agent_skill_run_failed,
    mark_agent_skill_run_needs_review,
)
from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import ClaimedTask, LeaseLostError, new_id, timestamp, utc_now
from aijian_api.task_ledger_snapshots import (
    canonical_snapshot_json,
    read_agent_skill_snapshot,
    read_agent_skill_snapshot_for_attempt,
)


class Sub2APISourceExtractConflictError(ValueError):
    """The requested call is not allowed by the persisted exact-scope truth."""


class Sub2APISourceExtractNotFoundError(LookupError):
    """No Sub2API run or approval belongs to the requested project and run."""


@dataclass(frozen=True, slots=True)
class Sub2APISourceExtractScopeDraft:
    selection: Sub2APISourceExtractSelectionData
    source: CreateProposalRunRequest
    origin_hash: str
    origin_mode: Sub2APIOriginMode
    input_hash: str
    context_manifest_id: str
    context_manifest_hash: str
    accepted_manifest_content_hash: str
    source_span_id: str
    excerpt_sha256: str

    def payload(self, *, project_id: str, task_id: str, attempt_id: str,
                attempt_fingerprint: str) -> dict[str, object]:
        scope = Sub2APISourceExtractScopeData(
            project_id=project_id,
            task_id=task_id,
            attempt_id=attempt_id,
            selection=self.selection,
            source=self.source,
            origin_hash=self.origin_hash,
            origin_mode=self.origin_mode,
            input_hash=self.input_hash,
            context_manifest_hash=self.context_manifest_hash,
            attempt_fingerprint=attempt_fingerprint,
        )
        return {
            **scope.model_dump(mode="json"),
            "context_manifest_id": self.context_manifest_id,
            "accepted_manifest_content_hash": self.accepted_manifest_content_hash,
            "source_span_id": self.source_span_id,
            "excerpt_sha256": self.excerpt_sha256,
        }


@dataclass(frozen=True, slots=True)
class Sub2APIDispatchPermit:
    claim: ClaimedTask
    approval_id: str
    connection_id: str
    connection_revision: int
    model_id: str
    origin_hash: str
    origin_mode: Sub2APIOriginMode
    input_hash: str
    context_manifest_hash: str
    lease_token_hash: str


def insert_sub2api_scope_in_connection(
    connection: sqlite3.Connection, *, draft: Sub2APISourceExtractScopeDraft,
    project_id: str, task_id: str, attempt_id: str,
    attempt_fingerprint: str, now_text: str,
) -> None:
    """Called by ledger enqueue before its transaction commits."""
    payload = draft.payload(project_id=project_id, task_id=task_id,
                            attempt_id=attempt_id,
                            attempt_fingerprint=attempt_fingerprint)
    if payload["input_hash"] != _attempt_field(connection, attempt_id, "input_hash"):
        raise Sub2APISourceExtractConflictError("scope input differs from attempt")
    if payload["attempt_fingerprint"] != _attempt_field(connection, attempt_id, "request_fingerprint"):
        raise Sub2APISourceExtractConflictError("scope fingerprint differs from attempt")
    if not all(_hash_ok(str(payload[key])) for key in (
        "accepted_manifest_content_hash", "excerpt_sha256",
    )):
        raise Sub2APISourceExtractConflictError("scope source hashes are invalid")
    _assert_frozen_source(connection, payload)
    metadata = connection.execute(
        "SELECT * FROM provider_connections WHERE connection_id = ?",
        (draft.selection.connection_id,),
    ).fetchone()
    if metadata is None or str(metadata["provider_kind"]) != "SUB2API" or int(metadata["enabled"]) != 1:
        raise Sub2APISourceExtractConflictError("Sub2API connection is unavailable")
    if int(metadata["revision"]) != draft.selection.connection_revision:
        raise Sub2APISourceExtractConflictError("Sub2API connection revision changed")
    validate_sub2api_origin(str(metadata["base_url"]), str(metadata["origin_mode"]))
    if draft.origin_mode != str(metadata["origin_mode"]) or draft.origin_hash != canonical_sha256(
        sub2api_origin_binding(
            str(metadata["base_url"]), str(metadata["origin_mode"]),
            int(metadata["revision"]),
        )
    ):
        raise Sub2APISourceExtractConflictError("Sub2API origin differs from frozen scope")
    if _model_capabilities(metadata, draft.selection.model_id) != ("TEXT",):
        raise Sub2APISourceExtractConflictError("Sub2API model is not text-only")
    scope_json = canonical_snapshot_json(payload)
    connection.execute(
        """INSERT INTO sub2api_source_extract_scopes (
             task_id, attempt_id, project_id, scope_json, scope_hash,
             connection_id, connection_revision, model_id, origin_hash,
             input_hash, context_manifest_hash, attempt_fingerprint, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (task_id, attempt_id, project_id, scope_json, canonical_sha256(payload),
         draft.selection.connection_id, draft.selection.connection_revision,
         draft.selection.model_id, draft.origin_hash, draft.input_hash,
         draft.context_manifest_hash, attempt_fingerprint, now_text),
    )


def assert_existing_sub2api_scope(
    connection: sqlite3.Connection, *, draft: Sub2APISourceExtractScopeDraft,
    project_id: str, task_id: str, attempt_id: str,
    attempt_fingerprint: str,
) -> None:
    expected = draft.payload(project_id=project_id, task_id=task_id,
                             attempt_id=attempt_id,
                             attempt_fingerprint=attempt_fingerprint)
    row = connection.execute(
        "SELECT scope_json, scope_hash FROM sub2api_source_extract_scopes WHERE task_id = ? AND attempt_id = ?",
        (task_id, attempt_id),
    ).fetchone()
    if row is None or str(row["scope_json"]) != canonical_snapshot_json(expected) or str(row["scope_hash"]) != canonical_sha256(expected):
        raise Sub2APISourceExtractConflictError("idempotent Sub2API scope differs")


class Sub2APISourceExtractStore:
    def __init__(self, database_path: Path, *, clock: Callable[[], datetime] = utc_now) -> None:
        self._database_path = database_path
        self._clock = clock
        StudioRepository(database_path)

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def read_scope(self, *, project_id: str, task_id: str) -> Sub2APISourceExtractScopeData:
        connection = self._open()
        try:
            row = connection.execute(
                "SELECT * FROM sub2api_source_extract_scopes WHERE project_id = ? AND task_id = ?",
                (project_id, task_id),
            ).fetchone()
            if row is None:
                raise Sub2APISourceExtractConflictError("Sub2API scope was not found")
            payload = _verified_scope(row)
            return _scope_contract(payload)
        finally:
            connection.close()

    def read_operation(self, *, project_id: str, run_id: str) -> Sub2APISourceExtractRunData:
        connection = self._open()
        try:
            row = _read_run_row(connection, project_id=project_id, run_id=run_id)
            scope = _scope_contract(_verified_scope(row))
            proposal_id: str | None = None
            observation_status = row["observation_status"]
            if observation_status == "PROPOSAL_READY":
                if (str(row["response_content_type"]) != "application/json"
                        or row["raw_response_body"] is None
                        or str(row["raw_response_sha256"]) != (
                            "sha256:" + hashlib.sha256(bytes(row["raw_response_body"])).hexdigest()
                        )):
                    raise Sub2APISourceExtractConflictError("response body evidence is invalid")
                proposal_id = str(row["observation_proposal_id"])
                from aijian_api.artifact_proposal_store import (
                    PROPOSAL_TRUTH_SELECT, decode_persisted_proposal_row,
                )
                proposal_row = connection.execute(
                    PROPOSAL_TRUTH_SELECT +
                    " WHERE proposal.proposal_id = ? AND proposal.project_id = ? AND proposal.producer_attempt_id = ?",
                    (proposal_id, project_id, scope.attempt_id),
                ).fetchone()
                if proposal_row is None:
                    raise Sub2APISourceExtractConflictError("proposal observation has no original proposal")
                persisted = decode_persisted_proposal_row(proposal_row)
                if not isinstance(persisted.proposal, ArtifactProposalV2):
                    raise Sub2APISourceExtractConflictError("Sub2API observation references a non-V2 proposal")
                content_status = "PROPOSAL_READY"
            elif (observation_status == "REMOTE_UNKNOWN"
                  or str(row["attempt_status"]) == "REMOTE_UNKNOWN"
                  or row["consumed_approval_id"] is not None):
                content_status = "REMOTE_UNKNOWN"
            elif str(row["attempt_status"]) == "FAILED":
                content_status = "FAILED"
            else:
                content_status = "PENDING"
            return Sub2APISourceExtractRunData(
                scope=scope, attempt_status=str(row["attempt_status"]),
                approval_id=(str(row["approval_id"]) if row["approval_id"] is not None else None),
                proposal_id=proposal_id, content_status=content_status,
                cost=Sub2APIUnknownCostV1(budget_enforcement="UNENFORCED"),
                automatic_retry_allowed=False,
            )
        finally:
            connection.close()

    def read_approval(self, *, project_id: str, run_id: str) -> Sub2APICallApprovalData:
        connection = self._open()
        try:
            row = _read_run_row(connection, project_id=project_id, run_id=run_id)
            if row["approval_id"] is None:
                raise Sub2APISourceExtractNotFoundError("Sub2API approval was not found")
            approval = _verified_approval(row)
            scope = _scope_contract(_verified_scope(row))
            if (approval.project_id != project_id or approval.task_id != scope.task_id
                    or approval.attempt_id != scope.attempt_id
                    or approval.connection_id != scope.selection.connection_id
                    or approval.connection_revision != scope.selection.connection_revision
                    or approval.model_id != scope.selection.model_id
                    or approval.origin_mode != scope.origin_mode
                    or approval.origin_hash != scope.origin_hash
                    or approval.input_hash != scope.input_hash
                    or approval.context_manifest_hash != scope.context_manifest_hash):
                raise Sub2APISourceExtractConflictError("approval differs from frozen run scope")
            now = self._clock()
            status = (
                "CONSUMED" if row["consumed_approval_id"] is not None
                else "REVOKED" if row["revoked_at"] is not None
                else "EXPIRED" if now >= approval.expires_at
                else "APPROVED_ONE_CALL"
            )
            return Sub2APICallApprovalData(
                approval_id=approval.approval_id, scope=scope, status=status,
                approved_at=approval.approved_at, expires_at=approval.expires_at,
                allowed_calls=1, cost_decision="UNKNOWN_COST_ACCEPTED",
                cost=Sub2APIUnknownCostV1(budget_enforcement="UNENFORCED"),
            )
        finally:
            connection.close()

    def next_ready(self, *, exclude_task_ids: frozenset[str]):
        """Read-only scheduler hint; begin_sub2api_dispatch remains authority."""
        from aijian_api.sub2api_source_extract_runtime import AuthorizedSub2APITask

        now_text = timestamp(self._clock())
        connection = self._open()
        try:
            rows = connection.execute(
                """SELECT approval.*, task.status AS task_status, task.available_at,
                          attempt.status AS attempt_status, scope.scope_json, scope.scope_hash,
                          scope.connection_id, scope.connection_revision,
                          scope.model_id, scope.origin_hash, scope.input_hash,
                          scope.context_manifest_hash, scope.attempt_fingerprint
                   FROM sub2api_call_approvals AS approval
                   JOIN sub2api_source_extract_scopes AS scope ON scope.task_id = approval.task_id
                   JOIN task_ledger AS task ON task.task_id = scope.task_id
                   JOIN workflow_attempts AS attempt ON attempt.attempt_id = scope.attempt_id
                   LEFT JOIN sub2api_call_consumptions AS consume
                     ON consume.attempt_id = scope.attempt_id
                   WHERE task.task_kind = 'sub2api.source.extract'
                     AND task.status = 'READY' AND task.available_at <= ?
                     AND attempt.status = 'READY' AND approval.revoked_at IS NULL
                     AND approval.expires_at > ? AND consume.attempt_id IS NULL
                   ORDER BY task.priority DESC, task.available_at, task.task_id
                   LIMIT 32""",
                (now_text, now_text),
            ).fetchall()
            for row in rows:
                if str(row["task_id"]) in exclude_task_ids:
                    continue
                _verified_scope(row)
                approval = _verified_approval(row)
                return AuthorizedSub2APITask(
                    task_id=approval.task_id, approval_id=approval.approval_id,
                    connection_id=approval.connection_id,
                    connection_revision=approval.connection_revision,
                )
            return None
        finally:
            connection.close()

    def issue_approval(
        self, *, project_id: str, task_id: str, attempt_id: str,
        expected_attempt_fingerprint: str, actor_id: str,
        idempotency_key: str, expires_at: datetime | None = None,
    ) -> Sub2APICallApprovalV1:
        if not actor_id.strip() or not idempotency_key.strip() or len(idempotency_key) > 240:
            raise Sub2APISourceExtractConflictError("trusted actor and idempotency key are required")
        now = self._clock()
        expiry = expires_at or now + timedelta(minutes=15)
        now_text = timestamp(now)
        expiry_text = timestamp(expiry)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """SELECT scope.*, task.task_kind, task.status AS task_status,
                          attempt.status AS attempt_status, attempt.execution_mode,
                          attempt.dispatch_started_at
                   FROM sub2api_source_extract_scopes AS scope
                   JOIN task_ledger AS task ON task.task_id = scope.task_id
                   JOIN workflow_attempts AS attempt ON attempt.attempt_id = scope.attempt_id
                   WHERE scope.project_id = ? AND scope.task_id = ? AND scope.attempt_id = ?""",
                (project_id, task_id, attempt_id),
            ).fetchone()
            if row is None or str(row["attempt_fingerprint"]) != expected_attempt_fingerprint:
                raise Sub2APISourceExtractConflictError("approval scope changed")
            scope = _scope_contract(_verified_scope(row))
            metadata = connection.execute(
                "SELECT * FROM provider_connections WHERE connection_id = ?",
                (scope.selection.connection_id,),
            ).fetchone()
            if (
                metadata is None
                or str(metadata["provider_kind"]) != "SUB2API"
                or int(metadata["enabled"]) != 1
                or int(metadata["revision"]) != scope.selection.connection_revision
                or str(metadata["origin_mode"]) != scope.origin_mode
                or canonical_sha256(
                    sub2api_origin_binding(
                        str(metadata["base_url"]), scope.origin_mode,
                        int(metadata["revision"]),
                    )
                ) != scope.origin_hash
            ):
                raise Sub2APISourceExtractConflictError("approval origin binding changed")
            key_hash = canonical_sha256({"idempotency_key": idempotency_key})
            previous = connection.execute(
                "SELECT * FROM sub2api_call_approvals WHERE task_id = ? OR (project_id = ? AND idempotency_key_hash = ?)",
                (task_id, project_id, key_hash),
            ).fetchone()
            if previous is not None:
                if (str(previous["task_id"]) != task_id or str(previous["attempt_id"]) != attempt_id
                        or str(previous["actor_id"]) != actor_id or str(previous["idempotency_key_hash"]) != key_hash):
                    raise Sub2APISourceExtractConflictError("approval intent was reused")
                approval = _verified_approval(previous)
                connection.commit()
                return approval
            _assert_frozen_source(connection, json.loads(str(row["scope_json"])))
            if (str(row["task_kind"]) != "sub2api.source.extract"
                    or str(row["execution_mode"]) != "remote"
                    or str(row["task_status"]) not in {"READY", "LEASED"}
                    or str(row["attempt_status"]) not in {"READY", "LEASED", "RUNNING"}
                    or row["dispatch_started_at"] is not None):
                raise Sub2APISourceExtractConflictError("attempt is not approvable")
            if connection.execute("SELECT 1 FROM sub2api_call_consumptions WHERE attempt_id = ?", (attempt_id,)).fetchone():
                raise Sub2APISourceExtractConflictError("call already consumed")
            approval = Sub2APICallApprovalV1(
                approval_id=new_id("sap"), project_id=project_id, task_id=task_id,
                attempt_id=attempt_id, connection_id=str(row["connection_id"]),
                connection_revision=int(row["connection_revision"]),
                model_id=str(row["model_id"]), origin_hash=str(row["origin_hash"]),
                origin_mode=scope.origin_mode,
                input_hash=str(row["input_hash"]),
                context_manifest_hash=str(row["context_manifest_hash"]),
                allowed_calls=1, cost_decision="UNKNOWN_COST_ACCEPTED",
                approved_at=now, expires_at=expiry,
            )
            payload = approval.model_dump(mode="json")
            connection.execute(
                """INSERT INTO sub2api_call_approvals (
                     approval_id, task_id, attempt_id, project_id, approval_json,
                     approval_hash, idempotency_key_hash, actor_id, approved_at, expires_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (approval.approval_id, task_id, attempt_id, project_id,
                 canonical_snapshot_json(payload), canonical_sha256(payload),
                 key_hash, actor_id, now_text, expiry_text),
            )
            connection.commit()
            return approval
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def begin_sub2api_dispatch(self, *, claim: ClaimedTask, approval_id: str) -> Sub2APIDispatchPermit:
        now = self._clock()
        now_text = timestamp(now)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = _read_claim_scope(connection, claim, now_text=now_text, expected_status="RUNNING")
            scope = _scope_contract(_verified_scope(row))
            _assert_frozen_source(connection, json.loads(str(row["scope_json"])))
            approval_row = connection.execute(
                "SELECT * FROM sub2api_call_approvals WHERE approval_id = ? AND task_id = ? AND attempt_id = ?",
                (approval_id, claim.task_id, claim.attempt_id),
            ).fetchone()
            approval = _verified_approval(approval_row) if approval_row is not None else None
            metadata = connection.execute(
                "SELECT * FROM provider_connections WHERE connection_id = ?",
                (str(row["connection_id"]),),
            ).fetchone()
            if metadata is None:
                raise Sub2APISourceExtractConflictError("provider connection is missing")
            facts = Sub2APIDispatchFacts(
                project_id=str(row["project_id"]), task_id=claim.task_id,
                attempt_id=claim.attempt_id, connection_id=str(row["connection_id"]),
                connection_revision=int(metadata["revision"]),
                provider_kind=str(metadata["provider_kind"]),
                connection_enabled=bool(metadata["enabled"]),
                base_url=str(metadata["base_url"]),
                origin_mode=str(metadata["origin_mode"]),
                model_id=str(row["model_id"]),
                model_capabilities=_model_capabilities(metadata, str(row["model_id"])),
                input_hash=str(row["input_hash"]),
                context_manifest_hash=str(row["context_manifest_hash"]),
                attempt_status=str(row["attempt_status"]), task_kind=str(row["task_kind"]),
            )
            match = match_sub2api_approval(approval=approval, facts=facts, now=now)
            if (
                match.status != "MATCHED"
                or approval_row is None
                or approval_row["revoked_at"] is not None
                or approval is None
                or approval.origin_mode != scope.origin_mode
                or approval.origin_hash != scope.origin_hash
            ):
                raise Sub2APISourceExtractConflictError(
                    match.code if match.status != "MATCHED" else "APPROVAL_SCOPE_MISMATCH"
                )
            if (int(row["connection_revision"]) != int(metadata["revision"])
                    or connection.execute("SELECT 1 FROM sub2api_call_consumptions WHERE attempt_id = ?", (claim.attempt_id,)).fetchone()):
                raise Sub2APISourceExtractConflictError("approval was consumed or connection changed")
            token_hash = canonical_sha256({"lease_token": claim.lease_token})
            connection.execute(
                """INSERT INTO sub2api_call_consumptions (
                     attempt_id, task_id, approval_id, lease_generation, lease_token_hash, consumed_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                (claim.attempt_id, claim.task_id, approval_id,
                 claim.lease_generation, token_hash, now_text),
            )
            updated = connection.execute(
                """UPDATE workflow_attempts
                   SET status = 'SUBMITTING', dispatch_started_at = ?,
                       revision = revision + 1, updated_at = ?
                   WHERE attempt_id = ? AND status = 'RUNNING' AND revision = ?
                     AND dispatch_started_at IS NULL RETURNING revision""",
                (now_text, now_text, claim.attempt_id, claim.attempt_revision),
            ).fetchone()
            if updated is None:
                raise LeaseLostError("attempt changed during Sub2API consume")
            append_event(connection, new_id, "attempt", claim.attempt_id,
                         "RUNNING", "SUBMITTING", "sub2api.call.consumed", now_text,
                         actor_kind="worker", actor_id=claim.lease_owner,
                         lease_generation=claim.lease_generation)
            connection.commit()
            from dataclasses import replace
            return Sub2APIDispatchPermit(
                claim=replace(claim, attempt_revision=int(updated["revision"])),
                approval_id=approval_id, connection_id=str(row["connection_id"]),
                connection_revision=int(row["connection_revision"]),
                model_id=str(row["model_id"]), origin_hash=str(row["origin_hash"]),
                origin_mode=scope.origin_mode,
                input_hash=str(row["input_hash"]),
                context_manifest_hash=str(row["context_manifest_hash"]),
                lease_token_hash=token_hash,
            )
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def quarantine_unknown(self, *, permit: Sub2APIDispatchPermit,
                           provider_response_id: str | None, code: str) -> None:
        if not code.strip() or len(code) > 120:
            raise ValueError("bounded quarantine code is required")
        if provider_response_id is not None and not 1 <= len(provider_response_id) <= 512:
            raise ValueError("bounded provider response ID is required")
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now_text = timestamp(self._clock())
            _assert_consumed_permit(connection, permit)
            prior = connection.execute(
                "SELECT * FROM sub2api_call_observations WHERE attempt_id = ?",
                (permit.claim.attempt_id,),
            ).fetchone()
            if prior is not None:
                if (str(prior["status"]) == "REMOTE_UNKNOWN"
                        and prior["provider_response_id"] == provider_response_id
                        and str(prior["code"]) == code):
                    connection.commit()
                    return
                raise Sub2APISourceExtractConflictError("call already has a different observation")
            connection.execute(
                """INSERT INTO sub2api_call_observations
                   (attempt_id, status, provider_response_id, code, observed_at)
                   VALUES (?, 'REMOTE_UNKNOWN', ?, ?, ?)""",
                (permit.claim.attempt_id, provider_response_id, code, now_text),
            )
            _quarantine_workflow(connection, permit.claim, now_text=now_text, code=code)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def record_candidate(self, *, permit: Sub2APIDispatchPermit,
                         proposal: ArtifactProposalV2,
                         provider_response_id: str, raw_output_text: str,
                         raw_output_sha256: str,
                         raw_response_body: bytes,
                         raw_response_sha256: str,
                         usage_tokens: tuple[int | None, int | None, int | None] | None) -> str:
        if (not provider_response_id.strip() or len(provider_response_id) > 512
                or not _hash_ok(raw_output_sha256)):
            raise Sub2APISourceExtractConflictError("response evidence is incomplete")
        if raw_output_sha256 != "sha256:" + hashlib.sha256(raw_output_text.encode("utf-8")).hexdigest():
            raise Sub2APISourceExtractConflictError("response hash does not match bytes")
        usage_json = _validate_raw_response(
            raw_response_body, raw_response_sha256,
            provider_response_id=provider_response_id,
            model_id=permit.model_id, raw_output_text=raw_output_text,
            usage_tokens=usage_tokens,
        )
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now_text = timestamp(self._clock())
            _assert_consumed_permit(connection, permit)
            row = _read_claim_scope(connection, permit.claim, now_text=now_text,
                                    expected_status="SUBMITTING")
            proposal = ArtifactProposalV2.model_validate(proposal.model_dump(mode="json"))
            if (proposal.approval_id != permit.approval_id
                    or proposal.project_id != str(row["project_id"])):
                raise Sub2APISourceExtractConflictError("proposal approval or project differs")
            source_scope = json.loads(str(row["scope_json"]))
            source = source_scope["source"]
            if (len(proposal.source_spans) != 1
                    or proposal.source_spans[0].source_span_id != source_scope["source_span_id"]
                    or proposal.source_spans[0].source_document_id != source["source_document_id"]
                    or proposal.source_spans[0].source_block_id != source["source_block_id"]
                    or proposal.source_spans[0].start_byte != source["start_byte"]
                    or proposal.source_spans[0].end_byte != source["end_byte"]
                    or proposal.source_spans[0].quote_hash != source_scope["excerpt_sha256"]):
                raise Sub2APISourceExtractConflictError("proposal source span differs from frozen scope")
            if connection.execute("SELECT 1 FROM sub2api_call_observations WHERE attempt_id = ?", (permit.claim.attempt_id,)).fetchone():
                raise Sub2APISourceExtractConflictError("call already has an observation")
            from aijian_api.artifact_proposal_store import persist_sub2api_v2_in_connection
            persisted = persist_sub2api_v2_in_connection(
                connection, claim=permit.claim, proposal=proposal,
                approval_id=permit.approval_id, now_text=now_text,
            )
            connection.execute(
                """INSERT INTO sub2api_call_observations (
                     attempt_id, status, provider_response_id, raw_output_sha256,
                     response_content_type, raw_response_body, raw_response_sha256,
                     usage_tokens_json, proposal_id, observed_at
                   ) VALUES (?, 'PROPOSAL_READY', ?, ?, 'application/json', ?, ?, ?, ?, ?)""",
                (permit.claim.attempt_id, provider_response_id, raw_output_sha256,
                 raw_response_body, raw_response_sha256, usage_json,
                 proposal.proposal_id, now_text),
            )
            snapshot = read_agent_skill_snapshot(connection, permit.claim, now_text=now_text)
            mark_agent_skill_run_needs_review(connection, snapshot,
                                              proposal_id=proposal.proposal_id,
                                              now_text=now_text)
            attempt = connection.execute(
                """UPDATE workflow_attempts SET status = 'REMOTE_REVIEW_PENDING',
                     provider_response_id = ?, revision = revision + 1, updated_at = ?
                   WHERE attempt_id = ? AND status = 'SUBMITTING' AND revision = ?
                   RETURNING revision""",
                (provider_response_id, now_text, permit.claim.attempt_id,
                 permit.claim.attempt_revision),
            ).fetchone()
            node = connection.execute(
                """UPDATE workflow_node_runs SET status = 'NEEDS_REVIEW',
                     revision = revision + 1, updated_at = ?
                   WHERE node_run_id = ? AND workflow_run_id = ? AND status = 'RUNNING'
                     AND active_attempt_id = ? AND revision = ? RETURNING revision""",
                (now_text, permit.claim.node_run_id, permit.claim.workflow_run_id,
                 permit.claim.attempt_id, permit.claim.node_revision),
            ).fetchone()
            task = connection.execute(
                """UPDATE task_ledger SET status = 'COMPLETED',
                     revision = revision + 1, updated_at = ?
                   WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
                     AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
                     AND revision = ? AND lease_expires_at > ? RETURNING revision""",
                (now_text, permit.claim.task_id, permit.claim.attempt_id,
                 permit.claim.lease_owner, permit.claim.lease_token,
                 permit.claim.lease_generation, permit.claim.task_revision,
                 now_text),
            ).fetchone()
            if attempt is None or node is None or task is None:
                raise LeaseLostError("Sub2API result arrived after lease/state change")
            append_event(connection, new_id, "attempt", permit.claim.attempt_id,
                         "SUBMITTING", "REMOTE_REVIEW_PENDING", "sub2api.proposal.ready", now_text,
                         actor_kind="worker", actor_id=permit.claim.lease_owner,
                         lease_generation=permit.claim.lease_generation)
            append_event(connection, new_id, "node", permit.claim.node_run_id,
                         "RUNNING", "NEEDS_REVIEW", "sub2api.proposal.ready", now_text,
                         actor_kind="worker", actor_id=permit.claim.lease_owner,
                         lease_generation=permit.claim.lease_generation)
            append_event(connection, new_id, "task", permit.claim.task_id,
                         "LEASED", "COMPLETED", "sub2api.proposal.ready", now_text,
                         actor_kind="worker", actor_id=permit.claim.lease_owner,
                         lease_generation=permit.claim.lease_generation)
            connection.commit()
            return persisted.proposal.proposal_id
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def fail_before_dispatch(self, *, claim: ClaimedTask, code: str) -> None:
        if not code.strip() or len(code) > 120:
            raise ValueError("bounded failure code is required")
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now_text = timestamp(self._clock())
            _read_claim_scope(connection, claim, now_text=now_text,
                              expected_status="RUNNING")
            if connection.execute("SELECT 1 FROM sub2api_call_consumptions WHERE attempt_id = ?", (claim.attempt_id,)).fetchone():
                raise Sub2APISourceExtractConflictError("cannot fail a consumed call as pre-dispatch")
            snapshot = read_agent_skill_snapshot(connection, claim, now_text=now_text)
            mark_agent_skill_run_failed(connection, snapshot, now_text=now_text)
            _finish_failed(connection, claim, now_text=now_text, code=code)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _verified_scope(row: sqlite3.Row) -> dict[str, object]:
    try:
        payload = json.loads(str(row["scope_json"]))
        if not isinstance(payload, dict) or canonical_snapshot_json(payload) != str(row["scope_json"]):
            raise ValueError("scope JSON is not canonical")
        if canonical_sha256(payload) != str(row["scope_hash"]):
            raise ValueError("scope hash mismatch")
        scope = _scope_contract(payload)
        if (scope.task_id != str(row["task_id"]) or scope.attempt_id != str(row["attempt_id"])
                or scope.project_id != str(row["project_id"])
                or scope.selection.connection_id != str(row["connection_id"])
                or scope.selection.connection_revision != int(row["connection_revision"])
                or scope.selection.model_id != str(row["model_id"])
                or scope.origin_hash != str(row["origin_hash"])
                or scope.input_hash != str(row["input_hash"])
                or scope.context_manifest_hash != str(row["context_manifest_hash"])
                or scope.attempt_fingerprint != str(row["attempt_fingerprint"])):
            raise ValueError("scope columns differ")
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise Sub2APISourceExtractConflictError("frozen Sub2API scope is invalid") from error


def _verified_approval(row: sqlite3.Row) -> Sub2APICallApprovalV1:
    try:
        payload = json.loads(str(row["approval_json"]))
        if canonical_snapshot_json(payload) != str(row["approval_json"]) or canonical_sha256(payload) != str(row["approval_hash"]):
            raise ValueError("approval canonical hash mismatch")
        approval = Sub2APICallApprovalV1.model_validate(payload)
        if (approval.approval_id != str(row["approval_id"])
                or approval.project_id != str(row["project_id"])
                or approval.task_id != str(row["task_id"])
                or approval.attempt_id != str(row["attempt_id"])):
            raise ValueError("approval columns differ")
        return approval
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise Sub2APISourceExtractConflictError("persisted Sub2API approval is invalid") from error


def _scope_contract(payload: dict[str, object]) -> Sub2APISourceExtractScopeData:
    return Sub2APISourceExtractScopeData.model_validate({
        key: payload[key] for key in Sub2APISourceExtractScopeData.model_fields if key in payload
    })


def _read_run_row(connection: sqlite3.Connection, *, project_id: str,
                  run_id: str) -> sqlite3.Row:
    row = connection.execute(
        """SELECT scope.*, attempt.status AS attempt_status,
                  approval.approval_id, approval.approval_json, approval.approval_hash,
                  approval.revoked_at, consume.approval_id AS consumed_approval_id,
                  observation.status AS observation_status,
                  observation.proposal_id AS observation_proposal_id,
                  observation.response_content_type,
                  observation.raw_response_body,
                  observation.raw_response_sha256
           FROM agent_runs AS agent
           JOIN workflow_attempt_snapshots AS snapshot
             ON json_extract(snapshot.snapshot_json, '$.agent_run_id') = agent.agent_run_id
           JOIN sub2api_source_extract_scopes AS scope ON scope.attempt_id = snapshot.attempt_id
           JOIN workflow_attempts AS attempt ON attempt.attempt_id = scope.attempt_id
           JOIN task_ledger AS task ON task.task_id = scope.task_id
           LEFT JOIN sub2api_call_approvals AS approval ON approval.task_id = scope.task_id
           LEFT JOIN sub2api_call_consumptions AS consume ON consume.attempt_id = scope.attempt_id
           LEFT JOIN sub2api_call_observations AS observation ON observation.attempt_id = scope.attempt_id
           WHERE agent.project_id = ? AND agent.agent_run_id = ?
             AND scope.project_id = agent.project_id
             AND task.task_kind = 'sub2api.source.extract'
           LIMIT 2""",
        (project_id, run_id),
    ).fetchall()
    if not row:
        raise Sub2APISourceExtractNotFoundError("Sub2API run was not found")
    if len(row) != 1:
        raise Sub2APISourceExtractConflictError("Sub2API run has ambiguous scope")
    snapshot = read_agent_skill_snapshot_for_attempt(connection, str(row[0]["attempt_id"]))
    if snapshot.project_id != project_id or snapshot.agent_run_id != run_id:
        raise Sub2APISourceExtractConflictError("run snapshot differs from requested identity")
    return row[0]


def _read_claim_scope(connection: sqlite3.Connection, claim: ClaimedTask, *,
                      now_text: str, expected_status: str) -> sqlite3.Row:
    row = connection.execute(
        """SELECT scope.*, task.task_kind, task.status AS task_status,
                  attempt.status AS attempt_status, attempt.execution_mode,
                  attempt.revision AS attempt_revision, attempt.input_hash AS attempt_input_hash,
                  attempt.request_fingerprint, node.status AS node_status,
                  node.active_attempt_id, node.revision AS node_revision,
                  run.workflow_run_id, run.project_id AS run_project_id
           FROM sub2api_source_extract_scopes AS scope
           JOIN task_ledger AS task ON task.task_id = scope.task_id
           JOIN workflow_attempts AS attempt ON attempt.attempt_id = scope.attempt_id
           JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
           JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
           WHERE task.task_id = ? AND task.attempt_id = ? AND task.status = 'LEASED'
             AND task.lease_owner = ? AND task.lease_token = ?
             AND task.lease_generation = ? AND task.revision = ?
             AND task.lease_expires_at > ?""",
        (claim.task_id, claim.attempt_id, claim.lease_owner, claim.lease_token,
         claim.lease_generation, claim.task_revision, now_text),
    ).fetchone()
    if row is None:
        raise LeaseLostError("Sub2API claim is stale or expired")
    _verified_scope(row)
    if (claim.task_kind != "sub2api.source.extract"
            or str(row["task_kind"]) != claim.task_kind
            or str(row["execution_mode"]) != "remote"
            or str(row["attempt_status"]) != expected_status
            or int(row["attempt_revision"]) != claim.attempt_revision
            or str(row["node_status"]) != "RUNNING"
            or str(row["active_attempt_id"]) != claim.attempt_id
            or int(row["node_revision"]) != claim.node_revision
            or str(row["workflow_run_id"]) != claim.workflow_run_id
            or str(row["run_project_id"]) != str(row["project_id"])
            or str(row["attempt_input_hash"]) != str(row["input_hash"])
            or str(row["request_fingerprint"]) != str(row["attempt_fingerprint"])):
        raise Sub2APISourceExtractConflictError("Sub2API claim differs from workflow truth")
    return row


def _assert_consumed_permit(connection: sqlite3.Connection, permit: Sub2APIDispatchPermit) -> None:
    row = connection.execute(
        """SELECT * FROM sub2api_call_consumptions WHERE attempt_id = ? AND task_id = ?
             AND approval_id = ?""",
        (permit.claim.attempt_id, permit.claim.task_id, permit.approval_id),
    ).fetchone()
    if (row is None or int(row["lease_generation"]) != permit.claim.lease_generation
            or str(row["lease_token_hash"]) != permit.lease_token_hash
            or permit.lease_token_hash != canonical_sha256({"lease_token": permit.claim.lease_token})):
        raise Sub2APISourceExtractConflictError("Sub2API permit is not the consumed call")


def _model_capabilities(metadata: sqlite3.Row, model_id: str) -> tuple[str, ...]:
    try:
        models = json.loads(str(metadata["models_json"]))
        if not isinstance(models, list):
            return ()
        for model in models:
            if isinstance(model, dict) and model.get("model_id") == model_id:
                capabilities = model.get("capabilities")
                if isinstance(capabilities, list) and all(isinstance(value, str) for value in capabilities):
                    return tuple(capabilities)
    except (TypeError, ValueError):
        pass
    return ()


def _attempt_field(connection: sqlite3.Connection, attempt_id: str, field: str) -> str:
    row = connection.execute(f"SELECT {field} FROM workflow_attempts WHERE attempt_id = ?", (attempt_id,)).fetchone()
    if row is None:
        raise Sub2APISourceExtractConflictError("attempt is missing")
    return str(row[field])


def _hash_ok(value: str) -> bool:
    return len(value) == 71 and value.startswith("sha256:") and all(c in "0123456789abcdef" for c in value[7:])


def _validate_raw_response(
    body: bytes, digest: str, *, provider_response_id: str,
    model_id: str, raw_output_text: str,
    usage_tokens: tuple[int | None, int | None, int | None] | None,
) -> str | None:
    """Persist only an exact, bounded text completion body with closed metadata."""
    if (type(body) is not bytes or not 1 <= len(body) <= 1024 * 1024
            or not _hash_ok(digest)
            or digest != "sha256:" + hashlib.sha256(body).hexdigest()):
        raise Sub2APISourceExtractConflictError("raw response body/hash is invalid")
    try:
        payload = json.loads(
            body.decode("utf-8"),
            object_pairs_hook=_unique_json_object,
            parse_constant=_reject_json_constant,
        )
        if (not isinstance(payload, dict)
                or not {"id", "model", "choices"}.issubset(payload)
                or set(payload) - {
                    "id", "model", "choices", "usage", "object", "created",
                    "system_fingerprint", "service_tier",
                }
                or payload["id"] != provider_response_id
                or payload["model"] != model_id
                or not isinstance(payload["choices"], list)
                or len(payload["choices"]) != 1):
            raise ValueError("response envelope is not allowlisted")
        choice = payload["choices"][0]
        if (not isinstance(choice, dict)
                or set(choice) - {"index", "message", "finish_reason", "logprobs"}
                or not isinstance(choice.get("message"), dict)):
            raise ValueError("response choice is not allowlisted")
        message = choice["message"]
        if (set(message) - {"role", "content", "refusal", "reasoning_content", "reasoning"}
                or message.get("role") != "assistant"
                or message.get("content") != raw_output_text
                or message.get("refusal") not in (None, "")):
            raise ValueError("response message differs from extracted text")
        for name in ("reasoning_content", "reasoning"):
            if name in message and (
                not isinstance(message[name], str)
                or len(message[name].encode("utf-8")) > 256 * 1024
            ):
                raise ValueError("response reasoning field exceeds the local bound")
        if ("index" in choice and (type(choice["index"]) is not int or choice["index"] != 0)):
            raise ValueError("response choice index is invalid")
        if ("logprobs" in choice and choice["logprobs"] is not None):
            raise ValueError("response logprobs cannot be persisted")
        if ("finish_reason" in choice and choice["finish_reason"] is not None
                and (not isinstance(choice["finish_reason"], str)
                     or len(choice["finish_reason"]) > 120)):
            raise ValueError("response finish reason is invalid")
        if ("object" in payload and payload["object"] != "chat.completion"):
            raise ValueError("response object kind is invalid")
        if ("created" in payload and
                (type(payload["created"]) is not int or payload["created"] < 0)):
            raise ValueError("response created time is invalid")
        if ("system_fingerprint" in payload and payload["system_fingerprint"] is not None
                and (not isinstance(payload["system_fingerprint"], str)
                     or len(payload["system_fingerprint"]) > 120)):
            raise ValueError("response fingerprint is invalid")
        if "service_tier" in payload and (
            not isinstance(payload["service_tier"], str)
            or not 1 <= len(payload["service_tier"]) <= 80
            or not all(ch.isascii() and (ch.isalnum() or ch in "._-") for ch in payload["service_tier"])
        ):
            raise ValueError("response service tier is invalid")
        usage = payload.get("usage")
        if usage is None:
            if usage_tokens is not None:
                raise ValueError("usage tuple differs from response")
            return None
        if (not isinstance(usage, dict)
                or set(usage) - {
                    "prompt_tokens", "completion_tokens", "total_tokens",
                    "prompt_tokens_details", "completion_tokens_details",
                }):
            raise ValueError("response usage is not allowlisted")
        _validate_usage_details(
            usage.get("prompt_tokens_details"),
            allowed={"cached_tokens", "audio_tokens", "cache_creation_tokens", "cache_write_tokens"},
        )
        _validate_usage_details(
            usage.get("completion_tokens_details"),
            allowed={
                "reasoning_tokens", "audio_tokens", "accepted_prediction_tokens",
                "rejected_prediction_tokens",
            },
        )
        values = tuple(usage.get(key) for key in (
            "prompt_tokens", "completion_tokens", "total_tokens",
        ))
        if (values != usage_tokens or any(
                value is not None and (type(value) is not int or value < 0 or value > 10**12)
                for value in values)):
            raise ValueError("usage tuple differs from response")
        return canonical_snapshot_json({
            "prompt_tokens": values[0], "completion_tokens": values[1],
            "total_tokens": values[2],
        })
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError) as error:
        raise Sub2APISourceExtractConflictError("raw response is not a safe text completion") from error


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate response JSON key")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> object:
    raise ValueError(f"non-finite JSON value: {value}")


def _validate_usage_details(value: object, *, allowed: set[str]) -> None:
    if value is None:
        return
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError("token details contain unsupported keys")
    if any(type(count) is not int or not 0 <= count <= 10**12 for count in value.values()):
        raise ValueError("token detail counts are invalid")


def _assert_frozen_source(connection: sqlite3.Connection,
                          scope: dict[str, object]) -> None:
    """Fence the accepted source and exact UTF-8 excerpt inside the transaction."""
    source = scope.get("source")
    if not isinstance(source, dict):
        raise Sub2APISourceExtractConflictError("source coordinates are missing")
    context = connection.execute(
        """SELECT project_id, manifest_hash FROM agent_context_manifests
           WHERE context_manifest_id = ?""",
        (scope.get("context_manifest_id"),),
    ).fetchone()
    accepted = connection.execute(
        """SELECT version.content_hash
           FROM artifacts AS artifact
           JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
           JOIN artifact_versions AS version ON version.version_id = head.accepted_version_id
           WHERE artifact.project_id = ? AND artifact.artifact_type = 'source_manifest'
             AND version.version_id = ?""",
        (scope.get("project_id"), source.get("source_manifest_version_id")),
    ).fetchone()
    document = connection.execute(
        """SELECT normalized_text FROM source_documents
           WHERE project_id = ? AND id = ?""",
        (scope.get("project_id"), source.get("source_document_id")),
    ).fetchone()
    block = connection.execute(
        """SELECT normalized_start_byte, normalized_end_byte FROM source_blocks
           WHERE project_id = ? AND source_document_id = ? AND id = ?""",
        (scope.get("project_id"), source.get("source_document_id"),
         source.get("source_block_id")),
    ).fetchone()
    if (context is None or str(context["project_id"]) != scope.get("project_id")
            or str(context["manifest_hash"]) != scope.get("context_manifest_hash")
            or accepted is None
            or str(accepted["content_hash"]) != scope.get("accepted_manifest_content_hash")
            or document is None or block is None):
        raise Sub2APISourceExtractConflictError("accepted source context changed")
    try:
        start = source["start_byte"]
        end = source["end_byte"]
        if (type(start) is not int or type(end) is not int
                or start < int(block["normalized_start_byte"])
                or end > int(block["normalized_end_byte"])
                or start >= end):
            raise ValueError("source range changed")
        excerpt = str(document["normalized_text"]).encode("utf-8")[start:end]
        excerpt.decode("utf-8", errors="strict")
    except (KeyError, ValueError, UnicodeDecodeError) as error:
        raise Sub2APISourceExtractConflictError("frozen source range is invalid") from error
    if "sha256:" + hashlib.sha256(excerpt).hexdigest() != scope.get("excerpt_sha256"):
        raise Sub2APISourceExtractConflictError("frozen source bytes changed")


def _quarantine_workflow(connection: sqlite3.Connection, claim: ClaimedTask, *,
                         now_text: str, code: str) -> None:
    current = connection.execute(
        """SELECT attempt.status AS attempt_status, node.status AS node_status,
                  task.status AS task_status
           FROM workflow_attempts AS attempt
           JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
           JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
           WHERE attempt.attempt_id = ? AND task.task_id = ?""",
        (claim.attempt_id, claim.task_id),
    ).fetchone()
    if (current is not None and str(current["attempt_status"]) == "REMOTE_UNKNOWN"
            and str(current["node_status"]) == "RECONCILIATION_REQUIRED"
            and str(current["task_status"]) == "COMPLETED"):
        return
    attempt = connection.execute(
        """UPDATE workflow_attempts SET status = 'REMOTE_UNKNOWN',
             retry_disposition = 'REMOTE_UNKNOWN', error_code = ?,
             revision = revision + 1, updated_at = ?
           WHERE attempt_id = ? AND status = 'SUBMITTING' AND revision = ?
           RETURNING revision""",
        (code, now_text, claim.attempt_id, claim.attempt_revision),
    ).fetchone()
    node = connection.execute(
        """UPDATE workflow_node_runs SET status = 'RECONCILIATION_REQUIRED',
             revision = revision + 1, updated_at = ?
           WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
             AND revision = ? RETURNING revision""",
        (now_text, claim.node_run_id, claim.attempt_id, claim.node_revision),
    ).fetchone()
    task = connection.execute(
        """UPDATE task_ledger SET status = 'COMPLETED', revision = revision + 1,
             updated_at = ? WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
             AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
             AND revision = ? RETURNING revision""",
        (now_text, claim.task_id, claim.attempt_id, claim.lease_owner,
         claim.lease_token, claim.lease_generation, claim.task_revision),
    ).fetchone()
    if attempt is None or node is None or task is None:
        raise LeaseLostError("Sub2API quarantine lost its workflow claim")
    for kind, entity_id, before, after in (
        ("attempt", claim.attempt_id, "SUBMITTING", "REMOTE_UNKNOWN"),
        ("node", claim.node_run_id, "RUNNING", "RECONCILIATION_REQUIRED"),
        ("task", claim.task_id, "LEASED", "COMPLETED"),
    ):
        append_event(connection, new_id, kind, entity_id, before, after,
                     "sub2api.call.unknown", now_text, actor_kind="worker",
                     actor_id=claim.lease_owner, lease_generation=claim.lease_generation)


def _finish_failed(connection: sqlite3.Connection, claim: ClaimedTask, *,
                   now_text: str, code: str) -> None:
    attempt = connection.execute(
        """UPDATE workflow_attempts SET status = 'FAILED', error_code = ?,
             retry_disposition = 'NON_RETRYABLE', finished_at = ?,
             revision = revision + 1, updated_at = ?
           WHERE attempt_id = ? AND status = 'RUNNING' AND revision = ?
             AND dispatch_started_at IS NULL RETURNING revision""",
        (code, now_text, now_text, claim.attempt_id, claim.attempt_revision),
    ).fetchone()
    node = connection.execute(
        """UPDATE workflow_node_runs SET status = 'FAILED',
             revision = revision + 1, updated_at = ?
           WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
             AND revision = ? RETURNING revision""",
        (now_text, claim.node_run_id, claim.attempt_id, claim.node_revision),
    ).fetchone()
    task = connection.execute(
        """UPDATE task_ledger SET status = 'COMPLETED', revision = revision + 1,
             updated_at = ? WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
             AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
             AND revision = ? AND lease_expires_at > ? RETURNING revision""",
        (now_text, claim.task_id, claim.attempt_id, claim.lease_owner,
         claim.lease_token, claim.lease_generation, claim.task_revision, now_text),
    ).fetchone()
    workflow = connection.execute(
        """UPDATE workflow_runs SET status = 'FAILED', revision = revision + 1,
             updated_at = ? WHERE workflow_run_id = ? AND status = 'ACTIVE'""",
        (now_text, claim.workflow_run_id),
    )
    if attempt is None or node is None or task is None or workflow.rowcount != 1:
        raise LeaseLostError("Sub2API failure lost its workflow claim")
    for kind, entity_id, before, after in (
        ("attempt", claim.attempt_id, "RUNNING", "FAILED"),
        ("node", claim.node_run_id, "RUNNING", "FAILED"),
        ("task", claim.task_id, "LEASED", "COMPLETED"),
    ):
        append_event(connection, new_id, kind, entity_id, before, after,
                     "sub2api.before_dispatch.failed", now_text, actor_kind="worker",
                     actor_id=claim.lease_owner, lease_generation=claim.lease_generation)
