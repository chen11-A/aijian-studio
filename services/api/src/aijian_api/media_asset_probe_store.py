"""Bind a pinned local ffprobe result to one immutable media asset version."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from aijian_api.artifacts import canonical_content_bytes
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_probe import LocalMediaProbeData, _is_remote_windows_path, probe_local_media
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.repository import StudioRepository

MAX_PERSISTED_PROBE_BYTES = 8 * 1024 * 1024


class MediaAssetProbeEvidenceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class MediaAssetProbeEvidence:
    id: str
    project_id: str
    asset_id: str
    version_id: str
    asset_sha256: str
    byte_size: int
    probe_sha256: str
    toolchain_profile_id: str
    toolchain_version: str
    ffmpeg_sha256: str
    ffprobe_sha256: str
    created_at: str
    probe: LocalMediaProbeData


def _plain_directory(path: Path) -> bool:
    try:
        return path.is_dir() and not path.is_symlink() and path.resolve(strict=True) == path
    except (OSError, RuntimeError):
        return False


def _selected_row(
    connection: sqlite3.Connection, project_id: str, asset_id: str, version_id: str,
) -> sqlite3.Row:
    row: object = connection.execute(
        """SELECT version.sha256, version.byte_size, version.kind
           FROM media_asset_versions AS version
           JOIN media_assets AS asset ON asset.project_id = version.project_id
             AND asset.id = version.asset_id
           WHERE version.project_id = ? AND version.asset_id = ? AND version.id = ?
             AND asset.deleted_at IS NULL""",
        (project_id, asset_id, version_id),
    ).fetchone()
    if row is None:
        raise MediaAssetProbeEvidenceError(
            "ASSET_VERSION_NOT_FOUND", "Selected media version was not found",
        )
    if not isinstance(row, sqlite3.Row):
        raise MediaAssetProbeEvidenceError(
            "MEDIA_RECORD_CORRUPT", "Selected media metadata is not a SQLite row",
        )
    if str(row["kind"]) != "video":
        raise MediaAssetProbeEvidenceError(
            "VIDEO_REQUIRED", "Only video originals can use this probe contract",
        )
    return row


def _managed_path(repository: StudioRepository, digest: str) -> Path:
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise MediaAssetProbeEvidenceError("MEDIA_RECORD_CORRUPT", "Stored media hash is invalid")
    workspace = repository.database_path.parent.absolute()
    root = workspace / "media-assets"
    blobs = root / "blobs"
    prefix = blobs / digest[:2]
    try:
        directories = tuple(
            managed_local_io_path(workspace, item)
            for item in (workspace, root, blobs, prefix)
        )
    except (OSError, ValueError):
        raise MediaAssetProbeEvidenceError("MEDIA_PATH_UNAVAILABLE", "Managed original path is missing or unsafe") from None
    if _is_remote_windows_path(workspace) or not all(
        _plain_directory(item) for item in directories
    ):
        raise MediaAssetProbeEvidenceError("MEDIA_PATH_UNAVAILABLE", "Managed original path is missing or unsafe")
    source = prefix / digest
    try:
        source_io = managed_local_io_path(workspace, source)
    except (OSError, ValueError):
        raise MediaAssetProbeEvidenceError("MEDIA_PATH_UNAVAILABLE", "Managed original is missing or unsafe") from None
    if source_io.is_symlink() or not source_io.is_file():
        raise MediaAssetProbeEvidenceError("MEDIA_PATH_UNAVAILABLE", "Managed original is missing or unsafe")
    return source


def _from_row(row: sqlite3.Row) -> MediaAssetProbeEvidence:
    raw = str(row["probe_json"]).encode("utf-8")
    if len(raw) > MAX_PERSISTED_PROBE_BYTES or hashlib.sha256(raw).hexdigest() != str(row["probe_sha256"]):
        raise MediaAssetProbeEvidenceError("PROBE_RECORD_CORRUPT", "Stored probe evidence hash is invalid")
    try:
        probe = LocalMediaProbeData.model_validate(json.loads(raw))
    except (ValueError, TypeError):
        raise MediaAssetProbeEvidenceError("PROBE_RECORD_CORRUPT", "Stored probe evidence is invalid") from None
    if (
        probe.source_asset_sha256 != "sha256:" + str(row["asset_sha256"])
        or probe.byte_size != int(row["byte_size"])
    ):
        raise MediaAssetProbeEvidenceError("PROBE_IDENTITY_CONFLICT", "Probe evidence differs from selected media")
    return MediaAssetProbeEvidence(
        id=str(row["id"]), project_id=str(row["project_id"]),
        asset_id=str(row["asset_id"]), version_id=str(row["version_id"]),
        asset_sha256=str(row["asset_sha256"]), byte_size=int(row["byte_size"]),
        probe_sha256=str(row["probe_sha256"]),
        toolchain_profile_id=str(row["toolchain_profile_id"]),
        toolchain_version=str(row["toolchain_version"]),
        ffmpeg_sha256=str(row["ffmpeg_sha256"]), ffprobe_sha256=str(row["ffprobe_sha256"]),
        created_at=str(row["created_at"]), probe=probe,
    )


class MediaAssetProbeEvidenceStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def read(self, project_id: str, asset_id: str, version_id: str) -> MediaAssetProbeEvidence | None:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            selected = _selected_row(connection, project_id, asset_id, version_id)
            row = connection.execute(
                """SELECT * FROM media_asset_probe_evidence
                   WHERE project_id = ? AND asset_id = ? AND version_id = ?""",
                (project_id, asset_id, version_id),
            ).fetchone()
            connection.commit()
        if row is None:
            return None
        evidence = _from_row(row)
        if evidence.asset_sha256 != str(selected["sha256"]) or evidence.byte_size != int(selected["byte_size"]):
            raise MediaAssetProbeEvidenceError("PROBE_IDENTITY_CONFLICT", "Probe evidence differs from stored media version")
        return evidence

    def probe_selected_video(
        self, project_id: str, asset_id: str, version_id: str, toolchain: MediaToolchain,
    ) -> MediaAssetProbeEvidence:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            selected = _selected_row(connection, project_id, asset_id, version_id)
            digest, byte_size = str(selected["sha256"]), int(selected["byte_size"])
        source = _managed_path(self._repository, digest)
        try:
            source_io = managed_local_io_path(
                self._repository.database_path.parent.absolute(), source,
            )
        except (OSError, ValueError):
            raise MediaAssetProbeEvidenceError(
                "MEDIA_PATH_UNAVAILABLE", "Managed original is missing or unsafe",
            ) from None
        probe = probe_local_media(source_io, toolchain)
        if probe.source_asset_sha256 != "sha256:" + digest or probe.byte_size != byte_size:
            raise MediaAssetProbeEvidenceError("MEDIA_IDENTITY_CHANGED", "Probed bytes differ from the selected version")
        payload = probe.model_dump(mode="json")
        canonical = canonical_content_bytes(payload)
        if len(canonical) > MAX_PERSISTED_PROBE_BYTES:
            raise MediaAssetProbeEvidenceError("PROBE_EVIDENCE_TOO_LARGE", "Probe evidence exceeds persistence limit")
        probe_sha256 = hashlib.sha256(canonical).hexdigest()
        with self._repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                current = _selected_row(connection, project_id, asset_id, version_id)
                if str(current["sha256"]) != digest or int(current["byte_size"]) != byte_size:
                    raise MediaAssetProbeEvidenceError("MEDIA_IDENTITY_CHANGED", "Selected version changed during probe")
                existing = connection.execute(
                    """SELECT * FROM media_asset_probe_evidence
                       WHERE project_id = ? AND asset_id = ? AND version_id = ?""",
                    (project_id, asset_id, version_id),
                ).fetchone()
                if existing is not None:
                    evidence = _from_row(existing)
                    if (
                        evidence.probe_sha256 != probe_sha256
                        or evidence.toolchain_profile_id != toolchain.profile_id
                        or evidence.toolchain_version != toolchain.version
                        or evidence.ffmpeg_sha256 != toolchain.ffmpeg_sha256
                        or evidence.ffprobe_sha256 != toolchain.ffprobe_sha256
                    ):
                        raise MediaAssetProbeEvidenceError("PROBE_EVIDENCE_CONFLICT", "A different immutable probe already exists")
                else:
                    evidence_id = f"mpe_{uuid4().hex}"
                    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    connection.execute(
                        """INSERT INTO media_asset_probe_evidence (
                             id, project_id, asset_id, version_id, asset_sha256, byte_size,
                             probe_json, probe_sha256, toolchain_profile_id, toolchain_version,
                             ffmpeg_sha256, ffprobe_sha256, created_at
                           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (evidence_id, project_id, asset_id, version_id, digest, byte_size,
                         canonical.decode("utf-8"), probe_sha256, toolchain.profile_id,
                         toolchain.version, toolchain.ffmpeg_sha256,
                         toolchain.ffprobe_sha256, timestamp),
                    )
                    row = connection.execute(
                        "SELECT * FROM media_asset_probe_evidence WHERE id = ?", (evidence_id,),
                    ).fetchone()
                    assert row is not None
                    evidence = _from_row(row)
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return evidence
