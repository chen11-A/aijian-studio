"""Isolated MLT subprocess runner for pinned synthetic engineering jobs.

The runner never launches a preview consumer or grants a product export claim.
Its input is a server-authored XML/profile pair plus exact file identities.
"""

from __future__ import annotations

import hashlib
import math
import os
import queue
import re
import stat
import subprocess
import threading
import time
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal

from aijian_api.episode_media_execution_plan import ART04_MLT_TEST_SPEC_SHA256
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_execution_plan_contracts import MediaExecutionPlanV1
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source
from aijian_api.media_toolchain import (
    MediaToolchain,
    MediaToolchainError,
    load_media_toolchain_lock,
)
from aijian_api.product_export_output_verify import VerifiedProductOutput, verify_local_mp4
from aijian_api.product_timeline_export_contracts import ProductExportSpec

# The v7.40.0 melt source writes this line to stderr for -progress2.
# Source: https://github.com/mltframework/mlt/blob/v7.40.0/src/melt/melt.c
_PROGRESS = re.compile(rb"^Current Frame:\s*([0-9]+), percentage:\s*([0-9]+)\s*$")
_HEX = re.compile(r"[0-9a-f]{64}\Z")
MAX_MLT_SECONDS = 3600.0
MAX_LOG_BYTES = 64 * 1024
MAX_RESOURCE_BYTES = 20 * 1024 * 1024 * 1024


