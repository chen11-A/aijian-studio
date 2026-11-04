"""Explicit local self observations, never sound/mix/subtitle approval."""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, StrictInt, StrictStr, field_validator, model_validator

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_media_assembly_contracts import (
    AssemblyAudioSegmentV1,
    AssemblyConfirmedScriptProvenanceV1,
    AssemblyDraftScriptProvenanceV1,
    AssemblyTextSubtitleSegmentV1,
    _Closed,
)
from aijian_api.episode_script_contracts import (
    BLOCK_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    VERSION_ID_PATTERN,
)
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN
from aijian_api.media_contracts import SequenceTimebaseData

MAX_LOCAL_REVIEW_BYTES = 64 * 1024
OPERATION_ID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
SEGMENT_ID_PATTERN = r"^seg_[a-z0-9._-]{1,80}$"
LocalMediaReviewKind = Literal["AUDIO", "LITERAL_SUBTITLE"]


class LocalMediaReviewOriginalV1(_Closed):
    asset_id: StrictStr = Field(pattern=ASSET_ID_PATTERN)
    asset_version_id: StrictStr = Field(pattern=ASSET_VERSION_ID_PATTERN)
    sha256: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    byte_size: StrictInt = Field(ge=1, le=32 * 1024 * 1024)
    mime_type: Literal["audio/wav", "audio/mpeg"]
    filename: StrictStr = Field(min_length=1, max_length=255)
    origin: Literal["LOCAL_IMPORT"]

    @field_validator("filename")
    @classmethod
    def unicode_filename(cls, value: str) -> str:
        value.encode("utf-8")
        return value


class LocalMediaReviewScriptSourceV1(_Closed):
    script_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    script_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    script_block_id: StrictStr = Field(pattern=BLOCK_ID_PATTERN)
    block_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)


class LocalMediaReviewTargetSnapshotV1(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    assembly_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    assembly_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    assembly_head_revision: StrictInt = Field(ge=1, le=9_007_199_254_740_991)
    segment_kind: LocalMediaReviewKind
    segment_id: StrictStr = Field(pattern=SEGMENT_ID_PATTERN)
    segment_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    sequence_timebase: SequenceTimebaseData
    total_frames: StrictInt = Field(ge=1, le=1_000_000)
    canvas_width: StrictInt = Field(ge=1, le=8192)
    canvas_height: StrictInt = Field(ge=1, le=8192)
    audio_segment: AssemblyAudioSegmentV1 | None
    subtitle_segment: AssemblyTextSubtitleSegmentV1 | None
    media_original: LocalMediaReviewOriginalV1 | None
    script_source: LocalMediaReviewScriptSourceV1 | None
    script_provenance: AssemblyDraftScriptProvenanceV1 | AssemblyConfirmedScriptProvenanceV1 | None

    @model_validator(mode="after")
    def exact_subject(self) -> Self:
        segment: AssemblyAudioSegmentV1 | AssemblyTextSubtitleSegmentV1 | None
        if self.segment_kind == "AUDIO":
            segment = self.audio_segment
            original = self.media_original
            if segment is None or original is None or self.subtitle_segment is not None:
                raise ValueError("Audio review requires only its exact audio segment and original")
            if segment.source_in_sample > 9_007_199_254_740_991:
                raise ValueError("New review sample position must be a transport-safe integer")
            if segment.media.model_dump() != {
                "asset_id": original.asset_id,
                "asset_version_id": original.asset_version_id,
                "sha256": original.sha256,
            }:
                raise ValueError("Audio original differs from saved segment")
            source_id, block_id = segment.script_version_id, segment.script_block_id
        else:
            segment = self.subtitle_segment
            if segment is None or self.audio_segment is not None or self.media_original is not None:
                raise ValueError("Subtitle review requires only saved literal text and range")
            source_id = segment.script_ref.script_version_id if segment.script_ref else None
            block_id = segment.script_ref.script_block_id if segment.script_ref else None
            if segment.script_ref and (
                self.script_source is None
                or segment.script_ref.script_content_hash != self.script_source.script_content_hash
            ):
                raise ValueError("Subtitle source hash differs")
        if (
            segment.segment_id != self.segment_id
            or segment.end_frame > self.total_frames
            or canonical_content_hash(segment.model_dump(mode="json")) != self.segment_content_hash
            or (source_id is None) != (self.script_source is None)
        ):
            raise ValueError("Exact segment snapshot or source differs")
        if self.script_source is not None and (
            self.script_source.script_version_id != source_id
            or self.script_source.script_block_id != block_id
        ):
            raise ValueError("Exact script block differs")
        return self


class LocalMediaReviewTargetData(_Closed):
    snapshot: LocalMediaReviewTargetSnapshotV1
    snapshot_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)

    @model_validator(mode="after")
    def exact_hash(self) -> Self:
        if canonical_content_hash(self.snapshot.model_dump(mode="json")) != self.snapshot_hash:
            raise ValueError("Target snapshot hash differs")
        return self


class LocalMediaReviewInputV1(_Closed):
    schema_version: Literal["1.0.0"]
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    assembly_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    assembly_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    assembly_head_revision: StrictInt = Field(ge=1, le=9_007_199_254_740_991)
    segment_kind: LocalMediaReviewKind
    segment_id: StrictStr = Field(pattern=SEGMENT_ID_PATTERN)
    segment_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    target_snapshot_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    outcome: Literal["CHECKED", "NEEDS_CHANGES"]
    observation: StrictStr = Field(min_length=1, max_length=2000)
    self_review: Literal[True]

    @field_validator("self_review", mode="before")
    @classmethod
    def explicit_true(cls, value: object) -> object:
        if value is not True:
            raise ValueError("Explicit self-review boolean declaration is required")
        return value

    @field_validator("observation")
    @classmethod
    def unicode_observation(cls, value: str) -> str:
        value.encode("utf-8")
        return value

    @model_validator(mode="after")
    def explicit_observation(self) -> Self:
        if not self.observation.strip():
            raise ValueError("Explicit user self-review observation is required")
        return self


