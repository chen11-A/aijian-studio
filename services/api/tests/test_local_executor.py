import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from time import sleep

import pytest
from aijian_api.fault_injection import (
    FaultInjector,
    InjectedProcessCrash,
    KillPoint,
    deterministic_kill_point,
)
from aijian_api.local_executor import LocalExecutor
from aijian_api.provider_runtime import RemoteUnknownProviderError
from aijian_api.repository import StudioRepository
from aijian_api.subprocess_supervisor import HeartbeatCallback
from aijian_api.task_ledger import ClaimedTask, LeaseLostError, LocalTaskLedger, QueuedTask

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def setup_execution(
    database: Path,
    clock: list[datetime],
    *,
    max_attempts: int = 2,
) -> tuple[StudioRepository, LocalTaskLedger, QueuedTask, str]:
    repository = StudioRepository(database, clock=lambda: clock[0])
    project = repository.create_project(
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
    return repository, ledger, queued, project.id


def create_output(
    repository: StudioRepository,
    *,
    project_id: str,
    producer_attempt_id: str | None,
) -> str:
    return repository.create_artifact_version(
        project_id=project_id,
        artifact_type="fake_render",
        schema_version="1.0.0",
        content={"media_hash": HASH_B},
        author_actor_type="system",
        author_actor_id="fake-provider",
        change_summary="生成确定性测试输出",
        producer_attempt_id=producer_attempt_id,
    ).version.id


def test_completion_atomically_links_output_attempt_node_and_task(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    output_version_id = create_output(
        repository,
        project_id=project_id,
        producer_attempt_id=running.attempt_id,
    )

    completion = ledger.complete_local_task(running, output_version_id=output_version_id)

    assert completion.output_version_id == output_version_id
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("SUCCEEDED", output_version_id)
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_node_runs WHERE node_run_id = ?",
            (queued.node_run_id,),
        ).fetchone() == ("SUCCEEDED", output_version_id)
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("COMPLETED",)

    with pytest.raises(LeaseLostError):
        ledger.complete_local_task(running, output_version_id=output_version_id)


def test_completion_rejects_missing_or_cross_project_output_without_partial_state(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)
    unrelated_output_id = create_output(
        repository,
        project_id=project_id,
        producer_attempt_id=None,
    )
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)

    with pytest.raises(ValueError, match="current attempt"):
        ledger.complete_local_task(running, output_version_id="ver_missing")
    with pytest.raises(ValueError, match="current attempt"):
        ledger.complete_local_task(running, output_version_id=unrelated_output_id)

    other_repository = StudioRepository(database, clock=lambda: clock[0])
    other_project = other_repository.create_project(
        name="其他项目",
        aspect_ratio="16:9",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    other_output = other_repository.create_artifact_version(
        project_id=other_project.id,
        artifact_type="fake_render",
        schema_version="1.0.0",
        content={"media_hash": HASH_A},
        author_actor_type="system",
        author_actor_id="fake-provider",
        change_summary="其他项目输出",
    )
    with pytest.raises(ValueError, match="current attempt"):
        ledger.complete_local_task(running, output_version_id=other_output.version.id)

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("RUNNING", None)
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)


