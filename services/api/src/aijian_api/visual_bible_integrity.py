"""Exact G5 sources and fresh approval evidence; no decoder/provider side effects."""

from __future__ import annotations

import sqlite3

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.media_asset_contracts import AssetVersionData, MediaAssetData
from aijian_api.media_asset_rights_store import _validated_history
from aijian_api.media_asset_selected_reader import SelectedMediaAssetVersion
from aijian_api.media_asset_store import MediaAssetError, MediaAssetStore
from aijian_api.project_creative_library_contracts import ProjectCreativeLibraryContent
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.repository import StudioRepository
from aijian_api.visual_bible_contracts import (
    MAX_VISUAL_BIBLE_BYTES,
    VISUAL_BIBLE_CONTENT,
    VisualAssetReferenceV1,
    VisualBibleContent,
    VisualBibleVersionData,
)
from aijian_api.visual_environment_scope import environment_projection, environment_sources
from aijian_api.visual_media_inspection_store import verified_inspection


class VisualBibleIntegrityError(ValueError):
    pass


def visual_version(record: ArtifactVersionRecord, project_id: str) -> VisualBibleVersionData:
    v = record.version
    content = VISUAL_BIBLE_CONTENT.validate_python(v.content)
    expected = [(content.creative_library_version_id, "references", "blocking")]
    actual = [(x.upstream_version_id, x.relationship, x.impact) for x in record.dependencies]
    if (
        content.project_id != project_id
        or v.schema_version != content.schema_version
        or v.content_hash != canonical_content_hash(v.content)
        or record.source_spans
        or len(canonical_content_bytes(v.content)) > MAX_VISUAL_BIBLE_BYTES
        or sorted(actual) != expected
    ):
        raise VisualBibleIntegrityError("Visual version bytes/scope/dependencies are inconsistent")
    return VisualBibleVersionData(
        id=v.id,
        artifact_id=v.artifact_id,
        version_number=v.version_number,
        content=content,
        content_hash=v.content_hash,
        parent_version_id=v.parent_version_id,
        author_actor_id=v.author_actor_id,
        change_summary=v.change_summary,
        created_at=v.created_at,
    )


def visual_sources(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    content: VisualBibleContent,
) -> tuple[ProjectCreativeLibraryContent, tuple[VisualAssetReferenceV1, ...]]:
    record = repository._get_artifact_version_in_connection(
        connection,
        project_id=content.project_id,
        episode_id=None,
        artifact_type="project_creative_library",
        version_id=content.creative_library_version_id,
    )
    library = ProjectCreativeLibraryStore._version_data(record, project_id=content.project_id)
    if library.content_hash != content.creative_library_content_hash:
        raise VisualBibleIntegrityError("Visual library hash differs from the pinned version")
    source = library.content
    refs = source.references if source.schema_version in ("1.2.0", "1.3.0") else ()
    selected = {x.reference_id: x for x in refs}
    if not set(content.character_reference_ids) <= selected.keys():
        raise VisualBibleIntegrityError("Visual character reference is outside the pinned library")
    if not {x.scene_id for x in content.scenes} <= {x.scene_id for x in source.scenes}:
        raise VisualBibleIntegrityError("Visual scene is outside the pinned library")
    result = {
        (x.asset_id, x.asset_version_id): VisualAssetReferenceV1(
            asset_id=x.asset_id,
            asset_version_id=x.asset_version_id,
            sha256=x.asset_sha256,
        )
        for key, x in selected.items()
        if key in content.character_reference_ids
    }
    environment_assets = tuple(
        VisualAssetReferenceV1(
            asset_id=r.asset_id, asset_version_id=r.asset_version_id, sha256=r.asset_sha256
        )
        for r in environment_sources(content, source)
    )
    for assets in (
        [x.assets for x in content.scenes]
        + [x.assets for x in content.props]
        + [environment_assets]
    ):
        for x in assets:
            key = (x.asset_id, x.asset_version_id)
            if key in result and result[key].sha256 != x.sha256:
                raise VisualBibleIntegrityError("One original cannot have two pinned hashes")
            result[key] = x
    return source, tuple(result[key] for key in sorted(result))


def verify_visual_originals(
    repository: StudioRepository,
    project_id: str,
    references: tuple[VisualAssetReferenceV1, ...],
) -> dict[tuple[str, str], MediaAssetData]:
    store = MediaAssetStore(repository)
    cache: dict[str, MediaAssetData] = {}
    result: dict[tuple[str, str], MediaAssetData] = {}
    for ref in references:
        if ref.asset_id not in cache:
            cache[ref.asset_id] = store.get_asset(project_id, ref.asset_id, verify=True)
        asset = cache[ref.asset_id]
        version = next((v for v in asset.versions if v.id == ref.asset_version_id), None)
        if (
            asset.project_id != project_id
            or version is None
            or version.kind not in ("image", "video")
            or version.sha256 != ref.sha256
            or version.availability != "VERIFIED"
        ):
            raise VisualBibleIntegrityError("Visual original is unavailable or changed")
        result[(ref.asset_id, ref.asset_version_id)] = asset
    return result


