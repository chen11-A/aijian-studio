"""Temporary offline Sub2API records; no vault, transport, or production authorization."""

import json
from dataclasses import replace
from unittest.mock import Mock

import pytest
from aijian_api import sub2api_source_extract_store as store
from aijian_api.task_ledger_models import LeaseLostError, timestamp
from test_remote_lease_boundaries import lose_cas
from test_sub2api_store_boundaries import approve, running_claim
from test_sub2api_store_boundaries import prepared as prepared


def database_state(local):
    connection = local._open()
    try:
        return {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table}")]
            for table in (
                "workflow_attempts",
                "workflow_node_runs",
                "workflow_runs",
                "task_ledger",
                "agent_runs",
                "skill_runs",
                "sub2api_source_extract_scopes",
                "sub2api_call_approvals",
                "sub2api_call_consumptions",
                "sub2api_call_observations",
            )
        }
    finally:
        connection.close()


def frozen_scope(local):
    connection = local._open()
    try:
        return json.loads(
            connection.execute("SELECT scope_json FROM sub2api_source_extract_scopes").fetchone()[0]
        )
    finally:
        connection.close()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("source", None, "coordinates are missing"),
        ("context_manifest_id", "ctx_" + "f" * 32, "context changed"),
        ("context_manifest_hash", "sha256:" + "f" * 64, "context changed"),
        ("accepted_manifest_content_hash", "sha256:" + "f" * 64, "context changed"),
        ("excerpt_sha256", "sha256:" + "f" * 64, "bytes changed"),
    ],
)
def test_frozen_scope_identity_drift_is_rejected(prepared, field, value, message):
    local, *_ = prepared
    scope = frozen_scope(local)
    scope[field] = value
    before = database_state(local)
    connection = local._open()
    try:
        with pytest.raises(store.Sub2APISourceExtractConflictError, match=message):
            store._assert_frozen_source(connection, scope)
        assert connection.total_changes == 0
    finally:
        connection.close()
    assert database_state(local) == before


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("start_byte", True),
        ("start_byte", -1),
        ("end_byte", "2"),
        ("end_byte", 0),
        ("end_byte", 10**9),
        ("source_block_id", "missing"),
        ("source_document_id", "missing"),
        ("source_manifest_version_id", "missing"),
    ],
)
def test_frozen_source_range_is_exact_not_reinterpreted(prepared, field, value):
    local, *_ = prepared
    scope = frozen_scope(local)
    scope["source"][field] = value
    connection = local._open()
    try:
        with pytest.raises(store.Sub2APISourceExtractConflictError):
            store._assert_frozen_source(connection, scope)
        assert connection.total_changes == 0
    finally:
        connection.close()


@pytest.mark.parametrize(
    "field",
    [
        "input_hash",
        "fingerprint",
        "accepted_hash",
        "excerpt_hash",
        "origin_hash",
        "revision",
        "model",
    ],
)
def test_scope_insert_rejects_changed_frozen_identity_before_insert(prepared, field):
    local, created, project, now = prepared
    payload = frozen_scope(local)
    scope = local.read_scope(project_id=project, task_id=created.task.task_id)
    draft = store.Sub2APISourceExtractScopeDraft(
        selection=scope.selection,
        source=scope.source,
        origin_hash=scope.origin_hash,
        origin_mode=scope.origin_mode,
        input_hash=scope.input_hash,
        context_manifest_id=payload["context_manifest_id"],
        context_manifest_hash=scope.context_manifest_hash,
        accepted_manifest_content_hash=payload["accepted_manifest_content_hash"],
        source_span_id=payload["source_span_id"],
        excerpt_sha256=payload["excerpt_sha256"],
    )
    fingerprint = created.attempt.attempt_fingerprint
    if field == "fingerprint":
        fingerprint = "sha256:" + "f" * 64
    elif field == "accepted_hash":
        draft = replace(draft, accepted_manifest_content_hash="bad")
    elif field == "excerpt_hash":
        draft = replace(draft, excerpt_sha256="bad")
    elif field == "revision":
        draft = replace(
            draft, selection=scope.selection.model_copy(update={"connection_revision": 2})
        )
    elif field == "model":
        draft = replace(draft, selection=scope.selection.model_copy(update={"model_id": "other"}))
    else:
        draft = replace(draft, **{field: "sha256:" + "f" * 64})
    connection = local._open()
    try:
        with pytest.raises(store.Sub2APISourceExtractConflictError):
            store.insert_sub2api_scope_in_connection(
                connection,
                draft=draft,
                project_id=project,
                task_id=created.task.task_id,
                attempt_id=created.task.attempt_id,
                attempt_fingerprint=fingerprint,
                now_text=timestamp(now),
            )
        assert connection.total_changes == 0
    finally:
        connection.close()


