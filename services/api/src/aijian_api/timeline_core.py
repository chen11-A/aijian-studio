"""Immutable timeline domain, pure edit commands, and render-plan compiler."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from aijian_api.artifacts import canonical_content_hash
from aijian_api.media_contracts import (
    CONTENT_HASH_PATTERN,
    JSON_SAFE_INTEGER_MAX,
    NonNegativeStrictInteger,
    ProxyTimeMapV1,
    SequenceTimebaseData,
    sequence_frame_to_audio_sample,
)

TIMELINE_ID_PATTERN = r"^tl_[0-9a-f]{32}$"
TRACK_ID_PATTERN = r"^trk_[0-9a-f]{32}$"
CLIP_ID_PATTERN = r"^clp_[0-9a-f]{32}$"
MAX_TRACKS_PER_TIMELINE = 64
MAX_CLIPS_PER_TRACK = 10_000

MediaKind = Literal["VIDEO", "AUDIO"]
SourceSelection = Literal["ORIGINAL", "PROXY"]
RenderSegmentKind = Literal["CLIP", "GAP"]
PositiveFrameCount = Annotated[int, Field(strict=True, ge=1, le=JSON_SAFE_INTEGER_MAX)]
TimelineId = Annotated[str, Field(pattern=TIMELINE_ID_PATTERN)]
TrackId = Annotated[str, Field(pattern=TRACK_ID_PATTERN)]
ClipId = Annotated[str, Field(pattern=CLIP_ID_PATTERN)]


class TimelineCoreError(ValueError):
    """Fail-closed domain error with a stable machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


class SourceBindingData(BaseModel):
    """Hash-addressed original media with optional proxy map binding."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    media_kind: MediaKind
    original_asset_sha256: str = Field(pattern=CONTENT_HASH_PATTERN)
    available_source_frames: PositiveFrameCount
    proxy_asset_sha256: str | None = Field(default=None, pattern=CONTENT_HASH_PATTERN)
    proxy_time_map: ProxyTimeMapV1 | None = None

    @model_validator(mode="after")
    def require_consistent_proxy_binding(self) -> Self:
        has_proxy_hash = self.proxy_asset_sha256 is not None
        has_proxy_map = self.proxy_time_map is not None
        if has_proxy_hash != has_proxy_map:
            raise ValueError("proxy asset hash and proxy time map must be provided together")
        if self.proxy_time_map is None:
            return self
        if self.proxy_time_map.source_asset_sha256 != self.original_asset_sha256:
            raise ValueError("proxy map source hash must match original asset hash")
        if self.proxy_time_map.proxy_asset_sha256 != self.proxy_asset_sha256:
            raise ValueError("proxy map proxy hash must match proxy asset hash")
        return self


class ClipData(BaseModel):
    """One non-empty clip with absolute sequence-frame placement."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    clip_id: ClipId
    media_kind: MediaKind
    timeline_start_frame: NonNegativeStrictInteger
    duration_frames: PositiveFrameCount
    source_in_frame: NonNegativeStrictInteger
    source_selection: SourceSelection = "ORIGINAL"
    source: SourceBindingData

    @model_validator(mode="after")
    def require_source_bounds_and_kind(self) -> Self:
        if self.media_kind != self.source.media_kind:
            raise ValueError("clip media kind must match source media kind")
        source_end = self.source_in_frame + self.duration_frames
        if source_end > self.source.available_source_frames:
            raise ValueError("clip source range exceeds available source frames")
        if self.timeline_start_frame + self.duration_frames > JSON_SAFE_INTEGER_MAX:
            raise ValueError("clip timeline end exceeds JSON safe integer")
        if self.source_selection == "PROXY":
            _validate_proxy_selection_for_clip(
                source=self.source,
                source_in_frame=self.source_in_frame,
                duration_frames=self.duration_frames,
            )
        return self

    @property
    def timeline_end_frame(self) -> int:
        return self.timeline_start_frame + self.duration_frames

    @property
    def source_out_frame(self) -> int:
        return self.source_in_frame + self.duration_frames


