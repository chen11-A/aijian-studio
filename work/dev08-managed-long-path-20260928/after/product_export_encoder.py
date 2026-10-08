"""Bounded local ffmpeg execution for a verified render plan.

This primitive writes a temporary MP4 only. A caller must separately verify
and publish output, and must never treat its exit code as a product receipt.
"""

from __future__ import annotations

import hashlib
import math
import os
import queue
import stat
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from aijian_api.media_probe import _is_remote_windows_path, _open_local_source
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_render_plan import EncoderPlan, render_arguments
from aijian_api.product_export_windows_job import (
    ProductExportJobError, ProductExportJobManager, ProductExportJobProcess,
)

MAX_ENCODER_SECONDS = 3600.0
MAX_STDERR_BYTES = 64 * 1024
MAX_SOURCE_BYTES = 20 * 1024 * 1024 * 1024


class ProductExportEncoderError(RuntimeError):
    def __init__(self, code: str, message: str, *, exit_code: int | None = None,
                 stderr_bytes: bytes = b"") -> None:
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code
        self.stderr_bytes = stderr_bytes
        self.stderr_sha256 = hashlib.sha256(stderr_bytes).hexdigest()


@dataclass(frozen=True, slots=True)
class ProductExportEncoderResult:
    exit_code: int
    elapsed_seconds: float
    progress_frames: int
    stderr_sha256: str
    stderr_bytes: bytes


def _plain_directory(path: Path) -> bool:
    try:
        io_path = managed_local_io_path(path, path)
        return io_path.is_dir() and not io_path.is_symlink() and io_path.resolve(strict=True) == io_path
    except (OSError, RuntimeError, ValueError):
        return False


def _stop(process: ProductExportJobProcess) -> None:
    # Terminate the whole job even if ffmpeg itself exited but left a child.
    process.terminate()
    process.wait(timeout=2.0)


