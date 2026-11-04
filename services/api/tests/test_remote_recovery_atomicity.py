"""Offline failure injection: remote lease recovery must commit all state or none."""

import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest
from aijian_api.task_ledger import LeaseLostError, LocalTaskLedger
from test_remote_execution_authorization import NOW, _issued_remote_authorization


def database_dump(database: Path) -> tuple[str, ...]:
    with sqlite3.connect(database) as connection:
        return tuple(connection.iterdump())


@pytest.mark.parametrize("phase", ["pre_dispatch", "submit_intent"])
@pytest.mark.parametrize("table", ["task_ledger", "workflow_attempts", "workflow_node_runs"])
def test_remote_recovery_cas_loss_rolls_back_every_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, phase: str, table: str
) -> None:
    database, _, _, _, _, _, claim, _, _ = _issued_remote_authorization(tmp_path)
    if phase == "submit_intent":
        with sqlite3.connect(database) as connection:
            connection.execute(
                "UPDATE workflow_attempts SET status = 'SUBMIT_INTENT' WHERE attempt_id = ?",
                (claim.attempt_id,),
            )
    before = database_dump(database)
    calls: list[str] = []

    class LostCompareAndSwap(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            if sql.strip().startswith(f"UPDATE {table}\n"):
                calls.append(sql)
                # Model a stale WHERE revision: no row changed or returned.
                return super().execute("SELECT 1 WHERE 0")
            return super().execute(sql, parameters)

    def open_fault_connection():
        connection = sqlite3.connect(database, factory=LostCompareAndSwap)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    ledger = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
    monkeypatch.setattr(ledger, "_open", open_fault_connection)
    message = "changed during requeue" if phase == "pre_dispatch" else "changed during quarantine"
    with pytest.raises(LeaseLostError, match=message):
        ledger.recover_expired_remote_tasks(task_kind="remote.extract")

    assert len(calls) == 1  # no retry loop on failed CAS
    assert database_dump(database) == before  # includes attempts, events and authorizations

    # Once the injected conflict is removed, the same durable attempt is recovered exactly once.
    monkeypatch.undo()
    summary = ledger.recover_expired_remote_tasks(task_kind="remote.extract")
    assert summary.recovered == 1
    assert summary.requeued == (1 if phase == "pre_dispatch" else 0)
    assert summary.quarantined == (1 if phase == "submit_intent" else 0)
    assert ledger.recover_expired_remote_tasks(task_kind="remote.extract").recovered == 0
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT attempt_id FROM workflow_attempts").fetchall() == [
            (claim.attempt_id,)
        ]


@pytest.mark.parametrize("task_kind", ["", " \t\n"])
def test_remote_recovery_rejects_empty_filter_without_opening_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, task_kind: str
) -> None:
    ledger = LocalTaskLedger(tmp_path / "unused.db", clock=lambda: NOW)

    def must_not_open():
        raise AssertionError("invalid task kind must not open a transaction")

    monkeypatch.setattr(ledger, "_open", must_not_open)
    with pytest.raises(ValueError, match="task kind must not be empty"):
        ledger.recover_expired_remote_tasks(task_kind=task_kind)