class TrackData(BaseModel):
    """Ordered track of non-overlapping clips of one media kind."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    track_id: TrackId
    kind: MediaKind
    clips: tuple[ClipData, ...] = Field(default=(), max_length=MAX_CLIPS_PER_TRACK)

    @model_validator(mode="after")
    def require_non_overlapping_kind_matching_clips(self) -> Self:
        seen_clip_ids: set[str] = set()
        previous_end = 0
        previous_start = -1
        for clip in self.clips:
            if clip.clip_id in seen_clip_ids:
                raise ValueError(f"duplicate clip id on track: {clip.clip_id}")
            seen_clip_ids.add(clip.clip_id)
            if clip.media_kind != self.kind:
                raise ValueError("clip media kind must match track kind")
            if clip.timeline_start_frame < previous_end:
                raise ValueError("clips on a track must not overlap")
            if clip.timeline_start_frame < previous_start:
                raise ValueError("clips on a track must be ordered by timeline start")
            previous_start = clip.timeline_start_frame
            previous_end = clip.timeline_end_frame
        return self

    @property
    def duration_frames(self) -> int:
        if not self.clips:
            return 0
        return max(clip.timeline_end_frame for clip in self.clips)


class TimelineData(BaseModel):
    """Versioned immutable multi-track timeline."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    timeline_id: TimelineId
    revision: NonNegativeStrictInteger
    sequence_timebase: SequenceTimebaseData
    tracks: tuple[TrackData, ...] = Field(default=(), max_length=MAX_TRACKS_PER_TIMELINE)

    @model_validator(mode="after")
    def require_unique_ids_and_proxy_timebases(self) -> Self:
        track_ids: set[str] = set()
        clip_ids: set[str] = set()
        for track in self.tracks:
            if track.track_id in track_ids:
                raise ValueError(f"duplicate track id: {track.track_id}")
            track_ids.add(track.track_id)
            for clip in track.clips:
                if clip.clip_id in clip_ids:
                    raise ValueError(f"duplicate clip id: {clip.clip_id}")
                clip_ids.add(clip.clip_id)
                proxy_map = clip.source.proxy_time_map
                if proxy_map is not None and proxy_map.sequence_timebase != self.sequence_timebase:
                    raise ValueError("proxy map sequence timebase must match timeline")
        return self

    @property
    def duration_frames(self) -> int:
        if not self.tracks:
            return 0
        return max(track.duration_frames for track in self.tracks)


class RenderSegmentData(BaseModel):
    """One stable, serializable timeline segment for a future FFmpeg planner."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    segment_kind: RenderSegmentKind
    track_id: TrackId
    track_kind: MediaKind
    timeline_start_frame: NonNegativeStrictInteger
    timeline_end_frame: NonNegativeStrictInteger
    duration_frames: NonNegativeStrictInteger
    audio_sample_start: NonNegativeStrictInteger
    audio_sample_end: NonNegativeStrictInteger
    clip_id: ClipId | None = None
    source_selection: SourceSelection | None = None
    selected_asset_sha256: str | None = Field(default=None, pattern=CONTENT_HASH_PATTERN)
    original_asset_sha256: str | None = Field(default=None, pattern=CONTENT_HASH_PATTERN)
    proxy_asset_sha256: str | None = Field(default=None, pattern=CONTENT_HASH_PATTERN)
    source_in_frame: NonNegativeStrictInteger | None = None
    source_out_frame: NonNegativeStrictInteger | None = None
    media_kind: MediaKind | None = None

    @model_validator(mode="after")
    def require_segment_shape(self) -> Self:
        if self.timeline_end_frame < self.timeline_start_frame:
            raise ValueError("segment end must not precede start")
        if self.duration_frames != self.timeline_end_frame - self.timeline_start_frame:
            raise ValueError("segment duration must equal end - start")
        if self.audio_sample_end < self.audio_sample_start:
            raise ValueError("audio sample end must not precede start")
        if self.segment_kind == "GAP":
            if self.duration_frames == 0:
                raise ValueError("gap segments must be non-empty")
            if any(
                value is not None
                for value in (
                    self.clip_id,
                    self.source_selection,
                    self.selected_asset_sha256,
                    self.original_asset_sha256,
                    self.proxy_asset_sha256,
                    self.source_in_frame,
                    self.source_out_frame,
                    self.media_kind,
                )
            ):
                raise ValueError("gap segments must not carry clip source fields")
            return self
        if self.duration_frames < 1:
            raise ValueError("clip segments must be non-empty")
        if (
            self.clip_id is None
            or self.source_selection is None
            or self.selected_asset_sha256 is None
            or self.original_asset_sha256 is None
            or self.source_in_frame is None
            or self.source_out_frame is None
            or self.media_kind is None
        ):
            raise ValueError("clip segments require complete source fields")
        if self.source_out_frame != self.source_in_frame + self.duration_frames:
            raise ValueError("clip segment source out must equal source in + duration")
        return self


class RenderTrackPlanData(BaseModel):
    """Canonical per-track segment list, including explicit gaps."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    track_id: TrackId
    track_kind: MediaKind
    segments: tuple[RenderSegmentData, ...]


