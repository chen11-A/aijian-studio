"""Explicit human adoption/rejection, preserving immutable proposals and script pins."""

from __future__ import annotations

from typing import TYPE_CHECKING

from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.official_director_contracts import (
    AdoptOfficialDirectorRequest,
    OfficialDirectorOperation,
    OfficialDirectorProposal,
    RejectOfficialDirectorRequest,
)
from aijian_api.shot_plan_projection import project_storyboard
from aijian_api.shot_plan_validation import resolve_authority, storyboard_base, validate_coverage
from aijian_api.task_ledger_models import timestamp

if TYPE_CHECKING:
    from aijian_api.official_director_store import OfficialDirectorStore


def require_proposal(
    operation: OfficialDirectorOperation, payload: AdoptOfficialDirectorRequest, actor: str
) -> OfficialDirectorProposal:
    from aijian_api.official_director_store import OfficialDirectorError

    if not actor.strip() or len(actor) > 240 or "\x00" in actor:
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_IDENTITY_INVALID", 422)
    proposal = operation.proposal
    if proposal is None or operation.status != "COMPLETED":
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_NOT_ADOPTABLE", 422)
    if (proposal.version_id, proposal.content_hash) != (
        payload.proposal_version_id,
        payload.proposal_content_hash,
    ):
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_PROPOSAL_MISMATCH", 422)
    return proposal


def adopt_director(
    store: OfficialDirectorStore,
    project: str,
    episode: str,
    operation_id: str,
    payload: AdoptOfficialDirectorRequest,
    actor: str,
) -> tuple[OfficialDirectorOperation, bool]:
    from aijian_api.official_director_store import OfficialDirectorError

    payload = AdoptOfficialDirectorRequest.model_validate(payload.model_dump(mode="json"))
    with store.connection(write=True) as connection:
        operation = store.read_in_connection(connection, project, episode, operation_id)
        proposal = require_proposal(operation, payload, actor)
        if operation.rejection is not None:
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_REJECTED")
        if operation.adoption is not None:
            if operation.adoption.actor_id != actor:
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
            return operation, True
        plan = proposal.content.projection_input()
        if any(
            issue.severity == "BLOCKING" for issue in (*plan.issues, *proposal.capability_losses)
        ):
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_BLOCKING_ISSUES", 422)
        latest = connection.execute(
            "SELECT h.latest_version_id FROM artifact_versions v "
            "JOIN artifact_heads h ON h.artifact_id = v.artifact_id WHERE v.version_id = ?",
            (proposal.version_id,),
        ).fetchone()
        if latest["latest_version_id"] != proposal.version_id:
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_PROPOSAL_STALE")
        script, _ = resolve_authority(
            store.repository, connection, project, episode, plan.authority, require_current=True
        )
        if storyboard_base(store.repository, connection, project, episode) != plan.storyboard_base:
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_STORYBOARD_STALE")
        validate_coverage(plan, script)
        try:
            projected = project_storyboard(plan, script)
        except ValueError as error:
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_PROJECTION_UNSUPPORTED", 422) from error
        base = plan.storyboard_base
        storyboard_store = EpisodeStoryboardStore(store.repository)

        def verify(candidate: ArtifactVersionRecord) -> None:
            storyboard_store._verified_version_data(
                candidate, project_id=project, episode_id=episode, connection=connection
            )

        storyboard = store.repository.create_artifact_version(
            project_id=project,
            episode_id=episode,
            artifact_type="episode_storyboard",
            schema_version="1.0.0",
            content=projected.model_dump(mode="json"),
            author_actor_type="human",
            author_actor_id=actor,
            change_summary=f"人工采纳官方 AI 导演提案 {proposal.version_id}",
            parent_version_id=base.version_id if base else None,
            expected_revision=base.head_revision if base else None,
            dependencies=(
                ArtifactDependencyDraft(
                    upstream_version_id=plan.authority.script.version_id,
                    relationship="derived_from",
                    impact="blocking",
                ),
            ),
            record_validator=verify,
            _transaction_connection=connection,
            _manage_transaction=False,
        )
        store.checkpoint("storyboard_created")
        connection.execute(
            """INSERT INTO official_director_adoptions(operation_id, proposal_version_id,
            proposal_content_hash, storyboard_version_id, storyboard_content_hash, actor_id,
            adopted_at) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                operation_id,
                proposal.version_id,
                proposal.content_hash,
                storyboard.version.id,
                storyboard.version.content_hash,
                actor,
                timestamp(store.clock()),
            ),
        )
        store.checkpoint("adoption_recorded")
        return store.read_in_connection(connection, project, episode, operation_id), False


def reject_director(
    store: OfficialDirectorStore,
    project: str,
    episode: str,
    operation_id: str,
    payload: RejectOfficialDirectorRequest,
    actor: str,
) -> tuple[OfficialDirectorOperation, bool]:
    from aijian_api.official_director_store import OfficialDirectorError

    payload = RejectOfficialDirectorRequest.model_validate(payload.model_dump(mode="json"))
    with store.connection(write=True) as connection:
        operation = store.read_in_connection(connection, project, episode, operation_id)
        proposal = require_proposal(operation, payload, actor)
        if operation.adoption is not None:
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_ALREADY_ADOPTED")
        if operation.rejection is not None:
            if (
                operation.rejection.actor_id != actor
                or operation.rejection.reason != payload.reason
            ):
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
            return operation, True
        connection.execute(
            """INSERT INTO official_director_rejections(operation_id, proposal_version_id,
            proposal_content_hash, actor_id, reason, rejected_at) VALUES (?, ?, ?, ?, ?, ?)""",
            (
                operation_id,
                proposal.version_id,
                proposal.content_hash,
                actor,
                payload.reason,
                timestamp(store.clock()),
            ),
        )
        store.checkpoint("rejection_recorded")
        return store.read_in_connection(connection, project, episode, operation_id), False
