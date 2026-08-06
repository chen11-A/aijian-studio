import hashlib
import io
import json
import os
import stat
import subprocess
from pathlib import Path

import aijian_api.media_probe as media_probe
import pytest
from aijian_api.media_probe import (
    MediaProbeError,
    MediaProbeErrorCode,
    probe_local_media,
)
from aijian_api.media_toolchain import MediaToolchain


def _toolchain(tmp_path: Path) -> MediaToolchain:
    ffmpeg = tmp_path / "ffmpeg"
    ffprobe = tmp_path / "ffprobe"
    ffmpeg.write_bytes(b"ffmpeg")
    ffprobe.write_bytes(b"ffprobe")
    return MediaToolchain(
        profile_id="test-fixture",
        version="8.1.2",
        ffmpeg_path=ffmpeg,
        ffprobe_path=ffprobe,
        ffmpeg_sha256=hashlib.sha256(b"ffmpeg").hexdigest(),
        ffprobe_sha256=hashlib.sha256(b"ffprobe").hexdigest(),
        configuration_flags=("--enable-gpl",),
        license_class="GPL",
        spdx_license="GPL-3.0-or-later",
        distribution_status="DEVELOPMENT_ONLY",
    )


def _summary_payload(
    byte_size: int,
    *,
    video_rate: str = "24/1",
    audio_rate: str | None = "48000",
    extra_video: bool = False,
) -> dict[str, object]:
    streams: list[dict[str, object]] = [
        {
            "index": 0,
            "codec_name": "ffv1",
            "codec_type": "video",
            "width": 160,
            "height": 90,
            "pix_fmt": "yuv420p",
            "r_frame_rate": video_rate,
            "avg_frame_rate": video_rate,
            "time_base": "1/1000",
        }
    ]
    if extra_video:
        streams.append(dict(streams[0], index=2))
    if audio_rate is not None:
        streams.append(
            {
                "index": 1,
                "codec_name": "pcm_s16le",
                "codec_type": "audio",
                "sample_rate": audio_rate,
                "channels": 1,
                "channel_layout": "mono",
                "r_frame_rate": "0/0",
                "avg_frame_rate": "0/0",
                "time_base": "1/1000",
            }
        )
    return {
        "programs": [],
        "stream_groups": [],
        "streams": streams,
        "format": {
            "format_name": "matroska,webm",
            "duration": "2.000000",
            "size": str(byte_size),
        },
    }


def _video_frames_payload(
    points: tuple[int, ...] = (0, 42, 83, 125),
    durations: tuple[int, ...] | None = None,
) -> dict[str, object]:
    selected_durations = durations or tuple(41 for _point in points)
    return {
        "frames": [
            {
                "media_type": "video",
                "stream_index": 0,
                "key_frame": 1,
                "pts": point,
                "duration": duration,
            }
            for point, duration in zip(points, selected_durations, strict=True)
        ]
    }


def _audio_frames_payload(samples: tuple[int, ...] = (1024, 1024, 512)) -> dict[str, object]:
    return {
        "frames": [
            {
                "media_type": "audio",
                "stream_index": 1,
                "pts": index * 21,
                "nb_samples": count,
            }
            for index, count in enumerate(samples)
        ]
    }


def _runner_for(
    source: Path,
    *,
    summary: dict[str, object] | None = None,
    video_frames: dict[str, object] | None = None,
    audio_frames: dict[str, object] | None = None,
    commands: list[tuple[str, ...]] | None = None,
):
    selected_summary = summary or _summary_payload(source.stat().st_size)
    selected_video_frames = video_frames or _video_frames_payload()
    selected_audio_frames = audio_frames or _audio_frames_payload()

    def run(_executable: Path, arguments: tuple[str, ...], _timeout: float) -> bytes:
        if commands is not None:
            commands.append(arguments)
        if "v:0" in arguments:
            payload = selected_video_frames
        elif "a:0" in arguments:
            payload = selected_audio_frames
        else:
            payload = selected_summary
        return json.dumps(payload).encode()

    return run