class RenderPlanData(BaseModel):
    """Deterministic compiled plan sufficient for later FFmpeg argv construction."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    timeline_id: TimelineId
    timeline_revision: NonNegativeStrictInteger
    sequence_timebase: SequenceTimebaseData
    working_audio_sample_rate_hz: Literal[48000] = 48000
    duration_frames: NonNegativeStrictInteger
    tracks: tuple[RenderTrackPlanData, ...]


def create_timeline(
    *,
    timeline_id: str,
    sequence_timebase: SequenceTimebaseData,
    tracks: tuple[TrackData, ...] = (),
    revision: int = 0,
) -> TimelineData:
    """Validate and construct a timeline revision."""

    return TimelineData(
        timeline_id=timeline_id,
        revision=revision,
        sequence_timebase=sequence_timebase,
        tracks=tracks,
    )


def trim_clip(
    timeline: TimelineData,
    *,
    expected_revision: int,
    clip_id: str,
    timeline_start_frame: int,
    duration_frames: int,
    source_in_frame: int,
) -> TimelineData:
    """Frame-exact trim with source bounds and non-overlap checks."""

    _require_revision(timeline, expected_revision)
    track, clip, _clip_index = _locate_clip(timeline, clip_id)
    start = _require_non_negative_frame(timeline_start_frame, name="timeline_start_frame")
    duration = _require_positive_frame_count(duration_frames, name="duration_frames")
    source_in = _require_non_negative_frame(source_in_frame, name="source_in_frame")

    if (
        start == clip.timeline_start_frame
        and duration == clip.duration_frames
        and source_in == clip.source_in_frame
    ):
        raise TimelineCoreError("NO_OP", "trim does not change clip bounds")
    if source_in + duration > clip.source.available_source_frames:
        raise TimelineCoreError("SOURCE_BOUNDS", "trim exceeds available source frames")
    if start + duration > JSON_SAFE_INTEGER_MAX:
        raise TimelineCoreError("INVALID_BOUNDS", "clip timeline end exceeds JSON safe integer")
    if clip.source_selection == "PROXY":
        try:
            _validate_proxy_selection_for_clip(
                source=clip.source,
                source_in_frame=source_in,
                duration_frames=duration,
            )
        except ValueError as exc:
            raise TimelineCoreError("INVALID_PROXY_MAP", str(exc)) from exc

    updated = _build_clip(
        clip_id=clip.clip_id,
        media_kind=clip.media_kind,
        timeline_start_frame=start,
        duration_frames=duration,
        source_in_frame=source_in,
        source_selection=clip.source_selection,
        source=clip.source,
    )
    new_clips = [item if item.clip_id != clip.clip_id else updated for item in track.clips]
    new_clips.sort(key=lambda item: (item.timeline_start_frame, item.clip_id))
    _assert_no_overlap(new_clips, error_code="OVERLAP")
    return _replace_track_clips(timeline, track.track_id, tuple(new_clips))


def reorder_track(
    timeline: TimelineData,
    *,
    expected_revision: int,
    track_id: str,
    ordered_clip_ids: tuple[str, ...],
) -> TimelineData:
    """Ripple-reorder clips on one track; preserve each clip's duration and source range."""

    _require_revision(timeline, expected_revision)
    track = _locate_track(timeline, track_id)
    existing_ids = tuple(clip.clip_id for clip in track.clips)
    if not existing_ids:
        raise TimelineCoreError("EMPTY_TRACK", "cannot reorder an empty track")
    if len(ordered_clip_ids) != len(existing_ids) or set(ordered_clip_ids) != set(existing_ids):
        raise TimelineCoreError(
            "INVALID_REORDER",
            "ordered_clip_ids must be a permutation of the track clip ids",
        )
    if len(set(ordered_clip_ids)) != len(ordered_clip_ids):
        raise TimelineCoreError("INVALID_REORDER", "ordered_clip_ids must not contain duplicates")
    if ordered_clip_ids == existing_ids:
        raise TimelineCoreError("NO_OP", "reorder does not change clip order")

    by_id = {clip.clip_id: clip for clip in track.clips}
    cursor = 0
    reordered: list[ClipData] = []
    for clip_id in ordered_clip_ids:
        clip = by_id[clip_id]
        if cursor + clip.duration_frames > JSON_SAFE_INTEGER_MAX:
            raise TimelineCoreError("INVALID_BOUNDS", "clip timeline end exceeds JSON safe integer")
        reordered.append(
            _build_clip(
                clip_id=clip.clip_id,
                media_kind=clip.media_kind,
                timeline_start_frame=cursor,
                duration_frames=clip.duration_frames,
                source_in_frame=clip.source_in_frame,
                source_selection=clip.source_selection,
                source=clip.source,
            )
        )
        cursor += clip.duration_frames
    return _replace_track_clips(timeline, track.track_id, tuple(reordered))


