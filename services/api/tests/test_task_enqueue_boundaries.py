"""Offline enqueue guards and durable identity checks; no provider transport is created."""

import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from aijian_api import task_ledger as ledger_module
from aijian_api.agent_skill_builtins import sub2api_source_extract_registry
from aijian_api.provider_connection_repository import ProviderConnectionRepository
from aijian_api.sub2api_source_extract_contracts import CreateSub2APISourceExtractRunRequest
from aijian_api.sub2api_source_extract_run_factory import Sub2APISourceExtractRunFactory
from aijian_api.task_ledger_enqueue import _insert_remote_dispatch_snapshot, enqueue_sub2api_node
from aijian_api.task_ledger_models import timestamp
from test_proposal_run_create_api import accepted_source, create_payload, sidecar_client
from test_provider_connection_runtime_baseline import MODELS, create_connection
from test_remote_execution_authorization import NOW, _remote_fixture


@pytest.mark.parametrize("provider_state", ["missing", "disabled"])
def test_remote_snapshot_rejects_unavailable_provider_without_inserting(tmp_path, provider_state):
    database, _, project_id, _, _, _, _, draft = _remote_fixture(tmp_path)
    with sqlite3.connect(database) as connection:
        connection.row_factory = sqlite3.Row
        if provider_state == "missing":
            # Keep the real provider and its foreign-key references intact.
            draft = replace(
                draft, connection_id="pcn_" + "f" * 32, scope=json.loads(draft.scope_json())
            )
            assert (
                connection.execute(
                    "SELECT 1 FROM provider_connections WHERE connection_id = ?",
                    (draft.connection_id,),
                ).fetchone()
                is None
            )
        else:
            connection.execute(
                "UPDATE provider_connections SET enabled = 0, revision = revision + 1 "
                "WHERE connection_id = ?",
                (draft.connection_id,),
            )
            # Match the updated revision to isolate the disabled-provider guard.
            draft = replace(
                draft,
                connection_revision=draft.connection_revision + 1,
                scope=json.loads(draft.scope_json()),
            )
        before = tuple(connection.iterdump())
        with pytest.raises(ValueError, match="provider connection is unavailable"):
            _insert_remote_dispatch_snapshot(
                connection,
                attempt_id="att_" + "f" * 32,
                project_id=project_id,
                draft=draft,
                created_at=timestamp(NOW),
            )
        assert tuple(connection.iterdump()) == before


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("revision", "provider revision is stale"),
        ("models_json", "provider models are malformed"),
        ("models_empty", "model is not approved"),
        ("models_untyped", "model is not approved"),
    ],
)
def test_remote_snapshot_rejects_changed_provider_metadata_without_inserting(
    tmp_path, mutation, message
):
    database, _, project_id, _, _, _, _, draft = _remote_fixture(tmp_path)

    class CorruptMetadataCursor:
        def __init__(self, row):
            self.row = row

        def fetchone(self):
            return {**dict(self.row), "models_json": "{"}

    class MetadataReadConnection(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            cursor = super().execute(sql, parameters)
            if mutation == "models_json" and sql.startswith(
                "SELECT revision, enabled, models_json"
            ):
                # Defense-in-depth read corruption; the real DB CHECK rejects invalid JSON.
                return CorruptMetadataCursor(cursor.fetchone())
            return cursor

    with sqlite3.connect(database, factory=MetadataReadConnection) as connection:
        connection.row_factory = sqlite3.Row
        if mutation == "revision":
            connection.execute("UPDATE provider_connections SET revision = revision + 1")
        elif mutation != "models_json":
            value = {"models_empty": "[]", "models_untyped": "[7]"}[mutation]
            connection.execute(
                "UPDATE provider_connections SET models_json = ?, revision = revision + 1",
                (value,),
            )
            draft = replace(
                draft,
                connection_revision=draft.connection_revision + 1,
                scope=json.loads(draft.scope_json()),
            )
        before = tuple(connection.iterdump())
        with pytest.raises(ValueError, match=message):
            _insert_remote_dispatch_snapshot(
                connection,
                attempt_id="att_" + "f" * 32,
                project_id=project_id,
                draft=draft,
                created_at=timestamp(NOW),
            )
        assert tuple(connection.iterdump()) == before


def test_sub2api_reenqueue_reuses_exact_frozen_scope_and_rejects_invalid_modes(
    tmp_path, monkeypatch
):
    client, studio = sidecar_client(tmp_path)
    now = datetime.now(UTC) + timedelta(seconds=5)
    source = accepted_source(client)
    connections = ProviderConnectionRepository(studio.database_path, clock=lambda: now)
    configured = create_connection(connections)
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
    captured = []

    def capture_enqueue(request, **kwargs):
        captured.append((request, kwargs))
        return enqueue_sub2api_node(request, **kwargs)

    monkeypatch.setattr(ledger_module, "enqueue_sub2api_node", capture_enqueue)
    created = Sub2APISourceExtractRunFactory(
        studio, sub2api_source_extract_registry(), clock=lambda: now
    ).create(project_id=source[0], payload=payload, idempotency_key="synthetic-scope-replay")
    assert len(captured) == 1
    request, kwargs = captured[0]
    with sqlite3.connect(studio.database_path) as connection:
        before = tuple(connection.iterdump())

    replay = enqueue_sub2api_node(request, **kwargs)
    assert not replay.created
    assert (replay.task_id, replay.attempt_id) == (created.task.task_id, created.task.attempt_id)
    assert replay.workflow_run_id == created.task.workflow_run_id
    assert replay.node_run_id == created.task.node_run_id
    with sqlite3.connect(studio.database_path) as connection:
        assert tuple(connection.iterdump()) == before

    def must_not_open():
        raise AssertionError("invalid Sub2API scope must be rejected before transaction")

    for invalid in (
        replace(request, sub2api_scope=None),
        replace(request, task_kind="remote.extract"),
        replace(request, max_attempts=2),
    ):
        with pytest.raises(ValueError, match="own frozen scope and one attempt"):
            enqueue_sub2api_node(invalid, **{**kwargs, "connection_factory": must_not_open})
    with sqlite3.connect(studio.database_path) as connection:
        assert tuple(connection.iterdump()) == before
