"""Real Linux development-pair encoding tests; no product release assertions."""

from __future__ import annotations

import array
import hashlib
import json
import math
import os
import struct
import subprocess
import wave
import zlib
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.draft_export_encoder import DraftEncodeError, encode_draft
from aijian_api.episode_media_assembly_contracts import (
    EpisodeMediaAssemblyContentV1,
    EpisodeMediaAssemblyVersionData,
)
from aijian_api.media_toolchain import (
    MediaToolchain,
    MediaToolchainLockData,
    MediaToolchainProfileData,
    discover_media_toolchain,
)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def toolchain() -> MediaToolchain:
    root = Path("/usr/bin")
    if os.name != "posix" or not (root / "ffmpeg").exists() or not (root / "ffprobe").exists():
        pytest.skip("Requires the explicit Linux ffmpeg/ffprobe development pair")
    banner = subprocess.check_output([str(root / "ffmpeg"), "-version"]).decode()
    if not banner.startswith("ffmpeg version 7.1.5"):
        pytest.skip("Requires the explicit FFmpeg 7.1.5 development pair")
    lock = MediaToolchainLockData(
        expected_version="7.1.5",
        profiles=(
            MediaToolchainProfileData(
                profile_id="test-linux-draft-gpl",
                ffmpeg_sha256=_sha(root / "ffmpeg"),
                ffprobe_sha256=_sha(root / "ffprobe"),
                source_url="https://packages.debian.org/trixie/ffmpeg",
                license_class="GPL",
                spdx_license="GPL-2.0-or-later",
                distribution_status="DEVELOPMENT_ONLY",
            ),
        ),
    )
    return discover_media_toolchain(lock, root)


def _png(path: Path, rgb: tuple[int, int, int]) -> Path:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    pixels = b"".join(b"\x00" + bytes(rgb) * 64 for _ in range(64))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )
    return path


def _wav(path: Path, sample_rate: int, segments: list[tuple[float, float]]) -> Path:
    samples = array.array("h")
    for seconds, frequency in segments:
        samples.extend(
            int(4000 * math.sin(2 * math.pi * frequency * i / sample_rate))
            for i in range(round(seconds * sample_rate))
        )
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        output.writeframes(samples.tobytes())
    return path


def _ref(path: Path) -> dict[str, str]:
    digest = _sha(path)
    return {
        "asset_id": "asset_" + digest[:32],
        "asset_version_id": "asv_" + digest[:32],
        "sha256": digest,
    }


