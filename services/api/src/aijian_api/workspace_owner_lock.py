"""Process-lifetime, cross-process ownership of one local AIVORA workspace.

This lock only excludes another cooperating sidecar using the same database.
It does not prove that a child encoder from a crashed sidecar has exited.
"""

from __future__ import annotations

import errno
import hashlib
import os
import stat
import threading
from pathlib import Path
from types import TracebackType

_ACTIVE_IDENTITIES: set[str] = set()
_ACTIVE_GUARD = threading.Lock()


class WorkspaceLockError(RuntimeError):
    """A workspace cannot be safely owned by this process."""


class WorkspaceLockBusyError(WorkspaceLockError):
    """Another sidecar already owns this workspace."""


class WorkspaceLockUnsafePathError(WorkspaceLockError):
    """The database or lock location is not a plain local path."""


def _is_link_or_junction(path: Path) -> bool:
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def _identity_and_lock_path(database_path: Path) -> tuple[str, Path]:
    if (
        not database_path.is_absolute()
        or database_path.name != "workspace.sqlite3"
        or ".." in database_path.parts
        or str(database_path).startswith("\\\\")
    ):
        raise WorkspaceLockUnsafePathError("Workspace database path is not local and absolute")
    owner_root = database_path.parent.parent
    if not owner_root.is_dir() or _is_link_or_junction(owner_root):
        raise WorkspaceLockUnsafePathError("Workspace owner directory is unavailable")
    cursor = database_path
    while True:
        if os.path.lexists(cursor) and _is_link_or_junction(cursor):
            raise WorkspaceLockUnsafePathError("Workspace path contains a link or junction")
        if cursor == cursor.parent:
            break
        cursor = cursor.parent
    if os.path.lexists(database_path):
        database_stat = database_path.stat(follow_symlinks=False)
        if not stat.S_ISREG(database_stat.st_mode) or database_stat.st_nlink != 1:
            raise WorkspaceLockUnsafePathError("Workspace database is not a plain file")
    try:
        resolved_root = owner_root.resolve(strict=True)
        resolved_database = database_path.resolve(strict=False)
    except (OSError, RuntimeError) as error:
        raise WorkspaceLockUnsafePathError("Workspace path cannot be resolved") from error
    if (
        os.path.normcase(str(resolved_root)) != os.path.normcase(str(owner_root))
        or os.path.normcase(str(resolved_database)) != os.path.normcase(str(database_path))
    ):
        raise WorkspaceLockUnsafePathError("Workspace path changes when resolved")
    identity = os.path.normcase(os.path.normpath(str(resolved_database)))
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return identity, owner_root / f".aivora-workspace-{digest}.lock"


def _lock_io_path(lock_path: Path) -> Path:
    """Use Win32's extended local path only for long lock-file I/O."""

    if os.name != "nt" or len(str(lock_path)) < 260:
        return lock_path
    # The validated database path is local, absolute, and has no parent traversal.
    # Keep its canonical identity unchanged; this prefix only reaches the lock file.
    return Path("\\\\?\\" + str(lock_path))


def _lock_file(fd: int) -> None:
    if os.name == "nt":
        import msvcrt

        # Python 3.12: https://docs.python.org/3.12/library/msvcrt.html#msvcrt.locking
        # Byte locks may extend beyond EOF, so no lock-file content is needed.
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        # https://docs.python.org/3.12/library/fcntl.html#fcntl.flock
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_file(fd: int) -> None:
    if os.name == "nt":
        import msvcrt

        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_UN)


class WorkspaceOwnerLock:
    """Hold the OS lock descriptor until every sidecar worker has stopped."""

    def __init__(self, identity: str, lock_path: Path, fd: int) -> None:
        self.identity = identity
        self.lock_path = lock_path
        self._fd: int | None = fd

    def release(self) -> None:
        fd = self._fd
        if fd is None:
            return
        self._fd = None
        try:
            _unlock_file(fd)
        finally:
            os.close(fd)
            with _ACTIVE_GUARD:
                _ACTIVE_IDENTITIES.discard(self.identity)

    def __enter__(self) -> WorkspaceOwnerLock:
        if self._fd is None:
            raise WorkspaceLockError("Workspace lock has already been released")
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()


def acquire_workspace_owner_lock(database_path: Path) -> WorkspaceOwnerLock:
    """Fail immediately when another process owns this exact database path."""

    identity, lock_path = _identity_and_lock_path(database_path)
    io_lock_path = _lock_io_path(lock_path)
    with _ACTIVE_GUARD:
        if identity in _ACTIVE_IDENTITIES:
            raise WorkspaceLockBusyError("Workspace is already owned in this process")
        _ACTIVE_IDENTITIES.add(identity)
    fd: int | None = None
    try:
        if os.path.lexists(io_lock_path) and _is_link_or_junction(io_lock_path):
            raise WorkspaceLockUnsafePathError("Workspace lock path is a link or junction")
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_BINARY", 0)
        fd = os.open(io_lock_path, flags, 0o600)
        os.set_inheritable(fd, False)
        opened = os.fstat(fd)
        named = io_lock_path.stat(follow_symlinks=False)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or _is_link_or_junction(io_lock_path)
            or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        ):
            raise WorkspaceLockUnsafePathError("Workspace lock file changed during open")
        try:
            _lock_file(fd)
        except OSError as error:
            if error.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                raise WorkspaceLockBusyError("Workspace is already owned") from error
            raise WorkspaceLockError("Workspace lock could not be acquired") from error
        return WorkspaceOwnerLock(identity, lock_path, fd)
    except BaseException:
        if fd is not None:
            os.close(fd)
        with _ACTIVE_GUARD:
            _ACTIVE_IDENTITIES.discard(identity)
        raise
