import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from threading import Event, Thread

import pytest
from aijian_api.task_ledger import (
    ClaimedTask,
    LeaseLostError,
    LocalTaskLedger,
    QueuedTask,
    TaskCompletion,
)
from aijian_api.task_ledger_models import timestamp
from test_local_executor import NOW, create_output, setup_execution

_SNAPSHOT_TABLES = (
    "workflow_runs",
    "task_ledger",
    "workflow_attempts",
    "workflow_node_runs",
    "artifacts",
    "artifact_versions",
    "artifact_heads",
    "workflow_transition_events",
)


def _snapshot(database: Path) -> dict[str, list[tuple[object, ...]]]:
    connection = sqlite3.connect(database)
    try:
        return {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            for table in _SNAPSHOT_TABLES
        }
    finally:
        connection.close()


def _event_view(database: Path) -> list[tuple[object, ...]]:
    connection = sqlite3.connect(database)
    try:
        return connection.execute(
            """
            SELECT entity_kind, entity_id, from_status, to_status, reason_code,
                   lease_generation, created_at
            FROM workflow_transition_events
            ORDER BY rowid
            """
        ).fetchall()
    finally:
        connection.close()


def _revisions(
    database: Path,
    *,
    task_id: str,
    attempt_id: str,
    node_run_id: str,
) -> tuple[int, int, int]:
    connection = sqlite3.connect(database)
    try:
        task = connection.execute(
            "SELECT revision FROM task_ledger WHERE task_id = ?", (task_id,)
        ).fetchone()
        attempt = connection.execute(
            "SELECT revision FROM workflow_attempts WHERE attempt_id = ?", (attempt_id,)
        ).fetchone()
        node = connection.execute(
            "SELECT revision FROM workflow_node_runs WHERE node_run_id = ?", (node_run_id,)
        ).fetchone()
    finally:
        connection.close()
    assert task is not None
    assert attempt is not None
    assert node is not None
    return int(task[0]), int(attempt[0]), int(node[0])


def _workflow_state(database: Path, *, node_run_id: str) -> tuple[str, int, str, str]:
    connection = sqlite3.connect(database)
    try:
        workflow = connection.execute(
            """
            SELECT run.workflow_run_id, run.revision, run.status, run.updated_at
            FROM workflow_runs AS run
            JOIN workflow_node_runs AS node ON node.workflow_run_id = run.workflow_run_id
            WHERE node.node_run_id = ?
            """,
            (node_run_id,),
        ).fetchone()
    finally:
        connection.close()
    assert workflow is not None
    return str(workflow[0]), int(workflow[1]), str(workflow[2]), str(workflow[3])


def _prepare_running_execution(
    tmp_path: Path,
) -> tuple[Path, list[datetime], LocalTaskLedger, QueuedTask, ClaimedTask, str]:
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
    return database, clock, ledger, queued, running, output_version_id


def _complete_after_write_lock_wait(
    ledger: LocalTaskLedger,
    database: Path,
    clock: list[datetime],
    claim: ClaimedTask,
    *,
    output_version_id: str,
    advance: timedelta,
    snapshot_before: dict[str, list[tuple[object, ...]]],
) -> TaskCompletion:
    begin_requested = Event()
    lease_select_started = Event()
    worker_done = Event()
    worker_result: list[TaskCompletion] = []
    worker_error: list[BaseException] = []
    original_open = ledger._open
    blocker: sqlite3.Connection | None = None
    worker: Thread | None = None
    primary_error: BaseException | None = None
    cleanup_errors: list[BaseException] = []

    def traced_open() -> sqlite3.Connection:
        connection = original_open()

        def trace(statement: str) -> None:
            normalized = " ".join(statement.split()).upper()
            if normalized == "BEGIN IMMEDIATE":
                begin_requested.set()
            elif normalized.startswith("SELECT 1 FROM TASK_LEDGER"):
                lease_select_started.set()

        connection.set_trace_callback(trace)
        return connection

    def complete() -> None:
        try:
            worker_result.append(
                ledger.complete_local_task(claim, output_version_id=output_version_id)
            )
        except BaseException as error:
            worker_error.append(error)
        finally:
            worker_done.set()

    try:
        ledger._open = traced_open
        blocker = sqlite3.connect(database, isolation_level=None)
        blocker.execute("PRAGMA busy_timeout = 5000")
        blocker.execute("BEGIN IMMEDIATE")
        worker = Thread(target=complete, name="completion-lease-expiry", daemon=True)
        worker.start()
        assert begin_requested.wait(timeout=2)
        assert not worker_done.is_set()
        assert not lease_select_started.is_set()
        clock[0] = NOW + advance
        assert _snapshot(database) == snapshot_before
        blocker.commit()
        if not worker_done.wait(timeout=2):
            raise AssertionError("completion worker did not finish after write lock release")
        if worker_error:
            raise worker_error[0]
        assert len(worker_result) == 1
        return worker_result[0]
    except BaseException as error:
        primary_error = error
        raise
    finally:
        if blocker is not None:
            try:
                if blocker.in_transaction:
                    blocker.rollback()
            except BaseException as error:
                cleanup_errors.append(error)
            try:
                blocker.close()
            except BaseException as error:
                cleanup_errors.append(error)
        if worker is not None:
            try:
                worker.join(timeout=2)
                if worker.is_alive():
                    cleanup_errors.append(AssertionError("completion worker survived cleanup"))
            except BaseException as error:
                cleanup_errors.append(error)
        try:
            ledger._open = original_open
        except BaseException as error:
            cleanup_errors.append(error)
        if cleanup_errors:
            message = "completion cleanup failed: " + "; ".join(
                str(error) for error in cleanup_errors
            )
            cleanup_failure = AssertionError(message)
            if primary_error is not None:
                raise cleanup_failure from primary_error
            else:
                raise cleanup_failure from cleanup_errors[0]


