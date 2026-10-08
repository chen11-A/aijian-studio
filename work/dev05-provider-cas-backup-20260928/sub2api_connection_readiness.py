"""Local Sub2API configuration checks; never contacts the provider."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.credential_vault import CredentialVault, CredentialVaultUnavailableError
from aijian_api.provider_connection_repository import (
    ProviderConnectionRepository,
)
from aijian_api.provider_contracts import (
    PROVIDER_CONNECTION_ID_PATTERN,
    validate_sub2api_origin,
)

type CredentialState = Literal["CONFIGURED", "MISSING", "UNAVAILABLE"]
type LocalReadinessReason = Literal[
    "NOT_SUB2API",
    "CONNECTION_DISABLED",
    "ORIGIN_INVALID",
    "TEXT_MODEL_NOT_CONFIGURED",
    "CREDENTIAL_MISSING",
    "CREDENTIAL_UNAVAILABLE",
    "RUNTIME_UNAVAILABLE",
]


class Sub2APIConfiguredReadinessData(BaseModel):
    """A local preflight, not proof of network reachability or account entitlement."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    connection_id: str = Field(pattern=PROVIDER_CONNECTION_ID_PATTERN)
    connection_revision: int = Field(strict=True, ge=1)
    model_id: str = Field(min_length=1, max_length=200)
    credential_status: CredentialState
    runtime_status: str
    local_preconditions_met: bool
    reasons: list[LocalReadinessReason]
    provider_observation: Literal["NOT_CHECKED"] = "NOT_CHECKED"
    model_entitlement: Literal["UNKNOWN"] = "UNKNOWN"


class Sub2APIConfiguredReadiness:
    def __init__(
        self,
        connections: ProviderConnectionRepository,
        credentials: CredentialVault,
        runtime_availability: Callable[[], str],
    ) -> None:
        self._connections = connections
        self._credentials = credentials
        self._runtime_availability = runtime_availability

    def read(self, connection_id: str, model_id: str) -> Sub2APIConfiguredReadinessData:
        """Read persisted metadata, Vault presence and local worker state only."""
        connection = self._connections.get(connection_id)
        reasons: list[LocalReadinessReason] = []
        if connection.provider_kind != "SUB2API":
            reasons.append("NOT_SUB2API")
        else:
            try:
                validate_sub2api_origin(connection.base_url)
            except ValueError:
                reasons.append("ORIGIN_INVALID")
        if not connection.enabled:
            reasons.append("CONNECTION_DISABLED")
        if not any(
            item.model_id == model_id and item.capabilities == ("TEXT",)
            for item in connection.models
        ):
            reasons.append("TEXT_MODEL_NOT_CONFIGURED")
        try:
            credential = self._credentials.get(connection.id)
        except CredentialVaultUnavailableError:
            credential_status: CredentialState = "UNAVAILABLE"
            reasons.append("CREDENTIAL_UNAVAILABLE")
        else:
            credential_status = "CONFIGURED" if credential else "MISSING"
            if not credential:
                reasons.append("CREDENTIAL_MISSING")
            del credential
        try:
            runtime_status = self._runtime_availability()
        except Exception:
            runtime_status = "UNAVAILABLE"
        if runtime_status not in {"WAITING_FOR_EXPLICIT_APPROVAL", "EXECUTING"}:
            reasons.append("RUNTIME_UNAVAILABLE")
        return Sub2APIConfiguredReadinessData(
            connection_id=connection.id,
            connection_revision=connection.revision,
            model_id=model_id,
            credential_status=credential_status,
            runtime_status=runtime_status,
            local_preconditions_met=not reasons,
            reasons=reasons,
        )
