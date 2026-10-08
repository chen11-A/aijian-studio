"""Provider deletion regression tests use temporary databases and fake secrets only."""

import sqlite3
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from time import monotonic
from uuid import uuid4

import pytest
from aijian_api.credential_vault import (
    CredentialCleanupRequiredError,
    CredentialVaultUnavailableError,
)
from aijian_api.provider_connection_repository import (
    ProviderConnectionConflictError,
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
    ProviderConnectionVersionConflictError,
    ProviderModel,
)
from aijian_api.provider_connections import ProviderConnectionService
from aijian_api.provider_credential_cleanup_schema import PROVIDER_CREDENTIAL_CLEANUP_MIGRATION
from aijian_api.repository import StudioRepository
from test_migrations import migrate_through


class FakeVault:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.reject_delete = False
        self.deletes: list[str] = []

    def set(self, reference: str, secret: str) -> None:
        self.values[reference] = secret

    def get(self, reference: str) -> str | None:
        return self.values.get(reference)

    def delete(self, reference: str) -> None:
        self.deletes.append(reference)
        if self.reject_delete:
            raise CredentialVaultUnavailableError("synthetic outage")
        self.values.pop(reference, None)


def create_service(database: Path, vault: FakeVault) -> ProviderConnectionService:
    StudioRepository(database)
    return ProviderConnectionService(ProviderConnectionRepository(database), vault)


def create_connection(service: ProviderConnectionService) -> str:
    return service.create(
        provider_kind="SUB2API",
        display_name="Synthetic cleanup regression",
        base_url="https://synthetic.invalid",
        enabled=True,
        models=(ProviderModel(model_id="synthetic-model", capabilities=("TEXT",)),),
        api_key="FAKE-SYNTHETIC-ONLY",
    ).connection.id


def test_rotated_provider_delete_removes_original_and_all_rotated_slots(tmp_path: Path) -> None:
    vault = FakeVault()
    service = create_service(tmp_path / "workspace.sqlite3", vault)
    connection_id = create_connection(service)
    for revision in (1, 2):
        service.rotate_sub2api_key(
            connection_id=connection_id,
            expected_revision=revision,
            operation_id=f"pcop_{uuid4().hex}",
            api_key=f"FAKE-ROTATED-{revision}-ONLY",
        )
    assert len(vault.values) == 3
    service.delete(connection_id)
    assert vault.values == {}
    assert service.list() == ()


