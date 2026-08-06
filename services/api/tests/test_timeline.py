from __future__ import annotations

from typing import Any

import pytest
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from aijian_api.timeline import (
    TimelineAssetV1,
    TimelineClipV1,
    TimelineEditError,
    TimelineProxyRefV1,
    TimelineVersionV1,
    reorder_clip,
    replace_clip,
    trim_clip,
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


def _asset(
    asset_id: str,
    source_hash: str,
    source_frames: int,
    *,
    proxy_hash: str | None = None,
    proxy_frames: int | None = None,
) -> TimelineAssetV1:
    proxy = None
    if proxy_hash is not None and proxy_frames is not None:
        proxy = TimelineProxyRefV1(
            proxy_asset_sha256=proxy_hash,
            editable_frame_count=proxy_frames,
            sequence_timebase=_timebase(),
        )
    return TimelineAssetV1(
        asset_id=asset_id,
        source_asset_sha256=source_hash,
        source_frame_count=source_frames,
        proxy=proxy,
    )


def _timeline() -> TimelineVersionV1:
    return TimelineVersionV1(
        timeline_id="episode-01-main",
        revision=7,
        sequence_timebase=_timebase(),
        assets=(
            _asset("source-a", HASH_A, 50),
            _asset("source-b", HASH_B, 48),
            _asset("source-vfr", HASH_C, 48, proxy_hash=HASH_B, proxy_frames=64),
        ),
        clips=(
            TimelineClipV1(
                clip_id="clip-a", asset_id="source-a", source_in_frame=0, duration_frames=10
            ),
            TimelineClipV1(
                clip_id="clip-b", asset_id="source-b", source_in_frame=5, duration_frames=12
            ),
            TimelineClipV1(
                clip_id="clip-proxy",
                asset_id="source-vfr",
                source_in_frame=40,
                duration_frames=20,
            ),
        ),
    )


def test_timeline_is_immutable_and_uses_proxy_editable_frame_count() -> None:
    timeline = _timeline()

    assert timeline.total_duration_frames == 42
    assert timeline.asset_by_id("source-vfr").editable_frame_count == 64
    with pytest.raises(ValidationError):
        timeline.revision = 8  # type: ignore[misc]


def test_trim_creates_one_new_revision_without_mutating_the_old_version() -> None:
    original = _timeline()

    edited = trim_clip(
        original,
        "clip-b",
        new_source_in_frame=8,
        new_duration_frames=9,
        expected_revision=7,
    )

    assert edited.revision == 8
    assert edited.clips[1].source_in_frame == 8
    assert edited.clips[1].duration_frames == 9
    assert original.clips[1].source_in_frame == 5
    assert original.revision == 7


def test_reorder_changes_only_clip_order() -> None:
    original = _timeline()

    edited = reorder_clip(original, "clip-proxy", new_index=0, expected_revision=7)

    assert tuple(clip.clip_id for clip in edited.clips) == (
        "clip-proxy",
        "clip-a",
        "clip-b",
    )
    assert sorted(clip.model_dump_json() for clip in edited.clips) == sorted(
        clip.model_dump_json() for clip in original.clips
    )


def test_replace_preserves_duration_and_requires_the_new_asset_range() -> None:
    original = _timeline()

    edited = replace_clip(
        original,
        "clip-b",
        replacement_asset_id="source-a",
        replacement_source_in_frame=30,
        expected_revision=7,
    )

    assert edited.clips[1] == TimelineClipV1(
        clip_id="clip-b",
        asset_id="source-a",
        source_in_frame=30,
        duration_frames=12,
    )
    with pytest.raises(TimelineEditError, match="editable frame range"):
        replace_clip(
            original,
            "clip-b",
            replacement_asset_id="source-b",
            replacement_source_in_frame=40,
            expected_revision=7,
        )


@pytest.mark.parametrize(
    ("command", "message"),
    (
        (
            lambda timeline: trim_clip(
                timeline,
                "missing",
                new_source_in_frame=0,
                new_duration_frames=1,
                expected_revision=7,
            ),
            "clip was not found",
        ),
        (
            lambda timeline: reorder_clip(timeline, "clip-a", new_index=3, expected_revision=7),
            "target index",
        ),
        (
            lambda timeline: replace_clip(
                timeline,
                "clip-a",
                replacement_asset_id="missing",
                replacement_source_in_frame=0,
                expected_revision=7,
            ),
            "asset was not found",
        ),
        (
            lambda timeline: trim_clip(
                timeline,
                "clip-a",
                new_source_in_frame=0,
                new_duration_frames=10,
                expected_revision=7,
            ),
            "does not change",
        ),
        (
            lambda timeline: reorder_clip(timeline, "clip-a", new_index=0, expected_revision=7),
            "does not change",
        ),
        (
            lambda timeline: replace_clip(
                timeline,
                "clip-a",
                replacement_asset_id="source-a",
                replacement_source_in_frame=0,
                expected_revision=7,
            ),
            "does not change",
        ),
    ),
)
def test_edit_commands_reject_invalid_or_noop_requests(command: Any, message: str) -> None:
    with pytest.raises(TimelineEditError, match=message):
        command(_timeline())


@pytest.mark.parametrize("revision", (6, 8))
def test_every_edit_command_rejects_a_stale_or_future_revision(revision: int) -> None:
    timeline = _timeline()
    commands = (
        lambda: trim_clip(
            timeline,
            "clip-a",
            new_source_in_frame=1,
            new_duration_frames=9,
            expected_revision=revision,
        ),
        lambda: reorder_clip(timeline, "clip-a", new_index=1, expected_revision=revision),
        lambda: replace_clip(
            timeline,
            "clip-a",
            replacement_asset_id="source-b",
            replacement_source_in_frame=0,
            expected_revision=revision,
        ),
    )
    for command in commands:
        with pytest.raises(TimelineEditError, match="revision conflict"):
            command()


@pytest.mark.parametrize(
    "updates",
    (
        {"timeline_id": "空 格"},
        {"revision": True},
        {"revision": 1.5},
        {"width": 1920},
        {"height": 1080},
        {"assets": ()},
        {"clips": ()},
    ),
)
def test_timeline_rejects_invalid_scalar_or_empty_values(updates: dict[str, object]) -> None:
    payload = _timeline().model_dump(mode="python")
    payload.update(updates)
    with pytest.raises(ValidationError):
        TimelineVersionV1.model_validate(payload)


def test_timeline_rejects_duplicate_ids_dangling_clips_and_out_of_range_clips() -> None:
    original = _timeline()
    cases = (
        {"assets": (*original.assets, original.assets[0])},
        {"clips": (*original.clips, original.clips[0])},
        {
            "clips": (
                TimelineClipV1(
                    clip_id="dangling",
                    asset_id="missing",
                    source_in_frame=0,
                    duration_frames=1,
                ),
            )
        },
        {
            "clips": (
                TimelineClipV1(
                    clip_id="overflow",
                    asset_id="source-a",
                    source_in_frame=49,
                    duration_frames=2,
                ),
            )
        },
    )
    for updates in cases:
        payload = original.model_dump(mode="python")
        payload.update(updates)
        with pytest.raises(ValidationError):
            TimelineVersionV1.model_validate(payload)


def test_proxy_ref_must_match_timeline_timebase() -> None:
    original = _timeline()
    mismatched_proxy = TimelineProxyRefV1(
        proxy_asset_sha256=HASH_B,
        editable_frame_count=64,
        sequence_timebase=SequenceTimebaseData(
            frame_rate=SequenceFrameRateData(num=24, den=1),
            timecode_mode="NON_DROP_FRAME",
        ),
    )
    payload = original.model_dump(mode="python")
    payload["assets"][2]["proxy"] = mismatched_proxy.model_dump(mode="python")
    with pytest.raises(ValidationError, match="proxy timebase"):
        TimelineVersionV1.model_validate(payload)


def test_total_duration_must_remain_a_json_safe_integer() -> None:
    original = _timeline()
    payload = original.model_dump(mode="python")
    payload["assets"] = (_asset("huge", HASH_A, 2**53 - 1).model_dump(mode="python"),)
    payload["clips"] = (
        TimelineClipV1(
            clip_id="huge-a", asset_id="huge", source_in_frame=0, duration_frames=2**52
        ).model_dump(mode="python"),
        TimelineClipV1(
            clip_id="huge-b", asset_id="huge", source_in_frame=0, duration_frames=2**52
        ).model_dump(mode="python"),
    )
    with pytest.raises(ValidationError, match="total duration"):
        TimelineVersionV1.model_validate(payload)
