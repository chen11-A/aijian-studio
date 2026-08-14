import hashlib
import os
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import aijian_api.media_proxy as media_proxy
import pytest
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
from aijian_api.media_proxy import (
    GuardedMediaSnapshot,
    MediaProxyError,
    build_proxy_time_map,
    generate_cfr_proxy,
    guarded_media_snapshot,
)
from aijian_api.media_toolchain import MediaToolchain

HASH_A = "sha256:" + "a" * 64
HASH_B = "sha256:" + "b" * 64


def _timebase() -> SequenceTimebaseData:
    return SequenceTimebaseData(
        frame_rate=SequenceFrameRateData(num=25, den=1),
        timecode_mode="NON_DROP_FRAME",
    )


def _probe(
    asset_hash: str,
    pts: tuple[int, ...],
    *,
    frame_rate: tuple[int, int],
    variable: bool,
    audio_rate: int | None,
) -> LocalMediaProbeData:
    time_base = PositiveRationalData(num=1, den=1000)
    audio = None
    if audio_rate is not None:
        audio = AudioProbeData(
            stream_index=1,
            codec_name="opus",
            sample_rate_hz=audio_rate,
            channels=1,
            channel_layout="mono",
            time_base=PositiveRationalData(num=1, den=audio_rate),
            total_samples=audio_rate,
        )
    return LocalMediaProbeData(
        source_asset_sha256=asset_hash,
        byte_size=100,
        format_names=("matroska", "webm"),
        container_duration=PositiveRationalData(num=1, den=1),
        video=VideoProbeData(
            stream_index=0,
            codec_name="vp9",
            width=160,
            height=90,
            pixel_format="yuv420p",
            average_frame_rate=PositiveRationalData(num=frame_rate[0], den=frame_rate[1]),
            time_base=time_base,
            frames=tuple(
                VideoFrameProbeData(pts=MediaTimestampData(ticks=ticks, time_base=time_base))
                for ticks in pts
            ),
            is_variable_frame_rate=variable,
        ),
        audio=audio,
    )


def test_proxy_time_map_uses_the_last_frame_presented_at_each_cfr_start() -> None:
    source = _probe(
        HASH_A,
        (1000, 1042, 1084, 1126),
        frame_rate=(24, 1),
        variable=True,
        audio_rate=44_100,
    )
    proxy = _probe(
        HASH_B,
        (0, 40, 80, 120, 160),
        frame_rate=(25, 1),
        variable=False,
        audio_rate=48_000,
    )

    mapping = build_proxy_time_map(source, proxy, _timebase())

    assert [entry.source_frame_index for entry in mapping.entries] == [0, 0, 1, 2, 3]
    assert [entry.source_pts.ticks for entry in mapping.entries] == [
        1000,
        1000,
        1042,
        1084,
        1126,
    ]
    assert mapping.source_asset_sha256 == HASH_A
    assert mapping.proxy_asset_sha256 == HASH_B


@pytest.mark.parametrize(
    ("frame_rate", "variable", "audio_rate"),
    [
        ((24, 1), False, 48_000),
        ((25, 1), True, 48_000),
        ((25, 1), False, 44_100),
        ((25, 1), False, None),
    ],
)
def test_proxy_time_map_rejects_nonconforming_proxy_media(
    frame_rate: tuple[int, int], variable: bool, audio_rate: int | None
) -> None:
    source = _probe(HASH_A, (0, 42), frame_rate=(24, 1), variable=True, audio_rate=44_100)
    proxy = _probe(
        HASH_B,
        (0, 40),
        frame_rate=frame_rate,
        variable=variable,
        audio_rate=audio_rate,
    )

    with pytest.raises(MediaProxyError):
        build_proxy_time_map(source, proxy, _timebase())


def test_generate_proxy_rejects_a_non_webm_destination(tmp_path: Path) -> None:
    toolchain = MediaToolchain(
        profile_id="test",
        version="8.1.2",
        ffmpeg_path=tmp_path / "ffmpeg",
        ffprobe_path=tmp_path / "ffprobe",
        ffmpeg_sha256="a" * 64,
        ffprobe_sha256="b" * 64,
        configuration_flags=("--enable-gpl",),
        license_class="GPL",
        spdx_license="GPL-3.0-or-later",
        distribution_status="DEV_GPL",
    )

    with pytest.raises(MediaProxyError, match="absolute .webm"):
        generate_cfr_proxy(
            tmp_path / "source.mkv",
            tmp_path / "proxy.mp4",
            toolchain,
            sequence_timebase=_timebase(),
        )


