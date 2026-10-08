"""Assemble a same-candidate, media-free DEVELOPMENT_CORE app and unsigned NSIS.

This has its own manifest. It neither calls nor relaxes the formal Release gates.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def plain_files(root: Path) -> list[Path]:
    result = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or path.is_junction():
            raise ValueError("Development package cannot contain links or junctions")
        if path.is_file():
            result.append(path)
        elif not path.is_dir():
            raise ValueError("Development package contains a special file")
    return result


def inventory(root: Path) -> dict[str, str]:
    return {path.relative_to(root).as_posix(): digest(path) for path in plain_files(root)}


def verify_frozen(directory: Path) -> dict:
    receipt = json.loads((directory / "FROZEN-SIDECAR.json").read_text())
    if receipt["target"] != "win32-x64" or receipt["release_approved"] is not False:
        raise ValueError("Expected an unapproved Windows frozen component")
    for name, expected in receipt["sources"].items():
        path = ROOT / name
        if ".." in Path(name).parts or Path(name).is_absolute() or digest(path) != expected:
            raise ValueError("Frozen sidecar source differs from this candidate")
    if inventory(directory / "resources") != receipt["files"]:
        raise ValueError("Frozen resource files differ from the exact component receipt")
    return receipt


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    if digest(source) != digest(target):
        raise ValueError("Copy hash changed")


def assert_core_tree(stage: Path) -> None:
    for path in plain_files(stage):
        if path.name.lower() in {"ffmpeg.exe", "ffprobe.exe", "melt.exe", "qmelt.exe"}:
            raise ValueError("Unapproved media CLI cannot enter DEVELOPMENT_CORE")
        relative = path.relative_to(stage)
        if any(
            part in {"workspace", "chatgpt-official", ".venv", ".git"} for part in relative.parts
        ):
            raise ValueError("Workspace, credential or build directories cannot be packaged")
    if (stage / "resources/media").exists():
        raise ValueError("DEVELOPMENT_CORE has no bundled media directory")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tools", required=True, type=Path)
    parser.add_argument("--frozen", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Build this installer only on the authorized Windows x64 runner")
    for path in (args.tools, args.frozen, args.out, args.evidence):
        if not path.is_absolute() or ".." in path.parts:
            parser.error("Use absolute plain local paths")
        for ancestor in (path, *path.parents):
            if ancestor.is_symlink() or ancestor.is_junction():
                parser.error("Links and junctions are not allowed")
    if args.out.exists() or args.out == ROOT or ROOT in args.out.parents:
        parser.error("--out must be new and outside the checkout")
    args.evidence.mkdir(parents=True, exist_ok=True)
    tools = json.loads((args.tools / "DEV-TOOLS.json").read_text())
    frozen = verify_frozen(args.frozen)
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if os.environ.get("GITHUB_SHA", head) != head:
        raise ValueError("Checkout differs from the requested workflow candidate")
    subprocess.run(["git", "diff", "--exit-code", "HEAD", "--"], cwd=ROOT, check=True)
    if subprocess.check_output(["node", "--version"], text=True).strip() != "v24.19.0":
        raise ValueError("Use pinned Node 24.19.0")
    stage = args.out
    stage.mkdir()
    with (args.evidence / "production-app.json").open("w", encoding="utf-8") as stream:
        subprocess.run(
            [
                "node",
                str(ROOT / "scripts/build-desktop-runtime.mjs"),
                "--out-dir",
                str(stage / "app"),
            ],
            cwd=ROOT,
            stdout=stream,
            check=True,
        )
    app = json.loads((stage / "app/package.json").read_text())
    app.update(
        {
            "name": "aivora-development-core",
            "productName": "AIVORA Dev Core",
            "version": "0.1.0-dev.core",
            "description": "AIVORA development core; no bundled media encoding tools",
            "author": "Aijian Studio contributors",
        }
    )
    (stage / "app/package.json").write_text(json.dumps(app, indent=2) + "\n")
    shutil.copytree(args.frozen / "resources", stage / "resources")
    renderer_environment = {**os.environ, "AIVORA_BUILD_PROFILE": "development-core"}
    subprocess.run(
        [
            "node",
            str(ROOT / "apps/studio-web/node_modules/vite/bin/vite.js"),
            "build",
            "--outDir",
            str(stage / "resources/renderer"),
        ],
        cwd=ROOT / "apps/studio-web",
        env=renderer_environment,
        check=True,
    )
    if not (stage / "resources/renderer/development-core-artwork-exclusions.json").is_file():
        raise ValueError("Renderer did not produce development-core exclusion evidence")
    for name in ("NotoSansCJKsc-Regular.otf", "Noto-LICENSE.txt"):
        copy_file(
            ROOT / "apps/studio-web/src/aivora/assets/v2" / name, stage / "resources/fonts" / name
        )
    for name in ("LICENSE", "NOTICE"):
        copy_file(ROOT / name, stage / "resources/licenses" / ("AIVORA-" + name))
    copy_file(
        args.tools / "cpython/python/LICENSE.txt", stage / "resources/licenses/Python-LICENSE.txt"
    )
    copy_file(
        Path(tools["environment"]["ELECTRON_BUILDER_NSIS_DIR"]) / "COPYING",
        stage / "resources/licenses/NSIS-core-COPYING.txt",
    )
    copy_file(
        ROOT / "apps/studio-web/src/aivora/assets/v2/Noto-LICENSE.txt",
        stage / "resources/licenses/Noto-LICENSE.txt",
    )
    for name in ("react", "react-dom"):
        copy_file(
            ROOT / "apps/studio-web/node_modules" / name / "LICENSE",
            stage / "resources/licenses" / (name + "-LICENSE"),
        )
    scheduler = list(
        (ROOT / "node_modules/.pnpm").glob("scheduler@*/node_modules/scheduler/LICENSE")
    )
    if len(scheduler) != 1:
        raise ValueError("Expected one pinned scheduler distribution")
    copy_file(scheduler[0], stage / "resources/licenses/scheduler-LICENSE")
    spec = importlib.util.spec_from_file_location("audit", HERE / "audit-readiness.py")
    assert spec and spec.loader
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    input_licenses = []
    for item in tools["files"]:
        if not item["path"].endswith(".whl"):
            continue
        wheel = Path(tools["cache"]) / item["path"]
        if digest(wheel) != item["sha256"]:
            raise ValueError("Wheel license source drifted")
        metadata = audit.wheel_inventory(wheel)
        input_licenses.append({"wheel_sha256": item["sha256"], **metadata})
        with zipfile.ZipFile(wheel) as archive:
            for name in metadata["license_files"]:
                if ".." in Path(name).parts or name.startswith("/") or "\\" in name:
                    raise ValueError("Unsafe wheel license path")
                destination = stage / "resources/licenses/python-inputs" / wheel.stem / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(name))
    (stage / "resources/licenses/PYTHON-INPUTS.json").write_text(
        json.dumps({"kind": "build-input-license-inventory", "packages": input_licenses}, indent=2)
        + "\n"
    )
    spec = importlib.util.spec_from_file_location(
        "native_materials", HERE / "map-dev-native-materials.py"
    )
    assert spec and spec.loader
    mapper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mapper)
    mapper.copy_companion(stage / "resources")
    native_evidence = mapper.inspect(stage / "resources", args.frozen / "FROZEN-SIDECAR.json")
    (args.evidence / "FROZEN-NATIVE-MATERIALS.json").write_text(
        json.dumps(native_evidence, indent=2) + "\n"
    )
    if native_evidence["unknown_native_files"]:
        # Unknown distribution inputs block upload, not the isolated build/test
        # needed to diagnose them. This state can never pass the final verifier.
        native_review = {
            "schema_version": 1,
            "profile": "DEVELOPMENT_CORE",
            "status": "BLOCKED",
            "reason": "Frozen native files do not all match pinned redistribution inputs",
            "unknown_native_files": native_evidence["unknown_native_files"],
            "native_components": [],
            "release_approved": False,
        }
    else:
        native_review = mapper.make_review(
            stage, args.frozen / "FROZEN-SIDECAR.json", Path(tools["cache"])
        )
    native_review_text = json.dumps(native_review, indent=2) + "\n"
    (args.evidence / "DEV-NATIVE-MATERIALS.json").write_text(native_review_text)
    (stage / "resources/licenses/NATIVE-MATERIALS.json").write_text(native_review_text)
    copy_file(HERE / "DEVELOPMENT-CORE.md", stage / "resources/DEVELOPMENT-CORE.md")
    config = json.loads((HERE / "electron-builder.dev-core.json").read_text())
    config["electronDist"] = tools["electron"]
    (stage / "build").mkdir()
    (stage / "build/electron-builder.json").write_text(json.dumps(config, indent=2) + "\n")
    copy_file(HERE / "installer.dev-core.nsh", stage / "build/installer.nsh")
    copy_file(HERE / "include-dev-contract-types.cjs", stage / "build/include-contract-types.cjs")
    profile = {
        "schema_version": 1,
        "profile": "DEVELOPMENT_CORE",
        "candidate_head": head,
        "media_cli_bundled": False,
        "media_rendering_available": False,
        "signed": False,
        "release_approved": False,
        "upgrade_supported": False,
        "installer_engine": "first-party-nsis-core-zlib",
    }
    (stage / "resources/config/build-profile.json").write_text(json.dumps(profile, indent=2) + "\n")
    assert_core_tree(stage)
    manifest = {
        **profile,
        "files": inventory(stage),
        "frozen_receipt_sha256": digest(args.frozen / "FROZEN-SIDECAR.json"),
    }
    manifest_path = args.evidence / "DEV-CORE-INPUTS.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("CSC_", "WIN_CSC_", "AZURE_"))
    }
    environment.update(tools["environment"])
    # Stage bytes are checked again immediately before invoking the fixed builder.
    if inventory(stage) != manifest["files"] or frozen != verify_frozen(args.frozen):
        raise ValueError("Candidate changed before builder invocation")
    subprocess.run(
        [
            "node",
            str(HERE / "build-toolchain/node_modules/electron-builder/out/cli/cli.js"),
            "--config",
            "build/electron-builder.json",
            "--win",
            "--x64",
            "--dir",
            "--publish",
            "never",
        ],
        cwd=stage,
        env=environment,
        check=True,
    )
    spec = importlib.util.spec_from_file_location("core_nsis", HERE / "nsis-dev-core.py")
    assert spec and spec.loader
    core_nsis = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(core_nsis)
    core_nsis.build(stage, tools, args.evidence)
    installers = list((stage / "installer-output").glob("AIVORA-Dev-Core-*-win-x64.exe"))
    if len(installers) != 1:
        raise ValueError("Expected exactly one development-core NSIS installer")
    if installers[0].stat().st_size > 250 * 1024**2:
        raise ValueError("Installer exceeds the bounded 250 MiB artifact allowance")
    print("DEVELOPMENT_INSTALLER=" + str(installers[0]))
    print("DEVELOPMENT_INSTALLER_SHA256=" + digest(installers[0]))


if __name__ == "__main__":
    main()
