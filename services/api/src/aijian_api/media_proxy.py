"""Deterministic CFR proxy generation and source-PTS mapping."""

from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from aijian_api.media_contracts import (
    MediaTimestampData,
    ProxyFrameMapEntryData,
    ProxyTimeMapV1,
    SequenceFrameRateData,
    SequenceTimebaseData,
)
from aijian_api.media_probe import (
    MAX_MEDIA_INPUT_BYTES,
    LocalMediaProbeData,
    MediaProbeError,
    _copy_guarded_snapshot,
    _is_remote_windows_path,
    _local_snapshot_root,
    _open_local_source,
    probe_local_media,
)
from aijian_api.media_toolchain import MediaToolchain

PROXY_TIMEOUT_SECONDS = 120
MAX_PROXY_OUTPUT_BYTES = 256 * 1024 * 1024
MATROSKA_EBML_HEADER = b"\x1a\x45\xdf\xa3"
WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{index}" for index in range(1, 10)}
    | {f"LPT{index}" for index in range(1, 10)}
)


class MediaProxyError(RuntimeError):
    pass


@dataclass(frozen=True)
class GuardedMediaSnapshot:
    path: Path
    source_asset_sha256: str
    byte_size: int


@dataclass(frozen=True)
class GeneratedMediaProxy:
    path: Path
    probe: LocalMediaProbeData
    time_map: ProxyTimeMapV1


def _sha256(path: Path, maximum_bytes: int) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > maximum_bytes:
                raise MediaProxyError("proxy output exceeds the size limit")
            digest.update(chunk)
    return digest.hexdigest()


@contextmanager
def guarded_media_snapshot(source: Path) -> Iterator[GuardedMediaSnapshot]:
    """Yield an immutable local copy while holding a stable source handle."""

    if not source.is_absolute() or _is_remote_windows_path(source):
        raise MediaProxyError("proxy source must be an absolute local path")
    source_name = source.name
    source_stem = source_name.split(".", 1)[0].upper()
    if (
        ":" in source_name
        or source_name.rstrip(" .") != source_name
        or source_stem in WINDOWS_RESERVED_NAMES
    ):
        raise MediaProxyError("proxy source has an unsafe filename")
    try:
        resolved = source.resolve(strict=True)
        if _is_remote_windows_path(resolved) or not resolved.is_file():
            raise MediaProxyError("proxy source must resolve to a local regular file")
        resolved_identity = resolved.stat()
        snapshot_root = _local_snapshot_root()
        with _open_local_source(resolved) as source_stream:
            before = os.fstat(source_stream.fileno())
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_dev != resolved_identity.st_dev
                or before.st_ino != resolved_identity.st_ino
                or before.st_size != resolved_identity.st_size
                or before.st_mtime_ns != resolved_identity.st_mtime_ns
            ):
                raise MediaProxyError("proxy source changed before snapshot")
            if before.st_size > MAX_MEDIA_INPUT_BYTES:
                raise MediaProxyError("proxy source exceeds the size limit")
            with tempfile.TemporaryDirectory(
                prefix="aijian-media-proxy-source-", dir=snapshot_root
            ) as temporary:
                snapshot_path = Path(temporary) / f"input{resolved.suffix}"
                source_hash, snapshot_size = _copy_guarded_snapshot(source_stream, snapshot_path)
                os.chmod(snapshot_path, stat.S_IREAD)
                after = os.fstat(source_stream.fileno())
                if (
                    snapshot_size != before.st_size
                    or before.st_dev != after.st_dev
                    or before.st_ino != after.st_ino
                    or before.st_size != after.st_size
                    or before.st_mtime_ns != after.st_mtime_ns
                ):
                    raise MediaProxyError("proxy source changed during snapshot")
                with _open_local_source(snapshot_path) as snapshot_stream:
                    snapshot_before = os.fstat(snapshot_stream.fileno())
                    yield GuardedMediaSnapshot(
                        path=snapshot_path,
                        source_asset_sha256=f"sha256:{source_hash}",
                        byte_size=snapshot_size,
                    )
                    snapshot_after = os.fstat(snapshot_stream.fileno())
                    if (
                        snapshot_before.st_dev != snapshot_after.st_dev
                        or snapshot_before.st_ino != snapshot_after.st_ino
                        or snapshot_before.st_size != snapshot_after.st_size
                        or snapshot_before.st_mtime_ns != snapshot_after.st_mtime_ns
                    ):
                        raise MediaProxyError("guarded proxy snapshot changed")
    except MediaProxyError:
        raise
    except (OSError, RuntimeError):
        raise MediaProxyError("guarded proxy source snapshot failed") from None


