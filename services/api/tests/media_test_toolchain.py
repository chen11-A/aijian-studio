"""Exact host-specific tools for synthetic tests, never production admission."""

import sys
from pathlib import Path

from aijian_api.media_toolchain import discover_media_toolchain, load_media_toolchain_lock

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_media_lock():
    filename = (
        "media-toolchain-lock.json"
        if sys.platform == "win32"
        else "draft-media-toolchain-linux-dev-lock.json"
    )
    return load_media_toolchain_lock(REPOSITORY_ROOT / "config" / filename)


def test_media_tools():
    return discover_media_toolchain(
        test_media_lock(),
        explicit_root=None if sys.platform == "win32" else Path("/usr/bin"),
    )
