"""Episode-scoped edit decisions over immutable, project-owned media versions.

Frames are zero-based, half-open sequence frames. This draft contract carries
references, not copied media, generated motion, or an export approval.
"""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.assembly_subtitles import validate_subtitle_text
from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.episode_contracts import EPISODE_ID_PATTERN
from aijian_api.episode_script_contracts import BLOCK_ID_PATTERN, VERSION_ID_PATTERN
from aijian_api.episode_storyboard_contracts import SHOT_ID_PATTERN
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData

ASSEMBLY_ARTIFACT_TYPE = "episode_media_assembly"
ASSEMBLY_SCHEMA_VERSION: Final = "1.0.0"
_SHA256 = r"^[0-9a-f]{64}$"
_SEGMENT_ID = r"^seg_[a-z0-9._-]{1,80}$"

AssemblyMediaKind = Literal["image", "video", "audio"]
AssemblyMediaAvailability = Literal[
    "VERIFIED",
    "MISSING",
    "CORRUPT",
    "UNVERIFIED_SIZE_LIMIT",
    "UNKNOWN_UNSAFE_PATH",
    "UNKNOWN_MEDIA_READ",
    "UNKNOWN_MEDIA_CHANGED",
]
AssemblyTechnicalStatus = Literal[
    "STILL_HEADER_ONLY",
    "PENDING_MEDIA_PROBE",
    "PROBED_CFR_VIDEO",
    "INVALID_MEDIA_PROBE",
]
AssemblyPlaybackStatus = Literal[
    "DRAFT_STATIC_ANIMATIC",
    "DRAFT_VIDEO_PREVIEW",
    "BLOCKED_MEDIA_PROBE",
    "BLOCKED_MEDIA_BYTES",
    "BLOCKED_RIGHTS",
]


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class AssemblyMediaRefV1(_Closed):
    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    asset_version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    sha256: str = Field(pattern=_SHA256)


class AssemblyStoryboardRefV1(_Closed):
    """Author-selected provenance; never a claim that the shot has been fulfilled."""

    storyboard_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)


