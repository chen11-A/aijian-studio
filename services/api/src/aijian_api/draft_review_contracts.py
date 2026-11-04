"""Exact-output manual notes, explicitly outside the formal review gates."""

from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.draft_export_contracts import DRAFT_OPERATION_PATTERN
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import CONTENT_HASH_PATTERN, VERSION_ID_PATTERN

NOTE_ID_PATTERN = r"^drn_[0-9a-f]{32}$"
RESOLUTION_ID_PATTERN = r"^drr_[0-9a-f]{32}$"


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class DraftReviewIdentity(_Closed):
    assembly_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    assembly_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    output_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    output_bytes: int = Field(gt=0)


class CreateDraftReviewNoteRequest(DraftReviewIdentity):
    note_id: str = Field(pattern=NOTE_ID_PATTERN)
    frame_index: int = Field(ge=0, lt=1_000_000)
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def meaningful_text(cls, value: str) -> str:
        if not value.strip() or "\0" in value:
            raise ValueError("A manual note needs nonempty text without NUL")
        return value


class ResolveDraftReviewNoteRequest(DraftReviewIdentity):
    resolution_id: str = Field(pattern=RESOLUTION_ID_PATTERN)
    expected_revision: Literal[1]
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value: str) -> str:
        return CreateDraftReviewNoteRequest.meaningful_text(value)


class DraftReviewTarget(DraftReviewIdentity):
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    operation_id: str = Field(pattern=DRAFT_OPERATION_PATTERN)
    assembly_version_number: int = Field(gt=0)
    total_frames: int = Field(gt=0, le=1_000_000)
    frame_rate_num: int = Field(gt=0)
    frame_rate_den: int = Field(gt=0)


class DraftReviewResolution(_Closed):
    resolution_id: str = Field(pattern=RESOLUTION_ID_PATTERN)
    reason: str = Field(min_length=1, max_length=2000)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str


class DraftReviewNote(_Closed):
    note_id: str = Field(pattern=NOTE_ID_PATTERN)
    frame_index: int = Field(ge=0, lt=1_000_000)
    text: str = Field(min_length=1, max_length=2000)
    actor_id: str = Field(min_length=1, max_length=200)
    created_at: str
    revision: Literal[1, 2]
    resolution: DraftReviewResolution | None

    @model_validator(mode="after")
    def coherent_revision(self) -> Self:
        if (self.revision == 2) != (self.resolution is not None):
            raise ValueError("Resolution and note revision differ")
        return self


class DraftReviewData(_Closed):
    target: DraftReviewTarget
    output_verified: bool
    current_assembly_version_id: str | None = Field(pattern=VERSION_ID_PATTERN)
    current_assembly_content_hash: str | None = Field(pattern=CONTENT_HASH_PATTERN)
    version_status: Literal["CURRENT", "OLDER_VERSION", "UNKNOWN"]
    notes: list[DraftReviewNote] = Field(max_length=500)
    manual_review_only: Literal[True] = True


class DraftReviewResponse(_Closed):
    data: DraftReviewData
    request_id: UUID
