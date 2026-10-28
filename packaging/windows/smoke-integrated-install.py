"""Silent-install the integrated Windows build to a custom /D directory, smoke, uninstall.

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
    user_data = Path(os.environ["APPDATA"]) / "AIVORA"
    legacy_user_data = Path(os.environ["APPDATA"]) / "AIVORA Dev Core"
    if (
        install.exists()
        or user_data.exists()
        or legacy_user_data.exists()
        or args.delivery.exists()
    ):
        raise ValueError("Refusing existing install, profile, or delivery data")
    installers = list((args.stage / "installer-output").glob("AIVORA-Setup-*-win-x64.exe"))
    if len(installers) != 1 or installers[0].name != "AIVORA-Setup-0.3.0-win-x64.exe":
        raise ValueError("Expected AIVORA-Setup-0.3.0-win-x64.exe")
    installer = installers[0]
    if "Dev Core" in installer.name or "0.1.0-dev" in installer.name:
        raise ValueError("Shipped installer name still uses a development label")
    subprocess.run([str(installer), "/S", "/D=" + str(install)], check=True, timeout=180)
    executable = install / "AIVORA.exe"
    if not executable.is_file() or executable.parent != install:
        raise ValueError("Silent /D install did not produce AIVORA.exe in the requested directory")
    import winreg

    uninstall_key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AIVORA"
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, uninstall_key) as key:
        location, _kind = winreg.QueryValueEx(key, "InstallLocation")
    if Path(location) != install:
        raise ValueError(f"HKCU install location is {location}, not the per-user directory")
    try:
        winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, uninstall_key)
    except FileNotFoundError:
        pass
    else:
        raise ValueError("Installer wrote an HKLM uninstall key")
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
    if (
        executable.exists()
        or not database.is_file()
        or digest(database) != before
        or not retained.is_file()
    ):
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
        "silent_directory_switch": "/D",
        "executable_name": "AIVORA.exe",
        "display_name": "AIVORA",
        "display_version": "0.3.0",
        "user_data_directory": "AIVORA",
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
    shutil.copy2(installer, args.delivery / installer.name)
    guide = ROOT / "docs" / "首次使用.md"
    if guide.is_file():
        shutil.copy2(guide, args.delivery / "首次使用.md")
    for source in args.evidence.iterdir():
        if source.is_file() and source.suffix in {".json", ".png"}:
            shutil.copy2(source, args.delivery / source.name)
    (args.delivery / "SHA256SUMS").write_text(
        "\n".join(f"{digest(path)}  {path.name}" for path in sorted(args.delivery.iterdir()))
        + "\n",
        encoding="utf-8",
    )
    if sum(path.stat().st_size for path in args.delivery.iterdir()) > DELIVERY_LIMIT:
        raise ValueError("Integrated delivery exceeds 800 MiB")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
