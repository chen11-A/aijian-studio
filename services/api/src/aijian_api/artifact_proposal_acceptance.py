"""Atomic, idempotent acceptance of one ArtifactProposal as an immutable DRAFT."""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from aijian_api.agent_proposal_validator import (
    ProposalSchemaNotFoundError,
    ProposalSchemaRegistry,
    ProposalValidationError,
    prepare_proposal_draft,
)
from aijian_api.agent_run_store import (
    AgentRunBundleConflictError,
)
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.agent_skill_registry import (
    AgentSkillRegistry,
    DefinitionDisabledError,
    DefinitionIncompatibleError,
    DefinitionNotFoundError,
)
from aijian_api.application_errors import (
    ArtifactProposalNotFoundError,
    ProposalRunNotFoundError,
)
from aijian_api.artifact_proposal_review_truth import (
    ArtifactProposalReviewConflictError,
    read_proposal_review_identity,
    read_reviewable_proposal_truth,
)
from aijian_api.artifact_proposal_store import (
    PROPOSAL_TRUTH_SELECT,
    ArtifactProposalConflictError,
    decode_persisted_proposal_row,
)
from aijian_api.domain import TrustedReviewActor
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    SourceSpanInvalidError,
    StudioRepository,
)
from aijian_api.task_ledger_events import EventEntityKind, append_event
from aijian_api.task_ledger_models import new_id, parse_datetime, timestamp, utc_now


class ArtifactProposalAcceptanceConflictError(ValueError):
    """A proposal cannot be accepted under the requested immutable intent."""


@dataclass(frozen=True, slots=True)
class ArtifactProposalDraftAcceptance:
    acceptance_id: str
    project_id: str
    proposal_id: str
    draft_version_id: str
    actor_id: str
    accepted_as_draft_at: datetime
    replayed: bool


