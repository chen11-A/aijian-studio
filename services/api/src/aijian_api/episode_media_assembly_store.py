"""Versioned episode media assembly in the existing workspace artifact chain.

The draft stores exact media references. It never imports or copies source bytes.
Playback is currently limited to locally verified still-image animatics.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import stat
from pathlib import Path

from aijian_api.artifacts import canonical_content_bytes
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import (
    ASSEMBLY_ARTIFACT_TYPE, ASSEMBLY_SCHEMA_VERSION, AssemblyMediaCheckV1,
    AssemblyMediaRefV1, CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1, EpisodeMediaAssemblyVersionData,
)
from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.managed_local_paths import managed_local_io_path
from aijian_api.media_asset_store import MAX_INLINE_PREVIEW_BYTES
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceError, _from_row
from aijian_api.media_asset_rights_store import RightsDecisionError, _validated_history
from aijian_api.media_probe import _is_remote_windows_path, _open_local_source
from aijian_api.repository import ArtifactConflictError, StudioRepository

_SHA = re.compile(r"[0-9a-f]{64}\Z")


class EpisodeMediaAssemblyError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _plain_directory(path: Path) -> bool:
    try:
        return path.is_dir() and not path.is_symlink() and path.resolve(strict=True) == path
    except (OSError, RuntimeError):
        return False


def _availability(database_path: Path, digest: str, byte_size: int) -> str:
    """Check a managed original without creating directories or media copies."""

    if _SHA.fullmatch(digest) is None or byte_size <= 0:
        return "CORRUPT"
    workspace = database_path.parent.absolute()
    try:
        workspace_io = managed_local_io_path(workspace, workspace)
    except (OSError, ValueError):
        return "UNKNOWN_UNSAFE_PATH"
    if _is_remote_windows_path(workspace) or not _plain_directory(workspace_io):
        return "UNKNOWN_UNSAFE_PATH"
    root = workspace / "media-assets"
    blobs = root / "blobs"
    prefix = blobs / digest[:2]
    for directory in (root, blobs, prefix):
        try:
            directory_io = managed_local_io_path(workspace, directory)
        except FileNotFoundError:
            return "MISSING"
        except (OSError, ValueError):
            return "UNKNOWN_UNSAFE_PATH"
        if directory_io.is_symlink():
            return "UNKNOWN_UNSAFE_PATH"
        if not directory_io.exists():
            return "MISSING"
        if not _plain_directory(directory_io):
            return "UNKNOWN_UNSAFE_PATH"
    path = prefix / digest
    try:
        io_path = managed_local_io_path(workspace, path)
        if io_path.is_symlink():
            return "UNKNOWN_UNSAFE_PATH"
        file_stat = io_path.stat()
    except FileNotFoundError:
        return "MISSING"
    except (OSError, ValueError):
        return "UNKNOWN_UNSAFE_PATH"
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size != byte_size:
        return "CORRUPT"
    if byte_size > MAX_INLINE_PREVIEW_BYTES:
        return "UNVERIFIED_SIZE_LIMIT"
    try:
        with _open_local_source(io_path) as stream:
            first = os.fstat(stream.fileno())
            if not stat.S_ISREG(first.st_mode) or first.st_size != byte_size:
                return "CORRUPT"
            hasher = hashlib.sha256()
            total = 0
            while chunk := stream.read(1024 * 1024):
                total += len(chunk)
                if total > byte_size:
                    return "CORRUPT"
                hasher.update(chunk)
            last = os.fstat(stream.fileno())
        if io_path.is_symlink():
            return "UNKNOWN_MEDIA_CHANGED"
        named = io_path.stat()
    except (OSError, ValueError):
        return "UNKNOWN_MEDIA_READ"
    if (
        first.st_dev != last.st_dev or first.st_ino != last.st_ino
        or first.st_size != last.st_size or first.st_mtime_ns != last.st_mtime_ns
        or first.st_dev != named.st_dev or first.st_ino != named.st_ino
        or first.st_size != named.st_size or first.st_mtime_ns != named.st_mtime_ns
    ):
        return "UNKNOWN_MEDIA_CHANGED"
    return "VERIFIED" if total == byte_size and hasher.hexdigest() == digest else "CORRUPT"


def _media_refs(content: EpisodeMediaAssemblyContentV1) -> tuple[tuple[AssemblyMediaRefV1, str], ...]:
    refs: dict[tuple[str, str, str], tuple[AssemblyMediaRefV1, str]] = {}
    for segment in content.visual_segments:
        media = segment.media
        key = (media.asset_id, media.asset_version_id, media.sha256)
        if key in refs and refs[key][1] != segment.media_kind:
            raise EpisodeMediaAssemblyError("MEDIA_KIND_CONFLICT", "One media version has conflicting track kinds")
        refs[key] = (media, segment.media_kind)
    for segment in content.audio_segments:
        media = segment.media
        key = (media.asset_id, media.asset_version_id, media.sha256)
        if key in refs and refs[key][1] != "audio":
            raise EpisodeMediaAssemblyError("MEDIA_KIND_CONFLICT", "One media version has conflicting track kinds")
        refs[key] = (media, "audio")
    return tuple(refs.values())


def script_speaker_id(
    project_id: str, episode_id: str, script_version_id: str, speaker_label: str,
) -> str:
    """Stable only within this exact script version; not a character registry ID."""

    identity = canonical_content_bytes(
        [project_id, episode_id, script_version_id, speaker_label]
    )
    return "spk_" + hashlib.sha256(identity).hexdigest()[:32]


def _validate_script_refs(connection: sqlite3.Connection, content: EpisodeMediaAssemblyContentV1) -> None:
    bindings: dict[str, list[tuple[str, str | None, str | None]]] = {}
    for segment in content.audio_segments:
        if segment.track_kind == "DIALOGUE":
            assert segment.script_version_id is not None and segment.script_block_id is not None
            bindings.setdefault(segment.script_version_id, []).append(
                (segment.script_block_id, segment.delivery, segment.speaker_id)
            )
    for segment in content.subtitle_segments:
        bindings.setdefault(segment.script_version_id, []).append((segment.script_block_id, None, None))
    for version_id, references in bindings.items():
        row = connection.execute(
            """SELECT version.content_json FROM artifact_versions AS version
               JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
               WHERE artifact.project_id = ? AND artifact.episode_id = ?
                 AND artifact.artifact_type = 'episode_script' AND version.version_id = ?""",
            (content.project_id, content.episode_id, version_id),
        ).fetchone()
        if row is None:
            raise EpisodeMediaAssemblyError("SCRIPT_VERSION_NOT_FOUND", "Referenced episode script version was not found")
        try:
            script = EpisodeScriptContentV1.model_validate(json.loads(str(row["content_json"])))
        except (ValueError, TypeError):
            raise EpisodeMediaAssemblyError("SCRIPT_VERSION_CORRUPT", "Referenced episode script is invalid") from None
        if script.project_id != content.project_id or script.episode_id != content.episode_id:
            raise EpisodeMediaAssemblyError("SCRIPT_SCOPE_CONFLICT", "Referenced script belongs to another episode")
        blocks = {block.block_id: block for scene in script.scenes for block in scene.blocks}
        for block_id, delivery, speaker_id in references:
            block = blocks.get(block_id)
            if block is None:
                raise EpisodeMediaAssemblyError("SCRIPT_BLOCK_NOT_FOUND", "Referenced script block was not found")
            if delivery is not None and (block.kind != "DIALOGUE" or block.delivery != delivery):
                raise EpisodeMediaAssemblyError("DIALOGUE_CONFLICT", "Dialogue delivery differs from bound script version")
            if speaker_id is not None and (
                block.speaker is None or speaker_id != script_speaker_id(
                    content.project_id, content.episode_id, version_id, block.speaker,
                )
            ):
                raise EpisodeMediaAssemblyError("SPEAKER_CONFLICT", "Speaker ID differs from bound script speaker")


def _collect_checks(
    connection: sqlite3.Connection,
    database_path: Path,
    content: EpisodeMediaAssemblyContentV1,
    *,
    writing: bool,
) -> tuple[AssemblyMediaCheckV1, ...]:
    checks: list[AssemblyMediaCheckV1] = []
    has_probe_table = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_asset_probe_evidence'"
    ).fetchone() is not None
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
                raise EpisodeMediaAssemblyError("ASSET_VERSION_NOT_FOUND", "Selected media version was not found")
            checks.append(AssemblyMediaCheckV1(
                media=media, kind=expected_kind, availability="MISSING",
                technical_status="STILL_HEADER_ONLY" if expected_kind == "image" else "PENDING_MEDIA_PROBE",
                rights_status="PENDING_REVIEW",
            ))
            continue
        kind = str(row["kind"])
        digest = str(row["sha256"])
        if kind != expected_kind or digest != media.sha256 or str(row["source_kind"]) != "LOCAL_IMPORT":
            raise EpisodeMediaAssemblyError("MEDIA_IDENTITY_CONFLICT", "Selected media version identity differs from stored truth")
        try:
            byte_size = int(row["byte_size"])
            technical = json.loads(str(row["technical_json"]))
        except (ValueError, TypeError):
            raise EpisodeMediaAssemblyError("MEDIA_RECORD_CORRUPT", "Selected media version metadata is invalid") from None
        if not isinstance(technical, dict):
            raise EpisodeMediaAssemblyError("MEDIA_RECORD_CORRUPT", "Selected media technical metadata is invalid")
        try:
            rights_history = _validated_history(
                connection, content.project_id, media.asset_id,
                media.asset_version_id, digest,
            )
        except RightsDecisionError:
            raise EpisodeMediaAssemblyError(
                "RIGHTS_CHAIN_INVALID", "Selected media rights history is invalid",
            ) from None
        latest_rights = rights_history[-1] if rights_history else None
        rights_status = latest_rights.decision if latest_rights is not None else "PENDING_REVIEW"
        decision_id = latest_rights.decision_id if latest_rights is not None else None
        if rights_status == "RESTRICTED" and writing:
            raise EpisodeMediaAssemblyError("RIGHTS_RESTRICTED", "Restricted media cannot be added to an assembly")
        availability = _availability(database_path, digest, byte_size)
        if writing and availability in {
            "MISSING", "CORRUPT", "UNKNOWN_UNSAFE_PATH", "UNKNOWN_MEDIA_READ",
            "UNKNOWN_MEDIA_CHANGED",
        }:
            raise EpisodeMediaAssemblyError("MEDIA_" + availability, "Selected media original is unavailable")
        technical_status = "STILL_HEADER_ONLY" if kind == "image" else "PENDING_MEDIA_PROBE"
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
                        raise MediaAssetProbeEvidenceError("PROBE_IDENTITY_CONFLICT", "Probe identity differs from media version")
                    video = evidence.probe.video
                    rate = content.sequence_timebase.frame_rate
                    matching_rate = (
                        video.average_frame_rate.num == rate.num
                        and video.average_frame_rate.den == rate.den
                    )
                    segments = [
                        segment for segment in content.visual_segments
                        if segment.media == media
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
                    if video.is_variable_frame_rate or not matching_rate or not ranges_fit or not audio_fits:
                        technical_status = "INVALID_MEDIA_PROBE"
                    else:
                        technical_status = "PROBED_CFR_VIDEO"
                        probe_id = evidence.id
                        probed_frames = len(video.frames)
                        has_audio = evidence.probe.audio is not None
                except MediaAssetProbeEvidenceError:
                    technical_status = "INVALID_MEDIA_PROBE"
        checks.append(AssemblyMediaCheckV1(
            media=media, kind=expected_kind, availability=availability,
            technical_status=technical_status,
            probe_evidence_id=probe_id, probed_video_frames=probed_frames,
            probed_has_audio=has_audio,
            rights_status=rights_status, rights_decision_id=decision_id,
        ))
    return tuple(checks)


def _result(
    record: ArtifactVersionRecord,
    content: EpisodeMediaAssemblyContentV1,
    checks: tuple[AssemblyMediaCheckV1, ...],
) -> EpisodeMediaAssemblyVersionData:
    if any(check.rights_status == "RESTRICTED" for check in checks):
        playback = "BLOCKED_RIGHTS"
    elif any(check.availability != "VERIFIED" for check in checks):
        playback = "BLOCKED_MEDIA_BYTES"
    elif any(check.kind == "audio" or check.technical_status in {
        "PENDING_MEDIA_PROBE", "INVALID_MEDIA_PROBE",
    } for check in checks):
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
    ) -> EpisodeMediaAssemblyVersionData:
        content = request.content
        if content.project_id != project_id or content.episode_id != episode_id:
            raise EpisodeMediaAssemblyError("EPISODE_SCOPE_CONFLICT", "Assembly content differs from route scope")
        if not author_actor_id or len(author_actor_id) > 128:
            raise EpisodeMediaAssemblyError("INVALID_ACTOR", "An identified author is required")
        with self._repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                head = connection.execute(
                    """SELECT head.latest_version_id, head.revision FROM artifact_heads AS head
                       JOIN artifacts AS artifact ON artifact.artifact_id = head.artifact_id
                       WHERE artifact.project_id = ? AND artifact.episode_id = ?
                         AND artifact.artifact_type = ?""",
                    (project_id, episode_id, ASSEMBLY_ARTIFACT_TYPE),
                ).fetchone()
                if head is not None and request.parent_version_id != str(head["latest_version_id"]):
                    raise ArtifactConflictError("Assembly revision must parent the latest version")
                _validate_script_refs(connection, content)
                checks = _collect_checks(connection, self._repository.database_path, content, writing=True)
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
                )
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
        return _result(record, content, checks)

    def read_version(
        self,
        project_id: str,
        episode_id: str,
        *,
        version_id: str | None = None,
    ) -> EpisodeMediaAssemblyVersionData:
        if version_id is None:
            record = self._repository.get_latest_artifact(
                project_id, ASSEMBLY_ARTIFACT_TYPE, episode_id=episode_id,
            )
        else:
            record = self._repository.get_artifact_version(
                project_id, ASSEMBLY_ARTIFACT_TYPE, version_id, episode_id=episode_id,
            )
        content = EpisodeMediaAssemblyContentV1.model_validate(record.version.content)
        if content.project_id != project_id or content.episode_id != episode_id:
            raise EpisodeMediaAssemblyError("EPISODE_SCOPE_CONFLICT", "Persisted assembly has wrong scope")
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            checks = _collect_checks(connection, self._repository.database_path, content, writing=False)
            connection.commit()
        return _result(record, content, checks)
