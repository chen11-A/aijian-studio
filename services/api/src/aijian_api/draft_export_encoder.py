"""Real, bounded local DRAFT assembly encoding; never a formal release gate.

Only sealed source bytes are consumed. No shell, input playlists, remote protocols,
implicit track selection or synthetic replacement media are allowed. The caller
owns development-toolchain admission and atomic publication of the verified file.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, datetime
from fractions import Fraction
from pathlib import Path
from typing import Any, BinaryIO

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.draft_subtitles import (
    DraftSubtitleError,
    PreparedSubtitles,
    prepare_subtitles,
    validate_draft_subtitles,
)
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyVersionData
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_contracts import sequence_frame_to_audio_sample
from aijian_api.media_probe import _open_local_source, _rounded_fraction
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_output_verify import (
    ProductExportOutputError,
    VerifiedProductOutput,
    _guarded_file_hash,
)
from aijian_api.product_export_windows_job import (
    ProductExportJobError,
    ProductExportJobManager,
    ProductExportJobProcess,
)

MAX_RUNTIME_SECONDS = 3600.0
MAX_PROCESS_SECONDS = 1800.0
MAX_SOURCE_BYTES = 20 * 1024**3
MAX_OUTPUT_BYTES = 2 * 1024**3
MAX_PROBE_BYTES = 64 * 1024**2
MAX_SOURCE_FRAMES = 1_000_000
MAX_SOURCE_SECONDS = 6 * 3600
DRAFT_TITLE = "AIVORA DRAFT"
DRAFT_COMMENT = "AIVORA DRAFT - No release approval."


class DraftEncodeError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class _Source:
    path: Path
    sha256: str
    demuxer: str
    kind: str
    size: int
    identity: tuple[int, int, int, int]


@dataclass(frozen=True)
class _Audio:
    sample_rate: int
    samples: int
    first_time: Fraction
    codec: str
    channels: int


@dataclass(frozen=True)
class _Media:
    frames: int
    first_time: Fraction
    rate: Fraction | None
    width: int
    height: int
    codec: str
    pixel_format: str
    audio: _Audio | None
    duration: Fraction | None
    title: str | None = None
    comment: str | None = None


def _identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def _demuxer(header: bytes, kind: str) -> str:
    # Magic, never the extension of content-addressed snapshots, selects a single
    # closed demuxer. In particular HLS, DASH, concat and image sequences fail.
    if kind == "image":
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return "png_pipe"
        if header.startswith(b"\xff\xd8\xff"):
            return "jpeg_pipe"
        if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
            return "webp_pipe"
    if kind in {"video", "audio"}:
        if header[4:8] == b"ftyp":
            return "mov"
        if header.startswith(b"\x1a\x45\xdf\xa3"):
            return "matroska"
        if kind == "video" and header[:4] == b"RIFF" and header[8:12] == b"AVI ":
            return "avi"
        if kind == "audio":
            if header[:4] == b"RIFF" and header[8:12] == b"WAVE":
                return "wav"
            if header.startswith(b"fLaC"):
                return "flac"
            if header.startswith(b"OggS"):
                return "ogg"
            if header.startswith(b"ID3") or (
                len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE6 == 0xE2
            ):
                return "mp3"
            if len(header) >= 2 and header[0] == 0xFF and header[1] & 0xF6 == 0xF0:
                return "aac"
    raise DraftEncodeError(
        "SOURCE_FORMAT_UNSUPPORTED",
        f"DRAFT {kind} source has an unsupported container",
    )


def _require_static_image(stream: BinaryIO, demuxer: str, size: int, runner: _Runner) -> None:
    # PNG's ordinary decoder can expose only an APNG's first image. Likewise a
    # WebP still demuxer must not silently discard animation extension chunks.
    if demuxer not in {"png_pipe", "webp_pipe"}:
        return
    position = 8 if demuxer == "png_pipe" else 12
    if demuxer == "webp_pipe":
        stream.seek(4)
        if int.from_bytes(stream.read(4), "little") + 8 != size:
            raise DraftEncodeError("SOURCE_FORMAT_UNSUPPORTED", "WebP container size is invalid")
    while position < size:
        runner.check()
        stream.seek(position)
        header = stream.read(8)
        if len(header) != 8:
            raise DraftEncodeError("SOURCE_FORMAT_UNSUPPORTED", "Image chunk header is truncated")
        if demuxer == "png_pipe":
            length, kind = int.from_bytes(header[:4], "big"), header[4:]
            end = position + 12 + length
            animated = kind in {b"acTL", b"fcTL", b"fdAT"}
        else:
            kind, length = header[:4], int.from_bytes(header[4:], "little")
            end = position + 8 + length + (length & 1)
            animated = kind in {b"ANIM", b"ANMF"}
            if kind == b"VP8X" and length:
                flags = stream.read(1)
                animated = animated or bool(flags and flags[0] & 2)
        if animated:
            raise DraftEncodeError("ANIMATED_IMAGE_UNSUPPORTED", "DRAFT images must be static")
        if end > size:
            raise DraftEncodeError("SOURCE_FORMAT_UNSUPPORTED", "Image chunk exceeds source bytes")
        position = end
    stream.seek(0)


def _input_arguments(source: _Source) -> list[str]:
    args = [
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        source.demuxer,
        "-f",
        source.demuxer,
        "-probesize",
        "67108864",
        "-analyzeduration",
        "10000000",
    ]
    if source.demuxer == "mov":
        args.extend(("-enable_drefs", "0", "-use_absolute_path", "0"))
    return args


class _Runner:
    def __init__(
        self,
        toolchain: MediaToolchain,
        manager: ProductExportJobManager | None,
        stop_requested: Callable[[], bool],
    ) -> None:
        if os.name == "nt" and manager is None:
            raise DraftEncodeError(
                "JOB_MANAGER_REQUIRED", "Windows DRAFT export needs its job manager"
            )
        if os.name not in {"nt", "posix"}:
            raise DraftEncodeError(
                "PLATFORM_UNSUPPORTED", "DRAFT process containment is unavailable"
            )
        self.toolchain = toolchain
        self.manager = manager
        self.stop_requested = stop_requested
        self.deadline = time.monotonic() + MAX_RUNTIME_SECONDS
        self.external_directory: Path | None = None
        self.external_environment: dict[str, str] | None = None

    def check(self) -> None:
        if self.stop_requested():
            raise DraftEncodeError("CANCELLED", "DRAFT export was cancelled")
        if time.monotonic() >= self.deadline:
            raise DraftEncodeError("TIMEOUT", "DRAFT export exceeded its runtime limit")

    def hash_stream(self, stream: BinaryIO) -> str:
        stream.seek(0)
        digest = hashlib.sha256()
        total = 0
        while chunk := stream.read(1024 * 1024):
            self.check()
            total += len(chunk)
            if total > MAX_SOURCE_BYTES:
                raise DraftEncodeError("SOURCE_SIZE", "DRAFT source exceeds its byte limit")
            digest.update(chunk)
        stream.seek(0)
        return digest.hexdigest()

    def run(
        self,
        arguments: list[str],
        *,
        probe: bool = False,
        limit: int = MAX_PROBE_BYTES,
        on_progress: Callable[[int], None] | None = None,
        total_frames: int = 0,
        output: Path | None = None,
        work_directory: Path | None = None,
    ) -> bytes:
        if not self.toolchain.external_selected:
            return self._run(
                arguments, probe=probe, limit=limit, on_progress=on_progress,
                total_frames=total_frames, output=output, work_directory=work_directory,
            )
        from aijian_api.external_media_process import (
            external_process_session,
            guarded_external_pair,
        )

        try:
            with ExitStack() as scope:
                scope.enter_context(guarded_external_pair(self.toolchain.ffmpeg_path.parent))
                directory, environment = (
                    (self.external_directory, self.external_environment)
                    if self.external_directory is not None and self.external_environment is not None
                    else scope.enter_context(external_process_session())
                )
                selected_directory = work_directory or directory
                if not selected_directory.is_relative_to(directory):
                    raise OSError("External media process directory must stay private")
                return self._run(
                    arguments, probe=probe, limit=limit, on_progress=on_progress,
                    total_frames=total_frames, output=output, work_directory=selected_directory,
                    external_environment=dict(environment),
                )
        except OSError:
            raise DraftEncodeError(
                "TOOLCHAIN_UNAVAILABLE",
                "External media tools changed or safe execution is unavailable",
            ) from None

    def _run(
        self,
        arguments: list[str],
        *,
        probe: bool = False,
        limit: int = MAX_PROBE_BYTES,
        on_progress: Callable[[int], None] | None = None,
        total_frames: int = 0,
        output: Path | None = None,
        work_directory: Path | None = None,
        external_environment: dict[str, str] | None = None,
    ) -> bytes:
        self.check()
        executable = self.toolchain.ffprobe_path if probe else self.toolchain.ffmpeg_path
        expected = self.toolchain.ffprobe_sha256 if probe else self.toolchain.ffmpeg_sha256
        try:
            with _open_local_source(executable) as binary:
                if self.hash_stream(binary) != expected:
                    raise DraftEncodeError("TOOLCHAIN_CHANGED", "Pinned media tool bytes changed")
        except OSError:
            raise DraftEncodeError(
                "TOOLCHAIN_UNAVAILABLE", "Pinned media tool is unavailable"
            ) from None
        environment = {
            key: os.environ[key]
            for key in (
                "COMSPEC",
                "PATH",
                "PATHEXT",
                "SYSTEMDRIVE",
                "SYSTEMROOT",
                "TEMP",
                "TMP",
                "WINDIR",
            )
            if key in os.environ
        }
        if external_environment is not None:
            environment = external_environment
        process: ProductExportJobProcess | subprocess.Popen[bytes]
        try:
            if os.name == "nt":
                assert self.manager is not None
                process = self.manager.spawn(
                    executable,
                    arguments,
                    cwd=work_directory or executable.parent,
                    env=environment,
                    **(
                        {"hardened_external_media": True}
                        if self.toolchain.external_selected else {}
                    ),
                )
            else:
                process = subprocess.Popen(
                    [str(executable), *arguments],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    shell=False,
                    start_new_session=True,
                    cwd=work_directory or executable.parent,
                    env=environment,
                )
        except (OSError, ProductExportJobError):
            raise DraftEncodeError(
                "PROCESS_LAUNCH_FAILED", "DRAFT media process could not start"
            ) from None
        captured = bytearray()
        errors = bytearray()
        overflow = threading.Event()
        read_error = threading.Event()
        progress: queue.Queue[int] = queue.Queue(maxsize=32)

        def stdout_reader() -> None:
            assert process.stdout is not None
            try:
                if on_progress is not None:
                    while line := process.stdout.readline(512):
                        if line.startswith(b"frame="):
                            try:
                                value = int(line[6:].strip())
                                if 0 <= value <= total_frames:
                                    progress.put_nowait(value)
                            except (ValueError, queue.Full):
                                pass
                else:
                    while chunk := process.stdout.read(64 * 1024):
                        remaining = limit - len(captured)
                        captured.extend(chunk[: max(0, remaining)])
                        if len(chunk) > remaining:
                            overflow.set()
                            return
            except (OSError, ValueError):
                read_error.set()

        def stderr_reader() -> None:
            assert process.stderr is not None
            try:
                while chunk := process.stderr.read(4096):
                    errors.extend(chunk[: max(0, 65536 - len(errors))])
            except (OSError, ValueError):
                read_error.set()

        readers = [
            threading.Thread(target=reader, daemon=True)
            for reader in (stdout_reader, stderr_reader)
        ]

        def terminate() -> None:
            if sys.platform == "win32":
                process.terminate()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=5.0)

        started_readers: list[threading.Thread] = []
        try:
            for reader in readers:
                reader.start()
                started_readers.append(reader)
            deadline = min(self.deadline, time.monotonic() + MAX_PROCESS_SECONDS)
            latest = 0
            while process.poll() is None:
                self.check()
                if time.monotonic() >= deadline:
                    raise DraftEncodeError(
                        "TIMEOUT", "DRAFT media process exceeded its runtime limit"
                    )
                if overflow.is_set():
                    raise DraftEncodeError(
                        "PROBE_OUTPUT_LIMIT", "DRAFT probe exceeded its output limit"
                    )
                if read_error.is_set():
                    raise DraftEncodeError(
                        "PIPE_FAILED", "DRAFT media process output is unavailable"
                    )
                if (
                    output is not None
                    and output.exists()
                    and output.stat().st_size > MAX_OUTPUT_BYTES
                ):
                    raise DraftEncodeError("OUTPUT_SIZE", "DRAFT MP4 exceeds its byte limit")
                try:
                    frame = progress.get(timeout=0.05)
                    if on_progress is not None and frame > latest:
                        latest = frame
                        on_progress(frame)
                except queue.Empty:
                    pass
            for reader in readers:
                reader.join(timeout=2.0)
            self.check()
            if any(reader.is_alive() for reader in readers) or read_error.is_set():
                raise DraftEncodeError("PIPE_FAILED", "DRAFT media process output did not close")
            if overflow.is_set():
                raise DraftEncodeError(
                    "PROBE_OUTPUT_LIMIT", "DRAFT probe exceeded its output limit"
                )
            # -v error + -xerror: do not accept a successful exit accompanied by
            # decode diagnostics, which ffprobe can otherwise emit with code 0.
            if process.returncode != 0 or errors:
                raise DraftEncodeError(
                    "PROBE_FAILED" if probe else "ENCODER_FAILED",
                    "DRAFT source probe failed"
                    if probe
                    else "DRAFT encoding or decode verification failed",
                )
            if on_progress is not None:
                while not progress.empty():
                    latest = max(latest, progress.get_nowait())
                on_progress(latest)
            return bytes(captured)
        finally:
            # Always close the process group, including children left after the
            # leader exits. Windows release closes its kill-on-close Job Object.
            try:
                terminate()
            finally:
                for reader in started_readers:
                    reader.join(timeout=2.0)
                if isinstance(process, ProductExportJobProcess):
                    assert self.manager is not None
                    self.manager.release(process)
                else:
                    if process.stdout is not None:
                        process.stdout.close()
                    if process.stderr is not None:
                        process.stderr.close()


def _positive_fraction(raw: Any) -> Fraction:
    if not isinstance(raw, str) or len(raw) > 40:
        raise ValueError("invalid rational")
    value = Fraction(raw)
    if value <= 0:
        raise ValueError("nonpositive rational")
    return value


def _scan_frames(
    source: _Source,
    runner: _Runner,
    selector: str,
) -> list[dict[str, int]]:
    arguments = [
        "-v",
        "error",
        "-max_alloc",
        "268435456",
        "-threads",
        "1",
        *_input_arguments(source),
        "-select_streams",
        selector,
        "-show_frames",
        "-show_entries",
        "frame=pts,duration,nb_samples:frame_side_data=",
        "-of",
        "compact=p=0:nk=0",
        str(source.path),
    ]
    payload = runner.run(arguments, probe=True)
    result: list[dict[str, int]] = []
    try:
        for line in payload.splitlines():
            if not line:
                continue
            values: dict[str, int] = {}
            for pair in line.split(b"|"):
                if not pair:
                    continue
                key, value = pair.split(b"=", 1)
                name = key.decode("ascii")
                if name not in {"pts", "duration", "nb_samples"} or name in values:
                    raise ValueError("unexpected frame field")
                values[name] = int(value)
            if not values:
                continue
            result.append(values)
            if len(result) > MAX_SOURCE_FRAMES:
                raise ValueError("too many source frames")
        if not result:
            raise ValueError("no decoded frames")
    except (ValueError, UnicodeError):
        raise DraftEncodeError(
            "SOURCE_TIMING_INVALID", "Source frame timing cannot be verified"
        ) from None
    return result


def _probe(source: _Source, runner: _Runner) -> _Media:
    payload = runner.run(
        [
            "-v",
            "error",
            "-max_alloc",
            "268435456",
            "-threads",
            "1",
            *_input_arguments(source),
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(source.path),
        ],
        probe=True,
        limit=1024 * 1024,
    )
    try:
        summary = json.loads(payload)
        streams = summary["streams"]
        if not isinstance(streams, list) or len(streams) > 2:
            raise ValueError("stream layout")
        video = [s for s in streams if s["codec_type"] == "video"]
        audio = [s for s in streams if s["codec_type"] == "audio"]
        if (
            len(video) != (0 if source.kind == "audio" else 1)
            or len(audio) > 1
            or len(video) + len(audio) != len(streams)
            or (source.kind == "audio" and len(audio) != 1)
            or (source.kind == "image" and audio)
        ):
            raise ValueError("unsupported streams")
        duration_raw = summary.get("format", {}).get("duration")
        duration = _positive_fraction(duration_raw) if duration_raw is not None else None
        if duration is not None and duration > MAX_SOURCE_SECONDS:
            raise ValueError("source duration")
        width = height = frame_count = 0
        first_time = Fraction(0)
        rate = None
        codec = pixel_format = ""
        if video:
            stream = video[0]
            width, height = int(stream["width"]), int(stream["height"])
            if not (0 < width <= 8192 and 0 < height <= 8192):
                raise ValueError("source dimensions")
            if any(item.get("rotation", 0) != 0 for item in stream.get("side_data_list", [])):
                raise DraftEncodeError(
                    "VIDEO_ROTATION_UNSUPPORTED",
                    "DRAFT video rotation metadata is not supported",
                )
            codec, pixel_format = stream["codec_name"], stream["pix_fmt"]
            frames = _scan_frames(source, runner, "v:0")
            frame_count = len(frames)
            if source.kind == "image":
                if frame_count != 1:
                    raise DraftEncodeError(
                        "ANIMATED_IMAGE_UNSUPPORTED", "DRAFT images must be static"
                    )
            else:
                rate = _positive_fraction(stream["avg_frame_rate"])
                time_base = _positive_fraction(stream["time_base"])
                ticks = 1 / rate / time_base
                first = frames[0]["pts"]
                first_time = first * time_base
                floor = ticks.numerator // ticks.denominator
                ceil = -(-ticks.numerator // ticks.denominator)
                for index, frame in enumerate(frames):
                    if (
                        frame["pts"] != first + _rounded_fraction(index * ticks)
                        or not floor <= frame["duration"] <= ceil
                    ):
                        raise DraftEncodeError(
                            "VIDEO_VFR_UNSUPPORTED", "DRAFT source video must be CFR"
                        )
        audio_data = None
        if audio:
            stream = audio[0]
            sample_rate, channels = int(stream["sample_rate"]), int(stream["channels"])
            if not 8000 <= sample_rate <= 192000 or channels not in {1, 2}:
                raise DraftEncodeError(
                    "AUDIO_LAYOUT_UNSUPPORTED",
                    "DRAFT audio needs mono/stereo at 8–192 kHz",
                )
            time_base = _positive_fraction(stream["time_base"])
            frames = _scan_frames(source, runner, "a:0")
            first = frames[0]["pts"]
            samples = 0
            for frame in frames:
                # A native decoded-sample trim is valid only for continuous audio.
                if abs(Fraction(frame["pts"] - first) - samples / (sample_rate * time_base)) > 1:
                    raise DraftEncodeError(
                        "AUDIO_TIMING_UNSUPPORTED",
                        "DRAFT source audio has timestamp gaps",
                    )
                count = frame["nb_samples"]
                if not 0 < count <= 192000:
                    raise ValueError("invalid sample count")
                samples += count
            if samples > sample_rate * MAX_SOURCE_SECONDS:
                raise ValueError("source audio duration")
            audio_data = _Audio(
                sample_rate, samples, first * time_base, stream["codec_name"], channels
            )
        tags = summary.get("format", {}).get("tags", {})
        return _Media(
            frame_count,
            first_time,
            rate,
            width,
            height,
            codec,
            pixel_format,
            audio_data,
            duration,
            tags.get("title"),
            tags.get("comment"),
        )
    except DraftEncodeError:
        raise
    except (KeyError, TypeError, ValueError, ZeroDivisionError, json.JSONDecodeError):
        raise DraftEncodeError(
            "SOURCE_PROBE_INVALID", "Source metadata is outside the DRAFT contract"
        ) from None


def _seal_source(
    path: Path,
    digest: str,
    kind: str,
    runner: _Runner,
    stack: ExitStack,
) -> tuple[_Source, BinaryIO]:
    try:
        io_path = managed_local_io_path(path.parent, path)
        stream = stack.enter_context(_open_local_source(io_path))
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_SOURCE_BYTES:
            raise DraftEncodeError("SOURCE_SIZE", "DRAFT source has an invalid byte size")
        if runner.hash_stream(stream) != digest:
            raise DraftEncodeError("SOURCE_CHANGED", "DRAFT source differs from the saved assembly")
        header = stream.read(64)
        stream.seek(0)
        source = _Source(
            path, digest, _demuxer(header, kind), kind, before.st_size, _identity(before)
        )
        if kind == "image":
            _require_static_image(stream, source.demuxer, before.st_size, runner)
        _check_source(source, stream, runner)
        return source, stream
    except DraftEncodeError:
        raise
    except (OSError, ValueError, RuntimeError):
        raise DraftEncodeError(
            "SOURCE_PATH_UNSAFE", "DRAFT source snapshot is missing or unsafe"
        ) from None


def _check_source(source: _Source, stream: BinaryIO, runner: _Runner) -> None:
    try:
        io_path = managed_local_io_path(source.path.parent, source.path)
        if (
            _identity(io_path.stat()) != source.identity
            or _identity(os.fstat(stream.fileno())) != source.identity
            or runner.hash_stream(stream) != source.sha256
        ):
            raise DraftEncodeError("SOURCE_CHANGED", "DRAFT source changed during export")
    except (OSError, ValueError):
        raise DraftEncodeError("SOURCE_CHANGED", "DRAFT source changed during export") from None


def encode_draft(
    assembly: EpisodeMediaAssemblyVersionData,
    sources: dict[str, Path],
    temporary_output: Path,
    toolchain: MediaToolchain,
    *,
    on_progress: Callable[[int], None],
    stop_requested: Callable[[], bool],
    job_manager: ProductExportJobManager | None = None,
) -> VerifiedProductOutput:
    """Encode exact saved edit decisions and return only verified temporary bytes.

    Visuals fit inside the saved canvas with black letterboxing. BGM/SFX and
    explicitly enabled embedded audio mix at unity gain with a peak limiter.
    Audio boundaries use the assembly's absolute-frame nearest-ties-up policy.
    """
    content = assembly.content
    if canonical_content_hash(content.model_dump(mode="json")) != assembly.content_hash:
        raise DraftEncodeError("ASSEMBLY_HASH_MISMATCH", "Saved DRAFT assembly hash does not match")
    try:
        validate_draft_subtitles(content)
    except DraftSubtitleError as error:
        raise DraftEncodeError(error.code, str(error)) from None
    if any(segment.track_kind == "DIALOGUE" for segment in content.audio_segments):
        raise DraftEncodeError(
            "DIALOGUE_UNSUPPORTED", "DRAFT export does not yet render DIALOGUE tracks"
        )
    if len(content.visual_segments) > 32 or len(content.audio_segments) > 32:
        raise DraftEncodeError(
            "SEGMENT_LIMIT", "DRAFT supports at most 32 visuals and 32 BGM/SFX clips"
        )
    rate_data = content.sequence_timebase.frame_rate
    rate = Fraction(rate_data.num, rate_data.den)
    duration = content.total_frames / rate
    if duration > 1800:
        raise DraftEncodeError("DURATION_LIMIT", "DRAFT export is limited to 30 minutes")
    if any(
        value < 16 or value > 1920 or value % 2
        for value in (content.canvas_width, content.canvas_height)
    ):
        raise DraftEncodeError(
            "CANVAS_UNSUPPORTED", "DRAFT canvas needs even dimensions from 16 to 1920"
        )
    try:
        output_io = managed_local_io_path(temporary_output.parent, temporary_output)
        if not temporary_output.name.endswith(".mp4") or output_io.exists():
            raise ValueError("output exists or wrong format")
    except (OSError, ValueError):
        raise DraftEncodeError(
            "OUTPUT_PATH_UNSAFE", "DRAFT output needs a new local MP4 path"
        ) from None
    runner = _Runner(toolchain, job_manager, stop_requested)
    runner.check()
    kinds: dict[str, str] = {}
    for segment in content.visual_segments:
        previous_kind = kinds.get(segment.media.sha256)
        if previous_kind is not None and previous_kind != segment.media_kind:
            raise DraftEncodeError(
                "SOURCE_KIND_CONFLICT", "One DRAFT source cannot have different media kinds"
            )
        kinds[segment.media.sha256] = segment.media_kind
    for audio_segment in content.audio_segments:
        if audio_segment.media.sha256 in kinds and kinds[audio_segment.media.sha256] != "audio":
            raise DraftEncodeError(
                "SOURCE_KIND_CONFLICT", "One DRAFT source cannot have different media kinds"
            )
        kinds[audio_segment.media.sha256] = "audio"
    if set(sources) != set(kinds):
        raise DraftEncodeError(
            "SOURCE_SET_MISMATCH", "DRAFT snapshots must cover exactly the selected sources"
        )
    with ExitStack() as stack:
        if toolchain.external_selected:
            from aijian_api.external_media_process import external_process_session

            try:
                private_directory, private_environment = stack.enter_context(
                    external_process_session()
                )
                runner.external_directory = private_directory
                runner.external_environment = dict(private_environment)
            except OSError:
                raise DraftEncodeError(
                    "TOOLCHAIN_UNAVAILABLE", "Private external media session is unavailable"
                ) from None
        subtitles: PreparedSubtitles | None = None
        if content.subtitle_segments:
            subtitle_directory = Path(
                stack.enter_context(
                    tempfile.TemporaryDirectory(
                        prefix="aivora-subtitles-",
                        dir=runner.external_directory or temporary_output.parent,
                    )
                )
            )
            try:
                subtitles = prepare_subtitles(content, subtitle_directory)
            except DraftSubtitleError as error:
                raise DraftEncodeError(error.code, str(error)) from None
        sealed: dict[str, _Source] = {}
        streams: dict[str, BinaryIO] = {}
        media: dict[str, _Media] = {}
        for digest, kind in kinds.items():
            sealed[digest], streams[digest] = _seal_source(
                sources[digest], digest, kind, runner, stack
            )
            media[digest] = _probe(sealed[digest], runner)
        arguments = [
            "-hide_banner",
            "-nostdin",
            "-n",
            "-v",
            "error",
            "-xerror",
            "-max_alloc",
            "268435456",
            "-filter_complex_threads",
            "1",
        ]
        filters: list[str] = []
        visual_labels: list[str] = []
        audio_labels: list[str] = []
        input_index = 0
        total_samples = sequence_frame_to_audio_sample(
            content.total_frames, content.sequence_timebase
        )

        def add_audio(index: int, info: _Audio, offset: int, start: int, end: int) -> None:
            required = -(-((end - start) * info.sample_rate * rate.denominator) // rate.numerator)
            if offset < 0 or offset + required > info.samples:
                raise DraftEncodeError(
                    "AUDIO_RANGE_UNSUPPORTED", "DRAFT audio trim exceeds decoded source samples"
                )
            start_sample = sequence_frame_to_audio_sample(start, content.sequence_timebase)
            end_sample = sequence_frame_to_audio_sample(end, content.sequence_timebase)
            length = end_sample - start_sample
            label = f"a{len(audio_labels)}"
            filters.append(
                f"[{index}:a:0]atrim=start_sample={offset}:end_sample={offset + required},"
                f"asetpts=N/SR/TB,aresample=48000,"
                f"aformat=sample_rates=48000:channel_layouts=stereo,"
                f"apad=whole_len={length},atrim=end_sample={length},"
                f"adelay=delays={start_sample}S:all=1[{label}]"
            )
            audio_labels.append(f"[{label}]")

        for segment in content.visual_segments:
            source, info = sealed[segment.media.sha256], media[segment.media.sha256]
            length = segment.end_frame - segment.start_frame
            if segment.media_kind == "video":
                if info.rate != rate:
                    raise DraftEncodeError(
                        "VIDEO_FRAME_RATE_MISMATCH",
                        "DRAFT video frame rate must match the assembly",
                    )
                if segment.source_in_frame + length > info.frames:
                    raise DraftEncodeError(
                        "VIDEO_RANGE_UNSUPPORTED", "DRAFT video trim exceeds decoded source frames"
                    )
            arguments.extend(_input_arguments(source))
            arguments.extend(("-threads", "1", "-noautorotate"))
            if segment.media_kind == "image":
                arguments.extend(("-loop", "1", "-framerate", str(rate)))
            arguments.extend(("-i", str(source.path)))
            label = f"v{input_index}"
            width, height = content.canvas_width, content.canvas_height
            filters.append(
                f"[{input_index}:v:0]trim=start_frame={segment.source_in_frame}:"
                f"end_frame={segment.source_in_frame + length},setpts=PTS-STARTPTS,"
                f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
                f"fps={rate},format=yuv420p[{label}]"
            )
            visual_labels.append(f"[{label}]")
            if segment.embedded_audio == "PLAY":
                if info.audio is None:
                    raise DraftEncodeError(
                        "EMBEDDED_AUDIO_MISSING", "PLAY video has no embedded audio"
                    )
                offset = (
                    info.first_time + segment.source_in_frame / rate - info.audio.first_time
                ) * info.audio.sample_rate
                if offset < 0:
                    raise DraftEncodeError(
                        "EMBEDDED_AUDIO_OFFSET_UNSUPPORTED",
                        "PLAY audio begins after its selected video frame",
                    )
                add_audio(
                    input_index,
                    info.audio,
                    _rounded_fraction(offset),
                    segment.start_frame,
                    segment.end_frame,
                )
            input_index += 1
        for audio_segment in content.audio_segments:
            source, info = sealed[audio_segment.media.sha256], media[audio_segment.media.sha256]
            assert info.audio is not None
            arguments.extend((*_input_arguments(source), "-threads", "1", "-i", str(source.path)))
            add_audio(
                input_index,
                info.audio,
                audio_segment.source_in_sample,
                audio_segment.start_frame,
                audio_segment.end_frame,
            )
            input_index += 1
        filters.append(
            "".join(visual_labels) + f"concat=n={len(visual_labels)}:v=1:a=0,"
            f"setpts=N*{rate.denominator}/({rate.numerator}*TB)"
            + (f",{subtitles.filters}" if subtitles else "")
            + "[vout]"
        )
        if audio_labels:
            filters.append(
                "".join(audio_labels) + f"amix=inputs={len(audio_labels)}:duration=longest:"
                "dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0:latency=1,"
                f"apad=whole_len={total_samples},atrim=end_sample={total_samples},asetpts=N/SR/TB[aout]"
            )
        arguments.extend(
            (
                "-filter_complex",
                ";".join(filters),
                "-map",
                "[vout]",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-frames:v",
                str(content.total_frames),
                "-r",
                str(rate),
                "-fps_mode",
                "cfr",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-threads",
                "2",
                "-pix_fmt",
                "yuv420p",
                "-t",
                f"{float(duration):.9f}",
            )
        )
        if audio_labels:
            arguments.extend(
                ("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2")
            )
        else:
            arguments.append("-an")
        arguments.extend(
            (
                "-metadata",
                "title=" + DRAFT_TITLE,
                "-metadata",
                "comment=" + DRAFT_COMMENT,
                "-fs",
                str(MAX_OUTPUT_BYTES),
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
                "-f",
                "mp4",
                str(temporary_output),
            )
        )
        for digest, source in sealed.items():
            _check_source(source, streams[digest], runner)
        runner.run(
            arguments,
            on_progress=on_progress,
            total_frames=content.total_frames,
            output=output_io,
            work_directory=subtitles.directory if subtitles else None,
        )
        for digest, source in sealed.items():
            _check_source(source, streams[digest], runner)
        if subtitles:
            try:
                subtitles.verify()
            except DraftSubtitleError as error:
                raise DraftEncodeError(error.code, str(error)) from None
        return _verify_output(
            temporary_output,
            assembly,
            runner,
            bool(audio_labels),
            total_samples,
            subtitle_evidence=subtitles.evidence if subtitles else None,
        )


def _verify_output(
    output: Path,
    assembly: EpisodeMediaAssemblyVersionData,
    runner: _Runner,
    expect_audio: bool,
    total_samples: int,
    *,
    subtitle_evidence: dict[str, Any] | None = None,
) -> VerifiedProductOutput:
    runner.check()
    try:
        first_hash, size = _guarded_file_hash(output)
        if size > MAX_OUTPUT_BYTES:
            raise DraftEncodeError("OUTPUT_SIZE", "DRAFT output exceeds its byte limit")
        with ExitStack() as stack:
            source, stream = _seal_source(output, first_hash, "video", runner, stack)
            actual = _probe(source, runner)
            content = assembly.content
            rate = content.sequence_timebase.frame_rate
            fps = Fraction(rate.num, rate.den)
            if (
                actual.codec != "h264"
                or actual.title != DRAFT_TITLE
                or actual.comment != DRAFT_COMMENT
                or actual.pixel_format != "yuv420p"
                or (actual.width, actual.height) != (content.canvas_width, content.canvas_height)
                or actual.rate != fps
                or actual.frames != content.total_frames
                or actual.first_time != 0
                or (actual.audio is not None) != expect_audio
                or actual.duration is None
                or abs(actual.duration - content.total_frames / fps) > 2 / fps
                or (
                    actual.audio is not None
                    and (
                        actual.audio.codec != "aac"
                        or actual.audio.sample_rate != 48000
                        or actual.audio.channels != 2
                        or actual.audio.first_time != 0
                        # AAC packets can contain at most one final padding block.
                        or not total_samples <= actual.audio.samples <= total_samples + 1024
                    )
                )
            ):
                raise DraftEncodeError(
                    "OUTPUT_SPEC_MISMATCH", "DRAFT MP4 does not match its saved assembly"
                )
            runner.run(
                [
                    "-hide_banner",
                    "-nostdin",
                    "-v",
                    "error",
                    "-xerror",
                    "-max_alloc",
                    "268435456",
                    "-threads",
                    "1",
                    "-err_detect",
                    "explode",
                    *_input_arguments(source),
                    "-i",
                    str(output),
                    "-map",
                    "0:v:0",
                    *(["-map", "0:a:0"] if expect_audio else []),
                    "-threads",
                    "1",
                    "-f",
                    "null",
                    "-",
                ],
                limit=65536,
            )
            _check_source(source, stream, runner)
        second_hash, second_size = _guarded_file_hash(output)
        runner.check()
        if second_hash != first_hash or size != second_size:
            raise DraftEncodeError("OUTPUT_CHANGED", "DRAFT output changed during verification")
        evidence = {
            "schema": "aivora.draft-mp4-verification.v1",
            "assembly_content_hash": assembly.content_hash,
            "sha256": first_hash,
            "byte_size": size,
            "toolchain_profile_id": runner.toolchain.profile_id,
            "ffmpeg_sha256": runner.toolchain.ffmpeg_sha256,
            "ffprobe_sha256": runner.toolchain.ffprobe_sha256,
            "container": "MP4",
            "title": actual.title,
            "comment": actual.comment,
            "video_codec": "h264",
            "pixel_format": "yuv420p",
            "width": actual.width,
            "height": actual.height,
            "frames": actual.frames,
            "frame_rate": {"num": fps.numerator, "den": fps.denominator},
            "cfr_pts_verified": True,
            "full_decode_verified": True,
            "audio": None
            if actual.audio is None
            else {
                "codec": actual.audio.codec,
                "sample_rate": actual.audio.sample_rate,
                "channels": actual.audio.channels,
                "decoded_samples": actual.audio.samples,
                "assembly_samples": total_samples,
                "mix": "unity_sum_peak_limited",
            },
        }
        if subtitle_evidence is not None:
            evidence["subtitles"] = subtitle_evidence
        payload = canonical_content_bytes(evidence)
        return VerifiedProductOutput(
            str(output),
            first_hash,
            size,
            payload.decode("utf-8"),
            "sha256:" + hashlib.sha256(payload).hexdigest(),
            datetime.now(UTC).isoformat(timespec="microseconds"),
        )
    except ProductExportOutputError as error:
        raise DraftEncodeError(error.code, str(error)) from None