def replace_clip_source(
    timeline: TimelineData,
    *,
    expected_revision: int,
    clip_id: str,
    source: SourceBindingData,
    source_in_frame: int | None = None,
    source_selection: SourceSelection | None = None,
) -> TimelineData:
    """Replace source identity while preserving the timeline range by default."""

    _require_revision(timeline, expected_revision)
    track, clip, _clip_index = _locate_clip(timeline, clip_id)
    if source_in_frame is None:
        next_source_in = clip.source_in_frame
    else:
        next_source_in = _require_non_negative_frame(source_in_frame, name="source_in_frame")
    next_selection = clip.source_selection if source_selection is None else source_selection
    if source.media_kind != clip.media_kind:
        raise TimelineCoreError("MEDIA_KIND_MISMATCH", "replacement source kind must match clip")
    if next_source_in + clip.duration_frames > source.available_source_frames:
        raise TimelineCoreError(
            "SOURCE_BOUNDS",
            "replacement source is too short for the preserved timeline duration",
        )
    if source.proxy_time_map is not None:
        if source.proxy_time_map.sequence_timebase != timeline.sequence_timebase:
            raise TimelineCoreError(
                "INVALID_PROXY_MAP",
                "proxy map sequence timebase must match timeline",
            )
    if next_selection == "PROXY":
        try:
            _validate_proxy_selection_for_clip(
                source=source,
                source_in_frame=next_source_in,
                duration_frames=clip.duration_frames,
            )
        except ValueError as exc:
            raise TimelineCoreError("INVALID_PROXY_MAP", str(exc)) from exc

    if (
        source == clip.source
        and next_source_in == clip.source_in_frame
        and next_selection == clip.source_selection
    ):
        raise TimelineCoreError("NO_OP", "replace does not change source identity or bounds")

    updated = _build_clip(
        clip_id=clip.clip_id,
        media_kind=clip.media_kind,
        timeline_start_frame=clip.timeline_start_frame,
        duration_frames=clip.duration_frames,
        source_in_frame=next_source_in,
        source_selection=next_selection,
        source=source,
    )
    new_clips = tuple(item if item.clip_id != clip.clip_id else updated for item in track.clips)
    return _replace_track_clips(timeline, track.track_id, new_clips)