def test_vault_delete_outage_retains_disabled_retry_target_across_restart(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    vault = FakeVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    vault.reject_delete = True
    with pytest.raises(CredentialCleanupRequiredError):
        service.delete(connection_id)
    recovered = create_service(database, vault)
    retained = recovered.list()
    assert len(retained) == 1
    assert retained[0].connection.id == connection_id
    assert retained[0].connection.enabled is False
    assert retained[0].connection.revision == 2
    assert connection_id in vault.values
    vault.reject_delete = False
    recovered.delete(connection_id)
    assert vault.values == {}
    assert recovered.list() == ()
    with pytest.raises(ProviderConnectionNotFoundError):
        recovered.delete(connection_id)


@pytest.mark.parametrize("status", ["PREPARED", "APPLIED", "CONFLICT", "UNKNOWN"])
def test_cleanup_remembers_candidate_in_every_rotation_state(tmp_path: Path, status: str) -> None:
    database = tmp_path / "workspace.sqlite3"
    vault = FakeVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    repository = ProviderConnectionRepository(database)
    operation_id = f"pcop_{uuid4().hex}"
    candidate = f"{connection_id}:crd_{uuid4().hex}"
    repository.prepare_rotation(
        connection_id=connection_id,
        expected_revision=1,
        operation_id=operation_id,
        candidate_credential_ref=candidate,
    )
    vault.values[candidate] = "FAKE-CANDIDATE-ONLY"
    if status == "APPLIED":
        repository.apply_rotation_cas(
            connection_id=connection_id,
            expected_revision=1,
            operation_id=operation_id,
            old_credential_ref=connection_id,
            candidate_credential_ref=candidate,
        )
    elif status == "UNKNOWN":
        repository.mark_rotation_unknown(operation_id)
    elif status == "CONFLICT":
        current = repository.get(connection_id)
        repository.update_metadata_cas(
            connection_id=connection_id,
            expected_revision=1,
            display_name=current.display_name,
            base_url=current.base_url,
            enabled=True,
            models=current.models,
        )
        with pytest.raises(ProviderConnectionVersionConflictError):
            repository.apply_rotation_cas(
                connection_id=connection_id,
                expected_revision=1,
                operation_id=operation_id,
                old_credential_ref=connection_id,
                candidate_credential_ref=candidate,
            )
    assert repository.get_rotation_operation(operation_id).status == status
    service.delete(connection_id)
    assert set(vault.deletes) == {connection_id, candidate}
    assert vault.values == {}
    with pytest.raises(ProviderConnectionNotFoundError):
        repository.get_rotation_operation(operation_id)


@pytest.mark.parametrize("failure", ["delete", "retained", "readback"])
def test_partial_cleanup_is_retryable_and_does_not_claim_success(
    tmp_path: Path, failure: str
) -> None:
    class PartialVault(FakeVault):
        blocked_ref: str | None = None
        removal_attempted = False

        def delete(self, reference: str) -> None:
            if reference == self.blocked_ref:
                self.removal_attempted = True
                if failure == "delete":
                    raise CredentialVaultUnavailableError("synthetic partial failure")
                if failure == "retained":
                    return
            super().delete(reference)

        def get(self, reference: str) -> str | None:
            if reference == self.blocked_ref and self.removal_attempted and failure == "readback":
                raise CredentialVaultUnavailableError("synthetic readback failure")
            return super().get(reference)

    database = tmp_path / "workspace.sqlite3"
    vault = PartialVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    operation_id = f"pcop_{uuid4().hex}"
    rotated = service.rotate_sub2api_key(
        connection_id=connection_id,
        expected_revision=1,
        operation_id=operation_id,
        api_key="FAKE-CANDIDATE-ONLY",
    )
    vault.blocked_ref = rotated.connection.credential_ref
    for _ in range(2):
        with pytest.raises(CredentialCleanupRequiredError):
            service.delete(connection_id)
        repository = ProviderConnectionRepository(database)
        assert repository.get(connection_id).revision == 3
        assert repository.get(connection_id).enabled is False
        assert repository.get_rotation_operation(operation_id).status == "APPLIED"
        assert connection_id not in vault.values
    vault.blocked_ref = None
    restarted = create_service(database, vault)
    restarted.delete(connection_id)
    assert restarted.list() == ()
    assert vault.values == {}


def test_referenced_provider_rejects_admission_before_touching_any_secret(tmp_path: Path) -> None:
    database = tmp_path / "workspace.sqlite3"
    vault = FakeVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE historical_reference (connection_id TEXT NOT NULL "
            "REFERENCES provider_connections(connection_id))"
        )
        connection.execute("INSERT INTO historical_reference VALUES (?)", (connection_id,))
    with pytest.raises(ProviderConnectionConflictError):
        service.delete(connection_id)
    retained = service.list()[0].connection
    assert retained.enabled is True
    assert retained.revision == 1
    assert vault.deletes == []
    assert connection_id in vault.values
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_cleanup_pending_rejects_reactivation_and_rotation_even_at_new_revision(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    vault = FakeVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    vault.reject_delete = True
    with pytest.raises(CredentialCleanupRequiredError):
        service.delete(connection_id)
    repository = ProviderConnectionRepository(database)
    current = repository.get(connection_id)
    for expected_revision in (1, current.revision):
        with pytest.raises(ProviderConnectionVersionConflictError):
            service.edit_sub2api(
                connection_id=connection_id,
                expected_revision=expected_revision,
                display_name=current.display_name,
                base_url=current.base_url,
                enabled=True,
                models=current.models,
            )
        with pytest.raises(ProviderConnectionVersionConflictError):
            service.rotate_sub2api_key(
                connection_id=connection_id,
                expected_revision=expected_revision,
                operation_id=f"pcop_{uuid4().hex}",
                api_key="FAKE-UNADMITTED-ONLY",
            )
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE provider_connections SET cleanup_pending=0, enabled=1, "
                "revision=revision+1 WHERE connection_id=?",
                (connection_id,),
            )
    assert vault.values == {connection_id: "FAKE-SYNTHETIC-ONLY"}


def test_admitted_rotation_cannot_recreate_slot_after_bounded_delete_timeout(
    tmp_path: Path,
) -> None:
    entered = Event()
    release = Event()

    class StalledWriteVault(FakeVault):
        stall = False

        def set(self, reference: str, secret: str) -> None:
            if self.stall:
                entered.set()
                assert release.wait(10), "test failed to release its synthetic vault writer"
            super().set(reference, secret)

    database = tmp_path / "workspace.sqlite3"
    vault = StalledWriteVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    operation_id = f"pcop_{uuid4().hex}"
    contender = ProviderConnectionService(
        ProviderConnectionRepository(database, credential_lock_timeout_seconds=0.05),
        vault,
    )
    vault.stall = True
    with ThreadPoolExecutor(max_workers=1) as pool:
        writer = pool.submit(
            service.rotate_sub2api_key,
            connection_id=connection_id,
            expected_revision=1,
            operation_id=operation_id,
            api_key="FAKE-STALLED-CANDIDATE-ONLY",
        )
        try:
            assert entered.wait(5)
            started = monotonic()
            with pytest.raises(CredentialCleanupRequiredError):
                contender.delete(connection_id)
            assert monotonic() - started < 2
            repository = ProviderConnectionRepository(database)
            retained = repository.get(connection_id)
            assert retained.enabled is False
            assert retained.revision == 2
            assert repository.get_rotation_operation(operation_id).status == "PREPARED"
            # A blocked keyring call holds no global SQLite writer transaction.
            other = repository.create(
                provider_kind="OLLAMA",
                display_name="Unrelated workspace write",
                base_url="http://127.0.0.1:11434/v1",
                enabled=True,
                models=retained.models,
            )
            assert repository.get(other.id) == other
        finally:
            release.set()
        with pytest.raises(ProviderConnectionVersionConflictError):
            writer.result(timeout=5)
    assert repository.get_rotation_operation(operation_id).status == "CONFLICT"
    contender.delete(connection_id)
    assert not any(reference.startswith(connection_id) for reference in vault.values)
    with pytest.raises(ProviderConnectionNotFoundError):
        repository.get(connection_id)


@pytest.mark.parametrize("fail_step", range(len(PROVIDER_CREDENTIAL_CLEANUP_MIGRATION)))
def test_cleanup_migration_is_atomic_and_preserves_existing_references(
    tmp_path: Path, fail_step: int
) -> None:
    database = tmp_path / "workspace.sqlite3"
    migrate_through(database, 38)
    repository = ProviderConnectionRepository(database)
    current = repository.create(
        provider_kind="OLLAMA",
        display_name="Legacy provider",
        base_url="http://127.0.0.1:11434/v1",
        enabled=True,
        models=(ProviderModel(model_id="synthetic-model", capabilities=("TEXT",)),),
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE historical_reference (connection_id TEXT NOT NULL "
            "REFERENCES provider_connections(connection_id))"
        )
        connection.execute("INSERT INTO historical_reference VALUES (?)", (current.id,))
        before = tuple(connection.iterdump())

    def fail_migration(version: int, step: int) -> None:
        if version == 39 and step == fail_step:
            raise RuntimeError("synthetic migration failure")

    with pytest.raises(RuntimeError, match="synthetic migration failure"):
        StudioRepository(database, migration_hook=fail_migration)
    with sqlite3.connect(database) as connection:
        assert tuple(connection.iterdump()) == before
        assert connection.execute("PRAGMA user_version").fetchone() == (38,)
    StudioRepository(database)
    assert repository.get(current.id) == current
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT cleanup_pending FROM provider_connections"
        ).fetchone() == (0,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("committed", [False, True])
def test_final_commit_acknowledgement_loss_never_claims_delete_success(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    committed: bool,
) -> None:
    database = tmp_path / "workspace.sqlite3"
    vault = FakeVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    repository = service._repository
    original_finish = repository.finish_delete

    class UncertainCommit(sqlite3.Connection):
        def commit(self) -> None:
            if committed:
                super().commit()
            raise sqlite3.OperationalError("synthetic commit acknowledgement loss")

    def fault_connection() -> sqlite3.Connection:
        connection = sqlite3.connect(database, factory=UncertainCommit)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def fault_finish(identifier: str, *, credential_refs: Sequence[str]) -> None:
        with monkeypatch.context() as patch:
            patch.setattr(repository, "_open", fault_connection)
            original_finish(identifier, credential_refs=credential_refs)

    monkeypatch.setattr(repository, "finish_delete", fault_finish)
    with pytest.raises(CredentialCleanupRequiredError):
        service.delete(connection_id)
    assert vault.values == {}
    if committed:
        with pytest.raises(ProviderConnectionNotFoundError):
            repository.get(connection_id)
    else:
        assert repository.get(connection_id).enabled is False
        assert repository.get(connection_id).revision == 2
        monkeypatch.setattr(repository, "finish_delete", original_finish)
        service.delete(connection_id)
        assert service.list() == ()


@pytest.mark.parametrize("error_type", [RuntimeError, KeyboardInterrupt])
def test_unexpected_cleanup_interruption_preserves_durable_identity(
    tmp_path: Path,
    error_type: type[BaseException],
) -> None:
    class InterruptedVault(FakeVault):
        def delete(self, reference: str) -> None:
            super().delete(reference)
            raise error_type("synthetic cleanup interruption")

    database = tmp_path / "workspace.sqlite3"
    vault = InterruptedVault()
    service = create_service(database, vault)
    connection_id = create_connection(service)
    with pytest.raises(error_type):
        service.delete(connection_id)
    restarted = create_service(database, FakeVault())
    retained = restarted.list()[0].connection
    assert retained.id == connection_id
    assert retained.enabled is False
    assert retained.revision == 2
    restarted.delete(connection_id)
    assert restarted.list() == ()


def test_inflight_initial_credential_write_cannot_be_orphaned_by_delete(tmp_path: Path) -> None:
    entered = Event()
    release = Event()

    class StalledInitialVault(FakeVault):
        reference: str | None = None

        def set(self, reference: str, secret: str) -> None:
            self.reference = reference
            entered.set()
            assert release.wait(10), "test failed to release its synthetic initial vault write"
            super().set(reference, secret)

    database = tmp_path / "workspace.sqlite3"
    vault = StalledInitialVault()
    service = create_service(database, vault)
    contender = ProviderConnectionService(
        ProviderConnectionRepository(database, credential_lock_timeout_seconds=0.05),
        vault,
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        writer = pool.submit(create_connection, service)
        try:
            assert entered.wait(5)
            assert vault.reference is not None
            connection_id = vault.reference
            with pytest.raises(CredentialCleanupRequiredError):
                contender.delete(connection_id)
            assert contender.list()[0].connection.enabled is False
        finally:
            release.set()
        assert writer.result(timeout=5) == connection_id
    assert connection_id in vault.values
    contender.delete(connection_id)
    assert vault.values == {}
    assert contender.list() == ()
