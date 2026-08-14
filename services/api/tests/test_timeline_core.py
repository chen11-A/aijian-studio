"""Golden and adversarial tests for the immutable timeline domain core."""

from __future__ import annotations

from contextlib import AbstractContextManager
from fractions import Fraction
from random import Random

import pytest
from aijian_api.media_contracts import (
    JSON_SAFE_INTEGER_MAX,
    MediaTimestampData,
    ProxyFrameMapEntryData,
    ProxyTimeMapV1,
    SequenceTimebaseData,
    sequence_frame_to_audio_sample,
)
from aijian_api.timeline_core import (
    ClipData,
    MediaKind,
    SourceBindingData,
    SourceSelection,
    TimelineCoreError,
    TimelineData,
    TrackData,
    compile_render_plan,
    create_timeline,
    render_plan_canonical_hash,
    reorder_track,
    replace_clip_source,
    select_clip_source,
    trim_clip,
)
from pydantic import ValidationError

HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"
HASH_C = f"sha256:{'c' * 64}"
HASH_D = f"sha256:{'d' * 64}"

TIMELINE_ID = f"tl_{'1' * 32}"
TRACK_V = f"trk_{'2' * 32}"
TRACK_A = f"trk_{'3' * 32}"
CLIP_1 = f"clp_{'4' * 32}"
CLIP_2 = f"clp_{'5' * 32}"
CLIP_3 = f"clp_{'6' * 32}"
CLIP_4 = f"clp_{'7' * 32}"

PHASE0_RATES = ((24000, 1001), (24, 1), (25, 1), (30000, 1001))


def _timebase(num: int = 25, den: int = 1) -> SequenceTimebaseData:
    return SequenceTimebaseData(
        frame_rate={"num": num, "den": den},
        timecode_mode="NON_DROP_FRAME",
    )


def _source(
    *,
    kind: MediaKind = "VIDEO",
    asset: str = HASH_A,
    frames: int = 1_000,
    proxy_asset: str | None = None,
    proxy_map: ProxyTimeMapV1 | None = None,
) -> SourceBindingData:
    return SourceBindingData(
        media_kind=kind,
        original_asset_sha256=asset,
        available_source_frames=frames,
        proxy_asset_sha256=proxy_asset,
        proxy_time_map=proxy_map,
    )


def _clip(
    clip_id: str,
    *,
    kind: MediaKind = "VIDEO",
    start: int,
    duration: int,
    source_in: int = 0,
    source: SourceBindingData | None = None,
    selection: SourceSelection = "ORIGINAL",
) -> ClipData:
    binding = source or _source(kind=kind, frames=max(source_in + duration, duration))
    return ClipData(
        clip_id=clip_id,
        media_kind=kind,
        timeline_start_frame=start,
        duration_frames=duration,
        source_in_frame=source_in,
        source_selection=selection,
        source=binding,
    )


def _proxy_map(
    *,
    frames: int,
    source_hash: str = HASH_A,
    proxy_hash: str = HASH_B,
    timebase: SequenceTimebaseData | None = None,
) -> ProxyTimeMapV1:
    tb = timebase or _timebase()
    entries = tuple(
        ProxyFrameMapEntryData(
            proxy_frame_index=index,
            source_frame_index=index,
            source_pts=MediaTimestampData(
                ticks=index * 3600,
                time_base={"num": 1, "den": 90_000},
            ),
        )
        for index in range(frames)
    )
    return ProxyTimeMapV1(
        source_asset_sha256=source_hash,
        proxy_asset_sha256=proxy_hash,
        source_video_stream_index=0,
        sequence_timebase=tb,
        entries=entries,
    )


def _basic_timeline(
    *,
    num: int = 25,
    den: int = 1,
    with_audio: bool = True,
    gap_before_second: bool = False,
) -> TimelineData:
    second_start = 50 if gap_before_second else 40
    video = TrackData(
        track_id=TRACK_V,
        kind="VIDEO",
        clips=(
            _clip(CLIP_1, start=0, duration=40, source_in=10),
            _clip(
                CLIP_2,
                start=second_start,
                duration=30,
                source_in=0,
                source=_source(asset=HASH_C, frames=500),
            ),
        ),
    )
    tracks: list[TrackData] = [video]
    if with_audio:
        tracks.append(
            TrackData(
                track_id=TRACK_A,
                kind="AUDIO",
                clips=(
                    _clip(
                        CLIP_3,
                        kind="AUDIO",
                        start=0,
                        duration=70,
                        source=_source(kind="AUDIO", asset=HASH_D, frames=500),
                    ),
                ),
            )
        )
    return create_timeline(
        timeline_id=TIMELINE_ID,
        sequence_timebase=_timebase(num, den),
        tracks=tuple(tracks),
        revision=0,
    )


