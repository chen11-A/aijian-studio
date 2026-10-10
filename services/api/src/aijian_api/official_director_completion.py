"""Strict model completion validation and atomic real-task settlement."""

from __future__ import annotations

import json
import sqlite3
from typing import TYPE_CHECKING

from pydantic import ValidationError

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.official_director_contracts import (
    CompleteOfficialDirectorRequest,
    OfficialDirectorContentV1,
    OfficialDirectorOperation,
    OfficialDirectorPreparedRequest,
    OfficialDirectorValidationIssue,
)
from aijian_api.shot_plan_contracts import MAX_SHOT_PLAN_BYTES
from aijian_api.shot_plan_proposal_store import dependencies
from aijian_api.shot_plan_validation import ShotPlanError, resolve_authority, validate_coverage
from aijian_api.task_ledger_models import timestamp

if TYPE_CHECKING:
    from aijian_api.official_director_store import OfficialDirectorStore


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    values: dict[str, object] = {}
    for key, value in pairs:
        if key in values:
            raise ValueError("Duplicate JSON key")
        values[key] = value
    return values


def _invalid_constant(value: str) -> object:
    raise ValueError("Non-JSON numeric constant")


def parse_plan(text: str) -> OfficialDirectorContentV1:
    """No fence stripping, defaults, coercion, duplicate keys, or non-JSON numbers."""
    parsed = json.loads(text, object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    content = OfficialDirectorContentV1.model_validate(parsed)
    if parsed != content.model_dump(mode="json"):
        raise ValueError("Model output is not the exact typed contract")
    if len(canonical_content_bytes(parsed)) > MAX_SHOT_PLAN_BYTES:
        raise ValueError("Model proposal exceeds artifact byte ceiling")
    return content


def match_completion(
    request: OfficialDirectorPreparedRequest, result: CompleteOfficialDirectorRequest
) -> None:
    from aijian_api.official_director_store import OfficialDirectorError

    if (request.operation_id, request.profile_id, request.model, request.request_hash) != (
        result.operation_id,
        result.profile_id,
        result.model,
        result.request_hash,
    ):
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_COMPLETION_MISMATCH", 422)


def validate_plan(
    store: OfficialDirectorStore,
    connection: sqlite3.Connection,
    project: str,
    episode: str,
    prepared: OfficialDirectorPreparedRequest,
    content: OfficialDirectorContentV1,
) -> None:
    from aijian_api.official_director_store import OfficialDirectorError

    if content.project_id != project or content.episode_id != episode:
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_SCOPE_MISMATCH", 422)
    if (
        content.authority != prepared.authority
        or content.storyboard_base != prepared.storyboard_base
    ):
        raise OfficialDirectorError("OFFICIAL_DIRECTOR_AUTHORITY_MISMATCH", 422)
    script, _ = resolve_authority(
        store.repository, connection, project, episode, prepared.authority, require_current=False
    )
    validate_coverage(content.projection_input(), script)


def complete_director(
    store: OfficialDirectorStore,
    project: str,
    episode: str,
    payload: CompleteOfficialDirectorRequest,
) -> tuple[OfficialDirectorOperation, bool]:
    from aijian_api.official_director_store import OfficialDirectorError
    from aijian_api.official_director_task import begin_completion, settle_task

    payload = CompleteOfficialDirectorRequest.model_validate(payload.model_dump(mode="json"))
    with store.connection(write=True) as connection:
        operation = store.read_in_connection(connection, project, episode, payload.operation_id)
        match_completion(operation.request, payload)
        if operation.completion is not None:
            if operation.completion != payload:
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
            return operation, True
        if operation.status != "REMOTE_UNKNOWN":
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_OPERATION_CONFLICT")
        if connection.execute(
            "SELECT 1 FROM official_director_operations WHERE operation_id <> ? "
            "AND json_extract(completion_json, '$.profile_id') = ? "
            "AND json_extract(completion_json, '$.response_id') = ? LIMIT 1",
            (payload.operation_id, payload.profile_id, payload.response_id),
        ).fetchone():
            raise OfficialDirectorError("OFFICIAL_DIRECTOR_RESPONSE_CONFLICT", 422)
        issues: tuple[OfficialDirectorValidationIssue, ...] = ()
        content: OfficialDirectorContentV1 | None = None
        try:
            if len(payload.text.encode("utf-16-le")) // 2 > 100_000:
                raise OfficialDirectorError("OFFICIAL_DIRECTOR_OUTPUT_TOO_LARGE", 422)
            content = parse_plan(payload.text)
            validate_plan(store, connection, project, episode, operation.request, content)
        except (ValueError, ValidationError, RecursionError):
            issues = (
                OfficialDirectorValidationIssue(
                    code="OFFICIAL_DIRECTOR_INVALID_JSON",
                    message="模型原始结果未满足严格 JSON 导演提案契约；原文保留，不能采纳。",
                ),
            )
        except (OfficialDirectorError, ShotPlanError) as error:
            if error.status >= 500:
                raise
            issues = (
                OfficialDirectorValidationIssue(
                    code=error.code.replace("SHOT_PLAN_", "OFFICIAL_DIRECTOR_"),
                    message=(
                        "模型原始结果超过当前严格提案容量；原文保留，不能采纳，未截断。"
                        if error.code == "OFFICIAL_DIRECTOR_OUTPUT_TOO_LARGE"
                        else "模型提案范围、固定权威或剧本覆盖不一致；原文保留，不能采纳。"
                    ),
                ),
            )
        record = None
        if not issues and content is not None:
            begin_completion(
                connection,
                operation.task_id,
                operation.attempt_id,
                payload.response_id,
                timestamp(store.clock()),
            )
            head = connection.execute(
                """SELECT h.latest_version_id, h.revision FROM artifacts a
                JOIN artifact_heads h ON h.artifact_id = a.artifact_id
                WHERE a.project_id = ? AND a.episode_id = ?
                AND a.artifact_type = 'official_director_proposal'""",
                (project, episode),
            ).fetchone()
            record = store.repository.create_artifact_version(
                project_id=project,
                episode_id=episode,
                artifact_type="official_director_proposal",
                schema_version="1.0.0",
                content=content.model_dump(mode="json"),
                author_actor_type="agent",
                author_actor_id=f"chatgpt-official:{payload.profile_id}",
                producer_attempt_id=operation.attempt_id,
                change_summary="官方 AI 导演提案，等待明确人工审查采纳",
                parent_version_id=head["latest_version_id"] if head else None,
                expected_revision=head["revision"] if head else None,
                dependencies=dependencies(content.projection_input()),
                _transaction_connection=connection,
                _manage_transaction=False,
            )
            store.checkpoint("proposal_created")
        now_text = timestamp(store.clock())
        error_code = issues[0].code if issues else None
        settle_task(
            connection,
            operation.task_id,
            operation.attempt_id,
            record.version.id if record else None,
            payload.response_id,
            error_code,
            "FAILED" if issues else "SUCCEEDED",
            now_text,
        )
        completion_json = payload.model_dump(mode="json")
        connection.execute(
            """UPDATE official_director_operations SET status = ?, error_code = ?,
            completion_json = ?, completion_hash = ?, validation_issues_json = ?,
            proposal_version_id = ? WHERE operation_id = ?""",
            (
                "INVALID" if issues else "COMPLETED",
                error_code,
                json.dumps(completion_json, ensure_ascii=False, sort_keys=True),
                canonical_content_hash(completion_json),
                json.dumps([issue.model_dump(mode="json") for issue in issues], ensure_ascii=False),
                record.version.id if record else None,
                payload.operation_id,
            ),
        )
        store.checkpoint("completion_recorded")
        return store.read_in_connection(connection, project, episode, payload.operation_id), False
