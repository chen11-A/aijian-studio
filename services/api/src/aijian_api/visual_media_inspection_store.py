"""Explicit native decoder evidence, separate from human approval and rights."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.repository import StudioRepository
from aijian_api.visual_bible_contracts import VisualImageInspectionData, VisualImageInspectionInput


class VisualInspectionError(ValueError):
    pass


def verified_inspection(row: sqlite3.Row) -> VisualImageInspectionData:
    try:
        result = VisualImageInspectionData.model_validate_json(str(row["evidence_json"]))
        unhashed = result.model_dump(mode="json", exclude={"evidence_hash"})
        if (
            canonical_content_hash(unhashed) != result.evidence_hash
            or result.evidence_hash != str(row["evidence_hash"])
            or result.id != str(row["inspection_id"])
            or result.project_id != str(row["project_id"])
            or result.asset_id != str(row["asset_id"])
            or result.asset_version_id != str(row["version_id"])
            or result.evidence.asset_sha256 != str(row["asset_sha256"])
            or result.evidence.operation_id != str(row["operation_id"])
            or result.created_at.isoformat() != str(row["created_at"])
            or str(row["request_hash"])
            != inspection_request_hash(
                result.project_id,
                result.asset_id,
                result.asset_version_id,
                result.actor_id,
                result.evidence,
            )
        ):
            raise ValueError("Inspection identity/hash mismatch")
        return result
    except (ValueError, TypeError, KeyError) as error:
        raise VisualInspectionError("Native inspection evidence failed integrity checks") from error


def inspection_request_hash(
    project_id: str,
    asset_id: str,
    version_id: str,
    actor_id: str,
    evidence: VisualImageInspectionInput,
) -> str:
    return canonical_content_hash(
        {
            "project_id": project_id,
            "asset_id": asset_id,
            "version_id": version_id,
            "actor_id": actor_id,
            "evidence": evidence.model_dump(mode="json"),
        }
    )


class VisualMediaInspectionStore:
    def __init__(self, repository: StudioRepository) -> None:
        self.repository = repository

    def read_operation(self, project_id: str, operation_id: str) -> VisualImageInspectionData:
        with self.repository._connection() as connection:
            row = connection.execute(
                "SELECT * FROM visual_media_inspections WHERE project_id=? AND operation_id=?",
                (project_id, operation_id),
            ).fetchone()
            if row is None:
                raise VisualInspectionError("Native inspection operation was not found")
            return verified_inspection(row)

    def append(
        self,
        project_id: str,
        asset_id: str,
        version_id: str,
        evidence: VisualImageInspectionInput,
        *,
        actor_id: str,
    ) -> tuple[VisualImageInspectionData, bool]:
        evidence = VisualImageInspectionInput.model_validate(evidence.model_dump(mode="python"))
        if not actor_id.strip() or len(actor_id) > 240:
            raise VisualInspectionError("Trusted native actor is required")
        request_hash = inspection_request_hash(project_id, asset_id, version_id, actor_id, evidence)
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM visual_media_inspections WHERE project_id=? AND operation_id=?",
                (project_id, evidence.operation_id),
            ).fetchone()
            if row is not None:
                original = verified_inspection(row)
                if str(row["request_hash"]) != request_hash:
                    raise VisualInspectionError("Native inspection operation was reused")
                connection.commit()
                return original, True
            asset = MediaAssetStore(self.repository).get_asset(project_id, asset_id, verify=True)
            version = next((v for v in asset.versions if v.id == version_id), None)
            if (
                version is None
                or version.kind != "image"
                or version.availability != "VERIFIED"
                or version.sha256 != evidence.asset_sha256
                or version.byte_size != evidence.byte_size
                or version.mime_type != evidence.mime_type
            ):
                raise VisualInspectionError("Decoded original no longer matches the exact asset")
            created_at = datetime.now(UTC)
            value = {
                "id": "vin_" + uuid4().hex,
                "project_id": project_id,
                "asset_id": asset_id,
                "asset_version_id": version_id,
                "actor_id": actor_id,
                "evidence": evidence.model_dump(mode="json"),
                "created_at": created_at,
            }
            # Hash JSON serialization, including scope and trusted actor, rather than pixels alone.
            serial = {**value, "created_at": created_at.isoformat().replace("+00:00", "Z")}
            result = VisualImageInspectionData.model_validate(
                {
                    **value,
                    "evidence_hash": canonical_content_hash(serial),
                }
            )
            connection.execute(
                """INSERT INTO visual_media_inspections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    result.id,
                    project_id,
                    asset_id,
                    version_id,
                    evidence.asset_sha256,
                    evidence.operation_id,
                    request_hash,
                    canonical_content_bytes(result.model_dump(mode="json")).decode("utf-8"),
                    result.evidence_hash,
                    result.created_at.isoformat(),
                ),
            )
            connection.commit()
            return result, False
