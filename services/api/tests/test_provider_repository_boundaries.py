"""Provider metadata transaction and admission guards using temporary real SQLite."""

import sqlite3
from types import SimpleNamespace

import pytest
from aijian_api import provider_connection_repository as provider
from aijian_api.provider_contracts import CPA_LOOPBACK_BASE_URL
from test_provider_connection_runtime_baseline import (
    MODELS,
    apply_rotation,
    create_connection,
    dump_database,
    edit_connection,
    prepare_rotation,
)
from test_provider_connection_runtime_baseline import repository as repository


@pytest.mark.parametrize("timeout", [0, -1, 5.1])
def test_repository_rejects_invalid_lock_timeout_without_opening_database(tmp_path, timeout):
    path = tmp_path / "absent.sqlite3"
    with pytest.raises(ValueError, match="lock timeout"):
        provider.ProviderConnectionRepository(path, credential_lock_timeout_seconds=timeout)
    assert not path.exists()


@pytest.mark.parametrize(
    "changes",
    [
        {"provider_kind": "INVALID"},
        {"display_name": " "},
        {"base_url": ""},
        {"enabled": 1},
        {"models": ()},
        {"models": MODELS * 2},
        {"models": (provider.ProviderModel(" bad ", ("TEXT",)),)},
        {"models": (provider.ProviderModel("ok", ()),)},
        {"models": (provider.ProviderModel("ok", ("TEXT", "TEXT")),)},
        {"models": (provider.ProviderModel("ok", ("INVALID",)),)},
        {"models": (provider.ProviderModel("ok", ("IMAGE",)),)},
        {"provider_kind": "OPENAI", "origin_mode": "PUBLIC_HTTPS"},
        {"provider_kind": "CPA_LOOPBACK", "base_url": "http://localhost:8317"},
    ],
)
def test_invalid_repository_metadata_is_rejected_without_any_write(repository, changes):
    before = dump_database(repository)
    with pytest.raises(ValueError):
        repository.create(
            **{
                "provider_kind": "SUB2API",
                "display_name": "Synthetic",
                "base_url": "https://gateway.example",
                "enabled": True,
                "models": MODELS,
                **changes,
            }
        )
    assert dump_database(repository) == before


def test_internal_sub2api_policy_requires_explicit_origin_at_validation_boundary():
    with pytest.raises(ValueError, match="requires an origin mode"):
        provider._validate_metadata(
            "SUB2API",
            "Synthetic",
            "https://gateway.example",
            True,
            MODELS,
            None,
        )


def test_default_public_mode_and_non_sub2api_edit_preserve_origin_scope(repository):
    public = repository.create(
        provider_kind="SUB2API",
        display_name="Default public",
        base_url="https://gateway.example",
        enabled=True,
        models=MODELS,
    )
    assert public.origin_mode == "PUBLIC_HTTPS"
    updated = repository.update_metadata_cas(
        connection_id=public.id,
        expected_revision=1,
        display_name="Default edited",
        base_url=public.base_url,
        enabled=True,
        models=MODELS,
    )
    assert updated.origin_mode == "PUBLIC_HTTPS" and updated.revision == 2
    local = repository.create(
        provider_kind="CPA_LOOPBACK",
        display_name="CPA",
        base_url=CPA_LOOPBACK_BASE_URL,
        enabled=True,
        models=MODELS,
    )
    changed = repository.update_metadata_cas(
        connection_id=local.id,
        expected_revision=1,
        display_name="CPA changed",
        base_url=local.base_url,
        enabled=False,
        models=MODELS,
    )
    assert changed.origin_mode is None and not changed.enabled


def test_stale_credential_admission_and_delete_do_not_mutate_state(repository):
    current = create_connection(repository)
    before = dump_database(repository)
    for action in (
        lambda: repository.require_credential_write(current.id, 2),
        lambda: repository.delete(current.id, expected_revision=2),
    ):
        with pytest.raises(provider.ProviderConnectionVersionConflictError):
            action()
        assert dump_database(repository) == before
    with pytest.raises(provider.ProviderConnectionConflictError, match="not been admitted"):
        repository.cleanup_credential_refs(current.id)
    with repository._connection() as connection:
        with pytest.raises(provider.ProviderConnectionNotFoundError):
            provider._cleanup_pending(connection, "pcn_" + "f" * 32)
    assert dump_database(repository) == before


@pytest.mark.parametrize("field", ["operation", "connection", "reference"])
def test_invalid_rotation_identifiers_are_rejected_before_writes(repository, field):
    current = create_connection(repository)
    args = {
        "operation_id": "pcop_" + "a" * 32,
        "connection_id": current.id,
        "expected_revision": 1,
        "candidate_credential_ref": current.id + ":crd_" + "b" * 32,
    }
    args[
        {
            "operation": "operation_id",
            "connection": "connection_id",
            "reference": "candidate_credential_ref",
        }[field]
    ] = "bad"
    before = dump_database(repository)
    with pytest.raises(ValueError):
        repository.prepare_rotation(**args)
    assert dump_database(repository) == before