def build_proxy_time_map(
    source: LocalMediaProbeData,
    proxy: LocalMediaProbeData,
    sequence_timebase: SequenceTimebaseData,
) -> ProxyTimeMapV1:
    """Map every CFR proxy frame start to the latest presented source frame."""

    source_frames = source.video.frames
    proxy_frames = proxy.video.frames
    if not source_frames or not proxy_frames:
        raise MediaProxyError("source and proxy must both contain video frames")
    rate = sequence_timebase.frame_rate
    if (
        proxy.video.is_variable_frame_rate
        or proxy.video.average_frame_rate.num != rate.num
        or proxy.video.average_frame_rate.den != rate.den
    ):
        raise MediaProxyError("proxy does not match the selected CFR timebase")
    if (source.audio is None) != (proxy.audio is None):
        raise MediaProxyError("proxy must preserve the source audio stream presence")
    if proxy.audio is not None and proxy.audio.sample_rate_hz != 48_000:
        raise MediaProxyError("proxy audio must use the 48 kHz working rate")

    source_index = 0
    entries: list[ProxyFrameMapEntryData] = []
    first_source_pts = source_frames[0].pts
    source_origin = Fraction(
        first_source_pts.ticks * first_source_pts.time_base.num,
        first_source_pts.time_base.den,
    )
    for proxy_index in range(len(proxy_frames)):
        proxy_start = Fraction(proxy_index * rate.den, rate.num)
        proxy_pts = proxy_frames[proxy_index].pts
        actual_proxy_start = Fraction(
            proxy_pts.ticks * proxy_pts.time_base.num, proxy_pts.time_base.den
        )
        if actual_proxy_start != proxy_start:
            raise MediaProxyError("proxy PTS does not exactly cover the selected CFR grid")
        while source_index + 1 < len(source_frames):
            next_pts = source_frames[source_index + 1].pts
            next_time = Fraction(next_pts.ticks * next_pts.time_base.num, next_pts.time_base.den)
            if next_time - source_origin > proxy_start:
                break
            source_index += 1
        selected = source_frames[source_index].pts
        entries.append(
            ProxyFrameMapEntryData(
                proxy_frame_index=proxy_index,
                source_frame_index=source_index,
                source_pts=MediaTimestampData(
                    ticks=selected.ticks,
                    time_base=selected.time_base,
                ),
            )
        )
    return ProxyTimeMapV1(
        source_asset_sha256=source.source_asset_sha256,
        proxy_asset_sha256=proxy.source_asset_sha256,
        source_video_stream_index=source.video.stream_index,
        sequence_timebase=sequence_timebase,
        entries=tuple(entries),
    )


def _require_phase0_independent_container(path: Path) -> str:
    try:
        with path.open("rb") as stream:
            signature = stream.read(len(MATROSKA_EBML_HEADER))
    except OSError:
        raise MediaProxyError("proxy source container could not be inspected") from None
    if signature != MATROSKA_EBML_HEADER:
        raise MediaProxyError("Phase 0 proxy sources must be Matroska/WebM files")
    return "matroska"


def _proxy_arguments(
    source: Path,
    destination: Path,
    rate: SequenceFrameRateData,
    *,
    has_audio: bool,
    input_format: str,
) -> list[str]:
    rate_text = f"{rate.num}/{rate.den}"
    arguments = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-protocol_whitelist",
        "file",
        "-f",
        input_format,
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-vf",
        f"setpts=PTS-STARTPTS,fps=fps={rate_text}:start_time=0:round=up:eof_action=pass",
        "-c:v",
        "libvpx-vp9",
        "-lossless",
        "1",
        "-deadline",
        "good",
        "-cpu-used",
        "0",
        "-row-mt",
        "0",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
    ]
    if has_audio:
        arguments.extend(
            (
                "-map",
                "0:a:0",
                "-af",
                "asetpts=PTS-STARTPTS,aresample=48000:first_pts=0",
                "-c:a",
                "libopus",
                "-ar",
                "48000",
            )
        )
    arguments.extend(
        (
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            "-map_metadata",
            "-1",
            "-fs",
            str(MAX_PROXY_OUTPUT_BYTES),
            str(destination),
        )
    )
    return arguments


