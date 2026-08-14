"""Atomic output binding and completion for a leased local task."""

import sqlite3
from collections.abc import Callable
from datetime import datetime

from aijian_api.task_ledger_events import EventEntityKind, append_event
from aijian_api.task_ledger_models import (
    ClaimedTask,
    LeaseLostError,
    TaskCompletion,
    timestamp,
)


def complete_local_task(
    claim: ClaimedTask,
    *,
    output_version_id: str,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> TaskCompletion:
    now_text = timestamp(clock())
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        lease = connection.execute(
            """
            SELECT 1 FROM task_ledger
            WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
              AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
              AND revision = ? AND lease_expires_at > ?
            """,
            (
                claim.task_id,
                claim.attempt_id,
                claim.lease_owner,
                claim.lease_token,
                claim.lease_generation,
                claim.task_revision,
                now_text,
            ),
        ).fetchone()
        if lease is None:
            raise LeaseLostError("task lease is stale or expired")
        output = connection.execute(
            """
            SELECT 1
            FROM artifact_versions AS version
            JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            JOIN workflow_node_runs AS node ON node.node_run_id = ?
            JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
            WHERE version.version_id = ? AND artifact.project_id = run.project_id
              AND version.producer_attempt_id = ?
            """,
            (claim.node_run_id, output_version_id, claim.attempt_id),
        ).fetchone()
        if output is None:
            raise ValueError("output version must be produced by the current attempt")
        attempt = connection.execute(
            """
            UPDATE workflow_attempts
            SET status = 'SUCCEEDED', output_version_id = ?, finished_at = ?,
                revision = revision + 1, updated_at = ?
            WHERE attempt_id = ? AND node_run_id = ? AND status = 'RUNNING'
              AND revision = ?
            RETURNING revision
            """,
            (
                output_version_id,
                now_text,
                now_text,
                claim.attempt_id,
                claim.node_run_id,
                claim.attempt_revision,
            ),
        ).fetchone()
        node = connection.execute(
            """
            UPDATE workflow_node_runs
            SET status = 'SUCCEEDED', output_version_id = ?,
                revision = revision + 1, updated_at = ?
            WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
              AND revision = ?
            RETURNING revision
            """,
            (
                output_version_id,
                now_text,
                claim.node_run_id,
                claim.attempt_id,
                claim.node_revision,
            ),
        ).fetchone()
        task = connection.execute(
            """
            UPDATE task_ledger
            SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
            WHERE task_id = ? AND status = 'LEASED' AND lease_owner = ?
              AND lease_token = ? AND lease_generation = ? AND revision = ?
            RETURNING revision
            """,
            (
                now_text,
                claim.task_id,
                claim.lease_owner,
                claim.lease_token,
                claim.lease_generation,
                claim.task_revision,
            ),
        ).fetchone()
        if attempt is None or node is None or task is None:
            raise LeaseLostError("task state changed during completion")
        _append_completion_events(connection, claim, now_text, id_factory)
        connection.commit()
        return TaskCompletion(
            task_id=claim.task_id,
            attempt_id=claim.attempt_id,
            node_run_id=claim.node_run_id,
            output_version_id=output_version_id,
            task_revision=int(task["revision"]),
            attempt_revision=int(attempt["revision"]),
            node_revision=int(node["revision"]),
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def fail_local_task(
    claim: ClaimedTask,
    *,
    error_code: str,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> None:
    now_text = timestamp(clock())
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT ledger.*, attempt.node_run_id, attempt.attempt_number,
                   attempt.status AS attempt_status, attempt.input_hash,
                   attempt.request_fingerprint, attempt.revision AS attempt_revision,
                   node.status AS node_status, node.attempt_count, node.max_attempts,
                   node.revision AS node_revision
            FROM task_ledger AS ledger
            JOIN workflow_attempts AS attempt ON attempt.attempt_id = ledger.attempt_id
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            WHERE ledger.task_id = ? AND ledger.attempt_id = ? AND ledger.status = 'LEASED'
              AND ledger.lease_owner = ? AND ledger.lease_token = ?
              AND ledger.lease_generation = ? AND ledger.revision = ?
              AND ledger.lease_expires_at > ?
              AND attempt.status = 'RUNNING' AND attempt.revision = ?
              AND node.status = 'RUNNING' AND node.active_attempt_id = attempt.attempt_id
              AND node.revision = ?
            """,
            (
                claim.task_id,
                claim.attempt_id,
                claim.lease_owner,
                claim.lease_token,
                claim.lease_generation,
                claim.task_revision,
                now_text,
                claim.attempt_revision,
                claim.node_revision,
            ),
        ).fetchone()
        if row is None:
            raise LeaseLostError("task lease is stale or expired")
        output_version_id = _committed_output(connection, claim)
        if output_version_id is not None:
            _complete_committed_output(
                connection,
                claim,
                output_version_id=output_version_id,
                now_text=now_text,
                id_factory=id_factory,
            )
            connection.commit()
            return
        _fail_current_attempt(
            connection,
            row,
            error_code=error_code,
            now_text=now_text,
            id_factory=id_factory,
        )
        if int(row["attempt_count"]) < int(row["max_attempts"]):
            _create_retry_attempt(connection, row, now_text, id_factory)
        else:
            _fail_node(connection, row, now_text, id_factory)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def cancel_local_task(
    claim: ClaimedTask,
    *,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> None:
    now_text = timestamp(clock())
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        lease = connection.execute(
            """
            SELECT 1 FROM task_ledger
            WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
              AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
              AND revision = ? AND lease_expires_at > ?
            """,
            (
                claim.task_id,
                claim.attempt_id,
                claim.lease_owner,
                claim.lease_token,
                claim.lease_generation,
                claim.task_revision,
                now_text,
            ),
        ).fetchone()
        if lease is None:
            raise LeaseLostError("task lease is stale or expired")
        task = connection.execute(
            """
            UPDATE task_ledger
            SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
            WHERE task_id = ? AND status = 'LEASED' AND revision = ?
            RETURNING revision
            """,
            (now_text, claim.task_id, claim.task_revision),
        ).fetchone()
        attempt = connection.execute(
            """
            UPDATE workflow_attempts
            SET status = 'CANCELLED', finished_at = ?,
                revision = revision + 1, updated_at = ?
            WHERE attempt_id = ? AND node_run_id = ? AND status = 'RUNNING'
              AND revision = ?
            RETURNING revision
            """,
            (now_text, now_text, claim.attempt_id, claim.node_run_id, claim.attempt_revision),
        ).fetchone()
        node = connection.execute(
            """
            UPDATE workflow_node_runs
            SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
            WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
              AND revision = ?
            RETURNING revision
            """,
            (now_text, claim.node_run_id, claim.attempt_id, claim.node_revision),
        ).fetchone()
        if task is None or attempt is None or node is None:
            raise LeaseLostError("task state changed during cancellation")
        _append_terminal_events(
            connection,
            claim,
            now_text,
            id_factory,
            task_status="CANCELLED",
            attempt_status="CANCELLED",
            node_status="CANCELLED",
            reason_code="task.cancelled",
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _append_completion_events(
    connection: sqlite3.Connection,
    claim: ClaimedTask,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    events: tuple[tuple[EventEntityKind, str, str, str], ...] = (
        ("attempt", claim.attempt_id, "RUNNING", "attempt.completed"),
        ("node", claim.node_run_id, "RUNNING", "node.completed"),
        ("task", claim.task_id, "LEASED", "task.completed"),
    )
    for entity_kind, entity_id, from_status, reason_code in events:
        append_event(
            connection,
            id_factory,
            entity_kind,
            entity_id,
            from_status,
            "SUCCEEDED" if entity_kind != "task" else "COMPLETED",
            reason_code,
            now_text,
            actor_kind="worker",
            actor_id=claim.lease_owner,
            lease_generation=claim.lease_generation,
        )


def _append_terminal_events(
    connection: sqlite3.Connection,
    claim: ClaimedTask,
    now_text: str,
    id_factory: Callable[[str], str],
    *,
    task_status: str,
    attempt_status: str,
    node_status: str,
    reason_code: str,
) -> None:
    events: tuple[tuple[EventEntityKind, str, str, str], ...] = (
        ("attempt", claim.attempt_id, "RUNNING", attempt_status),
        ("node", claim.node_run_id, "RUNNING", node_status),
        ("task", claim.task_id, "LEASED", task_status),
    )
    for entity_kind, entity_id, from_status, to_status in events:
        append_event(
            connection,
            id_factory,
            entity_kind,
            entity_id,
            from_status,
            to_status,
            reason_code,
            now_text,
            actor_kind="worker",
            actor_id=claim.lease_owner,
            lease_generation=claim.lease_generation,
        )


def _committed_output(connection: sqlite3.Connection, claim: ClaimedTask) -> str | None:
    output = connection.execute(
        """
        SELECT version.version_id
        FROM artifact_versions AS version
        JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
        JOIN workflow_node_runs AS node ON node.node_run_id = ?
        JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
        WHERE version.producer_attempt_id = ? AND artifact.project_id = run.project_id
        """,
        (claim.node_run_id, claim.attempt_id),
    ).fetchone()
    return None if output is None else str(output["version_id"])


def _complete_committed_output(
    connection: sqlite3.Connection,
    claim: ClaimedTask,
    *,
    output_version_id: str,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    attempt = connection.execute(
        """
        UPDATE workflow_attempts
        SET status = 'SUCCEEDED', output_version_id = ?, finished_at = ?,
            revision = revision + 1, updated_at = ?
        WHERE attempt_id = ? AND node_run_id = ? AND status = 'RUNNING'
          AND revision = ?
        RETURNING revision
        """,
        (
            output_version_id,
            now_text,
            now_text,
            claim.attempt_id,
            claim.node_run_id,
            claim.attempt_revision,
        ),
    ).fetchone()
    node = connection.execute(
        """
        UPDATE workflow_node_runs
        SET status = 'SUCCEEDED', output_version_id = ?,
            revision = revision + 1, updated_at = ?
        WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
          AND revision = ?
        RETURNING revision
        """,
        (
            output_version_id,
            now_text,
            claim.node_run_id,
            claim.attempt_id,
            claim.node_revision,
        ),
    ).fetchone()
    task = connection.execute(
        """
        UPDATE task_ledger
        SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
        WHERE task_id = ? AND status = 'LEASED' AND lease_owner = ?
          AND lease_token = ? AND lease_generation = ? AND revision = ?
        RETURNING revision
        """,
        (
            now_text,
            claim.task_id,
            claim.lease_owner,
            claim.lease_token,
            claim.lease_generation,
            claim.task_revision,
        ),
    ).fetchone()
    if attempt is None or node is None or task is None:
        raise LeaseLostError("task state changed during failure reconciliation")
    _append_completion_events(connection, claim, now_text, id_factory)


def _fail_current_attempt(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    error_code: str,
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
            error_code = ?, finished_at = ?, revision = revision + 1, updated_at = ?
        WHERE attempt_id = ? AND status = 'RUNNING' AND revision = ?
        RETURNING revision
        """,
        (
            error_code,
            now_text,
            now_text,
            str(row["attempt_id"]),
            int(row["attempt_revision"]),
        ),
    ).fetchone()
    if task is None or attempt is None:
        raise LeaseLostError("task changed during local failure")
    generation = int(row["lease_generation"])
    append_event(
        connection,
        id_factory,
        "task",
        str(row["task_id"]),
        "LEASED",
        "COMPLETED",
        "handler.failed",
        now_text,
        actor_kind="worker",
        actor_id=str(row["lease_owner"]),
        lease_generation=generation,
    )
    append_event(
        connection,
        id_factory,
        "attempt",
        str(row["attempt_id"]),
        "RUNNING",
        "FAILED",
        "handler.failed",
        now_text,
        actor_kind="worker",
        actor_id=str(row["lease_owner"]),
        lease_generation=generation,
    )


def _create_retry_attempt(
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
        raise LeaseLostError("node changed during local retry")
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
    append_event(
        connection,
        id_factory,
        "node",
        str(row["node_run_id"]),
        "RUNNING",
        "PENDING",
        "handler.retry_created",
        now_text,
        actor_kind="worker",
        actor_id=str(row["lease_owner"]),
        lease_generation=int(row["lease_generation"]),
    )
    append_event(
        connection,
        id_factory,
        "attempt",
        attempt_id,
        None,
        "READY",
        "attempt.retry_created",
        now_text,
        actor_kind="worker",
        actor_id=str(row["lease_owner"]),
        lease_generation=int(row["lease_generation"]),
    )
    append_event(
        connection,
        id_factory,
        "task",
        task_id,
        None,
        "READY",
        "task.retry_created",
        now_text,
        actor_kind="worker",
        actor_id=str(row["lease_owner"]),
        lease_generation=int(row["lease_generation"]),
    )


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
        raise LeaseLostError("node changed during final local failure")
    append_event(
        connection,
        id_factory,
        "node",
        str(row["node_run_id"]),
        "RUNNING",
        "FAILED",
        "handler.attempts_exhausted",
        now_text,
        actor_kind="worker",
        actor_id=str(row["lease_owner"]),
        lease_generation=int(row["lease_generation"]),
    )
