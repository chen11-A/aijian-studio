from __future__ import annotations

import pytest
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from aijian_api.timeline import (
    TimelineAssetV1,
    TimelineClipV1,
    TimelineProxyRefV1,
    TimelineVersionV1,
    reorder_clip,
    replace_clip,
    trim_clip,
)
from aijian_api.timeline_export import (
    TimelineRenderPlanV1,
    build_timeline_render_plan,
    canonical_model_sha256,
)
from pydantic import ValidationError

HASH_A = "sha256:" + "a" * 64
HASH_B = "sha256:" + "b" * 64
HASH_C = "sha256:" + "c" * 64


def _timebase() -> SequenceTimebaseData:
    return SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )


def _golden_timeline() -> TimelineVersionV1:
    timebase = _timebase()
    original = TimelineVersionV1(
        timeline_id="golden-edit",
        revision=0,
        sequence_timebase=timebase,
        assets=(
            TimelineAssetV1(asset_id="asset-a", source_asset_sha256=HASH_A, source_frame_count=50),
            TimelineAssetV1(asset_id="asset-b", source_asset_sha256=HASH_B, source_frame_count=48),
            TimelineAssetV1(
                asset_id="asset-vfr",
                source_asset_sha256=HASH_C,
                source_frame_count=48,
                proxy=TimelineProxyRefV1(
                    proxy_asset_sha256=HASH_B,
                    editable_frame_count=64,
                    sequence_timebase=timebase,
                ),
            ),
        ),
        clips=(
            TimelineClipV1(
                clip_id="clip-a", asset_id="asset-a", source_in_frame=0, duration_frames=10
            ),
            TimelineClipV1(
                clip_id="clip-b", asset_id="asset-b", source_in_frame=5, duration_frames=12
            ),
            TimelineClipV1(
                clip_id="clip-c",
                asset_id="asset-vfr",
                source_in_frame=40,
                duration_frames=20,
            ),
        ),
    )
    trimmed = trim_clip(
        original,
        "clip-a",
        new_source_in_frame=2,
        new_duration_frames=8,
        expected_revision=0,
    )
    reordered = reorder_clip(trimmed, "clip-c", new_index=0, expected_revision=1)
    return replace_clip(
        reordered,
        "clip-b",
        replacement_asset_id="asset-a",
        replacement_source_in_frame=20,
        expected_revision=2,
    )


def test_render_plan_is_path_free_deterministic_and_frame_exact() -> None:
    timeline = _golden_timeline()

    plan = build_timeline_render_plan(timeline)

    assert plan.timeline_sha256 == canonical_model_sha256(timeline)
    assert plan.total_duration_frames == 40
    assert plan.width == 1080
    assert plan.height == 1920
    assert tuple(plan.input_asset_sha256) == (HASH_B, HASH_A)
    assert [
        (
            clip.clip_id,
            clip.input_index,
            clip.editing_asset_sha256,
            clip.source_start_frame,
            clip.source_end_frame,
            clip.audio_start_sample,
            clip.audio_end_sample,
        )
        for clip in plan.clips
    ] == [
        ("clip-c", 0, HASH_B, 40, 60, 76_800, 115_200),
        ("clip-a", 1, HASH_A, 2, 10, 3_840, 19_200),
        ("clip-b", 1, HASH_A, 20, 32, 38_400, 61_440),
    ]
    assert canonical_model_sha256(plan) == canonical_model_sha256(
        TimelineRenderPlanV1.model_validate_json(plan.model_dump_json())
    )
    assert "\\" not in plan.model_dump_json()
    assert ":/" not in plan.model_dump_json()


def test_30000_1001_audio_uses_timeline_phase_not_source_in_phase() -> None:
    timebase = SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=30000, den=1001),
        timecode_mode="NON_DROP_FRAME",
    )
    timeline = TimelineVersionV1(
        timeline_id="ntsc-audio-phase",
        revision=0,
        sequence_timebase=timebase,
        assets=(
            TimelineAssetV1(asset_id="asset", source_asset_sha256=HASH_A, source_frame_count=10),
        ),
        clips=(
            TimelineClipV1(clip_id="first", asset_id="asset", source_in_frame=1, duration_frames=1),
            TimelineClipV1(
                clip_id="second", asset_id="asset", source_in_frame=1, duration_frames=1
            ),
        ),
    )

    plan = build_timeline_render_plan(timeline)

    assert (
        plan.clips[0].audio_start_sample,
        plan.clips[0].audio_end_sample,
        plan.clips[0].output_audio_sample_count,
    ) == (1602, 3203, 1602)
    assert (
        plan.clips[1].timeline_start_frame,
        plan.clips[1].timeline_end_frame,
        plan.clips[1].output_audio_sample_count,
    ) == (1, 2, 1601)


def test_render_plan_changes_when_clip_order_or_range_changes() -> None:
    timeline = _golden_timeline()
    first = build_timeline_render_plan(timeline)
    edited = trim_clip(
        timeline,
        "clip-a",
        new_source_in_frame=3,
        new_duration_frames=7,
        expected_revision=3,
    )

    assert canonical_model_sha256(build_timeline_render_plan(edited)) != canonical_model_sha256(
        first
    )


def test_render_plan_contract_is_frozen_and_rejects_extra_or_unsafe_values() -> None:
    plan = build_timeline_render_plan(_golden_timeline())
    payload = plan.model_dump(mode="python")
    payload["path"] = "C:/secret/source.mkv"
    with pytest.raises(ValidationError):
        TimelineRenderPlanV1.model_validate(payload)
    with pytest.raises(ValidationError):
        plan.clips[0].source_start_frame = 1  # type: ignore[misc]