def _raise_code(code: str) -> AbstractContextManager[pytest.ExceptionInfo[TimelineCoreError]]:
    return pytest.raises(TimelineCoreError, match=code)


@pytest.mark.parametrize(("num", "den"), PHASE0_RATES)
def test_create_timeline_accepts_all_phase0_sequence_rates(num: int, den: int) -> None:
    timeline = _basic_timeline(num=num, den=den)
    plan = compile_render_plan(timeline)

    assert timeline.sequence_timebase.frame_rate.num == num
    assert timeline.sequence_timebase.frame_rate.den == den
    assert plan.duration_frames == timeline.duration_frames
    assert plan.working_audio_sample_rate_hz == 48000


def test_model_rejects_duplicate_ids_overlap_zero_length_and_kind_mismatch() -> None:
    with pytest.raises(ValidationError, match="duplicate clip id"):
        TrackData(
            track_id=TRACK_V,
            kind="VIDEO",
            clips=(
                _clip(CLIP_1, start=0, duration=10),
                _clip(CLIP_1, start=10, duration=10),
            ),
        )

    with pytest.raises(ValidationError, match="must not overlap"):
        TrackData(
            track_id=TRACK_V,
            kind="VIDEO",
            clips=(
                _clip(CLIP_1, start=0, duration=20),
                _clip(CLIP_2, start=10, duration=10),
            ),
        )

    with pytest.raises(ValidationError):
        _clip(CLIP_1, start=0, duration=0)

    with pytest.raises(ValidationError, match="must match track kind"):
        TrackData(
            track_id=TRACK_V,
            kind="VIDEO",
            clips=(_clip(CLIP_1, kind="AUDIO", start=0, duration=10),),
        )

    with pytest.raises(ValidationError, match="duplicate track id"):
        create_timeline(
            timeline_id=TIMELINE_ID,
            sequence_timebase=_timebase(),
            tracks=(
                TrackData(track_id=TRACK_V, kind="VIDEO", clips=()),
                TrackData(track_id=TRACK_V, kind="AUDIO", clips=()),
            ),
        )

    with pytest.raises(ValidationError, match="duplicate clip id"):
        create_timeline(
            timeline_id=TIMELINE_ID,
            sequence_timebase=_timebase(),
            tracks=(
                TrackData(
                    track_id=TRACK_V,
                    kind="VIDEO",
                    clips=(_clip(CLIP_1, start=0, duration=10),),
                ),
                TrackData(
                    track_id=TRACK_A,
                    kind="AUDIO",
                    clips=(_clip(CLIP_1, kind="AUDIO", start=0, duration=10),),
                ),
            ),
        )


def test_model_rejects_floats_and_source_out_of_bounds() -> None:
    with pytest.raises(ValidationError):
        ClipData.model_validate(
            {
                "clip_id": CLIP_1,
                "media_kind": "VIDEO",
                "timeline_start_frame": 0.0,
                "duration_frames": 10,
                "source_in_frame": 0,
                "source_selection": "ORIGINAL",
                "source": {
                    "media_kind": "VIDEO",
                    "original_asset_sha256": HASH_A,
                    "available_source_frames": 100,
                },
            }
        )

    with pytest.raises(ValidationError, match="exceeds available source"):
        _clip(CLIP_1, start=0, duration=50, source_in=60, source=_source(frames=100))


