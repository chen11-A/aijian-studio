"""Independent offline QA for G1 recovery and settlement persistence at d00."""

import sqlite3
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api.agent_skill_builtins import SOURCE_EXTRACT_REMOTE_REF
from aijian_api.agent_skill_contracts import AgentSkillFixtureBundleV1, canonical_sha256
from aijian_api.gateway_transport import GatewayTextSuccess
from aijian_api.remote_execution_authorization import RemoteAuthorizationError
from aijian_api.remote_settlement_contracts import (
    DenyRemoteSettlementVerifier,
    RemoteSettlementReceiptPayloadV1,
    RemoteSettlementReceiptV1,
    RemoteSettlementVerificationV1,
)
from aijian_api.remote_source_extract_worker import RemoteSourceExtractWorker
from aijian_api.source_extract_worker import FakeSourceExtractInvocationV1
from aijian_api.task_ledger import LocalTaskLedger
from test_remote_execution_authorization import (
    NOW,
    _issued_remote_authorization,
    _issued_remote_dispatch,
    _proposal_for_remote_permit,
)


def _state(database):
    with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        return (
            db.execute("SELECT status, retry_disposition FROM workflow_attempts").fetchone(),
            db.execute("SELECT status FROM workflow_node_runs").fetchone()[0],
            db.execute("SELECT status FROM task_ledger").fetchone()[0],
            db.execute("SELECT COUNT(*) FROM remote_settlement_receipts").fetchone()[0],
            db.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone()[0],
        )


def test_pre_consume_expiry_requeues_same_attempt_without_dispatch(tmp_path):
    database, _, _, _, _, _, claim, _, _ = _issued_remote_authorization(tmp_path)
    later = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
    summary = later.recover_expired_remote_tasks(task_kind="remote.extract")
    assert (summary.recovered, summary.requeued, summary.quarantined) == (1, 1, 0)
    assert _state(database)[:3] == (("READY", None), "PENDING", "READY")
    reclaimed = later.claim_remote_task(
        worker_id="offline-qa-reclaim",
        lease_duration=timedelta(minutes=1),
        task_id=claim.task_id,
    )
    assert reclaimed is not None and reclaimed.attempt_id == claim.attempt_id


@pytest.mark.parametrize("phase", ["SUBMIT_INTENT", "SUBMITTING"])
def test_expired_submit_phase_quarantines_without_redispatch(tmp_path, phase):
    if phase == "SUBMITTING":
        database, _, _, _, _, _, claim, _, _, _ = _issued_remote_dispatch(tmp_path)
    else:
        database, _, _, _, _, _, claim, _, _ = _issued_remote_authorization(tmp_path)
        with sqlite3.connect(database) as db:
            db.execute(
                "UPDATE workflow_attempts SET status = 'SUBMIT_INTENT' WHERE attempt_id = ?",
                (claim.attempt_id,),
            )
    later = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
    summary = later.recover_expired_remote_tasks(task_kind="remote.extract")
    assert (summary.recovered, summary.requeued, summary.quarantined) == (1, 0, 1)
    assert _state(database)[:3] == (
        ("REMOTE_UNKNOWN", "REMOTE_UNKNOWN"),
        "RECONCILIATION_REQUIRED",
        "COMPLETED",
    )
    assert (
        later.claim_remote_task(
            worker_id="offline-qa-no-retry",
            lease_duration=timedelta(minutes=1),
            task_id=claim.task_id,
        )
        is None
    )


class _OfflineTrustedVerifier:
    """QA fixture only: a preloaded local decision, never a production trust root."""

    def verify(self, receipt, *, checked_at):
        trusted = (
            receipt.payload.issuer_id == "offline-qa-issuer"
            and receipt.signature == "offline-qa-valid"
        )
        return RemoteSettlementVerificationV1(
            status="VERIFIED" if trusted else "DENIED",
            code="OFFLINE_QA_OK" if trusted else "OFFLINE_QA_DENY",
            receipt_hash=receipt.canonical_hash(),
            verifier_id="offline-qa-verifier",
            verifier_version="1.0.0",
            checked_at=checked_at,
        )