def _assembly(
    visuals: list[dict[str, Any]],
    audio: list[dict[str, Any]] | None = None,
    **overrides: Any,
) -> EpisodeMediaAssemblyVersionData:
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {
            "project_id": "prj_" + "1" * 32,
            "episode_id": "ep_" + "2" * 32,
            "sequence_timebase": {
                "frame_rate": {"num": 24, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": 64,
            "canvas_height": 64,
            "total_frames": visuals[-1]["end_frame"],
            "visual_segments": visuals,
            "audio_segments": audio or [],
            **overrides,
        }
    )
    return EpisodeMediaAssemblyVersionData(
        artifact_id="art_" + "3" * 32,
        version_id="ver_" + "4" * 32,
        content_hash=canonical_content_hash(content.model_dump(mode="json")),
        head_revision=1,
        parent_version_id=None,
        content=content,
        media_checks=(),
        playback_status="DRAFT_STATIC_ANIMATIC",
    )


def _visual(
    path: Path, start: int, end: int, *, kind: str = "image", offset: int = 0, play: bool = False
) -> dict[str, Any]:
    return {
        "segment_id": f"seg_visual_{start}",
        "media_kind": kind,
        "media": _ref(path),
        "start_frame": start,
        "end_frame": end,
        "source_in_frame": offset,
        "embedded_audio": "PLAY" if play else "MUTE",
    }


def _audio(path: Path, start: int, end: int, *, kind: str, offset: int = 0) -> dict[str, Any]:
    return {
        "segment_id": f"seg_{kind.lower()}_{start}",
        "track_kind": kind,
        "media": _ref(path),
        "start_frame": start,
        "end_frame": end,
        "source_in_sample": offset,
    }


def _snapshots(root: Path, paths: list[Path]) -> dict[str, Path]:
    result = {}
    for path in paths:
        digest = _sha(path)
        target = root / digest
        target.write_bytes(path.read_bytes())
        result[digest] = target
    return result


def _run(toolchain: MediaToolchain, *arguments: str) -> bytes:
    return subprocess.check_output(
        [str(toolchain.ffmpeg_path), "-v", "error", "-nostdin", "-threads", "1", *arguments],
        timeout=30,
    )


def _pixels(toolchain: MediaToolchain, path: Path) -> list[tuple[int, int, int]]:
    raw = _run(
        toolchain,
        "-i",
        str(path),
        "-map",
        "0:v:0",
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
    )
    return [tuple(raw[i : i + 3]) for i in range(0, len(raw), 3)]  # type: ignore[misc]


def _samples(toolchain: MediaToolchain, path: Path) -> array.array[int]:
    raw = _run(
        toolchain, "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"
    )
    samples = array.array("h")
    samples.frombytes(raw)
    return samples


def _power(samples: array.array[int], begin: float, end: float, frequency: int) -> float:
    start, stop = round(begin * 48000), round(end * 48000)
    values = samples[start:stop]
    return abs(
        sum(
            value
            * complex(
                math.cos(2 * math.pi * frequency * i / 48000),
                math.sin(2 * math.pi * frequency * i / 48000),
            )
            for i, value in enumerate(values)
        )
    ) / len(values)


def test_real_image_order_and_native_sample_bgm_sfx_mix(
    tmp_path: Path,
    toolchain: MediaToolchain,
) -> None:
    red = _png(tmp_path / "red.png", (255, 0, 0))
    blue = _png(tmp_path / "blue.png", (0, 0, 255))
    # Both sources have an unwanted first second: native offsets must remove it.
    bgm = _wav(tmp_path / "bgm.wav", 44100, [(1, 220), (2, 440)])
    sfx = _wav(tmp_path / "sfx.wav", 48000, [(1, 330), (1, 880)])
    assembly = _assembly(
        [_visual(red, 0, 24), _visual(blue, 24, 48)],
        [
            _audio(bgm, 0, 48, kind="BGM", offset=44100),
            _audio(sfx, 12, 36, kind="SFX", offset=48000),
        ],
    )
    output = tmp_path / "draft.mp4"
    frames: list[int] = []
    result = encode_draft(
        assembly,
        _snapshots(tmp_path, [red, blue, bgm, sfx]),
        output,
        toolchain,
        on_progress=frames.append,
        stop_requested=lambda: False,
    )
    assert result.sha256 == _sha(output)
    evidence = json.loads(result.probe_json)
    assert evidence["frames"] == 48 and evidence["audio"]["sample_rate"] == 48000
    assert evidence["title"] == "AIVORA DRAFT"
    assert evidence["comment"] == "AIVORA DRAFT - No release approval."
    assert evidence["full_decode_verified"] and evidence["cfr_pts_verified"]
    assert frames[-1] == 48
    pixels = _pixels(toolchain, output)
    assert len(pixels) == 48
    assert all(red_value > 200 and blue_value < 20 for red_value, _, blue_value in pixels[:24])
    assert all(blue_value > 200 and red_value < 20 for red_value, _, blue_value in pixels[24:])
    samples = _samples(toolchain, output)
    assert _power(samples, 0.1, 0.4, 440) > 500
    assert _power(samples, 0.1, 0.4, 220) < 30
    assert _power(samples, 0.1, 0.4, 880) < 30
    assert _power(samples, 0.7, 1.2, 440) > 500
    assert _power(samples, 0.7, 1.2, 880) > 500
    assert _power(samples, 1.6, 1.9, 880) < 30


def _video(root: Path, toolchain: MediaToolchain, *, fps: int = 24) -> Path:
    output = root / "source.mp4"
    _run(
        toolchain,
        "-f",
        "lavfi",
        "-i",
        f"color=red:size=64x64:rate={fps}:duration=1",
        "-f",
        "lavfi",
        "-i",
        f"color=blue:size=64x64:rate={fps}:duration=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=600:sample_rate=48000:duration=2",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        "aac",
        str(output),
    )
    return output


def test_real_video_frame_trim_and_embedded_play(tmp_path: Path, toolchain: MediaToolchain) -> None:
    video = _video(tmp_path, toolchain)
    assembly = _assembly(
        [
            _visual(video, 0, 24, kind="video", offset=24, play=True),
            _visual(video, 24, 48, kind="video", offset=0, play=False),
        ]
    )
    output = tmp_path / "trim.mp4"
    result = encode_draft(
        assembly,
        _snapshots(tmp_path, [video]),
        output,
        toolchain,
        on_progress=lambda _: None,
        stop_requested=lambda: False,
    )
    assert json.loads(result.probe_json)["frames"] == 48
    pixels = _pixels(toolchain, output)
    assert all(b > 200 and r < 20 for r, _, b in pixels[:24])
    assert all(r > 200 and b < 20 for r, _, b in pixels[24:])
    samples = _samples(toolchain, output)
    assert _power(samples, 0.1, 0.9, 600) > 500
    assert max(abs(v) for v in samples[round(1.1 * 48000) : round(1.9 * 48000)]) < 20


def test_real_still_without_audio(tmp_path: Path, toolchain: MediaToolchain) -> None:
    image = _png(tmp_path / "still.png", (20, 120, 30))
    output = tmp_path / "silent.mp4"
    result = encode_draft(
        _assembly([_visual(image, 0, 12)]),
        _snapshots(tmp_path, [image]),
        output,
        toolchain,
        on_progress=lambda _: None,
        stop_requested=lambda: False,
    )
    assert json.loads(result.probe_json)["audio"] is None


def test_rejects_unsupported_and_changed_sources(tmp_path: Path, toolchain: MediaToolchain) -> None:
    image = _png(tmp_path / "still.png", (50, 20, 50))
    assembly = _assembly([_visual(image, 0, 24)])
    snapshots = _snapshots(tmp_path, [image])
    output = tmp_path / "no.mp4"
    snapshots[_sha(image)].write_bytes(b"changed")
    with pytest.raises(DraftEncodeError, match="differs") as error:
        encode_draft(
            assembly,
            snapshots,
            output,
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "SOURCE_CHANGED"
    playlist = tmp_path / "playlist"
    playlist.write_text("#EXTM3U\nhttps://example.invalid/stream.ts\n")
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(playlist, 0, 24, kind="video")]),
            _snapshots(tmp_path, [playlist]),
            output,
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "SOURCE_FORMAT_UNSUPPORTED"
    assert not output.exists()


