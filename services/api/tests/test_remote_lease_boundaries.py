"""Offline SQLite lifecycle tests; test-only evidence never enables a transport."""

import sqlite3
from dataclasses import replace
from datetime import timedelta
from unittest.mock import Mock

import pytest
from aijian_api import remote_execution_authorization as auth
from aijian_api.task_ledger_models import LeaseLostError
from test_remote_execution_authorization import (
    HASH,
    NOW,
    _issued_remote_authorization,
    _issued_remote_dispatch,
)


def rows(database):
    with sqlite3.connect(database) as connection:
        return {
            table: connection.execute(f"SELECT * FROM {table}").fetchall()
            for table in (
                "workflow_attempts",
                "workflow_node_runs",
                "task_ledger",
                "agent_runs",
                "skill_runs",
                "remote_execution_authorization_snapshots",
            )
        }


def lose_cas(store, monkeypatch, fragment):
    open_connection = store._open
    hits = []

    class Connection:
        def __init__(self):
            self.connection = open_connection()

        def execute(self, sql, args=()):
            cursor = self.connection.execute(sql, args)
            if fragment in " ".join(sql.split()):
                hits.append(sql)
                return Mock(fetchone=Mock(return_value=None))
            return cursor

        def __getattr__(self, name):
            return getattr(self.connection, name)

    monkeypatch.setattr(store, "_open", Connection)
    return hits


def test_predispatch_failure_is_terminal_without_authorization_consumption(tmp_path):
    database, _, _, _, _, ledger, claim, _, store = _issued_remote_authorization(tmp_path)
    store.fail_remote_before_dispatch(claim=claim)
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, retry_disposition, error_code, dispatch_started_at "
            "FROM workflow_attempts WHERE attempt_id = ?",
            (claim.attempt_id,),
        ).fetchone() == ("FAILED", "NON_RETRYABLE", "REMOTE_PRE_DISPATCH_REJECTED", None)
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == ("FAILED",)
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("COMPLETED",)
        assert connection.execute("SELECT status FROM agent_runs").fetchone() == ("FAILED",)
        assert connection.execute("SELECT status FROM skill_runs").fetchone() == ("FAILED",)
        assert connection.execute(
            "SELECT event_kind FROM remote_execution_authorization_snapshots"
        ).fetchall() == [("ISSUE",)]
    after = rows(database)
    with pytest.raises(LeaseLostError):
        store.fail_remote_before_dispatch(claim=claim)
    assert rows(database) == after
    assert (
        ledger.claim_remote_task(
            worker_id="not-a-runtime", lease_duration=timedelta(seconds=10), task_id=claim.task_id
        )
        is None
    )


@pytest.mark.parametrize("table", ["workflow_attempts", "workflow_node_runs", "task_ledger"])
def test_predispatch_completion_cas_failure_rolls_back_all_states(tmp_path, monkeypatch, table):
    database, *_, claim, _, store = _issued_remote_authorization(tmp_path)
    before = rows(database)
    hits = lose_cas(store, monkeypatch, f"UPDATE {table}")
    with pytest.raises(LeaseLostError, match="pre-dispatch failure state changed"):
        store.fail_remote_before_dispatch(claim=claim)
    assert len(hits) == 1
    assert rows(database) == before


@pytest.mark.parametrize("status", ["SUBMIT_INTENT", "SUBMITTING"])
def test_dispatch_cas_failure_rolls_back_consumption_and_agent_state(tmp_path, monkeypatch, status):
    database, *_, claim, grant, store = _issued_remote_authorization(tmp_path)
    before = rows(database)
    hits = lose_cas(store, monkeypatch, f"SET status = '{status}'")
    with pytest.raises(LeaseLostError):
        store.begin_remote_dispatch(
            claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
        )
    assert len(hits) == 1
    assert rows(database) == before


def test_renewal_returns_new_fence_and_old_permit_cannot_dispatch(tmp_path):
    database, *_, store, permit = _issued_remote_dispatch(tmp_path)
    renewed = store.renew_remote_dispatch_permit(
        permit=permit, lease_duration=timedelta(seconds=90)
    )
    assert renewed.claim.task_revision == permit.claim.task_revision + 1
    assert renewed.claim.lease_expires_at == NOW + timedelta(seconds=90)
    assert renewed.claim.heartbeat_at == NOW
    assert renewed.authorization_id == permit.authorization_id
    assert renewed.grant_core_hash == permit.grant_core_hash
    assert renewed.evidence_binding_hash == permit.evidence_binding_hash
    store.recheck_dispatch_permit(renewed)
    before = rows(database)
    with pytest.raises(LeaseLostError):
        store.recheck_dispatch_permit(permit)
    assert rows(database) == before
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT event_kind FROM remote_execution_authorization_snapshots ORDER BY revision"
        ).fetchall() == [("ISSUE",), ("CONSUME",)]


@pytest.mark.parametrize("seconds", [0, -1])
def test_invalid_renewal_duration_never_opens_store(tmp_path, monkeypatch, seconds):
    _, *_, store, permit = _issued_remote_dispatch(tmp_path)
    opener = Mock(side_effect=AssertionError("must not open"))
    monkeypatch.setattr(store, "_open", opener)
    with pytest.raises(ValueError, match="lease duration must be positive"):
        store.renew_remote_dispatch_permit(permit=permit, lease_duration=timedelta(seconds=seconds))
    opener.assert_not_called()