def test_probe_parses_a_local_cfr_video_and_counts_audio_samples(tmp_path: Path) -> None:
    source = tmp_path / "媒体 fixture.mkv"
    source.write_bytes(b"synthetic-media")
    commands: list[tuple[str, ...]] = []

    result = probe_local_media(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=_runner_for(source, commands=commands),
    )

    assert result.source_asset_sha256 == f"sha256:{hashlib.sha256(source.read_bytes()).hexdigest()}"
    assert result.byte_size == len(b"synthetic-media")
    assert result.format_names == ("matroska", "webm")
    assert result.container_duration.model_dump() == {"num": 2, "den": 1}
    assert result.video.average_frame_rate.model_dump() == {"num": 24, "den": 1}
    assert result.video.is_variable_frame_rate is False
    assert [frame.pts.ticks for frame in result.video.frames] == [0, 42, 83, 125]
    assert result.audio is not None
    assert result.audio.sample_rate_hz == 48000
    assert result.audio.total_samples == 2560
    assert len(commands) == 3
    assert all("-protocol_whitelist" in command for command in commands)
    assert all(command[command.index("-analyzeduration") + 1] == "10000000" for command in commands)
    assert len({command[-1] for command in commands}) == 1
    assert all(command[-1] != str(source.resolve()) for command in commands)
    assert all("http" not in command and "https" not in command for command in commands)


def test_probe_detects_vfr_against_the_declared_rational_cadence(tmp_path: Path) -> None:
    source = tmp_path / "vfr.mkv"
    source.write_bytes(b"vfr")

    result = probe_local_media(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=_runner_for(
            source,
            summary=_summary_payload(source.stat().st_size, video_rate="25/1"),
            video_frames=_video_frames_payload((0, 40, 100, 140)),
        ),
    )

    assert result.video.is_variable_frame_rate is True


def test_probe_detects_vfr_when_only_the_last_frame_duration_changes(tmp_path: Path) -> None:
    source = tmp_path / "last-frame-vfr.mkv"
    source.write_bytes(b"vfr-duration")

    result = probe_local_media(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=_runner_for(
            source,
            summary=_summary_payload(source.stat().st_size, video_rate="25/1"),
            video_frames=_video_frames_payload(
                (0, 40, 80, 120),
                durations=(40, 40, 40, 60),
            ),
        ),
    )

    assert result.video.is_variable_frame_rate is True


def test_probe_accepts_a_video_without_audio(tmp_path: Path) -> None:
    source = tmp_path / "silent.mkv"
    source.write_bytes(b"silent")
    commands: list[tuple[str, ...]] = []

    result = probe_local_media(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=_runner_for(
            source,
            summary=_summary_payload(source.stat().st_size, audio_rate=None),
            commands=commands,
        ),
    )

    assert result.audio is None
    assert len(commands) == 2


@pytest.mark.parametrize("relative", [Path("relative.mkv"), Path("https:/example.test/a.mkv")])
def test_probe_rejects_non_absolute_input(relative: Path, tmp_path: Path) -> None:
    with pytest.raises(MediaProbeError) as error:
        probe_local_media(relative, _toolchain(tmp_path))

    assert error.value.code is MediaProbeErrorCode.INPUT_NOT_LOCAL