def test_rejects_subtitles_and_dialogue(tmp_path: Path, toolchain: MediaToolchain) -> None:
    image = _png(tmp_path / "still.png", (50, 20, 50))
    subtitle = {
        "segment_id": "seg_subtitle",
        "script_version_id": "ver_" + "6" * 32,
        "script_block_id": "sblk_" + "7" * 32,
        "start_frame": 0,
        "end_frame": 24,
    }
    assembly = _assembly([_visual(image, 0, 24)], subtitle_segments=[subtitle])
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            assembly,
            {},
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "SUBTITLE_UNSUPPORTED"
    audio = _audio(image, 0, 24, kind="DIALOGUE")
    audio.update(
        {
            "script_version_id": subtitle["script_version_id"],
            "script_block_id": subtitle["script_block_id"],
            "speaker_id": "spk_" + "8" * 32,
            "delivery": "ON_SCREEN",
        }
    )
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(image, 0, 24)], [audio]),
            {},
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "DIALOGUE_UNSUPPORTED"


def test_rejects_video_range_and_rate(tmp_path: Path, toolchain: MediaToolchain) -> None:
    video = _video(tmp_path, toolchain, fps=25)
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(video, 0, 24, kind="video")]),
            _snapshots(tmp_path, [video]),
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "VIDEO_FRAME_RATE_MISMATCH"
    video.unlink()
    video = _video(tmp_path, toolchain)
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(video, 0, 24, kind="video", offset=25)]),
            _snapshots(tmp_path, [video]),
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "VIDEO_RANGE_UNSUPPORTED"


def test_cancel_and_binary_pin_fail_closed(tmp_path: Path, toolchain: MediaToolchain) -> None:
    image = _png(tmp_path / "still.png", (20, 30, 40))
    assembly = _assembly([_visual(image, 0, 24)])
    snapshots = _snapshots(tmp_path, [image])
    output = tmp_path / "no.mp4"
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            assembly,
            snapshots,
            output,
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: True,
        )
    assert error.value.code == "CANCELLED" and not output.exists()
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            assembly,
            snapshots,
            output,
            replace(toolchain, ffprobe_sha256="0" * 64),
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "TOOLCHAIN_CHANGED" and not output.exists()