def test_trim_is_frame_exact_and_rejects_overlap_stale_and_noop() -> None:
    timeline = _basic_timeline(gap_before_second=True)
    trimmed = trim_clip(
        timeline,
        expected_revision=0,
        clip_id=CLIP_1,
        timeline_start_frame=5,
        duration_frames=30,
        source_in_frame=15,
    )

    clip = next(c for t in trimmed.tracks for c in t.clips if c.clip_id == CLIP_1)
    assert trimmed.revision == 1
    assert clip.timeline_start_frame == 5
    assert clip.duration_frames == 30
    assert clip.source_in_frame == 15
    assert timeline.revision == 0

    with _raise_code("STALE_REVISION") as stale:
        trim_clip(
            trimmed,
            expected_revision=0,
            clip_id=CLIP_1,
            timeline_start_frame=5,
            duration_frames=20,
            source_in_frame=15,
        )
    assert stale.value.code == "STALE_REVISION"

    with _raise_code("NO_OP") as noop:
        trim_clip(
            trimmed,
            expected_revision=1,
            clip_id=CLIP_1,
            timeline_start_frame=5,
            duration_frames=30,
            source_in_frame=15,
        )
    assert noop.value.code == "NO_OP"

    with _raise_code("OVERLAP") as overlap:
        trim_clip(
            trimmed,
            expected_revision=1,
            clip_id=CLIP_1,
            timeline_start_frame=40,
            duration_frames=30,
            source_in_frame=15,
        )
    assert overlap.value.code == "OVERLAP"

    with _raise_code("SOURCE_BOUNDS") as source_bounds:
        trim_clip(
            trimmed,
            expected_revision=1,
            clip_id=CLIP_1,
            timeline_start_frame=5,
            duration_frames=900,
            source_in_frame=15,
        )
    assert source_bounds.value.code == "SOURCE_BOUNDS"

    with _raise_code("UNKNOWN_CLIP") as unknown:
        trim_clip(
            trimmed,
            expected_revision=1,
            clip_id=CLIP_4,
            timeline_start_frame=0,
            duration_frames=10,
            source_in_frame=0,
        )
    assert unknown.value.code == "UNKNOWN_CLIP"


def test_trim_rejects_non_int_bool_and_json_unsafe_end() -> None:
    timeline = _basic_timeline()

    with _raise_code("INVALID_BOUNDS") as float_start:
        trim_clip(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            timeline_start_frame=1.5,  # type: ignore[arg-type]
            duration_frames=10,
            source_in_frame=10,
        )
    assert float_start.value.code == "INVALID_BOUNDS"

    with _raise_code("INVALID_DURATION") as bool_duration:
        trim_clip(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            timeline_start_frame=0,
            duration_frames=True,  # type: ignore[arg-type]
            source_in_frame=10,
        )
    assert bool_duration.value.code == "INVALID_DURATION"

    with _raise_code("INVALID_DURATION") as zero_duration:
        trim_clip(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            timeline_start_frame=0,
            duration_frames=0,
            source_in_frame=10,
        )
    assert zero_duration.value.code == "INVALID_DURATION"

    with _raise_code("INVALID_BOUNDS") as negative:
        trim_clip(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            timeline_start_frame=-1,
            duration_frames=10,
            source_in_frame=10,
        )
    assert negative.value.code == "INVALID_BOUNDS"

    with _raise_code("STALE_REVISION") as float_revision:
        trim_clip(
            timeline,
            expected_revision=0.0,  # type: ignore[arg-type]
            clip_id=CLIP_1,
            timeline_start_frame=1,
            duration_frames=10,
            source_in_frame=10,
        )
    assert float_revision.value.code == "STALE_REVISION"

    with _raise_code("INVALID_BOUNDS") as unsafe_end:
        trim_clip(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            timeline_start_frame=JSON_SAFE_INTEGER_MAX,
            duration_frames=1,
            source_in_frame=10,
        )
    assert unsafe_end.value.code == "INVALID_BOUNDS"


