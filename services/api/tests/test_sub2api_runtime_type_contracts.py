"""Synthetic regressions for the one-call provider/store/transport boundaries."""

import json
import ssl
from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime, timedelta
from time import monotonic

import pytest
from aijian_api import sub2api_source_extract_store as store_module
from aijian_api import sub2api_source_extract_worker as worker_module
from aijian_api import sub2api_text_transport as transport_module
from aijian_api.agent_skill_builtins import sub2api_source_extract_registry
from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.gateway_transport import GatewayRemoteUnknown
from aijian_api.provider_connection_repository import ProviderConnectionRepository
from aijian_api.repository import StudioRepository
from aijian_api.sub2api_connection_readiness import Sub2APIConfiguredReadiness
from aijian_api.sub2api_source_extract_contracts import CreateSub2APISourceExtractRunRequest
from aijian_api.sub2api_source_extract_invocation import Sub2APISourceExtractInvocationBuilder
from aijian_api.sub2api_source_extract_proposal import build_sub2api_source_extract_proposal
from aijian_api.sub2api_source_extract_run_factory import Sub2APISourceExtractRunFactory
from aijian_api.sub2api_text_transport import Sub2APITextTransport
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import LeaseLostError
from test_proposal_run_create_api import accepted_source, create_payload, sidecar_client
from test_provider_connection_runtime_baseline import (
    MODELS,
    FakeVault,
    create_connection,
)


def test_store_and_worker_share_one_immutable_dispatch_receipt() -> None:
    assert store_module.Sub2APIDispatchPermit is worker_module.Sub2APIDispatchPermit
    assert store_module.Sub2APIDispatchPermit.__dataclass_params__.frozen
    assert "lease_token_hash" in store_module.Sub2APIDispatchPermit.__dataclass_fields__


def test_readiness_rejects_a_missing_origin_without_claiming_provider_success(
    tmp_path, monkeypatch
) -> None:
    studio = StudioRepository(tmp_path / "readiness.sqlite3")
    repository = ProviderConnectionRepository(studio.database_path)
    connection = create_connection(repository)
    monkeypatch.setattr(repository, "get", lambda _: replace(connection, origin_mode=None))
    vault = FakeVault()
    vault.values[connection.credential_ref] = "fake-local-test-key"
    readiness = Sub2APIConfiguredReadiness(
        repository, vault, lambda: "WAITING_FOR_EXPLICIT_APPROVAL"
    ).read(connection.id, MODELS[0].model_id)
    assert readiness.reasons == ["ORIGIN_INVALID"]
    assert not readiness.local_preconditions_met
    assert readiness.provider_observation == "NOT_CHECKED"


@pytest.mark.parametrize(
    ("addresses", "accepted"),
    [
        (["8.8.8.8", "2606:4700:4700::1111"], True),
        (["8.8.8.8", "127.0.0.1"], False),
        (["::1"], False),
        (["224.0.0.1"], False),
        ([], False),
    ],
)
def test_dns_selection_requires_every_answer_to_be_public(monkeypatch, addresses, accepted):
    monkeypatch.setattr(
        transport_module.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", (address, 443)) for address in addresses],
    )
    if accepted:
        assert (
            Sub2APITextTransport._resolve_public_address("synthetic.example", 443, monotonic() + 2)
            == addresses[0]
        )
    else:
        with pytest.raises(ValueError, match="exclusively to public"):
            Sub2APITextTransport._resolve_public_address("synthetic.example", 443, monotonic() + 2)


def test_dns_failure_preserves_failure_without_a_connection_attempt(monkeypatch):
    def fail_dns(*args, **kwargs):
        raise OSError("synthetic DNS failure")

    monkeypatch.setattr(transport_module.socket, "getaddrinfo", fail_dns)
    with pytest.raises(OSError, match="synthetic DNS failure"):
        Sub2APITextTransport._resolve_public_address("synthetic.example", 443, monotonic() + 2)


@pytest.mark.parametrize("tls_failure", [False, True])
def test_pinned_connection_verifies_original_hostname_and_closes_failed_socket(
    monkeypatch, tls_failure
):
    class SyntheticSocket:
        closed = False

        def close(self):
            self.closed = True

    raw_socket = SyntheticSocket()
    wrapped_socket = SyntheticSocket()

    def connect(address, timeout):
        assert address == ("8.8.8.8", 443)
        assert timeout == 2
        return raw_socket

    def wrap(context, socket, *, server_hostname):
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname
        assert server_hostname == "synthetic.example"
        assert socket is raw_socket
        if tls_failure:
            raise ssl.SSLError("synthetic verification failure")
        return wrapped_socket

    monkeypatch.setattr(transport_module.socket, "create_connection", connect)
    monkeypatch.setattr(ssl.SSLContext, "wrap_socket", wrap)
    connection = transport_module._PinnedHTTPSConnection("synthetic.example", 443, "8.8.8.8", 2)
    if tls_failure:
        with pytest.raises(ssl.SSLError, match="synthetic verification failure"):
            connection.connect()
        assert raw_socket.closed
    else:
        connection.connect()
        assert connection.sock is wrapped_socket
        assert not raw_socket.closed
        connection.close()
        assert wrapped_socket.closed


