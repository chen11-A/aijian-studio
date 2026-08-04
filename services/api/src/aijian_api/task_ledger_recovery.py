"""Crash recovery for expired local task leases."""

import sqlite3
from collections.abc import Callable
from datetime import datetime

from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import LeaseLostError, RecoverySummary, timestamp


def recover_expired_local_tasks(
    *,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> RecoverySummary:
    now_text = timestamp(clock())
    recovered = 0
    requeued = 0
    failed = 0
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            """
            SELECT ledger.*, attempt.node_run_id, attempt.attempt_number,
                   attempt.status AS attempt_status, attempt.input_hash,
                   attempt.request_fingerprint, attempt.revision AS attempt_revision,
                   node.status AS node_status, node.attempt_count, node.max_attempts,
                   node.revision AS node_revision
            FROM task_ledger AS ledger
            JOIN workflow_attempts AS attempt ON attempt.attempt_id = ledger.attempt_id
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            WHERE ledger.status = 'LEASED' AND ledger.lease_expires_at <= ?
              AND attempt.execution_mode = 'local'
              AND attempt.status IN ('LEASED', 'RUNNING')
              AND node.status = 'RUNNING' AND node.active_attempt_id = attempt.attempt_id
            ORDER BY ledger.lease_expires_at, ledger.task_id
            """,
            (now_text,),
        ).fetchall()
        for row in rows:
            _finish_expired_attempt(connection, row, now_text, id_factory)
            recovered += 1
            if int(row["attempt_count"]) < int(row["max_attempts"]):
                _requeue_attempt(connection, row, now_text, id_factory)
                requeued += 1
            else:
                _fail_node(connection, row, now_text, id_factory)
                failed += 1
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return RecoverySummary(recovered=recovered, requeued=requeued, failed=failed)


def _finish_expired_attempt(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    task = connection.execute(
        """
        UPDATE task_ledger
        SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
        WHERE task_id = ? AND status = 'LEASED' AND revision = ?
          AND lease_generation = ?
        RETURNING revision
        """,
        (
            now_text,
            str(row["task_id"]),
            int(row["revision"]),
            int(row["lease_generation"]),
        ),
    ).fetchone()
    attempt = connection.execute(
        """
        UPDATE workflow_attempts
        SET status = 'FAILED', retry_disposition = 'SAFE_LOCAL_RETRY',
            error_code = 'LEASE_EXPIRED', finished_at = ?,
            revision = revision + 1, updated_at = ?
        WHERE attempt_id = ? AND status = ? AND revision = ?
        RETURNING revision
        """,
        (
            now_text,
            now_text,
            str(row["attempt_id"]),
            str(row["attempt_status"]),
            int(row["attempt_revision"]),
        ),
    ).fetchone()
    if task is None or attempt is None:
        raise LeaseLostError("expired task changed during recovery")
    generation = int(row["lease_generation"])
    append_event(
        connection,
        id_factory,
        "task",
        str(row["task_id"]),
        "LEASED",
        "COMPLETED",
        "lease.expired",
        now_text,
        actor_id="local-recovery",
        lease_generation=generation,
    )
    append_event(
        connection,
        id_factory,
        "attempt",
        str(row["attempt_id"]),
        str(row["attempt_status"]),
        "FAILED",
        "lease.expired",
        now_text,
        actor_id="local-recovery",
        lease_generation=generation,
    )


def _requeue_attempt(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    node = connection.execute(
        """
        UPDATE workflow_node_runs
        SET status = 'PENDING', active_attempt_id = NULL,
            revision = revision + 1, updated_at = ?
        WHERE node_run_id = ? AND status = 'RUNNING' AND revision = ?
        RETURNING revision
        """,
        (now_text, str(row["node_run_id"]), int(row["node_revision"])),
    ).fetchone()
    if node is None:
        raise LeaseLostError("node changed during expired lease recovery")
    attempt_id = id_factory("att")
    task_id = id_factory("task")
    attempt_number = int(row["attempt_number"]) + 1
    connection.execute(
        """
        INSERT INTO workflow_attempts (
            attempt_id, node_run_id, attempt_number, execution_mode, status,
            input_hash, request_fingerprint, revision, created_at, updated_at
        ) VALUES (?, ?, ?, 'local', 'READY', ?, ?, 1, ?, ?)
        """,
        (
            attempt_id,
            str(row["node_run_id"]),
            attempt_number,
            str(row["input_hash"]),
            str(row["request_fingerprint"]),
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
            str(row["task_kind"]),
            int(row["priority"]),
            now_text,
            now_text,
            now_text,
        ),
    )
    _append_recovery_events(connection, row, attempt_id, task_id, now_text, id_factory)


def _fail_node(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    node = connection.execute(
        """
        UPDATE workflow_node_runs
        SET status = 'FAILED', revision = revision + 1, updated_at = ?
        WHERE node_run_id = ? AND status = 'RUNNING' AND revision = ?
        RETURNING revision
        """,
        (now_text, str(row["node_run_id"]), int(row["node_revision"])),
    ).fetchone()
    if node is None:
        raise LeaseLostError("node changed during final lease recovery")
    append_event(
        connection,
        id_factory,
        "node",
        str(row["node_run_id"]),
        "RUNNING",
        "FAILED",
        "lease.attempts_exhausted",
        now_text,
        actor_id="local-recovery",
        lease_generation=int(row["lease_generation"]),
    )


def _append_recovery_events(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    attempt_id: str,
    task_id: str,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    generation = int(row["lease_generation"])
    append_event(
        connection,
        id_factory,
        "node",
        str(row["node_run_id"]),
        "RUNNING",
        "PENDING",
        "lease.requeued",
        now_text,
        actor_id="local-recovery",
        lease_generation=generation,
    )
    append_event(
        connection,
        id_factory,
        "attempt",
        attempt_id,
        None,
        "READY",
        "attempt.recovery_created",
        now_text,
        actor_id="local-recovery",
        lease_generation=generation,
    )
    append_event(
        connection,
        id_factory,
        "task",
        task_id,
        None,
        "READY",
        "task.recovery_created",
        now_text,
        actor_id="local-recovery",
        lease_generation=generation,
    )
