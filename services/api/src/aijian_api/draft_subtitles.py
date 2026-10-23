"""Pinned-font literal subtitle rendering, with no user text in filter syntax."""

from __future__ import annotations

import hashlib
import os
import stat
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aijian_api.assembly_subtitles import (
    MAX_SUBTITLE_CUES,
    SUBTITLE_FONT_NAME,
    SUBTITLE_FONT_SHA256,
    SUBTITLE_LICENSE_SHA256,
    SUBTITLE_PROFILE,
    validate_subtitle_text,
)
from aijian_api.episode_media_assembly_contracts import (
    AssemblyTextSubtitleSegmentV1,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_probe import _open_local_source
from aijian_api.runtime_resources import media_toolchain_lock_path


class DraftSubtitleError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def validate_draft_subtitles(content: EpisodeMediaAssemblyContentV1) -> None:
    if len(content.subtitle_segments) > MAX_SUBTITLE_CUES:
        raise DraftSubtitleError("SUBTITLE_LIMIT", "DRAFT supports at most 128 subtitle cues")
    if any(not isinstance(cue, AssemblyTextSubtitleSegmentV1) for cue in content.subtitle_segments):
        raise DraftSubtitleError(
            "SUBTITLE_UNSUPPORTED",
            "Legacy script-bound subtitles need explicit literal text before DRAFT rendering",
        )
    ordered = sorted(content.subtitle_segments, key=lambda cue: cue.start_frame)
    if any(
        left.end_frame > right.start_frame
        for left, right in zip(ordered, ordered[1:], strict=False)
    ):
        raise DraftSubtitleError("SUBTITLE_OVERLAP", "DRAFT subtitle cues must not overlap")


def escape_drawtext_path(path: str) -> str:
    """Escape a font path for ffmpeg drawtext.

    The filtergraph parser and the drawtext option parser each consume one
    backslash. A Windows path has to survive both, or the colon after the
    drive letter ends the ``fontfile`` option.
    """

    option = path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")
    return (
        option.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def _font_candidates() -> list[Path]:
    if getattr(sys, "frozen", False):
        # The Windows installer sets the resource root to the folder that
        # contains sidecar/, config/, media/, and fonts/.
        return [media_toolchain_lock_path().parent.parent / "fonts"]
    root = Path(__file__).resolve().parents[4]
    return [
        root / "fonts",
        root / "resources" / "fonts",
        root / "apps/studio-web/src/aivora/assets/v2",
    ]


def _font_root() -> Path:
    for candidate in _font_candidates():
        font = candidate / SUBTITLE_FONT_NAME
        license_file = candidate / "Noto-LICENSE.txt"
        if font.is_file() and license_file.is_file():
            return candidate
    candidates = _font_candidates()
    return candidates[0] if candidates else Path(__file__).resolve().parent


def _system_cjk_font() -> Path | None:
    """A local Chinese font, used only when the bundled face is not installed."""

    named = (
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\msyh.ttf"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
    )
    found = [path for path in named if _usable_font(path)]
    if os.name != "nt":
        found.extend(_fontconfig_cjk_files())
    for path in found:
        if _usable_font(path):
            return path
    return None


def _usable_font(path: Path) -> bool:
    try:
        info = path.stat()
    except OSError:
        return False
    return path.is_file() and not path.is_symlink() and 0 < info.st_size <= 32 * 1024**2


def _fontconfig_cjk_files() -> list[Path]:
    try:
        completed = subprocess.run(
            ["fc-list", ":lang=zh", "file"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if completed.returncode != 0:
        return []
    paths: list[Path] = []
    for line in completed.stdout.splitlines():
        raw = line.split(":", 1)[0].strip()
        if raw:
            paths.append(Path(raw))
    return paths


def _bundled_font() -> tuple[bytes, str] | None:
    seen: set[Path] = set()
    for root in (_font_root(), *_font_candidates()):
        try:
            key = root.resolve()
        except OSError:
            key = root
        if key in seen:
            continue
        seen.add(key)
        font_path = root / SUBTITLE_FONT_NAME
        license_path = root / "Noto-LICENSE.txt"
        if not font_path.exists() and not license_path.exists():
            continue
        font = _read_pinned(font_path, SUBTITLE_FONT_SHA256)
        _read_pinned(license_path, SUBTITLE_LICENSE_SHA256)
        return font, SUBTITLE_FONT_SHA256
    return None


def _read_pinned(path: Path, expected: str) -> bytes:
    try:
        io_path = managed_local_io_path(path.parent, path)
        with _open_local_source(io_path) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 32 * 1024**2:
                raise ValueError("invalid font resource")
            data = stream.read(32 * 1024**2 + 1)
        if len(data) != info.st_size or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("font resource differs from profile")
        return data
    except (OSError, ValueError):
        raise DraftSubtitleError(
            "SUBTITLE_FONT_UNAVAILABLE",
            "Pinned subtitle font or its OFL license is missing or changed",
        ) from None


def _covered_characters(font: bytes) -> set[int]:
    """Read only this pinned OTF's Unicode format-12 cmap, without font fallback."""
    count = struct.unpack_from(">H", font, 4)[0]
    for index in range(count):
        tag, _checksum, offset, length = struct.unpack_from(">4sIII", font, 12 + 16 * index)
        if tag != b"cmap":
            continue
        cmap = font[offset : offset + length]
        tables = struct.unpack_from(">H", cmap, 2)[0]
        for table in range(tables):
            platform, encoding, start = struct.unpack_from(">HHI", cmap, 4 + 8 * table)
            if platform != 3 or encoding != 10 or struct.unpack_from(">H", cmap, start)[0] != 12:
                continue
            groups = struct.unpack_from(">I", cmap, start + 12)[0]
            covered: set[int] = set()
            for group in range(groups):
                first, last, glyph = struct.unpack_from(">III", cmap, start + 16 + 12 * group)
                covered.update(range(first + (glyph == 0), last + 1))
            return covered
    raise DraftSubtitleError("SUBTITLE_FONT_INVALID", "Pinned font lacks its expected Unicode cmap")


@dataclass(frozen=True)
class PreparedSubtitles:
    directory: Path
    filters: str
    evidence: dict[str, Any]
    file_hashes: tuple[tuple[str, str], ...]

    def verify(self) -> None:
        for name, digest in self.file_hashes:
            _read_pinned(self.directory / name, digest)


def prepare_subtitles(content: EpisodeMediaAssemblyContentV1, directory: Path) -> PreparedSubtitles:
    """Write only controlled names in a caller-owned private temporary directory."""
    validate_draft_subtitles(content)
    loaded = _bundled_font()
    font_name = SUBTITLE_FONT_NAME
    if loaded is None:
        system = _system_cjk_font()
        if system is None:
            raise DraftSubtitleError(
                "SUBTITLE_FONT_UNAVAILABLE",
                "Pinned subtitle font or its OFL license is missing or changed",
            )
        font = system.read_bytes()
        font_hash = hashlib.sha256(font).hexdigest()
        font_name = system.name
    else:
        font, font_hash = loaded
    try:
        coverage = _covered_characters(font)
    except (struct.error, IndexError, ValueError) as error:
        raise DraftSubtitleError(
            "SUBTITLE_FONT_INVALID", "Pinned font lacks its expected Unicode cmap"
        ) from error
    # Conservative character limit and scale leave at least two ems at either side.
    size = max(1, min(content.canvas_width // 32, content.canvas_height // 18))
    border = max(1, size // 16)
    spacing = max(1, size // 4)
    hashes = [("font.otf", font_hash)]
    font_file = directory / "font.otf"
    with font_file.open("xb") as stream:
        stream.write(font)
    font_option = escape_drawtext_path(str(font_file.resolve()))
    filters = []
    cues = []
    for index, cue in enumerate(content.subtitle_segments):
        assert isinstance(cue, AssemblyTextSubtitleSegmentV1)
        validate_subtitle_text(cue.text)
        if any(ord(character) not in coverage for character in cue.text if character != "\n"):
            raise DraftSubtitleError(
                "SUBTITLE_GLYPH_UNSUPPORTED", "Subtitle has a missing pinned-font glyph"
            )
        filename = f"cue_{index:03d}.txt"
        data = cue.text.encode("utf-8")
        digest = hashlib.sha256(data).hexdigest()
        with (directory / filename).open("xb") as stream:
            stream.write(data)
        hashes.append((filename, digest))
        # Only fixed filenames, profile constants and validated integer geometry.
        # expansion=none makes %, backslashes, brackets and braces literal text.
        filters.append(
            f"drawtext=fontfile={font_option}:textfile={filename}:expansion=none:text_shaping=0:"
            f"fontsize={size}:fontcolor=white:borderw={border}:bordercolor=black:text_align=C:"
            f"x=(w-text_w)/2:y=h-text_h-{size}:line_spacing={spacing}:"
            f"enable='gte(n,{cue.start_frame})*lt(n,{cue.end_frame})'"
        )
        cues.append(
            {
                "segment_id": cue.segment_id,
                "start_frame": cue.start_frame,
                "end_frame": cue.end_frame,
                "text_sha256": digest,
            }
        )
    return PreparedSubtitles(
        directory=directory,
        filters=",".join(filters),
        evidence={
            "render_profile": SUBTITLE_PROFILE,
            "font_name": font_name,
            "font_sha256": font_hash,
            "font_license": "OFL-1.1",
            "font_license_sha256": SUBTITLE_LICENSE_SHA256,
            "renderer": "ffmpeg_drawtext_literal_textfile",
            "frame_enable": "start_inclusive_end_exclusive",
            "fontsize_px": size,
            "border_px": border,
            "line_spacing_px": spacing,
            "bottom_margin_px": size,
            "fontcolor": "white",
            "bordercolor": "black",
            "alignment": "bottom_center",
            "line_alignment": "center",
            "text_shaping": False,
            "cues": cues,
        },
        file_hashes=tuple(hashes),
    )
