"""Offline worker failure fencing; mocked transport never opens a connection."""

from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import remote_source_extract_worker as remote
from aijian_api.agent_skill_builtins import SOURCE_EXTRACT_REMOTE_REF
from aijian_api.agent_skill_contracts import AgentSkillFixtureBundleV1
from aijian_api.gateway_transport import (
    GatewayNotDispatched,
    GatewayRemoteError,
    GatewayRemoteUnknown,
    GatewayTextSuccess,
)
from aijian_api.source_extract_worker import FakeSourceExtractInvocationV1


def make_worker(**changes):
    arguments = {
        name: Mock()
        for name in (
            "ledger",
            "authorizations",
            "invocation_builder",
            "connections",
            "credentials",
            "transport",
            "settlement_source",
        )
    }
    arguments.update(changes)
    return remote.RemoteSourceExtractWorker(**arguments)


@pytest.mark.parametrize(
    "changes",
    [
        {"lease_duration": timedelta(0)},
        {"lease_duration": timedelta(seconds=-1)},
        {"heartbeat_interval_seconds": 0},
        {"heartbeat_interval_seconds": 15},
        {"heartbeat_interval_seconds": float("nan")},
        {"settlement_timeout_seconds": 0},
        {"settlement_timeout_seconds": 20},
        {"settlement_timeout_seconds": float("inf")},
    ],
)
def test_invalid_lease_or_settlement_budget_is_rejected(changes):
    with pytest.raises(ValueError):
        make_worker(**changes)


@pytest.fixture
def worker_case(monkeypatch):
    bundle = AgentSkillFixtureBundleV1.model_validate_json(
        (Path(__file__).parent / "fixtures/agent-skill/contracts-v1.json").read_text(
            encoding="utf-8"
        )
    )
    snapshot = bundle.attempt.model_copy(
        update={
            "skill_definition_id": SOURCE_EXTRACT_REMOTE_REF.definition_id,
            "skill_version": SOURCE_EXTRACT_REMOTE_REF.version,
            "provider_connection_id": "pcn_" + "1" * 32,
            "model_id": "offline-model",
        }
    )
    claim = SimpleNamespace(
        task_kind="remote.source.extract", attempt_id=snapshot.attempt_id, task_id="offline-task"
    )
    permit = SimpleNamespace(claim=claim, evidence_binding_hash="sha256:" + "a" * 64)
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
        excerpt="Synthetic source.",
    )
    worker = make_worker()
    worker._ledger.mark_attempt_running.return_value = claim
    worker._ledger.read_agent_skill_snapshot.return_value = snapshot
    worker._authorizations.begin_remote_dispatch.return_value = permit
    worker._authorizations.read_dispatch_snapshot_for_permit.return_value = dispatch
    worker._invocation_builder.return_value = invocation
    worker._connections.get.return_value = SimpleNamespace(
        id=dispatch.connection_id,
        revision=1,
        enabled=True,
        provider_kind="CPA_LOOPBACK",
        models=(SimpleNamespace(model_id="offline-model"),),
        credential_ref="synthetic",
    )
    worker._credentials.get.return_value = "synthetic-token"
    worker._transport.dispatch.return_value = GatewayTextSuccess(
        "SUCCEEDED", "offline-response", "offline-model", '{"summary":"synthetic"}', "stop"
    )
    keeper = Mock()
    keeper.start.return_value = keeper
    keeper.with_permit.side_effect = lambda operation: operation(permit)
    keeper.stop.return_value = permit
    keeper.lost = False
    monkeypatch.setattr(remote, "_RemotePermitLeaseKeeper", lambda *_args, **_kwargs: keeper)
    # Settlement transport is also a local stub; no background thread is started.
    worker._read_settlement_bounded = Mock(return_value=None)
    return SimpleNamespace(
        worker=worker,
        claim=claim,
        permit=permit,
        dispatch=dispatch,
        snapshot=snapshot,
        keeper=keeper,
    )


def execute(case):
    return case.worker.execute(
        case.claim, authorization_id="rea_" + "1" * 32, authorization_revision=1
    )


def test_wrong_task_kind_never_marks_running(worker_case):
    case = worker_case
    case.claim.task_kind = "different"
    with pytest.raises(remote.RemoteWorkerBlocked, match="claim"):
        execute(case)
    case.worker._ledger.mark_attempt_running.assert_not_called()