def test_executor_runs_one_handler_and_reports_empty_queue(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, _queued, project_id = setup_execution(database, clock)
    observed_attempts: list[str] = []

    def handle(claim: ClaimedTask) -> str:
        observed_attempts.append(claim.attempt_id)
        return create_output(
            repository,
            project_id=project_id,
            producer_attempt_id=claim.attempt_id,
        )

    executor = LocalExecutor(
        ledger,
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
        handler=handle,
    )

    assert executor.run_once()
    assert len(observed_attempts) == 1
    assert not executor.run_once()


@pytest.mark.parametrize(
    ("heartbeat_interval", "message"),
    [
        (timedelta(0), "positive"),
        (timedelta(seconds=-1), "positive"),
        (timedelta(seconds=30), "shorter"),
        (timedelta(seconds=31), "shorter"),
    ],
)
def test_executor_rejects_unsafe_heartbeat_intervals(
    tmp_path: Path,
    heartbeat_interval: timedelta,
    message: str,
) -> None:
    database = tmp_path / "workspace.db"
    _repository, ledger, _queued, _project_id = setup_execution(database, [NOW])

    with pytest.raises(ValueError, match=message):
        LocalExecutor(
            ledger,
            worker_id="worker-a",
            lease_duration=timedelta(seconds=30),
            heartbeat_interval=heartbeat_interval,
            handler=lambda _claim: "ver_unused",
        )


def test_completion_rolls_back_if_node_revision_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    output_version_id = create_output(
        repository,
        project_id=project_id,
        producer_attempt_id=running.attempt_id,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE workflow_node_runs SET revision = revision + 1 WHERE node_run_id = ?",
            (queued.node_run_id,),
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="state changed"):
        ledger.complete_local_task(running, output_version_id=output_version_id)

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("RUNNING", None)
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("LEASED",)


def test_executor_crash_is_recovered_without_reusing_attempt_identity(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)

    executor = LocalExecutor(
        ledger,
        worker_id="worker-crash",
        lease_duration=timedelta(seconds=30),
        handler=lambda _claim: "ver_unused",
        fault_injector=FaultInjector(KillPoint.AFTER_MARK_RUNNING),
    )
    with pytest.raises(InjectedProcessCrash, match="after_mark_running"):
        executor.run_once()

    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()
    assert (summary.recovered, summary.requeued) == (1, 1)
    with sqlite3.connect(database) as connection:
        attempts = connection.execute(
            "SELECT attempt_id, status FROM workflow_attempts ORDER BY attempt_number"
        ).fetchall()
    assert attempts[0] == (queued.attempt_id, "FAILED")
    assert attempts[1][0] != queued.attempt_id
    assert attempts[1][1] == "READY"


def test_remote_unknown_handler_is_quarantined_without_retry(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)

    def unknown(_claim: ClaimedTask) -> str:
        raise RemoteUnknownProviderError("Fake provider injected remote unknown")

    executor = LocalExecutor(
        ledger,
        worker_id="worker-unknown",
        lease_duration=timedelta(seconds=30),
        handler=unknown,
    )

    with pytest.raises(RemoteUnknownProviderError):
        executor.run_once()

    with sqlite3.connect(database) as connection:
        attempts = connection.execute(
            "SELECT attempt_id, status, retry_disposition, error_code "
            "FROM workflow_attempts ORDER BY attempt_number"
        ).fetchall()
        node = connection.execute(
            "SELECT status, attempt_count, active_attempt_id FROM workflow_node_runs"
        ).fetchone()
        tasks = connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()
    assert attempts == [(queued.attempt_id, "FAILED", "REMOTE_UNKNOWN", "REMOTE_UNKNOWN")]
    assert node == ("RECONCILIATION_REQUIRED", 1, queued.attempt_id)
    assert tasks == (1,)


def test_remote_unknown_quarantine_rolls_back_if_node_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-unknown",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_remote_unknown_node_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'FAILED'
            BEGIN
                UPDATE workflow_node_runs SET revision = revision + 1
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="remote unknown quarantine"):
        ledger.fail_local_task(
            running,
            error_code="REMOTE_UNKNOWN",
            retry_disposition="REMOTE_UNKNOWN",
        )
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("RUNNING",)


def test_final_failure_rolls_back_if_node_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock, max_attempts=1)
    claim = ledger.claim_ready_task(
        worker_id="worker-final-race",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_final_node_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'FAILED'
            BEGIN
                UPDATE workflow_node_runs SET revision = revision + 1
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="final local failure"):
        ledger.fail_local_task(running, error_code="ValueError")
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == ("LEASED",)


