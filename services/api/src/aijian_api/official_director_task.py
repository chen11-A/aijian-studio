"""Official director's single remote attempt in the real durable Task Ledger."""

import json
import sqlite3
from dataclasses import dataclass
from typing import Literal, cast

from aijian_api.artifacts import canonical_content_hash
from aijian_api.task_ledger_events import EventEntityKind, append_event
from aijian_api.task_ledger_models import new_id

_TASK_KIND = "official.director.plan"
_GRAPH = {"nodes": [{"key": "plan", "type": _TASK_KIND, "max_attempts": 1}]}
_GRAPH_JSON = json.dumps(_GRAPH, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True, slots=True)
class OfficialDirectorTaskIds:
    workflow_run_id: str
    node_run_id: str
    attempt_id: str
    task_id: str


def reserve_task(
    connection: sqlite3.Connection,
    project_id: str,
    operation_id: str,
    profile_id: str,
    model: str,
    request_hash: str,
    now_text: str,
    input_version_ids: tuple[str, ...] = (),
) -> OfficialDirectorTaskIds:
    """Append intent inside the caller's transaction, without enqueueing a worker."""
    _require_transaction(connection)
    key = f"{_TASK_KIND}:{operation_id}"
    existing = connection.execute(
        """SELECT run.workflow_run_id, node.node_run_id, attempt.attempt_id, task.task_id
        FROM workflow_enqueue_keys AS key
        JOIN workflow_runs AS run ON run.workflow_run_id = key.workflow_run_id
        JOIN workflow_node_runs AS node ON node.node_run_id = key.node_run_id
        JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
        JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
        WHERE key.project_id = ? AND key.idempotency_key = ?""",
        (project_id, key),
    ).fetchall()
    if existing:
        if len(existing) != 1:
            raise ValueError("official director task chain is inconsistent")
        row = existing[0]
        task_truth(
            connection,
            project_id,
            str(row["task_id"]),
            str(row["attempt_id"]),
            profile_id,
            model,
            request_hash,
            input_version_ids,
        )
        return OfficialDirectorTaskIds(
            *(
                str(row[name])
                for name in ("workflow_run_id", "node_run_id", "attempt_id", "task_id")
            )
        )
    ids = OfficialDirectorTaskIds(new_id("wfr"), new_id("node"), new_id("att"), new_id("task"))
    connection.execute(
        "INSERT OR IGNORE INTO workflow_definitions VALUES (?, 1, ?, ?, ?)",
        (_TASK_KIND, canonical_content_hash(_GRAPH), _GRAPH_JSON, now_text),
    )
    definition = connection.execute(
        "SELECT definition_hash, graph_json FROM workflow_definitions "
        "WHERE definition_id = ? AND version = 1",
        (_TASK_KIND,),
    ).fetchone()
    if definition is None or tuple(definition) != (canonical_content_hash(_GRAPH), _GRAPH_JSON):
        raise ValueError("official director definition is immutable")
    connection.execute(
        "INSERT INTO workflow_runs VALUES (?, ?, ?, 1, ?, 'ACTIVE', 1, NULL, ?, ?)",
        (ids.workflow_run_id, project_id, _TASK_KIND, request_hash, now_text, now_text),
    )
    connection.execute(
        """INSERT INTO workflow_node_runs (
            node_run_id, workflow_run_id, node_key, node_type, contract_version,
            input_bindings_json, input_hash, idempotency_key, status, attempt_count,
            max_attempts, active_attempt_id, revision, created_at, updated_at
        ) VALUES (?, ?, 'plan', ?, 1, ?, ?, ?, 'RECONCILIATION_REQUIRED', 1, 1, ?, 1, ?, ?)""",
        (
            ids.node_run_id,
            ids.workflow_run_id,
            _TASK_KIND,
            json.dumps(
                {"operation_id": operation_id, "input_version_ids": input_version_ids},
                sort_keys=True,
                separators=(",", ":"),
            ),
            request_hash,
            key,
            ids.attempt_id,
            now_text,
            now_text,
        ),
    )
    connection.execute(
        """INSERT INTO workflow_attempts (
            attempt_id, node_run_id, attempt_number, execution_mode, status, input_hash,
            request_fingerprint, provider_account_id, provider_model, retry_disposition,
            revision, started_at, created_at, updated_at
        ) VALUES (?, ?, 1, 'remote', 'REMOTE_UNKNOWN', ?, ?, ?, ?, 'REMOTE_UNKNOWN', 1, ?, ?, ?)""",
        (
            ids.attempt_id,
            ids.node_run_id,
            request_hash,
            request_hash,
            profile_id,
            model,
            now_text,
            now_text,
            now_text,
        ),
    )
    # COMPLETED parks the wake-up safely; queue truth comes from REMOTE_UNKNOWN.
    connection.execute(
        """INSERT INTO task_ledger (
            task_id, attempt_id, task_kind, status, priority, available_at,
            lease_generation, revision, created_at, updated_at
        ) VALUES (?, ?, ?, 'COMPLETED', 50, ?, 0, 1, ?, ?)""",
        (ids.task_id, ids.attempt_id, _TASK_KIND, now_text, now_text, now_text),
    )
    connection.execute(
        "INSERT INTO workflow_enqueue_keys VALUES (?, ?, ?, ?, ?)",
        (project_id, key, ids.workflow_run_id, ids.node_run_id, now_text),
    )
    for kind, entity, state in (
        ("node", ids.node_run_id, "RECONCILIATION_REQUIRED"),
        ("attempt", ids.attempt_id, "REMOTE_UNKNOWN"),
        ("task", ids.task_id, "COMPLETED"),
    ):
        _event(connection, kind, entity, None, state, "official.director.intent", now_text)
    return ids


