"""Selected provider → real ledger/authorization/builder → offline transport only.

The in-memory credential and test evidence roots are injected at the same boundaries
as the OS vault and trusted composition. No HTTP socket or production key is used.
"""

import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_builtins import (
    SOURCE_ANALYST_REMOTE_REF,
    SOURCE_EXTRACT_REMOTE_REF,
    built_in_agent_skill_registry,
)
from aijian_api.contracts import CreateRemoteSourceExtractRunRequest
from aijian_api.gateway_transport import GatewayTextSuccess
from aijian_api.proposal_run_factory import ProposalRunFactory
from aijian_api.provider_connection_repository import ProviderConnectionRepository, ProviderModel
from aijian_api.provider_contracts import CPA_LOOPBACK_BASE_URL
from aijian_api.remote_execution_authorization import (
    RemoteDispatchSnapshotDraft,
    RemoteExecutionAuthorizationStore,
    TrustedRemoteCompositionPolicy,
)
from aijian_api.remote_execution_evidence_contracts import (
    RemoteExecutionBindingV1,
    RemoteExecutionGrantCoreV1,
    grant_core_hash,
)
from aijian_api.remote_settlement_contracts import (
    RemoteSettlementReceiptPayloadV1,
    RemoteSettlementReceiptV1,
)
from aijian_api.remote_source_extract_worker import RemoteSourceExtractWorker
from aijian_api.source_extract_run_factory import RemoteSourceExtractEnqueueIntentV1
from aijian_api.source_extract_worker import SourceExtractInvocationBuilder
from aijian_api.task_ledger import LocalTaskLedger
from pydantic import ValidationError
from test_proposal_run_create_api import accepted_source, create_payload, sidecar_client
from test_remote_execution_authorization import (
    _evidence,
    _OfflineTrustedSettlementVerifier,
    _TrustedOfflineVerifier,
)


@pytest.fixture
def selected_run(tmp_path, monkeypatch):
    now = datetime.now(UTC)
    client, repository = sidecar_client(tmp_path)
    with client:
        source = accepted_source(client)
    # Windows asyncio opens a loopback socket pair for the in-process TestClient.
    # Block real connections after that client closes, before exercising dispatch.
    monkeypatch.setattr("socket.socket.connect", lambda *_: pytest.fail("network forbidden"))
    connections = ProviderConnectionRepository(repository.database_path)
    connection = connections.create(
        provider_kind="CPA_LOOPBACK",
        display_name="Offline selected connection",
        base_url=CPA_LOOPBACK_BASE_URL,
        enabled=True,
        models=(
            ProviderModel(model_id="not-selected", capabilities=("TEXT",)),
            ProviderModel(model_id="selected-text", capabilities=("TEXT",)),
        ),
    )
    request = CreateRemoteSourceExtractRunRequest.model_validate(
        {
            "source": create_payload(source)
            | {
                "agent_definition": SOURCE_ANALYST_REMOTE_REF,
                "skill_definition": SOURCE_EXTRACT_REMOTE_REF,
            },
            "selection": {
                "connection_id": connection.id,
                "connection_revision": connection.revision,
                "model_id": "selected-text",
            },
        }
    )
    factory = ProposalRunFactory(repository, built_in_agent_skill_registry(), clock=lambda: now)
    args = dict(project_id=source[0], payload=request, idempotency_key="selected-text-operation")
    created = factory.create_remote_source_extract(**args)
    now = datetime.now(UTC)
    monkeypatch.setattr("test_remote_execution_authorization.NOW", now)
    intent = RemoteSourceExtractEnqueueIntentV1.model_validate(
        AgentRunStore(repository.database_path)
        .get_with_intent(source[0], created.attempt.agent_run_id)
        .enqueue_intent.payload
    )
    draft = RemoteDispatchSnapshotDraft(**intent.dispatch_snapshot.model_dump())
    policy = [
        TrustedRemoteCompositionPolicy(
            draft.endpoint_binding,
            draft.transport_contract_hash,
            draft.dispatch_class,
            draft.requested_additional_budget_micros,
            draft.approved_currency,
            draft.policy_version,
        )
    ]
    store = RemoteExecutionAuthorizationStore(
        repository.database_path,
        id_factory=lambda prefix: f"{prefix}_{uuid4().hex}",
        clock=lambda: now,
        composition_policy_reader=lambda: policy[0],
        settlement_verifier=_OfflineTrustedSettlementVerifier(),
    )
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "7" * 32,
        grant_revision=1,
        project_id=source[0],
        connection_id=connection.id,
        connection_revision=connection.revision,
        approved_model_id="selected-text",
        endpoint_binding=draft.endpoint_binding,
        transport_contract_hash=draft.transport_contract_hash,
        operation="remote.source.extract",
        input_scope_hash=draft.input_scope_hash(),
        dispatch_class=draft.dispatch_class,
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=now,
        expires_at=now + timedelta(minutes=2),
        policy_version=draft.policy_version,
    )
    ledger = LocalTaskLedger(repository.database_path, clock=lambda: now)
    claim = ledger.claim_remote_task(
        worker_id="offline-selected-model",
        lease_duration=timedelta(seconds=30),
        task_id=created.task.task_id,
    )
    assert claim is not None
    requests, credential_reads = [], []

    class Transport:
        def dispatch(self, request):
            requests.append(request)
            return GatewayTextSuccess(
                "SUCCEEDED",
                "offline-selected-response",
                request.model,
                '{"summary":"林见收到一封未署名的信。"}',
                "stop",
            )

    class Vault:
        def get(self, reference):
            credential_reads.append(reference)
            assert reference == connection.credential_ref
            return "synthetic-test-credential"

    class Settlement:
        def read(self, *, permit, response, timeout_seconds):
            with sqlite3.connect(repository.database_path) as db:
                revision = db.execute(
                    "SELECT revision FROM remote_execution_authorization_snapshots "
                    "WHERE event_kind = 'CONSUME'"
                ).fetchone()[0]
            payload = RemoteSettlementReceiptPayloadV1(
                issuer_id="offline-qa-issuer",
                trust_profile_id="offline-qa-profile",
                trust_profile_version="1.0.0",
                receipt_id="offline-selected-receipt",
                attempt_id=permit.claim.attempt_id,
                authorization_id=permit.authorization_id,
                consume_revision=revision,
                lease_generation=permit.claim.lease_generation,
                evidence_binding_hash=permit.evidence_binding_hash,
                provider_response_id=response.response_id,
                connection_id=connection.id,
                connection_revision=connection.revision,
                model_id="selected-text",
                operation="remote.source.extract",
                input_scope_hash=draft.input_scope_hash(),
                currency="USD",
                actual_micros=0,
                settled_at=now,
            )
            from aijian_api.agent_skill_contracts import canonical_sha256

            return RemoteSettlementReceiptV1(
                payload=payload,
                payload_hash=canonical_sha256(payload.model_dump(mode="json")),
                signature_algorithm="offline-qa-only",
                signing_key_id="offline-qa-key",
                signature="offline-qa-valid",
            )

    worker = RemoteSourceExtractWorker(
        ledger=ledger,
        authorizations=store,
        invocation_builder=SourceExtractInvocationBuilder(repository.database_path, remote=True),
        connections=connections,
        credentials=Vault(),
        transport=Transport(),
        settlement_source=Settlement(),
    )
    return SimpleNamespace(**locals())


