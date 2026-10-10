"""Offline supervisor tests: dependency rejection, single claim, bounded shutdown."""

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import remote_source_extract_runtime as remote
from aijian_api import sub2api_source_extract_runtime as sub2
from aijian_api.provider_connection_repository import ProviderConnectionNotFoundError
from aijian_api.remote_execution_authorization import TrustedRemoteCompositionPolicy


@pytest.fixture(params=["remote", "sub2"])
def supervisor(request):
    is_remote = request.param == "remote"
    module = remote if is_remote else sub2
    binding = (
        remote.AuthorizedRemoteTask("task_test", "grant_test", 1, "conn_test", 1)
        if is_remote
        else sub2.AuthorizedSub2APITask("task_test", "approval_test", "conn_test", 1)
    )
    connection = SimpleNamespace(
        enabled=True,
        provider_kind="CPA_LOOPBACK" if is_remote else "SUB2API",
        revision=1,
        credential_ref="synthetic-reference",
    )
    dependencies = dict(
        ledger=Mock(), worker=Mock(), bindings=Mock(), connections=Mock(), credentials=Mock()
    )
    dependencies["bindings"].next_ready.return_value = binding
    dependencies["connections"].get.return_value = connection
    dependencies["credentials"].get.return_value = "synthetic-test-only"
    policy = Mock(
        return_value=TrustedRemoteCompositionPolicy(
            "offline", "a" * 64, "test", 0, "USD", "test-policy"
        )
    )
    cls = remote.RemoteSourceExtractRuntime if is_remote else sub2.Sub2APISourceExtractRuntime
    kwargs = dict(dependencies, worker_id="offline-worker")
    if is_remote:
        kwargs["composition_policy_reader"] = policy
    runtime = cls(**kwargs)
    return SimpleNamespace(
        runtime=runtime,
        module=module,
        cls=cls,
        kwargs=kwargs,
        policy=policy,
        binding=binding,
        connection=connection,
        remote=is_remote,
        **dependencies,
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("worker_id", ""),
        ("lease_duration", timedelta(0)),
        ("lease_duration", timedelta(seconds=-1)),
        ("poll_interval", timedelta(0)),
        ("poll_interval", timedelta(seconds=-1)),
    ],
)
def test_constructor_requires_identity_and_positive_intervals(supervisor, field, value):
    with pytest.raises(ValueError):
        supervisor.cls(**(supervisor.kwargs | {field: value}))


@pytest.mark.parametrize(
    "field,value",
    [
        ("task_id", ""),
        ("connection_id", ""),
        ("connection_revision", True),
        ("connection_revision", 0),
        ("connection_revision", "1"),
    ],
)
def test_malformed_binding_rejects_before_any_claim(supervisor, field, value):
    supervisor.bindings.next_ready.return_value = replace(supervisor.binding, **{field: value})
    with pytest.raises(ValueError):
        supervisor.runtime.run_once()
    assert supervisor.runtime.availability().endswith("BINDING_INVALID")
    supervisor.ledger.claim_remote_task.assert_not_called()
    supervisor.credentials.get.assert_not_called()
    assert not supervisor.runtime._iteration.locked()


@pytest.mark.parametrize("failure", ["missing", "disabled", "kind", "revision", "vault", "empty"])
def test_unavailable_dependency_never_claims_or_executes(supervisor, failure):
    if failure == "missing":
        supervisor.connections.get.side_effect = ProviderConnectionNotFoundError("missing")
    elif failure == "disabled":
        supervisor.connection.enabled = False
    elif failure == "kind":
        supervisor.connection.provider_kind = "FAKE"
    elif failure == "revision":
        supervisor.connection.revision = 2
    elif failure == "vault":
        supervisor.credentials.get.side_effect = RuntimeError("synthetic vault unavailable")
    else:
        supervisor.credentials.get.return_value = ""
    assert supervisor.runtime.run_once() is None
    reason = "CREDENTIAL" if failure in {"vault", "empty"} else "CONNECTION"
    assert supervisor.runtime.availability() == f"PROVIDER_{reason}_UNAVAILABLE"
    supervisor.ledger.claim_remote_task.assert_not_called()
    supervisor.worker.execute.assert_not_called()
    assert not supervisor.runtime._iteration.locked()