def run_local_encoder(
    plan: EncoderPlan,
    source: Path,
    temporary_output: Path,
    toolchain: MediaToolchain,
    *,
    job_manager: ProductExportJobManager,
    on_progress: Callable[[int], None],
    stop_requested: Callable[[], bool],
    timeout_seconds: float = MAX_ENCODER_SECONDS,
) -> ProductExportEncoderResult:
    """Run one pinned process; cancellation and failure never retry the process."""
    if (
        not isinstance(timeout_seconds, int | float)
        or isinstance(timeout_seconds, bool)
        or not math.isfinite(timeout_seconds)
        or timeout_seconds <= 0 or timeout_seconds > MAX_ENCODER_SECONDS
        or plan.ffmpeg_sha256 != toolchain.ffmpeg_sha256
        or plan.ffprobe_sha256 != toolchain.ffprobe_sha256
        or plan.toolchain_profile_id != toolchain.profile_id
    ):
        raise ProductExportEncoderError("PLAN_OR_TOOLCHAIN_INVALID", "Encoder plan or timeout is invalid")
    try:
        source_io = managed_local_io_path(source.parent, source)
        temporary_io = managed_local_io_path(temporary_output.parent, temporary_output)
    except (OSError, ValueError):
        raise ProductExportEncoderError("PATH_UNSAFE", "Encoder input or temporary output path is unsafe") from None
    if (
        not source.is_absolute() or not temporary_output.is_absolute()
        or _is_remote_windows_path(source) or _is_remote_windows_path(temporary_output)
        or not _plain_directory(source.parent)
        or not _plain_directory(temporary_output.parent)
        or source_io.is_symlink() or not source_io.is_file()
        or temporary_io.exists() or temporary_io.is_symlink()
    ):
        raise ProductExportEncoderError("PATH_UNSAFE", "Encoder input or temporary output path is unsafe")
    start = time.monotonic()
    try:
        binary_hash = hashlib.sha256()
        with _open_local_source(toolchain.ffmpeg_path) as binary:
            while chunk := binary.read(1024 * 1024):
                binary_hash.update(chunk)
        if binary_hash.hexdigest() != toolchain.ffmpeg_sha256:
            raise ProductExportEncoderError("TOOLCHAIN_CHANGED", "Pinned encoder bytes changed")
    except ProductExportEncoderError:
        raise
    except OSError:
        raise ProductExportEncoderError("TOOLCHAIN_UNAVAILABLE", "Pinned encoder is unavailable") from None
    try:
        source_stream = _open_local_source(source_io)
    except OSError:
        raise ProductExportEncoderError("SOURCE_UNAVAILABLE", "Selected media original is unavailable") from None
    with source_stream:
        before = os.fstat(source_stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_SOURCE_BYTES:
            raise ProductExportEncoderError("SOURCE_SIZE", "Selected original has an invalid size")
        digest = hashlib.sha256()
        while chunk := source_stream.read(1024 * 1024):
            digest.update(chunk)
            if time.monotonic() - start > 120.0:
                raise ProductExportEncoderError("SOURCE_HASH_TIMEOUT", "Selected original could not be hashed in time")
        if digest.hexdigest() != plan.source_sha256:
            raise ProductExportEncoderError("SOURCE_CHANGED", "Selected original differs from render plan")
        source_stream.seek(0)
        arguments = render_arguments(plan, source, temporary_output)
        environment = {
            key: os.environ[key] for key in (
                "COMSPEC", "PATH", "PATHEXT", "SYSTEMDRIVE", "SYSTEMROOT",
                "TEMP", "TMP", "WINDIR",
            ) if key in os.environ
        }
        frames: queue.Queue[int] = queue.Queue(maxsize=64)
        stderr_capture = bytearray()
        stderr_digest = hashlib.sha256()

        def read_progress() -> None:
            assert process.stdout is not None
            for raw in process.stdout:
                if len(raw) > 128 or not raw.startswith(b"frame="):
                    continue
                try:
                    frame = int(raw[6:].strip())
                except ValueError:
                    continue
                if 0 <= frame <= plan.total_frames:
                    try:
                        frames.put_nowait(frame)
                    except queue.Full:
                        pass

        def read_stderr() -> None:
            assert process.stderr is not None
            while chunk := process.stderr.read(4096):
                stderr_digest.update(chunk)
                remaining = MAX_STDERR_BYTES - len(stderr_capture)
                if remaining > 0:
                    stderr_capture.extend(chunk[:remaining])

        progress_reader = threading.Thread(target=read_progress, daemon=True)
        stderr_reader = threading.Thread(target=read_stderr, daemon=True)
        if stop_requested():
            raise ProductExportEncoderError("CANCELLED", "Encoder was cancelled before launch")
        try:
            process = job_manager.spawn(
                toolchain.ffmpeg_path, arguments,
                cwd=toolchain.ffmpeg_path.parent, env=environment,
            )
        except ProductExportJobError:
            raise ProductExportEncoderError(
                "JOB_LAUNCH_FAILED", "Managed export encoder could not start",
            ) from None
        progress_started = False
        stderr_started = False
        maximum_frame = 0
        try:
            progress_reader.start()
            progress_started = True
            stderr_reader.start()
            stderr_started = True
            while process.poll() is None:
                if stop_requested():
                    _stop(process)
                    raise ProductExportEncoderError(
                        "CANCELLED", "Encoder was cancelled", exit_code=process.returncode,
                        stderr_bytes=bytes(stderr_capture),
                    )
                if time.monotonic() - start >= timeout_seconds:
                    _stop(process)
                    raise ProductExportEncoderError(
                        "TIMEOUT", "Encoder exceeded its runtime limit",
                        exit_code=process.returncode, stderr_bytes=bytes(stderr_capture),
                    )
                try:
                    frame = frames.get(timeout=0.1)
                except queue.Empty:
                    continue
                if frame > maximum_frame:
                    maximum_frame = frame
                    on_progress(frame)
            progress_reader.join(timeout=2.0)
            stderr_reader.join(timeout=2.0)
            if progress_reader.is_alive() or stderr_reader.is_alive():
                raise ProductExportEncoderError("PIPE_STALLED", "Encoder output reader did not finish")
            while not frames.empty():
                maximum_frame = max(maximum_frame, frames.get_nowait())
            if process.returncode != 0:
                raise ProductExportEncoderError(
                    "ENCODER_FAILED", "Encoder exited unsuccessfully",
                    exit_code=process.returncode, stderr_bytes=bytes(stderr_capture),
                )
            after = os.fstat(source_stream.fileno())
            if (
                before.st_dev != after.st_dev or before.st_ino != after.st_ino
                or before.st_size != after.st_size
                or before.st_mtime_ns != after.st_mtime_ns
            ):
                raise ProductExportEncoderError("SOURCE_CHANGED", "Selected original changed during encoding")
            if not temporary_io.is_file() or temporary_io.stat().st_size <= 0:
                raise ProductExportEncoderError("OUTPUT_MISSING", "Encoder produced no nonempty output")
            return ProductExportEncoderResult(
                exit_code=0, elapsed_seconds=time.monotonic() - start,
                progress_frames=maximum_frame,
                stderr_sha256=stderr_digest.hexdigest(),
                stderr_bytes=bytes(stderr_capture),
            )
        except BaseException:
            _stop(process)
            if progress_started:
                progress_reader.join(timeout=2.0)
            if stderr_started:
                stderr_reader.join(timeout=2.0)
            raise
        finally:
            job_manager.release(process)