class CreateLocalMediaReviewRequest(_Closed):
    input: LocalMediaReviewInputV1
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    expected_revision: StrictInt | None = Field(ge=1, le=9_007_199_254_740_991)

    @model_validator(mode="after")
    def paired_revision(self) -> Self:
        if (self.parent_version_id is None) != (self.expected_revision is None):
            raise ValueError("Local review parent and revision must be paired")
        return self


class LocalMediaReviewContentV1(_Closed):
    schema_version: Literal["1.0.0"]
    input: LocalMediaReviewInputV1
    target_snapshot: LocalMediaReviewTargetSnapshotV1
    observation_method: Literal["ORIGINAL_AUDIO_LISTENING", "LITERAL_SUBTITLE_TEXT_AND_RANGE"]
    manual_review_only: Literal[True]
    formal_status: Literal["BLOCKED"]

    @model_validator(mode="after")
    def exact_binding(self) -> Self:
        fields = (
            "project_id",
            "episode_id",
            "assembly_version_id",
            "assembly_content_hash",
            "assembly_head_revision",
            "segment_kind",
            "segment_id",
            "segment_content_hash",
        )
        if any(getattr(self.input, key) != getattr(self.target_snapshot, key) for key in fields):
            raise ValueError("Original input and target snapshot differ")
        method = (
            "ORIGINAL_AUDIO_LISTENING"
            if self.input.segment_kind == "AUDIO"
            else "LITERAL_SUBTITLE_TEXT_AND_RANGE"
        )
        if (
            self.observation_method != method
            or self.input.target_snapshot_hash
            != canonical_content_hash(self.target_snapshot.model_dump(mode="json"))
        ):
            raise ValueError("Observation method or target hash differs")
        return self


class LocalMediaReviewVersionData(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    version_number: StrictInt = Field(ge=1, le=9_007_199_254_740_991)
    parent_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    author_actor_id: Literal["local-user"]
    content: LocalMediaReviewContentV1
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def utc_created(cls, value: datetime) -> datetime:
        offset = value.utcoffset()
        if offset is None or offset.total_seconds() != 0:
            raise ValueError("Self observation creation timestamp must use UTC")
        return value


class LocalMediaReviewPageData(_Closed):
    project_id: StrictStr = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: StrictStr = Field(pattern=EPISODE_ID_PATTERN)
    head_version_id: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)
    head_revision: StrictInt | None = Field(ge=1, le=9_007_199_254_740_991)
    items: tuple[LocalMediaReviewVersionData, ...] = Field(max_length=20)
    next_cursor: StrictStr | None = Field(pattern=VERSION_ID_PATTERN)


class LocalMediaReviewOperationData(_Closed):
    operation_id: StrictStr = Field(pattern=OPERATION_ID_PATTERN)
    payload: CreateLocalMediaReviewRequest
    version: LocalMediaReviewVersionData
    result_revision: StrictInt = Field(ge=1, le=9_007_199_254_740_991)


class LocalMediaReviewCurrentAssemblyV1(_Closed):
    version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    head_revision: StrictInt = Field(ge=1, le=9_007_199_254_740_991)


class LocalMediaReviewStatusReason(_Closed):
    code: StrictStr = Field(pattern=r"^[A-Z][A-Z0-9_]{2,79}$")
    message: StrictStr = Field(min_length=1, max_length=240)


class LocalMediaReviewStatusData(_Closed):
    review_version_id: StrictStr = Field(pattern=VERSION_ID_PATTERN)
    review_content_hash: StrictStr = Field(pattern=CONTENT_HASH_PATTERN)
    applicability: Literal["CURRENT", "STALE", "UNKNOWN"]
    current_assembly: LocalMediaReviewCurrentAssemblyV1 | None
    reasons: tuple[LocalMediaReviewStatusReason, ...] = Field(max_length=20)
    checked_at: datetime
    formal_status: Literal["BLOCKED"]

    @model_validator(mode="after")
    def status_consistency(self) -> Self:
        offset = self.checked_at.utcoffset()
        if offset is None or offset.total_seconds() != 0:
            raise ValueError("Applicability observation must use UTC")
        if self.applicability == "CURRENT" and (self.current_assembly is None or self.reasons):
            raise ValueError("Current applicability requires exact assembly and no stale reasons")
        if self.applicability != "CURRENT" and not self.reasons:
            raise ValueError("Non-current applicability requires an explicit reason")
        return self


class LocalMediaReviewTargetResponse(_Closed):
    data: LocalMediaReviewTargetData
    request_id: UUID


class LocalMediaReviewResponse(_Closed):
    data: LocalMediaReviewVersionData
    request_id: UUID


class LocalMediaReviewPageResponse(_Closed):
    data: LocalMediaReviewPageData
    request_id: UUID


class LocalMediaReviewOperationResponse(_Closed):
    data: LocalMediaReviewOperationData
    request_id: UUID


class LocalMediaReviewStatusResponse(_Closed):
    data: LocalMediaReviewStatusData
    request_id: UUID
