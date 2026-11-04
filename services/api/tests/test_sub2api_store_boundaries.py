"""Synthetic persistence-boundary tests; no provider, network, or real credentials."""

import hashlib
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from aijian_api import sub2api_source_extract_store as store
from aijian_api.agent_skill_builtins import sub2api_source_extract_registry
from aijian_api.provider_connection_repository import ProviderConnectionRepository
from aijian_api.sub2api_source_extract_contracts import CreateSub2APISourceExtractRunRequest
from aijian_api.sub2api_source_extract_run_factory import Sub2APISourceExtractRunFactory
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import LeaseLostError
from test_proposal_run_create_api import accepted_source, create_payload, sidecar_client
from test_provider_connection_runtime_baseline import MODELS, create_connection


def response_payload():
    return {
        "id": "synthetic-response",
        "model": "synthetic-model",
        "choices": [{"message": {"role": "assistant", "content": "synthetic text"}}],
    }


def validate(payload, *, usage=None):
    body = json.dumps(payload, ensure_ascii=False).encode()
    return store._validate_raw_response(
        body,
        "sha256:" + hashlib.sha256(body).hexdigest(),
        provider_response_id="synthetic-response",
        model_id="synthetic-model",
        raw_output_text="synthetic text",
        usage_tokens=usage,
    )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("id", "other"),
        ("model", "other"),
        ("choices", None),
        ("choices", []),
        ("extra", True),
        ("object", "completion"),
        ("created", True),
        ("created", -1),
        ("system_fingerprint", 7),
        ("system_fingerprint", "x" * 121),
        ("service_tier", None),
        ("service_tier", ""),
        ("service_tier", "x" * 81),
        ("service_tier", "含中文"),
        ("service_tier", "default tier"),
        ("choices.0", None),
        ("choices.0.extra", True),
        ("choices.0.message", None),
        ("choices.0.message.role", "user"),
        ("choices.0.message.content", "other"),
        ("choices.0.message.refusal", "refused"),
        ("choices.0.message.extra", True),
        ("choices.0.message.reasoning", 7),
        ("choices.0.message.reasoning_content", "x" * 262145),
        ("choices.0.index", True),
        ("choices.0.index", 1),
        ("choices.0.logprobs", {}),
        ("choices.0.finish_reason", 7),
        ("choices.0.finish_reason", "x" * 121),
        ("usage", []),
        ("usage", {"unsupported": 1}),
    ],
    ids=lambda value: str(value)[:60],
)
def test_persisted_completion_rejects_unclosed_or_mismatched_fields(path, value):
    payload = response_payload()
    target = payload
    parts = path.split(".")
    for key in parts[:-1]:
        target = target[int(key)] if isinstance(target, list) else target[key]
    key = int(parts[-1]) if isinstance(target, list) else parts[-1]
    target[key] = value
    with pytest.raises(store.Sub2APISourceExtractConflictError, match="safe text completion"):
        validate(payload)


@pytest.mark.parametrize(
    "body",
    [b"", b"x" * (1048576 + 1), b"\xff", b"{", b"[]", b'{"id":1,"id":2}', b'{"id":NaN}'],
    ids=[
        "empty",
        "oversized",
        "invalid-utf8",
        "invalid-json",
        "array",
        "duplicate-key",
        "nonfinite",
    ],
)
def test_invalid_response_bytes_never_become_persisted_evidence(body):
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        store._validate_raw_response(
            body,
            "sha256:" + hashlib.sha256(body).hexdigest(),
            provider_response_id="synthetic-response",
            model_id="synthetic-model",
            raw_output_text="synthetic text",
            usage_tokens=None,
        )


@pytest.mark.parametrize(
    "detail",
    [
        [],
        {"unknown": 1},
        {"audio_tokens": True},
        {"audio_tokens": -1},
        {"audio_tokens": 10**12 + 1},
    ],
)
@pytest.mark.parametrize("field", ["prompt_tokens_details", "completion_tokens_details"])
def test_invalid_usage_details_cannot_be_persisted(field, detail):
    payload = response_payload()
    payload["usage"] = {field: detail}
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        validate(payload, usage=(None, None, None))


