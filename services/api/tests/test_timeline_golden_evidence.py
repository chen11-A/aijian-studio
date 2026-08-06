from __future__ import annotations

import json
from pathlib import Path

import pytest
from aijian_api.timeline_export import build_timeline_render_plan, canonical_model_sha256
from pydantic import ValidationError

from scripts.timeline_golden import (
    MANIFEST_PATH,
    TimelineGoldenError,
    TimelineGoldenManifestV1,
    _mean_absolute_error,
    _timeline,
    _verify,
)


def _manifest() -> TimelineGoldenManifestV1:
    return TimelineGoldenManifestV1.model_validate_json(MANIFEST_PATH.read_text(encoding="utf-8"))


def _measured(manifest: TimelineGoldenManifestV1) -> dict[str, object]:
    return {
        "proxySha256": manifest.proxy_sha256,
        "timelineSha256": manifest.timeline_sha256,
        "renderPlanSha256": manifest.render_plan_sha256,
        "outputSha256": manifest.output_sha256,
        "ntscRenderPlanSha256": manifest.ntsc_render_plan_sha256,
        "ntscOutputSha256": manifest.ntsc_output_sha256,
        "selectedSourceFrames": list(manifest.selected_source_frames),
        "maximumMeanAbsoluteError": 2.5,
    }


def test_golden_manifest_is_bound_to_the_edited_timeline_and_render_plan() -> None:
    manifest = _manifest()
    timeline, selected_frames = _timeline()
    plan = build_timeline_render_plan(timeline)

    assert timeline.revision == 3
    assert tuple(clip.clip_id for clip in timeline.clips) == ("clip-c", "clip-a", "clip-b")
    assert timeline.clips[2].asset_id == "vfr-approved-alternate"
    assert selected_frames == manifest.selected_source_frames
    assert canonical_model_sha256(timeline) == f"sha256:{manifest.timeline_sha256}"
    assert canonical_model_sha256(plan) == f"sha256:{manifest.render_plan_sha256}"


def test_evidence_verifier_rejects_hash_order_and_error_drift() -> None:
    manifest = _manifest()
    measured = _measured(manifest)
    _verify(measured, manifest)

    for key, replacement in (
        ("outputSha256", "0" * 64),
        ("selectedSourceFrames", list(reversed(manifest.selected_source_frames))),
    ):
        changed = dict(measured)
        changed[key] = replacement
        with pytest.raises(TimelineGoldenError, match="pinned manifest"):
            _verify(changed, manifest)

    changed = dict(measured)
    changed["maximumMeanAbsoluteError"] = manifest.maximum_mean_absolute_error + 0.01
    with pytest.raises(TimelineGoldenError, match="exceeds"):
        _verify(changed, manifest)


def test_manifest_rejects_extra_fields_and_noncanonical_hashes(tmp_path: Path) -> None:
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    payload["unexpected"] = True
    with pytest.raises(ValidationError):
        TimelineGoldenManifestV1.model_validate(payload)

    payload.pop("unexpected")
    payload["output_sha256"] = "sha256:" + "a" * 64
    with pytest.raises(ValidationError):
        TimelineGoldenManifestV1.model_validate(payload)

    assert not (tmp_path / "timeline-golden.mp4").exists()


def test_mean_absolute_error_is_exact_and_requires_equal_length() -> None:
    assert _mean_absolute_error(bytes((0, 10, 20)), bytes((3, 8, 25))) == pytest.approx(10 / 3)
    with pytest.raises(ValueError):
        _mean_absolute_error(b"a", b"")
