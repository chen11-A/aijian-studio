"""Audio timing evidence in the existing immutable selected-media probe table."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_asset_probe_store import (
    MediaAssetProbeEvidenceError,
    _managed_path,
    _selected_row,
    _verify_probe_row,
    persist_selected_probe,
)
from aijian_api.media_probe import LocalAudioProbeData, probe_local_audio
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.repository import StudioRepository


@dataclass(frozen=True, slots=True)
class AudioAssetProbeEvidence:
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
    probe: LocalAudioProbeData


def _from_audio_row(row: sqlite3.Row) -> AudioAssetProbeEvidence:
    raw = _verify_probe_row(row)
    try:
        probe = LocalAudioProbeData.model_validate_json(raw)
        if probe.model_dump(mode="json") != json.loads(raw):
            raise ValueError("Stored audio evidence changed during validation")
    except (ValueError, TypeError):
        raise MediaAssetProbeEvidenceError(
            "PROBE_RECORD_CORRUPT", "Stored audio evidence is invalid"
        ) from None
    if probe.source_asset_sha256 != "sha256:" + str(row["asset_sha256"]) or probe.byte_size != int(
        row["byte_size"]
    ):
        raise MediaAssetProbeEvidenceError(
            "PROBE_IDENTITY_CONFLICT", "Audio probe differs from selected original"
        )
    return AudioAssetProbeEvidence(
        id=str(row["id"]),
        project_id=str(row["project_id"]),
        asset_id=str(row["asset_id"]),
        version_id=str(row["version_id"]),
        asset_sha256=str(row["asset_sha256"]),
        byte_size=int(row["byte_size"]),
        probe_sha256=str(row["probe_sha256"]),
        toolchain_profile_id=str(row["toolchain_profile_id"]),
        toolchain_version=str(row["toolchain_version"]),
        ffmpeg_sha256=str(row["ffmpeg_sha256"]),
        ffprobe_sha256=str(row["ffprobe_sha256"]),
        created_at=str(row["created_at"]),
        probe=probe,
    )


class AudioAssetProbeEvidenceStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def read(
        self, project_id: str, asset_id: str, version_id: str
    ) -> AudioAssetProbeEvidence | None:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            selected = _selected_row(connection, project_id, asset_id, version_id, kind="audio")
            row = connection.execute(
                "SELECT * FROM media_asset_probe_evidence "
                "WHERE project_id=? AND asset_id=? AND version_id=?",
                (project_id, asset_id, version_id),
            ).fetchone()
            connection.commit()
        if row is None:
            return None
        evidence = _from_audio_row(row)
        if evidence.asset_sha256 != str(selected["sha256"]) or evidence.byte_size != int(
            selected["byte_size"]
        ):
            raise MediaAssetProbeEvidenceError(
                "PROBE_IDENTITY_CONFLICT", "Audio evidence differs from stored version"
            )
        return evidence

    def probe_selected_audio(
        self, project_id: str, asset_id: str, version_id: str, toolchain: MediaToolchain
    ) -> AudioAssetProbeEvidence:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            selected = _selected_row(connection, project_id, asset_id, version_id, kind="audio")
            digest, byte_size = str(selected["sha256"]), int(selected["byte_size"])
        source = _managed_path(self._repository, digest)
        try:
            source_io = managed_local_io_path(
                self._repository.database_path.parent.absolute(), source
            )
        except (OSError, ValueError):
            raise MediaAssetProbeEvidenceError(
                "MEDIA_PATH_UNAVAILABLE", "Managed audio is missing or unsafe"
            ) from None
        probe = probe_local_audio(source_io, toolchain)
        if probe.source_asset_sha256 != "sha256:" + digest or probe.byte_size != byte_size:
            raise MediaAssetProbeEvidenceError(
                "MEDIA_IDENTITY_CHANGED", "Audio probe bytes differ from selected version"
            )
        return _from_audio_row(
            persist_selected_probe(
                self._repository, project_id, asset_id, version_id, probe, toolchain, kind="audio"
            )
        )
