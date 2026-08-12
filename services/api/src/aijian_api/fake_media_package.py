"""Deterministic, workspace-confined Fake media packages for the Phase 0 skeleton."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from aijian_api.agent_skill_contracts import PROJECT_ID_PATTERN
from aijian_api.media_contracts import CONTENT_HASH_PATTERN, SequenceFrameRateData
from aijian_api.media_probe import MediaProbeError, _is_remote_windows_path, probe_local_media
from aijian_api.media_toolchain import (
    MediaToolchain,
    MediaToolchainLockData,
    discover_media_toolchain,
)

SOURCE_DOCUMENT_ID_PATTERN = r"^src_[0-9a-f]{32}$"
PACKAGE_ID_PATTERN = r"^fmp_[0-9a-f]{32}$"
RELATIVE_MEDIA_PATH_PATTERN = r"^shot-[0-9]{2}/(still\.png|scratch-voice\.wav|preview\.webm)$"
GENERATOR_VERSION = "phase0.fake-media.v1"
RECIPE_VERSION = "phase0.fake-media-recipe.v1"
SHOT_COUNT = 3
FRAME_RATE = 25
FRAME_COUNT = 125
DURATION_SECONDS = FRAME_COUNT // FRAME_RATE
WIDTH = 320
HEIGHT = 568
AUDIO_SAMPLE_RATE = 48_000
AUDIO_SAMPLE_COUNT = 240_000
MAX_MEDIA_FILE_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
GENERATION_TIMEOUT_SECONDS = 60
STAGING_GRACE_SECONDS = 2.0
STAGING_PREFIX = ".aijian-fake-media-"
STAGING_LEASE_NAME = "staging-lease.json"
PUBLISH_LEASE_SUFFIX = ".publish-lease.json"
PROJECT_LOCK_NAME = ".publish.lock"
PROJECT_LOCK_TIMEOUT_SECONDS = 30.0
_GENERATION_SLOT = threading.BoundedSemaphore(value=1)
_LOCKED_CONSTRUCTION_TOKEN = object()

ContentHash = Annotated[str, Field(pattern=CONTENT_HASH_PATTERN)]
RelativeMediaPath = Annotated[str, Field(pattern=RELATIVE_MEDIA_PATH_PATTERN)]


class FakeMediaPackageError(RuntimeError):
    """The local Fake media package could not be safely generated or verified."""


class _StagingLeaseV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    pid: Annotated[int, Field(strict=True, gt=0)]
    process_started_at_ns: Annotated[int, Field(strict=True, gt=0)]
    created_at_epoch_ns: Annotated[int, Field(strict=True, gt=0)]


class FakeShotRequestV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    shot_id: Annotated[str, Field(pattern=r"^fake-shot-[0-9]{2}$")]
    duration_frames: Literal[125] = 125


class FakeMediaPackageRequestV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    generator_definition: Literal["local.fake-media"] = "local.fake-media"
    generator_version: Literal["phase0.fake-media.v1"] = "phase0.fake-media.v1"
    recipe_version: Literal["phase0.fake-media-recipe.v1"] = "phase0.fake-media-recipe.v1"
    project_id: Annotated[str, Field(pattern=PROJECT_ID_PATTERN)]
    source_document_id: Annotated[str, Field(pattern=SOURCE_DOCUMENT_ID_PATTERN)]
    source_sha256: ContentHash
    frame_rate: SequenceFrameRateData
    audio_sample_rate_hz: Literal[48000] = 48000
    shots: tuple[FakeShotRequestV1, ...] = Field(min_length=SHOT_COUNT, max_length=SHOT_COUNT)

    @model_validator(mode="after")
    def require_closed_phase0_request(self) -> Self:
        if (self.frame_rate.num, self.frame_rate.den) != (FRAME_RATE, 1):
            raise ValueError("fake media request must use 25 fps")
        expected = tuple(f"fake-shot-{index:02d}" for index in range(1, SHOT_COUNT + 1))
        if tuple(shot.shot_id for shot in self.shots) != expected:
            raise ValueError("fake media request must contain the three ordered Phase 0 shots")
        return self


class _FakeMediaFileV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    relative_path: RelativeMediaPath
    sha256: ContentHash
    byte_size: Annotated[int, Field(strict=True, gt=0, le=MAX_MEDIA_FILE_BYTES)]


class FakeStillImageFileV1(_FakeMediaFileV1):
    role: Literal["STORYBOARD_STILL"] = "STORYBOARD_STILL"
    media_type: Literal["image/png"] = "image/png"
    width: Literal[320] = 320
    height: Literal[568] = 568


class FakeScratchVoiceFileV1(_FakeMediaFileV1):
    role: Literal["SCRATCH_VOICE"] = "SCRATCH_VOICE"
    media_type: Literal["audio/wav"] = "audio/wav"
    sample_rate_hz: Literal[48000] = 48000
    channels: Literal[1] = 1
    sample_count: Literal[240000] = 240000


class FakePreviewVideoFileV1(_FakeMediaFileV1):
    role: Literal["EDITING_PREVIEW"] = "EDITING_PREVIEW"
    media_type: Literal["video/webm"] = "video/webm"
    container: Literal["webm"] = "webm"
    width: Literal[320] = 320
    height: Literal[568] = 568
    frame_count: Literal[125] = 125
    frame_rate: SequenceFrameRateData
    audio_sample_rate_hz: Literal[48000] = 48000
    audio_channels: Literal[1] = 1
    audio_sample_count: Literal[240000] = 240000

    @model_validator(mode="after")
    def require_phase0_frame_rate(self) -> Self:
        if (self.frame_rate.num, self.frame_rate.den) != (FRAME_RATE, 1):
            raise ValueError("fake editing preview must use 25 fps CFR")
        return self


class FakeShotMediaV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    shot_id: Annotated[str, Field(pattern=r"^fake-shot-[0-9]{2}$")]
    duration_frames: Literal[125] = 125
    capability_losses: tuple[
        Literal["FAKE_IMAGE_NO_SEMANTIC_GENERATION"],
        Literal["STATIC_FRAME_NO_MOTION_GENERATION"],
        Literal["PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY"],
    ] = (
        "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
        "STATIC_FRAME_NO_MOTION_GENERATION",
        "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    )
    still_image: FakeStillImageFileV1
    scratch_voice: FakeScratchVoiceFileV1
    preview_video: FakePreviewVideoFileV1

    @model_validator(mode="after")
    def require_shot_scoped_paths(self) -> Self:
        shot_number = self.shot_id.removeprefix("fake-shot-")
        expected = {
            self.still_image.relative_path: f"shot-{shot_number}/still.png",
            self.scratch_voice.relative_path: f"shot-{shot_number}/scratch-voice.wav",
            self.preview_video.relative_path: f"shot-{shot_number}/preview.webm",
        }
        if any(actual != required for actual, required in expected.items()):
            raise ValueError("fake media file paths must match their shot")
        return self


class FakeMediaPackageV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    generator_version: Literal["phase0.fake-media.v1"] = "phase0.fake-media.v1"
    recipe_version: Literal["phase0.fake-media-recipe.v1"] = "phase0.fake-media-recipe.v1"
    package_id: Annotated[str, Field(pattern=PACKAGE_ID_PATTERN)]
    request_hash: ContentHash
    project_id: Annotated[str, Field(pattern=PROJECT_ID_PATTERN)]
    source_document_id: Annotated[str, Field(pattern=SOURCE_DOCUMENT_ID_PATTERN)]
    source_sha256: ContentHash
    toolchain_profile_id: Annotated[str, Field(min_length=3, max_length=80)]
    toolchain_version: Annotated[str, Field(pattern=r"^[0-9]+\.[0-9]+\.[0-9]+$")]
    ffmpeg_sha256: ContentHash
    ffprobe_sha256: ContentHash
    purpose: Literal["DEVELOPMENT_EVIDENCE"] = "DEVELOPMENT_EVIDENCE"
    frame_rate: SequenceFrameRateData
    frame_count_per_shot: Literal[125] = 125
    width: Literal[320] = 320
    height: Literal[568] = 568
    audio_sample_rate_hz: Literal[48000] = 48000
    audio_sample_count_per_shot: Literal[240000] = 240000
    capability_losses: tuple[
        Literal["FAKE_IMAGE_NO_SEMANTIC_GENERATION"],
        Literal["STATIC_FRAME_NO_MOTION_GENERATION"],
        Literal["PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY"],
    ] = (
        "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
        "STATIC_FRAME_NO_MOTION_GENERATION",
        "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    )
    shots: tuple[FakeShotMediaV1, ...] = Field(min_length=SHOT_COUNT, max_length=SHOT_COUNT)

    @model_validator(mode="after")
    def require_phase0_media_contract(self) -> Self:
        if (self.frame_rate.num, self.frame_rate.den) != (FRAME_RATE, 1):
            raise ValueError("fake media package must use the Phase 0 25 fps timebase")
        expected_shots = tuple(f"fake-shot-{index:02d}" for index in range(1, SHOT_COUNT + 1))
        if tuple(shot.shot_id for shot in self.shots) != expected_shots:
            raise ValueError("fake media package shots must be complete and ordered")
        if any(shot.capability_losses != self.capability_losses for shot in self.shots):
            raise ValueError("fake media capability losses must be explicit on every shot")
        paths = [
            media.relative_path
            for shot in self.shots
            for media in (shot.still_image, shot.scratch_voice, shot.preview_video)
        ]
        if len(paths) != len(set(paths)):
            raise ValueError("fake media package paths must be unique")
        return self


@dataclass(frozen=True, slots=True)
class GeneratedFakeMediaPackage:
    root: Path
    manifest: FakeMediaPackageV1

    def resolve(self, media: _FakeMediaFileV1) -> Path:
        try:
            root = self.root.resolve(strict=True)
            resolved = (root / media.relative_path).resolve(strict=True)
        except (OSError, RuntimeError):
            raise FakeMediaPackageError("fake media package path is unavailable") from None
        if not resolved.is_file() or not resolved.is_relative_to(root):
            raise FakeMediaPackageError("fake media package path escapes its package")
        return resolved


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _content_hash(value: object) -> str:
    return f"sha256:{hashlib.sha256(_canonical_json(value)).hexdigest()}"


def _file_hash(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_MEDIA_FILE_BYTES:
                    raise FakeMediaPackageError("fake media file exceeds the size limit")
                digest.update(chunk)
    except FakeMediaPackageError:
        raise
    except OSError:
        raise FakeMediaPackageError("fake media file could not be read") from None
    if size == 0:
        raise FakeMediaPackageError("fake media file is empty")
    return f"sha256:{digest.hexdigest()}", size


def _binary_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        resolved = path.resolve(strict=True)
        metadata = path.lstat()
        if (
            not resolved.is_file()
            or path.is_symlink()
            or bool(getattr(metadata, "st_file_attributes", 0) & 0x400)
        ):
            raise FakeMediaPackageError("media tool binary path is unsafe")
        with resolved.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    except FakeMediaPackageError:
        raise
    except (OSError, RuntimeError):
        raise FakeMediaPackageError("media tool binary could not be verified") from None
    return digest.hexdigest()


def _require_toolchain_unchanged(toolchain: MediaToolchain, tool_root: Path) -> None:
    resolved_root = _safe_tool_root(tool_root)
    if (
        toolchain.ffmpeg_path.resolve().parent != resolved_root
        or toolchain.ffprobe_path.resolve().parent != resolved_root
        or _binary_sha256(toolchain.ffmpeg_path) != toolchain.ffmpeg_sha256
        or _binary_sha256(toolchain.ffprobe_path) != toolchain.ffprobe_sha256
        or toolchain.ffmpeg_path.resolve().parent != toolchain.ffprobe_path.resolve().parent
    ):
        raise FakeMediaPackageError("locked media tool binaries changed after discovery")


def _safe_workspace_root(workspace_root: Path) -> Path:
    if not workspace_root.is_absolute() or _is_remote_windows_path(workspace_root):
        raise FakeMediaPackageError("fake media workspace must be an absolute local path")
    try:
        cursor = workspace_root
        while cursor != cursor.parent:
            metadata = cursor.lstat()
            if cursor.is_symlink() or bool(
                getattr(metadata, "st_file_attributes", 0) & 0x400
            ):
                raise FakeMediaPackageError(
                    "fake media workspace cannot traverse a reparse point"
                )
            cursor = cursor.parent
        resolved = workspace_root.resolve(strict=True)
    except (OSError, RuntimeError):
        raise FakeMediaPackageError("fake media workspace is unavailable") from None
    if not resolved.is_dir() or _is_remote_windows_path(resolved):
        raise FakeMediaPackageError("fake media workspace must be a local directory")
    return resolved


def _safe_tool_root(tool_root: Path) -> Path:
    if not tool_root.is_absolute() or _is_remote_windows_path(tool_root):
        raise FakeMediaPackageError("media tool root must be an absolute local path")
    try:
        cursor = tool_root
        while cursor != cursor.parent:
            metadata = cursor.lstat()
            if cursor.is_symlink() or bool(
                getattr(metadata, "st_file_attributes", 0) & 0x400
            ):
                raise FakeMediaPackageError("media tool root cannot traverse a reparse point")
            cursor = cursor.parent
        resolved = tool_root.resolve(strict=True)
    except FakeMediaPackageError:
        raise
    except (OSError, RuntimeError):
        raise FakeMediaPackageError("media tool root is unavailable") from None
    if not resolved.is_dir() or _is_remote_windows_path(resolved):
        raise FakeMediaPackageError("media tool root must be a local directory")
    return resolved


def _require_internal_directory(path: Path, workspace_root: Path) -> None:
    try:
        metadata = path.lstat()
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise FakeMediaPackageError("fake media storage directory is unavailable") from None
    if (
        not resolved.is_dir()
        or not resolved.is_relative_to(workspace_root)
        or path.is_symlink()
        or bool(getattr(metadata, "st_file_attributes", 0) & 0x400)
    ):
        raise FakeMediaPackageError("fake media storage directory is unsafe")


def _require_plain_path(path: Path, *, parent: Path, kind: Literal["file", "directory"]) -> Path:
    try:
        metadata = path.lstat()
        resolved = path.resolve(strict=True)
        resolved_parent = parent.resolve(strict=True)
    except (OSError, RuntimeError):
        raise FakeMediaPackageError("fake media package path is unavailable") from None
    is_expected_kind = resolved.is_file() if kind == "file" else resolved.is_dir()
    if (
        not is_expected_kind
        or resolved.parent != resolved_parent
        or path.is_symlink()
        or bool(getattr(metadata, "st_file_attributes", 0) & 0x400)
    ):
        raise FakeMediaPackageError("fake media package contains an unsafe path")
    return resolved


def _flush_staging_tree(root: Path) -> None:
    try:
        for path in root.rglob("*"):
            if path.is_file():
                with path.open("r+b") as stream:
                    os.fsync(stream.fileno())
        if os.name != "nt":
            descriptor = os.open(root, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    except OSError:
        raise FakeMediaPackageError("fake media package could not be flushed") from None


def _publish_directory(staging_root: Path, final_root: Path) -> None:
    os.rename(staging_root, final_root)


@contextmanager
def _project_publish_lock(project_root: Path) -> Iterator[None]:
    lock_path = project_root / PROJECT_LOCK_NAME
    try:
        if lock_path.exists():
            _require_plain_path(lock_path, parent=project_root, kind="file")
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "r+b", closefd=True) as stream:
            if stream.seek(0, os.SEEK_END) == 0:
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            deadline = time.monotonic() + PROJECT_LOCK_TIMEOUT_SECONDS
            if os.name == "nt":
                import msvcrt

                while True:
                    try:
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise FakeMediaPackageError(
                                "fake media project publish lock timed out"
                            ) from None
                        time.sleep(0.05)
                try:
                    yield
                finally:
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                while True:
                    try:
                        fcntl.flock(  # type: ignore[attr-defined]
                            stream.fileno(),
                            fcntl.LOCK_EX  # type: ignore[attr-defined]
                            | fcntl.LOCK_NB,  # type: ignore[attr-defined]
                        )
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise FakeMediaPackageError(
                                "fake media project publish lock timed out"
                            ) from None
                        time.sleep(0.05)
                try:
                    yield
                finally:
                    fcntl.flock(  # type: ignore[attr-defined]
                        stream.fileno(), fcntl.LOCK_UN  # type: ignore[attr-defined]
                    )
    except FakeMediaPackageError:
        raise


def _windows_process_identity(pid: int) -> tuple[int, bool] | None:
    import ctypes
    from ctypes import wintypes

    process = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
    if not process:
        return None
    try:
        creation = wintypes.FILETIME()
        exit_time = wintypes.FILETIME()
        kernel = wintypes.FILETIME()
        user = wintypes.FILETIME()
        if not ctypes.windll.kernel32.GetProcessTimes(
            process,
            ctypes.byref(creation),
            ctypes.byref(exit_time),
            ctypes.byref(kernel),
            ctypes.byref(user),
        ):
            return None
        exit_code = ctypes.c_ulong()
        if not ctypes.windll.kernel32.GetExitCodeProcess(process, ctypes.byref(exit_code)):
            return None
        ticks = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
        return (ticks - 116_444_736_000_000_000) * 100, exit_code.value == 259
    finally:
        ctypes.windll.kernel32.CloseHandle(process)


def _current_process_started_at_ns() -> int:
    if os.name == "nt":
        identity = _windows_process_identity(os.getpid())
        if identity is None:
            raise FakeMediaPackageError("current process start time is unavailable")
        return identity[0]
    try:
        start_ticks = _parse_proc_start_ticks(
            Path(f"/proc/{os.getpid()}/stat").read_text(encoding="ascii")
        )
        boot_time_seconds = next(
            int(line.split()[1])
            for line in Path("/proc/stat").read_text(encoding="ascii").splitlines()
            if line.startswith("btime ")
        )
        clock_ticks = _clock_ticks_per_second()
        return int((boot_time_seconds + start_ticks / clock_ticks) * 1_000_000_000)
    except (OSError, RuntimeError, UnicodeError, ValueError, StopIteration, IndexError):
        raise FakeMediaPackageError("current process start time is unavailable") from None


def _process_is_active(pid: int, process_started_at_ns: int) -> bool:
    if os.name == "nt":
        try:
            identity = _windows_process_identity(pid)
            return (
                identity is not None
                and identity[1]
                and identity[0] == process_started_at_ns
            )
        except (AttributeError, OSError, OverflowError):
            return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        start_ticks = _parse_proc_start_ticks(
            Path(f"/proc/{pid}/stat").read_text(encoding="ascii")
        )
        boot_time_seconds = next(
            int(line.split()[1])
            for line in Path("/proc/stat").read_text(encoding="ascii").splitlines()
            if line.startswith("btime ")
        )
        clock_ticks = _clock_ticks_per_second()
        actual_started_at_ns = int(
            (boot_time_seconds + start_ticks / clock_ticks) * 1_000_000_000
        )
        return process_started_at_ns == actual_started_at_ns
    except (OSError, UnicodeError, ValueError, StopIteration, IndexError):
        return True


def _parse_proc_start_ticks(stat_payload: str) -> int:
    closing_parenthesis = stat_payload.rfind(")")
    if closing_parenthesis <= 0:
        raise ValueError("invalid proc stat process name")
    trailing_fields = stat_payload[closing_parenthesis + 1 :].strip().split()
    if len(trailing_fields) <= 19:
        raise ValueError("proc stat has no starttime field")
    start_ticks = int(trailing_fields[19])
    if start_ticks <= 0:
        raise ValueError("proc stat starttime must be positive")
    return start_ticks


def _clock_ticks_per_second() -> int:
    try:
        completed = subprocess.run(
            ["getconf", "CLK_TCK"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=2,
        )
        if len(completed.stdout) > 32:
            raise ValueError
        return int(completed.stdout.decode("ascii").strip())
    except (OSError, UnicodeError, ValueError, subprocess.SubprocessError):
        raise FakeMediaPackageError("POSIX clock ticks are unavailable") from None


def _write_staging_lease(staging_root: Path) -> Path:
    lease = _StagingLeaseV1(
        pid=os.getpid(),
        process_started_at_ns=_current_process_started_at_ns(),
        created_at_epoch_ns=time.time_ns(),
    )
    path = staging_root / STAGING_LEASE_NAME
    try:
        path.write_bytes(_canonical_json(lease.model_dump(mode="json")))
        with path.open("r+b") as stream:
            os.fsync(stream.fileno())
    except OSError:
        raise FakeMediaPackageError("fake media staging lease could not be written") from None
    return path


def _write_publish_lease(project_root: Path, staging_root: Path) -> Path:
    lease = _StagingLeaseV1(
        pid=os.getpid(),
        process_started_at_ns=_current_process_started_at_ns(),
        created_at_epoch_ns=time.time_ns(),
    )
    path = project_root / f"{staging_root.name}{PUBLISH_LEASE_SUFFIX}"
    try:
        path.write_bytes(_canonical_json(lease.model_dump(mode="json")))
        with path.open("r+b") as stream:
            os.fsync(stream.fileno())
    except OSError:
        raise FakeMediaPackageError("fake media publish lease could not be written") from None
    return path


def _read_active_lease(path: Path, parent: Path) -> _StagingLeaseV1 | None:
    if not path.exists():
        return None
    try:
        _require_plain_path(path, parent=parent, kind="file")
        raw = path.read_bytes()
        lease = _StagingLeaseV1.model_validate_json(raw)
        if raw != _canonical_json(lease.model_dump(mode="json")):
            return None
        return lease
    except (FakeMediaPackageError, OSError, ValidationError):
        return None


def _cleanup_stale_staging_in_lock(project_root: Path) -> None:
    now = time.time_ns()
    try:
        candidates = tuple(project_root.iterdir())
    except OSError:
        raise FakeMediaPackageError("fake media staging directory could not be inspected") from None
    for candidate in candidates:
        if candidate.name == PROJECT_LOCK_NAME:
            continue
        if candidate.name.endswith(PUBLISH_LEASE_SUFFIX):
            staging_name = candidate.name.removesuffix(PUBLISH_LEASE_SUFFIX)
            if not staging_name.startswith(STAGING_PREFIX):
                raise FakeMediaPackageError("fake media publish lease name is invalid")
            standalone_publish_lease = _read_active_lease(candidate, project_root)
            if standalone_publish_lease is not None and _process_is_active(
                standalone_publish_lease.pid,
                standalone_publish_lease.process_started_at_ns,
            ):
                continue
            try:
                candidate.unlink()
            except OSError:
                raise FakeMediaPackageError(
                    "stale fake media publish lease could not be cleaned"
                ) from None
            continue
        if not candidate.name.startswith(STAGING_PREFIX):
            continue
        resolved = _require_plain_path(candidate, parent=project_root, kind="directory")
        try:
            lease_path = resolved / STAGING_LEASE_NAME
            publish_lease_path = project_root / f"{candidate.name}{PUBLISH_LEASE_SUFFIX}"
            publish_lease = _read_active_lease(publish_lease_path, project_root)
            if publish_lease is not None and _process_is_active(
                publish_lease.pid, publish_lease.process_started_at_ns
            ):
                continue
            lease: _StagingLeaseV1 | None = None
            if lease_path.exists():
                _require_plain_path(lease_path, parent=resolved, kind="file")
                raw = lease_path.read_bytes()
                try:
                    candidate_lease = _StagingLeaseV1.model_validate_json(raw)
                    if raw == _canonical_json(candidate_lease.model_dump(mode="json")):
                        lease = candidate_lease
                except ValidationError:
                    lease = None
            if lease is not None and _process_is_active(
                lease.pid, lease.process_started_at_ns
            ):
                continue
            if lease is None:
                age_seconds = max(
                    0.0, (now - resolved.stat().st_mtime_ns) / 1_000_000_000
                )
                if age_seconds < STAGING_GRACE_SECONDS:
                    continue
            shutil.rmtree(resolved)
        except FakeMediaPackageError:
            raise
        except (OSError, RuntimeError, ValidationError):
            raise FakeMediaPackageError("stale fake media staging could not be cleaned") from None


def _run_ffmpeg(toolchain: MediaToolchain, arguments: list[str]) -> None:
    try:
        subprocess.run(
            [str(toolchain.ffmpeg_path), *arguments],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=GENERATION_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        raise FakeMediaPackageError("locked FFmpeg failed to generate Fake media") from None


def _shot_style(source_sha256: str, index: int) -> tuple[str, int]:
    digest = bytes.fromhex(source_sha256.removeprefix("sha256:"))
    offset = (index - 1) * 3
    channels = tuple(
        48 + (digest[(offset + channel) % len(digest)] + index * (29 + channel * 11)) % 176
        for channel in range(3)
    )
    color = "0x" + "".join(f"{channel:02x}" for channel in channels)
    frequency = 330 + index * 110 + digest[(offset + 9) % len(digest)] % 7 * 37
    return color, frequency


def _generate_shot(
    root: Path,
    source_sha256: str,
    index: int,
    toolchain: MediaToolchain,
) -> FakeShotMediaV1:
    shot_number = f"{index:02d}"
    shot_root = root / f"shot-{shot_number}"
    shot_root.mkdir()
    image = shot_root / "still.png"
    voice = shot_root / "scratch-voice.wav"
    video = shot_root / "preview.webm"
    color, frequency = _shot_style(source_sha256, index)
    common = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n"]

    _run_ffmpeg(
        toolchain,
        [
            *common,
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={WIDTH}x{HEIGHT}:r={FRAME_RATE}",
            "-frames:v",
            "1",
            "-c:v",
            "png",
            "-threads",
            "1",
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-map_metadata",
            "-1",
            str(image),
        ],
    )
    _run_ffmpeg(
        toolchain,
        [
            *common,
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={frequency}:sample_rate={AUDIO_SAMPLE_RATE}:duration={DURATION_SECONDS}",
            "-frames:a",
            str(AUDIO_SAMPLE_COUNT),
            "-c:a",
            "pcm_s16le",
            "-ar",
            str(AUDIO_SAMPLE_RATE),
            "-ac",
            "1",
            "-fflags",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            "-map_metadata",
            "-1",
            str(voice),
        ],
    )
    _run_ffmpeg(
        toolchain,
        [
            *common,
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={WIDTH}x{HEIGHT}:r={FRAME_RATE}:d={DURATION_SECONDS}",
            "-protocol_whitelist",
            "file",
            "-i",
            str(voice),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-frames:v",
            str(FRAME_COUNT),
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
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "libopus",
            "-ar",
            str(AUDIO_SAMPLE_RATE),
            "-ac",
            "1",
            "-threads",
            "1",
            "-shortest",
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            "-map_metadata",
            "-1",
            str(video),
        ],
    )

    def file_identity(path: Path) -> tuple[str, str, int]:
        sha256, byte_size = _file_hash(path)
        return path.relative_to(root).as_posix(), sha256, byte_size

    image_path, image_hash, image_size = file_identity(image)
    voice_path, voice_hash, voice_size = file_identity(voice)
    video_path, video_hash, video_size = file_identity(video)

    return FakeShotMediaV1(
        shot_id=f"fake-shot-{shot_number}",
        still_image=FakeStillImageFileV1(
            relative_path=image_path,
            sha256=image_hash,
            byte_size=image_size,
        ),
        scratch_voice=FakeScratchVoiceFileV1(
            relative_path=voice_path,
            sha256=voice_hash,
            byte_size=voice_size,
        ),
        preview_video=FakePreviewVideoFileV1(
            relative_path=video_path,
            sha256=video_hash,
            byte_size=video_size,
            frame_rate=SequenceFrameRateData(num=FRAME_RATE, den=1),
        ),
    )


def _validate_image(path: Path) -> None:
    try:
        payload = path.read_bytes()[:24]
    except OSError:
        raise FakeMediaPackageError("fake still image could not be read") from None
    if (
        len(payload) != 24
        or payload[:8] != b"\x89PNG\r\n\x1a\n"
        or int.from_bytes(payload[16:20], "big") != WIDTH
        or int.from_bytes(payload[20:24], "big") != HEIGHT
    ):
        raise FakeMediaPackageError("fake still image does not match its contract")


def _validate_voice(path: Path) -> None:
    try:
        with wave.open(str(path), "rb") as stream:
            if (
                stream.getnchannels() != 1
                or stream.getsampwidth() != 2
                or stream.getframerate() != AUDIO_SAMPLE_RATE
                or stream.getnframes() != AUDIO_SAMPLE_COUNT
                or stream.getcomptype() != "NONE"
            ):
                raise FakeMediaPackageError("fake scratch voice does not match its contract")
    except FakeMediaPackageError:
        raise
    except (OSError, EOFError, wave.Error):
        raise FakeMediaPackageError("fake scratch voice is invalid") from None


def _validate_video(path: Path, expected_hash: str, toolchain: MediaToolchain) -> None:
    try:
        probe = probe_local_media(path, toolchain)
    except MediaProbeError:
        raise FakeMediaPackageError("fake preview video is invalid") from None
    if (
        probe.source_asset_sha256 != expected_hash
        or probe.video.width != WIDTH
        or probe.video.height != HEIGHT
        or probe.video.is_variable_frame_rate
        or (probe.video.average_frame_rate.num, probe.video.average_frame_rate.den)
        != (FRAME_RATE, 1)
        or len(probe.video.frames) != FRAME_COUNT
        or probe.audio is None
        or probe.audio.sample_rate_hz != AUDIO_SAMPLE_RATE
        or probe.audio.total_samples != AUDIO_SAMPLE_COUNT
    ):
        raise FakeMediaPackageError("fake preview video does not match its contract")


def _verify_package(
    root: Path,
    expected: dict[str, object],
    toolchain: MediaToolchain,
    *,
    project_root: Path,
    allow_active_staging_lease: bool = False,
) -> GeneratedFakeMediaPackage:
    manifest_path = root / "manifest.json"
    try:
        resolved_root = _require_plain_path(root, parent=project_root, kind="directory")
        resolved_manifest = _require_plain_path(
            manifest_path, parent=resolved_root, kind="file"
        )
        if resolved_manifest.stat().st_size > MAX_MANIFEST_BYTES:
            raise FakeMediaPackageError("existing fake media package is invalid")
        raw = resolved_manifest.read_bytes()
        manifest = FakeMediaPackageV1.model_validate_json(raw)
        if raw != _canonical_json(manifest.model_dump(mode="json")):
            raise FakeMediaPackageError("existing fake media package is invalid")
        if any(getattr(manifest, key) != value for key, value in expected.items()):
            raise FakeMediaPackageError("existing fake media package is invalid")
        generated = GeneratedFakeMediaPackage(root=resolved_root, manifest=manifest)
        expected_root_names = {"manifest.json"}
        if allow_active_staging_lease:
            lease_path = _require_plain_path(
                resolved_root / STAGING_LEASE_NAME,
                parent=resolved_root,
                kind="file",
            )
            lease_raw = lease_path.read_bytes()
            lease = _StagingLeaseV1.model_validate_json(lease_raw)
            if (
                lease_raw != _canonical_json(lease.model_dump(mode="json"))
                or not _process_is_active(lease.pid, lease.process_started_at_ns)
            ):
                raise FakeMediaPackageError("fake media staging lease is invalid")
            expected_root_names.add(STAGING_LEASE_NAME)
        for shot in manifest.shots:
            shot_number = shot.shot_id.removeprefix("fake-shot-")
            shot_root = _require_plain_path(
                resolved_root / f"shot-{shot_number}",
                parent=resolved_root,
                kind="directory",
            )
            expected_root_names.add(shot_root.name)
            expected_shot_names: set[str] = set()
            for media in (shot.still_image, shot.scratch_voice, shot.preview_video):
                path = _require_plain_path(
                    resolved_root / media.relative_path,
                    parent=shot_root,
                    kind="file",
                )
                sha256, byte_size = _file_hash(path)
                if sha256 != media.sha256 or byte_size != media.byte_size:
                    raise FakeMediaPackageError("existing fake media package is invalid")
                expected_shot_names.add(path.name)
            if {path.name for path in shot_root.iterdir()} != expected_shot_names:
                raise FakeMediaPackageError("existing fake media package is invalid")
            _validate_image(generated.resolve(shot.still_image))
            _validate_voice(generated.resolve(shot.scratch_voice))
            _validate_video(
                generated.resolve(shot.preview_video), shot.preview_video.sha256, toolchain
            )
        if {path.name for path in resolved_root.iterdir()} != expected_root_names:
            raise FakeMediaPackageError("existing fake media package is invalid")
        return generated
    except FakeMediaPackageError:
        raise
    except (OSError, RuntimeError, UnicodeError, ValidationError, json.JSONDecodeError):
        raise FakeMediaPackageError("existing fake media package is invalid") from None


class FakeMediaPackageGenerator:
    """Generate and atomically publish one immutable package per frozen source/toolchain input."""

    def __init__(
        self,
        workspace_root: Path,
        toolchain: MediaToolchain,
        *,
        _construction_token: object | None = None,
    ) -> None:
        if _construction_token is not _LOCKED_CONSTRUCTION_TOKEN:
            raise FakeMediaPackageError("fake media generator requires a locked tool root")
        self._workspace_root = _safe_workspace_root(workspace_root)
        self._toolchain = toolchain
        self._tool_root = toolchain.ffmpeg_path.parent
        self._fault_hook: Callable[[str], None] = lambda _phase: None

    @classmethod
    def from_locked_tool_root(
        cls,
        workspace_root: Path,
        lock: MediaToolchainLockData,
        tool_root: Path,
        *,
        fault_hook: Callable[[str], None] | None = None,
    ) -> Self:
        resolved_tool_root = _safe_tool_root(tool_root)
        toolchain = discover_media_toolchain(lock, explicit_root=resolved_tool_root)
        if toolchain.distribution_status != "DEVELOPMENT_ONLY":
            raise FakeMediaPackageError(
                "Fake media generation is restricted to development evidence"
            )
        _require_toolchain_unchanged(toolchain, resolved_tool_root)
        generator = cls(
            workspace_root,
            toolchain,
            _construction_token=_LOCKED_CONSTRUCTION_TOKEN,
        )
        generator._tool_root = resolved_tool_root
        generator._fault_hook = fault_hook or (lambda _phase: None)
        return generator

    def materialize(
        self,
        *,
        project_id: str,
        source_document_id: str,
        source_sha256: str,
    ) -> GeneratedFakeMediaPackage:
        _require_toolchain_unchanged(self._toolchain, self._tool_root)
        try:
            frozen_request = FakeMediaPackageRequestV1(
                project_id=project_id,
                source_document_id=source_document_id,
                source_sha256=source_sha256,
                frame_rate=SequenceFrameRateData(num=FRAME_RATE, den=1),
                shots=tuple(
                    FakeShotRequestV1(shot_id=f"fake-shot-{index:02d}")
                    for index in range(1, SHOT_COUNT + 1)
                ),
            )
        except ValidationError:
            raise FakeMediaPackageError("fake media package identity is invalid") from None
        identity_payload = {
            "request": frozen_request.model_dump(mode="json"),
            "toolchain_profile_id": self._toolchain.profile_id,
            "toolchain_version": self._toolchain.version,
            "ffmpeg_sha256": f"sha256:{self._toolchain.ffmpeg_sha256}",
            "ffprobe_sha256": f"sha256:{self._toolchain.ffprobe_sha256}",
            "purpose": "DEVELOPMENT_EVIDENCE",
        }
        request_hash = _content_hash(identity_payload)
        package_id = f"fmp_{request_hash.removeprefix('sha256:')[:32]}"
        expected: dict[str, object] = {
            "package_id": package_id,
            "request_hash": request_hash,
            "project_id": frozen_request.project_id,
            "source_document_id": frozen_request.source_document_id,
            "source_sha256": frozen_request.source_sha256,
            "toolchain_profile_id": self._toolchain.profile_id,
            "toolchain_version": self._toolchain.version,
            "ffmpeg_sha256": identity_payload["ffmpeg_sha256"],
            "ffprobe_sha256": identity_payload["ffprobe_sha256"],
            "purpose": identity_payload["purpose"],
        }
        project_root = self._workspace_root / "fake-media" / "v1" / frozen_request.project_id
        final_root = project_root / package_id
        try:
            project_root.mkdir(parents=True, exist_ok=True)
            for internal in (
                self._workspace_root / "fake-media",
                self._workspace_root / "fake-media" / "v1",
                project_root,
            ):
                _require_internal_directory(internal, self._workspace_root)
            with _project_publish_lock(project_root):
                _cleanup_stale_staging_in_lock(project_root)
            if final_root.exists():
                result = _verify_package(
                    final_root, expected, self._toolchain, project_root=project_root
                )
                _require_toolchain_unchanged(self._toolchain, self._tool_root)
                return result
            with _GENERATION_SLOT:
                if final_root.exists():
                    result = _verify_package(
                        final_root, expected, self._toolchain, project_root=project_root
                    )
                    _require_toolchain_unchanged(self._toolchain, self._tool_root)
                    return result
                with tempfile.TemporaryDirectory(
                    prefix=STAGING_PREFIX, dir=project_root
                ) as tmp:
                    staging_root = Path(tmp)
                    staging_lease = _write_staging_lease(staging_root)
                    shots = tuple(
                        _generate_shot(
                            staging_root,
                            frozen_request.source_sha256,
                            index,
                            self._toolchain,
                        )
                        for index in range(1, SHOT_COUNT + 1)
                    )
                    self._fault_hook("shots_generated")
                    manifest = FakeMediaPackageV1(
                        package_id=package_id,
                        request_hash=request_hash,
                        project_id=frozen_request.project_id,
                        source_document_id=frozen_request.source_document_id,
                        source_sha256=frozen_request.source_sha256,
                        toolchain_profile_id=self._toolchain.profile_id,
                        toolchain_version=self._toolchain.version,
                        ffmpeg_sha256=str(identity_payload["ffmpeg_sha256"]),
                        ffprobe_sha256=str(identity_payload["ffprobe_sha256"]),
                        frame_rate=frozen_request.frame_rate,
                        shots=shots,
                    )
                    (staging_root / "manifest.json").write_bytes(
                        _canonical_json(manifest.model_dump(mode="json"))
                    )
                    _verify_package(
                        staging_root,
                        expected,
                        self._toolchain,
                        project_root=project_root,
                        allow_active_staging_lease=True,
                    )
                    _flush_staging_tree(staging_root)
                    self._fault_hook("before_publish")
                    self._fault_hook("lease_still_active")
                    with _project_publish_lock(project_root):
                        publish_lease = _write_publish_lease(project_root, staging_root)
                        staging_lease.unlink()
                        self._fault_hook("after_staging_lease_removed")
                        try:
                            _publish_directory(staging_root, final_root)
                        except OSError:
                            if not final_root.exists():
                                raise
                        finally:
                            try:
                                publish_lease.unlink()
                            except OSError:
                                if not final_root.exists():
                                    raise
                    self._fault_hook("after_publish")
                    result = _verify_package(
                        final_root, expected, self._toolchain, project_root=project_root
                    )
                    _require_toolchain_unchanged(self._toolchain, self._tool_root)
                    return result
        except FakeMediaPackageError:
            raise
        except (OSError, RuntimeError):
            raise FakeMediaPackageError("fake media package could not be published") from None
