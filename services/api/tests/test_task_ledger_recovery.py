import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def setup_task(database: Path, clock: list[datetime], *, max_attempts: int = 2):
    project = StudioRepository(database).create_project(
        name="黄金短篇",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    ledger = LocalTaskLedger(database, clock=lambda: clock[0])
    queued = ledger.enqueue_local_node(
        project_id=project.id,
        definition_id="golden-short",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["render.preview"]},
        workflow_input_hash=HASH_A,
        node_key="render.preview",
        node_type="render.preview",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key="golden-short:render.preview",
        max_attempts=max_attempts,
        task_kind="local.execute",
        priority=50,
        available_at=clock[0],
    )
    return ledger, queued


def test_expired_running_attempt_is_failed_and_requeued_with_new_identity(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, first = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    clock[0] = NOW + timedelta(seconds=31)

    summary = LocalTaskLedger(database, clock=lambda: clock[0]).recover_expired_local_tasks()

    assert summary.recovered == 1
    assert summary.requeued == 1
    assert summary.failed == 0
    with sqlite3.connect(database) as connection:
        attempts = connection.execute(
            "SELECT attempt_id, attempt_number, status, retry_disposition "
            "FROM workflow_attempts ORDER BY attempt_number"
        ).fetchall()
        tasks = connection.execute(
            "SELECT task_id, status FROM task_ledger ORDER BY created_at, task_id"
        ).fetchall()
        node = connection.execute(
            "SELECT status, attempt_count, active_attempt_id FROM workflow_node_runs"
        ).fetchone()
    assert attempts[0] == (first.attempt_id, 1, "FAILED", "SAFE_LOCAL_RETRY")
    assert attempts[1][1:] == (2, "READY", None)
    assert {status for _, status in tasks} == {"COMPLETED", "READY"}
    assert node == ("PENDING", 1, None)

    with pytest.raises(LeaseLostError):
        ledger.heartbeat(running, lease_duration=timedelta(seconds=30))
    with pytest.raises(LeaseLostError):
        ledger.mark_attempt_running(running)

    next_claim = LocalTaskLedger(database, clock=lambda: clock[0]).claim_ready_task(
        worker_id="worker-new",
        lease_duration=timedelta(seconds=30),
    )
    assert next_claim is not None
    assert next_claim.attempt_number == 2
    assert next_claim.attempt_id != first.attempt_id


def test_expired_final_attempt_fails_node_without_requeue(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, _queued = setup_task(database, clock, max_attempts=1)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    clock[0] = NOW + timedelta(seconds=31)

    summary = ledger.recover_expired_local_tasks()

    assert (summary.recovered, summary.requeued, summary.failed) == (1, 0, 1)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == ("FAILED",)
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)


def test_active_or_remote_leases_are_never_requeued_by_local_recovery(tmp_path: Path) -> None:
    active_database = tmp_path / "active.db"
    active_clock = [NOW]
    active_ledger, _queued = setup_task(active_database, active_clock)
    assert active_ledger.claim_ready_task(
        worker_id="worker-active",
        lease_duration=timedelta(seconds=30),
    )
    active_clock[0] = NOW + timedelta(seconds=10)
    assert active_ledger.recover_expired_local_tasks().recovered == 0

    remote_database = tmp_path / "remote.db"
    remote_clock = [NOW]
    remote_ledger, remote = setup_task(remote_database, remote_clock)
    expired = (NOW - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    now_text = NOW.isoformat().replace("+00:00", "Z")
    with sqlite3.connect(remote_database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            UPDATE workflow_attempts
            SET execution_mode = 'remote', status = 'SUBMITTING', dispatch_started_at = ?
            WHERE attempt_id = ?
            """,
            (now_text, remote.attempt_id),
        )
        connection.execute(
            """
            UPDATE workflow_node_runs
            SET status = 'RUNNING', attempt_count = 1, active_attempt_id = ?
            WHERE node_run_id = ?
            """,
            (remote.attempt_id, remote.node_run_id),
        )
        connection.execute(
            """
            UPDATE task_ledger
            SET status = 'LEASED', lease_owner = 'remote-worker', lease_token = 'token',
                lease_generation = 1, lease_expires_at = ?, heartbeat_at = ?
            WHERE task_id = ?
            """,
            (expired, now_text, remote.task_id),
        )
        connection.commit()

    remote_clock[0] = NOW + timedelta(seconds=1)
    assert remote_ledger.recover_expired_local_tasks().recovered == 0
    with sqlite3.connect(remote_database) as connection:
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (remote.attempt_id,)
        ).fetchone() == ("SUBMITTING",)


def test_recovery_rolls_back_if_attempt_changes_inside_transaction(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_attempt_recovery_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'COMPLETED'
            BEGIN
                UPDATE workflow_attempts SET status = 'CANCELLED'
                WHERE attempt_id = NEW.attempt_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match="expired task changed"):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (queued.attempt_id,)
        ).fetchone() == ("RUNNING",)


def test_output_receipt_recovery_rolls_back_if_attempt_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    repository = StudioRepository(database, clock=lambda: clock[0])
    project_id = repository.list_projects()[0].id
    repository.create_artifact_version(
        project_id=project_id,
        artifact_type="fake_render",
        schema_version="1.0.0",
        content={"media_hash": HASH_B},
        author_actor_type="system",
        author_actor_id="fake-provider",
        change_summary="模拟输出已提交后进程崩溃",
        producer_attempt_id=running.attempt_id,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_receipt_recovery_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'COMPLETED'
            BEGIN
                UPDATE workflow_attempts SET status = 'CANCELLED'
                WHERE attempt_id = NEW.attempt_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match="committed output changed"):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (queued.attempt_id,)
        ).fetchone() == ("RUNNING",)


@pytest.mark.parametrize(
    ("max_attempts", "message"),
    [(2, "expired lease recovery"), (1, "final lease recovery")],
)
def test_recovery_rolls_back_if_node_changes_inside_transaction(
    tmp_path: Path,
    max_attempts: int,
    message: str,
) -> None:
    database = tmp_path / f"workspace-{max_attempts}.db"
    clock = [NOW]
    ledger, queued = setup_task(database, clock, max_attempts=max_attempts)
    claim = ledger.claim_ready_task(
        worker_id="worker-old",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_node_recovery_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'FAILED'
            BEGIN
                UPDATE workflow_node_runs SET status = 'CANCELLED'
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match=message):
        ledger.recover_expired_local_tasks()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_node_runs WHERE node_run_id = ?", (queued.node_run_id,)
        ).fetchone() == ("RUNNING",)
