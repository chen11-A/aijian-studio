"""Same-transaction, bounded read of one exact LOCAL_IMPORT media version."""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

from aijian_api.local_media_original import _availability
from aijian_api.manual_media_candidate_contracts import MAX_ASSET_METADATA_BYTES
from aijian_api.media_asset_rights_store import _validated_history
from aijian_api.media_asset_selected_reader import SelectedMediaAssetVersion, _version_from_row

if TYPE_CHECKING:
    from aijian_api.repository import StudioRepository


def exact_local_original(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project_id: str,
    asset_id: str,
    version_id: str,
    sha256: str,
    *,
    fresh: bool,
) -> SelectedMediaAssetVersion:
    size = connection.execute(
        "SELECT length(CAST(technical_json AS BLOB)) FROM media_asset_versions "
        "WHERE project_id=? AND asset_id=? AND id=?",
        (project_id, asset_id, version_id),
    ).fetchone()
    if size is None or size[0] > MAX_ASSET_METADATA_BYTES:
        raise ValueError("Exact media metadata is missing or exceeds its SQL budget")
    row = connection.execute(
        "SELECT * FROM media_asset_versions WHERE project_id=? AND asset_id=? AND id=?",
        (project_id, asset_id, version_id),
    ).fetchone()
    version = _version_from_row(row, [])
    if version.kind not in ("image", "video") or version.sha256 != sha256:
        raise ValueError("Exact selected visual original differs")
    if fresh:
        active = connection.execute(
            "SELECT 1 FROM media_assets WHERE project_id=? AND id=? AND deleted_at IS NULL",
            (project_id, asset_id),
        ).fetchone()
        if active is None:
            raise ValueError("Selected original asset is no longer active")
        history = _validated_history(connection, project_id, asset_id, version_id, sha256)
        if (history[-1].decision if history else version.rights_status) == "RESTRICTED":
            raise ValueError("Selected original latest rights are restricted")
        if _availability(repository.database_path, sha256, version.byte_size) != "VERIFIED":
            raise ValueError("Exact original bytes cannot be verified within DRAFT limits")
    return version