def select_clip_source(
    timeline: TimelineData,
    *,
    expected_revision: int,
    clip_id: str,
    source_selection: SourceSelection,
    proxy_asset_sha256: str | None = None,
    proxy_time_map: ProxyTimeMapV1 | None = None,
) -> TimelineData:
    """Select ORIGINAL or PROXY playback source; proxy maps fail closed."""

    _require_revision(timeline, expected_revision)
    track, clip, _clip_index = _locate_clip(timeline, clip_id)

    if source_selection == "ORIGINAL":
        next_source = clip.source
        if proxy_asset_sha256 is not None or proxy_time_map is not None:
            if proxy_asset_sha256 is None or proxy_time_map is None:
                raise TimelineCoreError(
                    "INVALID_PROXY_MAP",
                    "proxy asset hash and proxy time map must be provided together",
                )
            next_source = _build_source_binding(
                media_kind=clip.source.media_kind,
                original_asset_sha256=clip.source.original_asset_sha256,
                available_source_frames=clip.source.available_source_frames,
                proxy_asset_sha256=proxy_asset_sha256,
                proxy_time_map=proxy_time_map,
            )
            assert next_source.proxy_time_map is not None
            if next_source.proxy_time_map.sequence_timebase != timeline.sequence_timebase:
                raise TimelineCoreError(
                    "INVALID_PROXY_MAP",
                    "proxy map sequence timebase must match timeline",
                )
    else:
        bound_proxy_hash = proxy_asset_sha256 or clip.source.proxy_asset_sha256
        bound_proxy_map = proxy_time_map or clip.source.proxy_time_map
        if bound_proxy_hash is None or bound_proxy_map is None:
            raise TimelineCoreError(
                "INVALID_PROXY_MAP",
                "PROXY selection requires proxy asset hash and ProxyTimeMapV1",
            )
        next_source = _build_source_binding(
            media_kind=clip.source.media_kind,
            original_asset_sha256=clip.source.original_asset_sha256,
            available_source_frames=clip.source.available_source_frames,
            proxy_asset_sha256=bound_proxy_hash,
            proxy_time_map=bound_proxy_map,
        )
        assert next_source.proxy_time_map is not None
        if next_source.proxy_time_map.sequence_timebase != timeline.sequence_timebase:
            raise TimelineCoreError(
                "INVALID_PROXY_MAP",
                "proxy map sequence timebase must match timeline",
            )
        try:
            _validate_proxy_selection_for_clip(
                source=next_source,
                source_in_frame=clip.source_in_frame,
                duration_frames=clip.duration_frames,
            )
        except ValueError as exc:
            raise TimelineCoreError("INVALID_PROXY_MAP", str(exc)) from exc

    if source_selection == clip.source_selection and next_source == clip.source:
        raise TimelineCoreError("NO_OP", "source selection and binding are unchanged")

    updated = _build_clip(
        clip_id=clip.clip_id,
        media_kind=clip.media_kind,
        timeline_start_frame=clip.timeline_start_frame,
        duration_frames=clip.duration_frames,
        source_in_frame=clip.source_in_frame,
        source_selection=source_selection,
        source=next_source,
    )
    new_clips = tuple(item if item.clip_id != clip.clip_id else updated for item in track.clips)
    return _replace_track_clips(timeline, track.track_id, new_clips)


def compile_render_plan(timeline: TimelineData) -> RenderPlanData:
    """Compile absolute-frame segments with explicit gaps and 48 kHz sample bounds."""

    duration = timeline.duration_frames
    track_plans: list[RenderTrackPlanData] = []
    for track in sorted(timeline.tracks, key=lambda item: item.track_id):
        segments: list[RenderSegmentData] = []
        cursor = 0
        ordered_clips = sorted(
            track.clips,
            key=lambda item: (item.timeline_start_frame, item.clip_id),
        )
        for clip in ordered_clips:
            if clip.timeline_start_frame > cursor:
                segments.append(
                    _gap_segment(
                        track=track,
                        start=cursor,
                        end=clip.timeline_start_frame,
                        sequence_timebase=timeline.sequence_timebase,
                    )
                )
            segments.append(
                _clip_segment(
                    track=track,
                    clip=clip,
                    sequence_timebase=timeline.sequence_timebase,
                )
            )
            cursor = clip.timeline_end_frame
        if duration > cursor:
            segments.append(
                _gap_segment(
                    track=track,
                    start=cursor,
                    end=duration,
                    sequence_timebase=timeline.sequence_timebase,
                )
            )
        track_plans.append(
            RenderTrackPlanData(
                track_id=track.track_id,
                track_kind=track.kind,
                segments=tuple(segments),
            )
        )
    return RenderPlanData(
        timeline_id=timeline.timeline_id,
        timeline_revision=timeline.revision,
        sequence_timebase=timeline.sequence_timebase,
        duration_frames=duration,
        tracks=tuple(track_plans),
    )


