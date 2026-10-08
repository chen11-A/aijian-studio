"""Prepare verified tools for Windows development-core packaging, never media CLIs."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def helpers():
    spec = importlib.util.spec_from_file_location(
        "prerequisites", HERE / "prepare-prerequisites.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_archive_name(name: str) -> bool:
    return (
        bool(name)
        and not name.startswith(("/", "\\"))
        and "\\" not in name
        and ":" not in name
        and not any(part in {"", ".", ".."} for part in name.rstrip("/").split("/"))
    )


def extract_tar(source: Path, target: Path) -> None:
    with tarfile.open(source) as archive:
        for item in archive.getmembers():
            if not safe_archive_name(item.name) or not (item.isfile() or item.isdir()):
                raise ValueError("Unsafe member in fixed tool archive")
        archive.extractall(target, filter="data")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--tools", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Tool preparation/extraction must run on the authorized Windows runner")
    helper = helpers()
    cache = helper.plain_path(args.cache)
    target = helper.plain_path(args.tools)
    if target.exists():
        parser.error("--tools must be a new absolute directory")
    lock = json.loads(helper.LOCK.read_text())
    helper.validate_lock(lock)
    helper.verify_source_locks(lock)
    # Node comes from the workflow's pinned official setup-node action. No GPL
    # development encoder or Linux helper is needed by this media-free package.
    inputs = [
        item
        for item in lock["downloads"]
        if item["id"]
        not in {
            "ffmpeg-development",
            "7zip-linux-x64",
            "node",
            "nsis-resources",
        }
    ]
    verified = [helper.fetch(item, cache, offline=False) for item in inputs]
    by_id = {item["id"]: cache / item["path"] for item in inputs}
    target.mkdir(parents=True)
    extract_tar(by_id["python"], target / "cpython")
    extract_tar(by_id["7zip-win-x64"], target / "sevenzip")
    sevenzip = target / "sevenzip/7zip/bin/7za.exe"
    for name in ("nsis", "winCodeSign"):
        destination = target / name
        subprocess.run(
            [str(sevenzip), "x", str(by_id[name]), "-o" + str(destination), "-y"], check=True
        )
    with zipfile.ZipFile(by_id["electron"]) as archive:
        if any(not safe_archive_name(name) for name in archive.namelist()):
            raise ValueError("Unsafe Electron archive member")
        archive.extractall(target / "electron")
    # Seed builder's verified archive-cache layout as a second line of defense;
    # explicit tool paths below prevent platform fallback or implicit tool selection.
    builder_cache = target / "builder-cache"
    for key, release in (
        ("nsis", "nsis-3.0.4.1"),
        ("winCodeSign", "winCodeSign-2.6.0"),
        ("7zip-win-x64", "7zip@1.0.0"),
    ):
        destination = builder_cache / release / by_id[key].name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(by_id[key], destination)
    result = {
        "schema_version": 1,
        "kind": "development-core-build-tools",
        "python": str(target / "cpython/python/python.exe"),
        "electron": str(target / "electron"),
        "cache": str(cache),
        "files": verified,
        "environment": {
            "ELECTRON_BUILDER_7ZIP_PATH": str(sevenzip),
            "ELECTRON_BUILDER_NSIS_DIR": str(target / "nsis"),
            "ELECTRON_BUILDER_RCEDIT_PATH": str(target / "winCodeSign"),
            "ELECTRON_BUILDER_CACHE": str(builder_cache),
            "CSC_IDENTITY_AUTO_DISCOVERY": "false",
        },
        "media_cli_included": False,
        "release_approved": False,
    }
    (target / "DEV-TOOLS.json").write_text(json.dumps(result, indent=2) + "\n")
    print("DEV_TOOLS=" + str(target / "DEV-TOOLS.json"))


if __name__ == "__main__":
    main()
