"""Read-only inspection of the two selected PCM WAV engineering inputs.

The inspection hash is derived from verified AssetVersion bytes and the fixed
RIFF_PCM_S16LE_V1 rules. It is not a rights decision or a video probe record.
"""

from __future__ import annotations

import hashlib
import os
import stat
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NoReturn

from aijian_api.artifacts import canonical_content_bytes
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_asset_selected_reader import (
    SelectedMediaAssetVersion,
    _plain_directory,
    read_selected_media_asset_version,
)
from aijian_api.media_execution_plan_contracts import FrozenTestAudioInspectionV1
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source

INSPECTION_DOMAIN = "aivora.mlt_test.audio.RIFF_PCM_S16LE_V1"
MAX_TEST_WAV_BYTES = 1024 * 1024
_EXPECTED_SAMPLES = frozenset({48_000, 240_000})


class TestAudioInspectionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class VerifiedTestAudio:
    selected: SelectedMediaAssetVersion
    inspection: FrozenTestAudioInspectionV1
    managed_path: Path


def _reject(code: str, message: str) -> NoReturn:
    raise TestAudioInspectionError(code, message)


def _managed_path(database_path: Path, digest: str) -> Path:
    workspace = database_path.parent
    root = workspace / "media-assets"
    blobs = root / "blobs"
    prefix = blobs / digest[:2]
    try:
        directories = tuple(
            managed_local_io_path(workspace, item) for item in (workspace, root, blobs, prefix)
        )
    except (OSError, ValueError):
        _reject("AUDIO_PATH_UNSAFE", "Selected WAV must have a local managed source")
    if (
        _is_remote_windows_path(database_path)
        or not database_path.is_absolute()
        or any(not _plain_directory(item) for item in directories)
    ):
        _reject("AUDIO_PATH_UNSAFE", "Selected WAV must have a local managed source")
    path = prefix / digest
    try:
        io_path = managed_local_io_path(workspace, path)
    except (OSError, ValueError):
        _reject("AUDIO_PATH_UNSAFE", "Selected WAV managed source is unavailable")
    if io_path.is_symlink() or not io_path.is_file():
        _reject("AUDIO_PATH_UNSAFE", "Selected WAV managed source is unavailable")
    return path