def test_allowed_metadata_is_bounded_but_not_a_settlement_receipt():
    payload = response_payload()
    payload.update(
        object="chat.completion", created=0, system_fingerprint=None, service_tier="default"
    )
    payload["choices"][0].update(index=0, finish_reason="stop", logprobs=None)
    payload["choices"][0]["message"].update(reasoning="synthetic", reasoning_content="", refusal="")
    assert validate(payload) is None
    payload["usage"] = {
        "prompt_tokens": 2,
        "completion_tokens": 3,
        "total_tokens": 5,
        "prompt_tokens_details": {"cached_tokens": 1},
        "completion_tokens_details": {"reasoning_tokens": 2},
    }
    assert json.loads(validate(payload, usage=(2, 3, 5))) == {
        "prompt_tokens": 2,
        "completion_tokens": 3,
        "total_tokens": 5,
    }


@pytest.fixture
def prepared(tmp_path):
    client, studio = sidecar_client(tmp_path)
    now = datetime.now(UTC) + timedelta(seconds=5)
    source = accepted_source(client)
    configured = create_connection(
        ProviderConnectionRepository(studio.database_path, clock=lambda: now)
    )
    source_payload = create_payload(source)
    source_payload.update(
        agent_definition={"definition_id": "writer.source-analyst-sub2api", "version": "1.0.0"},
        skill_definition={"definition_id": "source.extract-sub2api", "version": "1.0.0"},
    )
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
    ).create(project_id=source[0], payload=payload, idempotency_key="synthetic-store-run")
    local = store.Sub2APISourceExtractStore(studio.database_path, clock=lambda: now)
    return local, created, source[0], now


def approve(prepared, **overrides):
    local, created, project_id, _ = prepared
    arguments = dict(
        project_id=project_id,
        task_id=created.task.task_id,
        attempt_id=created.task.attempt_id,
        expected_attempt_fingerprint=created.attempt.attempt_fingerprint,
        actor_id="synthetic-user",
        idempotency_key="synthetic-approval",
    )
    return local.issue_approval(**{**arguments, **overrides})


@pytest.mark.parametrize(
    "field",
    [
        "task_id",
        "attempt_id",
        "project_id",
        "connection_id",
        "connection_revision",
        "model_id",
        "origin_hash",
        "input_hash",
        "context_manifest_hash",
        "attempt_fingerprint",
    ],
)
def test_denormalized_scope_drift_is_not_accepted(prepared, field):
    local, _, _, _ = prepared
    connection = local._open()
    try:
        row = dict(connection.execute("SELECT * FROM sub2api_source_extract_scopes").fetchone())
    finally:
        connection.close()
    assert store._verified_scope(row)["task_id"] == row["task_id"]
    row[field] = 99 if field == "connection_revision" else "mismatch"
    with pytest.raises(store.Sub2APISourceExtractConflictError, match="scope is invalid"):
        store._verified_scope(row)


@pytest.mark.parametrize(
    "field", ["approval_id", "project_id", "task_id", "attempt_id", "approval_hash"]
)
def test_denormalized_approval_drift_is_not_accepted(prepared, field):
    local, _, _, _ = prepared
    approval = approve(prepared)
    connection = local._open()
    try:
        row = dict(connection.execute("SELECT * FROM sub2api_call_approvals").fetchone())
    finally:
        connection.close()
    assert store._verified_approval(row) == approval
    row[field] = "mismatch"
    with pytest.raises(store.Sub2APISourceExtractConflictError, match="approval is invalid"):
        store._verified_approval(row)


