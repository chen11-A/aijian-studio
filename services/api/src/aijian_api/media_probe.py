"""Deterministic, local-only media probing through the pinned ffprobe binary."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import threading
from collections.abc import Callable
from contextlib import ExitStack
from enum import StrEnum
from fractions import Fraction
from pathlib import Path
from typing import Any, BinaryIO

from pydantic import BaseModel, ConfigDict, ValidationError

from aijian_api.media_contracts import MediaTimestampData, PositiveRationalData
from aijian_api.media_toolchain import MediaToolchain

MAX_PROBE_OUTPUT_BYTES = 2 * 1024 * 1024
PROBE_TIMEOUT_SECONDS = 20.0
ACCEPTED_AUDIO_SAMPLE_RATES = frozenset({44_100, 48_000})
MAX_MEDIA_INPUT_BYTES = 20 * 1024 * 1024 * 1024
MAX_MEDIA_DURATION_SECONDS = 6 * 60 * 60
MAX_MEDIA_FRAME_COUNT = 1_000_000
JSON_SAFE_INTEGER_MAX = 2**53 - 1
RATIONAL_PATTERN = re.compile(r"^(?P<num>[0-9]{1,16})/(?P<den>[0-9]{1,10})$")
DECIMAL_PATTERN = re.compile(r"^[0-9]{1,8}(?:\.[0-9]{1,9})?$")

CommandRunner = Callable[[Path, tuple[str, ...], float], bytes]


class MediaProbeErrorCode(StrEnum):
    INPUT_NOT_LOCAL = "INPUT_NOT_LOCAL"
    INPUT_NOT_FOUND = "INPUT_NOT_FOUND"
    INPUT_CHANGED = "INPUT_CHANGED"
    TIMEOUT = "TIMEOUT"
    PROBE_FAILED = "PROBE_FAILED"
    OUTPUT_LIMIT = "OUTPUT_LIMIT"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    UNSUPPORTED_LAYOUT = "UNSUPPORTED_LAYOUT"


class MediaProbeError(RuntimeError):
    """Stable error code with a diagnostic that does not expose probe output."""

    def __init__(self, code: MediaProbeErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


class VideoFrameProbeData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    pts: MediaTimestampData


class VideoProbeData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    stream_index: int
    codec_name: str
    width: int
    height: int
    pixel_format: str
    average_frame_rate: PositiveRationalData
    time_base: PositiveRationalData
    frames: tuple[VideoFrameProbeData, ...]
    is_variable_frame_rate: bool


class AudioProbeData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    stream_index: int
    codec_name: str
    sample_rate_hz: int
    channels: int
    channel_layout: str | None
    time_base: PositiveRationalData
    total_samples: int


class LocalMediaProbeData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source_asset_sha256: str
    byte_size: int
    format_names: tuple[str, ...]
    container_duration: PositiveRationalData
    video: VideoProbeData
    audio: AudioProbeData | None


def run_ffprobe_command(
    executable: Path,
    arguments: tuple[str, ...],
    timeout: float,
) -> bytes:
    """Execute an already trusted ffprobe path without a shell or stdin."""

    command = [str(executable), *arguments]
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if process.stdout is None:
        process.kill()
        process.wait()
        raise OSError("ffprobe output pipe is unavailable")
    process_stdout = process.stdout

    output = bytearray()
    output_limit_reached = threading.Event()
    read_failure: list[OSError] = []

    def read_output() -> None:
        try:
            while chunk := process_stdout.read(64 * 1024):
                remaining = MAX_PROBE_OUTPUT_BYTES - len(output)
                if len(chunk) > remaining:
                    output.extend(chunk[:remaining])
                    output_limit_reached.set()
                    process.kill()
                    return
                output.extend(chunk)
        except OSError as error:
            read_failure.append(error)
            process.kill()

    reader = threading.Thread(target=read_output, name="aijian-ffprobe-output", daemon=True)
    reader.start()
    try:
        return_code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        reader.join(timeout=1.0)
        raise
    reader.join(timeout=1.0)
    if reader.is_alive():
        process.kill()
        process.wait()
        raise OSError("ffprobe output reader did not terminate")
    if output_limit_reached.is_set():
        raise MediaProbeError(
            MediaProbeErrorCode.OUTPUT_LIMIT,
            "ffprobe output exceeds the size limit",
        )
    if read_failure:
        raise OSError("ffprobe output could not be read") from None
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, command)
    return bytes(output)


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_MEDIA_INPUT_BYTES:
                raise MediaProbeError(
                    MediaProbeErrorCode.INPUT_CHANGED,
                    "media snapshot exceeds the size limit",
                )
            digest.update(chunk)
    return digest.hexdigest()


def _open_windows_source(path: Path) -> BinaryIO:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    generic_read = 0x80000000
    file_share_read = 0x00000001
    open_existing = 3
    file_attribute_normal = 0x00000080
    file_flag_open_reparse_point = 0x00200000
    file_flag_sequential_scan = 0x08000000
    file_attribute_reparse_point = 0x00000400
    file_type_disk = 0x0001
    invalid_handle_value = ctypes.c_void_p(-1).value

    class ByHandleFileInformation(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD),
            ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME),
            ("ftLastWriteTime", wintypes.FILETIME),
            ("dwVolumeSerialNumber", wintypes.DWORD),
            ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD),
            ("nNumberOfLinks", wintypes.DWORD),
            ("nFileIndexHigh", wintypes.DWORD),
            ("nFileIndexLow", wintypes.DWORD),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE
    handle = create_file(
        str(path),
        generic_read,
        file_share_read,
        None,
        open_existing,
        file_attribute_normal | file_flag_open_reparse_point | file_flag_sequential_scan,
        None,
    )
    if handle == invalid_handle_value:
        raise OSError(ctypes.get_last_error(), "media source could not be opened")
    try:
        information = ByHandleFileInformation()
        if not kernel32.GetFileInformationByHandle(handle, ctypes.byref(information)):
            raise OSError(ctypes.get_last_error(), "media source identity is unavailable")
        if information.dwFileAttributes & file_attribute_reparse_point:
            raise OSError("media source cannot be a reparse point")
        if int(kernel32.GetFileType(handle)) != file_type_disk:
            raise OSError("media source is not a disk file")
        descriptor = msvcrt.open_osfhandle(int(handle), os.O_RDONLY | os.O_BINARY)
        handle = None
        return os.fdopen(descriptor, "rb", closefd=True)
    finally:
        if handle not in (None, invalid_handle_value):
            kernel32.CloseHandle(handle)


def _open_local_source(path: Path) -> BinaryIO:
    if os.name == "nt":
        return _open_windows_source(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags)
    try:
        source_stat = os.fstat(descriptor)
        if not stat.S_ISREG(source_stat.st_mode):
            raise OSError("media source is not a regular file")
        return os.fdopen(descriptor, "rb", closefd=True)
    except BaseException:
        os.close(descriptor)
        raise


def _copy_guarded_snapshot(source: BinaryIO, destination: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    copied = 0
    with destination.open("xb") as output_stream:
        while chunk := source.read(1024 * 1024):
            copied += len(chunk)
            if copied > MAX_MEDIA_INPUT_BYTES:
                raise MediaProbeError(
                    MediaProbeErrorCode.UNSUPPORTED_LAYOUT,
                    "media input exceeds the Phase 0 size limit",
                )
            digest.update(chunk)
            output_stream.write(chunk)
        output_stream.flush()
        os.fsync(output_stream.fileno())
    return digest.hexdigest(), copied


def _local_snapshot_root() -> Path:
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if not local_app_data:
            raise OSError("LOCALAPPDATA is unavailable")
        candidate = Path(local_app_data) / "AijianStudio" / "media-probe"
    else:
        user_id = int(getattr(os, "getuid", lambda: 0)())
        candidate = Path("/tmp") / f"aijian-studio-media-probe-{user_id}"
    if not candidate.is_absolute() or _is_remote_windows_path(candidate):
        raise OSError("media snapshot root is not local")
    candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
    resolved = candidate.resolve(strict=True)
    if _is_remote_windows_path(resolved) or not resolved.is_dir():
        raise OSError("media snapshot root is not a local directory")
    if os.name != "nt" and resolved.stat().st_uid != user_id:
        raise OSError("media snapshot root has the wrong owner")
    return resolved


def _is_remote_windows_path(path: Path) -> bool:
    drive = path.drive
    drive_root = f"{drive}\\"
    if drive.startswith("\\\\?\\"):
        if not re.fullmatch(r"\\\\\?\\[A-Za-z]:", drive):
            return True
        drive_root = f"{drive[4:]}\\"
    elif drive.startswith("\\\\"):
        return True
    if os.name != "nt" or not drive:
        return False
    try:
        import ctypes

        get_drive_type = ctypes.windll.kernel32.GetDriveTypeW
        return int(get_drive_type(drive_root)) == 4
    except (AttributeError, OSError, TypeError, ValueError):
        return True


def _positive_rational(value: object) -> PositiveRationalData:
    if not isinstance(value, str) or (match := RATIONAL_PATTERN.fullmatch(value)) is None:
        raise ValueError("expected a rational string")
    value_as_fraction = Fraction(int(match.group("num")), int(match.group("den")))
    if value_as_fraction <= 0:
        raise ValueError("rational must be positive")
    return PositiveRationalData(
        num=value_as_fraction.numerator,
        den=value_as_fraction.denominator,
    )


def _decimal_rational(value: object) -> PositiveRationalData:
    if not isinstance(value, str) or DECIMAL_PATTERN.fullmatch(value) is None:
        raise ValueError("expected a decimal string")
    value_as_fraction = Fraction(value)
    if not 0 < value_as_fraction <= MAX_MEDIA_DURATION_SECONDS:
        raise ValueError("duration is outside the Phase 0 limit")
    return PositiveRationalData(
        num=value_as_fraction.numerator,
        den=value_as_fraction.denominator,
    )


def _strict_int(value: object, *, minimum: int = 0) -> int:
    if isinstance(value, bool):
        raise ValueError("boolean is not an integer")
    parsed = int(value) if isinstance(value, str) else value
    if not isinstance(parsed, int) or not minimum <= parsed <= JSON_SAFE_INTEGER_MAX:
        raise ValueError("expected a bounded integer")
    return parsed


def _strict_text(value: object, *, maximum_length: int = 128) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum_length:
        raise ValueError("expected bounded text")
    return value


def _load_output(output: bytes) -> dict[str, Any]:
    if len(output) > MAX_PROBE_OUTPUT_BYTES:
        raise MediaProbeError(
            MediaProbeErrorCode.OUTPUT_LIMIT,
            "ffprobe output exceeds the size limit",
        )
    try:
        payload = json.loads(output)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise MediaProbeError(
            MediaProbeErrorCode.INVALID_OUTPUT,
            "ffprobe returned invalid JSON",
        ) from None
    if not isinstance(payload, dict):
        raise MediaProbeError(
            MediaProbeErrorCode.INVALID_OUTPUT,
            "ffprobe returned an invalid document",
        )
    return payload


def _run_probe(
    toolchain: MediaToolchain,
    source: Path,
    source_sha256: str,
    arguments: tuple[str, ...],
    command_runner: CommandRunner,
) -> dict[str, Any]:
    common = (
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-probesize",
        "67108864",
        "-analyzeduration",
        "10000000",
        "-bitexact",
        "-print_format",
        "json",
    )
    try:
        output = command_runner(
            toolchain.ffprobe_path,
            (*common, *arguments, str(source)),
            PROBE_TIMEOUT_SECONDS,
        )
    except MediaProbeError:
        raise
    except subprocess.TimeoutExpired:
        raise MediaProbeError(MediaProbeErrorCode.TIMEOUT, "ffprobe timed out") from None
    except (subprocess.SubprocessError, OSError):
        raise MediaProbeError(MediaProbeErrorCode.PROBE_FAILED, "ffprobe failed") from None
    payload = _load_output(output)
    if _hash_file(source) != source_sha256:
        raise MediaProbeError(MediaProbeErrorCode.INPUT_CHANGED, "media snapshot changed")
    return payload


def _rounded_fraction(value: Fraction) -> int:
    quotient, remainder = divmod(value.numerator, value.denominator)
    return quotient + (1 if remainder * 2 >= value.denominator else 0)


def _is_vfr(
    timestamps: tuple[int, ...],
    durations: tuple[int, ...],
    time_base: PositiveRationalData,
    frame_rate: PositiveRationalData,
) -> bool:
    ticks_per_frame = Fraction(
        time_base.den * frame_rate.den,
        time_base.num * frame_rate.num,
    )
    first = timestamps[0]
    cadence_mismatch = len(timestamps) >= 2 and any(
        timestamp != first + _rounded_fraction(index * ticks_per_frame)
        for index, timestamp in enumerate(timestamps)
    )
    minimum_duration = ticks_per_frame.numerator // ticks_per_frame.denominator
    maximum_duration = -(-ticks_per_frame.numerator // ticks_per_frame.denominator)
    duration_mismatch = any(
        not minimum_duration <= duration <= maximum_duration for duration in durations
    )
    return cadence_mismatch or duration_mismatch


def _parse_video(
    stream: dict[str, Any],
    frame_payload: dict[str, Any],
) -> VideoProbeData:
    frame_rate = _positive_rational(stream.get("avg_frame_rate"))
    time_base = _positive_rational(stream.get("time_base"))
    raw_frames = frame_payload.get("frames")
    if (
        not isinstance(raw_frames, list)
        or not raw_frames
        or len(raw_frames) > MAX_MEDIA_FRAME_COUNT
    ):
        raise ValueError("video frame list is missing")
    stream_index = _strict_int(stream.get("index"))
    timestamps: list[int] = []
    durations: list[int] = []
    for frame in raw_frames:
        if not isinstance(frame, dict) or frame.get("media_type") != "video":
            raise ValueError("invalid video frame")
        if _strict_int(frame.get("stream_index")) != stream_index:
            raise ValueError("video frame belongs to another stream")
        timestamp = _strict_int(frame.get("pts"), minimum=-(2**53 - 1))
        if timestamps and timestamp <= timestamps[-1]:
            raise ValueError("video PTS must increase")
        timestamps.append(timestamp)
        durations.append(_strict_int(frame.get("duration"), minimum=1))
    return VideoProbeData(
        stream_index=stream_index,
        codec_name=_strict_text(stream["codec_name"]),
        width=_strict_int(stream.get("width"), minimum=1),
        height=_strict_int(stream.get("height"), minimum=1),
        pixel_format=_strict_text(stream["pix_fmt"]),
        average_frame_rate=frame_rate,
        time_base=time_base,
        frames=tuple(
            VideoFrameProbeData(pts=MediaTimestampData(ticks=timestamp, time_base=time_base))
            for timestamp in timestamps
        ),
        is_variable_frame_rate=_is_vfr(
            tuple(timestamps),
            tuple(durations),
            time_base,
            frame_rate,
        ),
    )


def _parse_audio(
    stream: dict[str, Any],
    frame_payload: dict[str, Any],
) -> AudioProbeData:
    sample_rate = _strict_int(stream.get("sample_rate"), minimum=1)
    if sample_rate not in ACCEPTED_AUDIO_SAMPLE_RATES:
        raise MediaProbeError(
            MediaProbeErrorCode.UNSUPPORTED_LAYOUT,
            "audio sample rate is not accepted by the Phase 0 contract",
        )
    stream_index = _strict_int(stream.get("index"))
    raw_frames = frame_payload.get("frames")
    if not isinstance(raw_frames, list) or len(raw_frames) > MAX_MEDIA_FRAME_COUNT:
        raise ValueError("audio frame list is missing")
    total_samples = 0
    for frame in raw_frames:
        if not isinstance(frame, dict) or frame.get("media_type") != "audio":
            raise ValueError("invalid audio frame")
        if _strict_int(frame.get("stream_index")) != stream_index:
            raise ValueError("audio frame belongs to another stream")
        total_samples += _strict_int(frame.get("nb_samples"), minimum=1)
        if total_samples > JSON_SAFE_INTEGER_MAX:
            raise ValueError("audio sample count exceeds the JSON-safe limit")
    return AudioProbeData(
        stream_index=stream_index,
        codec_name=_strict_text(stream["codec_name"]),
        sample_rate_hz=sample_rate,
        channels=_strict_int(stream.get("channels"), minimum=1),
        channel_layout=(
            _strict_text(stream["channel_layout"])
            if stream.get("channel_layout") is not None
            else None
        ),
        time_base=_positive_rational(stream.get("time_base")),
        total_samples=total_samples,
    )


def probe_local_media(
    source: Path,
    toolchain: MediaToolchain,
    *,
    command_runner: CommandRunner = run_ffprobe_command,
) -> LocalMediaProbeData:
    """Probe one immutable local file and return canonical timing metadata."""

    if not source.is_absolute() or _is_remote_windows_path(source):
        raise MediaProbeError(
            MediaProbeErrorCode.INPUT_NOT_LOCAL,
            "media input must be an absolute local path",
        )
    try:
        resolved = source.resolve(strict=True)
        if _is_remote_windows_path(resolved):
            raise MediaProbeError(
                MediaProbeErrorCode.INPUT_NOT_LOCAL,
                "media input must resolve to a local path",
            )
        if not resolved.is_file():
            raise MediaProbeError(
                MediaProbeErrorCode.INPUT_NOT_FOUND,
                "media input is not a regular file",
            )
        resolved_identity = resolved.stat()
        snapshot_root = _local_snapshot_root()
    except MediaProbeError:
        raise
    except (OSError, RuntimeError):
        raise MediaProbeError(
            MediaProbeErrorCode.INPUT_NOT_FOUND,
            "media input is missing or is not a regular file",
        ) from None

    try:
        with _open_local_source(resolved) as source_stream:
            before = os.fstat(source_stream.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise MediaProbeError(
                    MediaProbeErrorCode.INPUT_NOT_FOUND,
                    "media input is not a regular file",
                )
            if (
                before.st_dev != resolved_identity.st_dev
                or before.st_ino != resolved_identity.st_ino
                or before.st_size != resolved_identity.st_size
                or before.st_mtime_ns != resolved_identity.st_mtime_ns
            ):
                raise MediaProbeError(MediaProbeErrorCode.INPUT_CHANGED, "media input changed")
            if before.st_size > MAX_MEDIA_INPUT_BYTES:
                raise MediaProbeError(
                    MediaProbeErrorCode.UNSUPPORTED_LAYOUT,
                    "media input exceeds the Phase 0 size limit",
                )
            with ExitStack() as snapshot_stack:
                temporary_root = snapshot_stack.enter_context(
                    tempfile.TemporaryDirectory(
                        prefix="aijian-media-probe-",
                        dir=snapshot_root,
                    )
                )
                snapshot = Path(temporary_root) / f"input{resolved.suffix}"
                source_hash, snapshot_size = _copy_guarded_snapshot(source_stream, snapshot)
                os.chmod(snapshot, stat.S_IREAD)
                if snapshot_size != before.st_size:
                    raise MediaProbeError(MediaProbeErrorCode.INPUT_CHANGED, "media input changed")
                snapshot_stack.enter_context(_open_local_source(snapshot))

                summary = _run_probe(
                    toolchain,
                    snapshot,
                    source_hash,
                    ("-show_format", "-show_streams"),
                    command_runner,
                )
                streams = summary.get("streams")
                format_data = summary.get("format")
                if not isinstance(streams, list) or not isinstance(format_data, dict):
                    raise MediaProbeError(
                        MediaProbeErrorCode.INVALID_OUTPUT,
                        "media summary is incomplete",
                    )
                if summary.get("programs") not in (None, []) or summary.get(
                    "stream_groups"
                ) not in (None, []):
                    raise MediaProbeError(
                        MediaProbeErrorCode.UNSUPPORTED_LAYOUT,
                        "program and stream-group layouts are not supported",
                    )
                if not all(isinstance(item, dict) for item in streams):
                    raise MediaProbeError(
                        MediaProbeErrorCode.INVALID_OUTPUT,
                        "media stream metadata is invalid",
                    )
                video_streams = [item for item in streams if item.get("codec_type") == "video"]
                audio_streams = [item for item in streams if item.get("codec_type") == "audio"]
                if (
                    len(video_streams) != 1
                    or len(audio_streams) > 1
                    or len(video_streams) + len(audio_streams) != len(streams)
                ):
                    raise MediaProbeError(
                        MediaProbeErrorCode.UNSUPPORTED_LAYOUT,
                        "only one video stream and at most one audio stream are supported",
                    )

                video_frames = _run_probe(
                    toolchain,
                    snapshot,
                    source_hash,
                    (
                        "-select_streams",
                        "v:0",
                        "-show_frames",
                        "-show_entries",
                        "frame=media_type,stream_index,key_frame,pts,duration",
                    ),
                    command_runner,
                )
                audio_frames = None
                if audio_streams:
                    audio_frames = _run_probe(
                        toolchain,
                        snapshot,
                        source_hash,
                        (
                            "-select_streams",
                            "a:0",
                            "-show_frames",
                            "-show_entries",
                            "frame=media_type,stream_index,pts,nb_samples",
                        ),
                        command_runner,
                    )

                after = os.fstat(source_stream.fileno())
                if (
                    before.st_dev != after.st_dev
                    or before.st_ino != after.st_ino
                    or before.st_size != after.st_size
                    or before.st_mtime_ns != after.st_mtime_ns
                ):
                    raise MediaProbeError(MediaProbeErrorCode.INPUT_CHANGED, "media input changed")

                try:
                    declared_size = _strict_int(format_data.get("size"))
                    if declared_size != snapshot_size:
                        raise ValueError("container size does not match the local snapshot")
                    format_name = format_data.get("format_name")
                    if not isinstance(format_name, str) or not format_name:
                        raise ValueError("container format is missing")
                    format_names = tuple(
                        _strict_text(part.strip()) for part in format_name.split(",")
                    )
                    video = _parse_video(video_streams[0], video_frames)
                    audio = (
                        _parse_audio(audio_streams[0], audio_frames)
                        if audio_streams and audio_frames is not None
                        else None
                    )
                    return LocalMediaProbeData(
                        source_asset_sha256=f"sha256:{source_hash}",
                        byte_size=snapshot_size,
                        format_names=format_names,
                        container_duration=_decimal_rational(format_data.get("duration")),
                        video=video,
                        audio=audio,
                    )
                except MediaProbeError:
                    raise
                except (KeyError, TypeError, ValueError, ValidationError, ZeroDivisionError):
                    raise MediaProbeError(
                        MediaProbeErrorCode.INVALID_OUTPUT,
                        "ffprobe metadata does not satisfy the media contract",
                    ) from None
    except MediaProbeError:
        raise
    except OSError:
        raise MediaProbeError(
            MediaProbeErrorCode.PROBE_FAILED,
            "guarded media snapshot could not be created",
        ) from None