def test_probe_rejects_windows_unc_before_touching_the_filesystem(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_resolve(_path: Path, *, strict: bool = False) -> Path:
        del strict
        raise AssertionError("UNC input reached filesystem resolution")

    monkeypatch.setattr(Path, "resolve", unexpected_resolve)
    with pytest.raises(MediaProbeError) as error:
        probe_local_media(Path(r"\\server\share\media.mkv"), _toolchain(tmp_path))

    assert error.value.code is MediaProbeErrorCode.INPUT_NOT_LOCAL


@pytest.mark.skipif(os.name != "nt", reason="Windows extended paths are platform-specific")
def test_extended_local_drive_path_is_not_classified_as_remote() -> None:
    assert not media_probe._is_remote_windows_path(Path(r"\\?\C:\media.mkv"))
    assert media_probe._is_remote_windows_path(Path(r"\\?\UNC\server\share\media.mkv"))


def test_probe_rejects_a_same_name_file_replaced_before_the_stable_open(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "identity.mkv"
    replacement = tmp_path / "replacement.mkv"
    source.write_bytes(b"original-a")
    replacement.write_bytes(b"replaced-b")
    real_open = media_probe._open_local_source

    def replacing_open(path: Path):
        os.replace(replacement, path)
        return real_open(path)

    monkeypatch.setattr(media_probe, "_open_local_source", replacing_open)

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(source.resolve(), _toolchain(tmp_path))

    assert error.value.code is MediaProbeErrorCode.INPUT_CHANGED


def test_probe_rejects_missing_files_and_directories(tmp_path: Path) -> None:
    toolchain = _toolchain(tmp_path)
    with pytest.raises(MediaProbeError) as missing_error:
        probe_local_media((tmp_path / "missing.mkv").resolve(), toolchain)
    assert missing_error.value.code is MediaProbeErrorCode.INPUT_NOT_FOUND

    directory = tmp_path / "directory"
    directory.mkdir()
    with pytest.raises(MediaProbeError) as directory_error:
        probe_local_media(directory.resolve(), toolchain)
    assert directory_error.value.code is MediaProbeErrorCode.INPUT_NOT_FOUND


def test_probe_rejects_multiple_video_streams(tmp_path: Path) -> None:
    source = tmp_path / "multiple.mkv"
    source.write_bytes(b"multiple")

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(
                source,
                summary=_summary_payload(source.stat().st_size, extra_video=True),
            ),
        )

    assert error.value.code is MediaProbeErrorCode.UNSUPPORTED_LAYOUT


def test_probe_rejects_unexpected_stream_types(tmp_path: Path) -> None:
    source = tmp_path / "attachment.mkv"
    source.write_bytes(b"attachment")
    summary = _summary_payload(source.stat().st_size)
    streams = summary["streams"]
    assert isinstance(streams, list)
    streams.append({"index": 3, "codec_name": "ttf", "codec_type": "attachment"})

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(source, summary=summary),
        )

    assert error.value.code is MediaProbeErrorCode.UNSUPPORTED_LAYOUT


def test_probe_rejects_an_unsupported_audio_sample_rate(tmp_path: Path) -> None:
    source = tmp_path / "32000.mkv"
    source.write_bytes(b"audio")

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(
                source,
                summary=_summary_payload(source.stat().st_size, audio_rate="32000"),
            ),
        )

    assert error.value.code is MediaProbeErrorCode.UNSUPPORTED_LAYOUT


def test_probe_rejects_an_audio_sample_total_above_the_json_safe_limit(tmp_path: Path) -> None:
    source = tmp_path / "audio-overflow.mkv"
    source.write_bytes(b"audio-overflow")
    audio_frames = _audio_frames_payload((2**53 - 1, 1))

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(source, audio_frames=audio_frames),
        )

    assert error.value.code is MediaProbeErrorCode.INVALID_OUTPUT


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        (b"not-json", MediaProbeErrorCode.INVALID_OUTPUT),
        (b"{}", MediaProbeErrorCode.INVALID_OUTPUT),
        (b"x" * (2 * 1024 * 1024 + 1), MediaProbeErrorCode.OUTPUT_LIMIT),
    ],
    ids=("malformed-json", "missing-fields", "oversized-output"),
)
def test_probe_rejects_invalid_or_oversized_ffprobe_output(
    tmp_path: Path,
    payload: bytes,
    expected_code: MediaProbeErrorCode,
) -> None:
    source = tmp_path / "bad-output.mkv"
    source.write_bytes(b"input")

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=lambda _executable, _arguments, _timeout: payload,
        )

    assert error.value.code is expected_code


def test_probe_normalizes_deeply_nested_json(tmp_path: Path) -> None:
    source = tmp_path / "nested-json.mkv"
    source.write_bytes(b"nested")
    nested = b"[" * 2_000 + b"]" * 2_000

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=lambda _executable, _arguments, _timeout: nested,
        )

    assert error.value.code is MediaProbeErrorCode.INVALID_OUTPUT
    assert error.value.__cause__ is None


