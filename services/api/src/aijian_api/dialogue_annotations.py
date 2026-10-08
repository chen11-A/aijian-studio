"""Immutable, observed dialogue timing annotations; not a lip-sync acceptance result."""

from __future__ import annotations

import hashlib
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.media_contracts import (
    CONTENT_HASH_PATTERN,
    JSON_SAFE_INTEGER_MAX,
    NonNegativeStrictInteger,
    SequenceTimebaseData,
    sequence_frame_to_audio_sample,
)

ProjectId = Annotated[str, Field(pattern=r"^prj_[0-9a-f]{32}$")]
MediaArtifactVersionId = Annotated[str, Field(pattern=r"^ver_[0-9a-f]{32}$")]
PositiveFrameCount = Annotated[int, Field(strict=True, gt=0, le=JSON_SAFE_INTEGER_MAX)]


class AvAlignmentAnchorV1(BaseModel):
    """One observed visual-frame/audio-sample pair, without a quality verdict."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    observed_media_frame: NonNegativeStrictInteger
    observed_audio_sample_position: NonNegativeStrictInteger


class DialogueAnnotationV1(BaseModel):
    """Frozen synthetic-or-real dialogue metadata; anchors do not certify lip-sync quality."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    project_id: ProjectId
    media_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    media_artifact_version_id: MediaArtifactVersionId
    sequence_timebase: SequenceTimebaseData
    media_frame_count: PositiveFrameCount
    start_frame: NonNegativeStrictInteger
    end_frame: NonNegativeStrictInteger
    audio_stream_index: NonNegativeStrictInteger
    audio_sample_count: PositiveFrameCount
    audio_start_sample_position: NonNegativeStrictInteger
    audio_end_sample_position: NonNegativeStrictInteger
    dialogue_text: Annotated[str, Field(strict=True, min_length=1, max_length=20_000)]
    dialogue_text_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    anchors: tuple[AvAlignmentAnchorV1, ...] = Field(min_length=1, max_length=10_000)

    @classmethod
    def from_utf8_bytes(cls, value: bytes, *, payload_without_text: dict[str, object]) -> Self:
        text = value.decode("utf-8", errors="strict")
        return cls.model_validate(
            {
                **payload_without_text,
                "dialogue_text": text,
                "dialogue_text_sha256": f"sha256:{hashlib.sha256(value).hexdigest()}",
            }
        )

    @model_validator(mode="after")
    def require_bound_observed_anchors(self) -> Self:
        if not self.start_frame < self.end_frame <= self.media_frame_count:
            raise ValueError("dialogue frame range must be within media frame range")
        expected_hash = f"sha256:{hashlib.sha256(self.dialogue_text.encode('utf-8')).hexdigest()}"
        if self.dialogue_text_sha256 != expected_hash:
            raise ValueError("dialogue text hash must match UTF-8 dialogue text")
        previous: AvAlignmentAnchorV1 | None = None
        if (
            not 0
            <= self.audio_start_sample_position
            < self.audio_end_sample_position
            <= self.audio_sample_count
        ):
            raise ValueError("dialogue audio range must be within audio sample range")
        for anchor in self.anchors:
            if not self.start_frame <= anchor.observed_media_frame < self.end_frame:
                raise ValueError("dialogue anchor must be within frame range")
            if not (
                self.audio_start_sample_position
                <= anchor.observed_audio_sample_position
                < self.audio_end_sample_position
            ):
                raise ValueError("dialogue audio anchor must be within audio sample range")
            if previous is not None and (
                anchor.observed_media_frame <= previous.observed_media_frame
                or anchor.observed_audio_sample_position <= previous.observed_audio_sample_position
            ):
                raise ValueError("dialogue anchors must strictly increase")
            previous = anchor
        return self

    @property
    def observed_offset_samples(self) -> tuple[int, ...]:
        """Derived audio-minus-visual offsets; absent from serialized contract input/output."""

        return tuple(
            anchor.observed_audio_sample_position
            - sequence_frame_to_audio_sample(anchor.observed_media_frame, self.sequence_timebase)
            for anchor in self.anchors
        )

    @property
    def frame_range(self) -> tuple[int, int]:
        return (self.start_frame, self.end_frame)