class ArtifactProposalAcceptanceService:
    def __init__(
        self,
        repository: StudioRepository,
        agent_skill_registry: AgentSkillRegistry,
        proposal_schema_registry: ProposalSchemaRegistry,
        transaction_hook: Callable[[str], None] | None = None,
    ) -> None:
        self._repository = repository
        self._database_path: Path = repository.database_path
        self._agent_skill_registry = agent_skill_registry
        self._proposal_schema_registry = proposal_schema_registry
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

    def accept_as_draft(
        self,
        *,
        project_id: str,
        proposal_id: str,
        idempotency_key: str,
        actor: TrustedReviewActor,
        parent_version_id: str | None,
        expected_head_revision: int | None,
    ) -> ArtifactProposalDraftAcceptance:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise ArtifactProposalAcceptanceConflictError("Idempotency-Key is required and bounded")
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
            proposal = persisted.proposal
            client_key_hash = canonical_sha256({"idempotency_key": idempotency_key})
            request_hash = canonical_sha256(
                {
                    "project_id": project_id,
                    "proposal_id": proposal_id,
                    "proposal_hash": persisted.proposal_hash,
                    "parent_version_id": parent_version_id,
                    "expected_head_revision": expected_head_revision,
                    "actor_id": actor.subject_id,
                    "actor_roles": sorted(actor.roles),
                }
            )
            replay = connection.execute(
                """
                SELECT * FROM artifact_proposal_draft_acceptances
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
                    raise ArtifactProposalAcceptanceConflictError(
                        "Idempotency-Key was reused with different acceptance input"
                    )
                connection.commit()
                return _acceptance_from_row(replay, replayed=True)
            previous = connection.execute(
                "SELECT 1 FROM artifact_proposal_draft_acceptances WHERE proposal_id = ?",
                (proposal_id,),
            ).fetchone()
            if previous is not None:
                raise ArtifactProposalAcceptanceConflictError(
                    "ArtifactProposal already has a draft acceptance"
                )

            review_identity = read_proposal_review_identity(
                connection,
                project_id=project_id,
                persisted=persisted,
            )
            run_bundle = review_identity.run_bundle
            delegation = self._agent_skill_registry.resolve_delegation(
                run_bundle.agent_run.agent_definition,
                run_bundle.skill_run.skill_definition,
            )
            proposal_schema = self._proposal_schema_registry.resolve(
                delegation.skill_definition.output_schema_ref
            )
            prepared = prepare_proposal_draft(
                proposal=proposal,
                agent_run=run_bundle.agent_run,
                skill_run=run_bundle.skill_run,
                delegation=delegation,
                proposal_schema=proposal_schema,
                parent_version_id=parent_version_id,
                expected_revision=expected_head_revision,
            )
            review_truth = read_reviewable_proposal_truth(
                connection,
                project_id=project_id,
                proposal_row=proposal_row,
                persisted=persisted,
                identity=review_identity,
            )

            record = self._repository._create_artifact_version_in_connection(
                connection,
                project_id=project_id,
                artifact_type=prepared.artifact_type,
                schema_version=prepared.schema_version,
                content=prepared.content,
                author_actor_type="agent",
                author_actor_id=proposal.producer_skill_run_id,
                change_summary=f"Agent proposal {proposal_id} accepted as DRAFT",
                parent_version_id=parent_version_id,
                expected_revision=expected_head_revision,
                source_spans=prepared.source_spans,
                dependencies=prepared.dependencies,
                accepted_dependency_requirements=prepared.accepted_dependency_requirements,
                required_accepted_upstream_version_id=(
                    prepared.required_accepted_upstream_version_id
                ),
                record_validator=prepared.record_validator,
                producer_attempt_id=persisted.producer_attempt_id,
            )
            self._after("draft_version")
            now = utc_now()
            now_text = timestamp(now)
            acceptance_id = new_id("pda")
            connection.execute(
                """
                INSERT INTO artifact_proposal_draft_acceptances (
                    acceptance_id, project_id, proposal_id, client_key_hash,
                    request_hash, proposal_hash, draft_version_id, actor_id,
                    actor_roles_json, accepted_as_draft_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    acceptance_id,
                    project_id,
                    proposal_id,
                    client_key_hash,
                    request_hash,
                    persisted.proposal_hash,
                    record.version.id,
                    actor.subject_id,
                    json.dumps(sorted(actor.roles), separators=(",", ":")),
                    now_text,
                ),
            )
            self._after("acceptance")
            attempt = connection.execute(
                """
                UPDATE workflow_attempts
                SET status = 'SUCCEEDED', output_version_id = ?, finished_at = ?,
                    revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'RUNNING' AND revision = ?
                RETURNING revision
                """,
                (
                    record.version.id,
                    now_text,
                    now_text,
                    persisted.producer_attempt_id,
                    review_truth.attempt_revision,
                ),
            ).fetchone()
            node = connection.execute(
                """
                UPDATE workflow_node_runs
                SET status = 'SUCCEEDED', output_version_id = ?,
                    revision = revision + 1, updated_at = ?
                WHERE node_run_id = ? AND status = 'NEEDS_REVIEW'
                  AND active_attempt_id = ? AND revision = ?
                RETURNING revision
                """,
                (
                    record.version.id,
                    now_text,
                    review_truth.node_run_id,
                    persisted.producer_attempt_id,
                    review_truth.node_revision,
                ),
            ).fetchone()
            agent = connection.execute(
                """
                UPDATE agent_runs
                SET status = 'SUCCEEDED', revision = revision + 1, updated_at = ?
                WHERE project_id = ? AND agent_run_id = ?
                  AND status = 'NEEDS_REVIEW' AND revision = ?
                """,
                (
                    now_text,
                    project_id,
                    proposal.producer_agent_run_id,
                    run_bundle.agent_revision,
                ),
            )
            skill = connection.execute(
                """
                UPDATE skill_runs
                SET status = 'SUCCEEDED', revision = revision + 1, updated_at = ?
                WHERE project_id = ? AND skill_run_id = ?
                  AND status = 'NEEDS_REVIEW' AND proposal_id = ? AND revision = ?
                """,
                (
                    now_text,
                    project_id,
                    proposal.producer_skill_run_id,
                    proposal_id,
                    run_bundle.skill_revision,
                ),
            )
            if attempt is None or node is None or agent.rowcount != 1 or skill.rowcount != 1:
                raise ArtifactProposalAcceptanceConflictError(
                    "ArtifactProposal state changed during draft acceptance"
                )
            self._after("run_statuses")
            connection.execute(
                """
                UPDATE workflow_runs
                SET status = 'SUCCEEDED', revision = revision + 1, updated_at = ?
                WHERE workflow_run_id = ? AND status = 'ACTIVE' AND revision = ?
                  AND NOT EXISTS (
                    SELECT 1 FROM workflow_node_runs
                    WHERE workflow_run_id = ?
                      AND status NOT IN ('SUCCEEDED', 'SUPERSEDED')
                  )
                """,
                (
                    now_text,
                    review_truth.workflow_run_id,
                    review_truth.workflow_revision,
                    review_truth.workflow_run_id,
                ),
            )
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
                    "SUCCEEDED",
                    "proposal.accepted_as_draft",
                    now_text,
                    actor_kind="human",
                    actor_id=actor.subject_id,
                )
            self._after("events")
            connection.commit()
            return ArtifactProposalDraftAcceptance(
                acceptance_id=acceptance_id,
                project_id=project_id,
                proposal_id=proposal_id,
                draft_version_id=record.version.id,
                actor_id=actor.subject_id,
                accepted_as_draft_at=now,
                replayed=False,
            )
        except (
            ArtifactConflictError,
            ArtifactDependencyInvalidError,
            SourceSpanInvalidError,
        ) as error:
            connection.rollback()
            raise ProposalValidationError("ArtifactProposal DRAFT validation failed") from error
        except ArtifactProposalReviewConflictError as error:
            connection.rollback()
            raise ArtifactProposalAcceptanceConflictError(str(error)) from error
        except (
            ArtifactProposalConflictError,
            AgentRunBundleConflictError,
            ProposalSchemaNotFoundError,
            ProposalRunNotFoundError,
            ValidationError,
            DefinitionDisabledError,
            DefinitionIncompatibleError,
            DefinitionNotFoundError,
        ) as error:
            connection.rollback()
            raise ArtifactProposalAcceptanceConflictError(
                "ArtifactProposal frozen acceptance truth is unavailable"
            ) from error
        except sqlite3.IntegrityError as error:
            connection.rollback()
            raise ArtifactProposalAcceptanceConflictError(
                "ArtifactProposal acceptance violated an invariant"
            ) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _acceptance_from_row(
    row: sqlite3.Row,
    *,
    replayed: bool,
) -> ArtifactProposalDraftAcceptance:
    return ArtifactProposalDraftAcceptance(
        acceptance_id=str(row["acceptance_id"]),
        project_id=str(row["project_id"]),
        proposal_id=str(row["proposal_id"]),
        draft_version_id=str(row["draft_version_id"]),
        actor_id=str(row["actor_id"]),
        accepted_as_draft_at=parse_datetime(str(row["accepted_as_draft_at"])),
        replayed=replayed,
    )