@pytest.mark.parametrize("origin_mode", ["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"])
@pytest.mark.parametrize("outcome", ["candidate", "unknown", "missing_origin"])
def test_real_store_worker_binding_consumes_once_and_preserves_unknown(
    tmp_path, monkeypatch, origin_mode, outcome
):
    client, studio = sidecar_client(tmp_path)
    now = datetime.now(UTC) + timedelta(seconds=5)
    source = accepted_source(client)
    connections = ProviderConnectionRepository(studio.database_path, clock=lambda: now)
    configured = create_connection(connections, origin_mode=origin_mode)
    source_payload = create_payload(source)
    source_payload["agent_definition"] = {
        "definition_id": "writer.source-analyst-sub2api",
        "version": "1.0.0",
    }
    source_payload["skill_definition"] = {
        "definition_id": "source.extract-sub2api",
        "version": "1.0.0",
    }
    payload = CreateSub2APISourceExtractRunRequest.model_validate(
        {
            "selection": {
                "connection_id": configured.id,
                "connection_revision": configured.revision,
                "model_id": MODELS[0].model_id,
            },
            "source": source_payload,
        }
    )
    created = Sub2APISourceExtractRunFactory(
        studio, sub2api_source_extract_registry(), clock=lambda: now
    ).create(project_id=source[0], payload=payload, idempotency_key="synthetic-worker-binding")
    store = store_module.Sub2APISourceExtractStore(studio.database_path, clock=lambda: now)
    approval = store.issue_approval(
        project_id=source[0],
        task_id=created.task.task_id,
        attempt_id=created.task.attempt_id,
        expected_attempt_fingerprint=created.attempt.attempt_fingerprint,
        actor_id="synthetic-user",
        idempotency_key="synthetic-worker-approval",
    )
    ledger = LocalTaskLedger(studio.database_path, clock=lambda: now)
    claim = ledger.claim_remote_task(
        worker_id="synthetic-worker",
        lease_duration=timedelta(minutes=2),
        task_id=created.task.task_id,
        task_kind="sub2api.source.extract",
    )
    assert claim is not None
    receipts = []
    begin_dispatch = store.begin_sub2api_dispatch

    def capture_receipt(**kwargs):
        permit = begin_dispatch(**kwargs)
        assert isinstance(permit, worker_module.Sub2APIDispatchPermit)
        assert permit.lease_token_hash == canonical_sha256({"lease_token": claim.lease_token})
        with pytest.raises(FrozenInstanceError):
            permit.approval_id = "cannot-change-a-consumed-approval"
        receipts.append(permit)
        return permit

    monkeypatch.setattr(store, "begin_sub2api_dispatch", capture_receipt)
    vault = FakeVault()
    vault.values[configured.credential_ref] = "fake-synthetic-key"

    class SyntheticTransport:
        calls = 0

        def dispatch(self, **kwargs):
            self.calls += 1
            assert kwargs["origin_mode"] == origin_mode
            if outcome == "unknown":
                return GatewayRemoteUnknown(kind="REMOTE_UNKNOWN", code="RESPONSE_TIMEOUT")
            raw_response = json.dumps(
                {
                    "id": "synthetic-response",
                    "model": MODELS[0].model_id,
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "role": "assistant",
                                "content": '{"summary":"Synthetic summary."}',
                            },
                        }
                    ],
                }
            ).encode()
            return Sub2APITextTransport._parse_success(raw_response, MODELS[0].model_id)

    transport = SyntheticTransport()
    if outcome == "missing_origin":
        monkeypatch.setattr(connections, "get", lambda _: replace(configured, origin_mode=None))
    worker = worker_module.Sub2APISourceExtractWorker(
        ledger=ledger,
        dispatch_store=store,
        invocation_builder=Sub2APISourceExtractInvocationBuilder(studio.database_path),
        proposal_builder=build_sub2api_source_extract_proposal,
        connections=connections,
        credentials=vault,
        transport=transport,
    )
    result = worker.execute(claim, approval_id=approval.approval_id)
    expected = {
        "candidate": ("NEEDS_REVIEW", "PROPOSAL_READY", 1),
        "unknown": ("REMOTE_UNKNOWN", "REMOTE_UNKNOWN", 1),
        "missing_origin": ("FAILED", "FAILED", 0),
    }[outcome]
    assert result.outcome == expected[0]
    assert transport.calls == len(receipts) == expected[2]
    operation = store.read_operation(
        project_id=source[0], run_id=created.persisted.agent_run.agent_run_id
    )
    assert operation.content_status == expected[1]
    assert operation.automatic_retry_allowed is False
    assert store.next_ready(exclude_task_ids=frozenset()) is None
    with pytest.raises(LeaseLostError):
        worker.execute(claim, approval_id=approval.approval_id)
    assert transport.calls == expected[2]