def test_proxy_time_map_rejects_pts_that_drift_from_the_cfr_grid() -> None:
    source = _probe(HASH_A, (0, 42), frame_rate=(24, 1), variable=True, audio_rate=44_100)
    proxy = _probe(HASH_B, (0, 41), frame_rate=(25, 1), variable=False, audio_rate=48_000)

    with pytest.raises(MediaProxyError, match="CFR grid"):
        build_proxy_time_map(source, proxy, _timebase())


def test_generate_proxy_publishes_a_validated_staged_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = (tmp_path / "source.mkv").resolve()
    source_bytes = media_proxy.MATROSKA_EBML_HEADER + b"source"
    source_path.write_bytes(source_bytes)
    source_hash = f"sha256:{hashlib.sha256(source_bytes).hexdigest()}"
    destination = (tmp_path / "proxy.webm").resolve()
    source_probe = _probe(
        source_hash, (0, 42), frame_rate=(24, 1), variable=True, audio_rate=44_100
    )
    proxy_probe = _probe(HASH_B, (0, 40), frame_rate=(25, 1), variable=False, audio_rate=48_000)

    @contextmanager
    def snapshot(_source: Path) -> Iterator[GuardedMediaSnapshot]:
        yield GuardedMediaSnapshot(source_path, source_hash, source_path.stat().st_size)

    probes = iter((source_probe, proxy_probe))

    def run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        Path(command[-1]).write_bytes(b"proxy")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(media_proxy, "guarded_media_snapshot", snapshot)
    monkeypatch.setattr(media_proxy, "probe_local_media", lambda *_args: next(probes))
    monkeypatch.setattr(media_proxy.subprocess, "run", run)

    result = generate_cfr_proxy(
        source_path,
        destination,
        _toolchain_for_proxy_test(tmp_path),
        sequence_timebase=_timebase(),
    )

    assert result.path == destination
    assert destination.read_bytes() == b"proxy"
    assert len(result.time_map.entries) == 2


def _toolchain_for_proxy_test(tmp_path: Path) -> MediaToolchain:
    return MediaToolchain(
        profile_id="test",
        version="8.1.2",
        ffmpeg_path=tmp_path / "ffmpeg",
        ffprobe_path=tmp_path / "ffprobe",
        ffmpeg_sha256="a" * 64,
        ffprobe_sha256="b" * 64,
        configuration_flags=("--enable-gpl",),
        license_class="GPL",
        spdx_license="GPL-3.0-or-later",
        distribution_status="DEV_GPL",
    )


