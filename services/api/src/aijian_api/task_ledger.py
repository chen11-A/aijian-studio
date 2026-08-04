"""Public SQLite task-ledger facade with lease-fenced local claims."""

import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

from aijian_api.repository import StudioRepository
from aijian_api.task_ledger_completion import complete_local_task
from aijian_api.task_ledger_enqueue import EnqueueLocalNodeRequest, enqueue_local_node
from aijian_api.task_ledger_events import append_event
from aijian_api.task_ledger_models import (
    ClaimedTask,
    LeaseLostError,
    QueuedTask,
    RecoverySummary,
    TaskCompletion,
    lease_token,
    new_id,
    parse_datetime,
    timestamp,
    utc_now,
)
from aijian_api.task_ledger_recovery import recover_expired_local_tasks

__all__ = [
    "ClaimedTask",
    "LeaseLostError",
    "LocalTaskLedger",
    "QueuedTask",
    "RecoverySummary",
    "TaskCompletion",
]


class LocalTaskLedger:
    def __init__(
        self,
        database_path: Path,
        *,
        clock: Callable[[], datetime] = utc_now,
        id_factory: Callable[[str], str] = new_id,
        lease_token_factory: Callable[[], str] = lease_token,
    ) -> None:
        self._database_path = database_path
        self._clock = clock
        self._id_factory = id_factory
        self._lease_token_factory = lease_token_factory
        StudioRepository(database_path)

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def enqueue_local_node(
        self,
        *,
        project_id: str,
        definition_id: str,
        definition_version: int,
        definition_hash: str,
        graph: Mapping[str, object],
        workflow_input_hash: str,
        node_key: str,
        node_type: str,
        contract_version: int,
        input_bindings: Mapping[str, object],
        node_input_hash: str,
        request_fingerprint: str,
        idempotency_key: str,
        max_attempts: int,
        task_kind: str,
        priority: int,
        available_at: datetime,
    ) -> QueuedTask:
        request = EnqueueLocalNodeRequest(
            project_id=project_id,
            definition_id=definition_id,
            definition_version=definition_version,
            definition_hash=definition_hash,
            graph=graph,
            workflow_input_hash=workflow_input_hash,
            node_key=node_key,
            node_type=node_type,
            contract_version=contract_version,
            input_bindings=input_bindings,
            node_input_hash=node_input_hash,
            request_fingerprint=request_fingerprint,
            idempotency_key=idempotency_key,
            max_attempts=max_attempts,
            task_kind=task_kind,
            priority=priority,
            available_at=available_at,
        )
        return enqueue_local_node(
            request,
            connection_factory=self._open,
            clock=self._clock,
            id_factory=self._id_factory,
        )

    def claim_ready_task(
        self,
        *,
        worker_id: str,
        lease_duration: timedelta,
    ) -> ClaimedTask | None:
        self._validate_lease_request(worker_id, lease_duration)
        now = self._clock()
        now_text = timestamp(now)
        expires_text = timestamp(now + lease_duration)
        token = self._lease_token_factory()
        if not token.strip():
            raise ValueError("lease token must not be empty")

        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            task = connection.execute(
                """
                UPDATE task_ledger
                SET status = 'LEASED', lease_owner = ?, lease_token = ?,
                    lease_generation = lease_generation + 1,
                    lease_expires_at = ?, heartbeat_at = ?,
                    revision = revision + 1, updated_at = ?
                WHERE task_id = (
                    SELECT ledger.task_id
                    FROM task_ledger AS ledger
                    JOIN workflow_attempts AS attempt
                      ON attempt.attempt_id = ledger.attempt_id
                    WHERE ledger.status = 'READY' AND ledger.available_at <= ?
                      AND attempt.execution_mode = 'local' AND attempt.status = 'READY'
                    ORDER BY ledger.priority DESC, ledger.created_at, ledger.task_id
                    LIMIT 1
                ) AND status = 'READY'
                RETURNING *
                """,
                (worker_id, token, expires_text, now_text, now_text, now_text),
            ).fetchone()
            if task is None:
                connection.commit()
                return None
            attempt = connection.execute(
                """
                UPDATE workflow_attempts
                SET status = 'LEASED', revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'READY'
                RETURNING node_run_id, attempt_number, revision
                """,
                (now_text, str(task["attempt_id"])),
            ).fetchone()
            if attempt is None:
                raise LeaseLostError("attempt was not ready for the claimed task")
            node = connection.execute(
                """
                UPDATE workflow_node_runs
                SET status = 'RUNNING', active_attempt_id = ?,
                    attempt_count = attempt_count + 1,
                    revision = revision + 1, updated_at = ?
                WHERE node_run_id = ? AND status = 'PENDING'
                  AND attempt_count < max_attempts
                RETURNING workflow_run_id, revision
                """,
                (str(task["attempt_id"]), now_text, str(attempt["node_run_id"])),
            ).fetchone()
            if node is None:
                raise LeaseLostError("node was not pending for the claimed attempt")
            generation = int(task["lease_generation"])
            self._record_claim_events(
                connection,
                task=task,
                attempt=attempt,
                worker_id=worker_id,
                generation=generation,
                created_at=now_text,
            )
            connection.commit()
            return ClaimedTask(
                workflow_run_id=str(node["workflow_run_id"]),
                node_run_id=str(attempt["node_run_id"]),
                attempt_id=str(task["attempt_id"]),
                task_id=str(task["task_id"]),
                task_kind=str(task["task_kind"]),
                attempt_number=int(attempt["attempt_number"]),
                lease_owner=worker_id,
                lease_token=token,
                lease_generation=generation,
                lease_expires_at=parse_datetime(expires_text),
                heartbeat_at=parse_datetime(now_text),
                task_revision=int(task["revision"]),
                attempt_revision=int(attempt["revision"]),
                node_revision=int(node["revision"]),
            )
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def heartbeat(self, claim: ClaimedTask, *, lease_duration: timedelta) -> ClaimedTask:
        self._validate_lease_request(claim.lease_owner, lease_duration)
        now = self._clock()
        now_text = timestamp(now)
        expires_text = timestamp(now + lease_duration)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                UPDATE task_ledger
                SET heartbeat_at = ?, lease_expires_at = ?,
                    revision = revision + 1, updated_at = ?
                WHERE task_id = ? AND status = 'LEASED'
                  AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
                  AND revision = ? AND lease_expires_at > ?
                RETURNING revision
                """,
                (
                    now_text,
                    expires_text,
                    now_text,
                    claim.task_id,
                    claim.lease_owner,
                    claim.lease_token,
                    claim.lease_generation,
                    claim.task_revision,
                    now_text,
                ),
            ).fetchone()
            if row is None:
                raise LeaseLostError("task lease is stale or expired")
            connection.commit()
            return replace(
                claim,
                lease_expires_at=parse_datetime(expires_text),
                heartbeat_at=parse_datetime(now_text),
                task_revision=int(row["revision"]),
            )
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def mark_attempt_running(self, claim: ClaimedTask) -> ClaimedTask:
        now_text = timestamp(self._clock())
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            lease = connection.execute(
                """
                SELECT 1 FROM task_ledger
                WHERE task_id = ? AND status = 'LEASED'
                  AND lease_owner = ? AND lease_token = ? AND lease_generation = ?
                  AND revision = ? AND lease_expires_at > ?
                """,
                (
                    claim.task_id,
                    claim.lease_owner,
                    claim.lease_token,
                    claim.lease_generation,
                    claim.task_revision,
                    now_text,
                ),
            ).fetchone()
            if lease is None:
                raise LeaseLostError("task lease is stale or expired")
            attempt = connection.execute(
                """
                UPDATE workflow_attempts
                SET status = 'RUNNING', started_at = COALESCE(started_at, ?),
                    revision = revision + 1, updated_at = ?
                WHERE attempt_id = ? AND status = 'LEASED' AND revision = ?
                RETURNING revision
                """,
                (now_text, now_text, claim.attempt_id, claim.attempt_revision),
            ).fetchone()
            if attempt is None:
                raise LeaseLostError("attempt revision is stale")
            append_event(
                connection,
                self._id_factory,
                "attempt",
                claim.attempt_id,
                "LEASED",
                "RUNNING",
                "attempt.started",
                now_text,
                actor_kind="worker",
                actor_id=claim.lease_owner,
                lease_generation=claim.lease_generation,
            )
            connection.commit()
            return replace(claim, attempt_revision=int(attempt["revision"]))
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def recover_expired_local_tasks(self) -> RecoverySummary:
        return recover_expired_local_tasks(
            connection_factory=self._open,
            clock=self._clock,
            id_factory=self._id_factory,
        )

    def complete_local_task(
        self,
        claim: ClaimedTask,
        *,
        output_version_id: str,
    ) -> TaskCompletion:
        return complete_local_task(
            claim,
            output_version_id=output_version_id,
            connection_factory=self._open,
            clock=self._clock,
            id_factory=self._id_factory,
        )

    @staticmethod
    def _validate_lease_request(worker_id: str, lease_duration: timedelta) -> None:
        if not worker_id.strip():
            raise ValueError("worker id must not be empty")
        if lease_duration <= timedelta(0):
            raise ValueError("lease duration must be positive")

    def _record_claim_events(
        self,
        connection: sqlite3.Connection,
        *,
        task: sqlite3.Row,
        attempt: sqlite3.Row,
        worker_id: str,
        generation: int,
        created_at: str,
    ) -> None:
        append_event(
            connection,
            self._id_factory,
            "task",
            str(task["task_id"]),
            "READY",
            "LEASED",
            "task.claimed",
            created_at,
            actor_kind="worker",
            actor_id=worker_id,
            lease_generation=generation,
        )
        append_event(
            connection,
            self._id_factory,
            "attempt",
            str(task["attempt_id"]),
            "READY",
            "LEASED",
            "attempt.claimed",
            created_at,
            actor_kind="worker",
            actor_id=worker_id,
            lease_generation=generation,
        )
        append_event(
            connection,
            self._id_factory,
            "node",
            str(attempt["node_run_id"]),
            "PENDING",
            "RUNNING",
            "node.claimed",
            created_at,
            actor_kind="worker",
            actor_id=worker_id,
            lease_generation=generation,
        )
