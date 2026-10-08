"""Download or verify pinned Windows build inputs; never execute or release them."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
LOCK = Path(__file__).parent / "build-toolchain/downloads.lock.json"
OFFICIAL_HOSTS = {
    "github.com",
    "releases.astral.sh",
    "nodejs.org",
    "files.pythonhosted.org",
    "www.gyan.dev",
}


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def plain_path(path: Path) -> Path:
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("Use an absolute path without parent traversal")
    for part in (path, *path.parents):
        if part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError(f"Links or junctions are not allowed: {part}")
    return path


def safe_relative(value: str) -> Path:
    relative = PurePosixPath(value)
    if (
        not value
        or relative.is_absolute()
        or "\\" in value
        or ":" in value
        or any(part in {"", ".", ".."} for part in value.split("/"))
    ):
        raise ValueError(f"Unsafe relative path: {value}")
    return Path(*relative.parts)


def validate_lock(lock: dict) -> None:
    if (
        lock.get("schema_version") != 1
        or lock.get("target") != "win32-x64"
        or lock.get("release_approved") is not False
        or lock.get("purpose") != "development-build-prerequisites-only"
    ):
        raise ValueError("Expected an unapproved Windows development prerequisite lock")
    seen = set()
    for item in lock["downloads"]:
        key = safe_relative(item["path"]).as_posix().casefold()
        url = urllib.parse.urlsplit(item["url"])
        if key in seen or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("Duplicate target or invalid SHA256")
        if (
            url.scheme != "https"
            or url.hostname not in OFFICIAL_HOSTS
            or url.username
            or url.password
            or url.port not in {None, 443}
        ):
            raise ValueError(f"Expected an official HTTPS source: {item['url']}")
        seen.add(key)


def verify_source_locks(lock: dict) -> None:
    for name, expected in lock["source_locks"].items():
        path = ROOT / safe_relative(name)
        if digest(plain_path(path)) != expected:
            raise ValueError(f"Source lock changed; regenerate prerequisites: {name}")


def fetch(item: dict, cache: Path, *, offline: bool) -> dict:
    target = plain_path(cache / safe_relative(item["path"]))
    if target.exists():
        if not target.is_file() or digest(target) != item["sha256"]:
            raise ValueError(f"Existing cache entry differs from pinned SHA256: {target}")
    elif offline:
        raise FileNotFoundError(f"Missing offline input: {target}")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".partial")
        # Exclusive creation refuses stale or overlapping downloads instead of overwriting them.
        created = False
        try:
            with temporary.open("xb") as output:
                created = True
                request = urllib.request.Request(
                    item["url"], headers={"User-Agent": "AIVORA-build/0.1"}
                )
                with urllib.request.urlopen(request, timeout=120) as response:
                    if urllib.parse.urlsplit(response.url).scheme != "https":
                        raise ValueError("Download redirected away from HTTPS")
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        except BaseException:
            if created:
                temporary.unlink(missing_ok=True)
            raise
        if digest(temporary) != item["sha256"]:
            temporary.unlink()
            raise ValueError(f"Downloaded SHA256 does not match: {item['id']}")
        temporary.rename(target)
    return {"path": item["path"], "sha256": digest(target), "bytes": target.stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument(
        "--offline", action="store_true", help="Verify only; never access the network"
    )
    args = parser.parse_args()
    cache = plain_path(args.cache)
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    validate_lock(lock)
    verify_source_locks(lock)
    cache.mkdir(parents=True, exist_ok=True)
    verified = []
    for item in lock["downloads"]:
        verified.append(fetch(item, cache, offline=args.offline))
        print(f"VERIFIED {item['id']} {item['version']}", flush=True)
    receipt = {
        "schema_version": 1,
        "result": "PREREQUISITES_VERIFIED",
        "target": "win32-x64",
        "lock_sha256": digest(LOCK),
        "files": verified,
        "windows_execution": "NOT_RUN",
        "installer": "NOT_BUILT",
        "release_approved": False,
    }
    receipt_path = cache / "PREREQUISITES-VERIFIED.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"RECEIPT={receipt_path}")


if __name__ == "__main__":
    main()