def test_reorder_ripples_and_preserves_source_ranges() -> None:
    timeline = _basic_timeline(gap_before_second=True)
    before = {clip.clip_id: clip for track in timeline.tracks for clip in track.clips}
    reordered = reorder_track(
        timeline,
        expected_revision=0,
        track_id=TRACK_V,
        ordered_clip_ids=(CLIP_2, CLIP_1),
    )
    video = next(track for track in reordered.tracks if track.track_id == TRACK_V)
    assert [clip.clip_id for clip in video.clips] == [CLIP_2, CLIP_1]
    assert video.clips[0].timeline_start_frame == 0
    assert video.clips[0].duration_frames == before[CLIP_2].duration_frames
    assert video.clips[0].source_in_frame == before[CLIP_2].source_in_frame
    assert video.clips[1].timeline_start_frame == before[CLIP_2].duration_frames
    assert video.clips[1].duration_frames == before[CLIP_1].duration_frames
    assert video.clips[1].source_in_frame == before[CLIP_1].source_in_frame
    assert reordered.revision == 1

    with _raise_code("NO_OP") as noop:
        reorder_track(
            reordered,
            expected_revision=1,
            track_id=TRACK_V,
            ordered_clip_ids=(CLIP_2, CLIP_1),
        )
    assert noop.value.code == "NO_OP"

    with _raise_code("INVALID_REORDER") as invalid:
        reorder_track(
            reordered,
            expected_revision=1,
            track_id=TRACK_V,
            ordered_clip_ids=(CLIP_1,),
        )
    assert invalid.value.code == "INVALID_REORDER"

    with _raise_code("STALE_REVISION") as stale:
        reorder_track(
            reordered,
            expected_revision=0,
            track_id=TRACK_V,
            ordered_clip_ids=(CLIP_1, CLIP_2),
        )
    assert stale.value.code == "STALE_REVISION"

    with _raise_code("UNKNOWN_TRACK") as unknown_track:
        reorder_track(
            reordered,
            expected_revision=1,
            track_id=f"trk_{'9' * 32}",
            ordered_clip_ids=(CLIP_2, CLIP_1),
        )
    assert unknown_track.value.code == "UNKNOWN_TRACK"

    empty = create_timeline(
        timeline_id=TIMELINE_ID,
        sequence_timebase=_timebase(),
        tracks=(TrackData(track_id=TRACK_V, kind="VIDEO", clips=()),),
        revision=0,
    )
    with _raise_code("EMPTY_TRACK") as empty_track:
        reorder_track(
            empty,
            expected_revision=0,
            track_id=TRACK_V,
            ordered_clip_ids=(),
        )
    assert empty_track.value.code == "EMPTY_TRACK"


def test_replace_preserves_timeline_range_and_updates_identity() -> None:
    timeline = _basic_timeline()
    replacement = _source(asset=HASH_B, frames=800)
    replaced = replace_clip_source(
        timeline,
        expected_revision=0,
        clip_id=CLIP_1,
        source=replacement,
        source_in_frame=20,
    )
    clip = next(c for t in replaced.tracks for c in t.clips if c.clip_id == CLIP_1)
    assert clip.timeline_start_frame == 0
    assert clip.duration_frames == 40
    assert clip.source_in_frame == 20
    assert clip.source.original_asset_sha256 == HASH_B
    assert timeline.tracks[0].clips[0].source.original_asset_sha256 == HASH_A

    with _raise_code("MEDIA_KIND_MISMATCH") as kind_mismatch:
        replace_clip_source(
            replaced,
            expected_revision=1,
            clip_id=CLIP_1,
            source=_source(kind="AUDIO", asset=HASH_D, frames=800),
        )
    assert kind_mismatch.value.code == "MEDIA_KIND_MISMATCH"

    with _raise_code("SOURCE_BOUNDS") as source_bounds:
        replace_clip_source(
            replaced,
            expected_revision=1,
            clip_id=CLIP_1,
            source=_source(asset=HASH_C, frames=30),
            source_in_frame=0,
        )
    assert source_bounds.value.code == "SOURCE_BOUNDS"

    with _raise_code("NO_OP") as noop:
        replace_clip_source(
            replaced,
            expected_revision=1,
            clip_id=CLIP_1,
            source=replacement,
            source_in_frame=20,
        )
    assert noop.value.code == "NO_OP"

    with _raise_code("STALE_REVISION") as stale:
        replace_clip_source(
            replaced,
            expected_revision=0,
            clip_id=CLIP_1,
            source=_source(asset=HASH_C, frames=800),
        )
    assert stale.value.code == "STALE_REVISION"

    with _raise_code("INVALID_BOUNDS") as float_source_in:
        replace_clip_source(
            replaced,
            expected_revision=1,
            clip_id=CLIP_1,
            source=_source(asset=HASH_C, frames=800),
            source_in_frame=1.0,  # type: ignore[arg-type]
        )
    assert float_source_in.value.code == "INVALID_BOUNDS"