def test_cancellation_during_encode(tmp_path: Path, toolchain: MediaToolchain) -> None:
    image = _png(tmp_path / "still.png", (20, 30, 40))
    assembly = _assembly([_visual(image, 0, 24 * 60)], canvas_width=1920, canvas_height=1080)
    snapshots = _snapshots(tmp_path, [image])
    cancelled = False

    def progress(_: int) -> None:
        nonlocal cancelled
        cancelled = True

    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            assembly,
            snapshots,
            tmp_path / "partial.mp4",
            toolchain,
            on_progress=progress,
            stop_requested=lambda: cancelled,
        )
    assert error.value.code == "CANCELLED"


def test_ntsc_frame_boundaries_and_nonstandard_native_audio_rate(
    tmp_path: Path,
    toolchain: MediaToolchain,
) -> None:
    image = _png(tmp_path / "still.png", (20, 30, 40))
    audio = _wav(tmp_path / "audio.wav", 32000, [(1, 100), (3, 700)])
    assembly = _assembly(
        [_visual(image, 0, 61)],
        [
            _audio(audio, 1, 60, kind="BGM", offset=32000),
        ],
        sequence_timebase={
            "frame_rate": {"num": 30000, "den": 1001},
            "timecode_mode": "NON_DROP_FRAME",
        },
    )
    result = encode_draft(
        assembly,
        _snapshots(tmp_path, [image, audio]),
        tmp_path / "ntsc.mp4",
        toolchain,
        on_progress=lambda _: None,
        stop_requested=lambda: False,
    )
    evidence = json.loads(result.probe_json)
    assert evidence["frames"] == 61
    assert evidence["frame_rate"] == {"num": 30000, "den": 1001}
    assert evidence["audio"]["assembly_samples"] == 97698


def test_source_audio_range_and_existing_output_rejected(
    tmp_path: Path,
    toolchain: MediaToolchain,
) -> None:
    image = _png(tmp_path / "still.png", (20, 30, 40))
    audio = _wav(tmp_path / "audio.wav", 44100, [(1, 100)])
    assembly = _assembly([_visual(image, 0, 24)], [_audio(audio, 0, 24, kind="BGM", offset=1)])
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            assembly,
            _snapshots(tmp_path, [image, audio]),
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "AUDIO_RANGE_UNSUPPORTED"
    output = tmp_path / "existing.mp4"
    output.write_bytes(b"preserve me")
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(image, 0, 24)]),
            _snapshots(tmp_path, [image]),
            output,
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "OUTPUT_PATH_UNSAFE"
    assert output.read_bytes() == b"preserve me"


def test_canvas_segment_and_duration_bounds(tmp_path: Path, toolchain: MediaToolchain) -> None:
    image = _png(tmp_path / "still.png", (20, 30, 40))
    assemblies = [
        (_assembly([_visual(image, 0, 24)], canvas_width=65), "CANVAS_UNSUPPORTED"),
        (_assembly([_visual(image, 0, 24)], canvas_height=1922), "CANVAS_UNSUPPORTED"),
        (_assembly([_visual(image, 0, 43201)]), "DURATION_LIMIT"),
        (_assembly([_visual(image, i, i + 1) for i in range(33)]), "SEGMENT_LIMIT"),
    ]
    for assembly, code in assemblies:
        with pytest.raises(DraftEncodeError) as error:
            encode_draft(
                assembly,
                {},
                tmp_path / "no.mp4",
                toolchain,
                on_progress=lambda _: None,
                stop_requested=lambda: False,
            )
        assert error.value.code == code


def test_rejects_vfr_even_when_a_requested_range_would_fit(
    tmp_path: Path,
    toolchain: MediaToolchain,
) -> None:
    source = tmp_path / "vfr.mp4"
    _run(
        toolchain,
        "-f",
        "lavfi",
        "-i",
        "color=red:size=64x64:rate=24:duration=2",
        "-vf",
        "setpts='if(lt(N,24),N,N+4)/(24*TB)'",
        "-fps_mode",
        "vfr",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        str(source),
    )
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(source, 0, 24, kind="video")]),
            _snapshots(tmp_path, [source]),
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "VIDEO_VFR_UNSUPPORTED"