class MltExecutionError(RuntimeError):
    def __init__(
        self, code: str, message: str, *, exit_code: int | None = None,
        log_excerpt: bytes = b"", log_sha256: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code
        self.log_excerpt = log_excerpt
        self.log_sha256 = log_sha256


@dataclass(frozen=True, slots=True)
class MltFileIdentity:
    path: Path
    sha256: str


@dataclass(frozen=True, slots=True)
class MltEngineeringRuntime:
    """REL02-reviewed local candidate; no bundled Windows binary exists yet."""

    installation_root: Path
    melt: MltFileIdentity
    module_directory: Path
    runtime_files: tuple[MltFileIdentity, ...]
    expected_version: str
    scope: Literal["ENGINEERING_TEST_ONLY"] = "ENGINEERING_TEST_ONLY"


@dataclass(frozen=True, slots=True)
class MltExecutionTask:
    operation_id: str
    plan: MediaExecutionPlanV1
    execution_plan_hash: str
    assembly_artifact_id: str | None
    assembly_version_id: str | None
    assembly_content_hash: str | None
    xml: MltFileIdentity
    profile: MltFileIdentity
    resources: tuple[MltFileIdentity, ...]
    fixture_manifest: MltFileIdentity
    qa_origin_files: tuple[MltFileIdentity, ...]
    generation_lock: MltFileIdentity
    generation_ffmpeg: MltFileIdentity
    generation_ffprobe: MltFileIdentity
    temporary_output: Path
    total_frames: int
    spec: ProductExportSpec
    expect_audio: bool
    scope: Literal["ENGINEERING_TEST"] = "ENGINEERING_TEST"


@dataclass(frozen=True, slots=True)
class MltExecutionEvidence:
    scope: Literal["ENGINEERING_TEST"]
    operation_id: str
    execution_plan_hash: str
    test_spec_sha256: str
    fixture_manifest_sha256: str
    project_id: str
    episode_id: str
    assembly_artifact_id: str | None
    assembly_version_id: str | None
    assembly_content_hash: str | None
    melt_sha256: str
    melt_version: str
    version_output_sha256: str
    services_output_sha256: str
    runtime_manifest_sha256: str
    generation_lock_sha256: str
    verifier_ffmpeg_sha256: str
    verifier_ffprobe_sha256: str
    exit_code: int
    elapsed_seconds: float
    maximum_progress_frame: int
    log_sha256: str
    log_excerpt: bytes
    temporary_output: VerifiedProductOutput


def _plain_directory(path: Path) -> bool:
    try:
        junction_check = getattr(path, "is_junction", None)
        return (
            path.is_absolute() and not _is_remote_windows_path(path)
            and path.is_dir() and not path.is_symlink()
            and not (junction_check() if junction_check is not None else False)
            and path.resolve(strict=True) == path
        )
    except (OSError, RuntimeError):
        return False


def _managed_directory(path: Path) -> bool:
    try:
        io_path = managed_local_io_path(path, path)
        return (
            io_path.is_dir() and not io_path.is_symlink()
            and io_path.resolve(strict=True) == io_path
        )
    except (OSError, RuntimeError, ValueError):
        return False


def _hold_verified_file(
    stack: ExitStack, identity: MltFileIdentity, *, managed: bool = False,
) -> BinaryIO:
    path = identity.path
    try:
        io_path = managed_local_io_path(path.parent, path) if managed else path
    except (OSError, ValueError):
        raise MltExecutionError("RESOURCE_UNSAFE", "MLT file identity has an unsafe path") from None
    if (
        _HEX.fullmatch(identity.sha256) is None
        or not path.is_absolute() or _is_remote_windows_path(path)
        or not (_managed_directory(path.parent) if managed else _plain_directory(path.parent))
        or io_path.is_symlink()
    ):
        raise MltExecutionError("RESOURCE_UNSAFE", "MLT file identity has an unsafe path")
    try:
        stream = stack.enter_context(_open_local_source(io_path))
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_RESOURCE_BYTES:
            raise MltExecutionError("RESOURCE_SIZE", "MLT resource size is invalid")
        digest = hashlib.sha256()
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
        if digest.hexdigest() != identity.sha256:
            raise MltExecutionError("RESOURCE_CHANGED", "MLT resource hash differs")
        after = os.fstat(stream.fileno())
        current = io_path.stat()
        if (
            before.st_dev != after.st_dev or before.st_ino != after.st_ino
            or before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns
            or before.st_dev != current.st_dev or before.st_ino != current.st_ino
            or before.st_size != current.st_size or before.st_mtime_ns != current.st_mtime_ns
        ):
            raise MltExecutionError("RESOURCE_CHANGED", "MLT resource changed while hashing")
        stream.seek(0)
        return stream
    except MltExecutionError:
        raise
    except OSError:
        raise MltExecutionError("RESOURCE_UNAVAILABLE", "MLT resource is unavailable") from None


def _verify_open_files(
    identities: tuple[tuple[MltFileIdentity, BinaryIO], ...],
    managed_paths: frozenset[Path],
) -> None:
    for identity, stream in identities:
        try:
            opened = os.fstat(stream.fileno())
            path = (
                managed_local_io_path(identity.path.parent, identity.path)
                if identity.path in managed_paths else identity.path
            )
            current = path.stat()
        except (OSError, ValueError):
            raise MltExecutionError("RESOURCE_CHANGED", "MLT resource disappeared") from None
        if (
            opened.st_dev != current.st_dev or opened.st_ino != current.st_ino
            or opened.st_size != current.st_size
            or opened.st_mtime_ns != current.st_mtime_ns
        ):
            raise MltExecutionError("RESOURCE_CHANGED", "MLT resource changed during execution")


def _stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=2.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2.0)
    except OSError:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=2.0)


def _validate_task(task: MltExecutionTask, runtime: MltEngineeringRuntime) -> None:
    plan = task.plan
    try:
        temporary_io = managed_local_io_path(
            task.temporary_output.parent, task.temporary_output,
        )
    except (OSError, ValueError):
        raise MltExecutionError("PLAN_OR_TOOLCHAIN_INVALID", "MLT task output path is unsafe") from None
    if (
        task.scope != "ENGINEERING_TEST" or runtime.scope != "ENGINEERING_TEST_ONLY"
        or not isinstance(plan, MediaExecutionPlanV1)
        or plan.scope != "ENGINEERING_TEST"
        or plan.source.origin != "FROZEN_ENGINEERING_TEST"
        or plan.source.test_spec_sha256 != ART04_MLT_TEST_SPEC_SHA256
        or task.fixture_manifest.sha256 != plan.source.fixture_manifest_sha256
        or len(task.qa_origin_files) != 5
        or task.execution_plan_hash != plan.content_hash
        or task.assembly_artifact_id is not None
        or task.assembly_version_id is not None
        or task.assembly_content_hash is not None
        or task.total_frames != plan.total_frames
        or (task.spec.width, task.spec.height, task.spec.frame_rate_num,
            task.spec.frame_rate_den, task.spec.video_codec, task.spec.audio_codec)
        != (1080, 1920, 25, 1, "H264", "AAC")
        or not task.expect_audio
        or re.fullmatch(r"eteop_[0-9a-f]{32}", task.operation_id) is None
        or not task.execution_plan_hash.startswith("sha256:")
        or _HEX.fullmatch(task.execution_plan_hash.removeprefix("sha256:")) is None
        or task.total_frames <= 0 or task.total_frames > 1_000_000
        or task.temporary_output.suffix.lower() != ".mp4"
        or not _managed_directory(task.temporary_output.parent)
        or temporary_io.exists() or temporary_io.is_symlink()
        or not _plain_directory(runtime.module_directory)
        or not _plain_directory(runtime.melt.path.parent)
        or not _plain_directory(runtime.installation_root)
        or not runtime.melt.path.is_relative_to(runtime.installation_root)
        or not runtime.module_directory.is_relative_to(runtime.installation_root)
        or not runtime.runtime_files
        or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", runtime.expected_version)
    ):
        raise MltExecutionError("PLAN_OR_TOOLCHAIN_INVALID", "MLT task or approved runtime is invalid")