class AssemblyVisualSegmentV1(_Closed):
    segment_id: str = Field(pattern=_SEGMENT_ID)
    media_kind: Literal["image", "video"]
    media: AssemblyMediaRefV1
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)
    source_in_frame: int = Field(default=0, ge=0)
    embedded_audio: Literal["MUTE", "PLAY"] = "MUTE"
    # Do not inject null into legacy immutable content or change its content hash.
    storyboard_ref: AssemblyStoryboardRefV1 | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )

    @model_validator(mode="after")
    def valid_interval(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("visual segment must have a positive half-open interval")
        if self.media_kind == "image" and self.source_in_frame != 0:
            raise ValueError("still images cannot declare a source frame offset")
        if self.media_kind == "image" and self.embedded_audio != "MUTE":
            raise ValueError("still images have no embedded audio")
        return self


class AssemblyAudioSegmentV1(_Closed):
    segment_id: str = Field(pattern=_SEGMENT_ID)
    track_kind: Literal["DIALOGUE", "BGM", "SFX"]
    media: AssemblyMediaRefV1
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)
    source_in_sample: int = Field(default=0, ge=0)
    script_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    script_block_id: str | None = Field(default=None, pattern=BLOCK_ID_PATTERN)
    # Derived from the exact episode script version and its speaker label.
    # This is not yet a reviewed, cross-version character identity.
    speaker_id: str | None = Field(default=None, pattern=r"^spk_[0-9a-f]{32}$")
    delivery: Literal["ON_SCREEN", "OFF_SCREEN"] | None = None

    @model_validator(mode="after")
    def valid_interval_and_dialogue(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("audio segment must have a positive half-open interval")
        dialogue_fields = (
            self.script_version_id,
            self.script_block_id,
            self.speaker_id,
            self.delivery,
        )
        if self.track_kind == "DIALOGUE" and any(value is None for value in dialogue_fields):
            raise ValueError("dialogue must bind a script block, speaker and delivery")
        if self.track_kind != "DIALOGUE" and any(value is not None for value in dialogue_fields):
            raise ValueError("only dialogue may bind a speaker or script block")
        return self


class AssemblySubtitleSegmentV1(_Closed):
    segment_id: str = Field(pattern=_SEGMENT_ID)
    script_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    script_block_id: str = Field(pattern=BLOCK_ID_PATTERN)
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)

    @model_validator(mode="after")
    def valid_interval(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("subtitle must have a positive half-open interval")
        return self


class AssemblyTextSubtitleSegmentV1(_Closed):
    """User-authored text, frozen with its exact frame span and closed render profile."""

    segment_id: str = Field(pattern=_SEGMENT_ID)
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=57)
    render_profile: Literal["noto-cjk-sc-bottom-v1"]

    @field_validator("text")
    @classmethod
    def supported_text(cls, value: str) -> str:
        return validate_subtitle_text(value)

    @model_validator(mode="after")
    def valid_interval(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("subtitle must have a positive half-open interval")
        return self


class EpisodeMediaAssemblyContentV1(_Closed):
    schema_version: Literal["1.0.0"] = ASSEMBLY_SCHEMA_VERSION
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    sequence_timebase: SequenceTimebaseData
    canvas_width: int = Field(ge=1, le=8192)
    canvas_height: int = Field(ge=1, le=8192)
    total_frames: int = Field(ge=1, le=1_000_000)
    visual_segments: tuple[AssemblyVisualSegmentV1, ...] = Field(min_length=1, max_length=1000)
    audio_segments: tuple[AssemblyAudioSegmentV1, ...] = Field(default=(), max_length=1000)
    subtitle_segments: tuple[AssemblySubtitleSegmentV1 | AssemblyTextSubtitleSegmentV1, ...] = (
        Field(
            default=(),
            max_length=1000,
        )
    )

    @field_validator("visual_segments", "audio_segments", "subtitle_segments", mode="before")
    @classmethod
    def accept_json_segments(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def valid_sequence(self) -> Self:
        SequenceFrameRateData.model_validate(self.sequence_timebase.frame_rate.model_dump())
        visual = self.visual_segments
        cursor = 0
        for segment in visual:
            if segment.start_frame != cursor:
                raise ValueError("visual track must cover the sequence without gaps or overlap")
            cursor = segment.end_frame
        if cursor != self.total_frames:
            raise ValueError("visual track must end at total_frames")
        other = (*self.audio_segments, *self.subtitle_segments)
        if any(segment.end_frame > self.total_frames for segment in other):
            raise ValueError("track segment exceeds total_frames")
        # Leave legacy-only assemblies byte-compatible and retain their old geometry.
        subtitles = sorted(self.subtitle_segments, key=lambda cue: cue.start_frame)
        for index, cue in enumerate(subtitles):
            for previous in subtitles[:index]:
                if cue.start_frame < previous.end_frame and (
                    isinstance(cue, AssemblyTextSubtitleSegmentV1)
                    or isinstance(previous, AssemblyTextSubtitleSegmentV1)
                ):
                    raise ValueError("literal subtitle cues must not overlap other subtitles")
        ids = [segment.segment_id for segment in (*visual, *other)]
        if len(ids) != len(set(ids)):
            raise ValueError("segment IDs must be unique within an assembly")
        return self


class CreateEpisodeMediaAssemblyVersionRequest(_Closed):
    content: EpisodeMediaAssemblyContentV1
    parent_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    expected_revision: int | None = Field(default=None, ge=1)
    change_summary: str = Field(min_length=1, max_length=500)


class AssemblyMediaCheckV1(_Closed):
    media: AssemblyMediaRefV1
    kind: AssemblyMediaKind
    availability: AssemblyMediaAvailability
    technical_status: AssemblyTechnicalStatus
    probe_evidence_id: str | None = Field(default=None, pattern=r"^mpe_[0-9a-f]{32}$")
    probed_video_frames: int | None = Field(default=None, ge=1)
    probed_has_audio: bool | None = None
    rights_status: Literal["PENDING_REVIEW", "CLEARED", "RESTRICTED"]
    rights_decision_id: str | None = None


class EpisodeMediaAssemblyVersionData(_Closed):
    artifact_id: str = Field(pattern=r"^art_[0-9a-f]{32}$")
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    head_revision: int = Field(ge=1)
    parent_version_id: str | None = Field(pattern=VERSION_ID_PATTERN)
    content: EpisodeMediaAssemblyContentV1
    media_checks: tuple[AssemblyMediaCheckV1, ...]
    playback_status: AssemblyPlaybackStatus
    export_status: Literal["NO_EXPORT_CLAIM"] = "NO_EXPORT_CLAIM"
