"""Secret-aware application service for model-provider connections."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

from aijian_api.credential_vault import (
    CredentialCleanupRequiredError,
    CredentialVault,
    CredentialVaultUnavailableError,
)
from aijian_api.provider_connection_repository import (
    ProviderConnection,
    ProviderConnectionConflictError,
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
    ProviderConnectionVersionConflictError,
    ProviderConnectionWriteUnknownError,
    ProviderKind,
    ProviderModel,
    ProviderRotationOperation,
    ProviderRotationOperationExistsError,
)
from aijian_api.provider_contracts import Sub2APIOriginMode, validate_sub2api_origin

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
                connection=item, credential_status=self._credential_status(item.credential_ref)
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
        origin_mode: Sub2APIOriginMode | None = None,
    ) -> ProviderConnectionView:
        if provider_kind == "CPA_LOOPBACK" and (
            api_key is None
            or not 8 <= len(api_key) <= 8192
            or any(character.isspace() for character in api_key)
        ):
            raise ValueError("CPA loopback requires a dedicated bearer credential")
        if provider_kind == "SUB2API" and (
            api_key is None
            or not 8 <= len(api_key) <= 8192
            or any(character.isspace() for character in api_key)
        ):
            raise ValueError("Sub2API requires a dedicated user API key")
        if provider_kind == "SUB2API":
            origin_mode = origin_mode or "PUBLIC_HTTPS"
            validate_sub2api_origin(base_url, origin_mode)
        elif origin_mode is not None:
            raise ValueError("origin_mode is only valid for Sub2API")
        connection = self._repository.create(
            provider_kind=provider_kind,
            display_name=display_name,
            base_url=base_url,
            enabled=enabled,
            models=models,
            origin_mode=origin_mode,
        )
        if api_key is None:
            return ProviderConnectionView(connection=connection, credential_status="MISSING")
        with self._repository.credential_lifecycle(connection.id):
            self._repository.require_credential_write(connection.id, connection.revision)
            try:
                self._vault.set(connection.credential_ref, api_key)
            except CredentialCleanupRequiredError:
                raise
            except CredentialVaultUnavailableError:
                try:
                    self._repository.delete(connection.id, expected_revision=connection.revision)
                except ProviderConnectionConflictError:
                    pass  # A concurrent mutation keeps its durable recovery identity.
                raise
        return ProviderConnectionView(connection=connection, credential_status="CONFIGURED")

    def delete(self, connection_id: str) -> None:
        self._repository.prepare_delete(connection_id)
        try:
            with self._repository.credential_lifecycle(connection_id):
                references = self._repository.cleanup_credential_refs(connection_id)
                for reference in references:
                    self._vault.delete(reference)
                    if self._vault.get(reference) is not None:
                        raise CredentialCleanupRequiredError(
                            "provider credential removal could not be verified"
                        )
                self._repository.finish_delete(connection_id, credential_refs=references)
        except (CredentialVaultUnavailableError, ProviderConnectionWriteUnknownError) as error:
            raise CredentialCleanupRequiredError(
                "provider credential cleanup requires recovery or readback"
            ) from error

    def edit_sub2api(
        self,
        *,
        connection_id: str,
        expected_revision: int,
        display_name: str,
        base_url: str,
        enabled: bool,
        models: Sequence[ProviderModel],
        origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS",
        origin_mode_explicit: bool = False,
    ) -> ProviderConnectionView:
        current = self._repository.get(connection_id)
        if current.provider_kind != "SUB2API" or current.revision != expected_revision:
            raise ProviderConnectionVersionConflictError("provider revision changed")
        if current.origin_mode == "LOCAL_LOOPBACK_HTTP" and not origin_mode_explicit:
            raise ValueError("editing a local Sub2API connection requires explicit origin_mode")
        validate_sub2api_origin(base_url, origin_mode)
        updated = self._repository.update_metadata_cas(
            connection_id=connection_id,
            expected_revision=expected_revision,
            display_name=display_name,
            base_url=base_url,
            enabled=enabled,
            models=models,
            origin_mode=origin_mode,
        )
        return ProviderConnectionView(
            connection=updated,
            credential_status=self._credential_status(updated.credential_ref),
        )

    def rotate_sub2api_key(
        self,
        *,
        connection_id: str,
        expected_revision: int,
        operation_id: str,
        api_key: str,
    ) -> ProviderConnectionView:
        with self._repository.credential_lifecycle(connection_id):
            return self._rotate_sub2api_key(
                connection_id=connection_id,
                expected_revision=expected_revision,
                operation_id=operation_id,
                api_key=api_key,
            )

    def _rotate_sub2api_key(
        self,
        *,
        connection_id: str,
        expected_revision: int,
        operation_id: str,
        api_key: str,
    ) -> ProviderConnectionView:
        if not 8 <= len(api_key) <= 8192 or any(character.isspace() for character in api_key):
            raise ValueError("Sub2API requires a dedicated user API key")
        try:
            self._repository.get_rotation_operation(operation_id)
        except ProviderConnectionNotFoundError:
            pass
        else:
            raise ProviderRotationOperationExistsError("rotation operation already exists")
        current = self._repository.get(connection_id)
        if current.provider_kind != "SUB2API" or current.revision != expected_revision:
            raise ProviderConnectionVersionConflictError("provider revision changed")
        candidate_ref = f"{connection_id}:crd_{uuid4().hex}"
        self._repository.prepare_rotation(
            operation_id=operation_id,
            connection_id=connection_id,
            expected_revision=expected_revision,
            candidate_credential_ref=candidate_ref,
        )
        self._repository.require_credential_write(connection_id, expected_revision)
        try:
            self._vault.set(candidate_ref, api_key)
            if self._vault.get(candidate_ref) != api_key:
                raise CredentialVaultUnavailableError(
                    "credential backend did not retain the new key"
                )
        except CredentialVaultUnavailableError:
            self._mark_rotation_unknown(operation_id)
            raise
        try:
            updated = self._repository.apply_rotation_cas(
                operation_id=operation_id,
                connection_id=connection_id,
                expected_revision=expected_revision,
                old_credential_ref=current.credential_ref,
                candidate_credential_ref=candidate_ref,
            )
        except ProviderConnectionVersionConflictError:
            raise
        except ProviderConnectionConflictError as error:
            self._mark_rotation_unknown(operation_id)
            raise ProviderConnectionWriteUnknownError(
                "rotation result requires readback"
            ) from error
        except ProviderConnectionWriteUnknownError:
            self._mark_rotation_unknown(operation_id)
            raise
        # Existing approved dispatches may have read the old revision before
        # CAS. Keep its Vault slot until a separate, verified cleanup operation.
        return ProviderConnectionView(connection=updated, credential_status="CONFIGURED")

    def get_rotation_operation(
        self,
        *,
        connection_id: str,
        operation_id: str,
    ) -> ProviderRotationOperation:
        operation = self._repository.get_rotation_operation(operation_id)
        if operation.connection_id != connection_id:
            raise ProviderConnectionNotFoundError("rotation operation not found")
        return operation

    def _mark_rotation_unknown(self, operation_id: str) -> None:
        try:
            self._repository.mark_rotation_unknown(operation_id)
        except ProviderConnectionWriteUnknownError:
            pass  # GET may still find PREPARED or the committed APPLIED row.

    def _credential_status(self, credential_ref: str) -> CredentialStatus:
        try:
            return "CONFIGURED" if self._vault.get(credential_ref) is not None else "MISSING"
        except CredentialVaultUnavailableError:
            return "UNAVAILABLE"