@pytest.mark.parametrize(
    "field,value",
    [
        ("attempt_id", "other"),
        ("skill_definition_id", "other"),
        ("skill_version", "other"),
        ("provider_connection_id", None),
    ],
)
def test_detached_attempt_fails_before_consuming_authorization(worker_case, field, value):
    case = worker_case
    case.worker._ledger.read_agent_skill_snapshot.return_value = case.snapshot.model_copy(
        update={field: value}
    )
    result = execute(case)
    assert (result.outcome, result.code) == ("FAILED", "PRE_DISPATCH_REJECTED")
    case.worker._authorizations.begin_remote_dispatch.assert_not_called()
    case.worker._authorizations.fail_remote_before_dispatch.assert_called_once_with(
        claim=case.claim
    )
    case.worker._transport.dispatch.assert_not_called()


@pytest.mark.parametrize(
    "field,value",
    [
        ("connection_id", "other"),
        ("approved_model_id", "other"),
        ("dispatch_class", "other"),
        ("requested_additional_budget_micros", 1),
        ("approved_currency", "EUR"),
        ("scope", {}),
    ],
)
def test_changed_dispatch_binding_quarantines_without_transport(worker_case, field, value):
    case = worker_case
    setattr(case.dispatch, field, value)
    with pytest.raises(remote.RemoteWorkerBlocked, match="facts"):
        execute(case)
    case.worker._transport.dispatch.assert_not_called()
    case.worker._authorizations.quarantine_remote_unknown.assert_called_once()


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", "other"),
        ("revision", 2),
        ("enabled", False),
        ("provider_kind", "other"),
        ("models", ()),
    ],
)
def test_changed_connection_never_dispatches(worker_case, field, value):
    case = worker_case
    setattr(case.worker._connections.get.return_value, field, value)
    with pytest.raises(remote.RemoteWorkerBlocked, match="connection changed"):
        execute(case)
    case.worker._transport.dispatch.assert_not_called()
    case.worker._authorizations.quarantine_remote_unknown.assert_called_once()


@pytest.mark.parametrize("failure", ["credential", "invocation"])
def test_missing_credential_or_detached_context_never_dispatches(worker_case, failure):
    case = worker_case
    if failure == "credential":
        case.worker._credentials.get.return_value = None
    else:
        invocation = case.worker._invocation_builder.return_value
        case.worker._invocation_builder.return_value = invocation.model_copy(
            update={"attempt_id": "att_" + "f" * 32}
        )
    with pytest.raises(remote.RemoteWorkerBlocked):
        execute(case)
    case.worker._transport.dispatch.assert_not_called()
    case.worker._authorizations.quarantine_remote_unknown.assert_called_once()


@pytest.mark.parametrize(
    "outcome",
    [
        GatewayNotDispatched("NOT_DISPATCHED", "CONNECTION_FAILED"),
        GatewayRemoteError("REMOTE_ERROR", "RATE_LIMITED", 429),
        GatewayRemoteUnknown("REMOTE_UNKNOWN", "RESPONSE_TIMEOUT"),
    ],
)
@pytest.mark.parametrize("stopped", [False, True])
def test_unsuccessful_transport_never_retries_and_never_uses_unstopped_permit(
    worker_case, outcome, stopped
):
    case = worker_case
    case.worker._transport.dispatch.return_value = outcome
    case.keeper.stop.return_value = case.permit if stopped else None
    result = execute(case)
    assert result.outcome == "REMOTE_UNKNOWN"
    assert result.code == (outcome.code if stopped else "LEASE_RENEWAL_STOP_TIMEOUT")
    case.worker._transport.dispatch.assert_called_once()
    assert case.worker._authorizations.quarantine_remote_unknown.call_count == int(stopped)
    case.worker._authorizations.record_remote_candidate.assert_not_called()


@pytest.mark.parametrize("stopped", [False, True])
def test_success_response_with_lost_lease_does_not_persist_candidate(worker_case, stopped):
    case = worker_case
    case.keeper.stop.return_value = case.permit if stopped else None
    case.keeper.lost = True
    result = execute(case)
    assert result.code == ("LEASE_RENEWAL_LOST" if stopped else "LEASE_RENEWAL_STOP_TIMEOUT")
    assert result.provider_response_id == "offline-response"
    case.worker._authorizations.record_remote_candidate.assert_not_called()
    assert case.worker._authorizations.quarantine_remote_unknown.call_count == int(stopped)


