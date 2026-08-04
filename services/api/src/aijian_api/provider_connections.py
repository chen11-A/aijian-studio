"""Secret-aware application service for model-provider connections."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from aijian_api.credential_vault import (
    CredentialCleanupRequiredError,
    CredentialVault,
    CredentialVaultUnavailableError,
)
from aijian_api.provider_connection_repository import (
    ProviderConnection,
    ProviderConnectionRepository,
    ProviderKind,
    ProviderModel,
)

type CredentialStatus = Literal["CONFIGURED", "MISSING", "UNAVAILABLE"]


@dataclass(frozen=True, slots=True)
class ProviderConnectionView:
    connection: ProviderConnection
    credential_status: CredentialStatus


class ProviderConnectionService:
    def __init__(self, repository: ProviderConnectionRepository, vault: CredentialVault) -> None:
        self._repository = repository
        self._vault = vault

    def list(self) -> tuple[ProviderConnectionView, ...]:
        return tuple(
            ProviderConnectionView(
                connection=item, credential_status=self._credential_status(item.id)
            )
            for item in self._repository.list()
        )

    def create(
        self,
        *,
        provider_kind: ProviderKind,
        display_name: str,
        base_url: str,
        enabled: bool,
        models: Sequence[ProviderModel],
        api_key: str | None,
    ) -> ProviderConnectionView:
        connection = self._repository.create(
            provider_kind=provider_kind,
            display_name=display_name,
            base_url=base_url,
            enabled=enabled,
            models=models,
        )
        if api_key is None:
            return ProviderConnectionView(connection=connection, credential_status="MISSING")
        try:
            self._vault.set(connection.id, api_key)
        except CredentialCleanupRequiredError:
            raise
        except CredentialVaultUnavailableError:
            self._repository.delete(connection.id)
            raise
        return ProviderConnectionView(connection=connection, credential_status="CONFIGURED")

    def delete(self, connection_id: str) -> None:
        self._repository.get(connection_id)
        self._vault.delete(connection_id)
        self._repository.delete(connection_id)

    def _credential_status(self, connection_id: str) -> CredentialStatus:
        try:
            return "CONFIGURED" if self._vault.get(connection_id) is not None else "MISSING"
        except CredentialVaultUnavailableError:
            return "UNAVAILABLE"
