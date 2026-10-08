"""Verify one explicitly selected CI attempt and bounded, tested delivery bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

REPOSITORY = "chen11-A/aijian-studio"
REF = "refs/heads/codex/windows-installer-dev-20261008"
WORKFLOW = REPOSITORY + "/.github/workflows/windows-installer-dev.yml@" + REF
# Reserve at least 1 MiB for the single artifact ZIP's container overhead.
MAX_SOURCE_BYTES = 259 * 1024**2


def verify_scope(environment: dict[str, str], expected_run: int) -> None:
    required = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPOSITORY,
        "GITHUB_REF": REF,
        "GITHUB_WORKFLOW_REF": WORKFLOW,
        "GITHUB_RUN_NUMBER": str(expected_run),
        "GITHUB_RUN_ATTEMPT": "1",
        "AIVORA_ARTIFACT_UPLOAD_ALLOWED": "true",
    }
    if expected_run < 1 or any(environment.get(key) != value for key, value in required.items()):
        raise ValueError("Artifact upload is not authorized for this workflow attempt")


def verify_delivery(directory: Path, environment: dict[str, str], expected_run: int) -> dict:
    verify_scope(environment, expected_run)
    expected = Path(environment["RUNNER_TEMP"]) / "aivora-delivery"
    if directory != expected or not directory.is_absolute():
        raise ValueError("Upload must use the exact isolated delivery directory")
    for path in (directory, *directory.parents):
        if path.is_symlink() or path.is_junction():
            raise ValueError("Delivery paths cannot follow links or junctions")
    files = list(directory.iterdir())
    if not 1 <= len(files) <= 32:
        raise ValueError("Unexpected delivery file count")
    if any(
        not path.is_file()
        or path.is_symlink()
        or path.is_junction()
        or not (
            path.suffix in {".exe", ".json", ".png"} or path.name in {"READ-ME.md", "SHA256SUMS"}
        )
        for path in files
    ):
        raise ValueError("Unexpected file, directory or link in the delivery")
    size = sum(path.stat().st_size for path in files)
    if size > MAX_SOURCE_BYTES:
        raise ValueError("Delivery exceeds the one-shot storage allowance")
    installers = [path for path in files if path.suffix == ".exe"]
    if len(installers) != 1 or not installers[0].name.startswith("AIVORA-Dev-Core-"):
        raise ValueError("Expected exactly one development installer")
    receipt = json.loads((directory / "INSTALL-RESULT.json").read_text(encoding="utf-8"))
    required_results = (
        "fresh_install",
        "installed_native_create_save_reopen",
        "uninstall_app_removed",
        "uninstall_workspace_preserved",
        "uninstall_unknown_user_file_preserved",
    )
    if (
        receipt.get("result") != "PASS"
        or receipt.get("profile") != "DEVELOPMENT_CORE"
        or receipt.get("candidate_head") != environment["GITHUB_SHA"]
        or receipt.get("release_approved") is not False
        or any(receipt.get(key) != "PASS" for key in required_results)
        or receipt.get("reinstall_existing_data") != "SAFELY_ABORTED"
    ):
        raise ValueError("The exact candidate has not passed installation acceptance")
    installer = installers[0]
    with installer.open("rb") as stream:
        actual_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    if installer.stat().st_size != receipt.get("installer_bytes") or actual_hash != receipt.get(
        "installer_sha256"
    ):
        raise ValueError("Installer bytes differ from the tested receipt")
    return {
        "run_number": expected_run,
        "run_attempt": 1,
        "artifact_count": 1,
        "retention_days": 1,
        "source_bytes": size,
        "installer_sha256": actual_hash,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-number", required=True, type=int)
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(verify_delivery(args.directory, dict(os.environ), args.run_number)))


if __name__ == "__main__":
    main()
