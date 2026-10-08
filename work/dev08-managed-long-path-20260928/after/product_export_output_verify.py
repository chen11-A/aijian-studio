"""Verify local MP4 bytes before writing a durable product output receipt."""

from __future__ import annotations

import hashlib
import os
import stat
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from fractions import Fraction
from pathlib import Path

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_probe import (
    MAX_MEDIA_INPUT_BYTES, _is_remote_windows_path, _open_local_source,
    probe_local_media,
)
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import ProductExportClaimRequest, ProductExportSpec


class ProductExportOutputError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class VerifiedProductOutput:
    absolute_path: str
    sha256: str
    byte_size: int
    probe_json: str
    probe_hash: str
    verified_at: str


def _managed_root(root: Path) -> Path:
    if not root.is_absolute() or _is_remote_windows_path(root):
        raise ProductExportOutputError("OUTPUT_ROOT_UNSAFE", "Output root must be local and absolute")
    try:
        io_root = managed_local_io_path(root, root)
        resolved = io_root.resolve(strict=True)
        identity = io_root.stat()
    except (OSError, RuntimeError, ValueError):
        raise ProductExportOutputError("OUTPUT_ROOT_UNSAFE", "Output root is unavailable") from None
    if io_root.is_symlink() or resolved != io_root or not stat.S_ISDIR(identity.st_mode):
        raise ProductExportOutputError("OUTPUT_ROOT_UNSAFE", "Output root must be a plain directory")
    return root


def output_target_identity(root: Path, request: ProductExportClaimRequest) -> str:
    """Normalize a single filename against one managed root for DB uniqueness."""
    resolved = _managed_root(root)
    filename = unicodedata.normalize("NFC", request.output_relative_path).casefold()
    return canonical_content_hash({
        "root": os.path.normcase(str(resolved)),
        "filename": filename,
    })


def _guarded_file_hash(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    try:
        io_path = managed_local_io_path(path.parent, path)
        with _open_local_source(io_path) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= MAX_MEDIA_INPUT_BYTES:
                raise ProductExportOutputError("OUTPUT_SIZE", "Output size is invalid")
            header = stream.read(32)
            if (
                len(header) < 12 or header[4:8] != b"ftyp"
                or header[8:12] not in {b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"M4V "}
            ):
                raise ProductExportOutputError("OUTPUT_CONTAINER", "Output is not an approved MP4 brand")
            digest.update(header)
            total += len(header)
            while chunk := stream.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_MEDIA_INPUT_BYTES:
                    raise ProductExportOutputError("OUTPUT_SIZE", "Output exceeds the size limit")
                digest.update(chunk)
            after = os.fstat(stream.fileno())
            path_after = io_path.stat()
            if (
                total != before.st_size or before.st_dev != after.st_dev
                or before.st_ino != after.st_ino or before.st_mtime_ns != after.st_mtime_ns
                or path_after.st_dev != before.st_dev or path_after.st_ino != before.st_ino
                or path_after.st_size != before.st_size
                or path_after.st_mtime_ns != before.st_mtime_ns
            ):
                raise ProductExportOutputError("OUTPUT_CHANGED", "Output changed during verification")
    except ProductExportOutputError:
        raise
    except (OSError, ValueError):
        raise ProductExportOutputError("OUTPUT_UNAVAILABLE", "Output file is unavailable") from None
    return digest.hexdigest(), total


def verify_local_mp4(
    root: Path, filename: str, spec: ProductExportSpec, total_frames: int,
    toolchain: MediaToolchain, *, expect_audio: bool,
) -> VerifiedProductOutput:
    """Hash and decode-probe one output; callers still need playback QA."""
    if isinstance(total_frames, bool) or not isinstance(total_frames, int) or total_frames <= 0:
        raise ProductExportOutputError("INVALID_DURATION", "Expected frame count is invalid")
    directory = _managed_root(root)
    if (
        not filename.endswith(".mp4") or filename in {".", ".."}
        or any(char in filename for char in "/\\:")
    ):
        raise ProductExportOutputError("OUTPUT_FILENAME", "Output filename is invalid")
    path = directory / filename
    try:
        io_path = managed_local_io_path(directory, path)
    except (OSError, ValueError):
        raise ProductExportOutputError("OUTPUT_UNAVAILABLE", "Managed output is missing or unsafe") from None
    if io_path.is_symlink() or not io_path.is_file():
        raise ProductExportOutputError("OUTPUT_UNAVAILABLE", "Managed output is missing or unsafe")
    first_hash, first_size = _guarded_file_hash(path)
    probe = probe_local_media(io_path, toolchain)
    second_hash, second_size = _guarded_file_hash(path)
    if (
        first_hash != second_hash or first_size != second_size
        or probe.source_asset_sha256 != f"sha256:{first_hash}"
        or probe.byte_size != first_size
    ):
        raise ProductExportOutputError("OUTPUT_CHANGED", "Output changed around the probe")
    video = probe.video
    if (
        "mp4" not in probe.format_names
        or video.codec_name != {"H264": "h264", "H265": "hevc"}[spec.video_codec]
        or video.width != spec.width or video.height != spec.height
        or video.pixel_format != "yuv420p"
        or video.average_frame_rate.num != spec.frame_rate_num
        or video.average_frame_rate.den != spec.frame_rate_den
        or video.is_variable_frame_rate
        or len(video.frames) != total_frames
        or (probe.audio is None) != (not expect_audio)
        or (probe.audio is not None and (
            probe.audio.codec_name != "aac" or probe.audio.sample_rate_hz != 48_000
            or probe.audio.channels != 2
        ))
    ):
        raise ProductExportOutputError("OUTPUT_SPEC_MISMATCH", "Output streams differ from claimed spec")
    expected_seconds = Fraction(total_frames * spec.frame_rate_den, spec.frame_rate_num)
    actual_seconds = Fraction(probe.container_duration.num, probe.container_duration.den)
    tolerance = Fraction(2 * spec.frame_rate_den, spec.frame_rate_num)
    if not expected_seconds - tolerance <= actual_seconds <= expected_seconds + tolerance:
        raise ProductExportOutputError("OUTPUT_DURATION_MISMATCH", "Output duration differs from assembly")
    payload = canonical_content_bytes(probe.model_dump(mode="json"))
    return VerifiedProductOutput(
        absolute_path=str(path), sha256=first_hash, byte_size=first_size,
        probe_json=payload.decode("utf-8"),
        probe_hash=f"sha256:{hashlib.sha256(payload).hexdigest()}",
        verified_at=datetime.now(UTC).isoformat(timespec="microseconds"),
    )


def verify_product_output(
    root: Path, request: ProductExportClaimRequest, total_frames: int,
    toolchain: MediaToolchain, *, expect_audio: bool,
) -> VerifiedProductOutput:
    return verify_local_mp4(
        root, request.output_relative_path, request.spec, total_frames,
        toolchain, expect_audio=expect_audio,
    )
