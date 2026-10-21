"""Silent-install the integrated Windows build, smoke the shell, then uninstall.

This is separate from test-installed-dev-core.py. That test is locked to the
media-free development branch and must keep refusing bundled ffmpeg.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DELIVERY_LIMIT = 800 * 1024 * 1024


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--delivery", type=Path, required=True)
    args = parser.parse_args()
    if (
        sys.platform != "win32"
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "chen11-A/aijian-studio"
    ):
        parser.error("Integrated install smoke runs only on this repository's Windows runner")
    install = Path(os.environ["RUNNER_TEMP"]) / "AivoraIntegratedInstall"
    user_data = Path(os.environ["APPDATA"]) / "AIVORA Dev Core"
    if install.exists() or user_data.exists() or args.delivery.exists():
        raise ValueError("Refusing existing install, profile, or delivery data")
    installers = list((args.stage / "installer-output").glob("AIVORA-Dev-Core-*-win-x64.exe"))
    if len(installers) != 1:
        raise ValueError("Expected exactly one integrated NSIS installer")
    installer = installers[0]
    subprocess.run([str(installer), "/S", "/D=" + str(install)], check=True, timeout=180)
    executable = install / "AIVORA Dev Core.exe"
    if not executable.is_file():
        raise ValueError("Silent install did not produce AIVORA Dev Core.exe")
    report = args.evidence / "INTEGRATED-SMOKE.json"
    subprocess.run(
        [
            "node",
            str(ROOT / "scripts/e2e/windows-integrated-smoke.mjs"),
            "--exe",
            str(executable),
            "--report",
            str(report),
        ],
        cwd=ROOT,
        check=True,
        timeout=240,
    )
    database = user_data / "workspace/workspace.sqlite3"
    if not database.is_file():
        raise ValueError("Smoke did not leave a local workspace database")
    before = digest(database)
    retained = install / "user-created-keep.txt"
    retained.write_text("保留工作区之外的用户文件。", encoding="utf-8")
    uninstallers = list(install.glob("Uninstall*.exe"))
    if len(uninstallers) != 1:
        raise ValueError("Expected one uninstaller")
    subprocess.run([str(uninstallers[0]), "/S"], check=True, timeout=180)
    deadline = time.monotonic() + 30
    while executable.exists() and time.monotonic() < deadline:
        time.sleep(0.2)
    if executable.exists() or not database.is_file() or digest(database) != before or not retained.is_file():
        raise ValueError("Uninstall removed the app incompletely or changed the workspace")
    result = {
        "schema_version": 1,
        "result": "PASS",
        "profile": "INTEGRATED_DESKTOP",
        "candidate_head": os.environ.get("GITHUB_SHA"),
        "installer_name": installer.name,
        "installer_sha256": digest(installer),
        "installer_bytes": installer.stat().st_size,
        "silent_install": "PASS",
        "health_and_window": "PASS",
        "uninstall_app_removed": "PASS",
        "uninstall_workspace_preserved": "PASS",
        "signed": False,
        "smartscreen": "UNSIGNED_PUBLISHER_WARNING_EXPECTED",
    }
    (args.evidence / "INTEGRATED-INSTALL-RESULT.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    args.delivery.mkdir(parents=True)
    shutil.copy2(installer, args.delivery / "AIVORA-Setup-win-x64.exe")
    guide = ROOT / "docs" / "首次使用.md"
    if guide.is_file():
        shutil.copy2(guide, args.delivery / "首次使用.md")
    for source in args.evidence.iterdir():
        if source.is_file() and source.suffix in {".json", ".png"}:
            shutil.copy2(source, args.delivery / source.name)
    (args.delivery / "SHA256SUMS").write_text(
        "\n".join(f"{digest(path)}  {path.name}" for path in sorted(args.delivery.iterdir())) + "\n",
        encoding="utf-8",
    )
    if sum(path.stat().st_size for path in args.delivery.iterdir()) > DELIVERY_LIMIT:
        raise ValueError("Integrated delivery exceeds 800 MiB")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