@pytest.mark.parametrize("invalid_duration", ["1e999999", "21600.000000001"])
def test_probe_rejects_unbounded_container_durations(
    tmp_path: Path,
    invalid_duration: str,
) -> None:
    source = tmp_path / "duration.mkv"
    source.write_bytes(b"duration")
    summary = _summary_payload(source.stat().st_size)
    format_data = summary["format"]
    assert isinstance(format_data, dict)
    format_data["duration"] = invalid_duration

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(source, summary=summary),
        )

    assert error.value.code is MediaProbeErrorCode.INVALID_OUTPUT


def test_probe_rejects_non_monotonic_video_pts(tmp_path: Path) -> None:
    source = tmp_path / "bad-pts.mkv"
    source.write_bytes(b"pts")

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(
                source,
                video_frames=_video_frames_payload((0, 42, 41)),
            ),
        )

    assert error.value.code is MediaProbeErrorCode.INVALID_OUTPUT


def test_probe_detects_an_input_changed_during_probe(tmp_path: Path) -> None:
    source = tmp_path / "changing.mkv"
    source.write_bytes(b"before")
    summary = _summary_payload(source.stat().st_size)
    calls = 0
    mutation_blocked = False

    def mutating_runner(_executable: Path, arguments: tuple[str, ...], _timeout: float) -> bytes:
        nonlocal calls, mutation_blocked
        calls += 1
        if calls == 1:
            try:
                source.write_bytes(b"after-probe")
            except OSError:
                mutation_blocked = True
        if "v:0" in arguments:
            return json.dumps(_video_frames_payload()).encode()
        if "a:0" in arguments:
            return json.dumps(_audio_frames_payload()).encode()
        return json.dumps(summary).encode()

    try:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=mutating_runner,
        )
    except MediaProbeError as error:
        assert error.code is MediaProbeErrorCode.INPUT_CHANGED
    else:
        assert mutation_blocked is True


def test_probe_uses_one_guarded_snapshot_when_the_source_is_replaced_and_restored(
    tmp_path: Path,
) -> None:
    source = tmp_path / "aba.mkv"
    original = b"version-a"
    replacement = b"version-b"
    source.write_bytes(original)
    original_times = source.stat()
    commands: list[tuple[str, ...]] = []
    calls = 0
    mutation_blocked = False

    def aba_runner(_executable: Path, arguments: tuple[str, ...], _timeout: float) -> bytes:
        nonlocal calls, mutation_blocked
        calls += 1
        commands.append(arguments)
        try:
            source.write_bytes(replacement if calls < 3 else original)
            if calls == 3:
                os.utime(source, ns=(original_times.st_atime_ns, original_times.st_mtime_ns))
        except OSError:
            mutation_blocked = True
        snapshot_bytes = Path(arguments[-1]).read_bytes()
        if "v:0" in arguments:
            return json.dumps(_video_frames_payload()).encode()
        if "a:0" in arguments:
            return json.dumps(_audio_frames_payload()).encode()
        summary = _summary_payload(len(snapshot_bytes))
        video_stream = summary["streams"][0]
        assert isinstance(video_stream, dict)
        video_stream["codec_name"] = "codec-a" if snapshot_bytes == original else "codec-b"
        return json.dumps(summary).encode()

    result = probe_local_media(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=aba_runner,
    )

    assert result.video.codec_name == "codec-a"
    assert mutation_blocked is True
    assert len({command[-1] for command in commands}) == 1
    assert commands[0][-1] != str(source.resolve())