def test_linux_cancellation_reaps_exact_encoder_process_group(
    tmp_path: Path,
    toolchain: MediaToolchain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import aijian_api.draft_export_encoder as encoder

    real_popen = subprocess.Popen
    processes: list[subprocess.Popen[bytes]] = []

    def capture(*args: Any, **kwargs: Any) -> subprocess.Popen[bytes]:
        process = real_popen(*args, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(encoder.subprocess, "Popen", capture)
    image = _png(tmp_path / "still.png", (20, 30, 40))
    cancelled = False

    def progress(_: int) -> None:
        nonlocal cancelled
        cancelled = True

    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(image, 0, 24 * 120)], canvas_width=1920, canvas_height=1080),
            _snapshots(tmp_path, [image]),
            tmp_path / "partial.mp4",
            toolchain,
            on_progress=progress,
            stop_requested=lambda: cancelled,
        )
    assert error.value.code == "CANCELLED"
    assert len(processes) >= 3
    for process in processes:
        assert process.poll() is not None
        with pytest.raises(ProcessLookupError):
            os.killpg(process.pid, 0)


def test_animation_extension_cannot_be_silently_flattened(
    tmp_path: Path,
    toolchain: MediaToolchain,
) -> None:
    image = _png(tmp_path / "animated.png", (20, 30, 40))
    original = image.read_bytes()
    # Insert a valid APNG animation-control chunk after the PNG IHDR.
    data = struct.pack(">II", 2, 0)
    kind = b"acTL"
    chunk = struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    image.write_bytes(original[:33] + chunk + original[33:])
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(image, 0, 24)]),
            _snapshots(tmp_path, [image]),
            tmp_path / "no.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "ANIMATED_IMAGE_UNSUPPORTED"


def test_output_tampering_after_encode_never_returns_receipt(
    tmp_path: Path,
    toolchain: MediaToolchain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import aijian_api.draft_export_encoder as encoder

    image = _png(tmp_path / "still.png", (20, 30, 40))
    real_verify = encoder._verify_output

    def corrupt(output: Path, *args: Any, **kwargs: Any) -> Any:
        output.write_bytes(b"unverified output")
        return real_verify(output, *args, **kwargs)

    monkeypatch.setattr(encoder, "_verify_output", corrupt)
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(image, 0, 24)]),
            _snapshots(tmp_path, [image]),
            tmp_path / "bad.mp4",
            toolchain,
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "OUTPUT_CONTAINER"


def test_ffmpeg_pin_checked_after_probing_and_before_encode(
    tmp_path: Path,
    toolchain: MediaToolchain,
) -> None:
    image = _png(tmp_path / "still.png", (20, 30, 40))
    with pytest.raises(DraftEncodeError) as error:
        encode_draft(
            _assembly([_visual(image, 0, 24)]),
            _snapshots(tmp_path, [image]),
            tmp_path / "no.mp4",
            replace(toolchain, ffmpeg_sha256="0" * 64),
            on_progress=lambda _: None,
            stop_requested=lambda: False,
        )
    assert error.value.code == "TOOLCHAIN_CHANGED"
    assert not (tmp_path / "no.mp4").exists()


def test_safe_process_arguments_and_probe_output_bound(
    tmp_path: Path,
    toolchain: MediaToolchain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import aijian_api.draft_export_encoder as encoder

    real_popen = subprocess.Popen
    commands: list[list[str]] = []

    def capture(command: list[str], **kwargs: Any) -> subprocess.Popen[bytes]:
        assert kwargs["shell"] is False
        assert kwargs["start_new_session"] is True
        assert kwargs["stdin"] == subprocess.DEVNULL
        commands.append(command)
        return real_popen(command, **kwargs)

    monkeypatch.setattr(encoder.subprocess, "Popen", capture)
    image = _png(tmp_path / "still.png", (20, 30, 40))
    encode_draft(
        _assembly([_visual(image, 0, 24)]),
        _snapshots(tmp_path, [image]),
        tmp_path / "valid.mp4",
        toolchain,
        on_progress=lambda _: None,
        stop_requested=lambda: False,
    )
    assert commands
    for command in commands:
        assert command[0] in {str(toolchain.ffmpeg_path), str(toolchain.ffprobe_path)}
        assert command[command.index("-protocol_whitelist") + 1] == "file"
        assert command[command.index("-format_whitelist") + 1] in {"png_pipe", "mov"}
        assert "-f" in command and "concat" not in command
        if "mov" in command:
            assert command[command.index("-enable_drefs") + 1] == "0"
            assert command[command.index("-use_absolute_path") + 1] == "0"
    runner = encoder._Runner(toolchain, None, lambda: False)
    with pytest.raises(DraftEncodeError) as error:
        runner.run(["-version"], probe=True, limit=1)
    assert error.value.code == "PROBE_OUTPUT_LIMIT"