def begin_completion(
    connection: sqlite3.Connection,
    task_id: str,
    attempt_id: str,
    response_id: str,
    now_text: str,
) -> None:
    """Record acceptance before producing an immutable output in the caller transaction."""
    _require_transaction(connection)
    if not response_id.strip():
        raise ValueError("official director response identity is required")
    row = _attempt_owner(connection, task_id, attempt_id)
    if row is None or _owner_truth(connection, row, task_id, attempt_id) != "REMOTE_UNKNOWN":
        raise ValueError("official director task cannot begin completion")
    connection.execute(
        """UPDATE workflow_attempts SET status = 'REMOTE_REVIEW_PENDING',
        provider_response_id = ?, accepted_at = ?, retry_disposition = 'NON_RETRYABLE',
        revision = revision + 1, updated_at = ? WHERE attempt_id = ?""",
        (response_id, now_text, now_text, attempt_id),
    )
    connection.execute(
        """UPDATE workflow_node_runs SET status = 'NEEDS_REVIEW',
        revision = revision + 1, updated_at = ? WHERE node_run_id = ?""",
        (now_text, row["node_run_id"]),
    )
    _event(
        connection,
        "attempt",
        attempt_id,
        "REMOTE_UNKNOWN",
        "REMOTE_REVIEW_PENDING",
        "official.director.response",
        now_text,
    )
    _event(
        connection,
        "node",
        str(row["node_run_id"]),
        "RECONCILIATION_REQUIRED",
        "NEEDS_REVIEW",
        "official.director.response",
        now_text,
    )


