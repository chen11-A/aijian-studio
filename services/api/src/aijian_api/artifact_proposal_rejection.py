"""Atomic, idempotent named-human rejection of one ArtifactProposal."""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import cast

from pydantic import ValidationError

from aijian_api.agent_run_store import AgentRunBundleConflictError
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.application_errors import ArtifactProposalNotFoundError, ProposalRunNotFoundError
from aijian_api.artifact_proposal_rejection_input import (
    ArtifactProposalRejectionReason,
    normalize_rejection_comment,
)
from aijian_api.artifact_proposal_review_truth import (
    ArtifactProposalReviewConflictError,
    read_proposal_review_identity,
    read_reviewable_proposal_truth,
    validate_proposal_review_run_chain,
)
from aijian_api.artifact_proposal_store import (
    PROPOSAL_TRUTH_SELECT,
    ArtifactProposalConflictError,
    decode_persisted_proposal_row,
)
from aijian_api.domain import TrustedReviewActor
from aijian_api.task_ledger_events import EventEntityKind, append_event
from aijian_api.task_ledger_models import new_id, parse_datetime, timestamp, utc_now


class ArtifactProposalRejectionConflictError(ValueError):
    """A proposal cannot be rejected under the requested immutable intent."""


@dataclass(frozen=True, slots=True)
class ArtifactProposalRejection:
    rejection_id: str
    project_id: str
    proposal_id: str
    proposal_hash: str
    reason_code: ArtifactProposalRejectionReason
    comment: str
    actor_id: str
    rejected_at: datetime
    replayed: bool


