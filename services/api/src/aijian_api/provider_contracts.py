"""Public provider-connection contracts and trust-origin validation."""

from datetime import datetime
from ipaddress import ip_address
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

PROVIDER_CONNECTION_ID_PATTERN = r"^pcn_[0-9a-f]{32}$"
OPENAI_BASE_URL = "https://api.openai.com/v1"
XAI_BASE_URL = "https://api.x.ai/v1"


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

    provider_kind: Literal["OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA"]
    display_name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=1, max_length=2048)
    enabled: bool = True
    models: list[ProviderModelData] = Field(min_length=1, max_length=100)
    api_key: SecretStr | None = Field(default=None, min_length=8, max_length=8192)

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_display_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("base_url", mode="before")
    @classmethod
    def validate_base_url(cls, value: object) -> object:
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
        model_ids = [model.model_id for model in self.models]
        if len(model_ids) != len(set(model_ids)):
            raise ValueError("model IDs must be unique within a connection")
        return self


class ProviderConnectionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=PROVIDER_CONNECTION_ID_PATTERN)
    provider_kind: Literal["OPENAI", "XAI", "OPENAI_COMPATIBLE", "OLLAMA"]
    display_name: str
    base_url: str
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