def authorize(case):
    binding = RemoteExecutionBindingV1(
        grant=case.grant, grant_core_hash=grant_core_hash(case.grant)
    )
    case.store.issue(
        binding=binding, envelope=_evidence(binding), verifier=_TrustedOfflineVerifier()
    )


def execute(case):
    return case.worker.execute(
        case.claim, authorization_id=case.grant.authorization_id, authorization_revision=1
    )


def test_selected_text_reaches_real_builder_and_offline_adapter_once(selected_run):
    case = selected_run
    assert case.requests == case.credential_reads == []  # Selection and enqueue never send.
    authorize(case)
    result = execute(case)
    assert result.outcome == "NEEDS_REVIEW"
    assert len(case.requests) == 1
    request = case.requests[0]
    assert request.model == "selected-text"
    assert "林见收到一封未署名的信" in request.messages[1].content
    assert case.credential_reads == [case.connection.credential_ref]
    assert "synthetic-test-credential" not in repr(request)
    replay = case.factory.create_remote_source_extract(**case.args)
    assert replay.replayed and replay.task == case.created.task
    assert (
        case.ledger.claim_remote_task(
            worker_id="no-replay", lease_duration=timedelta(seconds=30), task_id=replay.task.task_id
        )
        is None
    )
    with sqlite3.connect(case.repository.database_path) as db:
        proposals = db.execute("SELECT proposal_json FROM agent_artifact_proposals").fetchall()
        assert len(proposals) == 1
        proposal = json.loads(proposals[0][0])
        assert proposal["payload"] == {"summary": "林见收到一封未署名的信。"}
        assert proposal["producer_agent_run_id"] == case.created.attempt.agent_run_id
        assert db.execute("SELECT COUNT(*) FROM remote_settlement_receipts").fetchone()[0] == 1
        assert (
            db.execute(
                "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
                "WHERE event_kind='CONSUME'"
            ).fetchone()[0]
            == 1
        )
        tables = db.iterdump()
        assert "synthetic-test-credential" not in "\n".join(tables)
    assert len(case.requests) == 1


@pytest.mark.parametrize("denial", ["no-authorization", "revoked", "budget-changed"])
def test_denied_authorization_or_budget_never_reads_key_or_dispatches(selected_run, denial):
    case = selected_run
    if denial != "no-authorization":
        authorize(case)
    if denial == "revoked":
        case.store.revoke(case.grant.authorization_id)
    elif denial == "budget-changed":
        case.policy[0] = replace(case.policy[0], requested_additional_budget_micros=1)
    assert execute(case).code == "PRE_DISPATCH_REJECTED"
    assert case.requests == case.credential_reads == []
    with sqlite3.connect(case.repository.database_path) as db:
        assert (
            db.execute(
                "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
                "WHERE event_kind='CONSUME'"
            ).fetchone()[0]
            == 0
        )


def test_default_local_builder_does_not_accept_remote_intent(selected_run):
    case = selected_run
    builder = SourceExtractInvocationBuilder(case.repository.database_path)
    with pytest.raises(ValidationError):
        builder(case.created.attempt, case.claim)
    assert case.requests == case.credential_reads == []
