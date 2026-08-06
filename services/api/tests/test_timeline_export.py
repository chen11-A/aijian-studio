from __future__ import annotations

import hashlib
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from fractions import Fraction
from pathlib import Path

import pytest
from aijian_api import timeline_export
from aijian_api.media_contracts import (
    MediaTimestampData,
    PositiveRationalData,
    SequenceFrameRateData,
    SequenceTimebaseData,
)
from aijian_api.media_probe import (
    AudioProbeData,
    LocalMediaProbeData,
    VideoFrameProbeData,
    VideoProbeData,
)
from aijian_api.media_proxy import MATROSKA_EBML_HEADER, GuardedMediaSnapshot
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.timeline import (
    TimelineAssetV1,
    TimelineClipV1,
    TimelineProxyRefV1,
    TimelineVersionV1,
)
from aijian_api.timeline_export import (
    TimelineExportError,
    TimelineExportPurpose,
    TimelineMediaBinding,
    _ffmpeg_arguments,
    _presentation_audio_sample_count,
    _validate_editing_probe,
    _validate_export_probe,
    build_timeline_render_plan,
    export_timeline_mp4,
)
from pydantic import ValidationError

SOURCE_HASH = "sha256:" + hashlib.sha256(MATROSKA_EBML_HEADER + b"source").hexdigest()
OUTPUT_BYTES = b"validated-mp4"
OUTPUT_HASH = "sha256:" + hashlib.sha256(OUTPUT_BYTES).hexdigest()


def _timebase() -> SequenceTimebaseData:
    return SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )


def _timeline() -> TimelineVersionV1:
    timebase = _timebase()
    return TimelineVersionV1(
        timeline_id="export-test",
        revision=0,
        sequence_timebase=timebase,
        assets=(
            TimelineAssetV1(
                asset_id="source",
                source_asset_sha256="sha256:" + "a" * 64,
                source_frame_count=48,
                proxy=TimelineProxyRefV1(
                    proxy_asset_sha256=SOURCE_HASH,
                    editable_frame_count=64,
                    sequence_timebase=timebase,
                ),
            ),
        ),
        clips=(
            TimelineClipV1(clip_id="one", asset_id="source", source_in_frame=0, duration_frames=8),
            TimelineClipV1(
                clip_id="two", asset_id="source", source_in_frame=15, duration_frames=10
            ),
            TimelineClipV1(
                clip_id="three", asset_id="source", source_in_frame=30, duration_frames=12
            ),
        ),
    )


def _probe(
    asset_hash: str, frame_count: int, *, audio_rate: int | None = 48_000
) -> LocalMediaProbeData:
    duration = Fraction(frame_count, 25)
    frames = tuple(
        VideoFrameProbeData(
            pts=MediaTimestampData(
                ticks=index,
                time_base=PositiveRationalData(num=1, den=25),
            )
        )
        for index in range(frame_count)
    )
    audio = None
    if audio_rate is not None:
        audio = AudioProbeData(
            stream_index=1,
            codec_name="pcm_s16le" if asset_hash == SOURCE_HASH else "aac",
            sample_rate_hz=audio_rate,
            channels=1,
            channel_layout="mono",
            time_base=PositiveRationalData(num=1, den=audio_rate),
            total_samples=frame_count * audio_rate // 25,
        )
    return LocalMediaProbeData(
        source_asset_sha256=asset_hash,
        byte_size=100,
        format_names=("matroska", "webm") if asset_hash == SOURCE_HASH else ("mov", "mp4"),
        container_duration=PositiveRationalData(num=duration.numerator, den=duration.denominator),
        video=VideoProbeData(
            stream_index=0,
            codec_name="vp9" if asset_hash == SOURCE_HASH else "h264",
            width=160 if asset_hash == SOURCE_HASH else 1080,
            height=90 if asset_hash == SOURCE_HASH else 1920,
            pixel_format="yuv420p",
            average_frame_rate=PositiveRationalData(num=25, den=1),
            time_base=PositiveRationalData(num=1, den=25),
            frames=frames,
            is_variable_frame_rate=False,
        ),
        audio=audio,
    )