def test_pending_readback_approval_replay_expiry_and_scheduler_are_read_only(prepared):
    local, created, project_id, now = prepared
    run_id = created.persisted.agent_run.agent_run_id
    pending = local.read_operation(project_id=project_id, run_id=run_id)
    assert pending.content_status == "PENDING"
    assert pending.automatic_retry_allowed is False
    assert local.next_ready(exclude_task_ids=frozenset()) is None
    with pytest.raises(store.Sub2APISourceExtractNotFoundError):
        local.read_approval(project_id=project_id, run_id=run_id)
    approval = approve(prepared)
    assert approve(prepared) == approval
    assert local.read_approval(project_id=project_id, run_id=run_id).status == "APPROVED_ONE_CALL"
    ready = local.next_ready(exclude_task_ids=frozenset())
    assert ready.task_id == created.task.task_id
    assert local.next_ready(exclude_task_ids=frozenset({ready.task_id})) is None
    local._clock = lambda: now + timedelta(minutes=16)
    assert local.read_approval(project_id=project_id, run_id=run_id).status == "EXPIRED"
    assert local.next_ready(exclude_task_ids=frozenset()) is None
    connection = local._open()
    try:
        assert connection.execute("SELECT count(*) FROM sub2api_call_approvals").fetchone()[0] == 1
        assert (
            connection.execute("SELECT count(*) FROM sub2api_call_consumptions").fetchone()[0] == 0
        )
    finally:
        connection.close()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("actor_id", ""),
        ("idempotency_key", " "),
        ("idempotency_key", "x" * 241),
        ("task_id", "task_" + "f" * 32),
        ("expected_attempt_fingerprint", "sha256:" + "f" * 64),
    ],
)
def test_invalid_approval_does_not_leave_a_row(prepared, field, value):
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        approve(prepared, **{field: value})
    connection = prepared[0]._open()
    try:
        assert connection.execute("SELECT count(*) FROM sub2api_call_approvals").fetchone()[0] == 0
    finally:
        connection.close()


@pytest.mark.parametrize("field", ["actor_id", "idempotency_key"])
def test_changed_approval_intent_cannot_reuse_task(prepared, field):
    approve(prepared)
    with pytest.raises(store.Sub2APISourceExtractConflictError, match="intent was reused"):
        approve(prepared, **{field: "different"})


@pytest.mark.parametrize("method", ["read_scope", "read_operation", "read_approval"])
def test_unknown_project_cannot_read_another_projects_scope(prepared, method):
    local, created, _, _ = prepared
    identity = (
        {"task_id": created.task.task_id}
        if method == "read_scope"
        else {"run_id": created.persisted.agent_run.agent_run_id}
    )
    with pytest.raises(
        (store.Sub2APISourceExtractConflictError, store.Sub2APISourceExtractNotFoundError)
    ):
        getattr(local, method)(project_id="prj_" + "f" * 32, **identity)


@pytest.mark.parametrize(
    "value",
    [
        "not JSON",
        "{}",
        "[null]",
        '[{"model_id":"other"}]',
        '[{"model_id":"synthetic","capabilities":null}]',
        '[{"model_id":"synthetic","capabilities":[1]}]',
    ],
)
def test_malformed_model_capabilities_fail_closed(value):
    assert store._model_capabilities({"models_json": value}, "synthetic") == ()


@pytest.mark.parametrize("value", [None, "", "PUBLIC", 1])
def test_invalid_persisted_origin_mode_is_rejected(value):
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        store._persisted_origin_mode(value)


@pytest.mark.parametrize("value", [True, -1, 10**12 + 1, "2"])
def test_usage_count_is_exact_nonnegative_bounded_integer(value):
    payload = response_payload()
    payload["usage"] = {"prompt_tokens": value}
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        validate(payload, usage=(value, None, None))


def test_usage_readback_cannot_invent_or_disagree_with_body_counts():
    payload = response_payload()
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        validate(payload, usage=(1, 2, 3))
    payload["usage"] = {"prompt_tokens": 1}
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        validate(payload, usage=(2, None, None))


def running_claim(prepared):
    local, created, _, now = prepared
    ledger = LocalTaskLedger(local._database_path, clock=lambda: now)
    claim = ledger.claim_remote_task(
        worker_id="synthetic-worker",
        lease_duration=timedelta(minutes=2),
        task_id=created.task.task_id,
        task_kind="sub2api.source.extract",
    )
    assert claim is not None
    return ledger.mark_attempt_running(claim)


