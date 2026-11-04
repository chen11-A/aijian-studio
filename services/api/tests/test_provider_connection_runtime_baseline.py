"""Runtime-baseline regression tests, with temporary databases and fake keys only."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from aijian_api.agent_skill_builtins import sub2api_source_extract_registry
from aijian_api.credential_vault import CredentialVaultUnavailableError
from aijian_api.main import create_app
from aijian_api.provider_connection_repository import (
    ProviderConnection,
    ProviderConnectionConflictError,
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
    ProviderConnectionVersionConflictError,
    ProviderConnectionWriteUnknownError,
    ProviderModel,
    ProviderRotationOperationExistsError,
)
from aijian_api.provider_connections import ProviderConnectionService
from aijian_api.provider_contracts import MAX_EXPECTED_REVISION, Sub2APIOriginMode
from aijian_api.repository import StudioRepository
from aijian_api.sub2api_source_extract_contracts import CreateSub2APISourceExtractRunRequest
from aijian_api.sub2api_source_extract_run_factory import Sub2APISourceExtractRunFactory
from aijian_api.sub2api_source_extract_store import (
    Sub2APISourceExtractConflictError,
    Sub2APISourceExtractStore,
)
from aijian_api.task_ledger import LocalTaskLedger
from fastapi.testclient import TestClient
from test_proposal_run_create_api import accepted_source, create_payload, sidecar_client

MODELS = (ProviderModel(model_id="fake-text-model", capabilities=("TEXT",)),)
NOW = datetime(2026, 10, 8, tzinfo=UTC)


@pytest.fixture
def repository(tmp_path: Path) -> ProviderConnectionRepository:
    database = tmp_path / "provider-baseline.sqlite3"
    StudioRepository(database)
    return ProviderConnectionRepository(database, clock=lambda: NOW)


def create_connection(
    repository: ProviderConnectionRepository,
    *,
    name: str = "Test Sub2API",
    origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS",
) -> ProviderConnection:
    return repository.create(
        provider_kind="SUB2API",
        display_name=name,
        base_url=(
            "http://127.0.0.1:8000"
            if origin_mode == "LOCAL_LOOPBACK_HTTP"
            else "https://gateway.example"
        ),
        origin_mode=origin_mode,
        enabled=True,
        models=MODELS,
    )


def edit_connection(
    repository: ProviderConnectionRepository,
    current: ProviderConnection,
    *,
    origin_mode: Sub2APIOriginMode | None = "PUBLIC_HTTPS",
    base_url: str = "https://changed.example",
) -> ProviderConnection:
    return repository.update_metadata_cas(
        connection_id=current.id,
        expected_revision=current.revision,
        display_name=current.display_name,
        base_url=base_url,
        origin_mode=origin_mode,
        enabled=current.enabled,
        models=current.models,
    )


def prepare_rotation(
    repository: ProviderConnectionRepository, current: ProviderConnection
) -> tuple[str, str]:
    operation_id = f"pcop_{uuid4().hex}"
    candidate_ref = f"{current.id}:crd_{uuid4().hex}"
    repository.prepare_rotation(
        operation_id=operation_id,
        connection_id=current.id,
        expected_revision=current.revision,
        candidate_credential_ref=candidate_ref,
    )
    return operation_id, candidate_ref


def apply_rotation(
    repository: ProviderConnectionRepository,
    current: ProviderConnection,
    operation_id: str,
    candidate_ref: str,
) -> ProviderConnection:
    return repository.apply_rotation_cas(
        operation_id=operation_id,
        connection_id=current.id,
        expected_revision=current.revision,
        old_credential_ref=current.credential_ref,
        candidate_credential_ref=candidate_ref,
    )


def dump_database(repository: ProviderConnectionRepository) -> str:
    with repository._open() as connection:
        return "\n".join(connection.iterdump())


def test_metadata_cas_preserves_credentials_and_reopens_local_mode(repository) -> None:
    current = create_connection(repository)
    assert current.credential_ref == current.id
    local = edit_connection(
        repository,
        current,
        origin_mode="LOCAL_LOOPBACK_HTTP",
        base_url="http://[::1]:8001",
    )
    assert local.revision == current.revision + 1
    assert local.credential_ref == current.credential_ref
    assert local.created_at == current.created_at
    assert local.origin_mode == "LOCAL_LOOPBACK_HTTP"
    reopened = ProviderConnectionRepository(repository._database_path)
    assert reopened.get(current.id) == local
    assert reopened.list() == (local,)
    before = dump_database(repository)
    with pytest.raises(ProviderConnectionVersionConflictError):
        edit_connection(repository, current)
    assert dump_database(repository) == before


def test_local_mode_cannot_be_implicitly_downgraded(repository) -> None:
    current = create_connection(repository, origin_mode="LOCAL_LOOPBACK_HTTP")
    before = dump_database(repository)
    with pytest.raises(ValueError, match="requires origin_mode"):
        edit_connection(repository, current, origin_mode=None)
    assert dump_database(repository) == before
    public = edit_connection(repository, current)
    assert public.origin_mode == "PUBLIC_HTTPS"
    assert public.revision == 2


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000",
        "http://127.0.0.1",
        "http://127.0.0.1:08000",
        "http://127.0.0.1:8000/",
        "http://127.0.0.1:0",
        "http://127.0.0.1:65536",
        "http://10.0.0.1:8000",
        "http://[::ffff:127.0.0.1]:8000",
        "http://127.0.0.1:8000?",
        "http://127.0.0.1:8000#",
        "http://user@127.0.0.1:8000",
        "http://127.0.0.1:8000/path",
    ],
)
def test_repository_rejects_noncanonical_local_origin_without_mutation(repository, url) -> None:
    current = create_connection(repository)
    before = dump_database(repository)
    with pytest.raises(ValueError):
        edit_connection(repository, current, origin_mode="LOCAL_LOOPBACK_HTTP", base_url=url)
    assert dump_database(repository) == before


@pytest.mark.parametrize("revision", [True, False, 0, -1, 1.0, "1", MAX_EXPECTED_REVISION + 1])
def test_repository_rejects_invalid_cas_revision_without_mutation(repository, revision) -> None:
    current = create_connection(repository)
    before = dump_database(repository)
    with pytest.raises(ValueError, match="revision"):
        repository.update_metadata_cas(
            connection_id=current.id,
            expected_revision=revision,
            display_name=current.display_name,
            base_url=current.base_url,
            enabled=True,
            models=MODELS,
        )
    assert dump_database(repository) == before


def test_duplicate_metadata_edit_is_atomic(repository) -> None:
    current = create_connection(repository)
    create_connection(repository, name="Already used")
    before = dump_database(repository)
    with pytest.raises(ProviderConnectionConflictError):
        repository.update_metadata_cas(
            connection_id=current.id,
            expected_revision=current.revision,
            display_name="ALREADY USED",
            base_url="http://127.0.0.1:8000",
            enabled=False,
            models=MODELS,
            origin_mode="LOCAL_LOOPBACK_HTTP",
        )
    assert dump_database(repository) == before


def test_concurrent_metadata_cas_has_one_winner(repository) -> None:
    current = create_connection(repository)
    barrier = Barrier(2)

    def edit() -> str:
        barrier.wait()
        try:
            edit_connection(repository, current)
        except ProviderConnectionVersionConflictError:
            return "conflict"
        return "updated"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: edit(), range(2)))
    assert sorted(results) == ["conflict", "updated"]
    assert repository.get(current.id).revision == 2


def test_rotation_applies_one_revision_and_keeps_identity_on_reopen(repository) -> None:
    current = create_connection(repository, origin_mode="LOCAL_LOOPBACK_HTTP")
    operation_id, candidate = prepare_rotation(repository, current)
    prepared = repository.get_rotation_operation(operation_id)
    assert prepared.status == "PREPARED"
    assert prepared.applied_revision is None
    updated = apply_rotation(repository, current, operation_id, candidate)
    assert updated.credential_ref == candidate
    assert updated.revision == current.revision + 1
    assert updated.origin_mode == current.origin_mode
    assert updated.base_url == current.base_url
    reopened = ProviderConnectionRepository(repository._database_path)
    assert reopened.get(current.id) == updated
    operation = reopened.get_rotation_operation(operation_id)
    assert operation.status == "APPLIED"
    assert operation.applied_revision == updated.revision
    before = dump_database(repository)
    repository.mark_rotation_unknown(operation_id)
    with pytest.raises(ProviderRotationOperationExistsError):
        apply_rotation(repository, current, operation_id, candidate)
    with pytest.raises(ProviderRotationOperationExistsError):
        repository.prepare_rotation(
            operation_id=operation_id,
            connection_id=current.id,
            expected_revision=updated.revision,
            candidate_credential_ref=f"{current.id}:crd_{uuid4().hex}",
        )
    assert dump_database(repository) == before


@pytest.mark.parametrize("change", ["revision", "credential"])
def test_rotation_conflict_is_durable_without_overwriting_newer_state(repository, change) -> None:
    current = create_connection(repository)
    operation_id, candidate = prepare_rotation(repository, current)
    if change == "revision":
        newer = edit_connection(repository, current)
    else:
        newer = current
    with pytest.raises(ProviderConnectionVersionConflictError):
        repository.apply_rotation_cas(
            operation_id=operation_id,
            connection_id=current.id,
            expected_revision=current.revision,
            old_credential_ref=(
                current.credential_ref
                if change == "revision"
                else f"{current.id}:crd_{uuid4().hex}"
            ),
            candidate_credential_ref=candidate,
        )
    assert repository.get(current.id) == newer
    assert repository.get_rotation_operation(operation_id).status == "CONFLICT"
    repository.mark_rotation_unknown(operation_id)
    assert repository.get_rotation_operation(operation_id).status == "CONFLICT"


def test_rotation_identity_mismatch_cannot_write_another_slot(repository) -> None:
    current = create_connection(repository)
    operation_id, candidate = prepare_rotation(repository, current)
    before = dump_database(repository)
    with pytest.raises(ValueError, match="identity"):
        apply_rotation(repository, current, operation_id, f"{current.id}:crd_{uuid4().hex}")
    assert dump_database(repository) == before
    assert repository.get_rotation_operation(operation_id).candidate_credential_ref == candidate


@pytest.mark.parametrize("committed", [False, True])
def test_uncertain_rotation_commit_requires_readback(repository, monkeypatch, committed) -> None:
    current = create_connection(repository)
    operation_id, candidate = prepare_rotation(repository, current)

    class UncertainCommit(sqlite3.Connection):
        def commit(self) -> None:
            if committed:
                super().commit()
            raise sqlite3.OperationalError("injected commit result loss")

    def fault_connection() -> sqlite3.Connection:
        connection = sqlite3.connect(repository._database_path, factory=UncertainCommit)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    with monkeypatch.context() as patch:
        patch.setattr(repository, "_open", fault_connection)
        with pytest.raises(ProviderConnectionWriteUnknownError):
            apply_rotation(repository, current, operation_id, candidate)
    repository.mark_rotation_unknown(operation_id)
    state = repository.get(current.id)
    operation = repository.get_rotation_operation(operation_id)
    assert operation.status == ("APPLIED" if committed else "UNKNOWN")
    assert state.revision == (2 if committed else 1)
    assert state.credential_ref == (candidate if committed else current.credential_ref)


def test_rotation_outcome_failure_rolls_back_credential_reference(repository) -> None:
    current = create_connection(repository)
    operation_id, candidate = prepare_rotation(repository, current)
    with repository._open() as connection:
        connection.execute("""
            CREATE TRIGGER fail_rotation_outcome BEFORE UPDATE
            ON provider_credential_rotation_operations WHEN NEW.status = 'APPLIED'
            BEGIN SELECT RAISE(ABORT, 'injected outcome failure'); END
        """)
    before = dump_database(repository)
    with pytest.raises(ProviderConnectionConflictError):
        apply_rotation(repository, current, operation_id, candidate)
    assert dump_database(repository) == before


def test_delete_rotated_connection_and_restrict_external_reference(repository) -> None:
    current = create_connection(repository)
    operation_id, candidate = prepare_rotation(repository, current)
    apply_rotation(repository, current, operation_id, candidate)
    with repository._open() as connection:
        connection.execute("""
            CREATE TABLE test_provider_reference (
                connection_id TEXT REFERENCES provider_connections(connection_id)
            )
        """)
        connection.execute("INSERT INTO test_provider_reference VALUES (?)", (current.id,))
    before = dump_database(repository)
    with pytest.raises(ProviderConnectionConflictError):
        repository.delete(current.id)
    assert dump_database(repository) == before
    with repository._open() as connection:
        connection.execute("DELETE FROM test_provider_reference")
    repository.delete(current.id)
    with pytest.raises(ProviderConnectionNotFoundError):
        repository.get(current.id)
    with pytest.raises(ProviderConnectionNotFoundError):
        repository.get_rotation_operation(operation_id)
    with repository._open() as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


class FakeVault:
    def __init__(self, *, fail: bool = False) -> None:
        self.values: dict[str, str] = {}
        self.writes: list[str] = []
        self.fail = fail

    def set(self, reference: str, key: str) -> None:
        self.writes.append(reference)
        self.values[reference] = key
        if self.fail:
            raise CredentialVaultUnavailableError("fake write uncertainty")

    def get(self, reference: str) -> str | None:
        return self.values.get(reference)

    def delete(self, reference: str) -> None:
        self.values.pop(reference, None)


def test_service_unknown_does_not_repeat_vault_write(repository) -> None:
    current = create_connection(repository)
    vault = FakeVault(fail=True)
    vault.values[current.credential_ref] = "fake-original-key"
    service = ProviderConnectionService(repository, vault)
    operation_id = f"pcop_{uuid4().hex}"
    with pytest.raises(CredentialVaultUnavailableError):
        service.rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=current.revision,
            operation_id=operation_id,
            api_key="fake-candidate-key",
        )
    assert repository.get_rotation_operation(operation_id).status == "UNKNOWN"
    with pytest.raises(ProviderRotationOperationExistsError):
        service.rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=current.revision,
            operation_id=operation_id,
            api_key="fake-candidate-key",
        )
    assert len(vault.writes) == 1
    assert repository.get(current.id) == current
    assert "fake-candidate-key" not in dump_database(repository)


@pytest.mark.parametrize(
    "mutation",
    [
        "public_to_local",
        "local_to_public",
        "public_origin",
        "local_port",
        "public_credential",
        "local_credential",
        "unchanged",
    ],
)
def test_actual_approval_consumption_rechecks_persisted_provider_binding(
    tmp_path, mutation
) -> None:
    # Exercise the real queue, source approval, task claim, and atomic consume
    # transaction. No provider worker or transport is constructed in this test.
    client, studio = sidecar_client(tmp_path)
    test_now = datetime.now(UTC) + timedelta(seconds=5)
    source = accepted_source(client)
    connections = ProviderConnectionRepository(studio.database_path, clock=lambda: test_now)
    initial_local = mutation in {"local_to_public", "local_port", "local_credential"}
    current = create_connection(
        connections,
        origin_mode="LOCAL_LOOPBACK_HTTP" if initial_local else "PUBLIC_HTTPS",
    )
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
                "connection_id": current.id,
                "connection_revision": current.revision,
                "model_id": MODELS[0].model_id,
            },
            "source": source_payload,
        }
    )
    factory = Sub2APISourceExtractRunFactory(
        studio,
        sub2api_source_extract_registry(),
        clock=lambda: test_now,
    )
    created = factory.create(
        project_id=source[0],
        payload=payload,
        idempotency_key="fake-consume-binding-test",
    )
    store = Sub2APISourceExtractStore(studio.database_path, clock=lambda: test_now)
    approval = store.issue_approval(
        project_id=source[0],
        task_id=created.task.task_id,
        attempt_id=created.task.attempt_id,
        expected_attempt_fingerprint=created.attempt.attempt_fingerprint,
        actor_id="fake-test-user",
        idempotency_key="fake-approval-once",
    )
    ledger = LocalTaskLedger(studio.database_path, clock=lambda: test_now)
    claim = ledger.claim_remote_task(
        worker_id="fake-consume-test",
        lease_duration=timedelta(minutes=2),
        task_id=created.task.task_id,
        task_kind="sub2api.source.extract",
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    if mutation in {"public_credential", "local_credential"}:
        operation_id, candidate = prepare_rotation(connections, current)
        apply_rotation(connections, current, operation_id, candidate)
    elif mutation != "unchanged":
        local = mutation in {"public_to_local", "local_port"}
        edit_connection(
            connections,
            current,
            origin_mode="LOCAL_LOOPBACK_HTTP" if local else "PUBLIC_HTTPS",
            base_url="http://127.0.0.1:8001" if local else "https://changed.example",
        )
    if mutation == "unchanged":
        permit = store.begin_sub2api_dispatch(claim=running, approval_id=approval.approval_id)
        assert permit.connection_revision == current.revision
        assert permit.origin_mode == current.origin_mode
        with connections._open() as database:
            assert (
                database.execute("SELECT COUNT(*) FROM sub2api_call_consumptions").fetchone()[0]
                == 1
            )
        return
    before = dump_database(connections)
    with pytest.raises(Sub2APISourceExtractConflictError, match="APPROVAL_SCOPE_MISMATCH"):
        store.begin_sub2api_dispatch(claim=running, approval_id=approval.approval_id)
    assert dump_database(connections) == before
    # A fresh store/profile still rejects the old approval; no consume or dispatch
    # started timestamp is allowed to escape the rejected transaction.
    reopened = Sub2APISourceExtractStore(studio.database_path, clock=lambda: test_now)
    with pytest.raises(Sub2APISourceExtractConflictError, match="APPROVAL_SCOPE_MISMATCH"):
        reopened.begin_sub2api_dispatch(claim=running, approval_id=approval.approval_id)
    assert dump_database(connections) == before
    with connections._open() as database:
        assert database.execute("SELECT COUNT(*) FROM sub2api_call_consumptions").fetchone()[0] == 0
        assert database.execute(
            "SELECT status, dispatch_started_at FROM workflow_attempts WHERE attempt_id = ?",
            (running.attempt_id,),
        ).fetchone()[:] == ("RUNNING", None)


@pytest.mark.parametrize("origin_mode", ["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"])
def test_api_edit_rotation_receipts_are_revisioned_and_do_not_expose_vault_refs(
    tmp_path,
    origin_mode,
) -> None:
    database = tmp_path / "provider-api.sqlite3"
    studio = StudioRepository(database)
    vault = FakeVault()
    client = TestClient(create_app(repository=studio, credential_vault=vault))
    base_url = (
        "http://127.0.0.1:8000"
        if origin_mode == "LOCAL_LOOPBACK_HTTP"
        else "https://gateway.example"
    )
    created = client.post(
        "/api/v1/provider-connections",
        json={
            "provider_kind": "SUB2API",
            "display_name": "Fake API provider",
            "base_url": base_url,
            "origin_mode": origin_mode,
            "models": [{"model_id": MODELS[0].model_id, "capabilities": ["TEXT"]}],
            "api_key": "fake-original-key",
        },
    )
    assert created.status_code == 201
    connection_id = created.json()["data"]["id"]
    path = f"/api/v1/provider-connections/{connection_id}"
    updated = client.patch(
        path,
        json={
            "expected_revision": 1,
            "display_name": "Fake renamed provider",
            "base_url": base_url,
            "origin_mode": origin_mode,
            "enabled": True,
            "models": [{"model_id": MODELS[0].model_id, "capabilities": ["TEXT"]}],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["revision"] == 2
    assert len(vault.writes) == 1
    operation_id = f"pcop_{uuid4().hex}"
    rotation_payload = {
        "expected_revision": 2,
        "operation_id": operation_id,
        "api_key": "fake-new-key",
    }
    rotated = client.post(f"{path}/credential-rotations", json=rotation_payload)
    assert rotated.status_code == 200
    assert rotated.json()["data"]["revision"] == 3
    assert rotated.json()["data"]["origin_mode"] == origin_mode
    assert rotated.json()["data"]["credential_status"] == "CONFIGURED"
    operation = client.get(f"{path}/credential-rotations/{operation_id}")
    assert operation.status_code == 200
    assert operation.json()["data"]["status"] == "APPLIED"
    assert operation.json()["data"]["applied_revision"] == 3
    replay = client.post(f"{path}/credential-rotations", json=rotation_payload)
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "PROVIDER_ROTATION_OPERATION_EXISTS"
    stale = client.post(
        f"{path}/credential-rotations",
        json={
            **rotation_payload,
            "operation_id": f"pcop_{uuid4().hex}",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "PROVIDER_CONNECTION_REVISION_CONFLICT"
    assert len(vault.writes) == 2
    repository = ProviderConnectionRepository(database)
    active_ref = repository.get(connection_id).credential_ref
    assert active_ref != connection_id
    assert vault.values[active_ref] == "fake-new-key"
    assert vault.values[connection_id] == "fake-original-key"
    public_responses = " ".join(
        response.text
        for response in (
            created,
            updated,
            rotated,
            operation,
            replay,
            stale,
            client.get("/api/v1/provider-connections"),
        )
    )
    for forbidden in ("fake-original-key", "fake-new-key", active_ref, "credential_ref", "api_key"):
        assert forbidden not in public_responses
    stored = dump_database(repository)
    assert "fake-original-key" not in stored
    assert "fake-new-key" not in stored


def test_repository_closes_handles_after_success_and_rejected_transactions(repository, monkeypatch):
    opened: list[sqlite3.Connection] = []
    real_open = repository._open

    def track_connection() -> sqlite3.Connection:
        connection = real_open()
        opened.append(connection)
        return connection

    monkeypatch.setattr(repository, "_open", track_connection)
    current = create_connection(repository)
    assert repository.get(current.id) == current
    assert repository.list() == (current,)
    with pytest.raises(ProviderConnectionConflictError):
        create_connection(repository)
    with pytest.raises(ProviderConnectionNotFoundError):
        repository.get(f"pcn_{uuid4().hex}")
    edit_connection(repository, current)
    with pytest.raises(ProviderConnectionVersionConflictError):
        edit_connection(repository, current)
    for connection in opened:
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            connection.execute("SELECT 1")
