"""Atomic creation of a local workflow run, attempt, and ledger wake-up."""

import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime

from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import QueuedTask, timestamp
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


def _canonical_json(value: Mapping[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


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
