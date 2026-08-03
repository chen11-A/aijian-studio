"""Versioned public API contracts."""

import base64
import binascii
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from aijian_api.source_manifest import SourceManifestContentV1

PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
SOURCE_ID_PATTERN = r"^src_[0-9a-f]{32}$"
SOURCE_BLOCK_ID_PATTERN = r"^srcb_[0-9a-f]{32}$"
ARTIFACT_ID_PATTERN = r"^art_[0-9a-f]{32}$"
VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"


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


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    aspect_ratio: Literal["9:16"] = "9:16"
    target_duration_seconds: int = Field(default=90, ge=30, le=180)
    source_language: Literal["zh-CN"] = "zh-CN"

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def reject_control_characters(cls, value: str) -> str:
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Project name contains unsupported control characters")
        return value


class ProjectData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=PROJECT_ID_PATTERN)
    name: str
    aspect_ratio: Literal["9:16"]
    target_duration_seconds: int
    source_language: Literal["zh-CN"]
    status: Literal["active", "archived"]
    revision: int
    created_at: datetime
    updated_at: datetime


class ProjectResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ProjectData
    request_id: UUID


class ProjectListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[ProjectData]
    request_id: UUID


class ImportTextSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    media_type: Literal["text/plain"] = "text/plain"
    content_base64: str = Field(min_length=4)

    @field_validator("content_base64")
    @classmethod
    def validate_base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Source content must be valid Base64") from error
        return value

    def decoded_content(self) -> bytes:
        return base64.b64decode(self.content_base64, validate=True)


class SourceBlockData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SOURCE_BLOCK_ID_PATTERN)
    ordinal: int
    kind: Literal["chapter_heading", "paragraph"]
    chapter_index: int
    text: str
    normalized_start_byte: int
    normalized_end_byte: int
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SourceDocumentSummaryData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str = Field(pattern=SOURCE_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    filename: str
    media_type: Literal["text/plain"]
    encoding: Literal["utf-8"]
    byte_size: int
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    imported_at: datetime
    chapter_count: int
    block_count: int


class SourceDocumentData(SourceDocumentSummaryData):
    model_config = ConfigDict(extra="forbid")

    blocks: list[SourceBlockData]


class SourceDocumentListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: list[SourceDocumentSummaryData]
    request_id: UUID


class SourceDocumentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceDocumentData
    request_id: UUID


class ArtifactHeadData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    latest_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    review_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    review_submission_id: str | None
    accepted_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    revision: int = Field(ge=1)
    review_evidence_revision: int = Field(ge=0)
    updated_at: datetime


class SourceManifestVersionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_number: int = Field(ge=1)
    schema_version: Literal["1.0.0"]
    content: SourceManifestContentV1
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    change_summary: str
    created_at: datetime


class SourceManifestData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    head: ArtifactHeadData
    latest_version: SourceManifestVersionData


class SourceManifestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceManifestData
    request_id: UUID