def _case(tmp_path):
    (database, _, project_id, source, manifest_id, ledger, _, grant, store, permit) = (
        _issued_remote_dispatch(tmp_path)
    )
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )
    proposal = proposal.model_copy(
        update={"cost": proposal.cost.model_copy(update={"actual_micros": 37})}
    )
    with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as db:
        consume_revision = db.execute(
            "SELECT revision FROM remote_execution_authorization_snapshots "
            "WHERE authorization_id = ? AND event_kind = 'CONSUME'",
            (permit.authorization_id,),
        ).fetchone()[0]
    dispatch = store.read_dispatch_snapshot_for_permit(permit)
    payload = RemoteSettlementReceiptPayloadV1(
        issuer_id="offline-qa-issuer",
        trust_profile_id="offline-qa-profile",
        trust_profile_version="1.0.0",
        receipt_id="offline-qa-receipt-1",
        attempt_id=permit.claim.attempt_id,
        authorization_id=permit.authorization_id,
        consume_revision=consume_revision,
        lease_generation=permit.claim.lease_generation,
        evidence_binding_hash=permit.evidence_binding_hash,
        provider_response_id="offline-response-1",
        connection_id=grant.connection_id,
        connection_revision=grant.connection_revision,
        model_id=grant.approved_model_id,
        operation="remote.source.extract",
        input_scope_hash=dispatch.input_scope_hash(),
        currency="USD",
        actual_micros=37,
        settled_at=NOW,
    )
    receipt = RemoteSettlementReceiptV1(
        payload=payload,
        payload_hash=canonical_sha256(payload.model_dump(mode="json")),
        signature_algorithm="offline-qa-only",
        signing_key_id="offline-qa-key",
        signature="offline-qa-valid",
    )
    return database, ledger, store, permit, proposal, receipt


def _with_payload(receipt, **changes):
    payload = receipt.payload.model_copy(update=changes)
    return receipt.model_copy(
        update={
            "payload": payload,
            "payload_hash": canonical_sha256(payload.model_dump(mode="json")),
        }
    )


def test_verified_actual_fee_and_receipt_are_atomic_and_reverifiable(tmp_path):
    database, _, store, permit, proposal, receipt = _case(tmp_path)
    store._settlement_verifier = _OfflineTrustedVerifier()
    persisted = store.record_remote_candidate(
        permit=permit,
        proposal=proposal,
        provider_response_id="offline-response-1",
        settlement_receipt=receipt,
    )
    assert persisted.producer_attempt_id == permit.claim.attempt_id
    assert _state(database) == (("REMOTE_REVIEW_PENDING", None), "NEEDS_REVIEW", "COMPLETED", 1, 1)
    assert store.read_remote_settlement_receipt(permit.claim.attempt_id) == receipt
    with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        audit = db.execute(
            "SELECT actual_micros, receipt_hash, verification_json FROM remote_settlement_receipts"
        ).fetchone()
    assert audit[0] == 37 and audit[1] == receipt.canonical_hash()
    assert '"VERIFIED"' in audit[2]
    store._settlement_verifier = DenyRemoteSettlementVerifier()
    with pytest.raises(RemoteAuthorizationError, match="no longer trusted"):
        store.read_remote_settlement_receipt(permit.claim.attempt_id)


def test_receipt_readback_rejects_later_attempt_response_tamper(tmp_path):
    database, _, store, permit, proposal, receipt = _case(tmp_path)
    store._settlement_verifier = _OfflineTrustedVerifier()
    store.record_remote_candidate(
        permit=permit,
        proposal=proposal,
        provider_response_id="offline-response-1",
        settlement_receipt=receipt,
    )
    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE workflow_attempts SET provider_response_id = 'tampered-response' "
            "WHERE attempt_id = ?",
            (permit.claim.attempt_id,),
        )
    with pytest.raises(RemoteAuthorizationError, match="binding or hash mismatch"):
        store.read_remote_settlement_receipt(permit.claim.attempt_id)
    assert _state(database)[3:] == (1, 1)


