"""Exact self-review DTO binding only; no playback or human approval is inferred."""

from datetime import UTC, datetime, timedelta, timezone

import pytest
from aijian_api import local_media_review_contracts as review
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_media_assembly_contracts import AssemblyAudioSegmentV1
from pydantic import ValidationError


def audio_target():
    media = {
        "asset_id": "asset_" + "a" * 32,
        "asset_version_id": "asv_" + "b" * 32,
        "sha256": "c" * 64,
    }
    segment = AssemblyAudioSegmentV1.model_validate(
        {
            "segment_id": "seg_audio",
            "track_kind": "BGM",
            "media": media,
            "start_frame": 0,
            "end_frame": 24,
        }
    ).model_dump(mode="json")
    return {
        "project_id": "prj_" + "a" * 32,
        "episode_id": "ep_" + "b" * 32,
        "assembly_version_id": "ver_" + "c" * 32,
        "assembly_content_hash": "sha256:" + "d" * 64,
        "assembly_head_revision": 1,
        "segment_kind": "AUDIO",
        "segment_id": "seg_audio",
        "segment_content_hash": canonical_content_hash(segment),
        "sequence_timebase": {
            "frame_rate": {"num": 24, "den": 1},
            "timecode_mode": "NON_DROP_FRAME",
        },
        "total_frames": 24,
        "canvas_width": 160,
        "canvas_height": 90,
        "audio_segment": segment,
        "subtitle_segment": None,
        "media_original": {
            **media,
            "byte_size": 48,
            "mime_type": "audio/wav",
            "filename": "owned.wav",
            "origin": "LOCAL_IMPORT",
        },
        "script_source": None,
        "script_provenance": None,
    }


@pytest.mark.parametrize(
    "fault", ["segment", "original", "sample", "identity", "range", "hash", "source"]
)
def test_audio_review_cannot_bind_missing_changed_or_unrelated_subject(fault):
    value = audio_target()
    assert review.LocalMediaReviewTargetSnapshotV1.model_validate(value).segment_id == "seg_audio"
    if fault == "segment":
        value["audio_segment"] = None
    elif fault == "original":
        value["media_original"]["sha256"] = "e" * 64
    elif fault == "sample":
        value["audio_segment"]["source_in_sample"] = 9_007_199_254_740_992
    elif fault == "identity":
        value["segment_id"] = "seg_other"
    elif fault == "range":
        value["total_frames"] = 23
    elif fault == "hash":
        value["segment_content_hash"] = "sha256:" + "e" * 64
    else:
        value["script_source"] = {
            "script_version_id": "ver_" + "a" * 32,
            "script_content_hash": "sha256:" + "b" * 64,
            "script_block_id": "sblk_" + "c" * 32,
            "block_content_hash": "sha256:" + "d" * 64,
        }
    with pytest.raises(ValidationError):
        review.LocalMediaReviewTargetSnapshotV1.model_validate(value)


def test_target_hash_cannot_be_substituted():
    snapshot = review.LocalMediaReviewTargetSnapshotV1.model_validate(audio_target())
    with pytest.raises(ValidationError, match="snapshot hash"):
        review.LocalMediaReviewTargetData(snapshot=snapshot, snapshot_hash="sha256:" + "f" * 64)


@pytest.mark.parametrize(
    "fault", ["naive", "offset", "no-assembly", "current-reasons", "unknown-no-reason"]
)
def test_applicability_status_preserves_unknown_and_requires_utc_exact_current(fault):
    value = {
        "review_version_id": "ver_" + "a" * 32,
        "review_content_hash": "sha256:" + "b" * 64,
        "applicability": "CURRENT",
        "current_assembly": {
            "version_id": "ver_" + "c" * 32,
            "content_hash": "sha256:" + "d" * 64,
            "head_revision": 1,
        },
        "reasons": (),
        "checked_at": datetime(2026, 1, 1, tzinfo=UTC),
        "formal_status": "BLOCKED",
    }
    assert review.LocalMediaReviewStatusData.model_validate(value).formal_status == "BLOCKED"
    if fault == "naive":
        value["checked_at"] = datetime(2026, 1, 1)
    elif fault == "offset":
        value["checked_at"] = datetime(2026, 1, 1, tzinfo=timezone(timedelta(hours=8)))
    elif fault == "no-assembly":
        value["current_assembly"] = None
    elif fault == "current-reasons":
        value["reasons"] = ({"code": "UNKNOWN_READ", "message": "Not verified"},)
    else:
        value["applicability"] = "UNKNOWN"
    with pytest.raises(ValidationError):
        review.LocalMediaReviewStatusData.model_validate(value)