def test_proxy_selection_binds_map_and_fails_closed() -> None:
    timeline = _basic_timeline()
    good_map = _proxy_map(frames=200, timebase=timeline.sequence_timebase)
    proxied = select_clip_source(
        timeline,
        expected_revision=0,
        clip_id=CLIP_1,
        source_selection="PROXY",
        proxy_asset_sha256=HASH_B,
        proxy_time_map=good_map,
    )
    clip = next(c for t in proxied.tracks for c in t.clips if c.clip_id == CLIP_1)
    assert clip.source_selection == "PROXY"
    assert clip.source.proxy_asset_sha256 == HASH_B
    plan = compile_render_plan(proxied)
    video_segments = next(track for track in plan.tracks if track.track_id == TRACK_V).segments
    clip_segment = next(
        seg for seg in video_segments if seg.segment_kind == "CLIP" and seg.clip_id == CLIP_1
    )
    assert clip_segment.selected_asset_sha256 == HASH_B
    assert clip_segment.original_asset_sha256 == HASH_A
    assert clip_segment.proxy_asset_sha256 == HASH_B
    assert clip_segment.source_in_frame == 10
    assert clip_segment.source_out_frame == 50
    assert clip_segment.source_selection == "PROXY"

    wrong_timebase = _proxy_map(frames=200, timebase=_timebase(24, 1))
    with _raise_code("INVALID_PROXY_MAP") as wrong_tb:
        select_clip_source(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="PROXY",
            proxy_asset_sha256=HASH_B,
            proxy_time_map=wrong_timebase,
        )
    assert wrong_tb.value.code == "INVALID_PROXY_MAP"

    incomplete = _proxy_map(frames=10, timebase=timeline.sequence_timebase)
    with _raise_code("INVALID_PROXY_MAP") as incomplete_map:
        select_clip_source(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="PROXY",
            proxy_asset_sha256=HASH_B,
            proxy_time_map=incomplete,
        )
    assert incomplete_map.value.code == "INVALID_PROXY_MAP"

    mismatched = _proxy_map(
        frames=200,
        source_hash=HASH_C,
        proxy_hash=HASH_B,
        timebase=timeline.sequence_timebase,
    )
    with _raise_code("INVALID_PROXY_MAP") as mismatched_map:
        select_clip_source(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="PROXY",
            proxy_asset_sha256=HASH_B,
            proxy_time_map=mismatched,
        )
    assert mismatched_map.value.code == "INVALID_PROXY_MAP"

    with _raise_code("INVALID_PROXY_MAP") as missing_both:
        select_clip_source(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="PROXY",
        )
    assert missing_both.value.code == "INVALID_PROXY_MAP"

    with _raise_code("INVALID_PROXY_MAP") as only_hash:
        select_clip_source(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="PROXY",
            proxy_asset_sha256=HASH_B,
        )
    assert only_hash.value.code == "INVALID_PROXY_MAP"

    with _raise_code("INVALID_PROXY_MAP") as only_map:
        select_clip_source(
            timeline,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="PROXY",
            proxy_time_map=good_map,
        )
    assert only_map.value.code == "INVALID_PROXY_MAP"

    with _raise_code("NO_OP") as proxy_noop:
        select_clip_source(
            proxied,
            expected_revision=1,
            clip_id=CLIP_1,
            source_selection="PROXY",
            proxy_asset_sha256=HASH_B,
            proxy_time_map=good_map,
        )
    assert proxy_noop.value.code == "NO_OP"

    with _raise_code("STALE_REVISION") as stale:
        select_clip_source(
            proxied,
            expected_revision=0,
            clip_id=CLIP_1,
            source_selection="ORIGINAL",
        )
    assert stale.value.code == "STALE_REVISION"

    original_again = select_clip_source(
        proxied,
        expected_revision=1,
        clip_id=CLIP_1,
        source_selection="ORIGINAL",
    )
    clip = next(c for t in original_again.tracks for c in t.clips if c.clip_id == CLIP_1)
    assert clip.source_selection == "ORIGINAL"
    assert clip.source.proxy_asset_sha256 == HASH_B
    assert compile_render_plan(original_again).tracks[0].segments[0].selected_asset_sha256 == HASH_A

    # Already ORIGINAL with the same proxy binding attached: re-passing it is NO_OP.
    with _raise_code("NO_OP") as original_same_proxy:
        select_clip_source(
            original_again,
            expected_revision=2,
            clip_id=CLIP_1,
            source_selection="ORIGINAL",
            proxy_asset_sha256=HASH_B,
            proxy_time_map=good_map,
        )
    assert original_same_proxy.value.code == "NO_OP"

    # Binding a proxy while staying ORIGINAL from a clean ORIGINAL clip is a real mutation.
    clean = _basic_timeline()
    bound_while_original = select_clip_source(
        clean,
        expected_revision=0,
        clip_id=CLIP_1,
        source_selection="ORIGINAL",
        proxy_asset_sha256=HASH_B,
        proxy_time_map=_proxy_map(frames=200, timebase=clean.sequence_timebase),
    )
    bound_clip = next(
        c for t in bound_while_original.tracks for c in t.clips if c.clip_id == CLIP_1
    )
    assert bound_while_original.revision == 1
    assert bound_clip.source_selection == "ORIGINAL"
    assert bound_clip.source.proxy_asset_sha256 == HASH_B


