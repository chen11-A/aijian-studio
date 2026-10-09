"""Managed, project-scoped media originals in the existing workspace database."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import uuid4

from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_asset_contracts import (
    AssetAvailability,
    AssetEpisodeReferenceData,
    AssetKind,
    AssetVersionData,
    MediaAssetData,
    RightsStatus,
)
from aijian_api.media_probe import (
    MAX_MEDIA_INPUT_BYTES,
    _is_remote_windows_path,
    _open_local_source,
)
from aijian_api.repository import StudioRepository

MAX_INLINE_PREVIEW_BYTES = 32 * 1024 * 1024
_ASSET_ID = re.compile(r"asset_[0-9a-f]{32}\Z")
_VERSION_ID = re.compile(r"asv_[0-9a-f]{32}\Z")
_PROJECT_ID = re.compile(PROJECT_ID_PATTERN)


class MediaAssetError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _require_id(value: str, pattern: re.Pattern[str]) -> None:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise MediaAssetError("INVALID_ASSET_ID", "Invalid media asset identifier")


def _ensure_directory(workspace: Path, path: Path) -> None:
    try:
        io_path = managed_local_io_path(workspace, path)
        io_path.mkdir(exist_ok=True, mode=0o700)
        plain = io_path.resolve(strict=True) == io_path and io_path.is_dir()
    except (OSError, RuntimeError, ValueError):
        plain = False
    if not plain:
        raise MediaAssetError("UNSAFE_STORAGE", "Media storage is not a plain local directory")


def _media_root(repository: StudioRepository) -> Path:
    workspace = repository.database_path.parent.absolute()
    if _is_remote_windows_path(workspace):
        raise MediaAssetError("UNSAFE_STORAGE", "Workspace media storage must be local")
    try:
        workspace_io = managed_local_io_path(workspace, workspace)
        plain = workspace_io.is_dir() and workspace_io.resolve(strict=True) == workspace_io
    except (OSError, RuntimeError, ValueError):
        plain = False
    if not plain:
        raise MediaAssetError("UNSAFE_STORAGE", "Workspace media storage must be plain")
    root = workspace / "media-assets"
    _ensure_directory(workspace, root)
    return root


def _blob_path(root: Path, digest: str) -> Path:
    if re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise MediaAssetError("CORRUPT_RECORD", "Stored media hash is invalid")
    blobs = root / "blobs"
    _ensure_directory(root.parent, blobs)
    parent = blobs / digest[:2]
    _ensure_directory(root.parent, parent)
    return parent / digest


def _classify(path: Path) -> tuple[AssetKind, str, dict[str, str | int]]:
    with path.open("rb") as stream:
        header = stream.read(32)
    if header.startswith(b"\x89PNG\r\n\x1a\n") and header[12:16] == b"IHDR":
        width = int.from_bytes(header[16:20], "big")
        height = int.from_bytes(header[20:24], "big")
        if 0 < width <= 100_000 and 0 < height <= 100_000:
            return (
                "image",
                "image/png",
                {
                    "width": width,
                    "height": height,
                    "inspection_status": "HEADER_ONLY",
                },
            )
    if header.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg", {"inspection_status": "DIMENSIONS_UNINSPECTED"}
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image", "image/webp", {"inspection_status": "DIMENSIONS_UNINSPECTED"}
    if header[4:8] == b"ftyp":
        return "video", "video/mp4", {"inspection_status": "PENDING_MEDIA_PROBE"}
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return "video", "video/webm", {"inspection_status": "PENDING_MEDIA_PROBE"}
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "audio", "audio/wav", {"inspection_status": "PENDING_MEDIA_PROBE"}
    if header.startswith(b"ID3") or (
        len(header) > 1 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0
    ):
        return "audio", "audio/mpeg", {"inspection_status": "PENDING_MEDIA_PROBE"}
    raise MediaAssetError("UNSUPPORTED_MEDIA", "Media format is not supported")


def _verified_size_and_hash(path: Path, expected_size: int, expected_hash: str) -> bool:
    if path.is_symlink():
        return False
    digest = hashlib.sha256()
    try:
        with _open_local_source(path) as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size != expected_size:
                return False
            total = 0
            while chunk := stream.read(1024 * 1024):
                total += len(chunk)
                if total > expected_size:
                    return False
                digest.update(chunk)
            after = os.fstat(stream.fileno())
            return (
                total == expected_size
                and digest.hexdigest() == expected_hash
                and before.st_mtime_ns == after.st_mtime_ns
                and before.st_size == after.st_size
            )
    except OSError:
        return False


def _availability(
    workspace: Path,
    path: Path,
    size: int,
    digest: str,
    *,
    verify: bool,
) -> AssetAvailability:
    try:
        io_path = managed_local_io_path(workspace, path)
        if io_path.is_symlink():
            return "CORRUPT"
        file_stat = io_path.stat()
    except FileNotFoundError:
        return "MISSING"
    except (OSError, ValueError):
        return "CORRUPT"
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size != size:
        return "CORRUPT"
    if verify:
        return "VERIFIED" if _verified_size_and_hash(io_path, size, digest) else "CORRUPT"
    return "PRESENT_UNVERIFIED"


def _contains_identity(value: object, identities: set[str]) -> bool:
    if isinstance(value, str):
        return value in identities
    if isinstance(value, list):
        return any(_contains_identity(item, identities) for item in value)
    if isinstance(value, dict):
        return any(_contains_identity(item, identities) for item in value.values())
    return False


class MediaAssetStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def import_local(
        self,
        project_id: str,
        source_path: Path,
        *,
        asset_id: str | None = None,
        display_filename: str | None = None,
    ) -> MediaAssetData:
        _require_id(project_id, _PROJECT_ID)
        if asset_id is not None:
            _require_id(asset_id, _ASSET_ID)
        if not source_path.is_absolute() or _is_remote_windows_path(source_path):
            raise MediaAssetError("SOURCE_NOT_LOCAL", "Media source must be an absolute local file")
        try:
            source = source_path.resolve(strict=True)
            source_stat = source.stat()
        except (OSError, RuntimeError):
            raise MediaAssetError("SOURCE_MISSING", "Media source is missing") from None
        if _is_remote_windows_path(source) or not stat.S_ISREG(source_stat.st_mode):
            raise MediaAssetError("SOURCE_NOT_LOCAL", "Media source must be a local regular file")
        if not 0 < source_stat.st_size <= MAX_MEDIA_INPUT_BYTES:
            raise MediaAssetError("SOURCE_SIZE", "Media source size is outside the limit")
        filename = display_filename if display_filename is not None else source.name
        if (
            not filename
            or len(filename) > 255
            or "/" in filename
            or "\\" in filename
            or any(ord(character) < 32 or ord(character) == 127 for character in filename)
        ):
            raise MediaAssetError("INVALID_FILENAME", "Media filename is invalid")

        with self._repository._connection() as connection:
            if (
                connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
                is None
            ):
                raise MediaAssetError("PROJECT_NOT_FOUND", "Project was not found")
            if (
                asset_id is not None
                and connection.execute(
                    "SELECT 1 FROM media_assets "
                    "WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
                    (project_id, asset_id),
                ).fetchone()
                is None
            ):
                raise MediaAssetError("ASSET_NOT_FOUND", "Media asset was not found")

        root = _media_root(self._repository)
        staging = root / "staging"
        _ensure_directory(root.parent, staging)
        staged_path = staging / f"staged-{uuid4().hex}"
        staged_io = managed_local_io_path(root.parent, staged_path)
        digest = hashlib.sha256()
        copied = 0
        try:
            with (
                _open_local_source(source) as input_stream,
                staged_io.open("xb") as output_stream,
            ):
                opened = os.fstat(input_stream.fileno())
                if (
                    not stat.S_ISREG(opened.st_mode)
                    or opened.st_dev != source_stat.st_dev
                    or opened.st_ino != source_stat.st_ino
                    or opened.st_size != source_stat.st_size
                    or opened.st_mtime_ns != source_stat.st_mtime_ns
                ):
                    raise MediaAssetError("SOURCE_CHANGED", "Media source changed before import")
                while chunk := input_stream.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > MAX_MEDIA_INPUT_BYTES:
                        raise MediaAssetError("SOURCE_SIZE", "Media source exceeds the size limit")
                    digest.update(chunk)
                    output_stream.write(chunk)
                output_stream.flush()
                os.fsync(output_stream.fileno())
                closed = os.fstat(input_stream.fileno())
                if (
                    copied != opened.st_size
                    or closed.st_size != opened.st_size
                    or closed.st_mtime_ns != opened.st_mtime_ns
                ):
                    raise MediaAssetError("SOURCE_CHANGED", "Media source changed during import")
            kind, mime_type, technical = _classify(staged_io)
            content_hash = digest.hexdigest()
            blob = _blob_path(root, content_hash)
            blob_io = managed_local_io_path(root.parent, blob)
            try:
                os.link(staged_io, blob_io)
            except FileExistsError:
                if not _verified_size_and_hash(blob_io, copied, content_hash):
                    raise MediaAssetError(
                        "CORRUPT_BLOB", "Managed media bytes are inconsistent"
                    ) from None
            else:
                if not _verified_size_and_hash(blob_io, copied, content_hash):
                    raise MediaAssetError(
                        "CORRUPT_BLOB", "Managed media bytes could not be verified"
                    )
            chosen_asset_id = asset_id or f"asset_{uuid4().hex}"
            version_id = f"asv_{uuid4().hex}"
            timestamp = _now()
            with self._repository._connection() as connection:
                try:
                    connection.execute("BEGIN IMMEDIATE")
                    if (
                        connection.execute(
                            "SELECT 1 FROM projects WHERE id = ?", (project_id,)
                        ).fetchone()
                        is None
                    ):
                        raise MediaAssetError("PROJECT_NOT_FOUND", "Project was not found")
                    if asset_id is None:
                        connection.execute(
                            """INSERT INTO media_assets (id, project_id, created_at)
                               VALUES (?, ?, ?)""",
                            (chosen_asset_id, project_id, timestamp),
                        )
                        ordinal = 1
                    else:
                        active = connection.execute(
                            """SELECT 1 FROM media_assets
                               WHERE project_id = ? AND id = ? AND deleted_at IS NULL""",
                            (project_id, asset_id),
                        ).fetchone()
                        if active is None:
                            raise MediaAssetError("ASSET_NOT_FOUND", "Media asset was not found")
                        current_kind = connection.execute(
                            """SELECT kind FROM media_asset_versions
                               WHERE asset_id = ? ORDER BY ordinal DESC LIMIT 1""",
                            (asset_id,),
                        ).fetchone()
                        if current_kind is None or str(current_kind[0]) != kind:
                            raise MediaAssetError(
                                "MEDIA_KIND_CONFLICT",
                                "A new asset version must keep the original media kind",
                            )
                        ordinal = int(
                            connection.execute(
                                """SELECT COALESCE(MAX(ordinal), 0) + 1
                               FROM media_asset_versions WHERE asset_id = ?""",
                                (asset_id,),
                            ).fetchone()[0]
                        )
                    connection.execute(
                        """INSERT INTO media_asset_versions (
                               id, project_id, asset_id, ordinal, filename, kind, mime_type,
                               byte_size, sha256, rights_status, source_kind,
                               technical_json, created_at
                           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW',
                                     'LOCAL_IMPORT', ?, ?)""",
                        (
                            version_id,
                            project_id,
                            chosen_asset_id,
                            ordinal,
                            filename,
                            kind,
                            mime_type,
                            copied,
                            content_hash,
                            json.dumps(technical, sort_keys=True, separators=(",", ":")),
                            timestamp,
                        ),
                    )
                    connection.commit()
                except BaseException:
                    connection.rollback()
                    raise
            return self.get_asset(project_id, chosen_asset_id, verify=True)
        finally:
            staged_io.unlink(missing_ok=True)

    def _asset_data(
        self,
        connection: sqlite3.Connection,
        row: sqlite3.Row,
        *,
        verify: bool,
    ) -> MediaAssetData:
        versions = connection.execute(
            """SELECT * FROM media_asset_versions WHERE project_id = ? AND asset_id = ?
               ORDER BY ordinal DESC""",
            (row["project_id"], row["id"]),
        ).fetchall()
        if not versions:
            raise MediaAssetError("CORRUPT_RECORD", "Media asset has no version")
        root = _media_root(self._repository)
        version_data = tuple(
            AssetVersionData(
                id=str(version["id"]),
                ordinal=int(version["ordinal"]),
                filename=str(version["filename"]),
                kind=cast(AssetKind, str(version["kind"])),
                mime_type=str(version["mime_type"]),
                byte_size=int(version["byte_size"]),
                sha256=str(version["sha256"]),
                rights_status=cast(RightsStatus, str(version["rights_status"])),
                technical_metadata=json.loads(str(version["technical_json"])),
                created_at=str(version["created_at"]),
                availability=_availability(
                    root.parent,
                    _blob_path(root, str(version["sha256"])),
                    int(version["byte_size"]),
                    str(version["sha256"]),
                    verify=verify or int(version["byte_size"]) <= MAX_INLINE_PREVIEW_BYTES,
                ),
            )
            for version in versions
        )
        references = connection.execute(
            """SELECT episode_id, version_id, role, created_at
               FROM media_asset_episode_references
               WHERE project_id = ? AND asset_id = ? ORDER BY created_at, episode_id""",
            (row["project_id"], row["id"]),
        ).fetchall()
        return MediaAssetData(
            id=str(row["id"]),
            project_id=str(row["project_id"]),
            created_at=str(row["created_at"]),
            latest_version=version_data[0],
            versions=version_data,
            episode_references=tuple(
                AssetEpisodeReferenceData(
                    episode_id=str(ref["episode_id"]),
                    version_id=str(ref["version_id"]),
                    role=str(ref["role"]),
                    created_at=str(ref["created_at"]),
                )
                for ref in references
            ),
        )

    def get_asset(self, project_id: str, asset_id: str, *, verify: bool = False) -> MediaAssetData:
        _require_id(project_id, _PROJECT_ID)
        _require_id(asset_id, _ASSET_ID)
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            row = connection.execute(
                "SELECT * FROM media_assets WHERE project_id = ? AND id = ? AND deleted_at IS NULL",
                (project_id, asset_id),
            ).fetchone()
            if row is None:
                raise MediaAssetError("ASSET_NOT_FOUND", "Media asset was not found")
            data = self._asset_data(connection, row, verify=verify)
            connection.commit()
            return data

    def list_assets(self, project_id: str) -> tuple[MediaAssetData, ...]:
        _require_id(project_id, _PROJECT_ID)
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            if (
                connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
                is None
            ):
                raise MediaAssetError("PROJECT_NOT_FOUND", "Project was not found")
            rows = connection.execute(
                """SELECT * FROM media_assets WHERE project_id = ? AND deleted_at IS NULL
                   ORDER BY created_at DESC, id DESC""",
                (project_id,),
            ).fetchall()
            data = tuple(self._asset_data(connection, row, verify=False) for row in rows)
            connection.commit()
            return data

    def add_episode_reference(
        self,
        project_id: str,
        asset_id: str,
        episode_id: str,
        version_id: str,
        role: str,
    ) -> MediaAssetData:
        _require_id(project_id, _PROJECT_ID)
        _require_id(asset_id, _ASSET_ID)
        _require_id(version_id, _VERSION_ID)
        if not 1 <= len(role) <= 80 or any(ord(char) < 32 for char in role):
            raise MediaAssetError("INVALID_ROLE", "Asset reference role is invalid")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                if (
                    connection.execute(
                        "SELECT 1 FROM episodes WHERE project_id = ? AND id = ?",
                        (project_id, episode_id),
                    ).fetchone()
                    is None
                ):
                    raise MediaAssetError("EPISODE_NOT_FOUND", "Episode was not found")
                if (
                    connection.execute(
                        """SELECT 1 FROM media_assets AS asset
                       JOIN media_asset_versions AS version ON version.asset_id = asset.id
                       WHERE asset.project_id = ? AND asset.id = ? AND asset.deleted_at IS NULL
                         AND version.id = ?""",
                        (project_id, asset_id, version_id),
                    ).fetchone()
                    is None
                ):
                    raise MediaAssetError("ASSET_NOT_FOUND", "Media asset version was not found")
                connection.execute(
                    """INSERT INTO media_asset_episode_references
                       (project_id, episode_id, asset_id, version_id, role, created_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (project_id, episode_id, asset_id, version_id, role, _now()),
                )
                connection.commit()
            except sqlite3.IntegrityError:
                connection.rollback()
                raise MediaAssetError(
                    "REFERENCE_EXISTS", "Episode asset reference already exists"
                ) from None
            except BaseException:
                connection.rollback()
                raise
        return self.get_asset(project_id, asset_id)

    def remove_episode_reference(
        self,
        project_id: str,
        asset_id: str,
        episode_id: str,
        role: str,
    ) -> MediaAssetData:
        _require_id(project_id, _PROJECT_ID)
        _require_id(asset_id, _ASSET_ID)
        if not 1 <= len(role) <= 80:
            raise MediaAssetError("INVALID_ROLE", "Asset reference role is invalid")
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                deleted = connection.execute(
                    """DELETE FROM media_asset_episode_references
                       WHERE project_id = ? AND episode_id = ? AND asset_id = ? AND role = ?""",
                    (project_id, episode_id, asset_id, role),
                ).rowcount
                if deleted != 1:
                    raise MediaAssetError(
                        "REFERENCE_NOT_FOUND", "Episode asset reference was not found"
                    )
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return self.get_asset(project_id, asset_id)

    def soft_delete(self, project_id: str, asset_id: str) -> None:
        _require_id(project_id, _PROJECT_ID)
        _require_id(asset_id, _ASSET_ID)
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """SELECT 1 FROM media_assets
                       WHERE project_id = ? AND id = ? AND deleted_at IS NULL""",
                    (project_id, asset_id),
                ).fetchone()
                if row is None:
                    raise MediaAssetError("ASSET_NOT_FOUND", "Media asset was not found")
                if (
                    connection.execute(
                        """SELECT 1 FROM media_asset_episode_references
                       WHERE project_id = ? AND asset_id = ?""",
                        (project_id, asset_id),
                    ).fetchone()
                    is not None
                ):
                    raise MediaAssetError(
                        "ASSET_REFERENCED", "Media asset is referenced by an episode"
                    )
                hashes = {
                    str(row[0])
                    for row in connection.execute(
                        """SELECT sha256 FROM media_asset_versions
                           WHERE project_id = ? AND asset_id = ?""",
                        (project_id, asset_id),
                    ).fetchall()
                }
                identities = hashes | {asset_id}
                artifacts = connection.execute(
                    """SELECT version.content_json FROM artifact_versions AS version
                       JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                       WHERE artifact.project_id = ?""",
                    (project_id,),
                ).fetchall()
                for artifact in artifacts:
                    try:
                        content = json.loads(str(artifact[0]))
                    except (ValueError, TypeError):
                        raise MediaAssetError(
                            "REFERENCE_UNKNOWN", "Artifact references could not be checked"
                        ) from None
                    if _contains_identity(content, identities):
                        raise MediaAssetError(
                            "ASSET_REFERENCED", "Media asset is referenced by an artifact"
                        )
                connection.execute(
                    "UPDATE media_assets SET deleted_at = ? WHERE project_id = ? AND id = ?",
                    (_now(), project_id, asset_id),
                )
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    def read_verified_preview(
        self,
        project_id: str,
        asset_id: str,
        version_id: str,
    ) -> tuple[bytes, str, str]:
        asset = self.get_asset(project_id, asset_id)
        version = next((item for item in asset.versions if item.id == version_id), None)
        if version is None:
            raise MediaAssetError("VERSION_NOT_FOUND", "Media asset version was not found")
        if version.byte_size > MAX_INLINE_PREVIEW_BYTES:
            raise MediaAssetError("PREVIEW_TOO_LARGE", "Media preview exceeds the inline limit")
        root = _media_root(self._repository)
        blob = _blob_path(root, version.sha256)
        try:
            blob_io = managed_local_io_path(root.parent, blob)
            with _open_local_source(blob_io) as stream:
                content = stream.read(MAX_INLINE_PREVIEW_BYTES + 1)
        except (OSError, ValueError):
            raise MediaAssetError("MEDIA_MISSING", "Managed media bytes are unavailable") from None
        if (
            len(content) != version.byte_size
            or hashlib.sha256(content).hexdigest() != version.sha256
        ):
            raise MediaAssetError("MEDIA_CORRUPT", "Managed media bytes failed verification")
        return content, version.mime_type, version.sha256
