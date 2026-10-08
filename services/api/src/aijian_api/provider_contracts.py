"""Public provider-connection contracts and trust-origin validation."""

from datetime import datetime
from ipaddress import ip_address
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

PROVIDER_CONNECTION_ID_PATTERN = r"^pcn_[0-9a-f]{32}$"
PROVIDER_MUTATION_ID_PATTERN = r"^pcop_[0-9a-f]{32}$"
MAX_EXPECTED_REVISION = 9_223_372_036_854_775_806
OPENAI_BASE_URL = "https://api.openai.com/v1"
XAI_BASE_URL = "https://api.x.ai/v1"
CPA_LOOPBACK_BASE_URL = "http://127.0.0.1:8317"
Sub2APIOriginMode = Literal["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"]


def validate_sub2api_origin(
    base_url: str, origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS"
) -> None:
    """Validate one explicitly selected Sub2API origin without widening public policy."""
    if origin_mode not in {"PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"}:
        raise ValueError("Sub2API origin mode is invalid")
    try:
        parsed = urlsplit(base_url)
        hostname = parsed.hostname or ""
        port = parsed.port
    except ValueError as error:
        raise ValueError("Sub2API origin is invalid") from error
    if origin_mode == "LOCAL_LOOPBACK_HTTP":
        allowed = (
            f"http://127.0.0.1:{port}",
            f"http://[::1]:{port}",
        ) if port is not None and 1 <= port <= 65535 else ()
        if parsed.scheme != "http" or base_url not in allowed:
            raise ValueError("Sub2API local mode requires a literal loopback HTTP origin and port")
        return
    if (
        parsed.scheme != "https"
        or not hostname
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or "@" in parsed.netloc
        or "\\" in base_url
        or "%" in parsed.netloc
        or any(character.isspace() for character in base_url)
        or (port is not None and port <= 0)
    ):
        raise ValueError("Sub2API requires a public HTTPS origin without a path")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError("Sub2API cannot use a local origin")
    try:
        address = ip_address(hostname)
    except ValueError:
        if "." not in hostname or hostname.startswith(".") or hostname.endswith("."):
            raise ValueError("Sub2API requires a public DNS name or IP origin") from None
    else:
        if not address.is_global or address.is_multicast:
            raise ValueError("Sub2API cannot use a non-public IP origin")


def sub2api_origin_binding(
    base_url: str, origin_mode: Sub2APIOriginMode, connection_revision: int
) -> dict[str, object]:
    """Immutable non-secret binding included in run and approval scope hashes."""
    validate_sub2api_origin(base_url, origin_mode)
    if type(connection_revision) is not int or connection_revision < 1:
        raise ValueError("Sub2API connection revision is invalid")
    return {
        "origin": base_url,
        "origin_mode": origin_mode,
        "connection_revision": connection_revision,
    }


def _normalize_base_url(value: object) -> object:
    if not isinstance(value, str):
        return value
    normalized = value.strip().rstrip("/")
    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        _port = parsed.port
    except ValueError as error:
        raise ValueError("base URL is invalid") from error
    if (
        "@" in parsed.netloc
        or "?" in normalized
        or "#" in normalized
        or any(character.isspace() for character in normalized)
    ):
        raise ValueError("base URL cannot contain credentials, query, or fragment")
    if not hostname or not parsed.netloc:
        raise ValueError("base URL is invalid")
    if parsed.scheme == "https":
        return normalized
    if parsed.scheme == "http" and hostname in {"localhost", "127.0.0.1", "::1"}:
        return normalized
    raise ValueError("base URL must use HTTPS unless it is a loopback service")