def test_handler_failure_exhausts_attempts_and_fails_the_node(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock, max_attempts=1)

    executor = LocalExecutor(
        ledger,
        worker_id="worker-exhausted",
        lease_duration=timedelta(seconds=30),
        handler=lambda _claim: (_ for _ in ()).throw(ValueError("final failure")),
    )

    with pytest.raises(ValueError, match="final failure"):
        executor.run_once()

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, retry_disposition FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("FAILED", "SAFE_LOCAL_RETRY")
        assert connection.execute(
            "SELECT status FROM workflow_node_runs WHERE node_run_id = ?",
            (queued.node_run_id,),
        ).fetchone() == ("FAILED",)
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)


def test_fail_and_cancel_reject_stale_leases(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, _queued, _project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-stale",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    clock[0] = NOW + timedelta(seconds=31)

    with pytest.raises(LeaseLostError, match="stale or expired"):
        ledger.fail_local_task(running, error_code="ValueError")
    with pytest.raises(LeaseLostError, match="stale or expired"):
        ledger.cancel_local_task(running)


def test_local_retry_rolls_back_if_node_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-retry",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_retry_node_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'FAILED'
            BEGIN
                UPDATE workflow_node_runs SET revision = revision + 1
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="local retry"):
        ledger.fail_local_task(running, error_code="ValueError")
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == ("LEASED",)