def settle_task(
    connection: sqlite3.Connection,
    task_id: str,
    attempt_id: str,
    proposal_version_id: str | None,
    response_id: str | None,
    error_code: str | None,
    status: Literal["SUCCEEDED", "FAILED", "NOT_SUBMITTED"],
    now_text: str,
) -> None:
    """Settle one reserved attempt; the caller persists completion in the same commit."""
    _require_transaction(connection)
    if status not in {"SUCCEEDED", "FAILED", "NOT_SUBMITTED"} or (
        (status == "SUCCEEDED") != (proposal_version_id is not None)
        or (status == "SUCCEEDED") != (error_code is None)
    ):
        raise ValueError("official director completion is inconsistent")
    row = _attempt_owner(connection, task_id, attempt_id)
    before = None if row is None else _owner_truth(connection, row, task_id, attempt_id)
    if before not in {"REMOTE_UNKNOWN", "REMOTE_REVIEW_PENDING"} or (
        status == "SUCCEEDED"
        and before != "REMOTE_REVIEW_PENDING"
        or status == "NOT_SUBMITTED"
        and before != "REMOTE_UNKNOWN"
    ):
        raise ValueError("official director task cannot be settled")
    assert row is not None
    if before == "REMOTE_REVIEW_PENDING" and response_id != row["provider_response_id"]:
        raise ValueError("official director response identity changed")
    if (
        proposal_version_id is not None
        and connection.execute(
            """SELECT 1 FROM artifact_versions AS version
        JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            JOIN official_director_operations AS operation ON operation.task_id = ?
            WHERE version.version_id = ? AND artifact.project_id = ?
              AND artifact.episode_id = operation.episode_id
              AND artifact.artifact_type = 'official_director_proposal'
              AND version.producer_attempt_id = ? AND version.author_actor_type = 'agent'
              AND version.author_actor_id = ?""",
            (
                task_id,
                proposal_version_id,
                row["project_id"],
                attempt_id,
                "chatgpt-official:" + str(row["provider_account_id"]),
            ),
        ).fetchone()
        is None
    ):
        raise ValueError("official director output must belong to its attempt")
    node_status = "SUCCEEDED" if status == "SUCCEEDED" else "FAILED"
    connection.execute(
        """UPDATE workflow_attempts SET status = ?, output_version_id = ?, provider_response_id = ?,
            error_code = ?, retry_disposition = 'NON_RETRYABLE', finished_at = ?,
            accepted_at = CASE WHEN ? IS NULL THEN accepted_at ELSE COALESCE(accepted_at, ?) END,
            revision = revision + 1, updated_at = ? WHERE attempt_id = ?""",
        (
            status,
            proposal_version_id,
            response_id,
            error_code,
            now_text,
            response_id,
            now_text,
            now_text,
            attempt_id,
        ),
    )
    connection.execute(
        """UPDATE workflow_node_runs SET status = ?, output_version_id = ?,
            revision = revision + 1, updated_at = ? WHERE node_run_id = ?""",
        (node_status, proposal_version_id, now_text, row["node_run_id"]),
    )
    connection.execute(
        "UPDATE task_ledger SET revision = revision + 1, updated_at = ? WHERE task_id = ?",
        (now_text, task_id),
    )
    connection.execute(
        "UPDATE workflow_runs SET status = ?, revision = revision + 1, updated_at = ? "
        "WHERE workflow_run_id = ?",
        (node_status, now_text, row["workflow_run_id"]),
    )
    for kind, entity, previous, after in (
        ("attempt", attempt_id, str(before), status),
        (
            "node",
            str(row["node_run_id"]),
            "NEEDS_REVIEW" if before == "REMOTE_REVIEW_PENDING" else "RECONCILIATION_REQUIRED",
            node_status,
        ),
        ("task", task_id, "COMPLETED", "COMPLETED"),
    ):
        _event(connection, kind, entity, previous, after, "official.director.settled", now_text)