def test_render_plan_inserts_explicit_gaps_and_multi_track_duration() -> None:
    timeline = _basic_timeline(gap_before_second=True)
    plan = compile_render_plan(timeline)
    assert plan.duration_frames == 80
    video = next(track for track in plan.tracks if track.track_id == TRACK_V)
    kinds = [segment.segment_kind for segment in video.segments]
    assert kinds == ["CLIP", "GAP", "CLIP"]
    assert video.segments[1].timeline_start_frame == 40
    assert video.segments[1].timeline_end_frame == 50
    assert video.segments[1].duration_frames == 10

    first_clip = video.segments[0]
    assert first_clip.segment_kind == "CLIP"
    assert first_clip.source_in_frame == 10
    assert first_clip.source_out_frame == 50
    assert first_clip.original_asset_sha256 == HASH_A
    assert first_clip.selected_asset_sha256 == HASH_A

    audio = next(track for track in plan.tracks if track.track_id == TRACK_A)
    assert audio.segments[-1].segment_kind == "GAP"
    assert audio.segments[-1].timeline_start_frame == 70
    assert audio.segments[-1].timeline_end_frame == 80

    for track in plan.tracks:
        for segment in track.segments:
            assert segment.audio_sample_start == sequence_frame_to_audio_sample(
                segment.timeline_start_frame,
                timeline.sequence_timebase,
            )
            assert segment.audio_sample_end == sequence_frame_to_audio_sample(
                segment.timeline_end_frame,
                timeline.sequence_timebase,
            )


def test_canonical_hash_stable_for_track_input_order_and_changes_on_edit() -> None:
    first = _basic_timeline()
    reversed_tracks = create_timeline(
        timeline_id=TIMELINE_ID,
        sequence_timebase=first.sequence_timebase,
        tracks=tuple(reversed(first.tracks)),
        revision=0,
    )
    same_content_later_revision = create_timeline(
        timeline_id=TIMELINE_ID,
        sequence_timebase=first.sequence_timebase,
        tracks=first.tracks,
        revision=7,
    )
    different_timeline_id = create_timeline(
        timeline_id=f"tl_{'9' * 32}",
        sequence_timebase=first.sequence_timebase,
        tracks=first.tracks,
        revision=0,
    )
    hash_a = render_plan_canonical_hash(compile_render_plan(first))
    hash_b = render_plan_canonical_hash(compile_render_plan(reversed_tracks))
    hash_same_content = render_plan_canonical_hash(compile_render_plan(same_content_later_revision))
    hash_other_id = render_plan_canonical_hash(compile_render_plan(different_timeline_id))
    assert hash_a == hash_b
    assert hash_a == hash_same_content
    assert hash_a == hash_other_id
    assert hash_a.startswith("sha256:")

    trimmed = trim_clip(
        first,
        expected_revision=0,
        clip_id=CLIP_1,
        timeline_start_frame=0,
        duration_frames=39,
        source_in_frame=10,
    )
    hash_c = render_plan_canonical_hash(compile_render_plan(trimmed))
    assert hash_c != hash_a


