"""Lease-fenced terminal failure for deterministic local tasks."""

import sqlite3
from collections.abc import Callable
from datetime import datetime

from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import ClaimedTask, LeaseLostError, timestamp


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
        attempt = connection.execute(
            """
            UPDATE workflow_attempts
            SET status = 'FAILED', retry_disposition = 'NON_RETRYABLE',
                error_code = ?, finished_at = ?, revision = revision + 1, updated_at = ?
            WHERE attempt_id = ? AND node_run_id = ? AND status = 'RUNNING'
              AND revision = ?
            """,
            (
                error_code,
                now_text,
                now_text,
                claim.attempt_id,
                claim.node_run_id,
                claim.attempt_revision,
            ),
        )
        node = connection.execute(
            """
            UPDATE workflow_node_runs
            SET status = 'FAILED', revision = revision + 1, updated_at = ?
            WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
              AND revision = ?
            """,
            (now_text, claim.node_run_id, claim.attempt_id, claim.node_revision),
        )
        task = connection.execute(
            """
            UPDATE task_ledger
            SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
            WHERE task_id = ? AND status = 'LEASED' AND lease_owner = ?
              AND lease_token = ? AND lease_generation = ? AND revision = ?
              AND lease_expires_at > ?
            """,
            (
                now_text,
                claim.task_id,
                claim.lease_owner,
                claim.lease_token,
                claim.lease_generation,
                claim.task_revision,
                now_text,
            ),
        )
        workflow = connection.execute(
            """
            UPDATE workflow_runs
            SET status = 'FAILED', revision = revision + 1, updated_at = ?
            WHERE workflow_run_id = ? AND status = 'ACTIVE'
            """,
            (now_text, claim.workflow_run_id),
        )
        if any(result.rowcount != 1 for result in (attempt, node, task, workflow)):
            raise LeaseLostError("local task changed before deterministic failure")
        for entity_kind, entity_id, from_status, to_status in (
            ("attempt", claim.attempt_id, "RUNNING", "FAILED"),
            ("node", claim.node_run_id, "RUNNING", "FAILED"),
            ("task", claim.task_id, "LEASED", "COMPLETED"),
        ):
            append_event(
                connection,
                id_factory,
                entity_kind,  # type: ignore[arg-type]
                entity_id,
                from_status,
                to_status,
                "local.execution_failed",
                now_text,
                actor_kind="worker",
                actor_id=claim.lease_owner,
                lease_generation=claim.lease_generation,
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