@pytest.mark.parametrize("stopped", [False, True])
def test_dispatch_exception_survives_quarantine_failure(worker_case, stopped):
    case = worker_case
    failure = RuntimeError("synthetic dispatch failure")
    case.worker._transport.dispatch.side_effect = failure
    case.keeper.stop.return_value = case.permit if stopped else None
    case.worker._authorizations.quarantine_remote_unknown.side_effect = OSError(
        "synthetic store failure"
    )
    with pytest.raises(RuntimeError) as error:
        execute(case)
    assert error.value is failure
    case.worker._transport.dispatch.assert_called_once()
    assert case.worker._authorizations.quarantine_remote_unknown.call_count == int(stopped)


@pytest.mark.parametrize(
    "text",
    [
        "{",
        "[]",
        "{}",
        '{"summary":null}',
        '{"summary":" "}',
        '{"summary":"a","extra":1}',
        '{"summary":"' + "a" * 10001 + '"}',
    ],
    ids=["json", "root", "missing", "null", "blank", "extra", "oversize"],
)
def test_malformed_response_cannot_become_proposal(text):
    response = GatewayTextSuccess("SUCCEEDED", "offline-response", "offline-model", text, "stop")
    with pytest.raises(remote.RemoteWorkerBlocked, match="valid source extraction"):
        remote.RemoteSourceExtractWorker._proposal(response, Mock(), Mock(), actual_micros=0)


@pytest.mark.parametrize("alive", [False, True])
def test_lease_stop_is_bounded_and_lost_permit_cannot_be_used(monkeypatch, alive):
    thread = Mock()
    thread.is_alive.return_value = alive
    monkeypatch.setattr(remote, "Thread", lambda **_: thread)
    store = Mock(lease_renewal_timeout_seconds=0.25)
    permit = object()
    keeper = remote._RemotePermitLeaseKeeper(
        store, permit, lease_duration=timedelta(seconds=30), heartbeat_interval=5
    )
    assert keeper.start() is keeper
    assert keeper.with_permit(lambda current: current) is permit
    assert keeper.stop() is (None if alive else permit)
    thread.join.assert_called_once_with(timeout=1.25)
    assert keeper.lost is alive
    if alive:
        operation = Mock()
        with pytest.raises(remote.RemoteWorkerBlocked, match="renewal was lost"):
            keeper.with_permit(operation)
        operation.assert_not_called()


@pytest.mark.parametrize("kind", ["renewed", "failed", "stopped_under_lock"])
def test_lease_renewal_updates_revision_or_stops_fail_closed(monkeypatch, kind):
    monkeypatch.setattr(remote, "Thread", lambda **_: Mock())
    store = Mock()
    permit, renewed = object(), object()
    store.renew_remote_dispatch_permit.return_value = renewed
    if kind == "failed":
        store.renew_remote_dispatch_permit.side_effect = OSError("synthetic renewal failure")
    keeper = remote._RemotePermitLeaseKeeper(
        store, permit, lease_duration=timedelta(seconds=30), heartbeat_interval=5
    )
    stop = Mock()
    stop.wait.side_effect = [False, True]
    stop.is_set.return_value = kind == "stopped_under_lock"
    keeper._stop = stop
    keeper._run()
    if kind == "renewed":
        assert keeper.with_permit(lambda current: current) is renewed
    elif kind == "failed":
        assert keeper.lost
        stop.set.assert_called_once()
    else:
        store.renew_remote_dispatch_permit.assert_not_called()
    assert keeper.lost is (kind == "failed")


@pytest.mark.parametrize("kind", ["empty", "exception", "timeout"])
def test_settlement_reader_is_bounded_and_preserves_lookup_exception(monkeypatch, kind):
    worker = make_worker()
    worker._settlement_source.read.return_value = None
    failure = OSError("synthetic lookup failure")
    if kind == "exception":
        worker._settlement_source.read.side_effect = failure

    def thread(**kwargs):
        return SimpleNamespace(start=kwargs["target"] if kind != "timeout" else lambda: None)

    monkeypatch.setattr(remote, "Thread", thread)
    if kind == "timeout":
        queue = Mock()
        queue.get.side_effect = remote.Empty
        monkeypatch.setattr(remote, "Queue", lambda **_: queue)
    if kind == "exception":
        with pytest.raises(OSError) as error:
            worker._read_settlement_bounded(permit=Mock(), response=Mock())
        assert error.value is failure
    else:
        assert worker._read_settlement_bounded(permit=Mock(), response=Mock()) is None
    if kind == "timeout":
        queue.get.assert_called_once_with(timeout=15.0)
        worker._settlement_source.read.assert_not_called()