@pytest.mark.parametrize("worker_fails", [False, True])
def test_executed_claim_is_never_retried_even_if_worker_raises(supervisor, worker_fails):
    if worker_fails:
        supervisor.worker.execute.side_effect = RuntimeError("offline execution failed")
        with pytest.raises(RuntimeError, match="offline execution failed"):
            supervisor.runtime.run_once()
        assert supervisor.runtime.availability().endswith("REQUIRES_RECONCILIATION")
    else:
        assert supervisor.runtime.run_once() is supervisor.worker.execute.return_value
    assert supervisor.runtime.run_once() is None
    supervisor.ledger.claim_remote_task.assert_called_once()
    supervisor.worker.execute.assert_called_once()
    assert supervisor.bindings.next_ready.call_args.kwargs == {
        "exclude_task_ids": frozenset({supervisor.binding.task_id})
    }
    assert not supervisor.runtime._iteration.locked()


@pytest.mark.parametrize(
    "case", ["none", "source-error", "wrong-type", "empty-approval", "no-claim"]
)
def test_selection_and_claim_absence_leave_worker_untouched(supervisor, case):
    if case == "none":
        supervisor.bindings.next_ready.return_value = None
    elif case == "source-error":
        supervisor.bindings.next_ready.side_effect = LookupError("offline reader failed")
    elif case == "wrong-type":
        supervisor.bindings.next_ready.return_value = object()
    elif case == "empty-approval":
        field = "authorization_id" if supervisor.remote else "approval_id"
        supervisor.bindings.next_ready.return_value = replace(supervisor.binding, **{field: ""})
    else:
        supervisor.ledger.claim_remote_task.return_value = None
    if case == "source-error":
        with pytest.raises(LookupError):
            supervisor.runtime.run_once()
        assert supervisor.runtime.availability().endswith("SOURCE_UNAVAILABLE")
    elif case in {"wrong-type", "empty-approval"}:
        with pytest.raises(ValueError):
            supervisor.runtime.run_once()
    else:
        assert supervisor.runtime.run_once() is None
        assert supervisor.runtime.availability().startswith("WAITING_FOR_")
    supervisor.worker.execute.assert_not_called()
    assert not supervisor.runtime._iteration.locked()
    assert not supervisor.runtime._claimed_task_ids


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), -float("inf")])
def test_invalid_stop_deadline_does_not_stop_runtime(supervisor, timeout):
    with pytest.raises(ValueError):
        supervisor.runtime.stop(timeout=timeout)
    assert supervisor.runtime.availability() == "CONFIGURED_NOT_STARTED"


def test_lifecycle_starts_once_joins_and_cannot_restart(supervisor):
    runtime = supervisor.runtime
    runtime._thread = Mock()
    runtime._thread.is_alive.return_value = False
    runtime.start()
    assert runtime.availability().startswith("WAITING_FOR_")
    with pytest.raises(RuntimeError, match="cannot be restarted"):
        runtime.start()
    runtime.stop(timeout=0.2)
    runtime._thread.start.assert_called_once_with()
    runtime._thread.join.assert_called_once()
    assert 0 <= runtime._thread.join.call_args.kwargs["timeout"] <= 0.2
    assert runtime.availability() == "STOPPED"
    with pytest.raises(RuntimeError, match="cannot be restarted"):
        runtime.start()
    assert runtime.run_once() is None
    supervisor.bindings.next_ready.assert_not_called()


def test_live_thread_shutdown_is_reported_not_silently_accepted(supervisor):
    runtime = supervisor.runtime
    runtime._thread = Mock()
    runtime._thread.is_alive.return_value = True
    runtime.start()
    with pytest.raises(RuntimeError, match="did not stop in time"):
        runtime.stop(timeout=0.001)
    assert runtime.availability() == "STOPPING"
    supervisor.worker.execute.assert_not_called()


