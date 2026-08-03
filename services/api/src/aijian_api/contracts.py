"""Public API contracts for the walking skeleton."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class HealthData(BaseModel):
    """Stable service identity returned by the health endpoint."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["aijian-api"] = "aijian-api"
    version: str


class HealthResponse(BaseModel):
    """Versioned health response envelope."""

    model_config = ConfigDict(extra="forbid")

    data: HealthData
    request_id: UUID


class ErrorBody(BaseModel):
    """Stable machine-readable error details."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    details: dict[str, str]
    retryable: bool


class ErrorResponse(BaseModel):
    """Error envelope shared by all HTTP boundaries."""

    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
    request_id: UUID
