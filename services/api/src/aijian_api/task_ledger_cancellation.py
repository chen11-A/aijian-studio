"""Project-scoped atomic cancellation for local workflow execution and review."""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from aijian_api.application_errors import (
    ProposalRunCancellationConflictError,
    ProposalRunNotFoundError,
)
from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import LeaseLostError, timestamp


@dataclass(frozen=True, slots=True)
class LocalCancellationResult:
    workflow_run_id: str
    cancelled_tasks: int
    cancelled_attempts: int
    cancelled_nodes: int
    already_cancelled: bool
    agent_run_status: str | None = None
    skill_run_status: str | None = None


def cancel_local_workflow(
    *,
    project_id: str,
    workflow_run_id: str | None,
    actor_id: str,
    agent_run_id: str | None = None,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
) -> LocalCancellationResult:
    if (
        not project_id.strip()
        or not actor_id.strip()
        or (workflow_run_id is None and agent_run_id is None)
        or (workflow_run_id is not None and not workflow_run_id.strip())
        or (agent_run_id is not None and not agent_run_id.strip())
    ):
        raise ValueError("project, workflow run, and cancellation actor are required")
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        now_text = timestamp(clock())
        proposal = None
        if agent_run_id is not None:
            proposal = connection.execute(
                """
                SELECT agent.status AS agent_status, agent.revision AS agent_revision,
                       skill.status AS skill_status, skill.revision AS skill_revision,
                       key.workflow_run_id
                FROM agent_runs AS agent
                JOIN skill_runs AS skill
                  ON skill.project_id = agent.project_id
                 AND skill.agent_run_id = agent.agent_run_id
                JOIN proposal_run_enqueue_intents AS intent
                  ON intent.project_id = agent.project_id
                 AND intent.agent_run_id = agent.agent_run_id
                JOIN workflow_enqueue_keys AS key
                  ON key.project_id = intent.project_id
                 AND key.idempotency_key = json_extract(
                     intent.intent_json, '$.execution_idempotency_key'
                 )
                WHERE agent.project_id = ? AND agent.agent_run_id = ?
                """,
                (project_id, agent_run_id),
            ).fetchone()
            if proposal is None:
                raise ProposalRunNotFoundError("proposal run cancellation target not found")
            resolved_workflow_run_id = str(proposal["workflow_run_id"])
            if workflow_run_id is not None and workflow_run_id != resolved_workflow_run_id:
                raise ProposalRunCancellationConflictError(
                    "proposal run is detached from the requested workflow"
                )
            workflow_run_id = resolved_workflow_run_id
        if workflow_run_id is None:
            raise ValueError("workflow run is required")
        run = connection.execute(
            "SELECT status, revision FROM workflow_runs "
            "WHERE project_id = ? AND workflow_run_id = ?",
            (project_id, workflow_run_id),
        ).fetchone()
        if run is None:
            raise LookupError("workflow run not found in the project")
        if str(run["status"]) == "CANCELLED":
            if proposal is not None and (
                str(proposal["agent_status"]) != "CANCELLED"
                or str(proposal["skill_status"]) != "CANCELLED"
            ):
                raise ProposalRunCancellationConflictError(
                    "cancelled workflow has inconsistent Agent run state"
                )
            connection.commit()
            return LocalCancellationResult(
                workflow_run_id,
                0,
                0,
                0,
                True,
                "CANCELLED" if proposal is not None else None,
                "CANCELLED" if proposal is not None else None,
            )
        if str(run["status"]) not in {"ACTIVE", "CANCEL_REQUESTED"}:
            if proposal is not None:
                raise ProposalRunCancellationConflictError("proposal workflow is not cancellable")
            raise ValueError("workflow run is not cancellable")
        remote_active = connection.execute(
            """
            SELECT 1
            FROM workflow_attempts AS attempt
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            WHERE node.workflow_run_id = ? AND attempt.execution_mode = 'remote'
              AND attempt.status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'NOT_SUBMITTED')
            LIMIT 1
            """,
            (workflow_run_id,),
        ).fetchone()
        if remote_active is not None:
            if proposal is not None:
                raise ProposalRunCancellationConflictError("proposal run has active remote work")
            raise ValueError("local cancellation cannot resolve an active remote attempt")

        tasks = connection.execute(
            """
            SELECT task.task_id, task.status, task.revision, task.lease_generation
            FROM task_ledger AS task
            JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            WHERE node.workflow_run_id = ? AND attempt.execution_mode = 'local'
              AND task.status IN ('READY', 'LEASED')
            ORDER BY task.task_id
            """,
            (workflow_run_id,),
        ).fetchall()
        attempts = connection.execute(
            """
            SELECT attempt.attempt_id, attempt.status, attempt.revision
            FROM workflow_attempts AS attempt
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            WHERE node.workflow_run_id = ?
              AND attempt.execution_mode = 'local'
              AND attempt.status IN ('READY', 'LEASED', 'RUNNING', 'CANCEL_REQUESTED')
            ORDER BY attempt.attempt_id
            """,
            (workflow_run_id,),
        ).fetchall()
        nodes = connection.execute(
            """
            SELECT node_run_id, status, revision
            FROM workflow_node_runs
            WHERE workflow_run_id = ?
              AND status IN ('BLOCKED', 'PENDING', 'RUNNING', 'NEEDS_REVIEW',
                             'CANCEL_REQUESTED')
            ORDER BY node_run_id
            """,
            (workflow_run_id,),
        ).fetchall()
        if not tasks and not attempts and not nodes:
            if proposal is not None:
                raise ProposalRunCancellationConflictError(
                    "proposal run has no cancellable local work"
                )
            raise ValueError("workflow run has no cancellable local work")

        for task in tasks:
            updated = connection.execute(
                """
                UPDATE task_ledger
                SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
                WHERE task_id = ? AND status = ? AND revision = ?
                """,
                (now_text, str(task["task_id"]), str(task["status"]), int(task["revision"])),
            )
            if updated.rowcount != 1:
                raise LeaseLostError("task changed during cancellation")
            append_event(
                connection,
                id_factory,
                "task",
                str(task["task_id"]),
                str(task["status"]),
                "CANCELLED",
                "cancellation.requested",
                now_text,
                actor_kind="human",
                actor_id=actor_id,
                lease_generation=(
                    int(task["lease_generation"]) if int(task["lease_generation"]) > 0 else None
                ),
            )
        for attempt in attempts:
            updated = connection.execute(
                """
                UPDATE workflow_attempts
                SET status = 'CANCELLED', retry_disposition = 'NON_RETRYABLE',
                    error_code = 'USER_CANCELLED', finished_at = ?,
                    revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = ? AND revision = ?
                """,
                (
                    now_text,
                    now_text,
                    str(attempt["attempt_id"]),
                    str(attempt["status"]),
                    int(attempt["revision"]),
                ),
            )
            if updated.rowcount != 1:
                raise LeaseLostError("attempt changed during cancellation")
            append_event(
                connection,
                id_factory,
                "attempt",
                str(attempt["attempt_id"]),
                str(attempt["status"]),
                "CANCELLED",
                "cancellation.requested",
                now_text,
                actor_kind="human",
                actor_id=actor_id,
            )
        for node in nodes:
            updated = connection.execute(
                """
                UPDATE workflow_node_runs
                SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
                WHERE node_run_id = ? AND status = ? AND revision = ?
                """,
                (now_text, str(node["node_run_id"]), str(node["status"]), int(node["revision"])),
            )
            if updated.rowcount != 1:
                raise LeaseLostError("node changed during cancellation")
            append_event(
                connection,
                id_factory,
                "node",
                str(node["node_run_id"]),
                str(node["status"]),
                "CANCELLED",
                "cancellation.requested",
                now_text,
                actor_kind="human",
                actor_id=actor_id,
            )
        updated_run = connection.execute(
            """
            UPDATE workflow_runs
            SET status = 'CANCELLED', cancel_requested_at = ?,
                revision = revision + 1, updated_at = ?
            WHERE workflow_run_id = ? AND project_id = ? AND revision = ?
              AND status IN ('ACTIVE', 'CANCEL_REQUESTED')
            """,
            (now_text, now_text, workflow_run_id, project_id, int(run["revision"])),
        )
        if updated_run.rowcount != 1:
            raise LeaseLostError("workflow run changed during cancellation")
        if proposal is not None and agent_run_id is not None:
            if str(proposal["agent_status"]) not in {"PENDING", "RUNNING", "NEEDS_REVIEW"}:
                raise ProposalRunCancellationConflictError("Agent run is not cancellable")
            if str(proposal["skill_status"]) not in {
                "PENDING",
                "RUNNING",
                "NEEDS_REVIEW",
                "CANCEL_REQUESTED",
            }:
                raise ProposalRunCancellationConflictError("Skill run is not cancellable")
            updated_agent = connection.execute(
                """
                UPDATE agent_runs
                SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
                WHERE project_id = ? AND agent_run_id = ?
                  AND status = ? AND revision = ?
                """,
                (
                    now_text,
                    project_id,
                    agent_run_id,
                    str(proposal["agent_status"]),
                    int(proposal["agent_revision"]),
                ),
            )
            updated_skill = connection.execute(
                """
                UPDATE skill_runs
                SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
                WHERE project_id = ? AND agent_run_id = ?
                  AND status = ? AND revision = ?
                """,
                (
                    now_text,
                    project_id,
                    agent_run_id,
                    str(proposal["skill_status"]),
                    int(proposal["skill_revision"]),
                ),
            )
            if updated_agent.rowcount != 1 or updated_skill.rowcount != 1:
                raise LeaseLostError("Agent or Skill run changed during cancellation")
        connection.commit()
        return LocalCancellationResult(
            workflow_run_id,
            len(tasks),
            len(attempts),
            len(nodes),
            False,
            "CANCELLED" if proposal is not None else None,
            "CANCELLED" if proposal is not None else None,
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