def render_plan_canonical_hash(plan: RenderPlanData) -> str:
    """Content-addressed hash for golden matrices and export cache keys.

    Omits timeline_id and timeline_revision: those are provenance, not render content.
    """

    payload = plan.model_dump(mode="json")
    del payload["timeline_id"]
    del payload["timeline_revision"]
    return canonical_content_hash(payload)


def _require_strict_int(value: object, *, name: str, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TimelineCoreError(code, f"{name} must be a strict integer")
    return value


def _require_non_negative_frame(value: object, *, name: str) -> int:
    number = _require_strict_int(value, name=name, code="INVALID_BOUNDS")
    if number < 0 or number > JSON_SAFE_INTEGER_MAX:
        raise TimelineCoreError(
            "INVALID_BOUNDS",
            f"{name} must be a JSON-safe non-negative integer",
        )
    return number


def _require_positive_frame_count(value: object, *, name: str) -> int:
    number = _require_strict_int(value, name=name, code="INVALID_DURATION")
    if number < 1 or number > JSON_SAFE_INTEGER_MAX:
        raise TimelineCoreError(
            "INVALID_DURATION",
            f"{name} must be a positive JSON-safe integer",
        )
    return number


def _require_revision(timeline: TimelineData, expected_revision: object) -> None:
    revision = _require_strict_int(
        expected_revision,
        name="expected_revision",
        code="STALE_REVISION",
    )
    if revision != timeline.revision:
        raise TimelineCoreError(
            "STALE_REVISION",
            f"expected revision {revision}, actual {timeline.revision}",
        )


def _locate_track(timeline: TimelineData, track_id: str) -> TrackData:
    for track in timeline.tracks:
        if track.track_id == track_id:
            return track
    raise TimelineCoreError("UNKNOWN_TRACK", f"unknown track id: {track_id}")


def _locate_clip(timeline: TimelineData, clip_id: str) -> tuple[TrackData, ClipData, int]:
    for track in timeline.tracks:
        for index, clip in enumerate(track.clips):
            if clip.clip_id == clip_id:
                return track, clip, index
    raise TimelineCoreError("UNKNOWN_CLIP", f"unknown clip id: {clip_id}")


def _build_clip(
    *,
    clip_id: str,
    media_kind: MediaKind,
    timeline_start_frame: int,
    duration_frames: int,
    source_in_frame: int,
    source_selection: SourceSelection,
    source: SourceBindingData,
) -> ClipData:
    try:
        return ClipData(
            clip_id=clip_id,
            media_kind=media_kind,
            timeline_start_frame=timeline_start_frame,
            duration_frames=duration_frames,
            source_in_frame=source_in_frame,
            source_selection=source_selection,
            source=source,
        )
    except ValidationError as exc:
        raise TimelineCoreError("INVALID_BOUNDS", str(exc)) from exc


def _build_source_binding(
    *,
    media_kind: MediaKind,
    original_asset_sha256: str,
    available_source_frames: int,
    proxy_asset_sha256: str | None,
    proxy_time_map: ProxyTimeMapV1 | None,
) -> SourceBindingData:
    try:
        return SourceBindingData(
            media_kind=media_kind,
            original_asset_sha256=original_asset_sha256,
            available_source_frames=available_source_frames,
            proxy_asset_sha256=proxy_asset_sha256,
            proxy_time_map=proxy_time_map,
        )
    except ValidationError as exc:
        raise TimelineCoreError("INVALID_PROXY_MAP", str(exc)) from exc


def _replace_track_clips(
    timeline: TimelineData,
    track_id: str,
    clips: tuple[ClipData, ...],
) -> TimelineData:
    new_tracks: list[TrackData] = []
    found = False
    for track in timeline.tracks:
        if track.track_id != track_id:
            new_tracks.append(track)
            continue
        found = True
        try:
            new_tracks.append(
                TrackData(
                    track_id=track.track_id,
                    kind=track.kind,
                    clips=clips,
                )
            )
        except ValidationError as exc:
            raise TimelineCoreError("INVALID_BOUNDS", str(exc)) from exc
    if not found:
        raise TimelineCoreError("UNKNOWN_TRACK", f"unknown track id: {track_id}")
    try:
        return TimelineData(
            schema_version=timeline.schema_version,
            timeline_id=timeline.timeline_id,
            revision=timeline.revision + 1,
            sequence_timebase=timeline.sequence_timebase,
            tracks=tuple(new_tracks),
        )
    except ValidationError as exc:
        raise TimelineCoreError("INVALID_BOUNDS", str(exc)) from exc


def _assert_no_overlap(clips: list[ClipData], *, error_code: str) -> None:
    previous_end = 0
    for clip in sorted(clips, key=lambda item: (item.timeline_start_frame, item.clip_id)):
        if clip.timeline_start_frame < previous_end:
            raise TimelineCoreError(error_code, "clips on a track must not overlap")
        previous_end = clip.timeline_end_frame


def _validate_proxy_selection_for_clip(
    *,
    source: SourceBindingData,
    source_in_frame: int,
    duration_frames: int,
) -> None:
    if source.proxy_asset_sha256 is None or source.proxy_time_map is None:
        raise ValueError("PROXY selection requires proxy asset hash and ProxyTimeMapV1")
    proxy_map = source.proxy_time_map
    if proxy_map.source_asset_sha256 != source.original_asset_sha256:
        raise ValueError("proxy map source hash must match original asset hash")
    if proxy_map.proxy_asset_sha256 != source.proxy_asset_sha256:
        raise ValueError("proxy map proxy hash must match proxy asset hash")
    required_last_frame = source_in_frame + duration_frames - 1
    if required_last_frame >= len(proxy_map.entries):
        raise ValueError("proxy map does not cover the selected source frame range")


def _selected_asset_sha256(clip: ClipData) -> str:
    if clip.source_selection == "ORIGINAL":
        return clip.source.original_asset_sha256
    if clip.source.proxy_asset_sha256 is None:
        raise TimelineCoreError("INVALID_PROXY_MAP", "proxy selection missing proxy asset hash")
    return clip.source.proxy_asset_sha256


def _gap_segment(
    *,
    track: TrackData,
    start: int,
    end: int,
    sequence_timebase: SequenceTimebaseData,
) -> RenderSegmentData:
    return RenderSegmentData(
        segment_kind="GAP",
        track_id=track.track_id,
        track_kind=track.kind,
        timeline_start_frame=start,
        timeline_end_frame=end,
        duration_frames=end - start,
        audio_sample_start=sequence_frame_to_audio_sample(start, sequence_timebase),
        audio_sample_end=sequence_frame_to_audio_sample(end, sequence_timebase),
    )


def _clip_segment(
    *,
    track: TrackData,
    clip: ClipData,
    sequence_timebase: SequenceTimebaseData,
) -> RenderSegmentData:
    return RenderSegmentData(
        segment_kind="CLIP",
        track_id=track.track_id,
        track_kind=track.kind,
        timeline_start_frame=clip.timeline_start_frame,
        timeline_end_frame=clip.timeline_end_frame,
        duration_frames=clip.duration_frames,
        audio_sample_start=sequence_frame_to_audio_sample(
            clip.timeline_start_frame,
            sequence_timebase,
        ),
        audio_sample_end=sequence_frame_to_audio_sample(
            clip.timeline_end_frame,
            sequence_timebase,
        ),
        clip_id=clip.clip_id,
        source_selection=clip.source_selection,
        selected_asset_sha256=_selected_asset_sha256(clip),
        original_asset_sha256=clip.source.original_asset_sha256,
        proxy_asset_sha256=clip.source.proxy_asset_sha256,
        source_in_frame=clip.source_in_frame,
        source_out_frame=clip.source_out_frame,
        media_kind=clip.media_kind,
    )
