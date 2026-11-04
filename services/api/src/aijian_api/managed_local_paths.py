"""OS paths for I/O on already scoped, local managed files.

Callers keep the original logical path in records and public identities. The
extended Windows spelling is only for filesystem operations on that path.
"""

from __future__ import annotations

import os
import re
import stat
import sys
from pathlib import Path

_LOCAL_DRIVE = re.compile(r"[A-Za-z]:")
_REPARSE_POINT = 0x400


def managed_local_io_path(root: Path, candidate: Path) -> Path:
    """Return a safe I/O spelling for a path at or below a local managed root.

    The final component may not exist yet (for exclusive create or hard link).
    Every existing component must be plain; no UNC, reparse point, or traversal
    is accepted. This is not an adapter for arbitrary source or tool paths.
    """

    if not root.is_absolute() or not candidate.is_absolute():
        raise ValueError("managed paths must be absolute")
    if any(part == ".." for path in (root, candidate) for part in path.parts):
        raise ValueError("managed paths cannot traverse parents")
    if sys.platform == "win32":
        for path in (root, candidate):
            if _LOCAL_DRIVE.fullmatch(path.drive) is None:
                raise ValueError("managed paths need a local drive spelling")
            if any(part.endswith((" ", ".")) or ":" in part for part in path.parts[1:]):
                raise ValueError("managed paths need unambiguous components")
        import ctypes

        get_drive_type = ctypes.windll.kernel32.GetDriveTypeW
        get_drive_type.argtypes = [ctypes.c_wchar_p]
        get_drive_type.restype = ctypes.c_uint
        # DRIVE_REMOVABLE and DRIVE_FIXED are local. Network, unknown, and
        # optical volumes are outside managed media storage.
        if int(get_drive_type(f"{root.drive}\\")) not in (2, 3):
            raise ValueError("managed storage must be on a local disk")
    try:
        candidate.relative_to(root)
    except ValueError:
        raise ValueError("managed path is outside its root") from None

    def io_path(path: Path) -> Path:
        if os.name == "nt":
            return Path("\\\\?\\" + str(path))
        return path

    # Validate each existing ancestor with lstat. The final name is allowed
    # to be absent, but an absent ancestor is never silently created here.
    current = Path(root.anchor)
    components = candidate.parts[1:]
    for index, component in enumerate(components):
        current = current / component
        final = index == len(components) - 1
        try:
            information = os.lstat(io_path(current))
        except FileNotFoundError:
            if final:
                break
            raise
        if stat.S_ISLNK(information.st_mode) or (
            sys.platform == "win32" and information.st_file_attributes & _REPARSE_POINT
        ):
            raise ValueError("managed path contains a reparse point")
        if not final and not stat.S_ISDIR(information.st_mode):
            raise ValueError("managed path parent is not a directory")
    return io_path(candidate)
