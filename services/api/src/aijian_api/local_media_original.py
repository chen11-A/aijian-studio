"""Read-only managed local original verification, shared by manual consumers."""

from __future__ import annotations

import ctypes
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
_StatIdentity = tuple[int, int, int, int, int]
# inotify masks. IN_CLOSE_NOWRITE is intentionally absent: the verifying read
# must not look like a writer. Overflow and watch removal are reported by the
# kernel without being requested.
_IN_MODIFY = 0x00000002
_IN_ATTRIB = 0x00000004
_IN_CLOSE_WRITE = 0x00000008
_IN_DELETE_SELF = 0x00000400
_IN_MOVE_SELF = 0x00000800
_IN_Q_OVERFLOW = 0x00004000
_IN_IGNORED = 0x00008000
_IN_WATCH = _IN_MODIFY | _IN_ATTRIB | _IN_CLOSE_WRITE | _IN_DELETE_SELF | _IN_MOVE_SELF


class _InotifyEvent(ctypes.Structure):
    _fields_ = (
        ("wd", ctypes.c_int),
        ("mask", ctypes.c_uint32),
        ("cookie", ctypes.c_uint32),
        ("length", ctypes.c_uint32),
    )


class _WriteObservation:
    """Scope-lifetime write observation. Linux only; Windows never reports quiet.

    A quiet watch is the only permission to reuse a hash. Stat identity is not
    a substitute: a same-size rewrite can leave dev, ino, size, mtime and ctime
    unchanged. This object does not take a file lease, so writers are not blocked.
    """

    def __init__(self) -> None:
        self.fd: int | None = None
        self.dirty: set[int] = set()
        self.overflow = False
        self.unavailable = os.name != "posix"

    def close(self) -> None:
        fd, self.fd = self.fd, None
        if fd is not None:
            os.close(fd)

    def arm(self, path: Path) -> int | None:
        if self.unavailable or self.overflow:
            return None
        if self.fd is None and not self._open():
            self.unavailable = True
            return None
        assert self.fd is not None
        try:
            libc = _libc()
            add = libc.inotify_add_watch
            add.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32)
            add.restype = ctypes.c_int
            watch = add(self.fd, os.fsencode(path), _IN_WATCH)
        except (AttributeError, OSError):
            self.unavailable = True
            return None
        if watch < 0:
            self.unavailable = True
            return None
        return watch

    def quiet(self, watch: int) -> bool:
        self._poll()
        return not self.overflow and watch not in self.dirty

    def _open(self) -> bool:
        try:
            libc = _libc()
            init = libc.inotify_init1
            init.argtypes = (ctypes.c_int,)
            init.restype = ctypes.c_int
            flags = getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NONBLOCK", 0)
            fd = init(flags)
        except (AttributeError, OSError):
            return False
        if fd < 0:
            return False
        self.fd = fd
        return True

    def _poll(self) -> None:
        fd = self.fd
        if fd is None:
            return
        header = ctypes.sizeof(_InotifyEvent)
        while True:
            try:
                chunk = os.read(fd, 4096)
            except BlockingIOError:
                return
            except OSError:
                self.overflow = True
                return
            if not chunk:
                return
            offset = 0
            while offset + header <= len(chunk):
                event = _InotifyEvent.from_buffer_copy(chunk[offset : offset + header])
                offset += header + int(event.length)
                if event.mask & _IN_Q_OVERFLOW or event.wd < 0:
                    self.overflow = True
                elif event.mask & (_IN_WATCH | _IN_IGNORED):
                    self.dirty.add(int(event.wd))
                else:
                    self.overflow = True


def _libc() -> ctypes.CDLL:
    return ctypes.CDLL(None, use_errno=True)


@dataclass
class _AvailabilityReadBudget:
    max_bytes: int
    used_bytes: int = 0
    verified: dict[tuple[str, str, int], tuple[_StatIdentity, _StatIdentity, int]] = field(
        default_factory=dict
    )
    reuse_blocked: set[tuple[str, str, int]] = field(default_factory=set)
    lifecycle: _WriteObservation = field(default_factory=_WriteObservation)


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
    budget = _AvailabilityReadBudget(max_bytes)
    token = _READ_BUDGET.set(budget)
    try:
        yield
    finally:
        budget.lifecycle.close()
        _READ_BUDGET.reset(token)


def _stat_identity(value: os.stat_result) -> _StatIdentity:
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
    watch: int | None = None
    if budget is not None:
        if key in budget.reuse_blocked or budget.lifecycle.overflow:
            return "UNKNOWN_MEDIA_CHANGED"
        cached = budget.verified.get(key)
        if cached is not None:
            named_identity, held_identity, watch = cached
            if not budget.lifecycle.quiet(watch) or named_identity != _stat_identity(file_stat):
                return "UNKNOWN_MEDIA_CHANGED"
            try:
                # Windows stat and fstat can expose different ctime semantics.
                # Keep both observation domains when a write watch is still quiet.
                with _open_local_source(io_path) as stream:
                    first = os.fstat(stream.fileno())
                    if io_path.is_symlink():
                        return "UNKNOWN_MEDIA_CHANGED"
                    named = io_path.stat()
                    last = os.fstat(stream.fileno())
            except (OSError, ValueError):
                return "UNKNOWN_MEDIA_READ"
            if (
                not budget.lifecycle.quiet(watch)
                or named_identity != _stat_identity(named)
                or held_identity != _stat_identity(first)
                or held_identity != _stat_identity(last)
            ):
                return "UNKNOWN_MEDIA_CHANGED"
            return "VERIFIED"
        if byte_size > budget.max_bytes - budget.used_bytes:
            return "UNVERIFIED_SIZE_LIMIT"
        # Failed or changed reads still consume the allowance. Never refund a
        # hash attempt or let repeated invalid originals multiply physical I/O.
        budget.used_bytes += byte_size
        watch = budget.lifecycle.arm(io_path)
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
        _stat_identity(first) != _stat_identity(last)
        or _stat_identity(file_stat) != _stat_identity(named)
        or file_stat.st_dev != first.st_dev
        or file_stat.st_ino != first.st_ino
        or file_stat.st_size != first.st_size
        or file_stat.st_mtime_ns != first.st_mtime_ns
        or first.st_dev != named.st_dev
        or first.st_ino != named.st_ino
        or first.st_size != named.st_size
        or first.st_mtime_ns != named.st_mtime_ns
    ):
        return "UNKNOWN_MEDIA_CHANGED"
    if total != byte_size or hasher.hexdigest() != digest:
        return "CORRUPT"
    if budget is None:
        return "VERIFIED"
    if watch is None or not budget.lifecycle.quiet(watch):
        # The hash above is this call's own read. Later calls must not hash
        # again and must not trust an unchanged stat tuple.
        budget.reuse_blocked.add(key)
        if watch is None:
            return "VERIFIED"
        return "UNKNOWN_MEDIA_CHANGED"
    budget.verified[key] = (_stat_identity(named), _stat_identity(last), watch)
    return "VERIFIED"
