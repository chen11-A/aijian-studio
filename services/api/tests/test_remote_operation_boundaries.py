"""Read-only remote operation recovery on temporary SQLite; no authorization or dispatch."""

import sqlite3
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace

import pytest
from aijian_api import remote_source_extract_operation_query as query
from aijian_api import source_extract_run_factory as factory_module
from aijian_api.agent_skill_builtins import (
    SOURCE_ANALYST_REMOTE_REF,
    SOURCE_EXTRACT_REMOTE_REF,
    built_in_agent_skill_registry,
)
from aijian_api.contracts import CreateProposalRunRequest
from aijian_api.provider_connection_repository import ProviderConnectionRepository, ProviderModel
from aijian_api.provider_contracts import CPA_LOOPBACK_BASE_URL
from aijian_api.source_extract_run_factory import (
    RemoteSourceExtractSelection,
    SourceExtractRunFactory,
)
from aijian_api.task_ledger import LocalTaskLedger
from test_proposal_run_create_api import accepted_source, create_payload, sidecar_client


@pytest.fixture
def operation(tmp_path):
    client, repository = sidecar_client(tmp_path)
    with client:
        source = accepted_source(client)
    connection = ProviderConnectionRepository(repository.database_path).create(
        provider_kind="CPA_LOOPBACK",
        display_name="Synthetic offline operation",
        base_url=CPA_LOOPBACK_BASE_URL,
        enabled=True,
        models=(ProviderModel(model_id="synthetic-model", capabilities=("TEXT",)),),
    )
    payload = CreateProposalRunRequest.model_validate(
        create_payload(source)
        | {
            "agent_definition": SOURCE_ANALYST_REMOTE_REF,
            "skill_definition": SOURCE_EXTRACT_REMOTE_REF,
        }
    )
    factory = SourceExtractRunFactory(repository, built_in_agent_skill_registry())
    selection = RemoteSourceExtractSelection(connection.id, connection.revision, "synthetic-model")
    args = dict(
        project_id=source[0],
        payload=payload,
        idempotency_key="synthetic-remote-read",
        selection=selection,
    )
    created = factory.create_remote(**args)
    return SimpleNamespace(
        repository=repository,
        source=source,
        created=created,
        factory=factory,
        args=args,
        run_id=created.attempt.agent_run_id,
        project=source[0],
    )


def read(operation):
    return query.read_remote_source_extract_operation(
        operation.repository,
        project_id=operation.project,
        run_id=operation.run_id,
    )


@contextmanager
def readback(operation, monkeypatch, transform):
    traces = []

    @contextmanager
    def connection():
        with sqlite3.connect(operation.repository.database_path) as db:
            db.row_factory = lambda cursor, values: transform(sqlite3.Row(cursor, values))
            db.set_trace_callback(traces.append)
            try:
                yield db
            finally:
                assert db.total_changes == 0
                assert all(
                    sql.lstrip().split()[0].upper() in {"SELECT", "PRAGMA", "BEGIN", "COMMIT"}
                    for sql in traces
                )

    with monkeypatch.context() as patch:
        patch.setattr(operation.repository, "_connection", connection)
        yield


def test_exact_remote_intent_replays_same_task_and_reads_without_writes(operation, monkeypatch):
    replay = operation.factory.create_remote(**operation.args)
    assert replay.replayed
    assert replay.task == operation.created.task
    with readback(operation, monkeypatch, lambda row: row):
        value = read(operation)
    assert value.operation_status == "TRACKED"
    assert value.task.task_id == operation.created.task.task_id
    assert value.task.attempt_status == "READY"
    assert value.selection.model_id == "synthetic-model"
    assert value.source.source_manifest_version_id == operation.source[1]
    assert value.raw_response_body_status == "NOT_PERSISTED"
    assert value.accounting.calls_reserved == 0
    assert value.proposal_id is None


def test_claimed_but_undispatched_operation_preserves_one_attempt(operation):
    ledger = LocalTaskLedger(operation.repository.database_path)
    claim = ledger.claim_remote_task(
        worker_id="synthetic-worker",
        lease_duration=timedelta(seconds=30),
        task_id=operation.created.task.task_id,
    )
    assert claim is not None
    value = read(operation)
    assert value.task.attempt_id == claim.attempt_id
    assert value.accounting.calls_reserved == 0
    assert value.task.provider_response_id is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("project_id", "other"),
        ("definition_id", "other"),
        ("definition_version", 2),
        ("definition_hash", "wrong"),
        ("input_hash", "wrong"),
        ("node_key", "other"),
        ("node_type", "agent.skill.fake"),
        ("contract_version", 2),
        ("max_attempts", 2),
        ("idempotency_key", "other"),
        ("node_input_hash", "wrong"),
        ("attempt_id", None),
        ("active_attempt_id", "other"),
        ("attempt_status", "RUNNING"),
        ("execution_mode", "local"),
        ("attempt_input_hash", "wrong"),
        ("request_fingerprint", "wrong"),
    ],
)
def test_tracked_workflow_cannot_drift_from_original_enqueue_intent(
    operation, monkeypatch, field, value
):
    def transform(row):
        return dict(row) | {field: value} if "workflow_status" in row.keys() else row

    with readback(operation, monkeypatch, transform):
        with pytest.raises(query.RemoteSourceExtractOperationInconsistentError):
            read(operation)


