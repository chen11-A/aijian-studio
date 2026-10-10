"""Offline accounting over real temporary SQLite; no transport or paid request."""

import json
import sqlite3
from datetime import timedelta
from types import SimpleNamespace

import pytest
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.remote_call_accounting import (
    RemoteCallAccountingError,
    read_call_accounting_in_connection,
)
from test_remote_execution_authorization import (
    NOW,
    _issued_remote_dispatch,
    _OfflineTrustedSettlementVerifier,
    _proposal_for_remote_permit,
    _record_remote_candidate,
)


@pytest.fixture
def settled(tmp_path):
    database, _, project, source, manifest, ledger, _, _, store, permit = _issued_remote_dispatch(
        tmp_path
    )
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project,
        source=source,
        manifest_version_id=manifest,
    )
    _record_remote_candidate(database, store, permit, proposal, "synthetic-response")
    return database, project, permit.claim.attempt_id


def read(settled, *, verifier=None, transform=None, checked_at=NOW):
    database, project, attempt = settled
    with sqlite3.connect(database) as connection:

        def row_factory(cursor, values):
            row = sqlite3.Row(cursor, values)
            return transform(row) if transform else row

        connection.row_factory = row_factory
        connection.execute("BEGIN")
        statements = []
        connection.set_trace_callback(statements.append)
        result = read_call_accounting_in_connection(
            connection,
            project_id=project,
            attempt_id=attempt,
            checked_at=checked_at,
            settlement_verifier=verifier,
        )
        assert connection.total_changes == 0
        assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
        return result


@pytest.mark.parametrize("trusted", [False, True])
def test_receipt_is_verified_only_by_a_current_offline_verifier(settled, trusted):
    result = read(settled, verifier=_OfflineTrustedSettlementVerifier() if trusted else None)
    assert result.calls_reserved == 1
    assert result.transport_dispatch_status == "UNVERIFIED"
    assert not result.automatic_retry_allowed
    assert result.response_status == "RESPONSE_ID_RECORDED"
    assert result.cost_evidence_status == ("VERIFIED" if trusted else "UNVERIFIED")
    assert (result.actual_cost_micros is not None) is trusted
    assert result.currency == ("USD" if trusted else None)


@pytest.mark.parametrize("fault", ["raises", "denies", "wrong_hash", "wrong_time"])
def test_verifier_failure_does_not_manufacture_zero_cost_or_retry(settled, fault):
    def verify(receipt, *, checked_at):
        if fault == "raises":
            raise RuntimeError("synthetic verification failure")
        verified = _OfflineTrustedSettlementVerifier().verify(receipt, checked_at=checked_at)
        changes = {
            "denies": {"status": "DENIED"},
            "wrong_hash": {"receipt_hash": "sha256:" + "0" * 64},
            "wrong_time": {"checked_at": checked_at - timedelta(seconds=1)},
        }
        return verified.model_copy(update=changes[fault])

    result = read(settled, verifier=SimpleNamespace(verify=verify))
    assert result.cost_evidence_status == "UNVERIFIED"
    assert result.cost_status == "UNKNOWN"
    assert result.actual_cost_micros is None and result.currency is None
    assert not result.automatic_retry_allowed


@pytest.mark.parametrize(
    "column,value",
    [
        ("receipt_hash", "sha256:" + "0" * 64),
        ("verification_hash", "sha256:" + "0" * 64),
        ("receipt_json", "{}"),
        ("verification_json", "{}"),
        ("authorization_id", "rea_" + "0" * 32),
        ("consume_revision", 99),
        ("lease_generation", 99),
        ("issuer_id", "another"),
        ("trust_profile_id", "another"),
        ("trust_profile_version", "another"),
        ("receipt_id", "another"),
        ("provider_response_id", "another"),
        ("connection_id", "another"),
        ("connection_revision", 99),
        ("model_id", "another"),
        ("operation", "another"),
        ("currency", "EUR"),
        ("actual_micros", 999999),
        ("settled_at", "2020-01-01T00:00:00Z"),
    ],
)
def test_corrupt_readback_columns_never_turn_into_verified_cost(settled, column, value):
    # Simulate corrupted readback without modifying or weakening immutable tables.
    def transform(row):
        return {**dict(row), column: value} if "receipt_json" in row.keys() else row

    result = read(settled, verifier=_OfflineTrustedSettlementVerifier(), transform=transform)
    assert result.cost_evidence_status == "INVALID"
    assert result.actual_cost_micros is None and result.currency is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("status", "DENIED"),
        ("receipt_hash", "sha256:" + "0" * 64),
        ("checked_at", (NOW + timedelta(seconds=1)).isoformat()),
    ],
)
def test_rehashed_but_inconsistent_stored_verification_is_invalid(settled, field, value):
    def transform(row):
        if "verification_json" not in row.keys():
            return row
        data = dict(row)
        verification = json.loads(data["verification_json"])
        verification[field] = value
        data["verification_json"] = json.dumps(verification)
        data["verification_hash"] = canonical_sha256(verification)
        return data

    result = read(settled, verifier=_OfflineTrustedSettlementVerifier(), transform=transform)
    assert result.cost_evidence_status == "INVALID"


def test_accounting_requires_explicit_read_transaction_and_timezone(settled):
    database, project, attempt = settled
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        with pytest.raises(RemoteCallAccountingError, match="transaction"):
            read_call_accounting_in_connection(
                connection, project_id=project, attempt_id=attempt, checked_at=NOW
            )
        connection.execute("BEGIN")
        with pytest.raises(RemoteCallAccountingError, match="timezone"):
            read_call_accounting_in_connection(
                connection,
                project_id=project,
                attempt_id=attempt,
                checked_at=NOW.replace(tzinfo=None),
            )
        with pytest.raises(RemoteCallAccountingError, match="unavailable"):
            read_call_accounting_in_connection(
                connection, project_id="prj_" + "0" * 32, attempt_id=attempt, checked_at=NOW
            )