def _toolchain(tmp_path: Path) -> MediaToolchain:
    return MediaToolchain(
        profile_id="test-profile",
        version="8.1.2",
        ffmpeg_path=tmp_path / "ffmpeg",
        ffprobe_path=tmp_path / "ffprobe",
        ffmpeg_sha256="0" * 64,
        ffprobe_sha256="1" * 64,
        configuration_flags=("--enable-gpl",),
        license_class="GPL",
        spdx_license="GPL-3.0-or-later",
        distribution_status="DEVELOPMENT_ONLY",
    )


def _install_success_mocks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, audio_rate: int | None = 48_000
) -> list[list[str]]:
    source = tmp_path / "snapshot.webm"
    source.write_bytes(MATROSKA_EBML_HEADER + b"source")

    @contextmanager
    def snapshot(_path: Path, **_kwargs: object) -> Iterator[GuardedMediaSnapshot]:
        yield GuardedMediaSnapshot(source, SOURCE_HASH, source.stat().st_size)

    probes = iter(
        (
            _probe(SOURCE_HASH, 64, audio_rate=audio_rate),
            _probe(OUTPUT_HASH, 30, audio_rate=audio_rate),
        )
    )
    commands: list[list[str]] = []

    def run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        commands.append(command)
        Path(command[-1]).write_bytes(OUTPUT_BYTES)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(timeline_export, "guarded_media_snapshot", snapshot)
    monkeypatch.setattr(timeline_export, "probe_local_media", lambda *_args: next(probes))
    monkeypatch.setattr(timeline_export.subprocess, "run", run)
    monkeypatch.setattr(
        timeline_export,
        "_validate_presentation_audio_samples",
        lambda *_args, **_kwargs: None,
    )
    return commands


def test_ffmpeg_arguments_use_integer_frame_and_sample_filters() -> None:
    plan = build_timeline_render_plan(_timeline())
    arguments = _ffmpeg_arguments((Path("one.webm"),), Path("out.mp4"), plan, has_audio=True)
    graph = arguments[arguments.index("-filter_complex") + 1]

    assert "trim=start_frame=15:end_frame=25" in graph
    assert "atrim=start_sample=28800:end_sample=48000" in graph
    assert "apad=whole_len=15360,atrim=end_sample=15360" in graph
    assert "concat=n=3:v=1:a=1[vout][aconcat]" in graph
    assert "[aconcat]apad=whole_len=57600,atrim=end_sample=57600" in graph
    assert "scale=1080:1920" in graph
    assert "-protocol_whitelist" in arguments
    assert "shell" not in arguments


def test_ffmpeg_arguments_can_build_a_video_only_export() -> None:
    plan = build_timeline_render_plan(_timeline())
    arguments = _ffmpeg_arguments((Path("one.webm"),), Path("out.mp4"), plan, has_audio=False)
    graph = arguments[arguments.index("-filter_complex") + 1]

    assert "atrim" not in graph
    assert "concat=n=3:v=1:a=0[vout]" in graph
    assert "[aout]" not in arguments
    assert "-c:a" not in arguments


def test_export_validates_then_atomically_publishes_the_mp4(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands = _install_success_mocks(tmp_path, monkeypatch)
    destination = (tmp_path / "export.mp4").resolve()

    result = export_timeline_mp4(
        _timeline(),
        (TimelineMediaBinding(SOURCE_HASH, (tmp_path / "input.webm").resolve()),),
        destination,
        _toolchain(tmp_path),
        purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
    )

    assert destination.read_bytes() == OUTPUT_BYTES
    assert result.output_sha256 == OUTPUT_HASH
    assert result.path == destination
    assert result.render_plan.total_duration_frames == 30
    assert result.render_plan_sha256.startswith("sha256:")
    assert commands and commands[0][0].endswith("ffmpeg")


def test_export_supports_a_consistent_video_only_timeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands = _install_success_mocks(tmp_path, monkeypatch, audio_rate=None)

    export_timeline_mp4(
        _timeline(),
        (TimelineMediaBinding(SOURCE_HASH, (tmp_path / "input.webm").resolve()),),
        (tmp_path / "silent.mp4").resolve(),
        _toolchain(tmp_path),
        purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
    )

    assert "-c:a" not in commands[0]


@pytest.mark.parametrize(
    "destination",
    (
        Path("relative.mp4"),
        Path(r"\\server\share\export.mp4"),
        Path(r"C:\safe\NUL.mp4"),
        Path("C:\\safe\\COM¹.mp4"),
        Path("C:\\safe\\LPT².mp4"),
        Path(r"C:\safe\export.mp4:stream"),
        Path(r"C:\safe\export.mkv"),
    ),
)
def test_export_rejects_unsafe_destination_before_media_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, destination: Path
) -> None:
    monkeypatch.setattr(
        timeline_export,
        "guarded_media_snapshot",
        lambda *_args: pytest.fail("unsafe destination reached media access"),
    )
    with pytest.raises(TimelineExportError, match="destination"):
        export_timeline_mp4(
            _timeline(),
            (),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )


def test_export_refuses_existing_output_and_inexact_bindings(tmp_path: Path) -> None:
    existing = (tmp_path / "exists.mp4").resolve()
    existing.write_bytes(b"owner")
    with pytest.raises(TimelineExportError, match="already exists"):
        export_timeline_mp4(
            _timeline(),
            (),
            existing,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    assert existing.read_bytes() == b"owner"

    destination = (tmp_path / "new.mp4").resolve()
    with pytest.raises(TimelineExportError, match="exactly match"):
        export_timeline_mp4(
            _timeline(),
            (),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    with pytest.raises(TimelineExportError, match="duplicate"):
        export_timeline_mp4(
            _timeline(),
            (
                TimelineMediaBinding(SOURCE_HASH, tmp_path / "a.webm"),
                TimelineMediaBinding(SOURCE_HASH, tmp_path / "b.webm"),
            ),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )


def test_media_binding_is_frozen() -> None:
    binding = TimelineMediaBinding(SOURCE_HASH, Path("input.webm"))
    with pytest.raises(AttributeError):
        binding.path = Path("changed.webm")  # type: ignore[misc]


def test_render_plan_rejects_an_invalid_content_hash() -> None:
    payload = build_timeline_render_plan(_timeline()).model_dump(mode="python")
    payload["input_asset_sha256"] = ("invalid",)
    with pytest.raises(ValidationError):
        timeline_export.TimelineRenderPlanV1.model_validate(payload)


@pytest.mark.parametrize(
    ("change", "message"),
    (
        ("variable", "CFR"),
        ("rate", "CFR"),
        ("pixels", "CFR"),
        ("frames", "frame range"),
        ("audio", "audio range"),
    ),
)
def test_editing_probe_must_cover_the_exact_cfr_clip_ranges(change: str, message: str) -> None:
    plan = build_timeline_render_plan(_timeline())
    probe = _probe(SOURCE_HASH, 64)
    if change == "variable":
        probe = probe.model_copy(
            update={"video": probe.video.model_copy(update={"is_variable_frame_rate": True})}
        )
    elif change == "rate":
        probe = probe.model_copy(
            update={
                "video": probe.video.model_copy(
                    update={"average_frame_rate": PositiveRationalData(num=24, den=1)}
                )
            }
        )
    elif change == "frames":
        probe = probe.model_copy(
            update={"video": probe.video.model_copy(update={"frames": probe.video.frames[:41]})}
        )
    elif change == "pixels":
        probe = probe.model_copy(
            update={"video": probe.video.model_copy(update={"width": 5000, "height": 5000})}
        )
    else:
        assert probe.audio is not None
        probe = probe.model_copy(
            update={"audio": probe.audio.model_copy(update={"total_samples": 80_000})}
        )
    with pytest.raises(TimelineExportError, match=message):
        _validate_editing_probe(probe, plan, 0)


@pytest.mark.parametrize(
    ("change", "has_audio", "message"),
    (
        ("container", True, "container"),
        ("video", True, "video"),
        ("codec", True, "video"),
        ("pixel", True, "video"),
        ("presence", False, "presence"),
        ("rate", True, "48 kHz"),
        ("audio-codec", True, "48 kHz AAC"),
    ),
)
def test_export_probe_must_match_the_rendered_contract(
    change: str, has_audio: bool, message: str
) -> None:
    plan = build_timeline_render_plan(_timeline())
    probe = _probe(OUTPUT_HASH, 30)
    if change == "container":
        probe = probe.model_copy(update={"format_names": ("matroska",)})
    elif change == "video":
        probe = probe.model_copy(update={"video": probe.video.model_copy(update={"width": 720})})
    elif change == "codec":
        probe = probe.model_copy(
            update={"video": probe.video.model_copy(update={"codec_name": "hevc"})}
        )
    elif change == "pixel":
        probe = probe.model_copy(
            update={"video": probe.video.model_copy(update={"pixel_format": "yuv444p"})}
        )
    elif change == "rate":
        assert probe.audio is not None
        probe = probe.model_copy(
            update={"audio": probe.audio.model_copy(update={"sample_rate_hz": 44_100})}
        )
    elif change == "audio-codec":
        assert probe.audio is not None
        probe = probe.model_copy(
            update={"audio": probe.audio.model_copy(update={"codec_name": "opus"})}
        )
    with pytest.raises(TimelineExportError, match=message):
        _validate_export_probe(probe, plan, has_audio=has_audio)


def test_export_probe_rejects_audio_shorter_than_the_logical_timeline() -> None:
    plan = build_timeline_render_plan(_timeline())
    probe = _probe(OUTPUT_HASH, 30)
    assert probe.audio is not None
    short_audio = probe.audio.model_copy(update={"total_samples": 57_599})

    with pytest.raises(TimelineExportError, match="padding bounds"):
        _validate_export_probe(
            probe.model_copy(update={"audio": short_audio}), plan, has_audio=True
        )


def test_export_rejects_non_48k_input_without_publishing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_success_mocks(tmp_path, monkeypatch, audio_rate=44_100)
    destination = (tmp_path / "bad-audio.mp4").resolve()
    with pytest.raises(TimelineExportError, match="48 kHz"):
        export_timeline_mp4(
            _timeline(),
            (TimelineMediaBinding(SOURCE_HASH, tmp_path / "input.webm"),),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    assert not destination.exists()


def test_encoder_failure_is_sanitized_and_does_not_publish(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_success_mocks(tmp_path, monkeypatch)

    def fail(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        raise subprocess.CalledProcessError(1, command, stderr=b"secret input path")

    monkeypatch.setattr(timeline_export.subprocess, "run", fail)
    destination = (tmp_path / "failed.mp4").resolve()
    with pytest.raises(TimelineExportError, match="timeline export failed") as caught:
        export_timeline_mp4(
            _timeline(),
            (TimelineMediaBinding(SOURCE_HASH, tmp_path / "input.webm"),),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    assert "secret" not in str(caught.value)
    assert not destination.exists()


def test_atomic_publish_refuses_a_racing_owner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_success_mocks(tmp_path, monkeypatch)
    destination = (tmp_path / "raced.mp4").resolve()
    real_link = timeline_export.os.link

    def race(source: Path, target: Path) -> None:
        target.write_bytes(b"racing-owner")
        real_link(source, target)

    monkeypatch.setattr(timeline_export.os, "link", race)
    with pytest.raises(TimelineExportError, match="timeline export failed"):
        export_timeline_mp4(
            _timeline(),
            (TimelineMediaBinding(SOURCE_HASH, tmp_path / "input.webm"),),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    assert destination.read_bytes() == b"racing-owner"


def test_aac_packet_timing_counts_only_the_presentation_interval() -> None:
    payload = b"""
    {"packets":[
      {"stream_index":1,"pts":-1024,"duration":1024,"side_data_list":[
        {"side_data_type":"Skip Samples","skip_samples":1024,"discard_padding":0}
      ]},
      {"stream_index":1,"pts":0,"duration":1024},
      {"stream_index":1,"pts":1024,"duration":578}
    ]}
    """
    assert _presentation_audio_sample_count(payload, 1) == 1602

    gap = payload.replace(b'"pts":1024', b'"pts":1025')
    with pytest.raises(TimelineExportError, match="not contiguous"):
        _presentation_audio_sample_count(gap, 1)


@pytest.mark.parametrize(
    ("payload", "message"),
    (
        (b"{}", "report is invalid"),
        (b'{"packets":[]}', "report is empty"),
        (b'{"packets":[1]}', "timing is invalid"),
        (b'{"packets":[{"stream_index":2,"pts":0,"duration":1}]}', "stream changed"),
        (b'{"packets":[{"stream_index":1,"pts":0,"duration":0}]}', "duration is invalid"),
        (
            b'{"packets":[{"stream_index":1,"pts":0,"duration":1,"side_data_list":{}}]}',
            "side data is invalid",
        ),
        (
            b'{"packets":[{"stream_index":1,"pts":0,"duration":1,'
            b'"side_data_list":[{"side_data_type":"Encryption"}]}]}',
            "side data is unsupported",
        ),
        (b'{"packets":[{"stream_index":1,"pts":-1,"duration":1}]}', "interval is invalid"),
        (b'{"packets":[{"stream_index":1,"pts":1,"duration":1}]}', "not contiguous"),
        (
            b'{"packets":[{"stream_index":1,"pts":-1,"duration":1,'
            b'"side_data_list":[{"side_data_type":"Skip Samples",'
            b'"skip_samples":1,"discard_padding":0}]}]}',
            "duration is empty",
        ),
    ),
)
def test_aac_packet_timing_rejects_malformed_or_noncontiguous_reports(
    payload: bytes, message: str
) -> None:
    with pytest.raises(TimelineExportError, match=message):
        _presentation_audio_sample_count(payload, 1)


def test_product_export_and_untyped_purpose_are_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(TimelineExportError, match="not release-approved"):
        export_timeline_mp4(
            _timeline(),
            (),
            tmp_path / "product.mp4",
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.PRODUCT_EXPORT,
        )
    with pytest.raises(TimelineExportError, match="purpose is invalid"):
        export_timeline_mp4(
            _timeline(),
            (),
            tmp_path / "invalid.mp4",
            _toolchain(tmp_path),
            purpose="DEVELOPMENT_EVIDENCE",  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    ("limit_name", "limit_value", "message"),
    (
        ("MAX_TIMELINE_EXPORT_CLIPS", 2, "clip limit"),
        ("MAX_TIMELINE_EXPORT_INPUTS", 0, "input limit"),
        ("MAX_TIMELINE_EXPORT_DURATION_FRAMES", 29, "duration limit"),
    ),
)
def test_export_resource_bounds_fail_before_media_access(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    limit_name: str,
    limit_value: int,
    message: str,
) -> None:
    monkeypatch.setattr(timeline_export, limit_name, limit_value)
    monkeypatch.setattr(
        timeline_export,
        "guarded_media_snapshot",
        lambda *_args, **_kwargs: pytest.fail("resource overflow reached media access"),
    )
    with pytest.raises(TimelineExportError, match=message):
        export_timeline_mp4(
            _timeline(),
            (),
            (tmp_path / "bounded.mp4").resolve(),
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )


def test_export_rejects_total_snapshot_bytes_before_encoding(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands = _install_success_mocks(tmp_path, monkeypatch)
    monkeypatch.setattr(timeline_export, "MAX_TIMELINE_EXPORT_TOTAL_INPUT_BYTES", 1)
    destination = (tmp_path / "too-large.mp4").resolve()
    with pytest.raises(TimelineExportError, match="total input limit"):
        export_timeline_mp4(
            _timeline(),
            (TimelineMediaBinding(SOURCE_HASH, tmp_path / "input.webm"),),
            destination,
            _toolchain(tmp_path),
            purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
        )
    assert not commands
    assert not destination.exists()


def test_filter_graph_has_an_explicit_byte_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(timeline_export, "MAX_TIMELINE_FILTER_GRAPH_BYTES", 1)
    with pytest.raises(TimelineExportError, match="filter graph"):
        _ffmpeg_arguments(
            (Path("input.webm"),),
            Path("output.mp4"),
            build_timeline_render_plan(_timeline()),
            has_audio=True,
        )


def test_export_rejects_concurrent_work_instead_of_queueing(tmp_path: Path) -> None:
    assert timeline_export._TIMELINE_EXPORT_SLOT.acquire(blocking=False)
    try:
        with pytest.raises(TimelineExportError, match="worker is busy"):
            export_timeline_mp4(
                _timeline(),
                (),
                tmp_path / "busy.mp4",
                _toolchain(tmp_path),
                purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
            )
    finally:
        timeline_export._TIMELINE_EXPORT_SLOT.release()