class ArtifactProposalRejectionService:
    def __init__(
        self,
        database_path: Path,
        transaction_hook: Callable[[str], None] | None = None,
    ) -> None:
        self._database_path = database_path
        self._transaction_hook = transaction_hook

    def _after(self, phase: str) -> None:
        if self._transaction_hook is not None:
            self._transaction_hook(phase)

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def reject(
        self,
        *,
        project_id: str,
        proposal_id: str,
        idempotency_key: str,
        actor: TrustedReviewActor,
        reason_code: ArtifactProposalRejectionReason,
        comment: str,
    ) -> ArtifactProposalRejection:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise ArtifactProposalRejectionConflictError("Idempotency-Key is required and bounded")
        normalized_comment = normalize_rejection_comment(comment)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            proposal_row = connection.execute(
                PROPOSAL_TRUTH_SELECT + " WHERE proposal.proposal_id = ?",
                (proposal_id,),
            ).fetchone()
            if proposal_row is None or str(proposal_row["project_id"]) != project_id:
                raise ArtifactProposalNotFoundError("ArtifactProposal was not found")
            persisted = decode_persisted_proposal_row(proposal_row)
            client_key_hash = canonical_sha256({"idempotency_key": idempotency_key})
            request_hash = canonical_sha256(
                {
                    "operation": "REJECT",
                    "project_id": project_id,
                    "proposal_id": proposal_id,
                    "proposal_hash": persisted.proposal_hash,
                    "reason_code": reason_code,
                    "comment": normalized_comment,
                    "actor_id": actor.subject_id,
                    "actor_roles": sorted(actor.roles),
                }
            )
            replay = connection.execute(
                """
                SELECT * FROM artifact_proposal_rejections
                WHERE project_id = ? AND client_key_hash = ?
                """,
                (project_id, client_key_hash),
            ).fetchone()
            if replay is not None:
                if (
                    str(replay["proposal_id"]) != proposal_id
                    or str(replay["request_hash"]) != request_hash
                    or str(replay["proposal_hash"]) != persisted.proposal_hash
                    or str(replay["actor_id"]) != actor.subject_id
                ):
                    raise ArtifactProposalRejectionConflictError(
                        "Idempotency-Key was reused with different rejection input"
                    )
                connection.commit()
                return _rejection_from_row(replay, replayed=True)
            if (
                connection.execute(
                    "SELECT 1 FROM artifact_proposal_rejections WHERE proposal_id = ?",
                    (proposal_id,),
                ).fetchone()
                is not None
            ):
                raise ArtifactProposalRejectionConflictError(
                    "ArtifactProposal already has a rejection"
                )
            if (
                connection.execute(
                    "SELECT 1 FROM artifact_proposal_draft_acceptances WHERE proposal_id = ?",
                    (proposal_id,),
                ).fetchone()
                is not None
            ):
                raise ArtifactProposalRejectionConflictError(
                    "ArtifactProposal already has a draft acceptance"
                )

            identity = read_proposal_review_identity(
                connection,
                project_id=project_id,
                persisted=persisted,
            )
            validate_proposal_review_run_chain(persisted=persisted, identity=identity)
            review_truth = read_reviewable_proposal_truth(
                connection,
                project_id=project_id,
                proposal_row=proposal_row,
                persisted=persisted,
                identity=identity,
            )
            node_count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM workflow_node_runs WHERE workflow_run_id = ?",
                    (review_truth.workflow_run_id,),
                ).fetchone()[0]
            )
            if node_count != 1:
                raise ArtifactProposalRejectionConflictError(
                    "ArtifactProposal rejection supports only the frozen single-node workflow"
                )

            now = utc_now()
            now_text = timestamp(now)
            rejection_id = new_id("pdr")
            connection.execute(
                """
                INSERT INTO artifact_proposal_rejections (
                    rejection_id, project_id, proposal_id, client_key_hash,
                    request_hash, proposal_hash, reason_code, comment, actor_id,
                    actor_roles_json, rejected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rejection_id,
                    project_id,
                    proposal_id,
                    client_key_hash,
                    request_hash,
                    persisted.proposal_hash,
                    reason_code,
                    normalized_comment,
                    actor.subject_id,
                    json.dumps(sorted(actor.roles), separators=(",", ":")),
                    now_text,
                ),
            )
            self._after("rejection")
            attempt = connection.execute(
                """
                UPDATE workflow_attempts
                SET status = 'FAILED', retry_disposition = 'NON_RETRYABLE',
                    error_code = 'PROPOSAL_REJECTED_BY_REVIEWER', finished_at = ?,
                    revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'RUNNING' AND revision = ?
                  AND output_version_id IS NULL
                RETURNING revision
                """,
                (
                    now_text,
                    now_text,
                    persisted.producer_attempt_id,
                    review_truth.attempt_revision,
                ),
            ).fetchone()
            node = connection.execute(
                """
                UPDATE workflow_node_runs
                SET status = 'FAILED', revision = revision + 1, updated_at = ?
                WHERE node_run_id = ? AND status = 'NEEDS_REVIEW'
                  AND active_attempt_id = ? AND revision = ?
                  AND output_version_id IS NULL
                RETURNING revision
                """,
                (
                    now_text,
                    review_truth.node_run_id,
                    persisted.producer_attempt_id,
                    review_truth.node_revision,
                ),
            ).fetchone()
            agent = connection.execute(
                """
                UPDATE agent_runs
                SET status = 'FAILED', revision = revision + 1, updated_at = ?
                WHERE project_id = ? AND agent_run_id = ?
                  AND status = 'NEEDS_REVIEW' AND revision = ?
                """,
                (
                    now_text,
                    project_id,
                    persisted.proposal.producer_agent_run_id,
                    identity.run_bundle.agent_revision,
                ),
            )
            skill = connection.execute(
                """
                UPDATE skill_runs
                SET status = 'FAILED', revision = revision + 1, updated_at = ?
                WHERE project_id = ? AND skill_run_id = ?
                  AND status = 'NEEDS_REVIEW' AND proposal_id = ? AND revision = ?
                """,
                (
                    now_text,
                    project_id,
                    persisted.proposal.producer_skill_run_id,
                    proposal_id,
                    identity.run_bundle.skill_revision,
                ),
            )
            workflow = connection.execute(
                """
                UPDATE workflow_runs
                SET status = 'FAILED', revision = revision + 1, updated_at = ?
                WHERE workflow_run_id = ? AND status = 'ACTIVE' AND revision = ?
                """,
                (
                    now_text,
                    review_truth.workflow_run_id,
                    review_truth.workflow_revision,
                ),
            )
            if (
                attempt is None
                or node is None
                or agent.rowcount != 1
                or skill.rowcount != 1
                or workflow.rowcount != 1
            ):
                raise ArtifactProposalRejectionConflictError(
                    "ArtifactProposal state changed during rejection"
                )
            self._after("run_statuses")
            events: tuple[tuple[EventEntityKind, str, str], ...] = (
                ("attempt", persisted.producer_attempt_id, "RUNNING"),
                ("node", review_truth.node_run_id, "NEEDS_REVIEW"),
            )
            for entity_kind, entity_id, from_status in events:
                append_event(
                    connection,
                    new_id,
                    entity_kind,
                    entity_id,
                    from_status,
                    "FAILED",
                    "proposal.rejected",
                    now_text,
                    actor_kind="human",
                    actor_id=actor.subject_id,
                )
            self._after("events")
            connection.commit()
            return ArtifactProposalRejection(
                rejection_id=rejection_id,
                project_id=project_id,
                proposal_id=proposal_id,
                proposal_hash=persisted.proposal_hash,
                reason_code=reason_code,
                comment=normalized_comment,
                actor_id=actor.subject_id,
                rejected_at=now,
                replayed=False,
            )
        except ArtifactProposalReviewConflictError as error:
            connection.rollback()
            raise ArtifactProposalRejectionConflictError(str(error)) from error
        except (
            ArtifactProposalConflictError,
            AgentRunBundleConflictError,
            ProposalRunNotFoundError,
            ValidationError,
        ) as error:
            connection.rollback()
            raise ArtifactProposalRejectionConflictError(
                "ArtifactProposal frozen rejection truth is unavailable"
            ) from error
        except sqlite3.IntegrityError as error:
            connection.rollback()
            raise ArtifactProposalRejectionConflictError(
                "ArtifactProposal rejection violated an invariant"
            ) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _rejection_from_row(row: sqlite3.Row, *, replayed: bool) -> ArtifactProposalRejection:
    return ArtifactProposalRejection(
        rejection_id=str(row["rejection_id"]),
        project_id=str(row["project_id"]),
        proposal_id=str(row["proposal_id"]),
        proposal_hash=str(row["proposal_hash"]),
        reason_code=cast(ArtifactProposalRejectionReason, str(row["reason_code"])),
        comment=str(row["comment"]),
        actor_id=str(row["actor_id"]),
        rejected_at=parse_datetime(str(row["rejected_at"])),
        replayed=replayed,
    )
