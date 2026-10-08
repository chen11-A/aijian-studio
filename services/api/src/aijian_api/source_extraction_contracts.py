"""Project-scoped readback contracts for persisted SourceExtraction versions."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.agent_skill_builtins import SourceExtractionPayloadV1
from aijian_api.contracts import (
    ARTIFACT_ID_PATTERN,
    ATTEMPT_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    PROJECT_ID_PATTERN,
    PROPOSAL_ID_PATTERN,
    SOURCE_SPAN_ID_PATTERN,
    VERSION_ID_PATTERN,
    ArtifactHeadData,
    StorySourceSpanData,
)


class SourceExtractionVersionData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=VERSION_ID_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_number: int = Field(ge=1)
    schema_version: Literal["1.0.0"]
    content: SourceExtractionPayloadV1
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    change_summary: str
    created_at: datetime


class SourceExtractionSourceSpanData(StorySourceSpanData):
    model_config = ConfigDict(extra="forbid")

    # Proposal acceptance persists source_span_id in the fact_id column.
    fact_id: str = Field(pattern=SOURCE_SPAN_ID_PATTERN)

    @model_validator(mode="after")
    def validate_byte_range(self) -> SourceExtractionSourceSpanData:
        if self.end_byte <= self.start_byte:
            raise ValueError("end_byte must be greater than start_byte")
        return self


class SourceExtractionDependencyData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upstream_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    relationship: str = Field(min_length=1)
    impact: Literal["blocking", "advisory", "render_only"]


class SourceExtractionProvenanceData(BaseModel):
    """Producer identities resolved from persisted proposal acceptance records."""

    model_config = ConfigDict(extra="forbid")

    producer_attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    proposal_id: str = Field(pattern=PROPOSAL_ID_PATTERN)


class SourceExtractionReadData(BaseModel):
    """Current head and the requested version, which may be historical."""

    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    head: ArtifactHeadData
    version: SourceExtractionVersionData
    source_spans: list[SourceExtractionSourceSpanData]
    dependencies: list[SourceExtractionDependencyData]
    provenance: SourceExtractionProvenanceData


class SourceExtractionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: SourceExtractionReadData
    request_id: UUID
