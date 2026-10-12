"""Versioned episode media assembly in the existing workspace artifact chain.

The draft stores exact media references. It never imports or copies source bytes.
Playback is currently limited to locally verified still-image animatics.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from aijian_api.script_confirmation_impact_projection import ImpactMaterializationBudget

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.assembly_script_provenance import (
    AssemblyScriptProvenanceError,
    script_dependencies,
    script_segment_sources,
    validate_script_provenance,
)
from aijian_api.assembly_storyboard_provenance import (
    AssemblyStoryboardReferenceError,
    validate_storyboard_provenance,
)
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import (
    ASSEMBLY_ARTIFACT_TYPE,
    ASSEMBLY_SCHEMA_VERSION,
    AssemblyExactOperationData,
    AssemblyMediaCheckV1,
    AssemblyMediaKind,
    AssemblyMediaRefV1,
    AssemblyPlaybackStatus,
    AssemblyScriptSourceStatusV1,
    AssemblySubtitleSegmentV1,
    AssemblyTechnicalStatus,
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
    EpisodeMediaAssemblyVersionData,
)
from aijian_api.episode_script_contracts import MAX_SCRIPT_BYTES, EpisodeScriptContentV1
from aijian_api.local_media_original import _availability
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceError, _from_row
from aijian_api.media_asset_rights_store import RightsDecisionError, _validated_history
from aijian_api.repository import ArtifactConflictError, ArtifactNotFoundError, StudioRepository


class EpisodeMediaAssemblyError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _media_refs(
    content: EpisodeMediaAssemblyContentV1,
) -> tuple[tuple[AssemblyMediaRefV1, AssemblyMediaKind], ...]:
    refs: dict[tuple[str, str, str], tuple[AssemblyMediaRefV1, AssemblyMediaKind]] = {}
    for segment in content.visual_segments:
        media = segment.media
        key = (media.asset_id, media.asset_version_id, media.sha256)
        if key in refs and refs[key][1] != segment.media_kind:
            raise EpisodeMediaAssemblyError(
                "MEDIA_KIND_CONFLICT", "One media version has conflicting track kinds"
            )
        refs[key] = (media, segment.media_kind)
    for audio_segment in content.audio_segments:
        media = audio_segment.media
        key = (media.asset_id, media.asset_version_id, media.sha256)
        if key in refs and refs[key][1] != "audio":
            raise EpisodeMediaAssemblyError(
                "MEDIA_KIND_CONFLICT", "One media version has conflicting track kinds"
            )
        refs[key] = (media, "audio")
    return tuple(refs.values())


def script_speaker_id(
    project_id: str,
    episode_id: str,
    script_version_id: str,
    speaker_label: str,
) -> str:
    """Stable only within this exact script version; not a character registry ID."""

    identity = canonical_content_bytes([project_id, episode_id, script_version_id, speaker_label])
    return "spk_" + hashlib.sha256(identity).hexdigest()[:32]


def _validate_script_refs(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    content: EpisodeMediaAssemblyContentV1,
    *,
    budget: ImpactMaterializationBudget | None = None,
) -> None:
    from aijian_api.script_confirmation_impact_projection import (
        ImpactMaterializationBudget,
        bounded_version_record,
    )

    budget = budget if budget is not None else ImpactMaterializationBudget()
    bindings: dict[str, list[tuple[str, str | None, str | None]]] = {}
    for segment in content.audio_segments:
        if segment.track_kind == "DIALOGUE":
            assert segment.script_version_id is not None and segment.script_block_id is not None
            bindings.setdefault(segment.script_version_id, []).append(
                (segment.script_block_id, segment.delivery, segment.speaker_id)
            )
    for subtitle in content.subtitle_segments:
        if isinstance(subtitle, AssemblySubtitleSegmentV1):
            bindings.setdefault(subtitle.script_version_id, []).append(
                (subtitle.script_block_id, None, None)
            )
    ids = set(bindings) | {source[2] for source in script_segment_sources(content)}
    if content.script_provenance is not None and content.script_provenance.mode == "CONFIRMED":
        ids.add(content.script_provenance.script_version_id)
    for version_id in sorted(ids):
        references = bindings.get(version_id, [])
        try:
            record = bounded_version_record(
                repository,
                connection,
                project_id=content.project_id,
                episode_id=content.episode_id,
                artifact_type="episode_script",
                version_id=version_id,
                budget=budget,
            )
            stored_content = record.version.content
            script = EpisodeScriptContentV1.model_validate(stored_content)
            # Match the script store's canonical persisted-version checks. Keep
            # legacy optional defaults valid by hashing stored JSON, not a dump
            # of the parsed model that would insert newer optional fields.
            if (
                record.version.schema_version != "1.0.0"
                or record.version.content_hash != canonical_content_hash(stored_content)
                or len(canonical_content_bytes(stored_content)) > MAX_SCRIPT_BYTES
            ):
                raise ValueError("Referenced script failed integrity checks")
        except ArtifactConflictError as error:
            if str(error) == "Artifact version was not found":
                if (
                    content.script_provenance is not None
                    and content.script_provenance.mode == "CONFIRMED"
                    and version_id == content.script_provenance.script_version_id
                    and version_id not in bindings
                ):
                    raise EpisodeMediaAssemblyError(
                        "SCRIPT_CONFIRMATION_CONFLICT", "Claimed confirmation script differs"
                    ) from error
                raise EpisodeMediaAssemblyError(
                    "SCRIPT_VERSION_NOT_FOUND", "Referenced episode script version was not found"
                ) from error
            raise EpisodeMediaAssemblyError(
                "SCRIPT_VERSION_CORRUPT", "Referenced episode script is invalid"
            ) from error
        except (ValueError, TypeError, RuntimeError):
            raise EpisodeMediaAssemblyError(
                "SCRIPT_VERSION_CORRUPT", "Referenced episode script is invalid"
            ) from None
        if script.project_id != content.project_id or script.episode_id != content.episode_id:
            raise EpisodeMediaAssemblyError(
                "SCRIPT_SCOPE_CONFLICT", "Referenced script belongs to another episode"
            )
        blocks = {block.block_id: block for scene in script.scenes for block in scene.blocks}
        for block_id, delivery, speaker_id in references:
            block = blocks.get(block_id)
            if block is None:
                raise EpisodeMediaAssemblyError(
                    "SCRIPT_BLOCK_NOT_FOUND", "Referenced script block was not found"
                )
            if delivery is not None and (block.kind != "DIALOGUE" or block.delivery != delivery):
                raise EpisodeMediaAssemblyError(
                    "DIALOGUE_CONFLICT", "Dialogue delivery differs from bound script version"
                )
            if speaker_id is not None and (
                block.speaker is None
                or speaker_id
                != script_speaker_id(
                    content.project_id,
                    content.episode_id,
                    version_id,
                    block.speaker,
                )
            ):
                raise EpisodeMediaAssemblyError(
                    "SPEAKER_CONFLICT", "Speaker ID differs from bound script speaker"
                )


def _collect_checks(
    connection: sqlite3.Connection,
    database_path: Path,
    content: EpisodeMediaAssemblyContentV1,
    *,
    writing: bool,
) -> tuple[AssemblyMediaCheckV1, ...]:
    checks: list[AssemblyMediaCheckV1] = []
    has_probe_table = (
        connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = 'media_asset_probe_evidence'"
        ).fetchone()
        is not None
    )
    for media, expected_kind in _media_refs(content):
        row = connection.execute(
            """SELECT version.kind, version.sha256, version.byte_size,
                      version.source_kind, version.technical_json
               FROM media_asset_versions AS version
               JOIN media_assets AS asset ON asset.project_id = version.project_id
                 AND asset.id = version.asset_id
               WHERE version.project_id = ? AND version.asset_id = ? AND version.id = ?
                 AND asset.deleted_at IS NULL""",
            (content.project_id, media.asset_id, media.asset_version_id),
        ).fetchone()
        if row is None:
            if writing:
                raise EpisodeMediaAssemblyError(
                    "ASSET_VERSION_NOT_FOUND", "Selected media version was not found"
                )
            checks.append(
                AssemblyMediaCheckV1(
                    media=media,
                    kind=expected_kind,
                    availability="MISSING",
                    technical_status="STILL_HEADER_ONLY"
                    if expected_kind == "image"
                    else "PENDING_MEDIA_PROBE",
                    rights_status="PENDING_REVIEW",
                )
            )
            continue
        kind = str(row["kind"])
        digest = str(row["sha256"])
        if (
            kind != expected_kind
            or digest != media.sha256
            or str(row["source_kind"]) != "LOCAL_IMPORT"
        ):
            raise EpisodeMediaAssemblyError(
                "MEDIA_IDENTITY_CONFLICT",
                "Selected media version identity differs from stored truth",
            )
        try:
            byte_size = int(row["byte_size"])
            technical = json.loads(str(row["technical_json"]))
        except (ValueError, TypeError):
            raise EpisodeMediaAssemblyError(
                "MEDIA_RECORD_CORRUPT", "Selected media version metadata is invalid"
            ) from None
        if not isinstance(technical, dict):
            raise EpisodeMediaAssemblyError(
                "MEDIA_RECORD_CORRUPT", "Selected media technical metadata is invalid"
            )
        try:
            rights_history = _validated_history(
                connection,
                content.project_id,
                media.asset_id,
                media.asset_version_id,
                digest,
            )
        except RightsDecisionError:
            raise EpisodeMediaAssemblyError(
                "RIGHTS_CHAIN_INVALID",
                "Selected media rights history is invalid",
            ) from None
        latest_rights = rights_history[-1] if rights_history else None
        rights_status = latest_rights.decision if latest_rights is not None else "PENDING_REVIEW"
        decision_id = latest_rights.decision_id if latest_rights is not None else None
        if rights_status == "RESTRICTED" and writing:
            raise EpisodeMediaAssemblyError(
                "RIGHTS_RESTRICTED", "Restricted media cannot be added to an assembly"
            )
        availability = _availability(database_path, digest, byte_size)
        if writing and availability in {
            "MISSING",
            "CORRUPT",
            "UNKNOWN_UNSAFE_PATH",
            "UNKNOWN_MEDIA_READ",
            "UNKNOWN_MEDIA_CHANGED",
        }:
            raise EpisodeMediaAssemblyError(
                "MEDIA_" + availability, "Selected media original is unavailable"
            )
        technical_status: AssemblyTechnicalStatus = (
            "STILL_HEADER_ONLY" if kind == "image" else "PENDING_MEDIA_PROBE"
        )
        probe_id = None
        probed_frames = None
        has_audio = None
        if kind == "video" and has_probe_table:
            probe_row = connection.execute(
                """SELECT * FROM media_asset_probe_evidence
                   WHERE project_id = ? AND asset_id = ? AND version_id = ?""",
                (content.project_id, media.asset_id, media.asset_version_id),
            ).fetchone()
            if probe_row is not None:
                try:
                    evidence = _from_row(probe_row)
                    if evidence.asset_sha256 != digest or evidence.byte_size != byte_size:
                        raise MediaAssetProbeEvidenceError(
                            "PROBE_IDENTITY_CONFLICT", "Probe identity differs from media version"
                        )
                    video = evidence.probe.video
                    rate = content.sequence_timebase.frame_rate
                    matching_rate = (
                        video.average_frame_rate.num == rate.num
                        and video.average_frame_rate.den == rate.den
                    )
                    segments = [
                        segment for segment in content.visual_segments if segment.media == media
                    ]
                    ranges_fit = all(
                        segment.source_in_frame + segment.end_frame - segment.start_frame
                        <= len(video.frames)
                        for segment in segments
                    )
                    audio_fits = all(
                        segment.embedded_audio == "MUTE" or evidence.probe.audio is not None
                        for segment in segments
                    )
                    if (
                        video.is_variable_frame_rate
                        or not matching_rate
                        or not ranges_fit
                        or not audio_fits
                    ):
                        technical_status = "INVALID_MEDIA_PROBE"
                    else:
                        technical_status = "PROBED_CFR_VIDEO"
                        probe_id = evidence.id
                        probed_frames = len(video.frames)
                        has_audio = evidence.probe.audio is not None
                except MediaAssetProbeEvidenceError:
                    technical_status = "INVALID_MEDIA_PROBE"
        checks.append(
            AssemblyMediaCheckV1(
                media=media,
                kind=expected_kind,
                availability=availability,
                technical_status=technical_status,
                probe_evidence_id=probe_id,
                probed_video_frames=probed_frames,
                probed_has_audio=has_audio,
                rights_status=rights_status,
                rights_decision_id=decision_id,
            )
        )
    return tuple(checks)


def _result(
    record: ArtifactVersionRecord,
    content: EpisodeMediaAssemblyContentV1,
    checks: tuple[AssemblyMediaCheckV1, ...],
    script_status: AssemblyScriptSourceStatusV1 | None = None,
) -> EpisodeMediaAssemblyVersionData:
    playback: AssemblyPlaybackStatus
    if any(check.rights_status == "RESTRICTED" for check in checks):
        playback = "BLOCKED_RIGHTS"
    elif any(check.availability != "VERIFIED" for check in checks):
        playback = "BLOCKED_MEDIA_BYTES"
    elif any(
        check.kind == "audio"
        or check.technical_status
        in {
            "PENDING_MEDIA_PROBE",
            "INVALID_MEDIA_PROBE",
        }
        for check in checks
    ):
        playback = "BLOCKED_MEDIA_PROBE"
    elif any(check.kind == "video" for check in checks):
        playback = "DRAFT_VIDEO_PREVIEW"
    else:
        playback = "DRAFT_STATIC_ANIMATIC"
    return EpisodeMediaAssemblyVersionData(
        artifact_id=record.version.artifact_id,
        version_id=record.version.id,
        content_hash=record.version.content_hash,
        head_revision=record.head.revision,
        parent_version_id=record.version.parent_version_id,
        content=content,
        script_source_status=script_status,
        media_checks=checks,
        playback_status=playback,
    )


class EpisodeMediaAssemblyStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def create_version(
        self,
        project_id: str,
        episode_id: str,
        request: CreateEpisodeMediaAssemblyVersionRequest,
        *,
        author_actor_id: str,
        operation_id: str | None = None,
    ) -> EpisodeMediaAssemblyVersionData:
        content = request.content
        if content.project_id != project_id or content.episode_id != episode_id:
            raise EpisodeMediaAssemblyError(
                "EPISODE_SCOPE_CONFLICT", "Assembly content differs from route scope"
            )
        if not author_actor_id or len(author_actor_id) > 128:
            raise EpisodeMediaAssemblyError("INVALID_ACTOR", "An identified author is required")
        if operation_id is not None:
            key, full = self._exact_hashes(operation_id, request, author_actor_id)
        with self._repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                if operation_id is not None:
                    receipt = connection.execute(
                        "SELECT request_hash FROM assembly_exact_write_requests WHERE project_id=? "
                        "AND episode_id=? AND idempotency_key_hash=?",
                        (project_id, episode_id, key),
                    ).fetchone()
                    if receipt is not None:
                        if receipt[0] != full:
                            raise ArtifactConflictError("Original complete assembly intent changed")
                        try:
                            result = self._exact_original(
                                connection,
                                project_id,
                                episode_id,
                                operation_id,
                                request,
                                author_actor_id,
                            ).version
                        except Exception as error:
                            raise RuntimeError(
                                "Existing assembly receipt attribution failed"
                            ) from error
                        connection.commit()
                        return result
                head = connection.execute(
                    """SELECT head.latest_version_id, head.revision FROM artifact_heads AS head
                       JOIN artifacts AS artifact ON artifact.artifact_id = head.artifact_id
                       WHERE artifact.project_id = ? AND artifact.episode_id = ?
                         AND artifact.artifact_type = ?""",
                    (project_id, episode_id, ASSEMBLY_ARTIFACT_TYPE),
                ).fetchone()
                if head is not None and request.parent_version_id != str(head["latest_version_id"]):
                    raise ArtifactConflictError("Assembly revision must parent the latest version")
                from aijian_api.script_confirmation_impact_projection import (
                    ImpactMaterializationBudget,
                )

                budget = ImpactMaterializationBudget()
                _validate_script_refs(self._repository, connection, content, budget=budget)
                try:
                    storyboard_edges = validate_storyboard_provenance(
                        self._repository, connection, content, fresh=True, budget=budget
                    )
                    script_status = validate_script_provenance(
                        self._repository, connection, content, fresh=True, budget=budget
                    )
                    dependencies = (*storyboard_edges, *script_dependencies(content))
                except AssemblyStoryboardReferenceError as error:
                    raise EpisodeMediaAssemblyError(error.code, str(error)) from error
                except AssemblyScriptProvenanceError as error:
                    raise EpisodeMediaAssemblyError(error.code, str(error)) from error
                checks = _collect_checks(
                    connection, self._repository.database_path, content, writing=True
                )
                record = self._repository._create_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    episode_id=episode_id,
                    artifact_type=ASSEMBLY_ARTIFACT_TYPE,
                    schema_version=ASSEMBLY_SCHEMA_VERSION,
                    content=content.model_dump(mode="json"),
                    author_actor_type="human",
                    author_actor_id=author_actor_id,
                    change_summary=request.change_summary,
                    parent_version_id=request.parent_version_id,
                    expected_revision=request.expected_revision,
                    dependencies=dependencies,
                )
                result = _result(record, content, checks, script_status)
                if operation_id is not None:
                    self._repository._transaction_step("assembly_exact", "version_inserted")
                    connection.execute(
                        "INSERT INTO assembly_exact_write_requests VALUES(?,?,?,?,?,?,?)",
                        (
                            project_id,
                            episode_id,
                            key,
                            full,
                            record.version.artifact_id,
                            record.version.id,
                            request.expected_revision,
                        ),
                    )
                    self._repository._transaction_step("assembly_exact", "receipt_inserted")
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return result

    def _read_version_in_connection(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        *,
        version_id: str | None = None,
        budget: ImpactMaterializationBudget | None = None,
    ) -> tuple[
        ArtifactVersionRecord, EpisodeMediaAssemblyContentV1, AssemblyScriptSourceStatusV1 | None
    ]:
        """Verify immutable content/sources inside the caller's read transaction."""
        from aijian_api.script_confirmation_impact_projection import (
            ImpactMaterializationBudget,
            bounded_version_record,
        )

        budget = budget if budget is not None else ImpactMaterializationBudget()
        if version_id is None:
            head = connection.execute(
                "SELECT head.latest_version_id FROM artifact_heads head "
                "JOIN artifacts a ON a.artifact_id=head.artifact_id "
                "WHERE a.project_id=? AND a.episode_id=? AND a.artifact_type=?",
                (project_id, episode_id, ASSEMBLY_ARTIFACT_TYPE),
            ).fetchone()
            if head is None:
                raise ArtifactNotFoundError("Artifact head was not found")
            version_id = str(head[0])
        record = bounded_version_record(
            self._repository,
            connection,
            project_id=project_id,
            episode_id=episode_id,
            artifact_type=ASSEMBLY_ARTIFACT_TYPE,
            version_id=version_id,
            budget=budget,
        )
        try:
            content = EpisodeMediaAssemblyContentV1.model_validate(record.version.content)
            if (
                record.version.schema_version != ASSEMBLY_SCHEMA_VERSION
                or canonical_content_hash(record.version.content) != record.version.content_hash
                or content.model_dump(mode="json") != record.version.content
            ):
                raise ValueError("Assembly stored content is inconsistent")
        except (ValueError, TypeError) as error:
            raise EpisodeMediaAssemblyError(
                "ASSEMBLY_CONTENT_CORRUPT",
                "Stored assembly failed integrity checks",
            ) from error
        if content.project_id != project_id or content.episode_id != episode_id:
            raise EpisodeMediaAssemblyError(
                "EPISODE_SCOPE_CONFLICT", "Persisted assembly has wrong scope"
            )
        _validate_script_refs(self._repository, connection, content, budget=budget)
        try:
            validate_storyboard_provenance(
                self._repository,
                connection,
                content,
                assembly_record=record,
                budget=budget,
            )
            script_status = validate_script_provenance(
                self._repository, connection, content, budget=budget
            )
        except AssemblyStoryboardReferenceError as error:
            raise EpisodeMediaAssemblyError(error.code, str(error)) from error
        except AssemblyScriptProvenanceError as error:
            raise EpisodeMediaAssemblyError(error.code, str(error)) from error
        return record, content, script_status

    def read_version(
        self,
        project_id: str,
        episode_id: str,
        *,
        version_id: str | None = None,
    ) -> EpisodeMediaAssemblyVersionData:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("BEGIN")
            record, content, script_status = self._read_version_in_connection(
                connection, project_id, episode_id, version_id=version_id
            )
            checks = _collect_checks(
                connection, self._repository.database_path, content, writing=False
            )
            connection.commit()
        return _result(record, content, checks, script_status)

    @staticmethod
    def _exact_hashes(
        operation_id: str, payload: CreateEpisodeMediaAssemblyVersionRequest, actor_id: str
    ) -> tuple[str, str]:
        UUID(operation_id)
        if (
            re.fullmatch(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
                operation_id,
            )
            is None
        ):
            raise ValueError("Canonical original UUID bytes required")
        if actor_id != "local-user":
            raise EpisodeMediaAssemblyError("INVALID_ACTOR", "Trusted human local actor required")
        if (payload.parent_version_id is None) != (payload.expected_revision is None):
            raise EpisodeMediaAssemblyError(
                "EPISODE_SCOPE_CONFLICT", "Exact CAS fields must be paired"
            )
        return canonical_content_hash({"value": operation_id}), canonical_content_hash(
            {"payload": payload.model_dump(mode="json"), "actor_id": actor_id}
        )

    def _exact_original(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateEpisodeMediaAssemblyVersionRequest,
        actor_id: str,
    ) -> AssemblyExactOperationData:
        from aijian_api.script_confirmation_impact_projection import (
            ImpactMaterializationBudget,
            bounded_version_record,
        )

        key, full = self._exact_hashes(operation_id, payload, actor_id)
        row = connection.execute(
            "SELECT * FROM assembly_exact_write_requests WHERE project_id=? "
            "AND episode_id=? AND idempotency_key_hash=?",
            (project_id, episode_id, key),
        ).fetchone()
        if row is None or row["request_hash"] != full:
            raise ValueError(
                "Original complete assembly operation is not attributable; do not resend"
            )
        budget = ImpactMaterializationBudget()
        record = bounded_version_record(
            self._repository,
            connection,
            project_id=project_id,
            episode_id=episode_id,
            artifact_type=ASSEMBLY_ARTIFACT_TYPE,
            version_id=row["version_id"],
            budget=budget,
        )
        v = record.version
        content = EpisodeMediaAssemblyContentV1.model_validate(v.content)
        if (
            v.artifact_id != row["artifact_id"]
            or v.author_actor_id != actor_id
            or v.author_actor_type != "human"
            or v.schema_version != ASSEMBLY_SCHEMA_VERSION
            or v.content_hash != canonical_content_hash(v.content)
            or content.model_dump(mode="json") != v.content
            or content != payload.content
            or v.change_summary != payload.change_summary
            or v.parent_version_id != payload.parent_version_id
            or row["expected_revision"] != payload.expected_revision
            or record.source_spans
            or content.project_id != project_id
            or content.episode_id != episode_id
        ):
            raise ValueError("Original complete assembly receipt differs from immutable truth")
        validate_storyboard_provenance(
            self._repository, connection, content, assembly_record=record, budget=budget
        )
        _validate_script_refs(self._repository, connection, content, budget=budget)
        status = validate_script_provenance(self._repository, connection, content, budget=budget)
        checks = _collect_checks(connection, self._repository.database_path, content, writing=False)
        return AssemblyExactOperationData(
            operation_id=operation_id,
            payload=payload,
            result_revision=(payload.expected_revision or 0) + 1,
            version=_result(record, content, checks, status),
        )

    def original_for_hash(
        self, project_id: str, episode_id: str, operation_id: str, payload_hash: str, actor_id: str
    ) -> AssemblyExactOperationData:
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only=ON")
            connection.execute("BEGIN")
            key = canonical_content_hash({"value": operation_id})
            row = connection.execute(
                "SELECT * FROM assembly_exact_write_requests WHERE project_id=? "
                "AND episode_id=? AND idempotency_key_hash=?",
                (project_id, episode_id, key),
            ).fetchone()
            if row is None:
                raise ValueError("Original assembly receipt absent; do not resend")
            # Fence before reconstructing the complete original write payload.
            metrics = self._repository._get_artifact_version_payload_metrics_in_connection(
                connection,
                project_id=project_id,
                episode_id=episode_id,
                artifact_type=ASSEMBLY_ARTIFACT_TYPE,
                version_id=row["version_id"],
            )
            if metrics.content_json_bytes > 2_000_000 or metrics.source_span_count:
                raise ValueError("Original assembly body exceeds its read budget")
            record = self._repository._get_artifact_version_in_connection(
                connection,
                project_id=project_id,
                episode_id=episode_id,
                artifact_type=ASSEMBLY_ARTIFACT_TYPE,
                version_id=row["version_id"],
            )
            payload = CreateEpisodeMediaAssemblyVersionRequest.model_validate(
                {
                    "content": record.version.content,
                    "change_summary": record.version.change_summary,
                    "parent_version_id": record.version.parent_version_id,
                    "expected_revision": row["expected_revision"],
                }
            )
            if canonical_content_hash(payload.model_dump(mode="json")) != payload_hash:
                raise ValueError("Original full assembly payload hash differs")
            return self._exact_original(
                connection, project_id, episode_id, operation_id, payload, actor_id
            )

    def write_exact(
        self,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateEpisodeMediaAssemblyVersionRequest,
        actor_id: str,
    ) -> AssemblyExactOperationData:
        self.create_version(
            project_id, episode_id, payload, author_actor_id=actor_id, operation_id=operation_id
        )
        # Commit has already occurred. Any later read/construction exception is
        # UNKNOWN at the native route, never a definitive input rejection.
        try:
            return self.original_for_hash(
                project_id,
                episode_id,
                operation_id,
                canonical_content_hash(payload.model_dump(mode="json")),
                actor_id,
            )
        except Exception as error:
            raise RuntimeError("Committed assembly response attribution failed") from error