def task_truth(
    connection: sqlite3.Connection,
    project_id: str,
    task_id: str,
    attempt_id: str,
    profile_id: str,
    model: str,
    request_hash: str,
    expected_input_version_ids: tuple[str, ...] | None = None,
) -> str:
    """Verify identity, single-attempt ownership and queue state before returning truth."""
    row = connection.execute(
        """SELECT attempt.status, attempt.retry_disposition, attempt.output_version_id,
                  attempt.provider_response_id, node.input_bindings_json,
                  node.output_version_id AS node_output, node.status AS node_status,
                  run.status AS run_status
        FROM task_ledger AS task
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
        JOIN workflow_enqueue_keys AS enqueue ON enqueue.node_run_id = node.node_run_id
          AND enqueue.workflow_run_id = run.workflow_run_id AND enqueue.project_id = run.project_id
        LEFT JOIN official_director_operations AS operation
          ON operation.task_id = task.task_id AND operation.attempt_id = attempt.attempt_id
        WHERE task.task_id = ? AND attempt.attempt_id = ? AND run.project_id = ?
          AND task.task_kind = ? AND task.status = 'COMPLETED'
          AND run.definition_id = ? AND run.definition_version = 1
          AND node.node_type = ? AND node.node_key = 'plan' AND node.contract_version = 1
          AND attempt.execution_mode = 'remote' AND attempt.provider_account_id = ?
          AND attempt.provider_model = ? AND attempt.input_hash = ?
          AND attempt.request_fingerprint = ? AND node.input_hash = ? AND run.input_hash = ?
          AND node.active_attempt_id = attempt.attempt_id AND node.max_attempts = 1
          AND node.attempt_count = 1 AND attempt.attempt_number = 1
          AND enqueue.idempotency_key = node.idempotency_key
          AND node.idempotency_key = 'official.director.plan:'
              || json_extract(node.input_bindings_json, '$.operation_id')
          AND (operation.operation_id IS NULL
               OR operation.operation_id = json_extract(node.input_bindings_json, '$.operation_id'))
          AND (SELECT count(*) FROM workflow_node_runs
               WHERE workflow_run_id = run.workflow_run_id) = 1
          AND (SELECT count(*) FROM workflow_attempts WHERE node_run_id = node.node_run_id) = 1
          AND (SELECT count(*) FROM task_ledger WHERE attempt_id = attempt.attempt_id) = 1""",
        (
            task_id,
            attempt_id,
            project_id,
            _TASK_KIND,
            _TASK_KIND,
            _TASK_KIND,
            profile_id,
            model,
            request_hash,
            request_hash,
            request_hash,
            request_hash,
        ),
    ).fetchone()
    if row is None:
        raise ValueError("official director task chain is inconsistent")
    if expected_input_version_ids is not None and (
        json.loads(str(row["input_bindings_json"])).get("input_version_ids")
        != list(expected_input_version_ids)
    ):
        raise ValueError("official director input version pins changed")
    status = str(row["status"])
    if status == "REMOTE_UNKNOWN":
        expected = ("RECONCILIATION_REQUIRED", "ACTIVE", "REMOTE_UNKNOWN")
    elif status == "REMOTE_REVIEW_PENDING":
        expected = ("NEEDS_REVIEW", "ACTIVE", "NON_RETRYABLE")
    elif status == "SUCCEEDED":
        expected = ("SUCCEEDED", "SUCCEEDED", "NON_RETRYABLE")
    elif status in {"FAILED", "NOT_SUBMITTED"}:
        expected = ("FAILED", "FAILED", "NON_RETRYABLE")
    else:
        raise ValueError("official director attempt state is inconsistent")
    if (row["node_status"], row["run_status"], row["retry_disposition"]) != expected or (
        row["output_version_id"] != row["node_output"]
        or (status == "SUCCEEDED") != (row["output_version_id"] is not None)
    ):
        raise ValueError("official director task state is inconsistent")
    return status


def _attempt_owner(
    connection: sqlite3.Connection,
    task_id: str,
    attempt_id: str,
) -> sqlite3.Row | None:
    row = connection.execute(
        """SELECT run.project_id, run.workflow_run_id, node.node_run_id,
                  attempt.provider_account_id, attempt.provider_model, attempt.input_hash,
                  attempt.provider_response_id
        FROM task_ledger AS task
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
        WHERE task.task_id = ? AND attempt.attempt_id = ?""",
        (task_id, attempt_id),
    ).fetchone()
    return cast(sqlite3.Row | None, row)


def _owner_truth(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    task_id: str,
    attempt_id: str,
) -> str:
    return task_truth(
        connection,
        str(row["project_id"]),
        task_id,
        attempt_id,
        str(row["provider_account_id"]),
        str(row["provider_model"]),
        str(row["input_hash"]),
    )


def _require_transaction(connection: sqlite3.Connection) -> None:
    if not connection.in_transaction:
        raise ValueError("official director task writes require a caller transaction")


def _event(
    connection: sqlite3.Connection,
    kind: str,
    entity: str,
    before: str | None,
    after: str,
    reason: str,
    now_text: str,
) -> None:
    entity_kind: EventEntityKind
    if kind == "node":
        entity_kind = "node"
    elif kind == "attempt":
        entity_kind = "attempt"
    else:
        entity_kind = "task"
    append_event(
        connection,
        new_id,
        entity_kind,
        entity,
        before,
        after,
        reason,
        now_text,
        actor_id="official-director",
    )