@pytest.mark.parametrize(
    "failure",
    [
        "missing",
        "default-deny",
        "forged-signature",
        "wrong-attempt",
        "wrong-response",
        "wrong-binding",
        "wrong-amount",
    ],
)
def test_untrusted_or_misbound_receipt_never_persists_candidate(tmp_path, failure):
    database, _, store, permit, proposal, receipt = _case(tmp_path)
    if failure == "default-deny":
        store._settlement_verifier = DenyRemoteSettlementVerifier()
    else:
        store._settlement_verifier = _OfflineTrustedVerifier()
    if failure == "missing":
        receipt = None
    elif failure == "forged-signature":
        receipt = receipt.model_copy(update={"signature": "forged"})
    elif failure == "wrong-attempt":
        receipt = _with_payload(receipt, attempt_id="att_" + "f" * 32)
    elif failure == "wrong-response":
        receipt = _with_payload(receipt, provider_response_id="wrong-response")
    elif failure == "wrong-binding":
        receipt = _with_payload(receipt, evidence_binding_hash="sha256:" + "f" * 64)
    elif failure == "wrong-amount":
        receipt = _with_payload(receipt, actual_micros=0)
    with pytest.raises(RemoteAuthorizationError):
        store.record_remote_candidate(
            permit=permit,
            proposal=proposal,
            provider_response_id="offline-response-1",
            settlement_receipt=receipt,
        )
    assert _state(database) == (("SUBMITTING", None), "RUNNING", "LEASED", 0, 0)
    later = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
    summary = later.recover_expired_remote_tasks(task_kind="remote.extract")
    assert (summary.requeued, summary.quarantined) == (0, 1)
    assert _state(database)[:3] == (
        ("REMOTE_UNKNOWN", "REMOTE_UNKNOWN"),
        "RECONCILIATION_REQUIRED",
        "COMPLETED",
    )
    assert (
        later.claim_remote_task(
            worker_id="offline-qa-no-duplicate",
            lease_duration=timedelta(minutes=1),
            task_id=permit.claim.task_id,
        )
        is None
    )


