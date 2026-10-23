"""Burn one Chinese subtitle with the font shipped in the unpacked Windows build.

The installer puts the OFL face in extraResources, outside the asar archive.
This check runs after that copy and after the locked ffmpeg pair is added, and
it refuses every system font by pointing fontconfig at an empty directory.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("The unpacked Windows subtitle compose check runs on Windows")
    app = args.stage / "installer-output" / "win-unpacked"
    font = app / "resources" / "fonts" / "NotoSansCJKsc-Regular.otf"
    font_license = app / "resources" / "fonts" / "Noto-LICENSE.txt"
    published_license = app / "resources" / "licenses" / "Noto-LICENSE.txt"
    ffmpeg = app / "resources" / "media" / "ffmpeg.exe"
    ffprobe = app / "resources" / "media" / "ffprobe.exe"
    for path in (font, font_license, published_license, ffmpeg, ffprobe):
        if not path.is_file():
            raise SystemExit(f"unpacked build is missing {path}")
    sys.path.insert(0, str(ROOT / "services/api/src"))
    from aijian_api.assembly_subtitles import SUBTITLE_FONT_SHA256, SUBTITLE_LICENSE_SHA256
    from aijian_api.draft_subtitles import escape_drawtext_path

    if digest(font) != SUBTITLE_FONT_SHA256:
        raise SystemExit("unpacked subtitle font does not match the pinned face")
    if digest(font_license) != SUBTITLE_LICENSE_SHA256:
        raise SystemExit("unpacked subtitle license does not match the OFL pin")
    if digest(published_license) != SUBTITLE_LICENSE_SHA256:
        raise SystemExit("licenses folder copy of the subtitle license does not match")
    resolved = str(font.resolve())
    escaped = escape_drawtext_path(resolved)
    drive = resolved.split(":", 1)[0]
    if not escaped.startswith(drive + "\\\\:") or "\\\\\\\\" not in escaped:
        raise SystemExit("Windows font path was not escaped for drawtext")
    with tempfile.TemporaryDirectory(prefix="aivora-subtitle-smoke-") as temporary:
        work = Path(temporary)
        empty = work / "empty-fonts"
        empty.mkdir()
        config = work / "fonts.conf"
        config.write_text(
            '<?xml version="1.0"?>\n<fontconfig><dir>'
            + empty.as_posix()
            + "</dir></fontconfig>\n",
            encoding="utf-8",
        )
        cue = work / "cue.txt"
        cue.write_text("雾城来信", encoding="utf-8")
        output = work / "caption.mp4"
        drawtext = (
            f"drawtext=fontfile={escaped}:textfile={escape_drawtext_path(str(cue.resolve()))}:"
            "expansion=none:text_shaping=0:fontsize=32:fontcolor=white:"
            "box=1:boxcolor=black@0.55:boxborderw=8:"
            "x=(w-text_w)/2:y=h-text_h-h/10"
        )
        environment = os.environ.copy()
        environment["FONTCONFIG_FILE"] = str(config)
        environment["FONTCONFIG_PATH"] = str(empty)
        completed = subprocess.run(
            [
                str(ffmpeg),
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=448x672:r=24:d=0.5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=0.5",
                "-vf",
                drawtext,
                "-frames:v",
                "12",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(output),
            ],
            check=False,
            capture_output=True,
            env=environment,
        )
        if completed.returncode != 0 or not output.is_file():
            detail = completed.stderr.decode("utf-8", "replace").strip().splitlines()
            tail = " | ".join(detail[-4:])[:500]
            raise SystemExit(
                f"bundled-font subtitle compose failed ({completed.returncode}): {tail}"
            )
        probe = subprocess.run(
            [
                str(ffprobe),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,width,height",
                "-of",
                "csv=p=0",
                str(output),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if probe.returncode != 0 or "h264,448,672" not in probe.stdout.replace(" ", ""):
            raise SystemExit(f"composed clip has no 448x672 h264 picture: {probe.stdout!r}")
        audio = subprocess.run(
            [
                str(ffprobe),
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(output),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if audio.returncode != 0 or "audio" not in audio.stdout:
            raise SystemExit("composed clip has no audio stream")
    print("SUBTITLE_COMPOSE=ok")


if __name__ == "__main__":
    main()
