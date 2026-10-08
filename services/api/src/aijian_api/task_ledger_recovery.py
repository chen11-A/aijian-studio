"""Crash recovery for expired local task leases."""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from aijian_api.artifact_proposal_store import (
    PROPOSAL_TRUTH_SELECT,
    decode_persisted_proposal_row,
)
from aijian_api.task_ledger_agent_runs import (
    mark_agent_skill_run_failed,
    mark_agent_skill_run_needs_review,
)
from aijian_api.task_ledger_events import EventEntityKind, append_event
from aijian_api.task_ledger_models import LeaseLostError, RecoverySummary, timestamp
from aijian_api.task_ledger_snapshots import (
    AGENT_SKILL_SNAPSHOT_KIND,
    read_agent_skill_snapshot_for_attempt,
)


@dataclass(frozen=True, slots=True)
class RemoteRecoverySummary:
    """Exact counts for remote recovery; quarantine is not represented as attempt failure."""

    recovered: int
    requeued: int
    quarantined: int


def recover_expired_local_tasks(
    *,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
    task_kind: str | None = None,
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
              AND (? IS NULL OR ledger.task_kind = ?)
            ORDER BY ledger.lease_expires_at, ledger.task_id
            """,
            (now_text, task_kind, task_kind),
        ).fetchall()
        for row in rows:
            proposal_id = _persisted_proposal_id(connection, row)
            if proposal_id is not None:
                _recover_persisted_proposal(
                    connection,
                    row,
                    proposal_id,
                    now_text,
                    id_factory,
                )
                recovered += 1
                continue
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
    )


def recover_expired_remote_tasks(
    *,
    connection_factory: Callable[[], sqlite3.Connection],
    clock: Callable[[], datetime],
    id_factory: Callable[[str], str],
    task_kind: str | None = None,
) -> RemoteRecoverySummary:
    """Recover expired remote leases without retrying any consumed/possibly dispatched work."""
    now_text = timestamp(clock())
    recovered = 0
    requeued = 0
    quarantined = 0
    connection = connection_factory()
    try:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            """SELECT ledger.*, attempt.status AS attempt_status,
                      attempt.revision AS attempt_revision, attempt.dispatch_started_at,
                      attempt.node_run_id AS node_run_id,
                      node.workflow_run_id, node.revision AS node_revision,
                      node.attempt_count
               FROM task_ledger AS ledger
               JOIN workflow_attempts AS attempt ON attempt.attempt_id = ledger.attempt_id
               JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
               WHERE ledger.status = 'LEASED' AND ledger.lease_expires_at <= ?
                 AND attempt.execution_mode = 'remote'
                 AND attempt.status IN ('LEASED', 'RUNNING', 'SUBMIT_INTENT', 'SUBMITTING')
                 AND node.status = 'RUNNING' AND node.active_attempt_id = attempt.attempt_id
                 AND (? IS NULL OR ledger.task_kind = ?)
               ORDER BY ledger.lease_expires_at, ledger.task_id""",
            (now_text, task_kind, task_kind),
        ).fetchall()
        for row in rows:
            attempt_id = str(row["attempt_id"])
            consumed = connection.execute(
                """SELECT 1 FROM remote_execution_authorization_snapshots
                   WHERE attempt_id = ? AND event_kind = 'CONSUME' LIMIT 1""",
                (attempt_id,),
            ).fetchone()
            attempt_status = str(row["attempt_status"])
            definitely_pre_dispatch = (
                consumed is None
                and row["dispatch_started_at"] is None
                and attempt_status in {"LEASED", "RUNNING"}
            )
            if definitely_pre_dispatch:
                _requeue_expired_remote_pre_dispatch(connection, row, now_text, id_factory)
                requeued += 1
            else:
                _quarantine_expired_remote_attempt(connection, row, now_text, id_factory)
                quarantined += 1
            recovered += 1
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return RemoteRecoverySummary(recovered=recovered, requeued=requeued, quarantined=quarantined)


def _requeue_expired_remote_pre_dispatch(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    """Requeue the same attempt only when the durable state proves no dispatch was possible."""
    attempt_id = str(row["attempt_id"])
    task_id = str(row["task_id"])
    node_run_id = str(row["node_run_id"])
    generation = int(row["lease_generation"])
    prior_attempt_status = str(row["attempt_status"])
    task = connection.execute(
        """UPDATE task_ledger
           SET status = 'READY', available_at = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, heartbeat_at = NULL,
               revision = revision + 1, updated_at = ?
           WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
             AND lease_generation = ? AND revision = ? AND lease_expires_at <= ?
           RETURNING revision""",
        (
            now_text,
            now_text,
            task_id,
            attempt_id,
            generation,
            int(row["revision"]),
            now_text,
        ),
    ).fetchone()
    attempt = connection.execute(
        """UPDATE workflow_attempts
           SET status = 'READY', started_at = NULL, retry_disposition = NULL,
               error_code = NULL, revision = revision + 1, updated_at = ?
           WHERE attempt_id = ? AND execution_mode = 'remote' AND status = ?
             AND revision = ? AND dispatch_started_at IS NULL
           RETURNING revision""",
        (now_text, attempt_id, prior_attempt_status, int(row["attempt_revision"])),
    ).fetchone()
    node = connection.execute(
        """UPDATE workflow_node_runs
           SET status = 'PENDING', active_attempt_id = NULL, attempt_count = attempt_count - 1,
               revision = revision + 1, updated_at = ?
           WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
             AND revision = ? AND attempt_count > 0
           RETURNING revision""",
        (now_text, node_run_id, attempt_id, int(row["node_revision"])),
    ).fetchone()
    if task is None or attempt is None or node is None:
        raise LeaseLostError("expired pre-dispatch remote lease changed during requeue")
    _append_expired_remote_events(
        connection,
        row,
        id_factory,
        now_text,
        attempt_from=prior_attempt_status,
        attempt_to="READY",
        node_to="PENDING",
        task_to="READY",
        reason="remote.pre_dispatch.lease_expired",
    )


def _quarantine_expired_remote_attempt(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    """Quarantine consumed or inconsistent remote state; never create a retry task."""
    attempt_id = str(row["attempt_id"])
    task_id = str(row["task_id"])
    node_run_id = str(row["node_run_id"])
    prior_attempt_status = str(row["attempt_status"])
    generation = int(row["lease_generation"])
    attempt = connection.execute(
        """UPDATE workflow_attempts
           SET status = 'REMOTE_UNKNOWN', retry_disposition = 'REMOTE_UNKNOWN',
               revision = revision + 1, updated_at = ?
           WHERE attempt_id = ? AND execution_mode = 'remote' AND status = ?
             AND revision = ? AND output_version_id IS NULL
           RETURNING revision""",
        (now_text, attempt_id, prior_attempt_status, int(row["attempt_revision"])),
    ).fetchone()
    node = connection.execute(
        """UPDATE workflow_node_runs
           SET status = 'RECONCILIATION_REQUIRED', revision = revision + 1, updated_at = ?
           WHERE node_run_id = ? AND status = 'RUNNING' AND active_attempt_id = ?
             AND revision = ? AND output_version_id IS NULL
           RETURNING revision""",
        (now_text, node_run_id, attempt_id, int(row["node_revision"])),
    ).fetchone()
    task = connection.execute(
        """UPDATE task_ledger
           SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
           WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
             AND lease_generation = ? AND revision = ? AND lease_expires_at <= ?
           RETURNING revision""",
        (
            now_text,
            task_id,
            attempt_id,
            generation,
            int(row["revision"]),
            now_text,
        ),
    ).fetchone()
    if attempt is None or node is None or task is None:
        raise LeaseLostError("expired remote attempt changed during quarantine")
    _append_expired_remote_events(
        connection,
        row,
        id_factory,
        now_text,
        attempt_from=prior_attempt_status,
        attempt_to="REMOTE_UNKNOWN",
        node_to="RECONCILIATION_REQUIRED",
        task_to="COMPLETED",
        reason="remote.lease_expired.quarantined",
    )


def _append_expired_remote_events(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    id_factory: Callable[[str], str],
    now_text: str,
    *,
    attempt_from: str,
    attempt_to: str,
    node_to: str,
    task_to: str,
    reason: str,
) -> None:
    generation = int(row["lease_generation"])
    events: tuple[tuple[EventEntityKind, str, str, str], ...] = (
        ("attempt", str(row["attempt_id"]), attempt_from, attempt_to),
        ("node", str(row["node_run_id"]), "RUNNING", node_to),
        ("task", str(row["task_id"]), "LEASED", task_to),
    )
    for kind, entity_id, source, target in events:
        append_event(
            connection,
            id_factory,
            kind,
            entity_id,
            source,
            target,
            reason,
            now_text,
            actor_id="remote-recovery",
            lease_generation=generation,
        )


def _persisted_proposal_id(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> str | None:
    proposal = connection.execute(
        "SELECT proposal_id FROM agent_artifact_proposals WHERE producer_attempt_id = ?",
        (str(row["attempt_id"]),),
    ).fetchone()
    return None if proposal is None else str(proposal["proposal_id"])


def _recover_persisted_proposal(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    proposal_id: str,
    now_text: str,
    id_factory: Callable[[str], str],
) -> None:
    proposal_row = connection.execute(
        PROPOSAL_TRUTH_SELECT + " WHERE proposal.proposal_id = ?",
        (proposal_id,),
    ).fetchone()
    if proposal_row is None:
        raise ValueError("persisted proposal disappeared during recovery")
    persisted = decode_persisted_proposal_row(proposal_row)
    attempt_id = str(row["attempt_id"])
    if persisted.producer_attempt_id != attempt_id:
        raise ValueError("persisted proposal belongs to a different attempt")
    snapshot = read_agent_skill_snapshot_for_attempt(connection, attempt_id)
    proposal = persisted.proposal
    if (
        proposal.project_id != snapshot.project_id
        or proposal.producer_agent_run_id != snapshot.agent_run_id
        or proposal.producer_skill_run_id != snapshot.skill_run_id
        or proposal.target_artifact_type != snapshot.output_artifact_type
    ):
        raise ValueError("persisted proposal is detached from its attempt snapshot")
    mark_agent_skill_run_needs_review(
        connection,
        snapshot,
        proposal_id=proposal_id,
        now_text=now_text,
    )
    task = connection.execute(
        """
        UPDATE task_ledger
        SET status = 'COMPLETED', revision = revision + 1, updated_at = ?
        WHERE task_id = ? AND attempt_id = ? AND status = 'LEASED'
          AND revision = ? AND lease_generation = ?
        RETURNING revision
        """,
        (
            now_text,
            str(row["task_id"]),
            attempt_id,
            int(row["revision"]),
            int(row["lease_generation"]),
        ),
    ).fetchone()
    node = connection.execute(
        """
        UPDATE workflow_node_runs
        SET status = 'NEEDS_REVIEW', revision = revision + 1, updated_at = ?
        WHERE node_run_id = ? AND status = 'RUNNING'
          AND active_attempt_id = ? AND revision = ?
        RETURNING revision
        """,
        (
            now_text,
            str(row["node_run_id"]),
            attempt_id,
            int(row["node_revision"]),
        ),
    ).fetchone()
    if task is None or node is None:
        raise LeaseLostError("persisted proposal changed during recovery")
    recovered_events: tuple[tuple[EventEntityKind, str], ...] = (
        ("node", str(row["node_run_id"])),
        ("task", str(row["task_id"])),
    )
    for entity_kind, entity_id in recovered_events:
        append_event(
            connection,
            id_factory,
            entity_kind,
            entity_id,
            "RUNNING" if entity_kind == "node" else "LEASED",
            "NEEDS_REVIEW" if entity_kind == "node" else "COMPLETED",
            "proposal.ready_recovered",
            now_text,
            actor_id="local-recovery",
            lease_generation=int(row["lease_generation"]),
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
    connection.execute(
        """
        UPDATE workflow_runs
        SET status = 'SUCCEEDED', revision = revision + 1, updated_at = ?
        WHERE workflow_run_id = ? AND status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM workflow_node_runs
            WHERE workflow_run_id = ?
              AND status NOT IN ('SUCCEEDED', 'SUPERSEDED')
          )
        """,
        (now_text, str(row["workflow_run_id"]), str(row["workflow_run_id"])),
    )
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
    snapshot_row = connection.execute(
        "SELECT snapshot_kind FROM workflow_attempt_snapshots WHERE attempt_id = ?",
        (str(row["attempt_id"]),),
    ).fetchone()
    if snapshot_row is not None:
        if str(snapshot_row["snapshot_kind"]) != AGENT_SKILL_SNAPSHOT_KIND:
            raise ValueError("unsupported attempt snapshot kind")
        snapshot = read_agent_skill_snapshot_for_attempt(
            connection,
            str(row["attempt_id"]),
        )
        mark_agent_skill_run_failed(connection, snapshot, now_text=now_text)
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
    workflow = connection.execute(
        """
        UPDATE workflow_runs
        SET status = 'FAILED', revision = revision + 1, updated_at = ?
        WHERE workflow_run_id = ? AND status = 'ACTIVE'
        """,
        (now_text, str(row["workflow_run_id"])),
    )
    if workflow.rowcount != 1:
        raise LeaseLostError("workflow changed during final lease recovery")
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