def test_seeded_command_sequence_preserves_invariants() -> None:
    rng = Random(20260815)
    timeline = _basic_timeline(gap_before_second=True)
    successes = 0
    for _ in range(40):
        op = rng.randint(0, 2)
        try:
            if op == 0:
                clip_id = rng.choice([CLIP_1, CLIP_2])
                clip = next(c for t in timeline.tracks for c in t.clips if c.clip_id == clip_id)
                new_duration = max(1, clip.duration_frames + rng.randint(-5, 5))
                new_start = max(0, clip.timeline_start_frame + rng.randint(-3, 3))
                new_source_in = max(0, clip.source_in_frame + rng.randint(-2, 2))
                timeline = trim_clip(
                    timeline,
                    expected_revision=timeline.revision,
                    clip_id=clip_id,
                    timeline_start_frame=new_start,
                    duration_frames=new_duration,
                    source_in_frame=new_source_in,
                )
            elif op == 1:
                video = next(track for track in timeline.tracks if track.track_id == TRACK_V)
                ids = [clip.clip_id for clip in video.clips]
                if len(ids) >= 2:
                    ordered = (ids[1], ids[0]) if rng.random() < 0.5 else (ids[0], ids[1])
                    timeline = reorder_track(
                        timeline,
                        expected_revision=timeline.revision,
                        track_id=TRACK_V,
                        ordered_clip_ids=ordered,
                    )
                else:
                    continue
            else:
                timeline = replace_clip_source(
                    timeline,
                    expected_revision=timeline.revision,
                    clip_id=CLIP_1,
                    source=_source(asset=HASH_B if rng.random() < 0.5 else HASH_C, frames=2_000),
                    source_in_frame=rng.randint(0, 20),
                )
        except TimelineCoreError:
            continue

        successes += 1
        plan = compile_render_plan(timeline)
        assert plan.timeline_revision == timeline.revision
        assert plan.duration_frames == timeline.duration_frames
        seen_clips: set[str] = set()
        for track in timeline.tracks:
            ends = 0
            for clip in sorted(track.clips, key=lambda item: item.timeline_start_frame):
                assert clip.clip_id not in seen_clips
                seen_clips.add(clip.clip_id)
                assert clip.timeline_start_frame >= ends
                assert clip.duration_frames >= 1
                assert (
                    clip.source_in_frame + clip.duration_frames
                    <= clip.source.available_source_frames
                )
                ends = clip.timeline_end_frame
        _ = render_plan_canonical_hash(plan)

    assert successes >= 10
    assert timeline.revision > 0


@pytest.mark.parametrize(("num", "den"), ((24000, 1001), (30000, 1001), (24, 1), (25, 1)))
def test_thirty_minute_audio_boundary_has_no_cumulative_drift(num: int, den: int) -> None:
    timebase = _timebase(num, den)
    # Floor of 30 minutes expressed in sequence frames (not always exact wall time on NTSC).
    frame_index = 30 * 60 * num // den
    samples_per_frame = Fraction(48_000 * den, num)
    actual = sequence_frame_to_audio_sample(frame_index, timebase)
    exact = Fraction(frame_index * 48_000 * den, num)

    # Nearest ties-up absolute mapping stays within half a sample of exact.
    assert abs(Fraction(actual) - exact) <= Fraction(1, 2)
    # And therefore never accumulates beyond one sequence frame of audio samples.
    assert abs(Fraction(actual) - exact) < samples_per_frame

    # Fixed rounded samples-per-frame accumulation drifts on 30000/1001; absolute must not.
    rounded_step = (48_000 * den + num // 2) // num
    naive_cumulative = rounded_step * frame_index
    if (num, den) == (30000, 1001):
        assert abs(naive_cumulative - actual) >= int(samples_per_frame)
    elif samples_per_frame.denominator == 1:
        assert naive_cumulative == actual

    # Spot-check absolute mapping at a mid-span frame is also within half a sample.
    mid = frame_index // 2
    mid_actual = sequence_frame_to_audio_sample(mid, timebase)
    mid_exact = Fraction(mid * 48_000 * den, num)
    assert abs(Fraction(mid_actual) - mid_exact) <= Fraction(1, 2)


def test_render_plan_is_json_serializable_without_floats() -> None:
    plan = compile_render_plan(_basic_timeline(num=24000, den=1001))
    payload = plan.model_dump(mode="json")
    assert payload["schema_version"] == 1
    assert payload["sequence_timebase"]["frame_rate"] == {"num": 24000, "den": 1001}

    def _assert_no_float(value: object) -> None:
        if isinstance(value, float):
            raise AssertionError("render plan must not contain floats")
        if isinstance(value, dict):
            for nested in value.values():
                _assert_no_float(nested)
        elif isinstance(value, list):
            for nested in value:
                _assert_no_float(nested)

    _assert_no_float(payload)