def test_generate_proxy_rejects_snapshot_tampering_during_ffmpeg(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = (tmp_path / "source.mkv").resolve()
    source_bytes = media_proxy.MATROSKA_EBML_HEADER + b"source-a"
    source_path.write_bytes(source_bytes)
    source_hash = f"sha256:{hashlib.sha256(source_bytes).hexdigest()}"
    destination = (tmp_path / "proxy.webm").resolve()
    source_probe = _probe(
        source_hash, (0, 42), frame_rate=(24, 1), variable=True, audio_rate=44_100
    )

    @contextmanager
    def snapshot(_source: Path) -> Iterator[GuardedMediaSnapshot]:
        yield GuardedMediaSnapshot(source_path, source_hash, source_path.stat().st_size)

    def run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        Path(command[-1]).write_bytes(b"proxy")
        source_path.write_bytes(media_proxy.MATROSKA_EBML_HEADER + b"source-b")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(media_proxy, "guarded_media_snapshot", snapshot)
    monkeypatch.setattr(media_proxy, "probe_local_media", lambda *_args: source_probe)
    monkeypatch.setattr(media_proxy.subprocess, "run", run)

    with pytest.raises(MediaProxyError, match="snapshot changed during encoding"):
        generate_cfr_proxy(
            source_path,
            destination,
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )
    assert not destination.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows share modes are platform-specific")
def test_guarded_snapshot_handle_blocks_a_b_a_path_replacement(tmp_path: Path) -> None:
    source = (tmp_path / "source.mkv").resolve()
    source.write_bytes(b"source-a")

    with guarded_media_snapshot(source) as snapshot:
        replacement = snapshot.path.with_name("replacement.mkv")
        replacement.write_bytes(b"source-b")
        with pytest.raises(OSError):
            os.replace(replacement, snapshot.path)


def test_generate_proxy_rejects_playlist_content_before_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = (tmp_path / "source.m3u8").resolve()
    source_path.write_text("#EXTM3U\nfile:///private/segment.ts\n", encoding="utf-8")
    source_hash = f"sha256:{hashlib.sha256(source_path.read_bytes()).hexdigest()}"

    @contextmanager
    def snapshot(_source: Path) -> Iterator[GuardedMediaSnapshot]:
        yield GuardedMediaSnapshot(source_path, source_hash, source_path.stat().st_size)

    monkeypatch.setattr(media_proxy, "guarded_media_snapshot", snapshot)
    monkeypatch.setattr(
        media_proxy,
        "probe_local_media",
        lambda *_args: pytest.fail("playlist content reached ffprobe"),
    )

    with pytest.raises(MediaProxyError, match="Matroska/WebM"):
        generate_cfr_proxy(
            source_path,
            (tmp_path / "proxy.webm").resolve(),
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )


def test_generate_proxy_does_not_overwrite_an_existing_destination(tmp_path: Path) -> None:
    source = (tmp_path / "source.mkv").resolve()
    source.write_bytes(media_proxy.MATROSKA_EBML_HEADER)
    destination = (tmp_path / "proxy.webm").resolve()
    destination.write_bytes(b"keep-me")

    with pytest.raises(MediaProxyError, match="already exists"):
        generate_cfr_proxy(
            source,
            destination,
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )
    assert destination.read_bytes() == b"keep-me"


@pytest.mark.parametrize("name", ("carrier.mkv:proxy.webm", "CON.webm", "proxy.webm."))
def test_generate_proxy_rejects_unsafe_windows_destination_names(tmp_path: Path, name: str) -> None:
    with pytest.raises(MediaProxyError, match="absolute .webm"):
        generate_cfr_proxy(
            (tmp_path / "source.mkv").resolve(),
            tmp_path / name,
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )


@pytest.mark.parametrize("name", ("carrier.mkv:input.mkv", "NUL.mkv", "source.mkv."))
def test_generate_proxy_rejects_unsafe_windows_source_names(tmp_path: Path, name: str) -> None:
    with pytest.raises(MediaProxyError, match="unsafe filename"):
        generate_cfr_proxy(
            tmp_path / name,
            (tmp_path / "proxy.webm").resolve(),
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )


@pytest.mark.parametrize(
    ("source", "destination"),
    (
        (Path(r"\\server\share\source.mkv"), None),
        (None, Path(r"\\server\share\proxy.webm")),
    ),
)
def test_generate_proxy_rejects_unc_before_resolving_the_filesystem(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    source: Path | None,
    destination: Path | None,
) -> None:
    monkeypatch.setattr(
        Path,
        "resolve",
        lambda *_args, **_kwargs: pytest.fail("UNC path reached filesystem resolution"),
    )
    with pytest.raises(MediaProxyError):
        generate_cfr_proxy(
            source or Path(r"C:\local\source.mkv"),
            destination or (tmp_path / "proxy.webm"),
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )


def test_generate_proxy_atomically_refuses_a_racing_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = (tmp_path / "source.mkv").resolve()
    source_bytes = media_proxy.MATROSKA_EBML_HEADER + b"source"
    source_path.write_bytes(source_bytes)
    source_hash = f"sha256:{hashlib.sha256(source_bytes).hexdigest()}"
    destination = (tmp_path / "proxy.webm").resolve()
    source_probe = _probe(
        source_hash, (0, 42), frame_rate=(24, 1), variable=True, audio_rate=44_100
    )
    proxy_probe = _probe(HASH_B, (0, 40), frame_rate=(25, 1), variable=False, audio_rate=48_000)

    @contextmanager
    def snapshot(_source: Path) -> Iterator[GuardedMediaSnapshot]:
        yield GuardedMediaSnapshot(source_path, source_hash, source_path.stat().st_size)

    probes = iter((source_probe, proxy_probe))

    def run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        Path(command[-1]).write_bytes(b"proxy")
        destination.write_bytes(b"racing-owner")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(media_proxy, "guarded_media_snapshot", snapshot)
    monkeypatch.setattr(media_proxy, "probe_local_media", lambda *_args: next(probes))
    monkeypatch.setattr(media_proxy.subprocess, "run", run)

    with pytest.raises(MediaProxyError, match="generation failed"):
        generate_cfr_proxy(
            source_path,
            destination,
            _toolchain_for_proxy_test(tmp_path),
            sequence_timebase=_timebase(),
        )
    assert destination.read_bytes() == b"racing-owner"
