"""Prepare exact development-only FFmpeg tools for quality CI, not packaging."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.request
from importlib import import_module
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WINDOWS_ARCHIVE_URL = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-full_build.7z"
WINDOWS_ARCHIVE_SHA256 = "0fff188997a499b5382e0f66e845d4556c48c54f0113ebed4853d556dbdd7059"
WINDOWS_ARCHIVE_ROOT = "ffmpeg-8.1.2-full_build"
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024


def verify_archive(path: Path) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("CI media archive does not match the pinned bytes")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != WINDOWS_ARCHIVE_SHA256:
        raise ValueError("CI media archive does not match the pinned bytes")


def download_archive(path: Path) -> None:
    if path.exists():
        verify_archive(path)
        return
    request = urllib.request.Request(WINDOWS_ARCHIVE_URL, headers={"User-Agent": "AIVORA-CI"})
    # Exclusive output preserves failed downloads for diagnosis and refuses a
    # blind retry over them. No caller-provided URL or unpinned version exists.
    with urllib.request.urlopen(request, timeout=120) as response, path.open("xb") as output:
        if not response.url.startswith("https://"):
            raise ValueError("CI media download redirected away from HTTPS")
        count = 0
        while chunk := response.read(1024 * 1024):
            count += len(chunk)
            if count > MAX_ARCHIVE_BYTES:
                raise ValueError("CI media download exceeds its size limit")
            output.write(chunk)
    verify_archive(path)


def prepare_windows(root: Path, extractor: Path) -> Path:
    if not root.is_absolute() or root.is_symlink() or root.is_junction():
        raise ValueError("CI tools require an absolute plain directory")
    root.mkdir(parents=True, exist_ok=True)
    archive = root / "ffmpeg.7z"
    download_archive(archive)
    destination = root / WINDOWS_ARCHIVE_ROOT / "bin"
    if not destination.exists():
        if not extractor.is_file():
            raise ValueError("The Windows runner's 7-Zip executable is missing")
        subprocess.run(
            [
                str(extractor),
                "x",
                str(archive),
                f"-o{root}",
                "-y",
                "-bd",
                "-bb0",
                f"{WINDOWS_ARCHIVE_ROOT}/bin/ffmpeg.exe",
                f"{WINDOWS_ARCHIVE_ROOT}/bin/ffprobe.exe",
            ],
            check=True,
            timeout=300,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    return destination


def verify_tools(root: Path, *, windows: bool):
    source_root = str(ROOT / "services/api/src")
    if source_root not in sys.path:
        sys.path.insert(0, source_root)
    module = import_module("aijian_api.media_toolchain")
    filename = (
        "media-toolchain-lock.json" if windows else "draft-media-toolchain-linux-dev-lock.json"
    )
    lock = module.load_media_toolchain_lock(ROOT / "config" / filename)
    if any(profile.distribution_status != "DEVELOPMENT_ONLY" for profile in lock.profiles):
        raise ValueError("CI preparation cannot authorize distribution")
    # Production discovery hashes both files BEFORE executing either -version.
    return module.discover_media_toolchain(lock, explicit_root=root)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    windows = sys.platform == "win32"
    root = args.root
    if not args.verify_only:
        if not windows:
            raise ValueError("Install the pinned Debian package before Linux verification")
        root = prepare_windows(root, Path("C:/Program Files/7-Zip/7z.exe"))
    tools = verify_tools(root, windows=windows)
    print(
        json.dumps(
            {
                "root": str(root),
                "profile": tools.profile_id,
                "version": tools.version,
                "usage": "DEVELOPMENT_ONLY",
            }
        )
    )


if __name__ == "__main__":
    main()
