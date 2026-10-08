"""Bounded, zero-write verification of one persisted media asset version.

This reader does not construct StudioRepository or create missing media paths.
On Windows it holds a read-only, deny-write file handle to the workspace DB
while SQLite reads an immutable, checkpointed snapshot. An active WAL or a
concurrent writer makes the result unknown rather than authoritatively valid.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal, cast

from aijian_api.media_probe import _is_remote_windows_path, _open_local_source

MAX_DATABASE_BYTES = 256 * 1024 * 1024
MAX_VERIFIED_ASSET_BYTES = 256 * 1024 * 1024
MAX_READ_SECONDS = 30.0
MAX_EPISODE_USES = 1000
_PROJECT = re.compile(r"prj_[0-9a-f]{32}\Z")
_ASSET = re.compile(r"asset_[0-9a-f]{32}\Z")
_VERSION = re.compile(r"asv_[0-9a-f]{32}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_EPISODE = re.compile(r"ep_[a-z0-9._-]{1,80}\Z")

type SelectedReadStatus = Literal[
    "VERIFIED",
    "MISSING",
    "CORRUPT",
    "UNVERIFIED_SIZE_LIMIT",
    "NOT_FOUND",
    "UNKNOWN_DATABASE",
    "UNKNOWN_DATABASE_BUSY",
    "UNKNOWN_DATABASE_CHANGED",
    "UNKNOWN_MEDIA_CHANGED",
    "UNKNOWN_UNSAFE_PATH",
    "UNKNOWN_INVALID_RECORD",
    "UNKNOWN_READ_BUDGET",
    "UNKNOWN_UNSUPPORTED_PLATFORM",
]


@dataclass(frozen=True, slots=True)
class SelectedEpisodeUse:
    episode_id: str
    role: str


@dataclass(frozen=True, slots=True)
class SelectedMediaAssetVersion:
    project_id: str
    asset_id: str
    version_id: str
    ordinal: int
    filename: str
    kind: Literal["image", "video", "audio"]
    mime_type: str
    byte_size: int
    sha256: str
    rights_status: Literal["PENDING_REVIEW", "CLEARED", "RESTRICTED"]
    source_kind: Literal["LOCAL_IMPORT"]
    technical_metadata: dict[str, str | int]
    episode_uses: tuple[SelectedEpisodeUse, ...]


@dataclass(frozen=True, slots=True)
class SelectedMediaAssetRead:
    status: SelectedReadStatus
    version: SelectedMediaAssetVersion | None = None


class _ReadBudgetExceeded(Exception):
    pass


def _plain_directory(path: Path) -> bool:
    try:
        return (
            path.is_dir()
            and not path.is_symlink()
            and path.resolve(strict=True) == path
        )
    except (OSError, RuntimeError):
        return False


def _sidecar_state(database_path: Path) -> tuple[bool, tuple[tuple[bool, int, int], ...]]:
    """Reject WAL/journal content; return a small before/after signature."""

    signature: list[tuple[bool, int, int]] = []
    for suffix in ("-wal", "-journal", "-shm"):
        sidecar = Path(f"{database_path}{suffix}")
        try:
            if sidecar.is_symlink():
                return False, ()
            sidecar_stat = sidecar.stat()
        except FileNotFoundError:
            signature.append((False, 0, 0))
            continue
        except OSError:
            return False, ()
        if not stat.S_ISREG(sidecar_stat.st_mode):
            return False, ()
        if suffix != "-shm" and sidecar_stat.st_size != 0:
            return False, ()
        signature.append((True, sidecar_stat.st_size, sidecar_stat.st_mtime_ns))
    return True, tuple(signature)


def _hash_stream(stream: BinaryIO, *, maximum: int, deadline: float) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    while chunk := stream.read(1024 * 1024):
        total += len(chunk)
        if total > maximum or time.monotonic() >= deadline:
            raise _ReadBudgetExceeded
        digest.update(chunk)
    return digest.hexdigest(), total


def _version_from_row(
    row: sqlite3.Row, episode_rows: list[sqlite3.Row],
) -> SelectedMediaAssetVersion:
    if len(episode_rows) > MAX_EPISODE_USES:
        raise ValueError("too many media asset episode references")
    kind = str(row["kind"])
    rights = str(row["rights_status"])
    source_kind = str(row["source_kind"])
    digest = str(row["sha256"])
    filename = str(row["filename"])
    mime_type = str(row["mime_type"])
    byte_size = row["byte_size"]
    ordinal = row["ordinal"]
    if (
        kind not in {"image", "video", "audio"}
        or rights not in {"PENDING_REVIEW", "CLEARED", "RESTRICTED"}
        or source_kind != "LOCAL_IMPORT"
        or _HASH.fullmatch(digest) is None
        or not isinstance(byte_size, int)
        or isinstance(byte_size, bool)
        or byte_size <= 0
        or not isinstance(ordinal, int)
        or isinstance(ordinal, bool)
        or ordinal <= 0
        or not 1 <= len(filename) <= 255
        or not mime_type
    ):
        raise ValueError("invalid media asset version record")
    technical = json.loads(str(row["technical_json"]))
    if not isinstance(technical, dict) or any(
        not isinstance(key, str)
        or not isinstance(value, str | int)
        or isinstance(value, bool)
        for key, value in technical.items()
    ):
        raise ValueError("invalid media asset technical metadata")
    uses: list[SelectedEpisodeUse] = []
    for episode_row in episode_rows:
        episode_id = str(episode_row["episode_id"])
        role = str(episode_row["role"])
        if _EPISODE.fullmatch(episode_id) is None or not 1 <= len(role) <= 80:
            raise ValueError("invalid media asset episode reference")
        uses.append(SelectedEpisodeUse(episode_id=episode_id, role=role))
    return SelectedMediaAssetVersion(
        project_id=str(row["project_id"]),
        asset_id=str(row["asset_id"]),
        version_id=str(row["id"]),
        ordinal=ordinal,
        filename=filename,
        kind=cast(Literal["image", "video", "audio"], kind),
        mime_type=mime_type,
        byte_size=byte_size,
        sha256=digest,
        rights_status=cast(Literal["PENDING_REVIEW", "CLEARED", "RESTRICTED"], rights),
        source_kind="LOCAL_IMPORT",
        technical_metadata=technical,
        episode_uses=tuple(uses),
    )


def _read_database(
    database_path: Path, project_id: str, asset_id: str, version_id: str,
) -> SelectedMediaAssetRead:
    uri = f"{database_path.as_uri()}?mode=ro&immutable=1&cache=private"
    connection = sqlite3.connect(uri, uri=True, timeout=0)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        row = connection.execute(
            """SELECT version.* FROM media_asset_versions AS version
               JOIN media_assets AS asset
                 ON asset.project_id = version.project_id AND asset.id = version.asset_id
               WHERE version.project_id = ? AND version.asset_id = ? AND version.id = ?
                 AND asset.deleted_at IS NULL""",
            (project_id, asset_id, version_id),
        ).fetchone()
        if row is None:
            return SelectedMediaAssetRead("NOT_FOUND")
        episode_rows = connection.execute(
            """SELECT episode_id, role FROM media_asset_episode_references
               WHERE project_id = ? AND asset_id = ? AND version_id = ?
               ORDER BY episode_id, role LIMIT ?""",
            (project_id, asset_id, version_id, MAX_EPISODE_USES + 1),
        ).fetchall()
        try:
            version = _version_from_row(row, episode_rows)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            return SelectedMediaAssetRead("UNKNOWN_INVALID_RECORD")
        return SelectedMediaAssetRead("VERIFIED", version)
    finally:
        connection.close()


def _verify_blob(
    workspace: Path, version: SelectedMediaAssetVersion, deadline: float,
) -> SelectedReadStatus:
    root = workspace / "media-assets"
    blobs = root / "blobs"
    prefix = blobs / version.sha256[:2]
    for directory in (root, blobs, prefix):
        if directory.is_symlink():
            return "UNKNOWN_UNSAFE_PATH"
        if not directory.exists():
            return "MISSING"
        if not _plain_directory(directory):
            return "UNKNOWN_UNSAFE_PATH"
    blob = prefix / version.sha256
    if blob.is_symlink():
        return "UNKNOWN_UNSAFE_PATH"
    try:
        with _open_local_source(blob) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size != version.byte_size:
                return "CORRUPT"
            if version.byte_size > MAX_VERIFIED_ASSET_BYTES:
                return "UNVERIFIED_SIZE_LIMIT"
            digest, total = _hash_stream(
                stream, maximum=MAX_VERIFIED_ASSET_BYTES, deadline=deadline,
            )
            after = os.fstat(stream.fileno())
    except FileNotFoundError:
        return "MISSING"
    except _ReadBudgetExceeded:
        return "UNKNOWN_READ_BUDGET"
    except OSError:
        return "UNKNOWN_UNSAFE_PATH"
    if (
        before.st_dev != after.st_dev
        or before.st_ino != after.st_ino
        or before.st_size != after.st_size
        or before.st_mtime_ns != after.st_mtime_ns
    ):
        return "UNKNOWN_MEDIA_CHANGED"
    return "VERIFIED" if total == version.byte_size and digest == version.sha256 else "CORRUPT"


def read_selected_media_asset_version(
    database_path: Path, project_id: str, asset_id: str, version_id: str,
) -> SelectedMediaAssetRead:
    """Return proof for one version; never create a DB, directory, task, or media file."""

    if (
        _PROJECT.fullmatch(project_id) is None
        or _ASSET.fullmatch(asset_id) is None
        or _VERSION.fullmatch(version_id) is None
    ):
        return SelectedMediaAssetRead("NOT_FOUND")
    if os.name != "nt":
        return SelectedMediaAssetRead("UNKNOWN_UNSUPPORTED_PLATFORM")
    if not database_path.is_absolute() or _is_remote_windows_path(database_path):
        return SelectedMediaAssetRead("UNKNOWN_UNSAFE_PATH")
    workspace = database_path.parent
    if not _plain_directory(workspace) or database_path.is_symlink():
        return SelectedMediaAssetRead("UNKNOWN_UNSAFE_PATH")
    try:
        database_stat = database_path.stat()
    except FileNotFoundError:
        return SelectedMediaAssetRead("UNKNOWN_DATABASE")
    except OSError:
        return SelectedMediaAssetRead("UNKNOWN_UNSAFE_PATH")
    if not stat.S_ISREG(database_stat.st_mode) or database_stat.st_size <= 0:
        return SelectedMediaAssetRead("UNKNOWN_DATABASE")
    if database_stat.st_size > MAX_DATABASE_BYTES:
        return SelectedMediaAssetRead("UNKNOWN_READ_BUDGET")
    sidecars_ok, sidecars_before = _sidecar_state(database_path)
    if not sidecars_ok:
        return SelectedMediaAssetRead("UNKNOWN_DATABASE_BUSY")

    deadline = time.monotonic() + MAX_READ_SECONDS
    try:
        # On Windows _open_local_source uses FILE_SHARE_READ only, so a writer
        # cannot coexist with this handle while immutable SQLite reads the DB.
        with _open_local_source(database_path) as database_stream:
            opened = os.fstat(database_stream.fileno())
            if (
                opened.st_dev != database_stat.st_dev
                or opened.st_ino != database_stat.st_ino
                or opened.st_size != database_stat.st_size
                or opened.st_mtime_ns != database_stat.st_mtime_ns
            ):
                return SelectedMediaAssetRead("UNKNOWN_DATABASE_CHANGED")
            database_hash_before, count = _hash_stream(
                database_stream, maximum=MAX_DATABASE_BYTES, deadline=deadline,
            )
            if count != opened.st_size:
                return SelectedMediaAssetRead("UNKNOWN_DATABASE_CHANGED")
            try:
                result = _read_database(database_path, project_id, asset_id, version_id)
            except sqlite3.Error:
                return SelectedMediaAssetRead("UNKNOWN_DATABASE")
            if result.version is not None:
                version = result.version
                result = SelectedMediaAssetRead(
                    _verify_blob(workspace, version, deadline), version,
                )
            database_stream.seek(0)
            database_hash_after, count_after = _hash_stream(
                database_stream, maximum=MAX_DATABASE_BYTES, deadline=deadline,
            )
            closed = os.fstat(database_stream.fileno())
            try:
                path_after = database_path.stat()
            except OSError:
                return SelectedMediaAssetRead("UNKNOWN_DATABASE_CHANGED")
            sidecars_ok, sidecars_after = _sidecar_state(database_path)
            if (
                not sidecars_ok
                or sidecars_before != sidecars_after
                or database_hash_before != database_hash_after
                or count_after != opened.st_size
                or path_after.st_dev != opened.st_dev
                or path_after.st_ino != opened.st_ino
                or path_after.st_size != opened.st_size
                or path_after.st_mtime_ns != opened.st_mtime_ns
                or closed.st_dev != opened.st_dev
                or closed.st_ino != opened.st_ino
                or closed.st_size != opened.st_size
                or closed.st_mtime_ns != opened.st_mtime_ns
            ):
                return SelectedMediaAssetRead("UNKNOWN_DATABASE_CHANGED")
            return result
    except _ReadBudgetExceeded:
        return SelectedMediaAssetRead("UNKNOWN_READ_BUDGET")
    except OSError:
        return SelectedMediaAssetRead("UNKNOWN_DATABASE_BUSY")
