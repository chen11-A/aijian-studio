"""Local-filesystem boundary shared by Fake Provider parent and worker."""

import ctypes
import os
from pathlib import Path, PureWindowsPath

_WINDOWS_RESERVED_NAMES = frozenset(
    {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{index}" for index in range(1, 10)),
        *(f"LPT{index}" for index in range(1, 10)),
        "COM¹",
        "COM²",
        "COM³",
        "LPT¹",
        "LPT²",
        "LPT³",
    }
)


def validate_fake_provider_database_path(
    database_path: Path,
    *,
    trusted_root: Path,
) -> Path:
    """Resolve a database under an explicit local root without reparse indirection."""

    _require_absolute_local_path(database_path, "database")
    _require_absolute_local_path(trusted_root, "trusted root")
    _reject_reparse_points(database_path)
    _reject_reparse_points(trusted_root)
    resolved_root = trusted_root.resolve()
    resolved_database = database_path.resolve()
    _require_absolute_local_path(resolved_root, "resolved trusted root")
    _require_absolute_local_path(resolved_database, "resolved database")
    if not resolved_root.is_dir():
        raise ValueError("Fake Provider trusted root must be an existing directory")
    try:
        resolved_database.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError("Fake Provider database must stay inside its trusted root") from error
    if not resolved_database.parent.is_dir():
        raise ValueError("Fake Provider database parent must exist")
    if resolved_database.exists() and not resolved_database.is_file():
        raise ValueError("Fake Provider database path must be a file")
    return resolved_database


def _require_absolute_local_path(path: Path, label: str) -> None:
    raw = str(path)
    windows_path = PureWindowsPath(raw)
    normalized = raw.replace("/", "\\")
    if not path.is_absolute():
        raise ValueError(f"Fake Provider {label} path must be absolute")
    if normalized.startswith("\\\\") or windows_path.drive.startswith("\\\\"):
        raise ValueError(f"Fake Provider {label} path must be local")
    if os.name == "nt" and windows_path.anchor and _windows_drive_type(windows_path.anchor) == 4:
        raise ValueError(f"Fake Provider {label} path must not use a mapped network drive")
    tail = raw[len(windows_path.drive) :] if windows_path.drive else raw
    if ":" in tail:
        raise ValueError(f"Fake Provider {label} path must not use alternate data streams")
    for component in windows_path.parts[1:] if windows_path.anchor else windows_path.parts:
        normalized_component = component.rstrip(" .")
        base_name = normalized_component.partition(".")[0].upper()
        if (
            not normalized_component
            or base_name in _WINDOWS_RESERVED_NAMES
            or any(character in normalized_component for character in '<>"|?*')
        ):
            raise ValueError(f"Fake Provider {label} path contains a reserved device name")


def _reject_reparse_points(path: Path) -> None:
    candidate = path
    while True:
        if candidate.exists() and (
            candidate.is_symlink()
            or (hasattr(candidate, "is_junction") and candidate.is_junction())
        ):
            raise ValueError("Fake Provider paths must not traverse reparse points")
        parent = candidate.parent
        if parent == candidate:
            return
        candidate = parent


def _windows_drive_type(root: str) -> int:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    get_drive_type = kernel32.GetDriveTypeW
    get_drive_type.argtypes = [ctypes.c_wchar_p]
    get_drive_type.restype = ctypes.c_uint
    return int(get_drive_type(root))
