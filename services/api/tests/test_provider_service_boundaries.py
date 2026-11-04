"""Synthetic-vault failures retain readback identity without repeating secret writes."""

from uuid import uuid4

import pytest
from aijian_api.credential_vault import CredentialVaultUnavailableError
from aijian_api.provider_connection_repository import (
    ProviderConnectionConflictError,
    ProviderConnectionNotFoundError,
    ProviderConnectionVersionConflictError,
    ProviderConnectionWriteUnknownError,
    ProviderRotationOperationExistsError,
)
from aijian_api.provider_connections import ProviderConnectionService
from test_provider_connection_runtime_baseline import (
    MODELS,
    FakeVault,
    create_connection,
    dump_database,
    edit_connection,
    prepare_rotation,
)
from test_provider_connection_runtime_baseline import repository as repository


@pytest.mark.parametrize("provider_kind", ["SUB2API", "CPA_LOOPBACK"])
@pytest.mark.parametrize("key", [None, "short", "contains space", "x" * 8193])
def test_dedicated_credential_policy_fails_before_metadata_or_vault_write(
    repository, provider_kind, key
):
    vault = FakeVault()
    service = ProviderConnectionService(repository, vault)
    before = dump_database(repository)
    with pytest.raises(ValueError, match="dedicated"):
        service.create(
            provider_kind=provider_kind,
            display_name="Synthetic",
            base_url="https://gateway.example",
            enabled=True,
            models=MODELS,
            api_key=key,
        )
    assert dump_database(repository) == before
    assert vault.writes == []


def test_service_does_not_accept_sub2api_mode_for_another_provider(repository):
    vault = FakeVault()
    with pytest.raises(ValueError, match="only valid for Sub2API"):
        ProviderConnectionService(repository, vault).create(
            provider_kind="OPENAI",
            display_name="Synthetic",
            base_url="https://api.openai.com/v1",
            enabled=True,
            models=MODELS,
            api_key="synthetic-key",
            origin_mode="PUBLIC_HTTPS",
        )
    assert repository.list() == () and vault.writes == []


def test_failed_new_credential_cannot_delete_a_concurrently_edited_connection(repository):
    class UnavailableVault(FakeVault):
        def set(self, reference, key):
            current = repository.get(reference)
            edit_connection(repository, current)
            self.writes.append(reference)
            raise CredentialVaultUnavailableError("synthetic offline vault")

    vault = UnavailableVault()
    service = ProviderConnectionService(repository, vault)
    with pytest.raises(CredentialVaultUnavailableError):
        service.create(
            provider_kind="SUB2API",
            display_name="Synthetic",
            base_url="https://gateway.example",
            enabled=True,
            models=MODELS,
            api_key="synthetic-key",
        )
    assert len(vault.writes) == 1
    assert repository.list()[0].revision == 2
    assert "synthetic-key" not in dump_database(repository)


def test_local_connection_edit_requires_explicit_mode_before_any_write(repository):
    current = create_connection(repository, origin_mode="LOCAL_LOOPBACK_HTTP")
    before = dump_database(repository)
    service = ProviderConnectionService(repository, FakeVault())
    with pytest.raises(ValueError, match="explicit origin_mode"):
        service.edit_sub2api(
            connection_id=current.id,
            expected_revision=1,
            display_name=current.display_name,
            base_url="https://gateway.example",
            enabled=True,
            models=MODELS,
        )
    assert dump_database(repository) == before


@pytest.mark.parametrize("key", ["short", "synthetic key", "x" * 8193])
def test_invalid_rotation_key_does_not_reserve_an_operation_or_write_vault(repository, key):
    current = create_connection(repository)
    vault = FakeVault()
    before = dump_database(repository)
    with pytest.raises(ValueError, match="dedicated"):
        ProviderConnectionService(repository, vault).rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=1,
            operation_id="pcop_" + uuid4().hex,
            api_key=key,
        )
    assert dump_database(repository) == before and vault.writes == []


def test_stale_rotation_and_cross_connection_readback_fail_without_vault_access(repository):
    current = create_connection(repository)
    operation_id, _ = prepare_rotation(repository, current)
    vault = FakeVault()
    service = ProviderConnectionService(repository, vault)
    with pytest.raises(ProviderConnectionVersionConflictError):
        service.rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=2,
            operation_id="pcop_" + uuid4().hex,
            api_key="synthetic-key",
        )
    with pytest.raises(ProviderConnectionNotFoundError):
        service.get_rotation_operation(connection_id="pcn_" + "f" * 32, operation_id=operation_id)
    assert vault.writes == []


def test_vault_acknowledgement_without_retained_key_stays_unknown(repository):
    class DroppingVault(FakeVault):
        def set(self, reference, key):
            self.writes.append(reference)

    current = create_connection(repository)
    vault = DroppingVault()
    service = ProviderConnectionService(repository, vault)
    operation_id = "pcop_" + uuid4().hex
    with pytest.raises(CredentialVaultUnavailableError, match="did not retain"):
        service.rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=1,
            operation_id=operation_id,
            api_key="synthetic-key",
        )
    operation = repository.get_rotation_operation(operation_id)
    assert operation.status == "UNKNOWN"
    assert repository.get(current.id) == current
    assert vault.writes == [operation.candidate_credential_ref]


@pytest.mark.parametrize("failure", ["conflict", "write-unknown", "mark-unknown-fails"])
def test_rotation_database_failure_is_readback_only_and_vault_write_is_single_attempt(
    repository, monkeypatch, failure
):
    current = create_connection(repository)
    vault = FakeVault()
    service = ProviderConnectionService(repository, vault)
    operation_id = "pcop_" + uuid4().hex

    def fail_apply(**kwargs):
        if failure == "conflict":
            raise ProviderConnectionConflictError("synthetic conflict")
        raise ProviderConnectionWriteUnknownError("synthetic uncertain commit")

    monkeypatch.setattr(repository, "apply_rotation_cas", fail_apply)
    if failure == "mark-unknown-fails":

        def fail_mark(_operation_id):
            raise ProviderConnectionWriteUnknownError("synthetic outcome-write uncertainty")

        monkeypatch.setattr(repository, "mark_rotation_unknown", fail_mark)
    with pytest.raises(ProviderConnectionWriteUnknownError):
        service.rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=1,
            operation_id=operation_id,
            api_key="synthetic-key",
        )
    saved = service.get_rotation_operation(connection_id=current.id, operation_id=operation_id)
    assert saved.status == ("PREPARED" if failure == "mark-unknown-fails" else "UNKNOWN")
    assert repository.get(current.id) == current
    with pytest.raises(ProviderRotationOperationExistsError):
        service.rotate_sub2api_key(
            connection_id=current.id,
            expected_revision=1,
            operation_id=operation_id,
            api_key="synthetic-key",
        )
    assert vault.writes == [saved.candidate_credential_ref]
    assert "synthetic-key" not in dump_database(repository)
