"""Prepare exact development-only FFmpeg tools for quality CI, not packaging."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from importlib import import_module
from pathlib import Path
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from aijian_api.media_toolchain import MediaToolchain

ROOT = Path(__file__).resolve().parents[1]
WINDOWS_ARCHIVE_URL = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-full_build.7z"
# The publisher lists this release as its official mirror with the same SHA-256.
WINDOWS_ARCHIVE_MIRROR_URL = (
    "https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-full_build.7z"
)
WINDOWS_ARCHIVE_SHA256 = "0fff188997a499b5382e0f66e845d4556c48c54f0113ebed4853d556dbdd7059"
WINDOWS_ARCHIVE_ROOT = "ffmpeg-8.1.2-full_build"
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
DOWNLOAD_ATTEMPTS = 3
RETRYABLE_HTTP_STATUSES = {408, 429, 500, 502, 503, 504}


def verify_archive(path: Path) -> None:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("CI media archive does not match the pinned bytes")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != WINDOWS_ARCHIVE_SHA256:
        raise ValueError("CI media archive does not match the pinned bytes")


def transient_download_error(error: Exception) -> bool:
    if isinstance(error, urllib.error.HTTPError):
        return error.code in RETRYABLE_HTTP_STATUSES
    if isinstance(error, urllib.error.URLError):
        return isinstance(error.reason, (TimeoutError, ConnectionError))
    return isinstance(error, (TimeoutError, ConnectionError, http.client.IncompleteRead))


def download_archive(path: Path) -> None:
    if path.exists() or path.is_symlink():
        verify_archive(path)
        return
    for attempt in range(DOWNLOAD_ATTEMPTS):
        # Retry transient origin outages at the publisher's fixed mirror. Neither
        # authorization errors nor integrity failures permit a source switch.
        url = WINDOWS_ARCHIVE_URL if attempt == 0 else WINDOWS_ARCHIVE_MIRROR_URL
        request = urllib.request.Request(url, headers={"User-Agent": "AIVORA-CI"})
        # Keep incomplete bytes out of the cache. Validation failures retain the
        # unique staging file for diagnosis; transport failures can safely retry.
        staging: Path | None = None
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if not response.url.startswith("https://"):
                    raise ValueError("CI media download redirected away from HTTPS")
                with tempfile.NamedTemporaryFile(
                    prefix=f".{path.name}.download-", dir=path.parent, delete=False
                ) as output:
                    staging = Path(output.name)
                    count = 0
                    while chunk := response.read(1024 * 1024):
                        count += len(chunk)
                        if count > MAX_ARCHIVE_BYTES:
                            raise ValueError("CI media download exceeds its size limit")
                        output.write(chunk)
            verify_archive(staging)
            if path.exists() or path.is_symlink():
                verify_archive(path)
                staging.unlink()
            else:
                staging.replace(path)
            return
        except Exception as error:
            if not transient_download_error(error):
                raise
            if staging is not None:
                staging.unlink(missing_ok=True)
            if attempt + 1 == DOWNLOAD_ATTEMPTS:
                raise
            print(
                f"Transient CI media download failure; retry {attempt + 2}/{DOWNLOAD_ATTEMPTS}",
                file=sys.stderr,
            )
            time.sleep(2 ** (attempt + 1))


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


def verify_tools(root: Path, *, windows: bool) -> MediaToolchain:
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
    return cast("MediaToolchain", module.discover_media_toolchain(lock, explicit_root=root))


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