@pytest.mark.parametrize("settlement_available", [True, False])
def test_current_worker_submits_one_bound_fake_gateway_request(settlement_available):
    """No provider or localhost server: capture the exact current transport call."""
    fixture = Path(__file__).parent / "fixtures/agent-skill/contracts-v1.json"
    bundle = AgentSkillFixtureBundleV1.model_validate_json(fixture.read_text(encoding="utf-8"))
    snapshot = bundle.attempt.model_copy(
        update={
            "skill_definition_id": SOURCE_EXTRACT_REMOTE_REF.definition_id,
            "skill_version": SOURCE_EXTRACT_REMOTE_REF.version,
            "provider_connection_id": "pcn_" + "1" * 32,
            "model_id": "offline-model",
        }
    )
    claim = SimpleNamespace(
        task_kind="remote.source.extract",
        attempt_id=snapshot.attempt_id,
        task_id="tsk_offline",
        lease_generation=1,
    )
    permit = SimpleNamespace(
        claim=claim,
        authorization_id="rea_" + "1" * 32,
        evidence_binding_hash="sha256:" + "a" * 64,
    )
    dispatch = SimpleNamespace(
        connection_id=snapshot.provider_connection_id,
        connection_revision=1,
        approved_model_id=snapshot.model_id,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        scope={"input_hash": snapshot.input_hash},
    )
    span = bundle.artifact_proposal.source_spans[0]
    invocation = FakeSourceExtractInvocationV1(
        project_id=snapshot.project_id,
        agent_run_id=snapshot.agent_run_id,
        skill_run_id=snapshot.skill_run_id,
        attempt_id=snapshot.attempt_id,
        source_manifest_version_id=bundle.artifact_proposal.dependencies[0].version_id,
        source_document_id=span.source_document_id,
        source_block_id=span.source_block_id,
        start_byte=span.start_byte,
        end_byte=span.end_byte,
        source_span_id=span.source_span_id,
        excerpt="Offline source text.",
    )

    class Ledger:
        def mark_attempt_running(self, value):
            assert value is claim
            return value

        def read_agent_skill_snapshot(self, value):
            assert value is claim
            return snapshot

    class Store:
        lease_renewal_timeout_seconds = 0.1

        def __init__(self):
            self.proposals = []
            self.quarantined = []

        def begin_remote_dispatch(self, **kwargs):
            assert kwargs["claim"] is claim
            return permit

        def read_dispatch_snapshot_for_permit(self, current):
            assert current is permit
            return dispatch

        def recheck_dispatch_permit(self, current):
            assert current is permit

        def renew_remote_dispatch_permit(self, **kwargs):
            return permit

        def record_remote_candidate(self, **kwargs):
            self.proposals.append(kwargs)

        def quarantine_remote_unknown(self, **kwargs):
            self.quarantined.append(kwargs)

    class Transport:
        def __init__(self):
            self.requests = []

        def dispatch(self, request):
            self.requests.append(request)
            return GatewayTextSuccess(
                kind="SUCCEEDED",
                response_id="offline-response-1",
                model="offline-model",
                text='{"summary":"offline summary"}',
                finish_reason="stop",
            )

    class Settlement:
        def read(self, *, permit, response, timeout_seconds):
            assert timeout_seconds == 0.03
            if not settlement_available:
                return None
            payload = RemoteSettlementReceiptPayloadV1(
                issuer_id="offline-qa-issuer",
                trust_profile_id="offline-qa-profile",
                trust_profile_version="1.0.0",
                receipt_id="offline-qa-receipt-worker",
                attempt_id=permit.claim.attempt_id,
                authorization_id=permit.authorization_id,
                consume_revision=1,
                lease_generation=1,
                evidence_binding_hash=permit.evidence_binding_hash,
                provider_response_id=response.response_id,
                connection_id=dispatch.connection_id,
                connection_revision=1,
                model_id=dispatch.approved_model_id,
                operation="remote.source.extract",
                input_scope_hash="sha256:" + "a" * 64,
                currency="USD",
                actual_micros=37,
                settled_at=NOW,
            )
            return RemoteSettlementReceiptV1(
                payload=payload,
                payload_hash=canonical_sha256(payload.model_dump(mode="json")),
                signature_algorithm="offline-qa-only",
                signing_key_id="offline-qa-key",
                signature="offline-qa-valid",
            )

    store, transport = Store(), Transport()
    worker = RemoteSourceExtractWorker(
        ledger=Ledger(),
        authorizations=store,
        invocation_builder=lambda *_: invocation.model_dump(mode="json"),
        connections=SimpleNamespace(
            get=lambda _: SimpleNamespace(
                id=dispatch.connection_id,
                revision=1,
                enabled=True,
                provider_kind="CPA_LOOPBACK",
                models=(SimpleNamespace(model_id="offline-model"),),
            )
        ),
        credentials=SimpleNamespace(get=lambda _: "offline-qa-token"),
        transport=transport,
        settlement_source=Settlement(),
        lease_duration=timedelta(seconds=0.2),
        heartbeat_interval_seconds=0.02,
        settlement_timeout_seconds=0.03,
    )
    result = worker.execute(
        claim, authorization_id=permit.authorization_id, authorization_revision=1
    )
    assert len(transport.requests) == 1
    request = transport.requests[0]
    assert request.model == dispatch.approved_model_id
    assert [item.role for item in request.messages] == ["system", "user"]
    assert (
        "<source_excerpt>\nOffline source text.\n</source_excerpt>" in request.messages[1].content
    )
    assert "offline-qa-token" not in repr(request)
    if settlement_available:
        assert result.outcome == "NEEDS_REVIEW"
        assert store.proposals[0]["proposal"].cost.actual_micros == 37
        assert (
            store.proposals[0]["settlement_receipt"].payload.provider_response_id
            == result.provider_response_id
        )
        assert store.quarantined == []
    else:
        assert result.outcome == "REMOTE_UNKNOWN"
        assert result.code == "SETTLEMENT_EVIDENCE_UNAVAILABLE"
        assert store.proposals == []
        assert len(store.quarantined) == 1
