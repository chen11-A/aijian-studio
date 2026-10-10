"""Fail-closed historical director read proofs, including retained raw completions."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import TYPE_CHECKING, Literal, cast

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.official_director_completion import match_completion, parse_plan, validate_plan
from aijian_api.official_director_constraints import review_director_losses
from aijian_api.official_director_contracts import (
    CompleteOfficialDirectorRequest,
    OfficialDirectorOperation,
    OfficialDirectorPreparedRequest,
    OfficialDirectorProposal,
    OfficialDirectorRejection,
    OfficialDirectorValidationIssue,
)
from aijian_api.official_director_prompt import verify_frozen_request
from aijian_api.shot_plan_contracts import ShotPlanAdoptionData
from aijian_api.shot_plan_projection import project_storyboard
from aijian_api.shot_plan_proposal_store import dependencies
from aijian_api.shot_plan_validation import exact_record, resolve_authority

if TYPE_CHECKING:
    from aijian_api.official_director_store import OfficialDirectorStore


def read_operation(
    store: OfficialDirectorStore,
    connection: sqlite3.Connection,
    project: str,
    episode: str,
    operation_id: str,
) -> OfficialDirectorOperation:
    from aijian_api.official_director_store import OfficialDirectorError, input_version_ids
    from aijian_api.official_director_task import task_truth

    row = connection.execute(
        "SELECT * FROM official_director_operations "
        "WHERE operation_id = ? AND project_id = ? AND episode_id = ?",
        (operation_id, project, episode),
    ).fetchone()
    if row is None:
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_NOT_FOUND", 404)
    try:
        request_json = json.loads(row["request_json"])
        prepared = OfficialDirectorPreparedRequest.model_validate(request_json)
        if (
            prepared.operation_id != operation_id
            or (canonical_content_hash(request_json) != row["request_hash"])
            or prepared.model_dump(mode="json") != request_json
        ):
            raise ValueError("Stored request changed")
        verify_frozen_request(store.repository, connection, project, episode, prepared)
        attempt_status = task_truth(
            connection,
            project,
            row["task_id"],
            row["attempt_id"],
            prepared.profile_id,
            prepared.model,
            prepared.request_hash,
            input_version_ids(prepared),
        )
        completion = None
        if row["completion_json"] is not None:
            completion_json = json.loads(row["completion_json"])
            completion = CompleteOfficialDirectorRequest.model_validate(completion_json)
            if completion.model_dump(mode="json") != completion_json or (
                canonical_content_hash(completion_json) != row["completion_hash"]
            ):
                raise ValueError("Raw completion changed")
            match_completion(prepared, completion)
        issues = tuple(
            OfficialDirectorValidationIssue.model_validate(item)
            for item in json.loads(row["validation_issues_json"])
        )
        proposal = None
        script, brief = resolve_authority(
            store.repository,
            connection,
            project,
            episode,
            prepared.authority,
            require_current=False,
        )
        if row["proposal_version_id"] is not None:
            record = exact_record(
                store.repository,
                connection,
                project,
                episode,
                "official_director_proposal",
                row["proposal_version_id"],
            )
            if completion is None:
                raise ValueError("Proposal has no raw completion")
            content = parse_plan(completion.text)
            validate_plan(store, connection, project, episode, prepared, content)
            author = connection.execute(
                "SELECT author_actor_type, producer_attempt_id FROM artifact_versions "
                "WHERE version_id = ?",
                (record.version.id,),
            ).fetchone()
            expected_dependencies = {
                (item.upstream_version_id, item.relationship, item.impact)
                for item in dependencies(content.projection_input())
            }
            actual_dependencies = {
                (item.upstream_version_id, item.relationship, item.impact)
                for item in record.dependencies
            }
            if record.version.content != content.model_dump(mode="json") or (
                record.version.schema_version != "1.0.0"
                or record.source_spans
                or author["author_actor_type"] != "agent"
                or author["producer_attempt_id"] != row["attempt_id"]
                or record.version.author_actor_id != f"chatgpt-official:{prepared.profile_id}"
                or expected_dependencies != actual_dependencies
                or len(record.dependencies) != len(actual_dependencies)
            ):
                raise ValueError("Proposal provenance changed")
            proposal = OfficialDirectorProposal(
                version_id=record.version.id,
                content_hash=record.version.content_hash,
                content=content,
                capability_losses=review_director_losses(content, script, brief),
            )
        expected_status = {
            "REMOTE_UNKNOWN": "REMOTE_UNKNOWN",
            "COMPLETED": "SUCCEEDED",
            "INVALID": "FAILED",
            "NOT_SENT": "NOT_SUBMITTED",
        }
        attempt = connection.execute(
            "SELECT provider_response_id, output_version_id, error_code FROM workflow_attempts "
            "WHERE attempt_id = ?",
            (row["attempt_id"],),
        ).fetchone()
        if expected_status[row["status"]] != attempt_status or (
            (row["status"] == "COMPLETED") != (proposal is not None)
            or (row["status"] in {"COMPLETED", "INVALID"}) != (completion is not None)
            or (row["status"] == "INVALID") != bool(issues)
            or (row["status"] in {"NOT_SENT", "INVALID"}) != (row["error_code"] is not None)
            or attempt["provider_response_id"] != (completion.response_id if completion else None)
            or attempt["output_version_id"] != (proposal.version_id if proposal else None)
            or attempt["error_code"] != row["error_code"]
        ):
            raise ValueError("Task/completion state changed")
        adoption = None
        adopted = connection.execute(
            "SELECT * FROM official_director_adoptions WHERE operation_id = ?", (operation_id,)
        ).fetchone()
        rejected = connection.execute(
            "SELECT * FROM official_director_rejections WHERE operation_id = ?", (operation_id,)
        ).fetchone()
        if adopted is not None:
            if (
                proposal is None
                or rejected is not None
                or (
                    adopted["proposal_version_id"] != proposal.version_id
                    or adopted["proposal_content_hash"] != proposal.content_hash
                )
            ):
                raise ValueError("Adoption identity changed")
            storyboard = exact_record(
                store.repository,
                connection,
                project,
                episode,
                "episode_storyboard",
                adopted["storyboard_version_id"],
            )
            verified = EpisodeStoryboardStore(store.repository)._verified_version_data(
                storyboard, project_id=project, episode_id=episode, connection=connection
            )
            if verified.content_hash != adopted["storyboard_content_hash"] or (
                verified.content != project_storyboard(proposal.content.projection_input(), script)
                or verified.author_actor_id != adopted["actor_id"]
                or verified.parent_version_id
                != (prepared.storyboard_base.version_id if prepared.storyboard_base else None)
            ):
                raise ValueError("Adopted storyboard changed")
            adoption = ShotPlanAdoptionData(
                **{
                    "proposal_version_id": proposal.version_id,
                    "proposal_content_hash": proposal.content_hash,
                    "storyboard_version_id": verified.version_id,
                    "storyboard_content_hash": verified.content_hash,
                    "actor_id": adopted["actor_id"],
                    "adopted_at": datetime.fromisoformat(
                        adopted["adopted_at"].replace("Z", "+00:00")
                    ),
                }
            )
        rejection = None
        if rejected is not None:
            if (
                proposal is None
                or adopted is not None
                or (
                    rejected["proposal_version_id"] != proposal.version_id
                    or rejected["proposal_content_hash"] != proposal.content_hash
                )
            ):
                raise ValueError("Rejection identity changed")
            rejection = OfficialDirectorRejection(
                actor_id=rejected["actor_id"],
                reason=rejected["reason"],
                rejected_at=rejected["rejected_at"],
            )
        return OfficialDirectorOperation(
            project_id=project,
            episode_id=episode,
            request=prepared,
            status=row["status"],
            error_code=row["error_code"],
            created_at=row["created_at"],
            task_id=row["task_id"],
            attempt_id=row["attempt_id"],
            attempt_status=cast(
                Literal["REMOTE_UNKNOWN", "SUCCEEDED", "FAILED", "NOT_SUBMITTED"], attempt_status
            ),
            completion=completion,
            validation_issues=issues,
            proposal=proposal,
            adoption=adoption,
            rejection=rejection,
        )
    except Exception as error:
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_STORAGE_FAILED", 500) from error
