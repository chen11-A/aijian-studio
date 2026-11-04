"""Resolve bundled resources from the installed sidecar, never its working directory."""

from __future__ import annotations

import os
import sys
from pathlib import Path

RESOURCE_ROOT_ENV = "AIJIAN_RESOURCE_ROOT"
_SIDECAR_EXE = "aijian-sidecar.exe"
_MEDIA_LOCK = Path("config") / "media-toolchain-lock.json"


class PackagedResourceError(RuntimeError):
    """The installed sidecar cannot safely use its declared resource tree."""


def _is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def media_toolchain_lock_path() -> Path:
    """Use source checkout only in development; bind packaged lookup to its executable."""
    configured = os.environ.get(RESOURCE_ROOT_ENV)
    frozen = bool(getattr(sys, "frozen", False))
    if not frozen:
        if configured is not None:
            raise PackagedResourceError("resource root override requires the packaged sidecar")
        return Path.cwd() / _MEDIA_LOCK
    if os.name != "nt" or not configured:
        raise PackagedResourceError("packaged sidecar resource root is missing")
    raw_root = Path(configured)
    if not raw_root.is_absolute() or _is_link(raw_root):
        raise PackagedResourceError("packaged sidecar resource root is unsafe")
    try:
        root = raw_root.resolve(strict=True)
        executable = Path(sys.executable).resolve(strict=True)
        sidecar_directory = root / "sidecar"
        config_directory = root / "config"
        lock_path = config_directory / _MEDIA_LOCK.name
        if (
            not root.is_dir()
            or _is_link(sidecar_directory)
            or _is_link(config_directory)
            or _is_link(lock_path)
            or executable != sidecar_directory / _SIDECAR_EXE
            or not lock_path.is_file()
            or lock_path.resolve(strict=True).parent != config_directory
        ):
            raise PackagedResourceError("packaged sidecar resources do not match the executable")
        return lock_path
    except (OSError, ValueError) as error:
        raise PackagedResourceError("packaged sidecar resources are unavailable") from error


def media_tool_root() -> Path | None:
    """Ignore PATH in a packaged app; only an approved bundled pair may be discovered."""
    if not bool(getattr(sys, "frozen", False)):
        return None
    media_directory = media_toolchain_lock_path().parent.parent / "media"
    if media_directory.exists() and (not media_directory.is_dir() or _is_link(media_directory)):
        raise PackagedResourceError("packaged media tool directory is unsafe")
    return media_directory
