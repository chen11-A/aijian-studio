"""Pure byte/parser boundaries; synthetic probe replies do not verify real media."""

import hashlib
import io
import json
import threading
from contextlib import contextmanager
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import draft_export_encoder as encoder
from aijian_api.product_export_windows_job import ProductExportJobProcess


def source(kind="video", demuxer="mov"):
    return encoder._Source(Path("synthetic.media"), "a" * 64, demuxer, kind, 100, (1, 2, 100, 3))


@pytest.mark.parametrize(
    "header,kind,expected",
    [
        (b"\x89PNG\r\n\x1a\n", "image", "png_pipe"),
        (b"\xff\xd8\xff", "image", "jpeg_pipe"),
        (b"RIFF0000WEBP", "image", "webp_pipe"),
        (b"0000ftyp", "video", "mov"),
        (b"0000ftyp", "audio", "mov"),
        (b"\x1a\x45\xdf\xa3", "video", "matroska"),
        (b"\x1a\x45\xdf\xa3", "audio", "matroska"),
        (b"RIFF0000AVI ", "video", "avi"),
        (b"RIFF0000WAVE", "audio", "wav"),
        (b"fLaC", "audio", "flac"),
        (b"OggS", "audio", "ogg"),
        (b"ID3", "audio", "mp3"),
        (b"\xff\xe2", "audio", "mp3"),
        (b"\xff\xf0", "audio", "aac"),
    ],
)
def test_closed_magic_demuxer_selection(header, kind, expected):
    assert encoder._demuxer(header, kind) == expected


@pytest.mark.parametrize("header", [b"", b"#EXTM3U", b"<MPD>", b"file 'x.mp4'", b"\xff"])
@pytest.mark.parametrize("kind", ["image", "video", "audio"])
def test_playlists_unknown_and_truncated_magic_are_not_inputs(header, kind):
    with pytest.raises(encoder.DraftEncodeError) as caught:
        encoder._demuxer(header, kind)
    assert caught.value.code == "SOURCE_FORMAT_UNSUPPORTED"


@pytest.mark.parametrize("demuxer", ["mov", "wav"])
def test_input_arguments_restrict_protocol_and_demuxer(demuxer):
    arguments = encoder._input_arguments(source(demuxer=demuxer))
    assert arguments[:6] == [
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        demuxer,
        "-f",
        demuxer,
    ]
    assert ("-enable_drefs" in arguments) is (demuxer == "mov")
    if demuxer == "mov":
        assert arguments[-4:] == ["-enable_drefs", "0", "-use_absolute_path", "0"]


def png_chunk(kind, data=b""):
    return len(data).to_bytes(4, "big") + kind + data + b"\0" * 4


def webp_chunk(kind, data=b""):
    chunk = kind + len(data).to_bytes(4, "little") + data
    return chunk + (b"\0" if len(data) % 2 else b"")


def webp(chunks):
    body = b"WEBP" + chunks
    return b"RIFF" + len(body).to_bytes(4, "little") + body


@pytest.mark.parametrize(
    "kind,payload,code",
    [
        ("png_pipe", b"\x89PNG\r\n\x1a\n" + png_chunk(b"acTL"), "ANIMATED_IMAGE_UNSUPPORTED"),
        ("png_pipe", b"\x89PNG\r\n\x1a\n" + png_chunk(b"fcTL"), "ANIMATED_IMAGE_UNSUPPORTED"),
        ("png_pipe", b"\x89PNG\r\n\x1a\n" + png_chunk(b"fdAT"), "ANIMATED_IMAGE_UNSUPPORTED"),
        ("webp_pipe", webp(webp_chunk(b"ANIM")), "ANIMATED_IMAGE_UNSUPPORTED"),
        ("webp_pipe", webp(webp_chunk(b"ANMF")), "ANIMATED_IMAGE_UNSUPPORTED"),
        ("webp_pipe", webp(webp_chunk(b"VP8X", b"\x02")), "ANIMATED_IMAGE_UNSUPPORTED"),
        ("webp_pipe", b"RIFF\0\0\0\0WEBP", "SOURCE_FORMAT_UNSUPPORTED"),
        ("webp_pipe", webp(b"trunc"), "SOURCE_FORMAT_UNSUPPORTED"),
        ("webp_pipe", webp(b"VP8 " + (20).to_bytes(4, "little")), "SOURCE_FORMAT_UNSUPPORTED"),
        ("png_pipe", b"\x89PNG\r\n\x1a\n" + b"trunc", "SOURCE_FORMAT_UNSUPPORTED"),
        (
            "png_pipe",
            b"\x89PNG\r\n\x1a\n" + (20).to_bytes(4, "big") + b"IDAT",
            "SOURCE_FORMAT_UNSUPPORTED",
        ),
    ],
)
def test_animated_or_truncated_static_container_is_rejected(kind, payload, code):
    with pytest.raises(encoder.DraftEncodeError) as caught:
        encoder._require_static_image(io.BytesIO(payload), kind, len(payload), Mock())
    assert caught.value.code == code