def test_consumption_and_unknown_are_idempotent_without_dispatching_any_bytes(prepared):
    local, created, project_id, _ = prepared
    approval = approve(prepared)
    claim = running_claim(prepared)
    permit = local.begin_sub2api_dispatch(claim=claim, approval_id=approval.approval_id)
    run_id = created.persisted.agent_run.agent_run_id
    assert (
        local.read_operation(project_id=project_id, run_id=run_id).content_status
        == "REMOTE_UNKNOWN"
    )
    assert local.read_approval(project_id=project_id, run_id=run_id).status == "CONSUMED"
    with pytest.raises(store.Sub2APISourceExtractConflictError):
        local.begin_sub2api_dispatch(claim=claim, approval_id=approval.approval_id)
    local.quarantine_unknown(permit=permit, provider_response_id=None, code="SYNTHETIC_UNKNOWN")
    local.quarantine_unknown(permit=permit, provider_response_id=None, code="SYNTHETIC_UNKNOWN")
    with pytest.raises(store.Sub2APISourceExtractConflictError, match="different observation"):
        local.quarantine_unknown(
            permit=permit, provider_response_id="other", code="SYNTHETIC_UNKNOWN"
        )
    assert (
        local.read_operation(project_id=project_id, run_id=run_id).automatic_retry_allowed is False
    )
    assert local.next_ready(exclude_task_ids=frozenset()) is None


@pytest.mark.parametrize(
    "field",
    [
        "task_kind",
        "attempt_revision",
        "node_revision",
        "workflow_run_id",
        "lease_token",
        "task_revision",
    ],
)
def test_changed_claim_cannot_consume_approval(prepared, field):
    local, _, _, _ = prepared
    approval = approve(prepared)
    claim = running_claim(prepared)
    value = 999 if field.endswith("revision") else "different"
    with pytest.raises((store.Sub2APISourceExtractConflictError, LeaseLostError)):
        local.begin_sub2api_dispatch(
            claim=replace(claim, **{field: value}), approval_id=approval.approval_id
        )
    connection = local._open()
    try:
        assert (
            connection.execute("SELECT count(*) FROM sub2api_call_consumptions").fetchone()[0] == 0
        )
    finally:
        connection.close()


@pytest.mark.parametrize("field", ["lease_token_hash", "lease_generation", "approval_id"])
def test_changed_permit_cannot_record_unknown(prepared, field):
    local, _, _, _ = prepared
    approval = approve(prepared)
    permit = local.begin_sub2api_dispatch(
        claim=running_claim(prepared), approval_id=approval.approval_id
    )
    changed = (
        replace(permit, claim=replace(permit.claim, lease_generation=999))
        if field == "lease_generation"
        else replace(permit, **{field: "changed"})
    )
    with pytest.raises(store.Sub2APISourceExtractConflictError, match="consumed call"):
        local.quarantine_unknown(
            permit=changed, provider_response_id=None, code="SYNTHETIC_UNKNOWN"
        )


@pytest.mark.parametrize("code", ["", " ", "x" * 121])
def test_invalid_failure_and_quarantine_codes_never_open_database(code):
    local = object.__new__(store.Sub2APISourceExtractStore)
    with pytest.raises(ValueError, match="bounded failure"):
        local.fail_before_dispatch(claim=None, code=code)
    with pytest.raises(ValueError, match="bounded quarantine"):
        local.quarantine_unknown(permit=None, provider_response_id=None, code=code)


@pytest.mark.parametrize("response_id", ["", "x" * 513])
def test_invalid_quarantine_response_id_never_opens_database(response_id):
    local = object.__new__(store.Sub2APISourceExtractStore)
    with pytest.raises(ValueError, match="bounded provider response"):
        local.quarantine_unknown(
            permit=None, provider_response_id=response_id, code="SYNTHETIC_UNKNOWN"
        )
