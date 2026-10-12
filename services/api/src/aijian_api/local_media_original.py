"""Read-only managed local original verification, shared by manual consumers."""

from __future__ import annotations

import hashlib
import os
import re
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

from aijian_api.episode_media_assembly_contracts import AssemblyMediaAvailability
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_asset_store import MAX_INLINE_PREVIEW_BYTES
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source

_SHA = re.compile(r"[0-9a-f]{64}\Z")


@dataclass
class _AvailabilityReadBudget:
    max_bytes: int
    used_bytes: int = 0
    verified: dict[tuple[str, str, int], tuple[int, int, int, int, int]] = field(
        default_factory=dict
    )


_READ_BUDGET: ContextVar[_AvailabilityReadBudget | None] = ContextVar(
    "local_original_read_budget", default=None
)


@contextmanager
def availability_read_scope(max_bytes: int) -> Iterator[None]:
    """Bound all direct and recursive hashes in one explicit read observation.

    Existing callers without a scope retain the per-original behavior. Nested
    scopes share the outer allowance, and tokens always reset on exit.
    """
    if type(max_bytes) is not int or not 0 < max_bytes <= MAX_INLINE_PREVIEW_BYTES:
        raise ValueError("Original read allowance must stay within the original byte limit")
    if _READ_BUDGET.get() is not None:
        yield
        return
    token = _READ_BUDGET.set(_AvailabilityReadBudget(max_bytes))
    try:
        yield
    finally:
        _READ_BUDGET.reset(token)


def _stat_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def _plain_directory(path: Path) -> bool:
    try:
        return path.is_dir() and not path.is_symlink() and path.resolve(strict=True) == path
    except (OSError, RuntimeError):
        return False


def _availability(database_path: Path, digest: str, byte_size: int) -> AssemblyMediaAvailability:
    """Check a managed original without creating directories or media copies."""

    if _SHA.fullmatch(digest) is None or byte_size <= 0:
        return "CORRUPT"
    workspace = database_path.parent.absolute()
    try:
        workspace_io = managed_local_io_path(workspace, workspace)
    except (OSError, ValueError):
        return "UNKNOWN_UNSAFE_PATH"
    if _is_remote_windows_path(workspace) or not _plain_directory(workspace_io):
        return "UNKNOWN_UNSAFE_PATH"
    root = workspace / "media-assets"
    blobs = root / "blobs"
    prefix = blobs / digest[:2]
    for directory in (root, blobs, prefix):
        try:
            directory_io = managed_local_io_path(workspace, directory)
        except FileNotFoundError:
            return "MISSING"
        except (OSError, ValueError):
            return "UNKNOWN_UNSAFE_PATH"
        if directory_io.is_symlink():
            return "UNKNOWN_UNSAFE_PATH"
        if not directory_io.exists():
            return "MISSING"
        if not _plain_directory(directory_io):
            return "UNKNOWN_UNSAFE_PATH"
    path = prefix / digest
    try:
        io_path = managed_local_io_path(workspace, path)
        if io_path.is_symlink():
            return "UNKNOWN_UNSAFE_PATH"
        file_stat = io_path.stat()
    except FileNotFoundError:
        return "MISSING"
    except (OSError, ValueError):
        return "UNKNOWN_UNSAFE_PATH"
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size != byte_size:
        return "CORRUPT"
    if byte_size > MAX_INLINE_PREVIEW_BYTES:
        return "UNVERIFIED_SIZE_LIMIT"
    budget = _READ_BUDGET.get()
    key = (str(workspace), digest, byte_size)
    if budget is not None:
        cached = budget.verified.get(key)
        if cached is not None:
            return "VERIFIED" if cached == _stat_identity(file_stat) else "UNKNOWN_MEDIA_CHANGED"
        if byte_size > budget.max_bytes - budget.used_bytes:
            return "UNVERIFIED_SIZE_LIMIT"
        # Failed or changed reads still consume the allowance. Never refund a
        # hash attempt or let repeated invalid originals multiply physical I/O.
        budget.used_bytes += byte_size
    try:
        with _open_local_source(io_path) as stream:
            first = os.fstat(stream.fileno())
            if not stat.S_ISREG(first.st_mode) or first.st_size != byte_size:
                return "CORRUPT"
            hasher = hashlib.sha256()
            total = 0
            while True:
                read_size = 1024 * 1024
                if budget is not None:
                    # A concurrently grown original must not turn one reserved
                    # read into more bytes than its declared size. Final stat
                    # checks still reject growth or identity changes.
                    read_size = min(read_size, byte_size - total)
                    if read_size == 0:
                        break
                chunk = stream.read(read_size)
                if not chunk:
                    break
                total += len(chunk)
                if total > byte_size:
                    return "CORRUPT"
                hasher.update(chunk)
            last = os.fstat(stream.fileno())
        if io_path.is_symlink():
            return "UNKNOWN_MEDIA_CHANGED"
        named = io_path.stat()
    except (OSError, ValueError):
        return "UNKNOWN_MEDIA_READ"
    if (
        first.st_dev != last.st_dev
        or first.st_ino != last.st_ino
        or first.st_size != last.st_size
        or first.st_mtime_ns != last.st_mtime_ns
        or first.st_dev != named.st_dev
        or first.st_ino != named.st_ino
        or first.st_size != named.st_size
        or first.st_mtime_ns != named.st_mtime_ns
    ):
        return "UNKNOWN_MEDIA_CHANGED"
    if total != byte_size or hasher.hexdigest() != digest:
        return "CORRUPT"
    if budget is not None:
        if _stat_identity(file_stat) != _stat_identity(first) or _stat_identity(
            first
        ) != _stat_identity(named):
            return "UNKNOWN_MEDIA_CHANGED"
        budget.verified[key] = _stat_identity(named)
    return "VERIFIED"