@pytest.mark.parametrize(
    "kind,payload",
    [
        ("png_pipe", b"\x89PNG\r\n\x1a\n" + png_chunk(b"IEND")),
        ("webp_pipe", webp(webp_chunk(b"VP8X", b"\0"))),
        ("jpeg_pipe", b"synthetic"),
    ],
)
def test_static_chunk_scan_rewinds_without_claiming_decode(kind, payload):
    stream = io.BytesIO(payload)
    encoder._require_static_image(stream, kind, len(payload), Mock())
    assert stream.tell() == 0


@pytest.mark.parametrize("value", [None, 1, "1" * 41, "0", "-1", "not-rational"])
def test_invalid_rational_is_rejected(value):
    with pytest.raises(ValueError):
        encoder._positive_fraction(value)


def test_positive_rational_remains_exact():
    assert encoder._positive_fraction("30000/1001") == Fraction(30000, 1001)


@pytest.mark.parametrize(
    "body", [b"", b"\n||\n", b"pts=0|pts=1", b"unknown=1", b"pts=bad", b"\xff=1", b"pts"]
)
def test_compact_frame_parser_refuses_empty_duplicate_or_unknown_fields(body):
    runner = Mock()
    runner.run.return_value = body
    with pytest.raises(encoder.DraftEncodeError) as caught:
        encoder._scan_frames(source(), runner, "v:0")
    assert caught.value.code == "SOURCE_TIMING_INVALID"


def test_compact_frame_parser_retains_exact_values_and_enforces_frame_limit(monkeypatch):
    runner = Mock()
    runner.run.return_value = b"\n|pts=0|duration=1|\npts=1|duration=1\n"
    assert encoder._scan_frames(source(), runner, "v:0") == [
        {"pts": 0, "duration": 1},
        {"pts": 1, "duration": 1},
    ]
    monkeypatch.setattr(encoder, "MAX_SOURCE_FRAMES", 1)
    with pytest.raises(encoder.DraftEncodeError) as caught:
        encoder._scan_frames(source(), runner, "v:0")
    assert caught.value.code == "SOURCE_TIMING_INVALID"


def video_summary():
    return {
        "streams": [
            {
                "codec_type": "video",
                "width": 320,
                "height": 568,
                "codec_name": "h264",
                "pix_fmt": "yuv420p",
                "avg_frame_rate": "25/1",
                "time_base": "1/25",
            }
        ],
        "format": {"duration": "0.08"},
    }


def audio_summary():
    return {
        "streams": [
            {
                "codec_type": "audio",
                "sample_rate": "48000",
                "channels": 2,
                "codec_name": "aac",
                "time_base": "1/48000",
            }
        ],
        "format": {"duration": "0.04"},
    }


def probe_reply(summary, frames, kind="video"):
    runner = Mock()
    runner.run.side_effect = [json.dumps(summary).encode(), frames]
    return encoder._probe(source(kind), runner)


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("width", 0, "SOURCE_PROBE_INVALID"),
        ("height", 8193, "SOURCE_PROBE_INVALID"),
        ("avg_frame_rate", "0", "SOURCE_PROBE_INVALID"),
        ("time_base", "1/0", "SOURCE_PROBE_INVALID"),
        ("side_data_list", [{"rotation": 90}], "VIDEO_ROTATION_UNSUPPORTED"),
    ],
)
def test_probe_rejects_unsupported_geometry_rate_and_rotation(field, value, code):
    summary = video_summary()
    summary["streams"][0][field] = value
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(summary, b"pts=0|duration=1\npts=1|duration=1")
    assert caught.value.code == code


@pytest.mark.parametrize(
    "frames", [b"pts=0|duration=1\npts=2|duration=1", b"pts=0|duration=2\npts=1|duration=1"]
)
def test_probe_refuses_variable_frame_rate(frames):
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(video_summary(), frames)
    assert caught.value.code == "VIDEO_VFR_UNSUPPORTED"


def test_image_requires_one_decoded_frame():
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(video_summary(), b"pts=0\npts=1", "image")
    assert caught.value.code == "ANIMATED_IMAGE_UNSUPPORTED"
    assert probe_reply(video_summary(), b"pts=0", "image").frames == 1


@pytest.mark.parametrize(
    "streams",
    [
        None,
        [],
        [{"codec_type": "subtitle"}],
        [{"codec_type": "video"}] * 3,
        [{"codec_type": "video"}] * 2,
    ],
)
def test_probe_stream_layout_is_closed(streams):
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply({"streams": streams}, b"pts=0")
    assert caught.value.code == "SOURCE_PROBE_INVALID"


