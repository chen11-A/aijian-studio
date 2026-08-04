"""One-way provider credential storage backed by the operating-system keyring."""

from typing import NoReturn, Protocol

import keyring
from keyring.errors import KeyringError

SERVICE_NAME = "aijian-studio/provider-api-key"


class CredentialVaultUnavailableError(RuntimeError):
    """Raised when the operating system cannot securely store credentials."""


class CredentialCleanupRequiredError(CredentialVaultUnavailableError):
    """Raised when a possibly written credential could not be removed."""


class CredentialVault(Protocol):
    def set(self, connection_id: str, secret: str) -> None: ...

    def get(self, connection_id: str) -> str | None: ...

    def delete(self, connection_id: str) -> None: ...


class SystemCredentialVault:
    """Store credentials in Windows Credential Locker, Keychain, or Secret Service."""

    def set(self, connection_id: str, secret: str) -> None:
        try:
            keyring.set_password(SERVICE_NAME, connection_id, secret)
        except KeyringError as error:
            self._cleanup_uncertain_write(connection_id, error)
        try:
            retained_secret = keyring.get_password(SERVICE_NAME, connection_id)
        except KeyringError as error:
            self._cleanup_uncertain_write(connection_id, error)
        if retained_secret != secret:
            self._cleanup_uncertain_write(
                connection_id,
                CredentialVaultUnavailableError("credential backend did not retain the secret"),
            )

    def get(self, connection_id: str) -> str | None:
        try:
            return keyring.get_password(SERVICE_NAME, connection_id)
        except KeyringError as error:
            raise CredentialVaultUnavailableError("credential backend is unavailable") from error

    def delete(self, connection_id: str) -> None:
        try:
            if keyring.get_password(SERVICE_NAME, connection_id) is not None:
                keyring.delete_password(SERVICE_NAME, connection_id)
        except KeyringError as error:
            raise CredentialVaultUnavailableError("credential backend is unavailable") from error

    @staticmethod
    def _cleanup_uncertain_write(connection_id: str, original_error: Exception) -> NoReturn:
        try:
            keyring.delete_password(SERVICE_NAME, connection_id)
        except KeyringError as cleanup_error:
            raise CredentialCleanupRequiredError(
                "credential write outcome requires cleanup"
            ) from cleanup_error
        raise CredentialVaultUnavailableError(
            "credential backend is unavailable"
        ) from original_error