class ProviderModelData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    capabilities: list[Literal["TEXT", "IMAGE", "VIDEO", "SPEECH"]] = Field(
        min_length=1,
        max_length=4,
    )

    @field_validator("capabilities")
    @classmethod
    def unique_capabilities(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("model capabilities must be unique")
        return value


class CreateProviderConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_kind: Literal["OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA", "SUB2API"]
    display_name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=2048)
    enabled: bool = True
    models: list[ProviderModelData] = Field(min_length=1, max_length=100)
    api_key: SecretStr | None = Field(default=None, min_length=8, max_length=8192)
    origin_mode: Sub2APIOriginMode | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_noncanonical_local_origin(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("origin_mode") == "LOCAL_LOOPBACK_HTTP":
            base_url = value.get("base_url")
            if not isinstance(base_url, str) or base_url != base_url.strip().rstrip("/"):
                raise ValueError("Sub2API local origin must be canonical")
        return value

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_display_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("base_url", mode="before")
    @classmethod
    def validate_base_url(cls, value: object) -> object:
        return _normalize_base_url(value)

    @model_validator(mode="after")
    def enforce_provider_policy(self) -> "CreateProviderConnectionRequest":
        if self.provider_kind != "OLLAMA" and self.api_key is None:
            raise ValueError("API key is required for cloud providers")
        parsed = urlsplit(self.base_url)
        if self.provider_kind == "OPENAI" and self.base_url != OPENAI_BASE_URL:
            raise ValueError("OpenAI connections must use the official API origin")
        if self.provider_kind == "XAI" and self.base_url != XAI_BASE_URL:
            raise ValueError("xAI connections must use the official API origin")
        if self.provider_kind == "OLLAMA" and parsed.hostname not in {
            "localhost",
            "127.0.0.1",
            "::1",
        }:
            raise ValueError("Ollama connections must use a loopback origin")
        if self.provider_kind == "OPENAI_COMPATIBLE" and parsed.scheme != "https":
            raise ValueError("OpenAI-compatible connections must use HTTPS")
        if self.provider_kind == "OPENAI_COMPATIBLE":
            hostname = parsed.hostname or ""
            if hostname == "localhost":
                raise ValueError("OpenAI-compatible connections cannot use a local origin")
            try:
                address = ip_address(hostname)
            except ValueError:
                pass
            else:
                if (
                    not address.is_global
                    or address.is_multicast
                    or getattr(address, "is_site_local", False)
                ):
                    raise ValueError(
                        "OpenAI-compatible connections cannot use a non-public IP origin"
                    )
        if self.provider_kind == "SUB2API":
            if "origin_mode" in self.model_fields_set and self.origin_mode is None:
                raise ValueError("Sub2API origin_mode cannot be null")
            validate_sub2api_origin(self.base_url, self.origin_mode or "PUBLIC_HTTPS")
            if any(model.capabilities != ["TEXT"] for model in self.models):
                raise ValueError("Sub2API connections currently require text-only models")
        elif self.origin_mode is not None:
            raise ValueError("origin_mode is only valid for Sub2API")
        model_ids = [model.model_id for model in self.models]
        if len(model_ids) != len(set(model_ids)):
            raise ValueError("model IDs must be unique within a connection")
        return self


class EditSub2APIConnectionRequest(BaseModel):
    """Full metadata replacement; a credential can only change via rotate."""

    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1, le=MAX_EXPECTED_REVISION)
    display_name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=2048)
    enabled: bool
    models: list[ProviderModelData] = Field(min_length=1, max_length=100)
    origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS"

    @model_validator(mode="before")
    @classmethod
    def reject_noncanonical_local_origin(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("origin_mode") == "LOCAL_LOOPBACK_HTTP":
            base_url = value.get("base_url")
            if not isinstance(base_url, str) or base_url != base_url.strip().rstrip("/"):
                raise ValueError("Sub2API local origin must be canonical")
        return value

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_display_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("base_url", mode="before")
    @classmethod
    def normalize_base_url(cls, value: object) -> object:
        return _normalize_base_url(value)

    @model_validator(mode="after")
    def enforce_sub2api_policy(self) -> "EditSub2APIConnectionRequest":
        validate_sub2api_origin(self.base_url, self.origin_mode)
        if any(model.capabilities != ["TEXT"] for model in self.models):
            raise ValueError("Sub2API connections currently require text-only models")
        model_ids = [model.model_id for model in self.models]
        if len(model_ids) != len(set(model_ids)):
            raise ValueError("model IDs must be unique within a connection")
        return self


class RotateSub2APIKeyRequest(BaseModel):
    """One explicit Vault-write attempt with a durable client operation identity."""

    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1, le=MAX_EXPECTED_REVISION)
    operation_id: str = Field(pattern=PROVIDER_MUTATION_ID_PATTERN)
    api_key: SecretStr = Field(min_length=8, max_length=8192)

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr) -> SecretStr:
        if any(character.isspace() for character in value.get_secret_value()):
            raise ValueError("Sub2API key must not contain whitespace")
        return value


class ProviderRotationOperationData(BaseModel):
    """Readback contains identity and status, never a Vault reference or secret."""

    model_config = ConfigDict(extra="forbid")

    operation_id: str = Field(pattern=PROVIDER_MUTATION_ID_PATTERN)
    connection_id: str = Field(pattern=PROVIDER_CONNECTION_ID_PATTERN)
    expected_revision: int = Field(ge=1)
    status: Literal["PREPARED", "APPLIED", "CONFLICT", "UNKNOWN"]
    applied_revision: int | None = Field(default=None, ge=2)
    created_at: datetime
    updated_at: datetime


class ProviderRotationOperationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ProviderRotationOperationData
    request_id: UUID


class ProviderConnectionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=PROVIDER_CONNECTION_ID_PATTERN)
    provider_kind: Literal[
        "OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA", "CPA_LOOPBACK", "SUB2API"
    ]
    display_name: str
    base_url: str
    origin_mode: Sub2APIOriginMode | None = None
    enabled: bool
    models: list[ProviderModelData]
    credential_status: Literal["CONFIGURED", "MISSING", "UNAVAILABLE"]
    revision: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime


class ProviderConnectionListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[ProviderConnectionData]
    request_id: UUID


class ProviderConnectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ProviderConnectionData
    request_id: UUID