def fresh_visual_readiness(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    record: ArtifactVersionRecord,
    project_id: str,
    *,
    exact_originals: bool = False,
) -> dict[str, object]:
    """Checked inside the review transaction, again on every challenge consumption."""
    bible = visual_version(record, project_id)
    library, references = visual_sources(repository, connection, bible.content)
    blocking: list[str] = []
    projection = environment_projection(bible.content, library)
    environment_report: dict[str, object] = {}
    if projection is not None:
        environment_report["environment_projection"] = projection
        assert bible.content.schema_version == "1.1.0"
        refs = environment_sources(bible.content, library)
        for id in bible.content.environment_scope.scene_variant_ids:
            if not any(r.variant_id == id for r in refs):
                blocking.append("environment_state_reference_incomplete:" + id)
    if not library.characters:
        blocking.append("missing_core_character")
    selected = (
        [r for r in library.references if r.reference_id in bible.content.character_reference_ids]
        if library.schema_version in ("1.2.0", "1.3.0")
        else []
    )
    if {x.character_id for x in selected} != {x.character_id for x in library.characters}:
        blocking.append("character_identity_reference_incomplete")
    costumes = library.costumes if library.schema_version in ("1.1.0", "1.2.0", "1.3.0") else ()
    if not {x.costume_id for x in costumes} <= {x.costume_id for x in selected}:
        blocking.append("costume_reference_incomplete")
    if {x.scene_id for x in bible.content.scenes} != {x.scene_id for x in library.scenes} or any(
        not x.assets for x in bible.content.scenes
    ):
        blocking.append("scene_reference_incomplete")
    if any(not x.assets for x in bible.content.props):
        blocking.append("prop_reference_incomplete")
    if bible.content.schema_version == "1.1.0" and len(references) > 6000:
        # Preserve the existing trusted review DTO inventory budget. A new scope
        # must never mint a ready report that the native closed guard cannot read.
        return {
            "ready": False,
            "blocking": [*blocking, "visual_original_review_budget_exceeded"],
            "version_id": bible.id,
            "content_hash": bible.content_hash,
            "creative_library_version_id": bible.content.creative_library_version_id,
            "creative_library_content_hash": bible.content.creative_library_content_hash,
            "effective_scope": bible.content.effective_scope,
            "props_declared_empty": len(bible.content.props) == 0,
            "originals": [],
            **environment_report,
        }
    evidence: list[dict[str, object]] = []
    try:
        if exact_originals:
            from aijian_api.manual_media_original import exact_local_original

            exact_versions = {
                (ref.asset_id, ref.asset_version_id): exact_local_original(
                    repository,
                    connection,
                    project_id,
                    ref.asset_id,
                    ref.asset_version_id,
                    ref.sha256,
                    fresh=True,
                )
                for ref in references
            }
            originals = {}
        else:
            exact_versions = {}
            originals = verify_visual_originals(repository, project_id, references)
    except (VisualBibleIntegrityError, MediaAssetError, OSError, ValueError):
        return {
            "ready": False,
            "blocking": [*blocking, "original_unavailable_or_changed"],
            "version_id": bible.id,
            "content_hash": bible.content_hash,
            "creative_library_version_id": bible.content.creative_library_version_id,
            "creative_library_content_hash": bible.content.creative_library_content_hash,
            "effective_scope": bible.content.effective_scope,
            "props_declared_empty": len(bible.content.props) == 0,
            "originals": [],
            **environment_report,
        }
    version: SelectedMediaAssetVersion | AssetVersionData
    for ref in references:
        if exact_originals:
            version = exact_versions[(ref.asset_id, ref.asset_version_id)]
        else:
            asset = originals[(ref.asset_id, ref.asset_version_id)]
            version = next(v for v in asset.versions if v.id == ref.asset_version_id)
        rights = _validated_history(
            connection, project_id, ref.asset_id, ref.asset_version_id, ref.sha256
        )
        if not rights or rights[-1].decision != "CLEARED":
            blocking.append("rights_not_cleared:" + ref.asset_version_id)
        inspection = connection.execute(
            """SELECT * FROM visual_media_inspections WHERE project_id=? AND asset_id=?
               AND version_id=? ORDER BY created_at DESC, inspection_id DESC LIMIT 1""",
            (project_id, ref.asset_id, ref.asset_version_id),
        ).fetchone()
        technical_hash: str | None = None
        if inspection is not None:
            checked = verified_inspection(inspection)
            if (
                checked.evidence.asset_sha256 != version.sha256
                or checked.evidence.byte_size != version.byte_size
                or checked.evidence.mime_type != version.mime_type
                or version.kind != "image"
            ):
                raise VisualBibleIntegrityError("Technical inspection differs from original")
            technical_hash = checked.evidence_hash
        if technical_hash is None:
            blocking.append("technical_inspection_missing:" + ref.asset_version_id)
        evidence.append(
            {
                **ref.model_dump(mode="json"),
                "byte_size": version.byte_size,
                "rights_decision_id": rights[-1].decision_id if rights else None,
                "rights_revision": rights[-1].revision if rights else 0,
                "rights_evidence_sha256": rights[-1].evidence_sha256 if rights else None,
                "technical_evidence_hash": technical_hash,
            }
        )
    return {
        "ready": not blocking,
        "blocking": blocking,
        "version_id": bible.id,
        "content_hash": bible.content_hash,
        "creative_library_version_id": bible.content.creative_library_version_id,
        "creative_library_content_hash": bible.content.creative_library_content_hash,
        "effective_scope": bible.content.effective_scope,
        "props_declared_empty": len(bible.content.props) == 0,
        "originals": evidence,
        **environment_report,
    }
