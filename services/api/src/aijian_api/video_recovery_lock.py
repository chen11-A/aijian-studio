"""Nonblocking, process-lifetime ownership for an actual video attempt.

A crash releases the OS lock. Neither a timeout nor removing a lock file is used
as evidence that a provider submission stopped. Lock files are never unlinked.
"""

from __future__ import annotations

import os
import re
import stat
import sys
from pathlib import Path
from typing import BinaryIO


class VideoRecoveryBusy(RuntimeError):
    pass


class VideoRecoveryLock:
    def __init__(self, database: Path, attempt_id: str) -> None:
        if not re.fullmatch(r"[0-9a-f]{32}", attempt_id):
            raise ValueError("INVALID_ATTEMPT")
        directory = database.parent.resolve() / "video-recovery-locks"
        directory.mkdir(exist_ok=True)
        if directory.resolve() != directory:
            raise ValueError("INVALID_LOCK_DIRECTORY")
        path = directory / f"{attempt_id}.lock"
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        self._stream: BinaryIO | None = os.fdopen(descriptor, "r+b")
        try:
            actual, named = os.fstat(self._stream.fileno()), path.lstat()
            if (
                not stat.S_ISREG(named.st_mode)
                or not stat.S_ISREG(actual.st_mode)
                or (actual.st_dev, actual.st_ino) != (named.st_dev, named.st_ino)
            ):
                raise OSError("INVALID_LOCK_FILE")
            self._stream.seek(0, os.SEEK_END)
            if self._stream.tell() == 0:
                self._stream.write(b"0")
                self._stream.flush()
            self._stream.seek(0)
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(self._stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self._stream.close()
            self._stream = None
            raise VideoRecoveryBusy("BUSY") from error

    def close(self) -> None:
        if self._stream is not None:
            self._stream.close()
            self._stream = None
