"""Read-only preparation inventory. Never grant release or Windows acceptance.

Writes JSON only to stdout. Does not download, stage, freeze, run Windows tools,
execute installer hooks, rewrite locks or change the existing cache receipt.
"""

from __future__ import annotations

import argparse
import ast
import email
import hashlib
import importlib.util
import json
import platform
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def prerequisite_helpers():
    spec = importlib.util.spec_from_file_location(
        "prerequisites", HERE / "prepare-prerequisites.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wheel_inventory(path: Path) -> dict:
    """Inventory exact locked artifacts, without inferring final PyInstaller contents."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        metadata = [
            name for name in names if name.endswith(".dist-info/METADATA") and name.count("/") == 1
        ]
        if len(metadata) != 1:
            raise ValueError(f"Expected exactly one wheel METADATA: {path.name}")
        message = email.message_from_bytes(archive.read(metadata[0]))
        license_names = [
            name
            for name in names
            if ".dist-info/" in name
            and not name.endswith("/")
            and any(
                word in name.rsplit("/", 1)[-1].lower() for word in ("license", "copying", "notice")
            )
        ]
        return {
            "name": message["Name"],
            "version": message["Version"],
            "declared_license_expression": message["License-Expression"],
            "declared_license_text": message["License"],
            "license_files": {
                name: hashlib.sha256(archive.read(name)).hexdigest() for name in license_names
            },
            "shipped_in_frozen_sidecar": "NOT_ESTABLISHED",
        }


def media_status_contract(source: str) -> dict[str, list[str]]:
    statuses = {}
    for definition in ast.parse(source).body:
        if not isinstance(definition, ast.ClassDef):
            continue
        for node in definition.body:
            if (
                isinstance(node, ast.AnnAssign)
                and isinstance(node.target, ast.Name)
                and node.target.id == "distribution_status"
                and isinstance(node.annotation, ast.Subscript)
                and isinstance(node.annotation.value, ast.Name)
                and node.annotation.value.id == "Literal"
            ):
                annotation = node.annotation.slice
                values = annotation.elts if isinstance(annotation, ast.Tuple) else [annotation]
                statuses[definition.name] = [
                    value.value
                    for value in values
                    if isinstance(value, ast.Constant) and isinstance(value.value, str)
                ]
    return statuses


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    args = parser.parse_args()
    helpers = prerequisite_helpers()
    cache = helpers.plain_path(args.cache)
    lock = json.loads(helpers.LOCK.read_text(encoding="utf-8"))
    helpers.validate_lock(lock)
    helpers.verify_source_locks(lock)
    verified = [helpers.fetch(item, cache, offline=True) for item in lock["downloads"]]
    wheels = [
        {
            "path": item["path"],
            "sha256": item["sha256"],
            **wheel_inventory(cache / item["path"]),
        }
        for item in lock["downloads"]
        if item["path"].endswith(".whl")
    ]
    tool_package = json.loads((HERE / "build-toolchain/package.json").read_text())
    npm_lock = json.loads((HERE / "build-toolchain/package-lock.json").read_text())
    root_package = json.loads((ROOT / "package.json").read_text())
    builder = json.loads((HERE / "electron-builder.v26.json").read_text())
    if tool_package["devDependencies"] != npm_lock["packages"][""]["devDependencies"]:
        raise ValueError("Isolated builder package differs from its npm lock")
    for name, version in tool_package["devDependencies"].items():
        if npm_lock["packages"][f"node_modules/{name}"]["version"] != version:
            raise ValueError(f"Isolated tool version differs from npm lock: {name}")
    if root_package["packageManager"] != f"pnpm@{tool_package['devDependencies']['pnpm']}":
        raise ValueError("Workspace and isolated pnpm versions differ")
    electron = next(item for item in lock["downloads"] if item["id"] == "electron")
    electron_zip = f"electron-v{electron['version']}-win32-x64.zip"
    if (
        builder["electronVersion"] != electron["version"]
        or builder["electronDownload"]["checksums"][electron_zip] != electron["sha256"]
    ):
        raise ValueError("Builder Electron version/hash differs from the verified cache")
    layout = json.loads((HERE / "runtime-layout.json").read_text())
    template = json.loads((HERE / "release-inputs.template.json").read_text())
    roles = {item["role"]: item["destination"] for item in template["inputs"]}
    for role, destination in layout["required_destinations"].items():
        if roles.get(role) != destination:
            raise ValueError(f"Release template is missing a runtime layout role: {role}")
    media = json.loads((ROOT / "config/media-toolchain-lock.json").read_text())
    statuses = media_status_contract(
        (ROOT / "services/api/src/aijian_api/media_toolchain.py").read_text()
    )
    result = {
        "schema_version": 1,
        "kind": "preparation-inventory-not-shipped-sbom",
        "scope": "read-only-source-metadata-and-locked-cache-bytes",
        "candidate_head": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "host": {"system": platform.system(), "machine": platform.machine()},
        "prerequisites": {
            "verified_files": len(verified),
            "verified_bytes": sum(item["bytes"] for item in verified),
            "lock_sha256": helpers.digest(helpers.LOCK),
            "source_lock_bindings": lock["source_locks"],
            "tool_versions": tool_package["devDependencies"],
            "electron": electron["version"],
        },
        "release_template": {
            "example_only": template["example_only"],
            "required_layout_roles_covered": len(layout["required_destinations"]),
            "inputs_with_missing_hash": sum(not item["sha256"] for item in template["inputs"]),
            "unapproved_inputs": sum(
                item["distribution_status"] != "RELEASE_APPROVED" for item in template["inputs"]
            ),
            "complete_candidate_manifest": "NOT_ESTABLISHED",
        },
        "media": {
            "profiles": media["profiles"],
            "backend_distribution_status_contract": statuses,
            "approved_profile_count": sum(
                profile["distribution_status"] == "RELEASE_APPROVED"
                for profile in media["profiles"]
            ),
            "corresponding_source_and_external_components": "NOT_VERIFIED",
            "license_review": "NOT_GRANTED",
        },
        "wheel_inputs": wheels,
        "limits": {
            "windows_freeze": "NOT_RUN",
            "native_windows_electron": "NOT_RUN",
            "staging_powershell": "NOT_RUN",
            "offline_installer_build": "NOT_VERIFIED",
            "installer_backup_upgrade_uninstall": "NOT_RUN",
            "shipped_dependency_sbom_and_notices": "NOT_ESTABLISHED",
        },
        "release_approved": False,
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
