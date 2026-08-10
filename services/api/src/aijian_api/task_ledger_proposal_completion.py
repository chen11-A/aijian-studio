"""Lease-fenced transition from Fake Agent execution to human proposal review."""

import sqlite3
from collections.abc import Callable
from datetime import datetime

from aijian_api.artifact_proposal_store import decode_persisted_proposal_row
from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import ClaimedTask, LeaseLostError, timestamp
from aijian_api.task_ledger_snapshots import (
    assert_attempt_snapshot_templates_match,
    read_agent_skill_snapshot,
)


def complete_local_proposal_task(
    claim: ClaimedTask,
    *,
    proposal_id: str,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> str:
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        now_text = timestamp(clock())
        snapshot = read_agent_skill_snapshot(connection, claim, now_text=now_text)
        attempt = connection.execute(
            """
            SELECT 1 FROM workflow_attempts
            WHERE attempt_id = ? AND node_run_id = ? AND status = 'RUNNING'
              AND revision = ?
            """,
            (claim.attempt_id, claim.node_run_id, claim.attempt_revision),
        ).fetchone()
        proposal_row = connection.execute(
            "SELECT * FROM agent_artifact_proposals WHERE proposal_id = ?",
            (proposal_id,),
        ).fetchone()
        if attempt is None:
            raise LeaseLostError("attempt state changed before proposal completion")
        if proposal_row is None:
            raise ValueError("proposal does not exist")
        proposal = decode_persisted_proposal_row(proposal_row).proposal
        assert_attempt_snapshot_templates_match(
            connection,
            str(proposal_row["producer_attempt_id"]),
            claim.attempt_id,
        )
        if (
            proposal.project_id != snapshot.project_id
            or proposal.producer_agent_run_id != snapshot.agent_run_id
            or proposal.producer_skill_run_id != snapshot.skill_run_id
            or proposal.target_artifact_type != snapshot.output_artifact_type
        ):
            raise ValueError("proposal does not belong to the current attempt snapshot")
        node = connection.execute(
            """
            UPDATE workflow_node_runs
            SET status = 'NEEDS_REVIEW', revision = revision + 1, updated_at = ?
            WHERE node_run_id = ? AND workflow_run_id = ? AND status = 'RUNNING'
              AND active_attempt_id = ? AND revision = ?
            RETURNING revision
            """,
            (
                now_text,
                claim.node_run_id,
                claim.workflow_run_id,
                claim.attempt_id,
                claim.node_revision,
            ),
        ).fetchone()
        task = connection.execute(
            """
            UPDATE task_ledger
            SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
            WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
              AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
              AND revision = ? AND lease_expires_at > ?
            RETURNING revision
            """,
            (
                now_text,
                claim.task_id,
                claim.attempt_id,
                claim.lease_owner,
                claim.lease_token,
                claim.lease_generation,
                claim.task_revision,
                now_text,
            ),
        ).fetchone()
        if node is None or task is None:
            raise LeaseLostError("task state changed during proposal completion")
        append_event(
            connection,
            id_factory,
            "node",
            claim.node_run_id,
            "RUNNING",
            "NEEDS_REVIEW",
            "proposal.ready",
            now_text,
            actor_kind="worker",
            actor_id=claim.lease_owner,
            lease_generation=claim.lease_generation,
        )
        append_event(
            connection,
            id_factory,
            "task",
            claim.task_id,
            "LEASED",
            "COMPLETED",
            "proposal.ready",
            now_text,
            actor_kind="worker",
            actor_id=claim.lease_owner,
            lease_generation=claim.lease_generation,
        )
        connection.commit()
        return proposal_id
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