def _verify_verifier_toolchain(task: MltExecutionTask, verifier: MediaToolchain) -> None:
    if (
        task.generation_ffmpeg.path != verifier.ffmpeg_path
        or task.generation_ffmpeg.sha256 != verifier.ffmpeg_sha256
        or task.generation_ffprobe.path != verifier.ffprobe_path
        or task.generation_ffprobe.sha256 != verifier.ffprobe_sha256
        or verifier.distribution_status != "DEVELOPMENT_ONLY"
    ):
        raise MltExecutionError("VERIFIER_TOOLCHAIN_MISMATCH", "Verifier differs from QA generation lock")
    try:
        lock = load_media_toolchain_lock(task.generation_lock.path)
    except MediaToolchainError:
        raise MltExecutionError("VERIFIER_LOCK_INVALID", "QA generation tool lock is invalid") from None
    if lock.expected_version != verifier.version or not any(
        profile.profile_id == verifier.profile_id
        and profile.ffmpeg_sha256 == verifier.ffmpeg_sha256
        and profile.ffprobe_sha256 == verifier.ffprobe_sha256
        and profile.license_class == verifier.license_class
        and profile.distribution_status == verifier.distribution_status
        for profile in lock.profiles
    ):
        raise MltExecutionError("VERIFIER_LOCK_MISMATCH", "Verifier does not match the pinned QA lock")


def _verify_runtime_inventory(runtime: MltEngineeringRuntime) -> None:
    """Pin the whole installation, including Qt plugins and repository modules."""
    roots = (runtime.installation_root,)
    expected = {runtime.melt.path, *(item.path for item in runtime.runtime_files)}
    if len(expected) != len(runtime.runtime_files) + 1:
        raise MltExecutionError("RUNTIME_MANIFEST_INVALID", "MLT runtime manifest repeats a path")
    observed: set[Path] = set()
    try:
        for root in roots:
            if not _plain_directory(root):
                raise MltExecutionError("RUNTIME_UNAVAILABLE", "MLT runtime root changed")
            for path in root.rglob("*"):
                if path.is_symlink():
                    raise MltExecutionError("RUNTIME_UNLISTED_FILE", "MLT runtime contains a link")
                if path.is_dir():
                    if not _plain_directory(path):
                        raise MltExecutionError("RUNTIME_UNLISTED_FILE", "MLT runtime contains an unsafe directory")
                elif path.is_file():
                    observed.add(path)
                else:
                    raise MltExecutionError("RUNTIME_UNLISTED_FILE", "MLT runtime contains an unsafe entry")
    except OSError:
        raise MltExecutionError("RUNTIME_UNAVAILABLE", "MLT runtime directory cannot be listed") from None
    if observed != expected:
        raise MltExecutionError("RUNTIME_UNLISTED_FILE", "MLT runtime differs from its complete file manifest")