@pytest.mark.parametrize("field", ["grant_core_hash", "evidence_binding_hash"])
def test_tampered_renewal_evidence_cannot_advance_lease(tmp_path, field):
    database, *_, store, permit = _issued_remote_dispatch(tmp_path)
    before = rows(database)
    with pytest.raises(auth.RemoteAuthorizationError):
        store.renew_remote_dispatch_permit(
            permit=replace(permit, **{field: HASH}), lease_duration=timedelta(seconds=90)
        )
    assert rows(database) == before


def test_renewal_late_cas_loss_rolls_back_task_heartbeat(tmp_path, monkeypatch):
    database, *_, store, permit = _issued_remote_dispatch(tmp_path)
    before = rows(database)
    hits = lose_cas(store, monkeypatch, "UPDATE task_ledger")
    with pytest.raises(LeaseLostError, match="expired before renewal"):
        store.renew_remote_dispatch_permit(permit=permit, lease_duration=timedelta(seconds=90))
    assert len(hits) == 1
    assert rows(database) == before


@pytest.mark.parametrize("seconds", [0, -1])
def test_invalid_connection_timeout_cannot_create_database(tmp_path, seconds):
    database = tmp_path / "must-not-exist.db"
    with pytest.raises(ValueError, match="connection timeout must be positive"):
        auth.RemoteExecutionAuthorizationStore(
            database,
            id_factory=lambda prefix: prefix,
            connection_timeout=timedelta(seconds=seconds),
        )
    assert not database.exists()


def test_lease_renewal_uses_configured_lock_wait_bound(tmp_path):
    store = auth.RemoteExecutionAuthorizationStore(
        tmp_path / "timeout.db",
        id_factory=lambda prefix: prefix,
        connection_timeout=timedelta(milliseconds=125),
    )
    assert store.lease_renewal_timeout_seconds == 0.125


@pytest.mark.parametrize("consumed", [False, True])
@pytest.mark.parametrize("corruption", ["missing", "grant", "decision", "hash"])
def test_corrupt_authorization_reads_fail_closed_without_writes(tmp_path, consumed, corruption):
    database, *_, grant, store, permit = _issued_remote_dispatch(tmp_path)
    event_kind = "CONSUME" if consumed else "ISSUE"
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        row = dict(
            connection.execute(
                "SELECT * FROM remote_execution_authorization_snapshots WHERE event_kind = ?",
                (event_kind,),
            ).fetchone()
        )
    before = rows(database)
    if corruption == "grant":
        row["grant_core_json"] = "{invalid"
    elif corruption == "decision":
        row["evidence_decision_json"] = "{}"
    elif corruption == "hash":
        row["grant_core_hash"] = HASH
    reader = Mock()
    reader.execute.return_value.fetchone.return_value = None if corruption == "missing" else row
    read = auth._read_consumed_snapshot if consumed else auth._read_latest_snapshot
    with pytest.raises(auth.RemoteAuthorizationError):
        read(reader, grant.authorization_id)
    assert reader.execute.call_count == 1
    assert reader.execute.call_args.args[0].startswith("SELECT ")
    assert reader.execute.call_args.args[1] == (grant.authorization_id,)
    assert rows(database) == before


@pytest.mark.parametrize(
    "field", ["scope_json", "input_scope_hash", "snapshot_hash", "connection_revision"]
)
def test_dispatch_snapshot_corruption_stops_before_trust_checks(tmp_path, monkeypatch, field):
    database, *_, store, permit = _issued_remote_dispatch(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        row = dict(connection.execute("SELECT * FROM remote_dispatch_snapshots").fetchone())
    row[field] = "bad"
    reader = Mock()
    reader.execute.return_value.fetchone.return_value = row
    truth = Mock(side_effect=AssertionError("malformed snapshot must not reach trust checks"))
    provider = Mock(side_effect=AssertionError("malformed snapshot must not reach provider checks"))
    monkeypatch.setattr(auth, "_assert_dispatch_scope_matches_database", truth)
    monkeypatch.setattr(auth, "_assert_current_provider_metadata", provider)
    with pytest.raises(auth.RemoteAuthorizationError, match="snapshot is malformed"):
        auth._read_dispatch_snapshot(
            reader,
            permit.claim.attempt_id,
            require_current_provider=True,
            require_current_truth=True,
        )
    truth.assert_not_called()
    provider.assert_not_called()


@pytest.mark.parametrize("operation", ["fail", "renew"])
def test_predispatch_failure_and_renewal_reject_wrong_phase_without_changes(tmp_path, operation):
    database, *_, claim, grant, store = _issued_remote_authorization(tmp_path)
    if operation == "fail":
        permit = store.begin_remote_dispatch(
            claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
        )

        def call():
            store.fail_remote_before_dispatch(claim=permit.claim)
    else:
        permit = auth.RemoteDispatchPermit(claim, grant.authorization_id, HASH, HASH)

        def call():
            store.renew_remote_dispatch_permit(permit=permit, lease_duration=timedelta(seconds=90))

    before = rows(database)
    with pytest.raises(auth.RemoteAuthorizationError, match="required remote state"):
        call()
    assert rows(database) == before
