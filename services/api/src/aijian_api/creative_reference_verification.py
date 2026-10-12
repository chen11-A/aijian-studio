"""Verify originals and latest audited rights on a new manual save or consumption."""

import sqlite3

from aijian_api.media_asset_contracts import MediaAssetData
from aijian_api.media_asset_rights_store import RightsDecisionError, _validated_history
from aijian_api.media_asset_store import MediaAssetError, MediaAssetStore
from aijian_api.project_character_details_contracts import ProjectCharacterReferenceV1
from aijian_api.project_environment_contracts import ProjectEnvironmentReferenceV1
from aijian_api.repository import StudioRepository


class CreativeReferenceRejectedError(ValueError):
    pass


def verify_creative_references(
    repository: StudioRepository,
    project_id: str,
    references: tuple[ProjectCharacterReferenceV1 | ProjectEnvironmentReferenceV1, ...],
    *,
    connection: sqlite3.Connection,
) -> None:
    originals = MediaAssetStore(repository)
    checked: dict[str, MediaAssetData] = {}
    for reference in references:
        if reference.asset_id not in checked:
            try:
                checked[reference.asset_id] = originals.get_asset(
                    project_id, reference.asset_id, verify=True
                )
            except (MediaAssetError, OSError, ValueError) as error:
                raise CreativeReferenceRejectedError(
                    "Reference asset could not be verified"
                ) from error
        asset = checked[reference.asset_id]
        version = next(
            (item for item in asset.versions if item.id == reference.asset_version_id), None
        )
        if (
            asset.project_id != project_id
            or version is None
            or version.kind not in ("image", "video")
            or version.sha256 != reference.asset_sha256
            or version.availability != "VERIFIED"
        ):
            raise CreativeReferenceRejectedError("Reference identity or original bytes are invalid")
        try:
            decisions = _validated_history(
                connection, project_id, reference.asset_id, version.id, version.sha256
            )
        except (RightsDecisionError, sqlite3.DatabaseError, ValueError, TypeError) as error:
            raise CreativeReferenceRejectedError("Reference rights audit is invalid") from error
        rights = decisions[-1].decision if decisions else version.rights_status
        if rights == "RESTRICTED":
            raise CreativeReferenceRejectedError("Reference rights are restricted")