@pytest.mark.parametrize(
    "field,value", [("sample_rate", "7999"), ("sample_rate", "192001"), ("channels", 3)]
)
def test_audio_probe_rejects_unsupported_layout(field, value):
    summary = audio_summary()
    summary["streams"][0][field] = value
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(summary, b"pts=0|nb_samples=960", "audio")
    assert caught.value.code == "AUDIO_LAYOUT_UNSUPPORTED"


@pytest.mark.parametrize(
    "frames,code",
    [
        (b"pts=0|nb_samples=960\npts=1000|nb_samples=960", "AUDIO_TIMING_UNSUPPORTED"),
        (b"pts=0|nb_samples=0", "SOURCE_PROBE_INVALID"),
        (b"pts=0|nb_samples=192001", "SOURCE_PROBE_INVALID"),
    ],
)
def test_audio_probe_rejects_gaps_or_invalid_sample_counts(frames, code):
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(audio_summary(), frames, "audio")
    assert caught.value.code == code


def test_probe_enforces_duration_limits_and_preserves_exact_audio(monkeypatch):
    summary = video_summary()
    summary["format"]["duration"] = "21601"
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(summary, b"pts=0")
    assert caught.value.code == "SOURCE_PROBE_INVALID"
    actual = probe_reply(audio_summary(), b"pts=0|nb_samples=960\npts=960|nb_samples=960", "audio")
    assert actual.audio.samples == 1920 and actual.audio.first_time == 0
    monkeypatch.setattr(encoder, "MAX_SOURCE_SECONDS", 1)
    summary = audio_summary()
    summary["format"].pop("duration")
    with pytest.raises(encoder.DraftEncodeError) as caught:
        probe_reply(summary, b"pts=0|nb_samples=48001", "audio")
    assert caught.value.code == "SOURCE_PROBE_INVALID"


def test_runner_hash_and_cancel_limits_are_checked_without_a_process(monkeypatch):
    runner = encoder._Runner(SimpleNamespace(), Mock(), lambda: False)
    payload = io.BytesIO(b"synthetic")
    assert len(runner.hash_stream(payload)) == 64
    assert payload.tell() == 0
    monkeypatch.setattr(encoder, "MAX_SOURCE_BYTES", 1)
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.hash_stream(payload)
    assert caught.value.code == "SOURCE_SIZE"
    runner.stop_requested = lambda: True
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.check()
    assert caught.value.code == "CANCELLED"
    runner.stop_requested = lambda: False
    runner.deadline = 0
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.check()
    assert caught.value.code == "TIMEOUT"


@pytest.fixture
def process_boundary(monkeypatch):
    """Synchronous readers make phase-failure assertions independent of scheduling."""

    class Reader:
        def __init__(self, target, **kwargs):
            self.target = target

        def start(self):
            self.target()

        def join(self, **kwargs):
            pass

        def is_alive(self):
            return False

    @contextmanager
    def opened(path):
        yield io.BytesIO(b"synthetic-tool")

    tool_hash = hashlib.sha256(b"synthetic-tool").hexdigest()
    tools = SimpleNamespace(
        ffmpeg_path=Path("synthetic-ffmpeg"),
        ffprobe_path=Path("synthetic-ffprobe"),
        ffmpeg_sha256=tool_hash,
        ffprobe_sha256=tool_hash,
        external_selected=False,
    )
    process = Mock(spec=ProductExportJobProcess)
    process.stdout = io.BytesIO(b"result")
    process.stderr = io.BytesIO()
    process.poll.return_value = 0
    process.returncode = 0
    manager = Mock()
    manager.spawn.return_value = process
    monkeypatch.setattr(encoder, "_open_local_source", opened)
    monkeypatch.setattr(encoder, "threading", SimpleNamespace(Thread=Reader, Event=threading.Event))
    monkeypatch.setattr(
        encoder,
        "os",
        SimpleNamespace(
            name="nt", environ={"PATH": "synthetic-only", "UNRELATED_SECRET": "not-forwarded"}
        ),
    )
    monkeypatch.setattr(encoder, "sys", SimpleNamespace(platform="win32"))
    return encoder._Runner(tools, manager, lambda: False), process, manager


@pytest.mark.parametrize("probe", [False, True])
def test_runner_pins_tool_and_closes_job_on_success(process_boundary, probe):
    runner, process, manager = process_boundary
    assert runner.run(["synthetic-argument"], probe=probe) == b"result"
    manager.spawn.assert_called_once()
    assert manager.spawn.call_args.args == (
        runner.toolchain.ffprobe_path if probe else runner.toolchain.ffmpeg_path,
        ["synthetic-argument"],
    )
    assert manager.spawn.call_args.kwargs["env"] == {"PATH": "synthetic-only"}
    process.terminate.assert_called_once()
    process.wait.assert_called_once_with(timeout=5.0)
    manager.release.assert_called_once_with(process)


