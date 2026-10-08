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


def external_media_phase(args, executable: Path) -> dict | None:
    """Optional zero-upload real media test; never stage its binaries or MP4s."""
    if args.external_media_tools_report is None:
        return None
    temporary = Path(os.environ["RUNNER_TEMP"])
    if os.environ.get("AIVORA_ARTIFACT_UPLOAD_ALLOWED") != "false":
        raise ValueError("External media validation is a zero-upload run only")
    if args.external_media_python != temporary / "aivora-frozen/build-env/Scripts/python.exe":
        raise ValueError("Use the pinned existing frozen build-environment interpreter")
    expected_report = temporary / "aivora-external-media-tools.json"
    if args.external_media_tools_report != expected_report or not expected_report.is_file():
        raise ValueError("Use the separate test-only pinned media preparation report")
    if expected_report.stat().st_size > 128 * 1024:
        raise ValueError("External media preparation report exceeds its bound")
    prepared = json.loads(expected_report.read_text(encoding="utf-8"))
    root = temporary / "aivora-external-media-tools/ffmpeg-8.1.2-full_build/bin"
    if (
        prepared.get("result") != "EXTERNAL_MEDIA_TEST_INPUTS_PREPARED"
        or prepared.get("toolchain_root") != str(root)
        or prepared.get("usage") != "TEST_ONLY_NOT_FOR_DISTRIBUTION"
        or prepared.get("release_approved") is not False
        or prepared.get("artifact_upload_allowed") is not False
    ):
        raise ValueError("Pinned external tool preparation is incomplete or has wrong scope")
    work = temporary / "aivora-external-media-test"
    inputs = work / "INPUTS.json"
    report = args.evidence / "INSTALLED-EXTERNAL-MEDIA-SMOKE.json"
    if work.exists() or report.exists():
        raise ValueError("Refuse existing external media test/evidence directory")
    phase = "actual_windows_process_and_fixture_preparation"
    try:
        subprocess.run(
            [
                str(args.external_media_python),
                str(ROOT / "scripts/e2e/windows_external_media_checks.py"),
                "prepare",
                "--tool-root",
                str(root),
                "--work",
                str(work),
                "--resources",
                str(executable.parent / "resources"),
                "--report",
                str(inputs),
            ],
            cwd=ROOT,
            check=True,
            timeout=480,
        )
        phase = "actual_installed_native_media"
        subprocess.run(
            [
                "node",
                str(ROOT / "scripts/e2e/windows-external-media-smoke.mjs"),
                "--exe",
                str(executable),
                "--manifest",
                str(args.evidence / "DEV-CORE-INPUTS.json"),
                "--report",
                str(report),
                "--media-root",
                str(root),
                "--inputs",
                str(inputs),
                "--core-report",
                str(args.evidence / "INSTALLED-NATIVE-SMOKE.json"),
            ],
            cwd=ROOT,
            check=True,
            timeout=900,
        )
        if not report.is_file() or report.stat().st_size > 128 * 1024:
            raise ValueError("Installed external-media evidence is missing or unbounded")
        result = json.loads(report.read_text(encoding="utf-8"))
        if result.get("result") != "PASS" or result.get("release_approved") is not False:
            raise ValueError("Actual external-media acceptance did not pass")
        for name, expected in prepared["binaries"].items():
            if digest(root / name) != expected:
                raise ValueError("External test tool bytes changed after native acceptance")
        return {
            "result": "PASS",
            "report": report.name,
            "separate_test_tools_preserved": True,
            "picker_mode": "SIMULATED_NATIVE_DIALOGS",
            "test_tool_hashes": prepared["binaries"],
        }
    except Exception as error:
        if not report.exists():
            failure = {
                "schema_version": 1,
                "result": "FAIL",
                "stage": phase,
                "candidate_head": os.environ["GITHUB_SHA"],
                "failure_type": type(error).__name__,
                "release_approved": False,
            }
            if inputs.is_file() and inputs.stat().st_size <= 128 * 1024:
                details = json.loads(inputs.read_text(encoding="utf-8"))
                if details.get("result") == "FAIL":
                    failure["helper_failure"] = {
                        key: details.get(key)
                        for key in ("stage", "failure_type", "message", "completed_checks")
                    }
            with report.open("x", encoding="utf-8") as stream:
                stream.write(json.dumps(failure, indent=2) + "\n")
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--delivery", type=Path, required=True)
    parser.add_argument("--external-media-tools-report", type=Path)
    parser.add_argument("--external-media-python", type=Path)
    args = parser.parse_args()
    if (args.external_media_tools_report is None) != (args.external_media_python is None):
        parser.error("External media tool report and Python interpreter must be supplied together")
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
    # Keep the old core phase first; media work is optional and never changes
    # the original install/reinstall-abort/uninstall preservation assertions.
    media_result = external_media_phase(args, executable)
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
    if media_result:
        external_root = Path(os.environ["RUNNER_TEMP"]) / (
            "aivora-external-media-tools/ffmpeg-8.1.2-full_build/bin"
        )
        for name, expected in media_result["test_tool_hashes"].items():
            if digest(external_root / name) != expected:
                raise ValueError("Uninstall changed the separately installed test media tools")
        media_result["uninstall_external_tools_preserved"] = True
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
        "media_encode": "EXTERNAL_DRAFT_PASS" if media_result else "UNAVAILABLE",
        "external_media_validation": media_result or "NOT_REQUESTED",
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