@pytest.mark.parametrize(
    "field,value",
    [
        ("operation", "other"),
        ("connection_id", "other"),
        ("connection_revision", 2),
        ("approved_model_id", "other"),
        ("context_manifest_id", "other"),
        ("context_manifest_hash", "wrong"),
        ("input_scope_hash", "wrong"),
        ("snapshot_hash", "wrong"),
        ("endpoint_binding", "other"),
        ("transport_contract_hash", "wrong"),
        ("scope_kind", "other"),
        ("requested_additional_budget_micros", 1),
        ("approved_currency", "EUR"),
        ("policy_version", "other"),
        ("scope_json", "{}"),
        ("scope_json", "{"),
    ],
)
def test_dispatch_snapshot_cannot_drift_or_enable_hidden_request(
    operation, monkeypatch, field, value
):
    def transform(row):
        return dict(row) | {field: value} if "snapshot_hash" in row.keys() else row

    with readback(operation, monkeypatch, transform):
        with pytest.raises(query.RemoteSourceExtractOperationInconsistentError):
            read(operation)


@pytest.mark.parametrize("missing", ["tracked", "count", "dispatch", "task-kind"])
def test_missing_or_multiple_attempt_links_are_not_reported_as_tracked(
    operation, monkeypatch, missing
):
    def transform(row):
        keys = row.keys()
        if missing == "tracked" and "workflow_status" in keys:
            return None
        if missing == "count" and keys == ["COUNT(*)"]:
            return (2,)
        if missing == "dispatch" and "snapshot_hash" in keys:
            return None
        if missing == "task-kind" and "task_kind" in keys:
            return dict(row) | {"task_kind": "local.agent-skill.fake"}
        return row

    with readback(operation, monkeypatch, transform):
        with pytest.raises(query.RemoteSourceExtractOperationInconsistentError):
            read(operation)


def test_unknown_run_is_not_found_without_materializing_any_new_state(operation, monkeypatch):
    with readback(operation, monkeypatch, lambda row: row):
        with pytest.raises(query.RemoteSourceExtractOperationNotFoundError):
            query.read_remote_source_extract_operation(
                operation.repository,
                project_id=operation.project,
                run_id="agr_" + "0" * 32,
            )


@pytest.mark.parametrize(
    "revision,model", [(True, "synthetic-model"), (0, "synthetic-model"), (1, "")]
)
def test_remote_selection_requires_positive_revision_and_model_before_new_run(
    operation, revision, model
):
    from aijian_api.application_errors import ProposalRunInputRejectedError

    args = operation.args | {
        "idempotency_key": "synthetic-invalid-selection",
        "selection": replace(
            operation.args["selection"], connection_revision=revision, model_id=model
        ),
    }
    with pytest.raises(ProposalRunInputRejectedError):
        operation.factory.create_remote(**args)
    with operation.repository._connection() as connection:
        assert connection.execute("SELECT count(*) FROM agent_runs").fetchone()[0] == 1


def test_interrupted_enqueue_remains_pending_and_recovers_original_intent(operation, monkeypatch):
    from unittest.mock import Mock

    args = operation.args | {"idempotency_key": "synthetic-enqueue-interruption"}
    with monkeypatch.context() as patch:
        patch.setattr(
            factory_module.LocalTaskLedger,
            "enqueue_remote_node",
            Mock(side_effect=RuntimeError("synthetic enqueue boundary failure")),
        )
        with pytest.raises(RuntimeError, match="enqueue boundary failure"):
            operation.factory.create_remote(**args)
    with operation.repository._connection() as connection:
        row = connection.execute(
            "SELECT agent_run_id FROM agent_runs WHERE agent_run_id <> ?",
            (operation.run_id,),
        ).fetchone()
    pending = query.read_remote_source_extract_operation(
        operation.repository,
        project_id=operation.project,
        run_id=row[0],
    )
    assert pending.operation_status == "PENDING_ENQUEUE"
    assert pending.task is None and pending.accounting is None
    recovered = operation.factory.create_remote(**args)
    assert recovered.replayed and recovered.attempt.agent_run_id == pending.run_id
    current = query.read_remote_source_extract_operation(
        operation.repository,
        project_id=operation.project,
        run_id=pending.run_id,
    )
    assert current.operation_status == "TRACKED"
    assert current.intent_hash == pending.intent_hash
    assert current.intent_request_hash == pending.intent_request_hash
    assert current.task.task_id == recovered.task.task_id
    assert current.accounting.calls_reserved == 0


