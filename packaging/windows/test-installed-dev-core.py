"""Fresh ephemeral Windows CI install, native smoke, abort-on-reinstall and uninstall."""

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
        or os.environ.get("GITHUB_REF") != "refs/heads/codex/windows-installer-dev-20261008"
    ):
        parser.error("This installer test is restricted to its authorized ephemeral CI branch")
    install = Path(os.environ["RUNNER_TEMP"]) / "AivoraDevCoreInstall"
    user_data = Path(os.environ["APPDATA"]) / "AIVORA Dev Core"
    if install.exists() or user_data.exists() or args.delivery.exists():
        raise ValueError("Refusing existing install/profile/delivery data")
    installers = list((args.stage / "installer-output").glob("AIVORA-Dev-Core-*-win-x64.exe"))
    if len(installers) != 1:
        raise ValueError("Expected exactly one bounded NSIS artifact")
    installer = installers[0]
    subprocess.run([str(installer), "/S", "/D=" + str(install)], check=True, timeout=120)
    executable = install / "AIVORA Dev Core.exe"
    if not executable.is_file():
        raise ValueError("Installer returned without the expected installed executable")
    subprocess.run(
        [
            "node",
            str(ROOT / "scripts/e2e/windows-dev-core-smoke.mjs"),
            "--exe",
            str(executable),
            "--manifest",
            str(args.evidence / "DEV-CORE-INPUTS.json"),
            "--report",
            str(args.evidence / "INSTALLED-NATIVE-SMOKE.json"),
        ],
        cwd=ROOT,
        check=True,
        timeout=240,
    )
    database = user_data / "workspace/workspace.sqlite3"
    before = (digest(executable), digest(database))
    retained = install / "user-created-keep.txt"
    retained_text = "Synthetic file outside the program manifest must survive uninstall."
    retained.write_text(retained_text)
    # The same development installer must refuse recognized installation/data;
    # this is a fail-closed test, not an implementation of safe upgrade.
    reinstall = subprocess.run([str(installer), "/S", "/D=" + str(install)], timeout=60)
    if reinstall.returncode == 0 or (digest(executable), digest(database)) != before:
        raise ValueError("Reinstallation did not stop before changing existing app/data")
    uninstallers = list(install.glob("Uninstall*.exe"))
    if len(uninstallers) != 1:
        raise ValueError("Expected one generated development uninstaller")
    subprocess.run([str(uninstallers[0]), "/S"], check=True, timeout=120)
    deadline = time.monotonic() + 30
    while executable.exists() and time.monotonic() < deadline:
        time.sleep(0.2)
    if (
        executable.exists()
        or not database.is_file()
        or digest(database) != before[1]
        or not retained.is_file()
        or retained.read_text() != retained_text
    ):
        raise ValueError("Uninstall failed to remove app or preserve synthetic workspace bytes")
    result = {
        "schema_version": 1,
        "result": "PASS",
        "profile": "DEVELOPMENT_CORE",
        "candidate_head": os.environ["GITHUB_SHA"],
        "installer_sha256": digest(installer),
        "installer_bytes": installer.stat().st_size,
        "fresh_install": "PASS",
        "installed_native_create_save_reopen": "PASS",
        "reinstall_existing_data": "SAFELY_ABORTED",
        "uninstall_app_removed": "PASS",
        "uninstall_workspace_preserved": "PASS",
        "uninstall_unknown_user_file_preserved": "PASS",
        "standard_user_clean_machine_acceptance": "NOT_ESTABLISHED",
        "upgrade_restore": "NOT_IMPLEMENTED",
        "media_encode": "UNAVAILABLE",
        "signing": "NOT_PERFORMED",
        "release_approved": False,
    }
    (args.evidence / "INSTALL-RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
    args.delivery.mkdir(parents=True)
    shutil.copy2(installer, args.delivery / installer.name)
    for source in args.evidence.iterdir():
        if source.is_file() and source.suffix in {".json", ".png"}:
            shutil.copy2(source, args.delivery / source.name)
    shutil.copy2(ROOT / "packaging/windows/DEVELOPMENT-CORE.md", args.delivery / "READ-ME.md")
    (args.delivery / "SHA256SUMS").write_text(
        "\n".join(f"{digest(path)}  {path.name}" for path in sorted(args.delivery.iterdir())) + "\n"
    )
    if sum(path.stat().st_size for path in args.delivery.iterdir()) > 260 * 1024**2:
        raise ValueError("Delivery exceeds bounded artifact size; do not upload")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
