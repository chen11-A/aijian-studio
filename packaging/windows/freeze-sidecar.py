"""Freeze the real Windows sidecar offline, without touching release approvals."""

from __future__ import annotations

import argparse
import importlib.util
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load_prerequisite_helpers():
    spec = importlib.util.spec_from_file_location(
        "prerequisites", HERE / "prepare-prerequisites.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_host() -> None:
    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError(
            "Freeze on Windows x64. PyInstaller on Linux cannot produce this runtime."
        )
    if sys.version_info[:3] != (3, 12, 13):
        raise RuntimeError("Use the pinned Windows CPython 3.12.13 build interpreter.")


def source_inventory(helpers) -> dict[str, str]:
    files = [
        *sorted((ROOT / "services/api/src/aijian_api").rglob("*.py")),
        HERE / "sidecar-entry.py",
        HERE / "aijian-sidecar.spec",
    ]
    return {p.relative_to(ROOT).as_posix(): helpers.digest(helpers.plain_path(p)) for p in files}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument(
        "--output", required=True, type=Path, help="New absolute directory outside checkout"
    )
    args = parser.parse_args()
    validate_host()
    helpers = load_prerequisite_helpers()
    cache = helpers.plain_path(args.cache)
    output = helpers.plain_path(args.output)
    if output.exists() or output == ROOT or ROOT in output.parents:
        raise ValueError("Output must be new and outside the source checkout")
    lock = json.loads(helpers.LOCK.read_text(encoding="utf-8"))
    helpers.validate_lock(lock)
    helpers.verify_source_locks(lock)
    for item in lock["downloads"]:
        if item["path"].startswith("wheels/"):
            helpers.fetch(item, cache, offline=True)
    sources = source_inventory(helpers)
    output.mkdir(parents=True)
    environment = output / "build-env"
    subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True)
    python = environment / "Scripts/python.exe"
    subprocess.run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-index",
            "--find-links",
            str(cache / "wheels"),
            "--require-hashes",
            "--only-binary=:all:",
            "-r",
            str(HERE / "build-toolchain/sidecar-requirements-win-x64.txt"),
        ],
        check=True,
    )
    subprocess.run([str(python), "-m", "pip", "check"], check=True)
    resources = output / "resources"
    subprocess.run(
        [
            str(python),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath",
            str(resources),
            "--workpath",
            str(output / "pyinstaller-work"),
            str(HERE / "aijian-sidecar.spec"),
        ],
        cwd=ROOT,
        check=True,
    )
    executable = resources / "sidecar/aijian-sidecar.exe"
    with executable.open("rb") as stream:
        if stream.read(2) != b"MZ":
            raise RuntimeError("Frozen sidecar is not a Windows executable")
    if source_inventory(helpers) != sources:
        raise RuntimeError(
            "Source changed during freezing; keep output for diagnosis, do not stage it"
        )
    (resources / "config").mkdir()
    shutil.copy2(ROOT / "config/media-toolchain-lock.json", resources / "config")
    # No FFmpeg binary is copied here: the existing media distribution gate remains unchanged.
    receipt = {
        "schema_version": 1,
        "result": "FROZEN_COMPONENT_ONLY",
        "target": "win32-x64",
        "python": platform.python_version(),
        "pyinstaller": "6.22.3",
        "prerequisites_lock_sha256": helpers.digest(helpers.LOCK),
        "sources": sources,
        "files": {
            p.relative_to(resources).as_posix(): helpers.digest(p)
            for p in sorted(resources.rglob("*"))
            if p.is_file()
        },
        "native_smoke": "NOT_RUN",
        "installer": "NOT_BUILT",
        "release_approved": False,
    }
    receipt_path = output / "FROZEN-SIDECAR.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"SIDECAR={executable}")
    print(f"RECEIPT={receipt_path}")
    print("Next: run smoke-frozen-sidecar.py. This is not release or installer approval.")


if __name__ == "__main__":
    main()