@pytest.mark.parametrize("seconds", [30, 31], ids=("exact-expiry", "after-expiry"))
def test_completion_rejects_expired_lease_after_waiting_for_write_lock(
    tmp_path: Path,
    seconds: int,
) -> None:
    (
        database,
        clock,
        ledger,
        queued,
        running,
        output_version_id,
    ) = _prepare_running_execution(tmp_path)
    snapshot_before = _snapshot(database)
    events_before = _event_view(database)

    with pytest.raises(LeaseLostError, match="stale or expired"):
        _complete_after_write_lock_wait(
            ledger,
            database,
            clock,
            running,
            output_version_id=output_version_id,
            advance=timedelta(seconds=seconds),
            snapshot_before=snapshot_before,
        )

    assert _snapshot(database) == snapshot_before
    assert _event_view(database) == events_before

    recovery = ledger.recover_expired_local_tasks()
    assert (
        recovery.recovered,
        recovery.succeeded,
        recovery.requeued,
        recovery.failed,
    ) == (1, 1, 0, 0)
    snapshot_after_recovery = _snapshot(database)
    assert (
        snapshot_after_recovery["workflow_transition_events"][
            : len(snapshot_before["workflow_transition_events"])
        ]
        == snapshot_before["workflow_transition_events"]
    )
    assert len(snapshot_after_recovery["workflow_attempts"]) == len(
        snapshot_before["workflow_attempts"]
    )
    assert len(snapshot_after_recovery["artifacts"]) == len(snapshot_before["artifacts"])
    assert len(snapshot_after_recovery["artifact_versions"]) == len(
        snapshot_before["artifact_versions"]
    )
    assert snapshot_after_recovery["artifacts"] == snapshot_before["artifacts"]
    assert snapshot_after_recovery["artifact_versions"] == snapshot_before["artifact_versions"]
    assert snapshot_after_recovery["artifact_heads"] == snapshot_before["artifact_heads"]

    connection = sqlite3.connect(database)
    try:
        assert connection.execute(
            "SELECT task_id, attempt_id, status FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == (queued.task_id, queued.attempt_id, "COMPLETED")
        assert connection.execute(
            """
            SELECT attempt_id, status, output_version_id
            FROM workflow_attempts WHERE attempt_id = ?
            """,
            (queued.attempt_id,),
        ).fetchone() == (queued.attempt_id, "SUCCEEDED", output_version_id)
        assert connection.execute(
            """
            SELECT node_run_id, status, output_version_id
            FROM workflow_node_runs WHERE node_run_id = ?
            """,
            (queued.node_run_id,),
        ).fetchone() == (queued.node_run_id, "SUCCEEDED", output_version_id)
    finally:
        connection.close()

    recovered_at = timestamp(NOW + timedelta(seconds=seconds))
    assert _event_view(database)[len(events_before) :] == [
        (
            "task",
            queued.task_id,
            "LEASED",
            "COMPLETED",
            "output.receipt_recovered",
            1,
            recovered_at,
        ),
        (
            "attempt",
            queued.attempt_id,
            "RUNNING",
            "SUCCEEDED",
            "output.receipt_recovered",
            1,
            recovered_at,
        ),
        (
            "node",
            queued.node_run_id,
            "RUNNING",
            "SUCCEEDED",
            "output.receipt_recovered",
            1,
            recovered_at,
        ),
    ]
    second_recovery = ledger.recover_expired_local_tasks()
    assert (
        second_recovery.recovered,
        second_recovery.succeeded,
        second_recovery.requeued,
        second_recovery.failed,
    ) == (0, 0, 0, 0)
    assert _snapshot(database) == snapshot_after_recovery


def test_completion_accepts_unexpired_lease_after_waiting_for_write_lock(tmp_path: Path) -> None:
    (
        database,
        clock,
        ledger,
        queued,
        running,
        output_version_id,
    ) = _prepare_running_execution(tmp_path)
    snapshot_before = _snapshot(database)
    events_before = _event_view(database)
    revisions_before = _revisions(
        database,
        task_id=queued.task_id,
        attempt_id=queued.attempt_id,
        node_run_id=queued.node_run_id,
    )
    workflow_id, workflow_revision, workflow_status, _workflow_updated_at = _workflow_state(
        database,
        node_run_id=queued.node_run_id,
    )
    assert workflow_status == "ACTIVE"

    completion = _complete_after_write_lock_wait(
        ledger,
        database,
        clock,
        running,
        output_version_id=output_version_id,
        advance=timedelta(seconds=1),
        snapshot_before=snapshot_before,
    )

    assert (
        completion.task_id,
        completion.attempt_id,
        completion.node_run_id,
        completion.output_version_id,
    ) == (queued.task_id, queued.attempt_id, queued.node_run_id, output_version_id)
    revisions_after = _revisions(
        database,
        task_id=queued.task_id,
        attempt_id=queued.attempt_id,
        node_run_id=queued.node_run_id,
    )
    assert revisions_after == tuple(revision + 1 for revision in revisions_before)
    assert (
        completion.task_revision,
        completion.attempt_revision,
        completion.node_revision,
    ) == revisions_after

    completed_at = timestamp(NOW + timedelta(seconds=1))
    connection = sqlite3.connect(database)
    try:
        assert connection.execute(
            "SELECT status, revision, updated_at FROM task_ledger WHERE task_id = ?",
            (queued.task_id,),
        ).fetchone() == ("COMPLETED", revisions_after[0], completed_at)
        assert connection.execute(
            """
            SELECT status, output_version_id, revision, finished_at, updated_at
            FROM workflow_attempts WHERE attempt_id = ?
            """,
            (queued.attempt_id,),
        ).fetchone() == (
            "SUCCEEDED",
            output_version_id,
            revisions_after[1],
            completed_at,
            completed_at,
        )
        assert connection.execute(
            """
            SELECT status, output_version_id, revision, updated_at
            FROM workflow_node_runs WHERE node_run_id = ?
            """,
            (queued.node_run_id,),
        ).fetchone() == ("SUCCEEDED", output_version_id, revisions_after[2], completed_at)
    finally:
        connection.close()
    assert _workflow_state(database, node_run_id=queued.node_run_id) == (
        workflow_id,
        workflow_revision + 1,
        "SUCCEEDED",
        completed_at,
    )
    snapshot_after = _snapshot(database)
    assert (
        snapshot_after["workflow_transition_events"][
            : len(snapshot_before["workflow_transition_events"])
        ]
        == snapshot_before["workflow_transition_events"]
    )
    assert snapshot_after["artifacts"] == snapshot_before["artifacts"]
    assert snapshot_after["artifact_versions"] == snapshot_before["artifact_versions"]
    assert snapshot_after["artifact_heads"] == snapshot_before["artifact_heads"]
    assert _event_view(database)[len(events_before) :] == [
        (
            "attempt",
            queued.attempt_id,
            "RUNNING",
            "SUCCEEDED",
            "attempt.completed",
            1,
            completed_at,
        ),
        (
            "node",
            queued.node_run_id,
            "RUNNING",
            "SUCCEEDED",
            "node.completed",
            1,
            completed_at,
        ),
        (
            "task",
            queued.task_id,
            "LEASED",
            "COMPLETED",
            "task.completed",
            1,
            completed_at,
        ),
    ]


def test_completion_cleanup_failure_is_not_hidden_by_expected_lease_loss(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, clock, ledger, _queued, running, output_version_id = _prepare_running_execution(
        tmp_path
    )
    snapshot_before = _snapshot(database)
    original_join = Thread.join

    def join_with_cleanup_failure(thread: Thread, timeout: float | None = None) -> None:
        original_join(thread, timeout)
        if thread.name == "completion-lease-expiry":
            raise RuntimeError("injected cleanup failure")

    monkeypatch.setattr(Thread, "join", join_with_cleanup_failure)

    with pytest.raises(AssertionError, match="injected cleanup failure") as error:
        _complete_after_write_lock_wait(
            ledger,
            database,
            clock,
            running,
            output_version_id=output_version_id,
            advance=timedelta(seconds=31),
            snapshot_before=snapshot_before,
        )

    assert isinstance(error.value.__cause__, LeaseLostError)
