"""Native-selected, per-machine media tools for probing and DRAFT work only.

The saved record is a path and pinned identity, never an executable approval.
Every status read and job admission revalidates the actual tool pair. Project
artifacts, portable backups and formal ProductExport do not consume this file.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from aijian_api.draft_export_toolchain import discover_draft_toolchain
from aijian_api.external_media_process import (
    PINNED_FFMPEG_SHA256,
    PINNED_FFPROBE_SHA256,
    PINNED_PROFILE_ID,
    PINNED_VERSION,
    guarded_external_pair,
    run_external_command,
)
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_probe import _open_local_source
from aijian_api.media_toolchain import (
    MediaToolchain,
    MediaToolchainError,
    MediaToolchainErrorCode,
    discover_media_toolchain,
    load_media_toolchain_lock,
)
from aijian_api.runtime_resources import PackagedResourceError, media_toolchain_lock_path

_MAX_SETTINGS_BYTES = 16 * 1024
_REQUIRED_FLAGS = frozenset({"--enable-static", "--enable-gpl", "--enable-libx264"})
MediaToolchainSource = Literal[
    "EXTERNAL",
    "BUNDLED",
    "DEVELOPMENT_OVERRIDE",
    "DEVELOPMENT_LOCAL",
    "NONE",
]


class LocalMediaToolchainStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    state: Literal["AVAILABLE", "NOT_CONFIGURED", "INVALID", "UNSUPPORTED"]
    source: MediaToolchainSource
    profile_id: str | None = None
    version: str | None = None
    directory: str | None = None
    diagnostic: str
    can_probe: bool = False
    can_preview: bool = False
    can_draft_export: bool = False
    formal_release_approved: Literal[False] = False


class _Selection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    directory: str = Field(min_length=1, max_length=4096)
    profile_id: Literal["windows-x86_64-gyan-full-8.1.2-dev"] = PINNED_PROFILE_ID
    ffmpeg_sha256: Literal["ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e"] = (
        PINNED_FFMPEG_SHA256
    )
    ffprobe_sha256: Literal["9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015"] = (
        PINNED_FFPROBE_SHA256
    )


def _frozen_override_guard() -> None:
    if getattr(sys, "frozen", False) and any(
        name in os.environ
        for name in ("AIJIAN_DRAFT_MEDIA_TOOL_ROOT", "AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK")
    ):
        raise MediaToolchainError(
            MediaToolchainErrorCode.LOCK_INVALID,
            "Packaged runtime rejects media environment overrides",
        )


def machine_settings_path() -> Path | None:
    """Obtain machine-local user storage from Windows, not a renderer or environment override."""
    if os.name != "nt":
        return None
    import ctypes

    buffer = ctypes.create_unicode_buffer(32768)
    shell32 = cast(
        ctypes.CDLL,
        ctypes.WinDLL("shell32", use_last_error=True),  # type: ignore[attr-defined]
    )
    get_folder = shell32.SHGetFolderPathW
    get_folder.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_wchar_p,
    ]
    get_folder.restype = ctypes.c_long
    # CSIDL_LOCAL_APPDATA; excludes roaming profile and portable workspace data.
    if get_folder(None, 0x001C, None, 0, buffer) != 0 or not buffer.value:
        raise OSError("Machine-local settings storage is unavailable")
    root = Path(buffer.value)
    if not root.is_absolute():
        raise OSError("Machine-local settings storage is invalid")
    return root / "Aivora" / "machine-settings" / "local-media-toolchain.json"


def verify_external_toolchain(directory: Path) -> MediaToolchain:
    """Only the packaged fixed profile may admit a selected pair, before any execution."""
    _frozen_override_guard()
    lock = load_media_toolchain_lock(media_toolchain_lock_path())
    profile = next((item for item in lock.profiles if item.profile_id == PINNED_PROFILE_ID), None)
    if (
        lock.expected_version != PINNED_VERSION
        or profile is None
        or profile.ffmpeg_sha256 != PINNED_FFMPEG_SHA256
        or profile.ffprobe_sha256 != PINNED_FFPROBE_SHA256
        or profile.distribution_status != "DEVELOPMENT_ONLY"
        or profile.license_class != "GPL"
        or profile.spdx_license != "GPL-3.0-or-later"
    ):
        raise MediaToolchainError(
            MediaToolchainErrorCode.LOCK_INVALID,
            "Supported external media profile does not match the installed lock",
        )
    try:
        with guarded_external_pair(directory):
            toolchain = discover_media_toolchain(
                lock.model_copy(update={"profiles": (profile,)}),
                explicit_root=directory,
                version_reader=lambda path: run_external_command(
                    path,
                    ("-version",),
                    10.0,
                    max_output_bytes=64 * 1024,
                ).decode("utf-8", errors="replace"),
            )
            if not _REQUIRED_FLAGS.issubset(toolchain.configuration_flags):
                raise MediaToolchainError(
                    MediaToolchainErrorCode.CONFIGURATION_MISMATCH,
                    "External profile needs its pinned static DRAFT build",
                )
            # Probe real feature lists instead of treating a saved path as readiness.
            encoders = run_external_command(
                toolchain.ffmpeg_path,
                ("-hide_banner", "-encoders"),
                10.0,
                max_output_bytes=256 * 1024,
            ).decode("utf-8")
            filters = run_external_command(
                toolchain.ffmpeg_path,
                ("-hide_banner", "-filters"),
                10.0,
                max_output_bytes=256 * 1024,
            ).decode("utf-8")
            encoder_names = {
                line.split()[1] for line in encoders.splitlines() if len(line.split()) >= 2
            }
            filter_names = {
                line.split()[1] for line in filters.splitlines() if len(line.split()) >= 2
            }
            if not {"libx264", "aac"}.issubset(encoder_names) or not {
                "drawtext",
                "trim",
                "atrim",
                "concat",
                "amix",
                "scale",
            }.issubset(filter_names):
                raise MediaToolchainError(
                    MediaToolchainErrorCode.CONFIGURATION_MISMATCH,
                    "External media tools lack required DRAFT capabilities",
                )
            return replace(toolchain, external_selected=True)
    except MediaToolchainError:
        raise
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError) as error:
        raise MediaToolchainError(
            MediaToolchainErrorCode.INVALID_TOOL_PAIR,
            "External media tools are unsafe, changed, or unavailable",
        ) from error


def _available(toolchain: MediaToolchain) -> LocalMediaToolchainStatus:
    source: MediaToolchainSource
    if toolchain.external_selected:
        source = "EXTERNAL"
    elif getattr(sys, "frozen", False):
        source = "BUNDLED"
    elif os.environ.get("AIJIAN_DRAFT_MEDIA_TOOL_ROOT") and os.environ.get(
        "AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK"
    ):
        source = "DEVELOPMENT_OVERRIDE"
    else:
        source = "DEVELOPMENT_LOCAL"
    return LocalMediaToolchainStatus(
        state="AVAILABLE",
        source=source,
        profile_id=toolchain.profile_id,
        version=toolchain.version,
        directory=str(toolchain.ffmpeg_path.parent),
        diagnostic="Verified local tools are available for probing, preview and DRAFT MP4 only.",
        can_probe=True,
        can_preview=True,
        can_draft_export=True,
    )


class LocalMediaToolchainService:
    def __init__(
        self,
        settings_path: Path | None,
        *,
        fallback: Callable[[], MediaToolchain] = discover_draft_toolchain,
        verifier: Callable[[Path], MediaToolchain] = verify_external_toolchain,
    ) -> None:
        self._path = settings_path
        self._fallback = fallback
        self._verifier = verifier
        self._lock = threading.RLock()

    def _read(self) -> _Selection | None:
        path = self._path
        if path is None:
            return None
        # lstat-based validation rejects links even when their targets are absent.
        if not path.parent.exists():
            return None
        io_path = managed_local_io_path(path.parent, path)
        if not io_path.exists():
            return None
        with _open_local_source(io_path) as source:
            data = source.read(_MAX_SETTINGS_BYTES + 1)
        if len(data) > _MAX_SETTINGS_BYTES:
            raise ValueError("External media selection exceeds its size limit")
        return _Selection.model_validate_json(data)

    def discover(self) -> MediaToolchain:
        _frozen_override_guard()
        with self._lock:
            try:
                selected = self._read()
            except (OSError, ValueError, ValidationError) as error:
                raise MediaToolchainError(
                    MediaToolchainErrorCode.LOCK_INVALID,
                    "Saved external media selection is invalid",
                ) from error
        # Snapshot the selected identity per operation; later settings changes do
        # not change the already admitted tool paths used by a running job.
        return self._verifier(Path(selected.directory)) if selected else self._fallback()

    def status(self) -> LocalMediaToolchainStatus:
        with self._lock:
            try:
                _frozen_override_guard()
            except MediaToolchainError:
                return LocalMediaToolchainStatus(
                    state="INVALID",
                    source="NONE",
                    diagnostic="Packaged runtime rejects media environment overrides.",
                )
            try:
                selected = self._read()
            except (OSError, ValueError, ValidationError):
                return LocalMediaToolchainStatus(
                    state="INVALID",
                    source="EXTERNAL",
                    diagnostic="Saved external media selection is invalid. Remove or select again.",
                )
            try:
                return _available(self.discover())
            except (MediaToolchainError, PackagedResourceError, OSError, ValueError):
                return LocalMediaToolchainStatus(
                    state="INVALID"
                    if selected
                    else ("UNSUPPORTED" if self._path is None else "NOT_CONFIGURED"),
                    source="EXTERNAL" if selected else "NONE",
                    diagnostic=(
                        "Selected tools are missing, changed or unsafe. Select the exact pinned "
                        "Windows FFmpeg 8.1.2 full-build pair again."
                        if selected
                        else "No verified local tools. Select the supported Windows "
                        "FFmpeg 8.1.2 full-build bin directory to enable DRAFT media work."
                    ),
                )

    def select(self, directory: str) -> LocalMediaToolchainStatus:
        if self._path is None:
            return LocalMediaToolchainStatus(
                state="UNSUPPORTED",
                source="NONE",
                diagnostic="External selection requires Windows.",
            )
        with self._lock:
            try:
                _frozen_override_guard()
                if not directory or any(ord(character) < 32 for character in directory):
                    raise ValueError("Invalid directory")
                toolchain = self._verifier(Path(directory))
                if not toolchain.external_selected:
                    raise ValueError("External admission was not verified")
                selected = _Selection(directory=str(toolchain.ffmpeg_path.parent))
            except (MediaToolchainError, PackagedResourceError, OSError, ValueError):
                return LocalMediaToolchainStatus(
                    state="INVALID",
                    source="EXTERNAL",
                    diagnostic="Selection rejected. Choose the exact supported local Windows "
                    "FFmpeg 8.1.2 full-build bin directory. Previous selection was not changed.",
                )
            # A persistence failure is an unknown mutation result at the transport
            # boundary, never a fabricated AVAILABLE result or automatic retry.
            self._write(selected)
            return _available(toolchain)

    def _write(self, selection: _Selection) -> None:
        assert self._path is not None
        path = self._path
        missing: list[Path] = []
        directory = path.parent
        while not directory.exists():
            missing.append(directory)
            directory = directory.parent
        managed_local_io_path(directory, directory)
        for item in reversed(missing):
            item.mkdir(mode=0o700)
            managed_local_io_path(item, item)
        target = managed_local_io_path(path.parent, path)
        temporary = path.parent / f".media-selection-{secrets.token_hex(16)}.tmp"
        temporary_io = managed_local_io_path(path.parent, temporary)
        try:
            with temporary_io.open("xb") as output:
                output.write(selection.model_dump_json().encode("utf-8"))
                output.flush()
                os.fsync(output.fileno())
            managed_local_io_path(path.parent, path)
            os.replace(temporary_io, target)
        finally:
            temporary_io.unlink(missing_ok=True)

    def clear(self) -> LocalMediaToolchainStatus:
        with self._lock:
            if self._path is not None and self._path.parent.exists():
                path = managed_local_io_path(self._path.parent, self._path)
                path.unlink(missing_ok=True)
            return self.status()