@pytest.mark.parametrize(
    "phase,code",
    [
        ("tool_hash", "TOOLCHAIN_CHANGED"),
        ("tool_open", "TOOLCHAIN_UNAVAILABLE"),
        ("spawn", "PROCESS_LAUNCH_FAILED"),
    ],
)
def test_prelaunch_failure_has_no_fallback(process_boundary, monkeypatch, phase, code):
    runner, process, manager = process_boundary
    if phase == "tool_hash":
        runner.toolchain.ffmpeg_sha256 = "0" * 64
    elif phase == "tool_open":
        monkeypatch.setattr(encoder, "_open_local_source", Mock(side_effect=OSError("missing")))
    else:
        manager.spawn.side_effect = OSError("synthetic launch failure")
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.run([])
    assert caught.value.code == code
    assert manager.spawn.call_count == (1 if phase == "spawn" else 0)
    process.terminate.assert_not_called()
    manager.release.assert_not_called()


@pytest.mark.parametrize(
    "fault,code",
    [
        ("overflow", "PROBE_OUTPUT_LIMIT"),
        ("stderr", "ENCODER_FAILED"),
        ("exit", "ENCODER_FAILED"),
        ("read", "PIPE_FAILED"),
        ("stderr_read", "PIPE_FAILED"),
    ],
)
def test_postlaunch_failures_always_terminate_and_release(process_boundary, fault, code):
    runner, process, manager = process_boundary
    if fault == "overflow":
        process.stdout = io.BytesIO(b"x" * 11)
    elif fault == "stderr":
        process.stderr = io.BytesIO(b"synthetic decode diagnostic")
    elif fault == "exit":
        process.returncode = 1
    else:
        stream = Mock()
        stream.read.side_effect = OSError("pipe unavailable")
        if fault == "read":
            process.stdout = stream
        else:
            process.stderr = stream
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.run([], limit=10)
    assert caught.value.code == code
    process.terminate.assert_called_once()
    manager.release.assert_called_once_with(process)


def test_probe_error_is_distinct_from_encode_error(process_boundary):
    runner, process, manager = process_boundary
    process.returncode = 1
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.run([], probe=True)
    assert caught.value.code == "PROBE_FAILED"
    manager.release.assert_called_once()


def test_progress_ignores_invalid_and_out_of_range_frames(process_boundary):
    runner, process, manager = process_boundary
    process.stdout = io.BytesIO(b"frame=bad\nframe=-1\nframe=99\nframe=2\nframe=1\n")
    progress = []
    assert runner.run([], on_progress=progress.append, total_frames=10) == b""
    assert progress == [2]
    manager.release.assert_called_once()


@pytest.mark.parametrize(
    "fault,code",
    [
        ("overflow", "PROBE_OUTPUT_LIMIT"),
        ("read", "PIPE_FAILED"),
        ("output", "OUTPUT_SIZE"),
        ("timeout", "TIMEOUT"),
    ],
)
def test_running_process_guards_terminate_before_retry(process_boundary, monkeypatch, fault, code):
    runner, process, manager = process_boundary
    process.poll.side_effect = [None, 0]
    output = None
    if fault == "overflow":
        process.stdout = io.BytesIO(b"x" * 11)
    elif fault == "read":
        process.stdout = Mock()
        process.stdout.read.side_effect = ValueError("closed")
    elif fault == "output":
        output = Mock()
        output.exists.return_value = True
        output.stat.return_value = SimpleNamespace(st_size=encoder.MAX_OUTPUT_BYTES + 1)
    else:
        runner.deadline = 100
        monkeypatch.setattr(
            encoder, "time", SimpleNamespace(monotonic=Mock(side_effect=[0, 0, 0, 1, 1]))
        )
        monkeypatch.setattr(encoder, "MAX_PROCESS_SECONDS", 0.5)
    with pytest.raises(encoder.DraftEncodeError) as caught:
        runner.run([], limit=10, output=output)
    assert caught.value.code == code
    manager.spawn.assert_called_once()
    process.terminate.assert_called_once()
    manager.release.assert_called_once()


def test_progress_emits_monotonic_running_frames(process_boundary):
    runner, process, _ = process_boundary
    process.stdout = io.BytesIO(b"frame=2\nframe=1\nframe=3\n")
    process.poll.side_effect = [None, None, None, 0]
    progress = []
    runner.run([], on_progress=progress.append, total_frames=3)
    assert progress == [2, 3, 3]
