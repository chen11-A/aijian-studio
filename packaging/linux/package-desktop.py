"""Build the standalone Linux x64 desktop tarball.

The interpreter is python-build-standalone (glibc 2.17) and FFmpeg is the pinned
BtbN shared GPL build, so the result runs on Ubuntu 22.04 and 24.04.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE_NAME = "AIVORA-Desktop-0.2.1-linux-x64"
PYTHON_URL = (
    "https://github.com/astral-sh/python-build-standalone/releases/download/20261021/"
    "cpython-3.12.15%2B20261021-x86_64-unknown-linux-gnu-install_only.tar.gz"
)
PYTHON_SHA256 = "5ff9f0602ce964a529ed1e8555d3abab6341926d724402ba9a15e9e877191124"
FFMPEG_URL = (
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-21-13-06/"
    "ffmpeg-n8.1.3-20-gc8de997cb1-linux64-gpl-shared-8.1.tar.xz"
)
FFMPEG_SHA256 = "2e73402279aa2c051626c95ade18d1d45037b8975fc688aefd6f4aeafcd48b46"
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024


def digest(path: Path) -> str:
    # Ubuntu 22.04's system Python is 3.10 and has no hashlib.file_digest.
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def download(url: str, expected: str, target: Path) -> None:
    if target.exists():
        if digest(target) != expected:
            raise RuntimeError(f"Cached archive does not match the pin: {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".partial")
    request = urllib.request.Request(url, headers={"User-Agent": "AIVORA-Linux-Desktop"})
    with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as output:
        if not str(response.url).startswith("https://"):
            raise RuntimeError("Download redirected away from HTTPS")
        count = 0
        while chunk := response.read(1024 * 1024):
            count += len(chunk)
            if count > MAX_ARCHIVE_BYTES:
                raise RuntimeError("Download exceeds its size limit")
            output.write(chunk)
    if digest(temporary) != expected:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Download did not match the pin: {url}")
    temporary.rename(target)


def _link_stays_inside(member: tarfile.TarInfo) -> bool:
    if member.linkname.startswith("/"):
        return False
    parts: list[str] = []
    for part in (Path(member.name).parent / member.linkname).parts:
        if part == "..":
            if not parts:
                return False
            parts.pop()
        elif part not in {"", "."}:
            parts.append(part)
    return True


def extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as tar:
        members = []
        for member in tar.getmembers():
            if member.name.startswith("/") or ".." in Path(member.name).parts:
                raise RuntimeError(f"Unsafe archive path: {member.name}")
            if member.issym() or member.islnk():
                # CPython's terminfo database links outside the prefix. The runtime
                # does not need it, and Ubuntu 22.04 refuses those links.
                if not _link_stays_inside(member):
                    continue
            members.append(member)
        tar.extractall(destination, members=members)


def checkpoint_module():
    path = ROOT / "scripts/package-native-linux-checkpoint.py"
    spec = importlib.util.spec_from_file_location("aivora_linux_checkpoint", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load the Linux checkpoint helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bootstrap(cache: Path) -> None:
    if os.environ.get("AIVORA_LINUX_BUILDER") == "1":
        return
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("Build on Linux x64")
    download(PYTHON_URL, PYTHON_SHA256, cache / "cpython.tar.gz")
    prefix = cache / "python-prefix"
    if not (prefix / "python/bin/python3.12").is_file():
        extract(cache / "cpython.tar.gz", prefix)
    venv = cache / "builder-venv"
    if not (venv / "bin/python").is_file():
        subprocess.run(
            [str(prefix / "python/bin/python3.12"), "-m", "venv", str(venv)],
            check=True,
        )
    requirements = cache / "requirements.txt"
    subprocess.run(
        [
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--no-hashes",
            "-o",
            str(requirements),
        ],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [
            "uv",
            "pip",
            "install",
            "--python",
            str(venv / "bin/python"),
            "-r",
            str(requirements),
            "packaging",
        ],
        cwd=ROOT,
        check=True,
    )
    os.environ["AIVORA_LINUX_BUILDER"] = "1"
    python = str(venv / "bin/python")
    os.execv(python, [python, *sys.argv])


def version_base(banner: str, tool: str) -> str:
    import re

    match = re.match(rf"^{tool} version n?([0-9]+\.[0-9]+\.[0-9]+)(?:$|[^0-9])", banner)
    if match is None:
        raise RuntimeError(f"Unexpected {tool} banner: {banner}")
    return match.group(1)


def stage_ffmpeg(cache: Path, output: Path) -> dict[str, str]:
    download(FFMPEG_URL, FFMPEG_SHA256, cache / "ffmpeg.tar.xz")
    extracted = cache / "ffmpeg-src"
    if not any(extracted.glob("ffmpeg-*/bin/ffmpeg")):
        extract(cache / "ffmpeg.tar.xz", extracted)
    source = next(extracted.glob("ffmpeg-*/bin/ffmpeg")).parents[1]
    target = output / "runtime/ffmpeg"
    shutil.copytree(source / "bin", target / "bin", symlinks=True)
    shutil.copytree(source / "lib", target / "lib", symlinks=True)
    for name in ("ffmpeg", "ffprobe"):
        (target / "bin" / name).chmod(0o755)
    ffmpeg = target / "bin/ffmpeg"
    ffprobe = target / "bin/ffprobe"
    ffmpeg_banner = subprocess.run(
        [str(ffmpeg), "-version"], check=True, capture_output=True, text=True, timeout=20
    ).stdout
    ffprobe_banner = subprocess.run(
        [str(ffprobe), "-version"], check=True, capture_output=True, text=True, timeout=20
    ).stdout
    if "--enable-gpl" not in ffmpeg_banner or "--enable-libx264" not in ffmpeg_banner:
        raise RuntimeError("Pinned FFmpeg is not the expected GPL libx264 build")
    base = version_base(ffmpeg_banner.splitlines()[0], "ffmpeg")
    if version_base(ffprobe_banner.splitlines()[0], "ffprobe") != base:
        raise RuntimeError("ffmpeg and ffprobe versions differ")
    lock = {
        "schema_version": 1,
        "expected_version": base,
        "profiles": [
            {
                "profile_id": "linux-x86_64-btbn-gpl-shared-8.1.3",
                "ffmpeg_sha256": digest(ffmpeg),
                "ffprobe_sha256": digest(ffprobe),
                "source_url": FFMPEG_URL,
                "license_class": "GPL",
                "spdx_license": "GPL-3.0-or-later",
                "distribution_status": "DEVELOPMENT_ONLY",
            }
        ],
    }
    destination = output / "config/linux-desktop-media-lock.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    return lock["profiles"][0]


def build(output: Path, cache: Path) -> None:
    if not output.is_absolute() or output.exists() or output.name != PACKAGE_NAME:
        raise RuntimeError("--out-dir must be a new absolute directory named " + PACKAGE_NAME)
    output = output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise RuntimeError("Choose a destination outside the source checkout")
    helper = checkpoint_module()
    electron_package = ROOT / "apps/desktop/node_modules/electron"
    electron = (electron_package / "dist").resolve()
    if not (electron / "electron").is_file():
        # The electron package downloads its runtime from install.js. pnpm does not
        # run that script during a frozen install, so a fresh CI machine has no binary.
        subprocess.run(
            ["node", str(electron_package / "install.js")], cwd=electron_package, check=True
        )
    if not (electron / "electron").is_file():
        raise RuntimeError("Installed official Electron Linux runtime not found")
    electron_version = (electron / "version").read_text().strip()
    if electron_version != "43.2.0":
        raise RuntimeError(f"Electron {electron_version} is not 43.2.0")
    output.mkdir(parents=True)
    desktop = output / "apps/desktop"
    desktop.mkdir(parents=True)
    compiler = ROOT / "node_modules/typescript/bin/tsc"
    with tempfile.TemporaryDirectory(prefix="aivora-linux-ts-") as temporary:
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
        helper.command("node", str(compiler), "-p", str(config))
    helper.command(
        "node",
        str(ROOT / "scripts/build-contracts-runtime.mjs"),
        "--out-dir",
        str(desktop / "node_modules/@aijian/contracts"),
    )
    helper.command(
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
        "name": "AIVORA",
        "productName": "AIVORA",
        "version": "0.2.1",
        "private": True,
        "type": "commonjs",
        "main": "dist/main.js",
        "dependencies": {"@aijian/contracts": "0.1.0"},
    }
    (desktop / "package.json").write_text(json.dumps(package, indent=2) + "\n")
    helper.copy_tree(electron, output / "runtime/electron")
    helper.bundle_python(output / "runtime/python")
    helper.copy_tree(ROOT / "services/api/src/aijian_api", output / "services/api/src/aijian_api")
    profile = stage_ffmpeg(cache, output)
    templates = ROOT / "packaging/linux"
    for name in ("launch-aivora.sh", "check-runtime.py", "README.zh-CN.md"):
        helper.copy_file(templates / name, output / name)
    helper.copy_file(
        ROOT / "packaging/linux-checkpoint/python-launcher.sh", output / ".venv/bin/python"
    )
    for name in ("launch-aivora.sh", ".venv/bin/python"):
        (output / name).chmod(0o755)
    for name in ("LICENSE", "NOTICE"):
        helper.copy_file(ROOT / name, output / "licenses" / f"AIVORA-{name}")
    receipt = {
        "kind": "aivora-linux-x64-desktop",
        "version": "0.2.1",
        "electron": electron_version,
        "python": "3.12.15+20261021",
        "python_sha256": PYTHON_SHA256,
        "ffmpeg_profile": profile["profile_id"],
        "ffmpeg_sha256": profile["ffmpeg_sha256"],
        "ffprobe_sha256": profile["ffprobe_sha256"],
        "ffmpeg_license": "GPL-3.0-or-later",
        "distribution_status": "DEVELOPMENT_ONLY",
        "token_storage": "gnome_libsecret when libsecret is available, otherwise file_key",
        "login_log": "~/.config/AIVORA/logs/grok-login.log",
        "oauth_callback": "http://127.0.0.1:56121/callback",
    }
    (output / "LINUX-DESKTOP.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    archive = output.parent / f"{PACKAGE_NAME}.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(output, arcname=PACKAGE_NAME)
    print(f"LINUX_DESKTOP={output}")
    print(f"TARBALL={archive}")
    print(f"TARBALL_SHA256={digest(archive)}")
    print(f"TARBALL_BYTES={archive.stat().st_size}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    bootstrap(cache)
    build(args.out_dir, cache)


if __name__ == "__main__":
    main()
