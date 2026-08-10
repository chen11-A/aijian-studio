"""Atomic creation of a local workflow run, attempt, and ledger wake-up."""

import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import QueuedTask, timestamp
from aijian_api.task_ledger_snapshots import prepare_agent_skill_snapshot
from aijian_api.workflow_tasks import NodeRun, TaskAttempt


@dataclass(frozen=True, slots=True)
class EnqueueLocalNodeRequest:
    project_id: str
    definition_id: str
    definition_version: int
    definition_hash: str
    graph: Mapping[str, object]
    workflow_input_hash: str
    node_key: str
    node_type: str
    contract_version: int
    input_bindings: Mapping[str, object]
    node_input_hash: str
    request_fingerprint: str
    idempotency_key: str
    max_attempts: int
    task_kind: str
    priority: int
    available_at: datetime
    attempt_snapshot_kind: str | None = None
    attempt_snapshot: Mapping[str, object] | None = None


def enqueue_local_node(
    request: EnqueueLocalNodeRequest,
    *,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> QueuedTask:
    now = clock()
    graph_json = _canonical_json(request.graph)
    input_bindings_json = _canonical_json(request.input_bindings)
    workflow_run_id = id_factory("wfr")
    node_run_id = id_factory("node")
    attempt_id = id_factory("att")
    task_id = id_factory("task")
    snapshot = prepare_agent_skill_snapshot(
        kind=request.attempt_snapshot_kind,
        payload=request.attempt_snapshot,
        attempt_id=attempt_id,
        project_id=request.project_id,
        input_hash=request.node_input_hash,
        idempotency_key=request.idempotency_key,
        request_fingerprint=request.request_fingerprint,
    )
    _validate_request(
        request,
        workflow_run_id=workflow_run_id,
        node_run_id=node_run_id,
        attempt_id=attempt_id,
        now=now,
    )
    now_text = timestamp(now)

    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = _existing_enqueue(connection, request)
        if existing is not None:
            _validate_existing_enqueue(
                existing,
                request,
                graph_json=graph_json,
                input_bindings_json=input_bindings_json,
                snapshot=snapshot,
            )
            connection.commit()
            return QueuedTask(
                str(existing["workflow_run_id"]),
                str(existing["node_run_id"]),
                str(existing["attempt_id"]),
                str(existing["task_id"]),
            )
        connection.execute(
            "INSERT OR IGNORE INTO workflow_definitions VALUES (?, ?, ?, ?, ?)",
            (
                request.definition_id,
                request.definition_version,
                request.definition_hash,
                graph_json,
                now_text,
            ),
        )
        definition = connection.execute(
            "SELECT definition_hash, graph_json FROM workflow_definitions "
            "WHERE definition_id = ? AND version = ?",
            (request.definition_id, request.definition_version),
        ).fetchone()
        if definition is None or (
            str(definition["definition_hash"]) != request.definition_hash
            or str(definition["graph_json"]) != graph_json
        ):
            raise ValueError("workflow definition version is immutable")
        connection.execute(
            """
            INSERT INTO workflow_runs VALUES (
                ?, ?, ?, ?, ?, 'ACTIVE', 1, NULL, ?, ?
            )
            """,
            (
                workflow_run_id,
                request.project_id,
                request.definition_id,
                request.definition_version,
                request.workflow_input_hash,
                now_text,
                now_text,
            ),
        )
        connection.execute(
            """
            INSERT INTO workflow_node_runs (
                node_run_id, workflow_run_id, node_key, node_type, contract_version,
                input_bindings_json, input_hash, idempotency_key, status, attempt_count,
                max_attempts, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, 1, ?, ?)
            """,
            (
                node_run_id,
                workflow_run_id,
                request.node_key,
                request.node_type,
                request.contract_version,
                input_bindings_json,
                request.node_input_hash,
                request.idempotency_key,
                request.max_attempts,
                now_text,
                now_text,
            ),
        )
        connection.execute(
            """
            INSERT INTO workflow_attempts (
                attempt_id, node_run_id, attempt_number, execution_mode, status,
                input_hash, request_fingerprint, revision, created_at, updated_at
            ) VALUES (?, ?, 1, 'local', 'READY', ?, ?, 1, ?, ?)
            """,
            (
                attempt_id,
                node_run_id,
                request.node_input_hash,
                request.request_fingerprint,
                now_text,
                now_text,
            ),
        )
        if snapshot is not None:
            connection.execute(
                """
                INSERT INTO workflow_attempt_snapshots (
                    attempt_id, snapshot_kind, snapshot_json, snapshot_hash, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (attempt_id, snapshot[0], snapshot[1], snapshot[2], now_text),
            )
        connection.execute(
            """
            INSERT INTO task_ledger (
                task_id, attempt_id, task_kind, status, priority, available_at,
                lease_generation, revision, created_at, updated_at
            ) VALUES (?, ?, ?, 'READY', ?, ?, 0, 1, ?, ?)
            """,
            (
                task_id,
                attempt_id,
                request.task_kind,
                request.priority,
                timestamp(request.available_at),
                now_text,
                now_text,
            ),
        )
        connection.execute(
            """
            INSERT INTO workflow_enqueue_keys (
                project_id, idempotency_key, workflow_run_id, node_run_id, created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                request.project_id,
                request.idempotency_key,
                workflow_run_id,
                node_run_id,
                now_text,
            ),
        )
        append_event(
            connection,
            id_factory,
            "node",
            node_run_id,
            None,
            "PENDING",
            "node.created",
            now_text,
        )
        append_event(
            connection,
            id_factory,
            "attempt",
            attempt_id,
            None,
            "READY",
            "attempt.created",
            now_text,
        )
        append_event(
            connection,
            id_factory,
            "task",
            task_id,
            None,
            "READY",
            "task.created",
            now_text,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return QueuedTask(workflow_run_id, node_run_id, attempt_id, task_id)


def _existing_enqueue(
    connection: sqlite3.Connection,
    request: EnqueueLocalNodeRequest,
) -> sqlite3.Row | None:
    return cast(
        sqlite3.Row | None,
        connection.execute(
            """
        WITH latest_attempt AS (
            SELECT candidate.*
            FROM workflow_attempts AS candidate
            JOIN workflow_node_runs AS candidate_node
              ON candidate_node.node_run_id = candidate.node_run_id
            JOIN workflow_enqueue_keys AS candidate_key
              ON candidate_key.node_run_id = candidate_node.node_run_id
            WHERE candidate_key.project_id = ? AND candidate_key.idempotency_key = ?
            ORDER BY candidate.attempt_number DESC, candidate.attempt_id DESC
            LIMIT 1
        )
        SELECT key.workflow_run_id, key.node_run_id,
               run.definition_id, run.definition_version,
               run.input_hash AS workflow_input_hash,
               definition.definition_hash, definition.graph_json,
               node.node_key, node.node_type, node.contract_version,
               node.input_bindings_json, node.input_hash AS node_input_hash,
               node.max_attempts,
               attempt.attempt_id, attempt.request_fingerprint,
               task.task_id, task.task_kind,
               snapshot.snapshot_kind, snapshot.snapshot_json, snapshot.snapshot_hash
        FROM workflow_enqueue_keys AS key
        JOIN workflow_runs AS run ON run.workflow_run_id = key.workflow_run_id
        JOIN workflow_definitions AS definition
          ON definition.definition_id = run.definition_id
         AND definition.version = run.definition_version
        JOIN workflow_node_runs AS node ON node.node_run_id = key.node_run_id
        JOIN latest_attempt AS attempt ON attempt.node_run_id = node.node_run_id
        JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
        LEFT JOIN workflow_attempt_snapshots AS snapshot
          ON snapshot.attempt_id = attempt.attempt_id
        WHERE key.project_id = ? AND key.idempotency_key = ?
        ORDER BY CASE WHEN task.task_kind = ? THEN 0 ELSE 1 END,
                 task.created_at DESC, task.task_id DESC
        LIMIT 1
            """,
            (
                request.project_id,
                request.idempotency_key,
                request.project_id,
                request.idempotency_key,
                request.task_kind,
            ),
        ).fetchone(),
    )


def _validate_existing_enqueue(
    existing: sqlite3.Row,
    request: EnqueueLocalNodeRequest,
    *,
    graph_json: str,
    input_bindings_json: str,
    snapshot: tuple[str, str, str] | None,
) -> None:
    expected = (
        request.definition_id,
        request.definition_version,
        request.workflow_input_hash,
        request.definition_hash,
        graph_json,
        request.node_key,
        request.node_type,
        request.contract_version,
        input_bindings_json,
        request.node_input_hash,
        request.max_attempts,
        request.request_fingerprint,
        request.task_kind,
        snapshot[0] if snapshot is not None else None,
        snapshot[1] if snapshot is not None else None,
        snapshot[2] if snapshot is not None else None,
    )
    persisted = (
        str(existing["definition_id"]),
        int(existing["definition_version"]),
        str(existing["workflow_input_hash"]),
        str(existing["definition_hash"]),
        str(existing["graph_json"]),
        str(existing["node_key"]),
        str(existing["node_type"]),
        int(existing["contract_version"]),
        str(existing["input_bindings_json"]),
        str(existing["node_input_hash"]),
        int(existing["max_attempts"]),
        str(existing["request_fingerprint"]),
        str(existing["task_kind"]),
        _optional_text(existing["snapshot_kind"]),
        _optional_text(existing["snapshot_json"]),
        _optional_text(existing["snapshot_hash"]),
    )
    if persisted != expected:
        raise ValueError("idempotency key was reused with different workflow input")


def _canonical_json(value: Mapping[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _validate_request(
    request: EnqueueLocalNodeRequest,
    *,
    workflow_run_id: str,
    node_run_id: str,
    attempt_id: str,
    now: datetime,
) -> None:
    if not 0 <= request.priority <= 100:
        raise ValueError("priority must be between zero and 100")
    if request.definition_version < 1 or request.contract_version < 1:
        raise ValueError("definition and contract versions must be positive")
    NodeRun(
        id=node_run_id,
        workflow_run_id=workflow_run_id,
        node_key=request.node_key,
        node_type=request.node_type,
        state="PENDING",
        input_fingerprint=request.node_input_hash,
        idempotency_key=request.idempotency_key,
        attempt_count=0,
        max_attempts=request.max_attempts,
        active_attempt_id=None,
        output_version_id=None,
        revision=1,
        created_at=now,
        updated_at=now,
    )
    TaskAttempt(
        id=attempt_id,
        node_run_id=node_run_id,
        attempt_number=1,
        execution_mode="local",
        state="READY",
        input_fingerprint=request.node_input_hash,
        request_fingerprint=request.request_fingerprint,
        provider_account_id=None,
        provider_idempotency_key=None,
        provider_capabilities=None,
        provider_job_id=None,
        dispatch_started_at=None,
        retry_disposition=None,
        output_version_id=None,
        revision=1,
        created_at=now,
        updated_at=now,
    )