def generate_cfr_proxy(
    source: Path,
    destination: Path,
    toolchain: MediaToolchain,
    *,
    sequence_timebase: SequenceTimebaseData,
) -> GeneratedMediaProxy:
    """Generate one validated WebM proxy and atomically publish it."""

    destination_name = destination.name
    destination_stem = destination_name.split(".", 1)[0].upper()
    if (
        destination.suffix.lower() != ".webm"
        or not destination.is_absolute()
        or _is_remote_windows_path(destination)
        or ":" in destination_name
        or destination_name.rstrip(" .") != destination_name
        or destination_stem in WINDOWS_RESERVED_NAMES
    ):
        raise MediaProxyError("proxy destination must be an absolute .webm path")
    if not source.is_absolute() or _is_remote_windows_path(source):
        raise MediaProxyError("proxy source must be an absolute local path")
    source_name = source.name
    source_stem = source_name.split(".", 1)[0].upper()
    if (
        ":" in source_name
        or source_name.rstrip(" .") != source_name
        or source_stem in WINDOWS_RESERVED_NAMES
    ):
        raise MediaProxyError("proxy source has an unsafe filename")
    try:
        raw_parent = destination.parent
        if _is_remote_windows_path(raw_parent):
            raise MediaProxyError("proxy destination must be in a local directory")
        parent = raw_parent.resolve(strict=True)
        if _is_remote_windows_path(parent) or not parent.is_dir():
            raise MediaProxyError("proxy destination must be in a local directory")
        resolved_destination = parent / destination.name
        resolved_source = source.resolve(strict=True)
        if resolved_destination == resolved_source:
            raise MediaProxyError("proxy destination cannot replace its source")
        if resolved_destination.exists():
            raise MediaProxyError("proxy destination already exists")
        with guarded_media_snapshot(source) as snapshot:
            input_format = _require_phase0_independent_container(snapshot.path)
            source_probe = probe_local_media(snapshot.path.resolve(strict=True), toolchain)
            if source_probe.source_asset_sha256 != snapshot.source_asset_sha256:
                raise MediaProxyError("source probe does not match the guarded snapshot")
            with tempfile.TemporaryDirectory(
                prefix="aijian-proxy-output-", dir=parent
            ) as temporary:
                staged = Path(temporary) / "proxy.webm"
                subprocess.run(
                    [
                        str(toolchain.ffmpeg_path),
                        *_proxy_arguments(
                            snapshot.path,
                            staged,
                            sequence_timebase.frame_rate,
                            has_audio=source_probe.audio is not None,
                            input_format=input_format,
                        ),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                    timeout=PROXY_TIMEOUT_SECONDS,
                )
                if (
                    f"sha256:{_sha256(snapshot.path, MAX_MEDIA_INPUT_BYTES)}"
                    != snapshot.source_asset_sha256
                ):
                    raise MediaProxyError("guarded proxy snapshot changed during encoding")
                _sha256(staged, MAX_PROXY_OUTPUT_BYTES)
                proxy_probe = probe_local_media(staged.resolve(strict=True), toolchain)
                if proxy_probe.format_names != ("matroska", "webm"):
                    raise MediaProxyError("proxy container is not WebM")
                time_map = build_proxy_time_map(source_probe, proxy_probe, sequence_timebase)
                os.link(staged, resolved_destination)
                return GeneratedMediaProxy(
                    path=resolved_destination,
                    probe=proxy_probe,
                    time_map=time_map,
                )
    except MediaProxyError:
        raise
    except (MediaProbeError, OSError, subprocess.SubprocessError):
        raise MediaProxyError("CFR proxy generation failed") from None
