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
