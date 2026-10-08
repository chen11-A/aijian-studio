"""Match actual frozen native bytes to pinned inputs and preserve their supplied notices.

This verifies material provenance, not legal sufficiency or formal release status.
No unknown native bytes, source mismatch or missing licence text can be promoted.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import tarfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MATERIALS = HERE / "python-redistribution"
CATALOG = MATERIALS / "native-inputs.json"


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_catalog() -> dict:
    catalog = json.loads(CATALOG.read_text())
    if (
        catalog["schema_version"] != 1
        or catalog["purpose"] != "development-core-native-material-mapping"
        or catalog["release_approved"] is not False
    ):
        raise ValueError("Invalid development-native input catalogue")
    downloads = json.loads((HERE / "build-toolchain/downloads.lock.json").read_text())
    by_id = {item["id"]: item for item in downloads["downloads"]}
    for item in catalog["native_inputs"]:
        locked = by_id[item["archive_id"]]
        if item["archive_sha256"] != locked["sha256"] or item["source_url"] != locked["url"]:
            raise ValueError("Native catalogue differs from the pinned build inputs")
    for name, expected in catalog["license_text_hashes"].items():
        if "/" in name or "\\" in name or digest(MATERIALS / name) != expected:
            raise ValueError("Primary companion licence text changed")
    return catalog


def verify_catalog_archives(catalog: dict, cache: Path) -> None:
    """Re-read only verified original archives, not an extracted build environment."""
    downloads = json.loads((HERE / "build-toolchain/downloads.lock.json").read_text())
    locked = {item["id"]: item for item in downloads["downloads"]}
    groups: dict[str, list[dict]] = {}
    for item in catalog["native_inputs"]:
        groups.setdefault(item["archive_id"], []).append(item)
    for archive_id, members in groups.items():
        path = cache / locked[archive_id]["path"]
        for cursor in (path, *path.parents):
            if cursor.is_symlink() or cursor.is_junction():
                raise ValueError("Native input cache cannot follow links")
        if digest(path) != locked[archive_id]["sha256"]:
            raise ValueError("Original native-input archive changed")
        if archive_id == "python":
            with tarfile.open(path) as archive:
                for member in members:
                    source = archive.extractfile("python/" + member["input_path"])
                    if (
                        source is None
                        or hashlib.sha256(source.read()).hexdigest() != member["sha256"]
                    ):
                        raise ValueError(
                            "Native catalogue differs from pinned Python archive bytes"
                        )
        else:
            with zipfile.ZipFile(path) as archive:
                for member in members:
                    if (
                        hashlib.sha256(archive.read(member["input_path"])).hexdigest()
                        != member["sha256"]
                    ):
                        raise ValueError("Native catalogue differs from pinned wheel bytes")


def native_files(resources: Path) -> dict[str, str]:
    result = {}
    if not resources.is_dir():
        return result
    for path in sorted((resources / "sidecar").rglob("*")):
        if path.is_symlink() or path.is_junction():
            raise ValueError("Frozen native inventory cannot contain links")
        if path.is_file() and path.suffix.lower() in {".dll", ".pyd", ".exe"}:
            result["resources/" + path.relative_to(resources).as_posix()] = digest(path)
    return result


def inspect(resources: Path, frozen_receipt: Path | None) -> dict:
    catalog = load_catalog()
    by_hash: dict[str, list[dict]] = {}
    for item in catalog["native_inputs"]:
        by_hash.setdefault(item["sha256"], []).append(item)
    files = native_files(resources)
    matches = []
    unknown = []
    generated = "resources/sidecar/aijian-sidecar.exe"
    receipt = None
    if frozen_receipt is not None and frozen_receipt.is_file():
        receipt = json.loads(frozen_receipt.read_text())
    for name, sha in files.items():
        inputs = by_hash.get(sha, [])
        if inputs:
            matches.append({"path": name, "sha256": sha, "inputs": inputs})
        elif (
            name == generated
            and receipt is not None
            and receipt.get("result") == "FROZEN_COMPONENT_ONLY"
            and receipt.get("target") == "win32-x64"
            and receipt.get("pyinstaller") == "6.22.3"
            and receipt.get("release_approved") is False
            and receipt.get("files", {}).get("sidecar/aijian-sidecar.exe") == sha
        ):
            matches.append({"path": name, "sha256": sha, "generated_from_freezer_receipt": True})
        else:
            unknown.append({"path": name, "sha256": sha})
    return {
        "schema_version": 1,
        "profile": "DEVELOPMENT_CORE",
        "scope": "frozen-native-file-provenance-only",
        "catalog_sha256": digest(CATALOG),
        "native_file_count": len(files),
        "matches": matches,
        "unknown_native_files": unknown,
        "complete_frozen_receipt_available": receipt is not None,
        "release_approved": False,
    }


def copy_companion(resources: Path) -> None:
    catalog = load_catalog()
    destination = resources / "licenses/python-companion"
    destination.mkdir(parents=True, exist_ok=True)
    for name in [*catalog["license_text_hashes"], "native-inputs.json"]:
        source = MATERIALS / name
        target = destination / name
        if target.exists():
            raise ValueError("Refusing to overwrite existing companion licence material")
        shutil.copy2(source, target)
        if digest(source) != digest(target):
            raise ValueError("Companion licence copy changed")


def verify_source_receipt(receipt: dict) -> None:
    spec = importlib.util.spec_from_file_location("freeze_materials", HERE / "freeze-sidecar.py")
    assert spec and spec.loader
    freeze = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(freeze)
    expected = freeze.source_inventory(freeze.load_prerequisite_helpers())
    if receipt.get("sources") != expected:
        raise ValueError("Generated sidecar does not bind exactly this candidate's backend sources")


def make_review(stage: Path, frozen_receipt: Path, cache: Path) -> dict:
    resources = stage / "resources"
    evidence = inspect(resources, frozen_receipt)
    receipt = json.loads(frozen_receipt.read_text())
    verify_source_receipt(receipt)
    if evidence["unknown_native_files"] or not evidence["native_file_count"]:
        raise ValueError("Unknown frozen native bytes: retain evidence and block installer upload")
    catalog = load_catalog()
    verify_catalog_archives(catalog, cache)
    inputs = json.loads((HERE / "build-toolchain/downloads.lock.json").read_text())["downloads"]
    wheel_stems = {item["id"]: Path(item["path"]).stem for item in inputs}
    pyinstaller = next(item for item in inputs if item["id"] == "pyinstaller")
    bootloader = next(
        item
        for item in catalog["native_inputs"]
        if item["archive_id"] == "pyinstaller"
        and item["input_path"] == "PyInstaller/bootloader/Windows-64bit-intel/run.exe"
    )
    components = []
    for match in evidence["matches"]:
        material_paths = set()
        if match.get("generated_from_freezer_receipt"):
            name = "AIVORA sidecar with PyInstaller bootloader"
            version = "AIVORA-source-candidate / PyInstaller 6.22.3"
            source_url = pyinstaller["url"]
            for license_file in bootloader["license_files"]:
                material_paths.add(
                    f"resources/licenses/python-inputs/{wheel_stems['pyinstaller']}/{license_file}"
                )
            material_paths.update(
                {"resources/licenses/AIVORA-LICENSE", "resources/licenses/AIVORA-NOTICE"}
            )
            binding = {
                "kind": "generated-executable",
                "freezer_receipt_sha256": digest(frozen_receipt),
                "bootloader_input_sha256": bootloader["sha256"],
                "bootloader_wheel_sha256": pyinstaller["sha256"],
            }
        else:
            first = match["inputs"][0]
            name, version, source_url = first["name"], first["version"], first["source_url"]
            for item in match["inputs"]:
                for license_file in item["license_files"]:
                    prefix = (
                        "resources/licenses/python-companion"
                        if item["archive_id"] == "python"
                        else f"resources/licenses/python-inputs/{wheel_stems[item['archive_id']]}"
                    )
                    material_paths.add(prefix + "/" + license_file)
            binding = {
                "kind": "exact-pinned-native-input",
                "sources": [
                    {"archive_sha256": item["archive_sha256"], "input_path": item["input_path"]}
                    for item in match["inputs"]
                ],
            }
        licenses = []
        for relative in sorted(material_paths):
            path = stage / relative
            if not path.is_file() or path.is_symlink() or path.is_junction():
                raise ValueError("A native component's supplied licence is absent from the stage")
            licenses.append({"path": relative, "sha256": digest(path)})
        components.append(
            {
                "path": match["path"],
                "sha256": match["sha256"],
                "name": name,
                "version": version,
                "source_url": source_url,
                "source_binding": binding,
                "licenses": licenses,
            }
        )
    return {
        "schema_version": 1,
        "profile": "DEVELOPMENT_CORE",
        "status": "MATERIALS_VERIFIED",
        "scope": "exact-native-input-and-shipped-license-material-hashes",
        "catalog_sha256": digest(CATALOG),
        "freezer_receipt_sha256": digest(frozen_receipt),
        "native_components": components,
        "legal_sufficiency": "NOT_ASSERTED",
        "release_approved": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path, required=True)
    parser.add_argument("--frozen-receipt", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = inspect(args.resources, args.frozen_receipt)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(evidence, indent=2) + "\n")
    print(
        f"Native input evidence: {evidence['native_file_count']} files; "
        f"{len(evidence['unknown_native_files'])} unknown; no Windows/installer acceptance implied"
    )


if __name__ == "__main__":
    main()
