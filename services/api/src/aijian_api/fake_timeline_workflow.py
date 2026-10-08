"""Deprecated read-compatible endpoint for completed Fake Timeline runs."""

import json

from aijian_api.domain import ArtifactVersionRecord
from aijian_api.repository import ArtifactNotFoundError, StudioRepository
from aijian_api.timeline_routes import TimelineAlreadyExistsError


class SourceRequiredError(RuntimeError):
    """The project has no imported source that can drive a preview."""


class FakeTimelineWorkflowNotReadyError(RuntimeError):
    """Creation moved to the authenticated asynchronous Sidecar command."""


def start_fake_timeline_workflow(
    repository: StudioRepository,
    project_id: str,
) -> ArtifactVersionRecord:
    """Return a completed Timeline without starting work in the request thread."""

    if not repository.list_sources(project_id):
        raise SourceRequiredError
    try:
        record = repository.get_latest_artifact(project_id, "timeline")
    except ArtifactNotFoundError:
        raise FakeTimelineWorkflowNotReadyError from None
    with repository._connection() as connection:
        row = connection.execute(
            """
            SELECT definition.definition_id, definition.version AS definition_version,
                   run.status AS run_status, node.node_key, node.node_type,
                   node.contract_version, node.active_attempt_id,
                   node.status AS node_status,
                   node.output_version_id AS node_output_version_id,
                   node.input_bindings_json, attempt.attempt_id,
                   attempt.status AS attempt_status,
                   attempt.output_version_id AS attempt_output_version_id,
                   task.task_kind, task.status AS task_status,
                   COUNT(*) OVER (PARTITION BY attempt.attempt_id) AS exact_task_count,
                   manifest_head.accepted_version_id
            FROM artifact_versions AS version
            JOIN workflow_attempts AS attempt
              ON attempt.attempt_id = version.producer_attempt_id
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
            JOIN workflow_definitions AS definition
              ON definition.definition_id = run.definition_id
             AND definition.version = run.definition_version
            JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
            JOIN artifacts AS manifest_artifact
              ON manifest_artifact.project_id = run.project_id
             AND manifest_artifact.artifact_type = 'source_manifest'
            JOIN artifact_heads AS manifest_head
              ON manifest_head.artifact_id = manifest_artifact.artifact_id
            WHERE version.version_id = ? AND run.project_id = ?
            """,
            (record.version.id, project_id),
        ).fetchone()
    if row is None:
        raise TimelineAlreadyExistsError
    bindings = json.loads(str(row["input_bindings_json"]))
    if (
        str(row["definition_id"]) != "phase0.fake-timeline-media"
        or int(row["definition_version"]) != 1
        or str(row["run_status"]) != "SUCCEEDED"
        or str(row["node_key"]) != "timeline.assemble.fake.media"
        or str(row["node_type"]) != "timeline.assemble.fake.media"
        or int(row["contract_version"]) != 1
        or str(row["active_attempt_id"]) != str(row["attempt_id"])
        or str(row["node_status"]) != "SUCCEEDED"
        or str(row["attempt_status"]) != "SUCCEEDED"
        or str(row["task_kind"]) != "local.timeline.assemble.fake.media.v1"
        or str(row["task_status"]) != "COMPLETED"
        or int(row["exact_task_count"]) != 1
        or str(row["node_output_version_id"]) != record.version.id
        or str(row["attempt_output_version_id"]) != record.version.id
        or bindings.get("source_manifest_version_id") != row["accepted_version_id"]
    ):
        raise TimelineAlreadyExistsError
    return record
