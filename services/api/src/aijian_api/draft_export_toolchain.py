"""Explicit development-only override, never consumed by formal release exports."""

import os
import sys
from pathlib import Path

from aijian_api.media_toolchain import (
    MediaToolchain,
    MediaToolchainError,
    MediaToolchainErrorCode,
    discover_media_toolchain,
    load_media_toolchain_lock,
)
from aijian_api.runtime_resources import media_tool_root, media_toolchain_lock_path


def discover_draft_toolchain() -> MediaToolchain:
    root = os.environ.get("AIJIAN_DRAFT_MEDIA_TOOL_ROOT")
    lock_path = os.environ.get("AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK")
    if root is not None or lock_path is not None:
        if getattr(sys, "frozen", False) or not root or not lock_path:
            raise MediaToolchainError(
                MediaToolchainErrorCode.LOCK_INVALID,
                "Draft tool overrides require an unfrozen development runtime and an explicit pair",
            )
        if not Path(root).is_absolute() or not Path(lock_path).is_absolute():
            raise MediaToolchainError(
                MediaToolchainErrorCode.LOCK_INVALID,
                "Draft tool override must be absolute",
            )
        lock = load_media_toolchain_lock(Path(lock_path))
        if any(profile.distribution_status != "DEVELOPMENT_ONLY" for profile in lock.profiles):
            raise MediaToolchainError(
                MediaToolchainErrorCode.LOCK_INVALID,
                "Draft override must be development-only",
            )
        return discover_media_toolchain(lock, explicit_root=Path(root))
    return discover_media_toolchain(
        load_media_toolchain_lock(media_toolchain_lock_path()),
        explicit_root=media_tool_root(),
    )
