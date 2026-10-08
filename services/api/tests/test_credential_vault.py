from collections.abc import Callable

import pytest
from aijian_api import credential_vault
from aijian_api.credential_vault import (
    CredentialCleanupRequiredError,
    CredentialVaultUnavailableError,
    SystemCredentialVault,
)
from keyring.errors import KeyringError


class FailingKeyringError(KeyringError):
    pass


def test_system_vault_sets_reads_and_deletes_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    secrets: dict[tuple[str, str], str] = {}
    monkeypatch.setattr(
        credential_vault.keyring,
        "set_password",
        lambda service, username, secret: secrets.__setitem__((service, username), secret),
    )
    monkeypatch.setattr(
        credential_vault.keyring,
        "get_password",
        lambda service, username: secrets.get((service, username)),
    )
    monkeypatch.setattr(
        credential_vault.keyring,
        "delete_password",
        lambda service, username: secrets.pop((service, username)),
    )
    vault = SystemCredentialVault()

    vault.set("pcn_test", "secret-value")
    assert vault.get("pcn_test") == "secret-value"
    vault.delete("pcn_test")
    assert vault.get("pcn_test") is None
    vault.delete("pcn_test")


@pytest.mark.parametrize("operation", ["get", "delete"])
def test_system_vault_maps_backend_errors(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    def fail(*_args: str) -> str:
        raise FailingKeyringError("backend details must not escape")

    monkeypatch.setattr(credential_vault.keyring, "get_password", fail)
    monkeypatch.setattr(credential_vault.keyring, "set_password", fail)
    monkeypatch.setattr(credential_vault.keyring, "delete_password", fail)
    vault = SystemCredentialVault()
    actions: dict[str, Callable[[], object]] = {
        "get": lambda: vault.get("pcn_test"),
        "delete": lambda: vault.delete("pcn_test"),
    }

    with pytest.raises(CredentialVaultUnavailableError, match="credential backend"):
        actions[operation]()


def test_system_vault_cleans_up_when_set_reports_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted: list[str] = []

    def fail_set(*_args: str) -> None:
        raise FailingKeyringError("write acknowledgement failed")

    monkeypatch.setattr(credential_vault.keyring, "set_password", fail_set)
    monkeypatch.setattr(
        credential_vault.keyring,
        "delete_password",
        lambda _service, username: deleted.append(username),
    )

    with pytest.raises(CredentialVaultUnavailableError, match="backend is unavailable"):
        SystemCredentialVault().set("pcn_test", "secret-value")
    assert deleted == ["pcn_test"]


def test_system_vault_preserves_identity_when_set_failure_cleanup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(*_args: str) -> None:
        raise FailingKeyringError("backend unavailable")

    monkeypatch.setattr(credential_vault.keyring, "set_password", fail)
    monkeypatch.setattr(credential_vault.keyring, "delete_password", fail)

    with pytest.raises(CredentialCleanupRequiredError, match="requires cleanup"):
        SystemCredentialVault().set("pcn_test", "secret-value")


def test_system_vault_rejects_backend_that_does_not_retain_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted: list[str] = []
    monkeypatch.setattr(credential_vault.keyring, "set_password", lambda *_args: None)
    monkeypatch.setattr(credential_vault.keyring, "get_password", lambda *_args: None)
    monkeypatch.setattr(
        credential_vault.keyring,
        "delete_password",
        lambda _service, username: deleted.append(username),
    )

    with pytest.raises(CredentialVaultUnavailableError, match="backend is unavailable"):
        SystemCredentialVault().set("pcn_test", "secret-value")
    assert deleted == ["pcn_test"]


def test_system_vault_cleans_up_when_read_after_write_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted: list[str] = []
    monkeypatch.setattr(credential_vault.keyring, "set_password", lambda *_args: None)

    def fail_read(*_args: str) -> str:
        raise FailingKeyringError("read failed")

    monkeypatch.setattr(credential_vault.keyring, "get_password", fail_read)
    monkeypatch.setattr(
        credential_vault.keyring,
        "delete_password",
        lambda _service, username: deleted.append(username),
    )

    with pytest.raises(CredentialVaultUnavailableError, match="backend is unavailable"):
        SystemCredentialVault().set("pcn_test", "secret-value")
    assert deleted == ["pcn_test"]


def test_system_vault_deletes_a_secret_changed_by_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted: list[str] = []
    monkeypatch.setattr(credential_vault.keyring, "set_password", lambda *_args: None)
    monkeypatch.setattr(credential_vault.keyring, "get_password", lambda *_args: "changed")
    monkeypatch.setattr(
        credential_vault.keyring,
        "delete_password",
        lambda _service, username: deleted.append(username),
    )

    with pytest.raises(CredentialVaultUnavailableError, match="backend is unavailable"):
        SystemCredentialVault().set("pcn_test", "secret-value")
    assert deleted == ["pcn_test"]


def test_system_vault_preserves_cleanup_identity_when_compensation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(credential_vault.keyring, "set_password", lambda *_args: None)

    def fail(*_args: str) -> str:
        raise FailingKeyringError("backend unavailable")

    monkeypatch.setattr(credential_vault.keyring, "get_password", fail)
    monkeypatch.setattr(credential_vault.keyring, "delete_password", fail)

    with pytest.raises(CredentialCleanupRequiredError, match="requires cleanup"):
        SystemCredentialVault().set("pcn_test", "secret-value")
