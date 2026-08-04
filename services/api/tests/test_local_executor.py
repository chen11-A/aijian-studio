import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.local_executor import LocalExecutor
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def setup_execution(database: Path, clock: list[datetime]):
    repository = StudioRepository(database, clock=lambda: clock[0])
    project = repository.create_project(
        name="黄金短篇",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    output = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="fake_render",
        schema_version="1.0.0",
        content={"media_hash": HASH_B},
        author_actor_type="system",
        author_actor_id="fake-provider",
        change_summary="生成确定性测试输出",
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
    return ledger, queued, output.version.id


def test_completion_atomically_links_output_attempt_node_and_task(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued, output_version_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)

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
    ledger, queued, _output_version_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)

    with pytest.raises(ValueError, match="same project"):
        ledger.complete_local_task(running, output_version_id="ver_missing")

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
    with pytest.raises(ValueError, match="same project"):
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
    ledger, _queued, output_version_id = setup_execution(database, clock)
    observed_attempts: list[str] = []
    executor = LocalExecutor(
        ledger,
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
        handler=lambda claim: observed_attempts.append(claim.attempt_id) or output_version_id,
    )

    assert executor.run_once()
    assert len(observed_attempts) == 1
    assert not executor.run_once()


def test_completion_rolls_back_if_node_revision_changes(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    ledger, queued, output_version_id = setup_execution(database, clock)
    claim = ledger.claim_ready_task(
        worker_id="worker-a",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
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
    ledger, queued, _output_version_id = setup_execution(database, clock)

    def crash(_claim):
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
