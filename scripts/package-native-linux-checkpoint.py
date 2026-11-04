"""Stage a native Linux development checkpoint, without installer or network actions.

Run with the repository's .venv/bin/python so distribution metadata comes from
the locked environment. Only runtime dependency files are copied from that venv.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import tomllib
from datetime import UTC, datetime
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]


def command(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def copy_tree(source: Path, target: Path) -> None:
    shutil.copytree(
        source,
        target,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )


def production_distributions() -> list[importlib.metadata.Distribution]:
    dependencies = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]
    queue = [Requirement(item) for item in dependencies]
    extras_seen: dict[str, set[str]] = {}
    found: dict[str, importlib.metadata.Distribution] = {}
    while queue:
        requirement = queue.pop()
        name = canonicalize_name(requirement.name)
        extras = set(requirement.extras) | {""}
        new_extras = extras - extras_seen.get(name, set())
        if name in found and not new_extras:
            continue
        distribution = importlib.metadata.distribution(requirement.name)
        if distribution.version not in requirement.specifier:
            raise RuntimeError(f"Installed version does not match {requirement}")
        found[name] = distribution
        extras_seen.setdefault(name, set()).update(extras)
        for raw in distribution.requires or []:
            dependency = Requirement(raw)
            if dependency.marker is None or any(
                dependency.marker.evaluate({"extra": extra}) for extra in new_extras
            ):
                queue.append(dependency)
    return [found[name] for name in sorted(found)]


def bundle_python(target: Path) -> list[dict[str, str]]:
    base = Path(sys.base_prefix)
    version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    copy_file(Path(sys.executable).resolve(), target / "bin/python3.12")
    shutil.copytree(
        base / "lib" / version,
        target / "lib" / version,
        ignore=shutil.ignore_patterns(
            "site-packages", "__pycache__", "*.pyc", "*.pyo", "ensurepip", "idlelib", "test"
        ),
    )
    # Some Python builds dynamically link libpython; keep it when available.
    for library in (base / "lib").glob("libpython*.so*"):
        copy_file(library, target / "lib" / library.name)
    site = target / "lib" / version / "site-packages"
    site.mkdir()
    manifest = []
    for distribution in production_distributions():
        manifest.append({"name": distribution.metadata["Name"], "version": distribution.version})
        for relative in distribution.files or []:
            path = Path(relative)
            # Entry-point executables and build caches are unnecessary for module startup.
            if path.is_absolute() or ".." in path.parts or "__pycache__" in path.parts:
                continue
            if path.suffix in {".pyc", ".pyo"}:
                continue
            source = Path(distribution.locate_file(relative))
            if source.is_file():
                copy_file(source, site / path)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--electron-dist", type=Path)
    args = parser.parse_args()
    if (
        sys.version_info[:2] != (3, 12)
        or platform.system() != "Linux"
        or platform.machine() != "x86_64"
    ):
        parser.error("Build with the locked Python 3.12 environment on Linux x64")
    output = args.out_dir
    if not output.is_absolute() or output.exists():
        parser.error("--out-dir must be a new absolute directory")
    output = output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("Choose a destination outside the source checkout")
    electron = args.electron_dist or ROOT / "apps/desktop/node_modules/electron/dist"
    electron = electron.resolve()
    if not (electron / "electron").is_file():
        parser.error("Installed official Electron Linux runtime not found")
    electron_version = (electron / "version").read_text().strip()
    source_desktop = json.loads((ROOT / "apps/desktop/package.json").read_text())
    expected_version = source_desktop["devDependencies"]["electron"].lstrip("^~")
    if electron_version != expected_version:
        parser.error(f"Electron {electron_version} differs from expected {expected_version}")
    output.mkdir(parents=True)
    # Compile in the output tree so staging cannot replace shared development builds.
    desktop = output / "apps/desktop"
    desktop.mkdir(parents=True)
    compiler = ROOT / "node_modules/typescript/bin/tsc"
    with tempfile.TemporaryDirectory(prefix="aivora-release-ts-") as temporary:
        config = Path(temporary) / "tsconfig.json"
        config.write_text(
            json.dumps(
                {
                    "extends": str(ROOT / "apps/desktop/tsconfig.json"),
                    "compilerOptions": {
                        "outDir": str(desktop / "dist"),
                        "typeRoots": [str(ROOT / "apps/desktop/node_modules/@types")],
                        "noEmitOnError": True,
                    },
                    "include": [],
                    "files": [
                        str(ROOT / "apps/desktop/src/main.ts"),
                        str(ROOT / "apps/desktop/src/preload.ts"),
                    ],
                }
            )
        )
        command("node", str(compiler), "-p", str(config))
    command(
        "node",
        str(ROOT / "scripts/build-contracts-runtime.mjs"),
        "--out-dir",
        str(desktop / "node_modules/@aijian/contracts"),
    )
    command(
        "pnpm",
        "--filter",
        "@aijian/studio-web",
        "exec",
        "vite",
        "build",
        "--outDir",
        str(output / "apps/studio-web/dist"),
    )
    package = {
        "name": "aivora-native-checkpoint",
        "productName": "AIVORA Checkpoint",
        "version": source_desktop["version"],
        "private": True,
        "type": "commonjs",
        "main": "dist/main.js",
        "dependencies": {"@aijian/contracts": source_desktop["version"]},
    }
    (desktop / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    copy_tree(electron, output / "runtime/electron")
    python_manifest = bundle_python(output / "runtime/python")
    copy_tree(ROOT / "services/api/src/aijian_api", output / "services/api/src/aijian_api")
    copy_file(
        ROOT / "config/media-toolchain-lock.json", output / "config/media-toolchain-lock.json"
    )
    for name in ["NotoSansCJKsc-Regular.otf", "Noto-LICENSE.txt"]:
        copy_file(ROOT / "apps/studio-web/src/aivora/assets/v2" / name, output / "fonts" / name)
    templates = ROOT / "packaging/linux-checkpoint"
    for name in ["launch-aivora.sh", "check-runtime.py", "README.zh-CN.md"]:
        copy_file(templates / name, output / name)
    copy_file(templates / "python-launcher.sh", output / ".venv/bin/python")
    for name in ["launch-aivora.sh", ".venv/bin/python"]:
        (output / name).chmod(0o755)
    for name in ["LICENSE", "NOTICE"]:
        copy_file(ROOT / name, output / "licenses" / f"AIVORA-{name}")
    copy_file(
        ROOT / "apps/studio-web/src/aivora/assets/v2/Noto-LICENSE.txt",
        output / "licenses/Noto-LICENSE.txt",
    )
    for name in ["react", "react-dom"]:
        source = ROOT / "apps/studio-web/node_modules" / name
        copy_file(source / "LICENSE", output / "licenses" / f"{name}-LICENSE")
    scheduler = next(
        (ROOT / "node_modules/.pnpm").glob("scheduler@*/node_modules/scheduler/LICENSE")
    )
    copy_file(scheduler, output / "licenses/scheduler-LICENSE")
    receipt = {
        "schema_version": 1,
        "kind": "native-linux-x64-development-checkpoint",
        "built_at_utc": datetime.now(UTC).isoformat(),
        "source_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "working_tree_changes_included": True,
        "electron": electron_version,
        "python": platform.python_version(),
        "build_platform": platform.platform(),
        "python_dependencies": python_manifest,
        "window_validation": "NOT_RUN_BY_PACKAGER",
        "windows_installer": "NOT_BUILT_OR_TESTED",
        "bundled_media_tools": False,
        "user_workspace_or_credentials_included": False,
    }
    (output / "CHECKPOINT.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    )
    hashes = []
    for path in sorted(output.rglob("*")):
        if path.is_file():
            with path.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            hashes.append(f"{digest}  {path.relative_to(output).as_posix()}")
    (output / "SHA256SUMS").write_text("\n".join(hashes) + "\n")
    print(f"NATIVE_CHECKPOINT={output}")
    print(f"FILE_COUNT={len(hashes)}")
    print(f"CHECK_COMMAND={output}/launch-aivora.sh --check")


if __name__ == "__main__":
    main()