def test_busy_iteration_is_not_reentered_and_stop_has_bounded_wait(supervisor):
    runtime = supervisor.runtime
    runtime._iteration.acquire()
    try:
        assert runtime.run_once() is None
        with pytest.raises(RuntimeError, match="operation did not stop in time"):
            runtime.stop(timeout=0.001)
        if supervisor.remote:
            assert runtime.availability() == "STOPPING"
    finally:
        runtime._iteration.release()
    assert runtime.availability() == "STOPPED"
    supervisor.bindings.next_ready.assert_not_called()


@pytest.mark.parametrize("stop_point", ["before", "locked", "credential"])
def test_stop_races_prevent_claim(supervisor, stop_point):
    runtime = supervisor.runtime
    if stop_point == "before":
        runtime.stop()
    elif stop_point == "locked":
        lock = Mock()

        def acquire(**kwargs):
            runtime._stop.set()
            return True

        lock.acquire.side_effect = acquire
        runtime._iteration = lock
    else:

        def credential(_reference):
            runtime._stop.set()
            return "synthetic-test-only"

        supervisor.credentials.get.side_effect = credential
    assert runtime.run_once() is None
    supervisor.ledger.claim_remote_task.assert_not_called()
    supervisor.worker.execute.assert_not_called()
    if stop_point == "locked":
        runtime._iteration.release.assert_called_once()


@pytest.mark.parametrize("outcome", ["idle", "success", "error"])
def test_poll_loop_logs_exception_class_only_and_stops(supervisor, outcome, caplog):
    runtime = supervisor.runtime
    runtime.run_once = Mock()
    runtime._stop = Mock()
    runtime._stop.is_set.side_effect = [False, True]
    if outcome == "error":
        runtime.run_once.side_effect = RuntimeError("synthetic-sensitive-detail")
    else:
        runtime.run_once.return_value = None if outcome == "idle" else object()
    runtime._run()
    runtime.run_once.assert_called_once()
    if outcome == "success":
        runtime._stop.wait.assert_not_called()
    else:
        runtime._stop.wait.assert_called_once_with(1.0)
    assert "synthetic-sensitive-detail" not in caplog.text
    if outcome == "error":
        assert "RuntimeError" in caplog.text


@pytest.mark.parametrize("bad_revision", [True, 0, "1"])
def test_remote_authorization_revision_is_strict(bad_revision):
    dependencies = dict(
        ledger=Mock(),
        worker=Mock(),
        bindings=Mock(),
        connections=Mock(),
        credentials=Mock(),
        worker_id="offline",
    )
    policy = TrustedRemoteCompositionPolicy("offline", "a" * 64, "test", 0, "USD", "v1")
    runtime = remote.RemoteSourceExtractRuntime(
        **dependencies, composition_policy_reader=lambda: policy
    )
    dependencies["bindings"].next_ready.return_value = remote.AuthorizedRemoteTask(
        "task", "grant", bad_revision, "connection", 1
    )
    with pytest.raises(ValueError):
        runtime.run_once()
    dependencies["ledger"].claim_remote_task.assert_not_called()


@pytest.mark.parametrize("unavailable", [None, ValueError("policy unavailable")])
def test_remote_requires_trusted_policy_before_reading_bindings(unavailable):
    reader = Mock()
    if isinstance(unavailable, Exception):
        reader.side_effect = unavailable
    else:
        reader.return_value = unavailable
    bindings, ledger = Mock(), Mock()
    runtime = remote.RemoteSourceExtractRuntime(
        ledger=ledger,
        worker=Mock(),
        bindings=bindings,
        composition_policy_reader=reader,
        connections=Mock(),
        credentials=Mock(),
        worker_id="offline",
    )
    assert runtime.run_once() is None
    assert runtime.availability() == "TRUSTED_POLICY_UNAVAILABLE"
    bindings.next_ready.assert_not_called()
    ledger.claim_remote_task.assert_not_called()