def test_fail_current_attempt_rolls_back_if_attempt_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-fail-race",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_fail_attempt_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'COMPLETED'
            BEGIN
                UPDATE workflow_attempts SET status = 'CANCELLED'
                WHERE attempt_id = NEW.attempt_id;
            END
            """
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="local failure"):
        ledger.fail_local_task(running, error_code="ValueError")
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == ("LEASED",)


def test_cancel_rolls_back_if_node_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-cancel-race",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            f"""
            CREATE TRIGGER test_cancel_node_race
            AFTER UPDATE OF status ON task_ledger
            WHEN NEW.status = 'CANCELLED'
            BEGIN
                UPDATE workflow_node_runs SET revision = revision + 1
                WHERE node_run_id = '{queued.node_run_id}';
            END
            """
        )
        connection.commit()

    with pytest.raises(LeaseLostError, match="cancellation"):
        ledger.cancel_local_task(running)
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == ("LEASED",)


def test_handler_failure_is_closed_and_requeued_immediately(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)

    def fail(_claim: ClaimedTask) -> str:
        raise ValueError("handler rejected input")

    executor = LocalExecutor(
        ledger,
        worker_id="worker-fail",
        lease_duration=timedelta(seconds=30),
        handler=fail,
    )

    with pytest.raises(ValueError, match="handler rejected input"):
        executor.run_once()

    with sqlite3.connect(database) as connection:
        attempts = connection.execute(
            "SELECT attempt_id, status, retry_disposition, error_code "
            "FROM workflow_attempts ORDER BY attempt_number"
        ).fetchall()
        node = connection.execute(
            "SELECT status, attempt_count, active_attempt_id FROM workflow_node_runs"
        ).fetchone()
    assert attempts[0] == (queued.attempt_id, "FAILED", "SAFE_LOCAL_RETRY", "ValueError")
    assert attempts[1][1:] == ("READY", None, None)
    assert node == ("PENDING", 1, None)


def test_cancelled_local_claim_is_terminal_and_fenced(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    _repository, ledger, queued, _project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-cancel",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)

    ledger.cancel_local_task(running)

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (queued.task_id,)
        ).fetchone() == ("CANCELLED",)
        assert connection.execute(
            "SELECT status FROM workflow_attempts WHERE attempt_id = ?", (queued.attempt_id,)
        ).fetchone() == ("CANCELLED",)
        assert connection.execute(
            "SELECT status FROM workflow_node_runs WHERE node_run_id = ?", (queued.node_run_id,)
        ).fetchone() == ("CANCELLED",)
    with pytest.raises(LeaseLostError):
        ledger.heartbeat(running, lease_duration=timedelta(seconds=30))


def test_expired_attempt_with_committed_output_is_reconciled_without_regeneration(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-crash",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    output_version_id = create_output(
        repository,
        project_id=project_id,
        producer_attempt_id=running.attempt_id,
    )

    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()

    assert (summary.recovered, summary.succeeded, summary.requeued, summary.failed) == (1, 1, 0, 0)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
            (queued.attempt_id,),
        ).fetchone() == ("SUCCEEDED", output_version_id)
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_node_runs WHERE node_run_id = ?",
            (queued.node_run_id,),
        ).fetchone() == ("SUCCEEDED", output_version_id)


def test_fail_reconciles_committed_output_and_rolls_back_if_state_changes(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-receipt",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    create_output(
        repository,
        project_id=project_id,
        producer_attempt_id=running.attempt_id,
    )
    ledger.fail_local_task(running, error_code="RuntimeError")
    with sqlite3.connect(database) as connection:
        assert (
            connection.execute(
                "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
                (queued.attempt_id,),
            ).fetchone()[0]
            == "SUCCEEDED"
        )

    database_race = tmp_path / "workspace-race.db"
    clock_race = [NOW]
    repository_race, ledger_race, queued_race, project_race = setup_execution(
        database_race,
        clock_race,
    )
    claim_race = ledger_race.claim_ready_task(
        worker_id="worker-receipt-race",
        lease_duration=timedelta(seconds=30),
    )
    assert claim_race is not None
    running_race = ledger_race.mark_attempt_running(claim_race)
    create_output(
        repository_race,
        project_id=project_race,
        producer_attempt_id=running_race.attempt_id,
    )
    with sqlite3.connect(database_race) as connection:
        connection.execute(
            """
            CREATE TRIGGER test_fail_receipt_race
            AFTER UPDATE OF status ON workflow_attempts
            WHEN NEW.status = 'SUCCEEDED'
            BEGIN
                UPDATE workflow_node_runs SET revision = revision + 1
                WHERE node_run_id = NEW.node_run_id;
            END
            """
        )
        connection.commit()
    with pytest.raises(LeaseLostError, match="failure reconciliation"):
        ledger_race.fail_local_task(running_race, error_code="RuntimeError")
    with sqlite3.connect(database_race) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (queued_race.task_id,),
        ).fetchone() == ("LEASED",)


def test_handler_failure_after_committed_output_completes_without_retry(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)

    def commit_then_fail(claim: ClaimedTask) -> str:
        create_output(
            repository,
            project_id=project_id,
            producer_attempt_id=claim.attempt_id,
        )
        raise RuntimeError("lost after artifact commit")

    executor = LocalExecutor(
        ledger,
        worker_id="worker-output",
        lease_duration=timedelta(seconds=30),
        handler=commit_then_fail,
    )

    with pytest.raises(RuntimeError, match="lost after artifact"):
        executor.run_once()

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (1,)
        assert (
            connection.execute(
                "SELECT status, output_version_id FROM workflow_attempts WHERE attempt_id = ?",
                (queued.attempt_id,),
            ).fetchone()[0]
            == "SUCCEEDED"
        )


def test_executor_heartbeats_while_a_long_handler_is_running(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository, ledger, _queued, project_id = setup_execution(
        database,
        [datetime.now(UTC)],
    )
    entered = Event()
    release = Event()

    def slow_handler(claim: ClaimedTask) -> str:
        entered.set()
        assert release.wait(timeout=2)
        return create_output(
            repository,
            project_id=project_id,
            producer_attempt_id=claim.attempt_id,
        )

    executor = LocalExecutor(
        LocalTaskLedger(database),
        worker_id="worker-long",
        lease_duration=timedelta(milliseconds=120),
        heartbeat_interval=timedelta(milliseconds=25),
        handler=slow_handler,
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        execution = pool.submit(executor.run_once)
        assert entered.wait(timeout=1)
        sleep(0.25)
        summary = LocalTaskLedger(database).recover_expired_local_tasks()
        assert summary.recovered == 0
        release.set()
        assert execution.result(timeout=2)


@pytest.mark.parametrize("kill_point", tuple(KillPoint))
def test_injected_kill_points_have_deterministic_recovery(
    tmp_path: Path,
    kill_point: KillPoint,
) -> None:
    database = tmp_path / f"workspace-{kill_point.value}.db"
    clock = [NOW]
    repository, ledger, queued, project_id = setup_execution(database, clock)

    def handle(claim: ClaimedTask) -> str:
        return create_output(
            repository,
            project_id=project_id,
            producer_attempt_id=claim.attempt_id,
        )

    executor = LocalExecutor(
        ledger,
        worker_id="worker-kill",
        lease_duration=timedelta(seconds=30),
        handler=handle,
        fault_injector=FaultInjector(kill_point),
    )

    with pytest.raises(InjectedProcessCrash):
        executor.run_once()

    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()
    with sqlite3.connect(database) as connection:
        attempts = connection.execute(
            "SELECT status FROM workflow_attempts ORDER BY attempt_number"
        ).fetchall()
        node_status = connection.execute(
            "SELECT status FROM workflow_node_runs WHERE node_run_id = ?",
            (queued.node_run_id,),
        ).fetchone()[0]

    if kill_point in {
        KillPoint.AFTER_HANDLER_OUTPUT,
        KillPoint.BEFORE_COMPLETION,
    }:
        assert (summary.recovered, summary.succeeded, summary.requeued) == (1, 1, 0)
        assert attempts == [("SUCCEEDED",)]
        assert node_status == "SUCCEEDED"
    elif kill_point == KillPoint.AFTER_COMPLETION:
        assert summary.recovered == 0
        assert attempts == [("SUCCEEDED",)]
        assert node_status == "SUCCEEDED"
    else:
        assert (summary.recovered, summary.requeued) == (1, 1)
        assert attempts == [("FAILED",), ("READY",)]
        assert node_status == "PENDING"


def test_fixed_seed_fault_gate_uses_a_stable_kill_point(tmp_path: Path) -> None:
    kill_point = deterministic_kill_point(603)
    assert kill_point in set(KillPoint)

    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, _queued, project_id = setup_execution(database, clock)

    class ProcessDouble:
        def run(self, claim: ClaimedTask, heartbeat: HeartbeatCallback) -> str:
            heartbeat(claim)
            return create_output(
                repository,
                project_id=project_id,
                producer_attempt_id=claim.attempt_id,
            )

    executor = LocalExecutor(
        ledger,
        worker_id="worker-seed",
        lease_duration=timedelta(seconds=30),
        heartbeat_interval=timedelta(seconds=5),
        handler=lambda _claim: "ver_unused",
        supervisor=ProcessDouble(),
        fault_injector=FaultInjector(kill_point),
    )

    with pytest.raises(InjectedProcessCrash):
        executor.run_once()


def test_fault_injection_x100_seed_skeleton(tmp_path: Path) -> None:
    if os.environ.get("AIJIAN_FAULT_X100") != "1":
        pytest.skip("set AIJIAN_FAULT_X100=1 to run the full fault-injection seed sweep")
    for seed in range(100):
        kill_point = deterministic_kill_point(seed)
        database = tmp_path / f"workspace-{seed}.db"
        clock = [NOW]
        repository, ledger, _queued, project_id = setup_execution(database, clock)

        def handle(
            claim: ClaimedTask,
            *,
            repository: StudioRepository = repository,
            project_id: str = project_id,
        ) -> str:
            return create_output(
                repository,
                project_id=project_id,
                producer_attempt_id=claim.attempt_id,
            )

        executor = LocalExecutor(
            ledger,
            worker_id=f"worker-seed-{seed}",
            lease_duration=timedelta(seconds=30),
            handler=handle,
            fault_injector=FaultInjector(kill_point),
        )
        with pytest.raises(InjectedProcessCrash):
            executor.run_once()
