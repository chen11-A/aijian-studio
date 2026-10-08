"""Contracts for reading the persisted normalized source text."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SourceDocumentTextData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^src_[0-9a-f]{32}$")
    project_id: str = Field(pattern=r"^prj_[0-9a-f]{32}$")
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    normalized_text: str
    normalized_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SourceDocumentTextResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceDocumentTextData
    request_id: UUID