def _verify_runtime_services(runtime: MltEngineeringRuntime, environment: dict[str, str]) -> str:
    """Require the exact MLT services used by the generated TEST project."""
    try:
        result = subprocess.run(
            [str(runtime.melt.path), "-repository", str(runtime.module_directory), "-query"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            shell=False, env=environment, cwd=runtime.melt.path.parent,
            timeout=10.0, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise MltExecutionError("MLT_SERVICE_QUERY_FAILED", "MLT service query did not finish") from None
    output = result.stdout
    sections: dict[str, set[str]] = {}
    section: str | None = None
    for line in output.decode("utf-8", errors="replace").splitlines():
        if line in {"consumers:", "filters:", "producers:", "transitions:"}:
            section = line[:-1]
            sections[section] = set()
        elif line == "...":
            section = None
        elif section is not None and line.startswith(" - "):
            sections[section].add(line[3:])
    required = {
        "consumers": {"avformat"},
        "filters": {"qtext", "affine"},
        "producers": {"avformat", "xml"},
        "transitions": {"luma", "mix", "affine"},
    }
    if result.returncode != 0 or any(
        not needed.issubset(sections.get(kind, set())) for kind, needed in required.items()
    ):
        raise MltExecutionError(
            "MLT_SERVICE_UNAVAILABLE", "Pinned MLT runtime lacks a required TEST service",
            exit_code=result.returncode, log_excerpt=output[:MAX_LOG_BYTES],
            log_sha256=hashlib.sha256(output).hexdigest(),
        )
    return hashlib.sha256(output).hexdigest()


def _revalidate_selection(
    task: MltExecutionTask,
    callback: Callable[[MediaExecutionPlanV1, tuple[MltFileIdentity, ...]], object],
) -> None:
    """Validate the callback's runtime result without relaxing its public None contract."""
    if not callable(callback):
        raise MltExecutionError(
            "SELECTION_REVALIDATION_MISSING", "Selected media requires a current authority check",
        )
    try:
        result = callback(task.plan, task.resources)
    except Exception:
        raise MltExecutionError(
            "SELECTION_REVALIDATION_FAILED", "Selected media authority changed or is unavailable",
        ) from None
    if result is not None:
        raise MltExecutionError(
            "SELECTION_REVALIDATION_FAILED", "Selected media authority check returned invalid status",
        )


def run_mlt_engineering_task(
    task: MltExecutionTask,
    runtime: MltEngineeringRuntime,
    verifier_toolchain: MediaToolchain,
    *,
    on_progress: Callable[[int], None],
    stop_requested: Callable[[], bool],
    revalidate_selection: Callable[[MediaExecutionPlanV1, tuple[MltFileIdentity, ...]], None],
    timeout_seconds: float = MAX_MLT_SECONDS,
) -> MltExecutionEvidence:
    """Run exactly once, verify MP4, and return a test-only in-memory receipt."""
    if (
        isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int | float)
        or not math.isfinite(timeout_seconds)
        or not 0 < timeout_seconds <= MAX_MLT_SECONDS
    ):
        raise MltExecutionError("INVALID_TIMEOUT", "MLT timeout is invalid")
    _validate_task(task, runtime)
    test_spec_sha256 = task.plan.source.test_spec_sha256
    fixture_manifest_sha256 = task.plan.source.fixture_manifest_sha256
    if test_spec_sha256 is None or fixture_manifest_sha256 is None:
        raise MltExecutionError("PLAN_OR_TOOLCHAIN_INVALID", "Frozen test provenance is missing")
    _verify_runtime_inventory(runtime)
    start = time.monotonic()
    identities = (
        runtime.melt, *runtime.runtime_files, task.xml, task.profile,
        *task.resources, task.fixture_manifest, *task.qa_origin_files,
        task.generation_lock,
        task.generation_ffmpeg, task.generation_ffprobe,
    )
    managed_paths = frozenset(item.path for item in (
        task.xml, task.profile, *task.resources,
        task.fixture_manifest, *task.qa_origin_files,
    ))
    tool_paths = (
        runtime.melt, *runtime.runtime_files,
        task.generation_lock, task.generation_ffmpeg, task.generation_ffprobe,
    )
    if {str(path).casefold() for path in managed_paths} & {
        str(item.path).casefold() for item in tool_paths
    }:
        raise MltExecutionError("DUPLICATE_RESOURCE", "A managed TEST file overlaps a tool path")
    unique: dict[str, MltFileIdentity] = {}
    for item in identities:
        key = str(item.path).casefold()
        if key in unique and unique[key].sha256 != item.sha256:
            raise MltExecutionError("DUPLICATE_RESOURCE", "One MLT path has conflicting hashes")
        unique[key] = item
    with ExitStack() as stack:
        held = tuple(
            (item, _hold_verified_file(stack, item, managed=item.path in managed_paths))
            for item in unique.values()
        )
        _verify_verifier_toolchain(task, verifier_toolchain)
        # MLT uses -profile for the requested rational output profile and an
        # explicit avformat consumer for headless encoding.
        # Sources: https://www.mltframework.org/docs/profiles/
        #          https://www.mltframework.org/docs/headlessmacos/
        #          https://www.mltframework.org/docs/melt/
        command = [
            str(runtime.melt.path), "-progress2", "-repository",
            str(runtime.module_directory), "-profile", str(task.profile.path),
            f"xml:{task.xml.path}", "-consumer",
            f"avformat:{task.temporary_output}", "vcodec=libx264",
            "acodec=aac" if task.expect_audio else "an=1",
            "pix_fmt=yuv420p", "ar=48000", "channels=2",
        ]
        system_root = os.environ.get("SYSTEMROOT", r"C:\Windows")
        environment = {
            "SYSTEMROOT": system_root,
            "WINDIR": os.environ.get("WINDIR", system_root),
            "PATH": os.pathsep.join((
                str(runtime.melt.path.parent),
                str(Path(system_root) / "System32"), system_root,
            )),
        }
        for key in ("TEMP", "TMP", "COMSPEC", "PATHEXT"):
            if key in os.environ:
                environment[key] = os.environ[key]
        if stop_requested():
            raise MltExecutionError("CANCELLED", "MLT job was cancelled before launch")
        try:
            version_result = subprocess.run(
                [str(runtime.melt.path), "-version"], stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=False,
                env=environment, cwd=runtime.melt.path.parent, timeout=5.0,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise MltExecutionError("MLT_VERSION_UNAVAILABLE", "MLT version probe failed") from None
        version_output = version_result.stdout[:MAX_LOG_BYTES]
        if (
            version_result.returncode != 0
            or re.search(
                rb"\b" + re.escape(runtime.expected_version.encode("ascii")) + rb"\b",
                version_output,
            ) is None
        ):
            raise MltExecutionError(
                "MLT_VERSION_MISMATCH", "MLT binary version differs from its manifest",
                exit_code=version_result.returncode, log_excerpt=version_output,
                log_sha256=hashlib.sha256(version_result.stdout).hexdigest(),
            )
        _verify_open_files(held, managed_paths)
        if stop_requested():
            raise MltExecutionError("CANCELLED", "MLT job was cancelled before render")
        services_output_sha256 = _verify_runtime_services(runtime, environment)
        _verify_open_files(held, managed_paths)
        _verify_runtime_inventory(runtime)
        if stop_requested():
            raise MltExecutionError("CANCELLED", "MLT job was cancelled before render")
        if time.monotonic() - start >= timeout_seconds:
            raise MltExecutionError("TIMEOUT", "MLT job timed out before render")
        _revalidate_selection(task, revalidate_selection)
        _verify_open_files(held, managed_paths)
        if stop_requested():
            raise MltExecutionError("CANCELLED", "MLT job was cancelled before render")
        if time.monotonic() - start >= timeout_seconds:
            raise MltExecutionError("TIMEOUT", "MLT job timed out before render")
        try:
            process = subprocess.Popen(
                command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, shell=False, env=environment,
                cwd=runtime.melt.path.parent,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError:
            raise MltExecutionError("MLT_LAUNCH_FAILED", "Approved MLT executable could not start") from None
        if process.stdout is None:
            _stop(process)
            raise MltExecutionError("MLT_PIPE_UNAVAILABLE", "MLT output pipe is unavailable")
        progress: queue.Queue[int] = queue.Queue(maxsize=64)
        log_digest = hashlib.sha256()
        log_excerpt = bytearray()

        def read_output() -> None:
            assert process.stdout is not None
            while chunk := process.stdout.readline(4096):
                log_digest.update(chunk)
                remaining = MAX_LOG_BYTES - len(log_excerpt)
                if remaining > 0:
                    log_excerpt.extend(chunk[:remaining])
                match = _PROGRESS.fullmatch(chunk.strip())
                if match is not None:
                    frame = int(match.group(1))
                    if 0 <= frame <= task.total_frames:
                        try:
                            progress.put_nowait(frame)
                        except queue.Full:
                            pass

        reader = threading.Thread(target=read_output, name="aijian-mlt-output", daemon=True)
        reader.start()
        maximum = 0
        interruption: str | None = None
        try:
            while process.poll() is None:
                if stop_requested():
                    _stop(process)
                    interruption = "CANCELLED"
                    break
                if time.monotonic() - start >= timeout_seconds:
                    _stop(process)
                    interruption = "TIMEOUT"
                    break
                try:
                    frame = progress.get(timeout=0.1)
                except queue.Empty:
                    continue
                if frame > maximum:
                    maximum = frame
                    on_progress(frame)
            reader.join(timeout=2.0)
            if reader.is_alive():
                raise MltExecutionError("MLT_PIPE_STALLED", "MLT output reader did not finish")
            last_reported = maximum
            while not progress.empty():
                maximum = max(maximum, progress.get_nowait())
            if maximum > last_reported:
                on_progress(maximum)
            if interruption is not None:
                raise MltExecutionError(
                    interruption, "MLT execution was interrupted",
                    exit_code=process.returncode, log_excerpt=bytes(log_excerpt),
                    log_sha256=log_digest.hexdigest(),
                )
            if process.returncode != 0:
                raise MltExecutionError(
                    "MLT_EXIT_NONZERO", "MLT exited unsuccessfully",
                    exit_code=process.returncode, log_excerpt=bytes(log_excerpt),
                    log_sha256=log_digest.hexdigest(),
                )
            if stop_requested():
                raise MltExecutionError(
                    "CANCELLED", "MLT job was cancelled after render",
                    exit_code=process.returncode, log_excerpt=bytes(log_excerpt),
                    log_sha256=log_digest.hexdigest(),
                )
            _verify_open_files(held, managed_paths)
            _verify_runtime_inventory(runtime)
            verified = verify_local_mp4(
                task.temporary_output.parent, task.temporary_output.name,
                task.spec, task.total_frames, verifier_toolchain,
                expect_audio=task.expect_audio,
            )
            if stop_requested():
                raise MltExecutionError(
                    "CANCELLED", "MLT job was cancelled during output verification",
                    exit_code=process.returncode, log_excerpt=bytes(log_excerpt),
                    log_sha256=log_digest.hexdigest(),
                )
            return MltExecutionEvidence(
                scope="ENGINEERING_TEST", operation_id=task.operation_id,
                execution_plan_hash=task.execution_plan_hash,
                test_spec_sha256=test_spec_sha256,
                fixture_manifest_sha256=fixture_manifest_sha256,
                project_id=task.plan.source.project_id, episode_id=task.plan.source.episode_id,
                assembly_artifact_id=task.assembly_artifact_id,
                assembly_version_id=task.assembly_version_id,
                assembly_content_hash=task.assembly_content_hash,
                melt_sha256=runtime.melt.sha256,
                melt_version=runtime.expected_version,
                version_output_sha256=hashlib.sha256(version_result.stdout).hexdigest(),
                services_output_sha256=services_output_sha256,
                runtime_manifest_sha256=hashlib.sha256(
                    "\n".join(sorted(
                        f"{item.path}|{item.sha256}" for item in
                        (runtime.melt, *runtime.runtime_files)
                    )).encode("utf-8")
                ).hexdigest(),
                generation_lock_sha256=task.generation_lock.sha256,
                verifier_ffmpeg_sha256=verifier_toolchain.ffmpeg_sha256,
                verifier_ffprobe_sha256=verifier_toolchain.ffprobe_sha256,
                exit_code=0,
                elapsed_seconds=time.monotonic() - start,
                maximum_progress_frame=maximum,
                log_sha256=log_digest.hexdigest(), log_excerpt=bytes(log_excerpt),
                temporary_output=verified,
            )
        except BaseException:
            _stop(process)
            reader.join(timeout=2.0)
            raise
