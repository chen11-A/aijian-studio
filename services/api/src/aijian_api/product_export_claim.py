"""Atomic formal export claim, currently closed until a release encoder is approved.

The sole initial engineering profile is DEVELOPMENT_ONLY. This module keeps
release profiles empty until REL02 supplies an independently approved lock and
license record. No route may treat engineering output as a product claim.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.episode_media_assembly_contracts import (
    ASSEMBLY_ARTIFACT_TYPE, ASSEMBLY_SCHEMA_VERSION,
    AssemblySubtitleSegmentV1, EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import _validate_script_refs
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceStore
from aijian_api.media_asset_rights_store import RightsDecisionError, _validated_history
from aijian_api.media_asset_selected_reader import (
    SelectedMediaAssetVersion, read_selected_media_asset_version,
)
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest, ProductExportOperationData,
)
from aijian_api.product_export_output_verify import output_target_identity
from aijian_api.product_export_render_plan import build_single_video_render_plan
from aijian_api.product_export_store import (
    ProductExportStateError, ProductExportStore, _now,
)
from aijian_api.repository import StudioRepository

_PROJECT = re.compile(r"prj_[0-9a-f]{32}\Z")
_EPISODE = re.compile(r"ep_(?:prj_)?[0-9a-f]{32}\Z")
_APPROVED_RELEASE_PROFILES: frozenset[tuple[str, str, str]] = frozenset()


class ProductExportClaimError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def require_release_profile_configured() -> None:
    """Reject a new claim before tool discovery while the allowlist is empty."""
    if not _APPROVED_RELEASE_PROFILES:
        raise ProductExportClaimError(
            "RELEASE_TOOLCHAIN_NOT_APPROVED", "No product export encoder is approved",
        )


def _request_identity(
    project_id: str, episode_id: str, request: ProductExportClaimRequest,
) -> tuple[ProductExportClaimRequest, str, str]:
    """Use one normalized request and hash for replay and a new claim."""
    if _PROJECT.fullmatch(project_id) is None or _EPISODE.fullmatch(episode_id) is None:
        raise ProductExportClaimError("INVALID_SCOPE", "Product export scope is invalid")
    request = ProductExportClaimRequest.model_validate(request.model_dump(mode="python"))
    request_data = request.model_dump(mode="json")
    request_json = canonical_content_bytes(request_data).decode("utf-8")
    request_hash = canonical_content_hash({
        "project_id": project_id, "episode_id": episode_id,
        "request": request_data,
    })
    return request, request_json, request_hash


def _require_matching_operation_hash(existing_hash: str, request_hash: str) -> None:
    if existing_hash != request_hash:
        raise ProductExportClaimError("OPERATION_CONFLICT", "Operation ID was reused with different input")


def _selected_tracks(content: EpisodeMediaAssemblyContentV1) -> tuple[tuple[str, str, object], ...]:
    tracks: dict[tuple[str, str], tuple[str, str, object]] = {}
    for segment in content.visual_segments:
        item = ("VISUAL", segment.media_kind, segment.media)
        key = (segment.media.asset_id, segment.media.asset_version_id)
        if key in tracks and tracks[key] != item:
            raise ProductExportClaimError("MEDIA_TRACK_CONFLICT", "Media version has conflicting track roles")
        tracks[key] = item
    for segment in content.audio_segments:
        item = (segment.track_kind, "audio", segment.media)
        key = (segment.media.asset_id, segment.media.asset_version_id)
        if key in tracks and tracks[key] != item:
            raise ProductExportClaimError("MEDIA_TRACK_CONFLICT", "Media version has conflicting track roles")
        tracks[key] = item
    if not 1 <= len(tracks) <= 8:
        raise ProductExportClaimError("MEDIA_INPUT_LIMIT", "This export path supports at most eight selected versions")
    return tuple(tracks.values())


def _formal_script_subtitles(
    content: EpisodeMediaAssemblyContentV1,
) -> tuple[AssemblySubtitleSegmentV1, ...]:
    """DRAFT literal cues must never be discarded or coerced into formal inputs."""
    subtitles: list[AssemblySubtitleSegmentV1] = []
    for subtitle in content.subtitle_segments:
        if not isinstance(subtitle, AssemblySubtitleSegmentV1):
            raise ProductExportClaimError(
                "SUBTITLE_UNSUPPORTED",
                "Literal text subtitles are DRAFT-only; formal subtitle rendering is not approved",
            )
        subtitles.append(subtitle)
    return tuple(subtitles)


def _assembly_in_transaction(
    connection: sqlite3.Connection, project_id: str, episode_id: str,
    request: ProductExportClaimRequest,
) -> EpisodeMediaAssemblyContentV1:
    row = connection.execute(
        """SELECT version.content_json, version.content_hash, version.schema_version,
                  head.latest_version_id, head.revision
           FROM artifacts AS artifact
           JOIN artifact_versions AS version ON version.artifact_id = artifact.artifact_id
           JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
           WHERE artifact.project_id = ? AND artifact.episode_id = ?
             AND artifact.artifact_type = ? AND artifact.artifact_id = ?
             AND version.version_id = ?""",
        (project_id, episode_id, ASSEMBLY_ARTIFACT_TYPE,
         request.assembly.artifact_id, request.assembly.version_id),
    ).fetchone()
    if (
        row is None or row["schema_version"] != ASSEMBLY_SCHEMA_VERSION
        or row["latest_version_id"] != request.assembly.version_id
        or row["revision"] != request.assembly.head_revision
        or row["content_hash"] != request.assembly.content_hash
    ):
        raise ProductExportClaimError("ASSEMBLY_CONFLICT", "Assembly version or head does not match")
    try:
        raw = json.loads(str(row["content_json"]))
        content = EpisodeMediaAssemblyContentV1.model_validate(raw)
    except (ValueError, TypeError):
        raise ProductExportClaimError("ASSEMBLY_CORRUPT", "Stored assembly content is invalid") from None
    if (
        content.project_id != project_id or content.episode_id != episode_id
        or canonical_content_hash(raw) != request.assembly.content_hash
    ):
        raise ProductExportClaimError("ASSEMBLY_CORRUPT", "Stored assembly bytes or scope differ")
    _validate_script_refs(connection, content)
    return content


class ProductExportClaimService:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository
        self._store = ProductExportStore(repository)

    def _existing_receipt(
        self, project_id: str, operation_id: str, request_hash: str,
    ) -> ProductExportOperationData | None:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            existing = connection.execute(
                """SELECT request_hash FROM product_export_operations
                   WHERE project_id = ? AND operation_id = ?""",
                (project_id, operation_id),
            ).fetchone()
        if existing is None:
            return None
        _require_matching_operation_hash(str(existing["request_hash"]), request_hash)
        receipt = self._store.get(project_id, operation_id)
        _require_matching_operation_hash(receipt.request_hash, request_hash)
        return receipt

    def replay_existing(
        self, project_id: str, episode_id: str, request: ProductExportClaimRequest,
    ) -> ProductExportOperationData | None:
        """Read an exact same-key receipt without tools, output paths, or writes."""
        request, _request_json, request_hash = _request_identity(
            project_id, episode_id, request,
        )
        return self._existing_receipt(project_id, request.operation_id, request_hash)

    def claim(
        self, project_id: str, episode_id: str, request: ProductExportClaimRequest,
        output_root: Path, toolchain: MediaToolchain,
    ) -> tuple[ProductExportOperationData, bool]:
        """Return an existing same-key receipt first; new claims fail closed today."""
        request, request_json, request_hash = _request_identity(project_id, episode_id, request)
        existing_receipt = self._existing_receipt(project_id, request.operation_id, request_hash)
        if existing_receipt is not None:
            return existing_receipt, True

        # A release approval requires a separately reviewed profile and license
        # record. The current lock contains no such entry; preclaim rejection
        # leaves zero ledger rows and never launches ffmpeg.
        profile = (toolchain.profile_id, toolchain.ffmpeg_sha256, toolchain.ffprobe_sha256)
        if profile not in _APPROVED_RELEASE_PROFILES or toolchain.distribution_status == "DEVELOPMENT_ONLY":
            raise ProductExportClaimError(
                "RELEASE_TOOLCHAIN_NOT_APPROVED", "No product export encoder is approved",
            )

        target_identity = output_target_identity(output_root, request)
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            content = _assembly_in_transaction(connection, project_id, episode_id, request)
            connection.commit()
        subtitles = _formal_script_subtitles(content)
        selected = _selected_tracks(content)
        if len(content.visual_segments) != 1:
            raise ProductExportClaimError("MULTI_SEGMENT_UNSUPPORTED", "Multiple visual segments are not renderable")
        if content.audio_segments:
            raise ProductExportClaimError("AUDIO_TRACKS_UNSUPPORTED", "Independent dialogue, BGM and SFX are not renderable")
        if subtitles:
            raise ProductExportClaimError("SUBTITLE_UNSUPPORTED", "Subtitle rendering is not available")
        if content.visual_segments[0].media_kind != "video":
            raise ProductExportClaimError("VISUAL_UNSUPPORTED", "This render path requires a video original")
        assertions = {
            (item.media.asset_id, item.media.asset_version_id): item
            for item in request.media_rights
        }
        if set(assertions) != {
            (media.asset_id, media.asset_version_id) for _, _, media in selected
        }:
            raise ProductExportClaimError("MEDIA_ASSERTION_INCOMPLETE", "Rights assertions must cover every assembly media version")
        verified_versions: dict[tuple[str, str], SelectedMediaAssetVersion] = {}
        for _, expected_kind, media in selected:
            read = read_selected_media_asset_version(
                self._repository.database_path, project_id,
                media.asset_id, media.asset_version_id,
            )
            if (
                read.status != "VERIFIED" or read.version is None
                or read.version.kind != expected_kind
                or read.version.sha256 != media.sha256
            ):
                raise ProductExportClaimError("MEDIA_UNVERIFIED", "Selected media bytes are not verified")
            verified_versions[(media.asset_id, media.asset_version_id)] = read.version
        visual = content.visual_segments[0]
        evidence = MediaAssetProbeEvidenceStore(self._repository).read(
            project_id, visual.media.asset_id, visual.media.asset_version_id,
        )
        if evidence is None:
            raise ProductExportClaimError("VIDEO_PROBE_MISSING", "Selected video has no immutable probe")
        plan = build_single_video_render_plan(content, request, evidence, toolchain)
        plan_json = canonical_content_bytes(plan.model_dump(mode="json")).decode("utf-8")

        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    """SELECT request_hash FROM product_export_operations
                       WHERE project_id = ? AND operation_id = ?""",
                    (project_id, request.operation_id),
                ).fetchone()
                if existing is not None:
                    _require_matching_operation_hash(str(existing["request_hash"]), request_hash)
                    connection.commit()
                    receipt = self._store.get(project_id, request.operation_id)
                    _require_matching_operation_hash(receipt.request_hash, request_hash)
                    return receipt, True
                confirmed = _assembly_in_transaction(connection, project_id, episode_id, request)
                if canonical_content_hash(confirmed.model_dump(mode="json")) != plan.assembly_content_hash:
                    raise ProductExportClaimError("ASSEMBLY_CHANGED", "Assembly changed before claim")
                rows: list[tuple[object, ...]] = []
                for index, (track_kind, media_kind, media) in enumerate(selected):
                    version = connection.execute(
                        """SELECT version.kind, version.sha256, version.byte_size,
                                  version.source_kind, asset.deleted_at
                           FROM media_asset_versions AS version
                           JOIN media_assets AS asset ON asset.project_id = version.project_id
                             AND asset.id = version.asset_id
                           WHERE version.project_id = ? AND version.asset_id = ?
                             AND version.id = ?""",
                        (project_id, media.asset_id, media.asset_version_id),
                    ).fetchone()
                    if (
                        version is None or version["deleted_at"] is not None
                        or version["kind"] != media_kind
                        or version["sha256"] != media.sha256
                        or version["source_kind"] != "LOCAL_IMPORT"
                        or version["byte_size"] != verified_versions[
                            (media.asset_id, media.asset_version_id)
                        ].byte_size
                    ):
                        raise ProductExportClaimError("MEDIA_CHANGED", "Selected media identity changed")
                    try:
                        history = _validated_history(
                            connection, project_id, media.asset_id,
                            media.asset_version_id, media.sha256,
                        )
                    except RightsDecisionError:
                        raise ProductExportClaimError("RIGHTS_UNKNOWN", "Selected rights history is invalid") from None
                    assertion = assertions[(media.asset_id, media.asset_version_id)]
                    latest = history[-1] if history else None
                    if (
                        latest is None or latest.decision != "CLEARED"
                        or latest.decision_id != assertion.decision_id
                        or latest.revision != assertion.revision
                        or latest.decision_content_hash != assertion.decision_content_hash
                        or assertion.media.sha256 != media.sha256
                    ):
                        raise ProductExportClaimError("RIGHTS_CONFLICT", "Latest human rights decision is not matching CLEARED")
                    rows.append((
                        project_id, request.operation_id, index, track_kind, media_kind,
                        media.asset_id, media.asset_version_id, media.sha256,
                        latest.decision_id, latest.revision, latest.decision_content_hash,
                    ))
                probe = connection.execute(
                    """SELECT probe_sha256, ffmpeg_sha256, ffprobe_sha256
                       FROM media_asset_probe_evidence
                       WHERE project_id = ? AND asset_id = ? AND version_id = ?""",
                    (project_id, plan.source_asset_id, plan.source_version_id),
                ).fetchone()
                if (
                    probe is None or probe["probe_sha256"] != plan.source_probe_sha256
                    or probe["ffmpeg_sha256"] != toolchain.ffmpeg_sha256
                    or probe["ffprobe_sha256"] != toolchain.ffprobe_sha256
                ):
                    raise ProductExportClaimError("PROBE_CHANGED", "Selected video probe changed")
                stamp = _now()
                connection.execute(
                    """INSERT INTO product_export_operations (
                         project_id, operation_id, episode_id, request_hash, request_json,
                         assembly_artifact_id, assembly_version_id, assembly_content_hash,
                         assembly_head_revision, render_plan_hash, render_plan_json,
                         output_target_identity, inputs_sealed_at, media_input_count,
                         subtitle_input_count, status, progress_phase, progress_frames,
                         total_frames, created_at, updated_at
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?,
                                 'CLAIMED', 'QUEUED', 0, ?, ?, ?)""",
                    (project_id, request.operation_id, episode_id, request_hash,
                     request_json, request.assembly.artifact_id, request.assembly.version_id,
                     request.assembly.content_hash, request.assembly.head_revision,
                     plan.content_hash, plan_json, target_identity, len(rows),
                     len(content.subtitle_segments), plan.total_frames, stamp, stamp),
                )
                connection.executemany(
                    """INSERT INTO product_export_media_inputs (
                         project_id, operation_id, input_index, track_kind, media_kind,
                         asset_id, version_id, asset_sha256, rights_decision_id,
                         rights_revision, rights_content_hash
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    rows,
                )
                connection.executemany(
                    """INSERT INTO product_export_subtitle_inputs (
                         project_id, operation_id, segment_id, script_version_id,
                         script_block_id, start_frame, end_frame
                       ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    [(
                        project_id, request.operation_id, subtitle.segment_id,
                        subtitle.script_version_id, subtitle.script_block_id,
                        subtitle.start_frame, subtitle.end_frame,
                    ) for subtitle in subtitles],
                )
                connection.execute(
                    """UPDATE product_export_operations SET inputs_sealed_at = ?, updated_at = ?
                       WHERE project_id = ? AND operation_id = ?""",
                    (stamp, stamp, project_id, request.operation_id),
                )
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return self._store.get(project_id, request.operation_id), False
