"""Crash recovery for expired local task leases."""

import sqlite3
from collections.abc import Callable
from datetime import datetime

from aijian_api.task_ledger_events import EventEntityKind, append_event
from aijian_api.task_ledger_models import LeaseLostError, RecoverySummary, timestamp


def recover_expired_local_tasks(
    *,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> RecoverySummary:
    now_text = timestamp(clock())
    recovered = 0
    succeeded = 0
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
                   node.workflow_run_id, node.status AS node_status,
                   node.attempt_count, node.max_attempts,
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
            output_version_id = _committed_output(connection, row)
            if output_version_id is not None:
                _complete_committed_output(
                    connection,
                    row,
                    output_version_id,
                    now_text,
                    id_factory,
                )
                recovered += 1
                succeeded += 1
                continue
            _finish_expired_attempt(connection, row, now_text, id_factory)
            recovered += 1
            if int(row["attempt_count"]) < int(row["max_attempts"]):
                _requeue_attempt(connection, row, now_text, id_factory)
                requeued += 1
            else:
                _fail_node(connection, row, now_text, id_factory)
                failed += 1
        remote_unknown = _quarantine_expired_remote_submissions(connection, now_text, id_factory)
        recovered += remote_unknown
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return RecoverySummary(
        recovered=recovered,
        succeeded=succeeded,
        requeued=requeued,
        failed=failed,
        remote_unknown=remote_unknown,
    )


def _quarantine_expired_remote_submissions(
    connection: sqlite3.Connection,
    now_text: str,
    id_factory: Callable[[str], str],
) -> int:
    rows = connection.execute(
        """
        SELECT ledger.*, attempt.node_run_id, attempt.status AS attempt_status,
               attempt.revision AS attempt_revision,
               node.status AS node_status, node.revision AS node_revision
        FROM task_ledger AS ledger
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = ledger.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        WHERE ledger.status = 'LEASED' AND ledger.lease_expires_at <= ?
          AND attempt.execution_mode = 'remote'
          AND attempt.status IN ('SUBMITTING', 'CANCEL_REQUESTED')
          AND node.status = 'RUNNING' AND node.active_attempt_id = attempt.attempt_id
        ORDER BY ledger.lease_expires_at, ledger.task_id
        """,
        (now_text,),
    ).fetchall()
    for row in rows:
        _quarantine_remote_submission(connection, row, now_text, id_factory)
    return len(rows)


def _quarantine_remote_submission(
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
        SET status = 'REMOTE_UNKNOWN', retry_disposition = 'REMOTE_UNKNOWN',
            error_code = 'REMOTE_ACCEPTANCE_UNKNOWN', finished_at = ?,
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
    node = connection.execute(
        """
        UPDATE workflow_node_runs
        SET status = 'RECONCILIATION_REQUIRED',
            revision = revision + 1, updated_at = ?
        WHERE node_run_id = ? AND status = 'RUNNING'
          AND active_attempt_id = ? AND revision = ?
        RETURNING revision
        """,
        (
            now_text,
            str(row["node_run_id"]),
            str(row["attempt_id"]),
            int(row["node_revision"]),
        ),
    ).fetchone()
    if task is None or attempt is None or node is None:
        raise LeaseLostError("remote submission changed during quarantine")
    generation = int(row["lease_generation"])
    events: tuple[tuple[EventEntityKind, str, str, str, str], ...] = (
        (
            "task",
            str(row["task_id"]),
            "LEASED",
            "COMPLETED",
            "remote.acceptance_unknown",
        ),
        (
            "attempt",
            str(row["attempt_id"]),
            str(row["attempt_status"]),
            "REMOTE_UNKNOWN",
            "remote.acceptance_unknown",
        ),
        (
            "node",
            str(row["node_run_id"]),
            "RUNNING",
            "RECONCILIATION_REQUIRED",
            "remote.acceptance_unknown",
        ),
    )
    for entity_kind, entity_id, from_status, to_status, reason_code in events:
        append_event(
            connection,
            id_factory,
            entity_kind,
            entity_id,
            from_status,
            to_status,
            reason_code,
            now_text,
            actor_id="local-recovery",
            lease_generation=generation,
        )


def _committed_output(connection: sqlite3.Connection, row: sqlite3.Row) -> str | None:
    output = connection.execute(
        """
        SELECT version.version_id
        FROM artifact_versions AS version
        JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
        JOIN workflow_runs AS run ON run.workflow_run_id = ?
        WHERE version.producer_attempt_id = ? AND artifact.project_id = run.project_id
        """,
        (str(row["workflow_run_id"]), str(row["attempt_id"])),
    ).fetchone()
    return None if output is None else str(output["version_id"])


def _complete_committed_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    output_version_id: str,
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
        SET status = 'SUCCEEDED', output_version_id = ?, finished_at = ?,
            revision = revision + 1, updated_at = ?
        WHERE attempt_id = ? AND status = ? AND revision = ?
        RETURNING revision
        """,
        (
            output_version_id,
            now_text,
            now_text,
            str(row["attempt_id"]),
            str(row["attempt_status"]),
            int(row["attempt_revision"]),
        ),
    ).fetchone()
    node = connection.execute(
        """
        UPDATE workflow_node_runs
        SET status = 'SUCCEEDED', output_version_id = ?,
            revision = revision + 1, updated_at = ?
        WHERE node_run_id = ? AND status = 'RUNNING'
          AND active_attempt_id = ? AND revision = ?
        RETURNING revision
        """,
        (
            output_version_id,
            now_text,
            str(row["node_run_id"]),
            str(row["attempt_id"]),
            int(row["node_revision"]),
        ),
    ).fetchone()
    if task is None or attempt is None or node is None:
        raise LeaseLostError("committed output changed during recovery")
    generation = int(row["lease_generation"])
    events: tuple[tuple[EventEntityKind, str, str, str], ...] = (
        ("task", str(row["task_id"]), "LEASED", "COMPLETED"),
        (
            "attempt",
            str(row["attempt_id"]),
            str(row["attempt_status"]),
            "SUCCEEDED",
        ),
        ("node", str(row["node_run_id"]), "RUNNING", "SUCCEEDED"),
    )
    for entity_kind, entity_id, from_status, to_status in events:
        append_event(
            connection,
            id_factory,
            entity_kind,
            entity_id,
            from_status,
            to_status,
            "output.receipt_recovered",
            now_text,
            actor_id="local-recovery",
            lease_generation=generation,
        )


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