def _read_same_file(
    workspace: Path,
    path: Path,
    selected: SelectedMediaAssetVersion,
) -> bytes:
    if selected.byte_size > MAX_TEST_WAV_BYTES:
        _reject("AUDIO_SIZE_UNSUPPORTED", "TEST WAV exceeds its fixed inspection limit")
    try:
        io_path = managed_local_io_path(workspace, path)
        with _open_local_source(io_path) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size != selected.byte_size:
                _reject("AUDIO_IDENTITY_CHANGED", "Selected WAV size changed")
            data = stream.read(MAX_TEST_WAV_BYTES + 1)
            after = os.fstat(stream.fileno())
        current = io_path.stat()
    except TestAudioInspectionError:
        raise
    except (OSError, ValueError):
        _reject("AUDIO_READ_UNKNOWN", "Selected WAV could not be read safely")
    if (
        len(data) != selected.byte_size
        or hashlib.sha256(data).hexdigest() != selected.sha256
        or io_path.is_symlink()
        or any(
            (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns)
            != (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            for item in (after, current)
        )
    ):
        _reject("AUDIO_IDENTITY_CHANGED", "Selected WAV bytes or file identity changed")
    return data


def _pcm_sample_count(data: bytes) -> int:
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        _reject("AUDIO_FORMAT_UNSUPPORTED", "TEST audio needs RIFF WAVE")
    if struct.unpack_from("<I", data, 4)[0] != len(data) - 8:
        _reject("AUDIO_FORMAT_UNSUPPORTED", "RIFF declared size differs from the file")
    position = 12
    fmt: tuple[int, int, int, int, int, int] | None = None
    sample_bytes: int | None = None
    while position < len(data):
        if len(data) - position < 8:
            _reject("AUDIO_FORMAT_UNSUPPORTED", "WAV has a truncated chunk header")
        chunk_id = data[position : position + 4]
        chunk_length = struct.unpack_from("<I", data, position + 4)[0]
        start = position + 8
        end = start + chunk_length
        padded_end = end + (chunk_length & 1)
        if end > len(data) or padded_end > len(data):
            _reject("AUDIO_FORMAT_UNSUPPORTED", "WAV chunk exceeds declared bytes")
        if chunk_id == b"fmt ":
            if fmt is not None or chunk_length != 16:
                _reject("AUDIO_FORMAT_UNSUPPORTED", "WAV needs one plain PCM fmt chunk")
            fmt = struct.unpack_from("<HHIIHH", data, start)
        elif chunk_id == b"data":
            if sample_bytes is not None:
                _reject("AUDIO_FORMAT_UNSUPPORTED", "WAV contains duplicate data chunks")
            sample_bytes = chunk_length
        elif chunk_id == b"LIST":
            if chunk_length < 4 or data[start : start + 4] != b"INFO":
                _reject("AUDIO_FORMAT_UNSUPPORTED", "Only bounded INFO metadata is allowed")
        else:
            _reject("AUDIO_FORMAT_UNSUPPORTED", "WAV contains an unsupported extension chunk")
        position = padded_end
    if fmt != (1, 1, 48_000, 96_000, 2, 16) or sample_bytes is None:
        _reject("AUDIO_FORMAT_UNSUPPORTED", "TEST audio needs mono 48 kHz PCM s16le")
    if sample_bytes % 2:
        _reject("AUDIO_FORMAT_UNSUPPORTED", "PCM sample bytes are incomplete")
    return sample_bytes // 2


def inspect_selected_test_wav(
    database_path: Path,
    project_id: str,
    asset_id: str,
    version_id: str,
    *,
    expected_samples: Literal[48000, 240000],
) -> VerifiedTestAudio:
    """Bind one real AssetVersion to a stable, re-computable audio inspection."""
    if expected_samples not in _EXPECTED_SAMPLES:
        _reject("AUDIO_RANGE_UNSUPPORTED", "Only the frozen TEST sample counts are allowed")
    before = read_selected_media_asset_version(database_path, project_id, asset_id, version_id)
    selected = before.version
    if before.status != "VERIFIED" or selected is None or selected.kind != "audio":
        _reject("AUDIO_ASSET_UNVERIFIED", "Selected audio AssetVersion is not verified")
    path = _managed_path(database_path, selected.sha256)
    data = _read_same_file(database_path.parent, path, selected)
    total_samples = _pcm_sample_count(data)
    if total_samples != expected_samples:
        _reject("AUDIO_SAMPLE_CONFLICT", "Selected WAV differs from the frozen sample count")
    after = read_selected_media_asset_version(database_path, project_id, asset_id, version_id)
    if after.status != "VERIFIED" or after.version != selected:
        _reject("AUDIO_ASSET_CHANGED", "Selected audio AssetVersion changed during inspection")
    payload = {
        "inspection_domain": INSPECTION_DOMAIN,
        "project_id": project_id,
        "asset_id": asset_id,
        "asset_version_id": version_id,
        "asset_sha256": selected.sha256,
        "byte_size": selected.byte_size,
        "codec": "PCM_S16LE",
        "channels": 1,
        "sample_rate_hz": 48000,
        "total_samples": total_samples,
    }
    digest = hashlib.sha256(canonical_content_bytes(payload)).hexdigest()
    return VerifiedTestAudio(
        selected=selected,
        inspection=FrozenTestAudioInspectionV1(
            project_id=project_id,
            asset_id=asset_id,
            asset_version_id=version_id,
            asset_sha256=selected.sha256,
            byte_size=selected.byte_size,
            inspection_sha256=digest,
            codec="PCM_S16LE",
            channels=1,
            sample_rate_hz=48000,
            total_samples=total_samples,
        ),
        managed_path=path,
    )
