"""Immutable, frame-addressed Phase 0 timeline editing domain."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.media_contracts import (
    CONTENT_HASH_PATTERN,
    JSON_SAFE_INTEGER_MAX,
    NonNegativeStrictInteger,
    SequenceTimebaseData,
)

TimelineId = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")]
PositiveFrameCount = Annotated[
    int,
    Field(strict=True, gt=0, le=JSON_SAFE_INTEGER_MAX),
]


class TimelineEditError(ValueError):
    """A deterministic command rejection that leaves the input version untouched."""


class TimelineProxyRefV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    proxy_asset_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    editable_frame_count: PositiveFrameCount
    sequence_timebase: SequenceTimebaseData
    mapping_schema_version: Literal[1] = 1


class TimelineAssetV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    asset_id: TimelineId
    source_asset_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    source_frame_count: PositiveFrameCount
    proxy: TimelineProxyRefV1 | None = None

    @property
    def editable_frame_count(self) -> int:
        return (
            self.proxy.editable_frame_count if self.proxy is not None else self.source_frame_count
        )

    @property
    def editing_asset_sha256(self) -> str:
        return self.proxy.proxy_asset_sha256 if self.proxy is not None else self.source_asset_sha256


class TimelineClipV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    clip_id: TimelineId
    asset_id: TimelineId
    source_in_frame: NonNegativeStrictInteger
    duration_frames: PositiveFrameCount


class TimelineVersionV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    timeline_id: TimelineId
    revision: NonNegativeStrictInteger
    sequence_timebase: SequenceTimebaseData
    width: Literal[1080] = 1080
    height: Literal[1920] = 1920
    assets: tuple[TimelineAssetV1, ...] = Field(min_length=1, max_length=10_000)
    clips: tuple[TimelineClipV1, ...] = Field(min_length=1, max_length=10_000)

    @model_validator(mode="after")
    def require_closed_frame_ranges(self) -> Self:
        asset_ids = [asset.asset_id for asset in self.assets]
        if len(set(asset_ids)) != len(asset_ids):
            raise ValueError("timeline asset IDs must be unique")
        clip_ids = [clip.clip_id for clip in self.clips]
        if len(set(clip_ids)) != len(clip_ids):
            raise ValueError("timeline clip IDs must be unique")

        assets = {asset.asset_id: asset for asset in self.assets}
        total_duration = 0
        for timeline_asset in self.assets:
            if (
                timeline_asset.proxy is not None
                and timeline_asset.proxy.sequence_timebase != self.sequence_timebase
            ):
                raise ValueError("proxy timebase must match the timeline timebase")
        for clip in self.clips:
            referenced_asset = assets.get(clip.asset_id)
            if referenced_asset is None:
                raise ValueError("timeline clip references a missing asset")
            if clip.source_in_frame + clip.duration_frames > referenced_asset.editable_frame_count:
                raise ValueError("timeline clip exceeds its editable frame range")
            total_duration += clip.duration_frames
            if total_duration > JSON_SAFE_INTEGER_MAX:
                raise ValueError("timeline total duration exceeds JSON safe integer")
        return self

    @property
    def total_duration_frames(self) -> int:
        return sum(clip.duration_frames for clip in self.clips)

    def asset_by_id(self, asset_id: str) -> TimelineAssetV1:
        for asset in self.assets:
            if asset.asset_id == asset_id:
                return asset
        raise TimelineEditError("timeline asset was not found")


def _require_revision(timeline: TimelineVersionV1, expected_revision: int) -> None:
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision != timeline.revision
    ):
        raise TimelineEditError("timeline revision conflict")


def _clip_index(timeline: TimelineVersionV1, clip_id: str) -> int:
    for index, clip in enumerate(timeline.clips):
        if clip.clip_id == clip_id:
            return index
    raise TimelineEditError("timeline clip was not found")


def _next_version(
    timeline: TimelineVersionV1,
    clips: tuple[TimelineClipV1, ...],
) -> TimelineVersionV1:
    payload = timeline.model_dump(mode="python", exclude_computed_fields=True)
    payload["revision"] = timeline.revision + 1
    payload["clips"] = clips
    return TimelineVersionV1.model_validate(payload)


def _require_range(asset: TimelineAssetV1, source_in_frame: int, duration_frames: int) -> None:
    if (
        isinstance(source_in_frame, bool)
        or not isinstance(source_in_frame, int)
        or source_in_frame < 0
        or isinstance(duration_frames, bool)
        or not isinstance(duration_frames, int)
        or duration_frames <= 0
        or source_in_frame > JSON_SAFE_INTEGER_MAX
        or duration_frames > JSON_SAFE_INTEGER_MAX
        or source_in_frame + duration_frames > asset.editable_frame_count
    ):
        raise TimelineEditError("clip exceeds the asset editable frame range")


def trim_clip(
    timeline: TimelineVersionV1,
    clip_id: str,
    *,
    new_source_in_frame: int,
    new_duration_frames: int,
    expected_revision: int,
) -> TimelineVersionV1:
    _require_revision(timeline, expected_revision)
    index = _clip_index(timeline, clip_id)
    existing = timeline.clips[index]
    asset = timeline.asset_by_id(existing.asset_id)
    _require_range(asset, new_source_in_frame, new_duration_frames)
    replacement = TimelineClipV1(
        clip_id=existing.clip_id,
        asset_id=existing.asset_id,
        source_in_frame=new_source_in_frame,
        duration_frames=new_duration_frames,
    )
    if replacement == existing:
        raise TimelineEditError("trim does not change the timeline")
    clips = list(timeline.clips)
    clips[index] = replacement
    return _next_version(timeline, tuple(clips))


def reorder_clip(
    timeline: TimelineVersionV1,
    clip_id: str,
    *,
    new_index: int,
    expected_revision: int,
) -> TimelineVersionV1:
    _require_revision(timeline, expected_revision)
    old_index = _clip_index(timeline, clip_id)
    if (
        isinstance(new_index, bool)
        or not isinstance(new_index, int)
        or not 0 <= new_index < len(timeline.clips)
    ):
        raise TimelineEditError("timeline target index is invalid")
    if new_index == old_index:
        raise TimelineEditError("reorder does not change the timeline")
    clips = list(timeline.clips)
    clip = clips.pop(old_index)
    clips.insert(new_index, clip)
    return _next_version(timeline, tuple(clips))


def replace_clip(
    timeline: TimelineVersionV1,
    clip_id: str,
    *,
    replacement_asset_id: str,
    replacement_source_in_frame: int,
    expected_revision: int,
) -> TimelineVersionV1:
    _require_revision(timeline, expected_revision)
    index = _clip_index(timeline, clip_id)
    existing = timeline.clips[index]
    asset = timeline.asset_by_id(replacement_asset_id)
    _require_range(asset, replacement_source_in_frame, existing.duration_frames)
    replacement = TimelineClipV1(
        clip_id=existing.clip_id,
        asset_id=asset.asset_id,
        source_in_frame=replacement_source_in_frame,
        duration_frames=existing.duration_frames,
    )
    if replacement == existing:
        raise TimelineEditError("replace does not change the timeline")
    clips = list(timeline.clips)
    clips[index] = replacement
    return _next_version(timeline, tuple(clips))
