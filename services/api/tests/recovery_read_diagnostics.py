"""Transparent test-only, bounded facts for Windows recovery-read failures.

No provider request is added, no file is modified, and the original return/exception
is preserved. Only closed booleans are printed; paths, hashes and stat values never are.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
from contextvars import ContextVar
from functools import wraps
from pathlib import Path

import pytest
from aijian_api.media_probe import _open_local_source
from aijian_api.video_recovery import MAX_RECOVERY_BYTES, VideoRecoveryService

FIELDS = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
BOOLEAN_FIELDS = (
    "fdStable",
    "fdRegular",
    "pathRegular",
    "sameDevice",
    "sameInode",
    "sameSize",
    "sameMtime",
    "sameCtime",
    "namedHandleMatch",
    "shaMatch",
    "byteCountMatch",
)


def closed_identity_row(
    before: os.stat_result | None,
    after: os.stat_result | None,
    named: os.stat_result | None,
    second: os.stat_result | None,
    *,
    sha_match: bool,
    size_match: bool,
) -> dict[str, object]:
    def equal(left: os.stat_result | None, right: os.stat_result | None, field: str) -> bool:
        return (
            left is not None and right is not None and getattr(left, field) == getattr(right, field)
        )

    return {
        "schemaVersion": 1,
        "stage": "read-path",
        "fdStable": all(equal(before, after, field) for field in FIELDS),
        "fdRegular": before is not None
        and after is not None
        and stat.S_ISREG(before.st_mode)
        and stat.S_ISREG(after.st_mode),
        "pathRegular": named is not None and stat.S_ISREG(named.st_mode),
        "sameDevice": equal(after, named, "st_dev"),
        "sameInode": equal(after, named, "st_ino"),
        "sameSize": equal(after, named, "st_size"),
        "sameMtime": equal(after, named, "st_mtime_ns"),
        "sameCtime": equal(after, named, "st_ctime_ns"),
        "namedHandleMatch": all(equal(after, second, field) for field in FIELDS),
        "shaMatch": sha_match is True,
        "byteCountMatch": size_match is True,
    }


@pytest.fixture(autouse=True)
def recovery_read_identity_observer(monkeypatch):
    """Observe actual fstat/lstat calls only while the original reader is executing."""
    original = VideoRecoveryService._read_path
    fstat = os.fstat
    lstat = Path.lstat
    active: ContextVar[tuple[Path, list[os.stat_result], list[os.stat_result]] | None] = ContextVar(
        "recovery_read_identity", default=None
    )
    emitted = 0

    def observed_fstat(descriptor):
        info = fstat(descriptor)
        observing = active.get()
        if observing is not None and len(observing[1]) < 2:
            observing[1].append(info)
        return info

    def observed_lstat(path, *args, **kwargs):
        info = lstat(path, *args, **kwargs)
        observing = active.get()
        if observing is not None and path is observing[0] and not observing[2]:
            observing[2].append(info)
        return info

    @wraps(original)
    def observed_read(path, sha256, size):
        nonlocal emitted
        descriptor_rows: list[os.stat_result] = []
        named_rows: list[os.stat_result] = []
        token = active.set((path, descriptor_rows, named_rows))
        try:
            result = original(path, sha256, size)
        finally:
            active.reset(token)
        if result is not None or emitted >= 3 or not 0 < size <= MAX_RECOVERY_BYTES:
            return result
        second = None
        valid_hash = False
        valid_size = False
        # Reuse the shipped native no-reparse/read-only opener for an independent
        # named handle, after the original read has completed. No raw values escape.
        try:
            with _open_local_source(path) as stream:
                second = fstat(stream.fileno())
                data = stream.read(MAX_RECOVERY_BYTES + 1)
            valid_hash = hashlib.sha256(data).hexdigest() == sha256
            valid_size = len(data) == size
        except OSError:
            pass
        row = closed_identity_row(
            descriptor_rows[0] if descriptor_rows else None,
            descriptor_rows[1] if len(descriptor_rows) == 2 else None,
            named_rows[0] if named_rows else None,
            second,
            sha_match=valid_hash,
            size_match=valid_size,
        )
        print("CI_VIDEO_RECOVERY_IDENTITY " + json.dumps(row, separators=(",", ":")))
        emitted += 1
        return result

    monkeypatch.setattr(os, "fstat", observed_fstat)
    monkeypatch.setattr(Path, "lstat", observed_lstat)
    monkeypatch.setattr(VideoRecoveryService, "_read_path", staticmethod(observed_read))