def test_probe_holds_a_snapshot_lock_while_the_probe_process_runs(tmp_path: Path) -> None:
    source = tmp_path / "snapshot-tamper.mkv"
    source.write_bytes(b"version-a")
    tamper_blocked = False

    def tampering_runner(
        _executable: Path,
        arguments: tuple[str, ...],
        _timeout: float,
    ) -> bytes:
        nonlocal tamper_blocked
        snapshot = Path(arguments[-1])
        try:
            os.chmod(snapshot, stat.S_IWRITE)
            snapshot.write_bytes(b"version-b")
            snapshot.write_bytes(b"version-a")
            os.chmod(snapshot, stat.S_IREAD)
        except OSError:
            tamper_blocked = True
        if "v:0" in arguments:
            return json.dumps(_video_frames_payload()).encode()
        if "a:0" in arguments:
            return json.dumps(_audio_frames_payload()).encode()
        return json.dumps(_summary_payload(len(b"version-a"))).encode()

    result = probe_local_media(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=tampering_runner,
    )

    assert tamper_blocked is True
    assert result.video.codec_name == "ffv1"


@pytest.mark.parametrize(
    ("raised", "expected_code"),
    [
        (subprocess.TimeoutExpired(cmd=["ffprobe"], timeout=20), MediaProbeErrorCode.TIMEOUT),
        (
            subprocess.CalledProcessError(returncode=1, cmd=["ffprobe"]),
            MediaProbeErrorCode.PROBE_FAILED,
        ),
        (OSError("process failed"), MediaProbeErrorCode.PROBE_FAILED),
    ],
)
def test_probe_normalizes_process_failures(
    tmp_path: Path,
    raised: Exception,
    expected_code: MediaProbeErrorCode,
) -> None:
    source = tmp_path / "failure.mkv"
    source.write_bytes(b"failure")

    def failed_runner(_executable: Path, _arguments: tuple[str, ...], _timeout: float) -> bytes:
        raise raised

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=failed_runner,
        )

    assert error.value.code is expected_code
    assert error.value.__cause__ is None


def test_default_runner_disables_stdin_and_shell_interpretation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executable = tmp_path / "ffprobe"
    executable.write_bytes(b"probe")
    calls: list[tuple[list[str], dict[str, object]]] = []

    class FakeProcess:
        def __init__(self, command: list[str], **kwargs: object) -> None:
            calls.append((command, kwargs))
            self.stdout = io.BytesIO(b"{}")
            self.returncode = 0

        def wait(self, timeout: float | None = None) -> int:
            del timeout
            return self.returncode

        def kill(self) -> None:
            self.returncode = -9

    monkeypatch.setattr(media_probe.subprocess, "Popen", FakeProcess)

    assert media_probe.run_ffprobe_command(executable, ("-version",), 3.0) == b"{}"
    assert calls[0][0] == [str(executable), "-version"]
    assert calls[0][1]["stdin"] is subprocess.DEVNULL
    assert calls[0][1]["stderr"] is subprocess.STDOUT
    assert "shell" not in calls[0][1]


def test_default_runner_stops_reading_when_combined_output_exceeds_the_limit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executable = tmp_path / "ffprobe"
    executable.write_bytes(b"probe")

    class OversizedProcess:
        def __init__(self, _command: list[str], **_kwargs: object) -> None:
            self.stdout = io.BytesIO(b"x" * (2 * 1024 * 1024 + 1))
            self.returncode = 0

        def wait(self, timeout: float | None = None) -> int:
            del timeout
            return self.returncode

        def kill(self) -> None:
            self.returncode = -9

    monkeypatch.setattr(media_probe.subprocess, "Popen", OversizedProcess)

    with pytest.raises(MediaProbeError) as error:
        media_probe.run_ffprobe_command(executable, ("-version",), 3.0)

    assert error.value.code is MediaProbeErrorCode.OUTPUT_LIMIT


def test_invalid_json_does_not_survive_in_the_public_exception_chain(tmp_path: Path) -> None:
    source = tmp_path / "private-output.mkv"
    source.write_bytes(b"input")

    with pytest.raises(MediaProbeError) as error:
        probe_local_media(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=lambda _executable, _arguments, _timeout: b"private ffprobe data",
        )

    assert error.value.code is MediaProbeErrorCode.INVALID_OUTPUT
    assert error.value.__cause__ is None
