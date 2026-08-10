import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from time import sleep

import pytest
from aijian_api.local_executor import LocalExecutor
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import ClaimedTask, LeaseLostError, LocalTaskLedger, QueuedTask

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def setup_execution(
    database: Path,
    clock: list[datetime],
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
        max_attempts=2,
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


def test_executor_can_claim_only_the_requested_task(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, requested, project_id = setup_execution(database, clock)
    higher_priority = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="golden-short",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["render.preview"]},
        workflow_input_hash=HASH_A,
        node_key="render.preview.alternate",
        node_type="render.preview",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key="golden-short:render.preview.alternate",
        max_attempts=2,
        task_kind="local.execute",
        priority=100,
        available_at=clock[0],
    )
    observed_tasks: list[str] = []

    def handle(claim: ClaimedTask) -> str:
        observed_tasks.append(claim.task_id)
        return create_output(
            repository,
            project_id=project_id,
            producer_attempt_id=claim.attempt_id,
        )

    executor = LocalExecutor(
        ledger,
        worker_id="worker-targeted",
        lease_duration=timedelta(seconds=30),
        handler=handle,
    )

    assert executor.run_once(task_id=requested.task_id)
    assert observed_tasks == [requested.task_id]
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (requested.task_id,)
        ).fetchone() == ("COMPLETED",)
        assert connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?", (higher_priority.task_id,)
        ).fetchone() == ("READY",)


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

    def crash(_claim: ClaimedTask) -> str:
        raise RuntimeError("injected worker crash")

    executor = LocalExecutor(
        ledger,
        worker_id="worker-crash",
        lease_duration=timedelta(seconds=30),
        handler=crash,
    )
    with pytest.raises(RuntimeError, match="injected worker crash"):
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
