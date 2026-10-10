"""Pure timeline DTO and mocked packet-reader boundaries; no encoder runs."""

import io
import subprocess
import threading
from contextlib import nullcontext
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import timeline_export as timeline
from aijian_api.media_proxy import GuardedMediaSnapshot
from pydantic import ValidationError
from test_timeline_export import (
    OUTPUT_HASH,
    SOURCE_HASH,
    _install_success_mocks,
    _probe,
    _timeline,
    _toolchain,
)


@pytest.mark.parametrize(
    "field,value",
    [("source_start_frame", 8), ("audio_start_sample", 15360), ("timeline_start_frame", 8)],
)
def test_render_clip_rejects_non_forward_ranges(field, value):
    clip = timeline.build_timeline_render_plan(_timeline()).clips[0].model_dump()
    clip[field] = value
    with pytest.raises(ValidationError, match="must move forward"):
        timeline.TimelineRenderClipV1.model_validate(clip)


@pytest.mark.parametrize(
    "fault",
    [
        "duplicate",
        "index",
        "hash",
        "sample_range",
        "gap",
        "duration",
        "output_samples",
        "unused",
        "total",
    ],
)
def test_render_plan_requires_closed_exact_input_and_duration_mapping(fault):
    plan = timeline.build_timeline_render_plan(_timeline()).model_dump()
    clip = plan["clips"][0]
    if fault == "duplicate":
        plan["input_asset_sha256"] = (SOURCE_HASH, SOURCE_HASH)
    elif fault == "index":
        clip["input_index"] = 1
    elif fault == "hash":
        clip["editing_asset_sha256"] = "sha256:" + "0" * 64
    elif fault == "sample_range":
        clip["audio_end_sample"] += 1
    elif fault == "gap":
        clip["timeline_start_frame"] = 1
    elif fault == "duration":
        clip["timeline_end_frame"] += 1
    elif fault == "output_samples":
        clip["output_audio_sample_count"] += 1
    elif fault == "unused":
        plan["input_asset_sha256"] = (SOURCE_HASH, "sha256:" + "0" * 64)
    else:
        plan["total_duration_frames"] += 1
    with pytest.raises(ValidationError):
        timeline.TimelineRenderPlanV1.model_validate(plan)


def test_development_evidence_rejects_non_development_toolchain(tmp_path):
    toolchain = replace(_toolchain(tmp_path), distribution_status="RELEASE_APPROVED")
    with pytest.raises(timeline.TimelineExportError, match="development-only"):
        timeline._require_export_authorization(
            toolchain, timeline.TimelineExportPurpose.DEVELOPMENT_EVIDENCE
        )


@pytest.mark.parametrize("value", [True, False, 1.0, "1", None])
def test_packet_integer_does_not_coerce_values(value):
    with pytest.raises(timeline.TimelineExportError, match="timing"):
        timeline._strict_packet_integer(value)


@pytest.mark.parametrize(
    "fault", ["none", "read", "limit", "timeout", "alive", "exit", "count", "success"]
)
def test_packet_probe_bounds_output_wait_and_exact_sample_count(monkeypatch, fault):
    output = b'{"packets":[{"stream_index":1,"pts":0,"duration":10}]}'
    process = Mock(stdout=io.BytesIO(output))
    process.wait.return_value = 0
    if fault == "none":
        process.stdout = None
    elif fault == "read":
        process.stdout = Mock()
        process.stdout.read.side_effect = OSError("synthetic read failure")
    elif fault == "limit":
        monkeypatch.setattr(timeline, "MAX_TIMELINE_PACKET_OUTPUT_BYTES", 2)
    elif fault == "timeout":
        process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 180), 0]
    elif fault == "exit":
        process.wait.return_value = 3
    popen = Mock(return_value=process)
    monkeypatch.setattr(
        timeline,
        "subprocess",
        SimpleNamespace(
            Popen=popen,
            DEVNULL=subprocess.DEVNULL,
            PIPE=subprocess.PIPE,
            TimeoutExpired=subprocess.TimeoutExpired,
        ),
    )

    def reader(**kwargs):
        return SimpleNamespace(
            start=kwargs["target"], join=Mock(), is_alive=lambda: fault == "alive"
        )

    monkeypatch.setattr(
        timeline, "threading", SimpleNamespace(Thread=reader, Event=threading.Event)
    )
    arguments = dict(stream_index=1, expected_samples=11 if fault == "count" else 10)
    if fault == "success":
        timeline._validate_presentation_audio_samples(
            Path("synthetic-ffprobe"), Path("synthetic.mp4"), **arguments
        )
    else:
        with pytest.raises(timeline.TimelineExportError):
            timeline._validate_presentation_audio_samples(
                Path("synthetic-ffprobe"), Path("synthetic.mp4"), **arguments
            )
    popen.assert_called_once()
    assert "-protocol_whitelist" in popen.call_args.args[0]
    assert process.kill.call_count == int(fault in {"none", "limit", "timeout", "alive"}) + (
        2 if fault == "read" else 0
    )


@pytest.mark.parametrize("stage", ["snapshot", "input_probe", "output_probe"])
def test_changed_content_identity_never_publishes(tmp_path, monkeypatch, stage):
    commands = _install_success_mocks(tmp_path, monkeypatch, audio_rate=None)
    if stage == "snapshot":
        monkeypatch.setattr(
            timeline,
            "guarded_media_snapshot",
            lambda *_args, **_kwargs: nullcontext(
                GuardedMediaSnapshot(tmp_path / "snapshot.webm", "sha256:" + "0" * 64, 8)
            ),
        )
    else:
        input_hash = SOURCE_HASH if stage != "input_probe" else "sha256:" + "0" * 64
        output_hash = OUTPUT_HASH if stage != "output_probe" else "sha256:" + "0" * 64
        probes = iter(
            (_probe(input_hash, 64, audio_rate=None), _probe(output_hash, 30, audio_rate=None))
        )
        monkeypatch.setattr(timeline, "probe_local_media", lambda *_: next(probes))
    output = tmp_path / "output.mp4"
    with pytest.raises(timeline.TimelineExportError, match="hash"):
        timeline.export_timeline_mp4(
            _timeline(),
            (timeline.TimelineMediaBinding(SOURCE_HASH, tmp_path / "input.webm"),),
            output,
            _toolchain(tmp_path),
            purpose=timeline.TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    assert not output.exists()
    assert len(commands) == int(stage == "output_probe")
    assert not list(tmp_path.glob("aijian-timeline-export-*"))
