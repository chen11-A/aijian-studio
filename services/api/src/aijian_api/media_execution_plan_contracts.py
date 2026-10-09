"""Read-only, engine-neutral execution plan for an exact frozen media source.

This is a derived representation. It has no edit commands, database table,
rights approval, output claim, local path, or renderer-selected tool binary.
All sequence ranges are zero-based half-open frames. Audio source ranges are
half-open samples at the declared source sample rate.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_script_contracts import BLOCK_ID_PATTERN, VERSION_ID_PATTERN
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN
from aijian_api.media_contracts import SequenceTimebaseData, sequence_frame_to_audio_sample

_HASH = r"^[0-9a-f]{64}$"
_CONTENT_HASH = r"^sha256:[0-9a-f]{64}$"
_PLAN_ID = r"^[a-z][a-z0-9._-]{0,79}$"


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ExecutionSourceV1(_Closed):
    origin: Literal["EPISODE_ASSEMBLY", "FROZEN_ENGINEERING_TEST"]
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    assembly_artifact_id: str | None = Field(default=None, pattern=r"^art_[0-9a-f]{32}$")
    assembly_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    assembly_content_hash: str | None = Field(default=None, pattern=_CONTENT_HASH)
    assembly_head_revision: int | None = Field(default=None, ge=1)
    test_spec_sha256: str | None = Field(default=None, pattern=_HASH)
    fixture_manifest_sha256: str | None = Field(default=None, pattern=_HASH)

    @model_validator(mode="after")
    def exact_source(self) -> Self:
        assembly = (
            self.assembly_artifact_id,
            self.assembly_version_id,
            self.assembly_content_hash,
            self.assembly_head_revision,
        )
        if self.origin == "EPISODE_ASSEMBLY" and (
            any(value is None for value in assembly)
            or self.test_spec_sha256 is not None
            or self.fixture_manifest_sha256 is not None
        ):
            raise ValueError("assembly plan requires exact artifact/head identity")
        if self.origin == "FROZEN_ENGINEERING_TEST" and (
            self.test_spec_sha256 is None
            or self.fixture_manifest_sha256 is None
            or any(value is not None for value in assembly)
        ):
            raise ValueError("engineering plan requires one frozen test specification")
        return self


class ExecutionMediaRefV1(_Closed):
    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    asset_version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    sha256: str = Field(pattern=_HASH)
    byte_size: int = Field(gt=0)
    rights_status: Literal["PENDING_REVIEW", "CLEARED"]
    rights_decision_id: str | None = Field(default=None, pattern=r"^ard_[0-9a-f]{32}$")
    probe_evidence_id: str | None = Field(default=None, pattern=r"^mpe_[0-9a-f]{32}$")
    probe_sha256: str | None = Field(default=None, pattern=_HASH)
    inspection_sha256: str | None = Field(default=None, pattern=_HASH)

    @model_validator(mode="after")
    def paired_probe_identity(self) -> Self:
        if (self.probe_evidence_id is None) != (self.probe_sha256 is None):
            raise ValueError("probe ID and probe hash must be paired")
        if self.rights_status == "CLEARED" and self.rights_decision_id is None:
            raise ValueError("cleared media needs the exact human decision ID")
        return self


class ExecutionVideoClipV1(_Closed):
    clip_id: str = Field(pattern=_PLAN_ID)
    media: ExecutionMediaRefV1
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)
    source_in_frame: int = Field(ge=0)
    source_frame_count: int = Field(gt=0)
    embedded_audio: Literal["MUTE", "PLAY"]
    source_width: int = Field(ge=1, le=8192)
    source_height: int = Field(ge=1, le=8192)
    scale_mode: Literal["IDENTITY", "STRETCH_TO_CANVAS"]

    @model_validator(mode="after")
    def closed_range(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("video clip interval must be positive")
        if self.source_in_frame + self.end_frame - self.start_frame > self.source_frame_count:
            raise ValueError("video clip exceeds its selected source frames")
        if self.media.probe_evidence_id is None:
            raise ValueError("video clip requires exact persisted probe evidence")
        return self


class ExecutionVideoTrackV1(_Closed):
    track_id: str = Field(pattern=_PLAN_ID)
    layer_index: int = Field(ge=0, le=1)
    clips: tuple[ExecutionVideoClipV1, ...] = Field(min_length=1, max_length=1000)

    @field_validator("clips", mode="before")
    @classmethod
    def accept_json_clips(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value


class ExecutionAudioClipV1(_Closed):
    clip_id: str = Field(pattern=_PLAN_ID)
    media: ExecutionMediaRefV1
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)
    source_in_sample: int = Field(ge=0)
    source_end_sample: int = Field(gt=0)
    source_total_samples: int = Field(gt=0)
    source_sample_rate_hz: Literal[48000]
    gain_millidb: int = Field(ge=-60000, le=12000)
    script_version_id: str | None = Field(default=None, pattern=VERSION_ID_PATTERN)
    script_block_id: str | None = Field(default=None, pattern=BLOCK_ID_PATTERN)
    speaker_id: str | None = Field(default=None, pattern=r"^spk_[0-9a-f]{32}$")
    delivery: Literal["ON_SCREEN", "OFF_SCREEN"] | None = None

    @model_validator(mode="after")
    def closed_range(self) -> Self:
        if (
            self.end_frame <= self.start_frame
            or self.source_end_sample <= self.source_in_sample
            or self.source_end_sample > self.source_total_samples
        ):
            raise ValueError("audio clip must have positive frame and sample ranges")
        return self


class ExecutionAudioTrackV1(_Closed):
    track_id: str = Field(pattern=_PLAN_ID)
    role: Literal["DIALOGUE", "DIALOGUE_TEST", "BGM", "BGM_TEST", "SFX"]
    clips: tuple[ExecutionAudioClipV1, ...] = Field(min_length=1, max_length=1000)

    @field_validator("clips", mode="before")
    @classmethod
    def accept_json_clips(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def dialogue_binding(self) -> Self:
        for clip in self.clips:
            binding = (
                clip.script_version_id,
                clip.script_block_id,
                clip.speaker_id,
                clip.delivery,
            )
            if self.role in {"DIALOGUE", "DIALOGUE_TEST"} and any(
                value is None for value in binding
            ):
                raise ValueError("dialogue needs exact script and speaker binding")
            if self.role not in {"DIALOGUE", "DIALOGUE_TEST"} and any(
                value is not None for value in binding
            ):
                raise ValueError("non-dialogue audio cannot claim a script speaker")
        return self


class ExecutionSubtitleCueV1(_Closed):
    cue_id: str = Field(pattern=_PLAN_ID)
    script_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    script_block_id: str = Field(pattern=BLOCK_ID_PATTERN)
    script_content_hash: str = Field(pattern=_CONTENT_HASH)
    subtitle_file_sha256: str = Field(pattern=_HASH)
    text: str = Field(min_length=1, max_length=500)
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)
    font_family: str = Field(min_length=1, max_length=120)
    font_size_px: int = Field(ge=8, le=160)
    color_rgba: str = Field(pattern=r"^#[0-9A-Fa-f]{8}$")
    placement: Literal["BOTTOM_CENTER"] = "BOTTOM_CENTER"

    @model_validator(mode="after")
    def closed_range(self) -> Self:
        if self.end_frame <= self.start_frame:
            raise ValueError("subtitle interval must be positive")
        return self


class ExecutionVideoTransitionV1(_Closed):
    transition_id: str = Field(pattern=_PLAN_ID)
    kind: Literal["CROSS_DISSOLVE"]
    from_track_id: str = Field(pattern=_PLAN_ID)
    to_track_id: str = Field(pattern=_PLAN_ID)
    start_frame: int = Field(ge=0)
    end_frame: int = Field(gt=0)

    @model_validator(mode="after")
    def closed_range(self) -> Self:
        if self.end_frame <= self.start_frame or self.from_track_id == self.to_track_id:
            raise ValueError("transition needs two tracks and a positive overlap")
        return self


class MediaExecutionPlanV1(_Closed):
    schema_version: Literal[1] = 1
    scope: Literal["DRAFT_PREVIEW", "ENGINEERING_TEST"]
    source: ExecutionSourceV1
    sequence_timebase: SequenceTimebaseData
    canvas_width: int = Field(ge=1, le=8192)
    canvas_height: int = Field(ge=1, le=8192)
    total_frames: int = Field(ge=1, le=1_000_000)
    audio_master_sample_rate_hz: Literal[48000] = 48000
    audio_mix_policy: Literal["SUM_NO_NORMALIZE_NO_LIMITER"] = "SUM_NO_NORMALIZE_NO_LIMITER"
    subtitle_output_mode: Literal["NONE", "BURN_IN"]
    dialogue_speech_status: Literal["NOT_APPLICABLE", "DIALOGUE_SPEECH_NOT_TESTED"]
    video_overlap_mode: Literal["EXPLICIT_TRANSITION_FOR_OVERLAP"] = (
        "EXPLICIT_TRANSITION_FOR_OVERLAP"
    )
    video_tracks: tuple[ExecutionVideoTrackV1, ...] = Field(min_length=1, max_length=2)
    audio_tracks: tuple[ExecutionAudioTrackV1, ...] = Field(default=(), max_length=8)
    subtitle_cues: tuple[ExecutionSubtitleCueV1, ...] = Field(default=(), max_length=1000)
    video_transitions: tuple[ExecutionVideoTransitionV1, ...] = Field(default=(), max_length=100)
    absent_test_roles: tuple[Literal["SFX"], ...] = ()

    @field_validator(
        "video_tracks",
        "audio_tracks",
        "subtitle_cues",
        "video_transitions",
        "absent_test_roles",
        mode="before",
    )
    @classmethod
    def accept_json_arrays(cls, value: object) -> object:
        return tuple(value) if isinstance(value, list) else value

    @model_validator(mode="after")
    def complete_and_unambiguous(self) -> Self:
        if self.scope == "DRAFT_PREVIEW" and self.source.origin != "EPISODE_ASSEMBLY":
            raise ValueError("draft preview must derive from an exact assembly version")
        if self.scope == "ENGINEERING_TEST" and self.source.origin != "FROZEN_ENGINEERING_TEST":
            raise ValueError("engineering test must derive from a frozen fixture specification")
        if self.scope == "ENGINEERING_TEST" and self.absent_test_roles != ("SFX",):
            raise ValueError("the engineering test must mark SFX absent from its scope")
        if (
            self.scope == "ENGINEERING_TEST"
            and self.dialogue_speech_status != "DIALOGUE_SPEECH_NOT_TESTED"
        ):
            raise ValueError("the engineering tone test cannot claim tested speech")
        if self.scope == "DRAFT_PREVIEW" and self.absent_test_roles:
            raise ValueError("draft preview cannot claim test-only absent roles")
        if self.scope == "DRAFT_PREVIEW" and self.dialogue_speech_status != "NOT_APPLICABLE":
            raise ValueError("draft assembly preview cannot claim speech testing")
        if self.subtitle_output_mode != ("BURN_IN" if self.subtitle_cues else "NONE"):
            raise ValueError("subtitle output mode must match the exact cue set")
        if [track.layer_index for track in self.video_tracks] != list(
            range(len(self.video_tracks))
        ):
            raise ValueError("video layers must be ordered from zero without gaps")
        all_tracks: tuple[ExecutionVideoTrackV1 | ExecutionAudioTrackV1, ...] = (
            *self.video_tracks,
            *self.audio_tracks,
        )
        track_ids = [track.track_id for track in all_tracks]
        if len(track_ids) != len(set(track_ids)):
            raise ValueError("execution track IDs must be unique")
        clip_ids = [clip.clip_id for track in all_tracks for clip in track.clips]
        cue_ids = [cue.cue_id for cue in self.subtitle_cues]
        transition_ids = [transition.transition_id for transition in self.video_transitions]
        all_ids = [*track_ids, *clip_ids, *cue_ids, *transition_ids]
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("execution IDs must be unique")
        visual_intervals: list[tuple[int, int]] = []
        for track in self.video_tracks:
            cursor = 0
            for clip in track.clips:
                if clip.start_frame < cursor or clip.end_frame > self.total_frames:
                    raise ValueError("video clips overlap within a layer or exceed the sequence")
                if clip.scale_mode == "IDENTITY" and (
                    clip.source_width != self.canvas_width
                    or clip.source_height != self.canvas_height
                ):
                    raise ValueError(
                        "identity video scaling requires source and canvas dimensions to match",
                    )
                cursor = clip.end_frame
                visual_intervals.append((clip.start_frame, clip.end_frame))
        coverage = 0
        for start, end in sorted(visual_intervals):
            if start > coverage:
                raise ValueError("video layers leave an uncovered sequence frame")
            coverage = max(coverage, end)
        if coverage != self.total_frames:
            raise ValueError("video layers must end at total_frames")
        for audio_track in self.audio_tracks:
            cursor = 0
            for audio_clip in audio_track.clips:
                if audio_clip.start_frame < cursor or audio_clip.end_frame > self.total_frames:
                    raise ValueError("audio clips overlap within a track or exceed the sequence")
                expected_samples = sequence_frame_to_audio_sample(
                    audio_clip.end_frame, self.sequence_timebase
                ) - sequence_frame_to_audio_sample(audio_clip.start_frame, self.sequence_timebase)
                if audio_clip.source_end_sample - audio_clip.source_in_sample != expected_samples:
                    raise ValueError(
                        "audio source sample interval must equal its absolute frame span",
                    )
                cursor = audio_clip.end_frame
        cursor = 0
        for cue in self.subtitle_cues:
            if cue.start_frame < cursor or cue.end_frame > self.total_frames:
                raise ValueError("subtitle cues overlap or exceed the sequence")
            cursor = cue.end_frame
        video_by_id = {track.track_id: track for track in self.video_tracks}
        transition_end = 0
        for transition in self.video_transitions:
            if (
                transition.start_frame < transition_end
                or transition.end_frame > self.total_frames
                or transition.from_track_id not in video_by_id
                or transition.to_track_id not in video_by_id
            ):
                raise ValueError("transition order, tracks or range is invalid")
            if not all(
                any(
                    clip.start_frame <= transition.start_frame
                    and clip.end_frame >= transition.end_frame
                    for clip in video_by_id[track_id].clips
                )
                for track_id in (transition.from_track_id, transition.to_track_id)
            ):
                raise ValueError("both video tracks must cover every transition frame")
            transition_end = transition.end_frame
        if len(self.video_tracks) == 2:
            lower, upper = self.video_tracks
            overlaps = sorted(
                (max(a.start_frame, b.start_frame), min(a.end_frame, b.end_frame))
                for a in lower.clips
                for b in upper.clips
                if max(a.start_frame, b.start_frame) < min(a.end_frame, b.end_frame)
            )
            declared = [
                (transition.start_frame, transition.end_frame)
                for transition in self.video_transitions
                if transition.from_track_id == lower.track_id
                and transition.to_track_id == upper.track_id
            ]
            if overlaps != declared or len(declared) != len(self.video_transitions):
                raise ValueError("every video overlap needs one exact lower-to-upper transition")
        elif self.video_transitions:
            raise ValueError("single-track video cannot have a transition")
        for audio_track in self.audio_tracks:
            if self.scope == "DRAFT_PREVIEW" and audio_track.role.endswith("_TEST"):
                raise ValueError("test audio roles cannot enter a project preview plan")
            if self.scope == "ENGINEERING_TEST" and audio_track.role in {"DIALOGUE", "BGM", "SFX"}:
                raise ValueError("engineering test must retain its explicit test audio roles")
        return self

    @property
    def content_hash(self) -> str:
        return canonical_content_hash(self.model_dump(mode="json"))

    @property
    def plan_hash(self) -> str:
        return self.content_hash


class MediaExecutionPlanReceiptV1(_Closed):
    """Server-issued exact plan identity for preview and offline execution."""

    plan: MediaExecutionPlanV1
    plan_hash: str = Field(pattern=_CONTENT_HASH)

    @model_validator(mode="after")
    def matches_plan(self) -> Self:
        if self.plan_hash != self.plan.plan_hash:
            raise ValueError("plan receipt hash does not match its canonical content")
        return self


class FrozenEngineeringTestBindingsV1(_Closed):
    """QA-filled identities for the one ART04 125-frame synthetic composition.

    This selects already imported versions and a separately frozen QA manifest;
    it is not a project edit model or authority to render arbitrary media.
    """

    test_spec_sha256: str = Field(pattern=_HASH)
    fixture_manifest_sha256: str = Field(pattern=_HASH)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    blue_video: ExecutionMediaRefV1
    red_video: ExecutionMediaRefV1
    dialogue_tone: ExecutionMediaRefV1
    bgm_tone: ExecutionMediaRefV1
    test_script_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    test_script_content_hash: str = Field(pattern=_CONTENT_HASH)
    first_script_block_id: str = Field(pattern=BLOCK_ID_PATTERN)
    second_script_block_id: str = Field(pattern=BLOCK_ID_PATTERN)
    subtitle_file_sha256: str = Field(pattern=_HASH)
    dialogue_gain_millidb: Literal[0]
    bgm_gain_millidb: Literal[0]
    subtitle_font_family: str = Field(min_length=1, max_length=120)
    subtitle_font_size_px: int = Field(ge=8, le=160)
    subtitle_color_rgba: str = Field(pattern=r"^#[0-9A-Fa-f]{8}$")

    @model_validator(mode="after")
    def distinct_sources(self) -> Self:
        media = (self.blue_video, self.red_video, self.dialogue_tone, self.bgm_tone)
        identities = {(item.asset_id, item.asset_version_id, item.sha256) for item in media}
        if len(identities) != 4:
            raise ValueError("the four synthetic media sources must be distinct")
        if self.first_script_block_id == self.second_script_block_id:
            raise ValueError("the two test captions need distinct script blocks")
        return self


class FrozenTestAudioInspectionV1(_Closed):
    """QA-produced inspection receipt identity, separate from video probe30."""

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    asset_version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    asset_sha256: str = Field(pattern=_HASH)
    byte_size: int = Field(gt=0)
    inspection_sha256: str = Field(pattern=_HASH)
    codec: Literal["PCM_S16LE"]
    channels: Literal[1]
    sample_rate_hz: Literal[48000]
    total_samples: int = Field(gt=0)
