"""Copy the locked FFmpeg pair into an already built development-core app and rebuild NSIS.

The development-core packager refuses media CLIs. This step runs after that
packager, so the installer the user double-clicks contains the same pinned
GPL development binaries the quality workflow already verifies. It does not
sign the installer.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
NOTICE = """AIVORA bundles the pinned FFmpeg 8.1.2 Windows development binaries.

These files are GPL-3.0-or-later builds published by Gyan:
https://www.gyan.dev/ffmpeg/builds/

The bytes must match config/media-toolchain-lock.json. This installer is
unsigned. Windows SmartScreen can warn before launch.
Source and the GPL-3.0 text: https://www.gnu.org/licenses/gpl-3.0.html
"""


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--tools", required=True, type=Path)
    parser.add_argument("--media", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Bundle media only on the Windows installer runner")
    app = args.stage / "installer-output" / "win-unpacked"
    media = app / "resources" / "media"
    if media.exists():
        parser.error("Refusing to replace an existing media directory")
    lock = json.loads((ROOT / "config" / "media-toolchain-lock.json").read_text(encoding="utf-8"))
    profile = lock["profiles"][0]
    pair = {
        "ffmpeg.exe": profile["ffmpeg_sha256"],
        "ffprobe.exe": profile["ffprobe_sha256"],
    }
    media.mkdir()
    for name, expected in pair.items():
        source = args.media / name
        if digest(source) != expected:
            parser.error(f"{name} does not match the locked development toolchain")
        target = media / name
        target.write_bytes(source.read_bytes())
        if digest(target) != expected:
            parser.error(f"{name} changed while copying")
    (media / "FFMPEG-NOTICE.txt").write_text(NOTICE, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("core_nsis", HERE / "nsis-dev-core.py")
    if spec is None or spec.loader is None:
        parser.error("NSIS builder is missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    installer = args.stage / "installer-output" / module.INSTALLER_FILENAME
    if installer.is_file():
        installer.unlink()
    tools = json.loads((args.tools / "DEV-TOOLS.json").read_text(encoding="utf-8"))
    built = module.build(args.stage, tools, args.evidence)
    limit = 800 * 1024 * 1024
    if built.stat().st_size > limit:
        parser.error("Integrated installer exceeds 800 MiB")
    receipt = {
        "profile": "INTEGRATED_DESKTOP",
        "media_cli_bundled": True,
        "media_profile": profile["profile_id"],
        "license": profile["spdx_license"],
        "signed": False,
        "installer": built.name,
        "installer_bytes": built.stat().st_size,
        "installer_sha256": digest(built),
        "ffmpeg_sha256": pair["ffmpeg.exe"],
        "ffprobe_sha256": pair["ffprobe.exe"],
    }
    (args.evidence / "INTEGRATED-INSTALLER.json").write_text(
        json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
    )
    print("INTEGRATED_INSTALLER=" + str(built))
    print("INTEGRATED_INSTALLER_BYTES=" + str(built.stat().st_size))


if __name__ == "__main__":
    main()