def test_rotation_rejects_stale_revision_reused_slot_and_durable_conflict(repository):
    current = create_connection(repository)
    operation_id, candidate = prepare_rotation(repository, current)
    updated = apply_rotation(repository, current, operation_id, candidate)
    before = dump_database(repository)
    with pytest.raises(provider.ProviderConnectionVersionConflictError):
        repository.prepare_rotation(
            operation_id="pcop_" + "c" * 32,
            connection_id=current.id,
            expected_revision=1,
            candidate_credential_ref=current.id + ":crd_" + "c" * 32,
        )
    with pytest.raises(ValueError, match="new credential reference"):
        repository.prepare_rotation(
            operation_id="pcop_" + "d" * 32,
            connection_id=current.id,
            expected_revision=2,
            candidate_credential_ref=candidate,
        )
    assert dump_database(repository) == before
    second_operation, second_candidate = prepare_rotation(repository, updated)
    edit_connection(repository, updated)
    for _ in range(2):
        with pytest.raises(provider.ProviderConnectionVersionConflictError):
            apply_rotation(repository, updated, second_operation, second_candidate)
    assert repository.get_rotation_operation(second_operation).status == "CONFLICT"
    assert repository.get(current.id).credential_ref == candidate


def test_cleanup_ref_change_does_not_delete_metadata_or_history(repository):
    current = create_connection(repository)
    repository.prepare_delete(current.id)
    before = dump_database(repository)
    with pytest.raises(provider.ProviderConnectionVersionConflictError, match="references changed"):
        repository.finish_delete(current.id, credential_refs=("wrong",))
    assert dump_database(repository) == before
    assert not repository.get(current.id).enabled


def test_zero_row_metadata_cas_does_not_commit_a_partial_change(repository, monkeypatch):
    current = create_connection(repository)
    before = dump_database(repository)

    class LostCas(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            if "UPDATE provider_connections" in sql:
                return SimpleNamespace(rowcount=0)
            return super().execute(sql, parameters)

    def open_fault():
        connection = sqlite3.connect(repository._database_path, factory=LostCas)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    with monkeypatch.context() as patch:
        patch.setattr(repository, "_open", open_fault)
        with pytest.raises(provider.ProviderConnectionVersionConflictError):
            edit_connection(repository, current)
    assert dump_database(repository) == before


@pytest.mark.parametrize(
    "action",
    [
        "create",
        "edit",
        "prepare-rotation",
        "mark-unknown",
        "delete",
        "prepare-delete",
        "cleanup-refs",
        "finish-delete",
    ],
)
@pytest.mark.parametrize("error_type", [sqlite3.IntegrityError, sqlite3.OperationalError])
def test_failed_database_commit_rolls_back_and_preserves_error_category(
    repository, monkeypatch, action, error_type
):
    current = create_connection(repository)
    operation_id, _ = prepare_rotation(repository, current)
    if action in {"cleanup-refs", "finish-delete"}:
        repository.prepare_delete(current.id)
    before = dump_database(repository)
    attempts = []

    class FailedCommit(sqlite3.Connection):
        def commit(self):
            attempts.append("commit")
            raise error_type("synthetic database failure")

    def open_fault():
        connection = sqlite3.connect(repository._database_path, factory=FailedCommit)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    actions = {
        "create": lambda: create_connection(repository, name="Other"),
        "edit": lambda: edit_connection(repository, current),
        "prepare-rotation": lambda: prepare_rotation(repository, current),
        "mark-unknown": lambda: repository.mark_rotation_unknown(operation_id),
        "delete": lambda: repository.delete(current.id),
        "prepare-delete": lambda: repository.prepare_delete(current.id),
        "cleanup-refs": lambda: repository.cleanup_credential_refs(current.id),
        "finish-delete": lambda: repository.finish_delete(
            current.id, credential_refs=repository.cleanup_credential_refs(current.id)
        ),
    }
    if action == "finish-delete":
        refs = repository.cleanup_credential_refs(current.id)
        actions[action] = lambda: repository.finish_delete(current.id, credential_refs=refs)
    expected = (
        provider.ProviderConnectionConflictError
        if error_type is sqlite3.IntegrityError and action != "mark-unknown"
        else provider.ProviderConnectionWriteUnknownError
    )
    with monkeypatch.context() as patch:
        patch.setattr(repository, "_open", open_fault)
        with pytest.raises(expected):
            actions[action]()
    assert attempts == ["commit"]
    assert dump_database(repository) == before