def test_predispatch_failure_is_terminal_and_keeps_approval_unconsumed(prepared):
    local, created, project, _ = prepared
    approve(prepared)
    local.fail_before_dispatch(claim=running_claim(prepared), code="SYNTHETIC_REJECTED")
    operation = local.read_operation(
        project_id=project, run_id=created.persisted.agent_run.agent_run_id
    )
    assert operation.content_status == "FAILED"
    assert operation.automatic_retry_allowed is False
    state = database_state(local)
    assert len(state["sub2api_call_approvals"]) == 1
    assert state["sub2api_call_consumptions"] == []
    assert state["sub2api_call_observations"] == []
    assert local.next_ready(exclude_task_ids=frozenset()) is None


@pytest.mark.parametrize("table", ["workflow_attempts", "workflow_node_runs", "task_ledger"])
def test_predispatch_failure_cas_loss_rolls_back_agent_and_workflow(prepared, monkeypatch, table):
    local, *_ = prepared
    approve(prepared)
    claim = running_claim(prepared)
    before = database_state(local)
    hits = lose_cas(local, monkeypatch, f"UPDATE {table}")
    with pytest.raises(LeaseLostError, match="failure lost its workflow claim"):
        local.fail_before_dispatch(claim=claim, code="SYNTHETIC_REJECTED")
    assert len(hits) == 1
    assert database_state(local) == before


def test_consumption_cas_loss_does_not_spend_test_approval(prepared, monkeypatch):
    local, *_ = prepared
    approval = approve(prepared)
    claim = running_claim(prepared)
    before = database_state(local)
    hits = lose_cas(local, monkeypatch, "UPDATE workflow_attempts")
    with pytest.raises(LeaseLostError, match="changed during Sub2API consume"):
        local.begin_sub2api_dispatch(claim=claim, approval_id=approval.approval_id)
    assert len(hits) == 1
    assert database_state(local) == before


@pytest.mark.parametrize("table", ["workflow_attempts", "workflow_node_runs", "task_ledger"])
def test_quarantine_cas_loss_rolls_back_observation(prepared, monkeypatch, table):
    local, *_ = prepared
    approval = approve(prepared)
    permit = local.begin_sub2api_dispatch(
        claim=running_claim(prepared), approval_id=approval.approval_id
    )
    before = database_state(local)
    hits = lose_cas(local, monkeypatch, f"UPDATE {table}")
    with pytest.raises(LeaseLostError, match="quarantine lost its workflow claim"):
        local.quarantine_unknown(permit=permit, provider_response_id=None, code="SYNTHETIC_UNKNOWN")
    assert len(hits) == 1
    assert database_state(local) == before


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("provider_response_id", " "),
        ("provider_response_id", "x" * 513),
        ("raw_output_sha256", "bad"),
        ("raw_output_sha256", "sha256:" + "f" * 64),
    ],
)
def test_incomplete_response_evidence_never_opens_store(prepared, monkeypatch, field, value):
    local, *_ = prepared
    arguments = dict(
        permit=None,
        proposal=None,
        provider_response_id="synthetic",
        raw_output_text="synthetic",
        raw_output_sha256="sha256:" + "a" * 64,
        raw_response_body=b"",
        raw_response_sha256="sha256:" + "b" * 64,
        usage_tokens=None,
    )
    arguments[field] = value
    opener = Mock(side_effect=AssertionError("must not open"))
    monkeypatch.setattr(local, "_open", opener)
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        local.record_candidate(**arguments)
    opener.assert_not_called()