def test_local_fake_operation_cannot_be_read_as_remote(operation):
    local = operation.factory.create(
        project_id=operation.project,
        payload=CreateProposalRunRequest.model_validate(create_payload(operation.source)),
        idempotency_key="synthetic-local-only",
    )
    with pytest.raises(query.RemoteSourceExtractOperationNotFoundError):
        query.read_remote_source_extract_operation(
            operation.repository,
            project_id=operation.project,
            run_id=local.attempt.agent_run_id,
        )


@pytest.mark.parametrize("remote", [True, False])
def test_distinct_explicit_requests_own_context_instances_and_keep_exact_replay(operation, remote):
    if remote:
        first = operation.created
        create = operation.factory.create_remote
        args = operation.args
    else:
        create = operation.factory.create
        args = dict(
            project_id=operation.project,
            payload=CreateProposalRunRequest.model_validate(create_payload(operation.source)),
            idempotency_key="synthetic-local-first",
        )
        first = create(**args)
    second_args = args | {"idempotency_key": "synthetic-distinct-explicit-request"}
    second = create(**second_args)
    assert first.attempt.agent_run_id != second.attempt.agent_run_id
    assert first.task.task_id != second.task.task_id
    assert first.persisted.context_manifest.context_manifest_id != (
        second.persisted.context_manifest.context_manifest_id
    )
    assert (
        first.persisted.context_manifest.manifest_hash
        == second.persisted.context_manifest.manifest_hash
    )
    replay = create(**second_args)
    assert replay.replayed
    assert replay.task == second.task
    assert replay.persisted.context_manifest == second.persisted.context_manifest


def sub2_factory_args(operation):
    from aijian_api.agent_skill_builtins import sub2api_source_extract_registry
    from aijian_api.sub2api_source_extract_contracts import CreateSub2APISourceExtractRunRequest
    from aijian_api.sub2api_source_extract_run_factory import Sub2APISourceExtractRunFactory
    from test_provider_connection_runtime_baseline import MODELS, create_connection

    connection = create_connection(ProviderConnectionRepository(operation.repository.database_path))
    payload = create_payload(operation.source)
    payload["agent_definition"] = {
        "definition_id": "writer.source-analyst-sub2api",
        "version": "1.0.0",
    }
    payload["skill_definition"] = {"definition_id": "source.extract-sub2api", "version": "1.0.0"}
    factory = Sub2APISourceExtractRunFactory(
        operation.repository, sub2api_source_extract_registry()
    )
    return factory, dict(
        project_id=operation.project,
        payload=CreateSub2APISourceExtractRunRequest.model_validate(
            {
                "source": payload,
                "selection": {
                    "connection_id": connection.id,
                    "connection_revision": connection.revision,
                    "model_id": MODELS[0].model_id,
                },
            }
        ),
        idempotency_key="synthetic-sub2-first",
    )


def test_sub2_explicit_new_request_has_own_context_without_automatic_dispatch(operation):
    factory, args = sub2_factory_args(operation)
    first = factory.create(**args)
    second_args = args | {"idempotency_key": "synthetic-sub2-second"}
    second = factory.create(**second_args)
    assert first.task.task_id != second.task.task_id
    assert (
        first.persisted.context_manifest.context_manifest_id
        != second.persisted.context_manifest.context_manifest_id
    )
    assert (
        first.persisted.context_manifest.manifest_hash
        == second.persisted.context_manifest.manifest_hash
    )
    replay = factory.create(**second_args)
    assert replay.replayed and replay.task == second.task
    with operation.repository._connection() as connection:
        assert connection.execute("SELECT count(*) FROM sub2api_call_approvals").fetchone()[0] == 0


@pytest.mark.parametrize("mode", ["local", "remote", "sub2"])
def test_legacy_unscoped_context_replays_without_rebuilding_or_migrating(
    operation, monkeypatch, mode
):
    from unittest.mock import Mock

    from aijian_api import sub2api_source_extract_run_factory as sub2_module

    module = factory_module
    if mode == "remote":
        create = operation.factory.create_remote
        args = operation.args | {"idempotency_key": "synthetic-legacy-remote"}
    elif mode == "sub2":
        factory, args = sub2_factory_args(operation)
        create = factory.create
        module = sub2_module
    else:
        create = operation.factory.create
        args = dict(
            project_id=operation.project,
            payload=CreateProposalRunRequest.model_validate(create_payload(operation.source)),
            idempotency_key="synthetic-legacy-local",
        )
    original = module.build_context
    with monkeypatch.context() as patch:
        patch.setattr(
            module,
            "build_context",
            lambda **kwargs: original(
                **{key: value for key, value in kwargs.items() if key != "run_scope"}
            ),
        )
        legacy = create(**args)
    manifest = legacy.persisted.context_manifest
    assert (
        manifest.context_manifest_id == "ctx_" + manifest.manifest_hash.removeprefix("sha256:")[:32]
    )
    with monkeypatch.context() as patch:
        patch.setattr(
            module, "build_context", Mock(side_effect=AssertionError("must replay stored intent"))
        )
        replay = create(**args)
    assert replay.replayed and replay.task == legacy.task
    assert replay.persisted.context_manifest == legacy.persisted.context_manifest
