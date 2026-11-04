"""Bounded, read-only assembly prerequisites; no Gate, probe or export action."""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime

from aijian_api.artifacts import canonical_content_bytes
from aijian_api.assembly_script_provenance import (
    AssemblyScriptProvenanceError,
    validate_script_provenance,
)
from aijian_api.assembly_storyboard_provenance import (
    AssemblyStoryboardReferenceError,
    validate_storyboard_provenance,
)
from aijian_api.audio_asset_probe_store import _from_audio_row
from aijian_api.episode_assembly_readiness_contracts import (
    EpisodeAssemblyReadinessBlocker,
    EpisodeAssemblyReadinessData,
    EpisodeAssemblyReadinessSourceCheck,
)
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyStore,
    _collect_checks,
    _media_refs,
    _result,
)
from aijian_api.local_media_original import availability_read_scope
from aijian_api.manual_media_candidate_contracts import MAX_ASSET_METADATA_BYTES
from aijian_api.media_asset_probe_store import (
    MAX_PERSISTED_PROBE_BYTES,
    MediaAssetProbeEvidenceError,
)
from aijian_api.media_asset_rights_store import MAX_RIGHTS_HISTORY
from aijian_api.repository import StudioRepository
from aijian_api.script_confirmation_impact_projection import (
    ImpactMaterializationBudget,
    bounded_version_record,
)

MAX_READINESS_ORIGINAL_BYTES = 32 * 1024 * 1024
MAX_READINESS_RESPONSE_BYTES = 4 * 1024 * 1024
_HASH = re.compile(r"sha256:[0-9a-f]{64}\Z")


class EpisodeAssemblyReadinessError(ValueError):
    def __init__(self, code: str, message: str, status: int = 503) -> None:
        self.code, self.status = code, status
        super().__init__(message)


def _media_metadata_fence(
    connection: sqlite3.Connection,
    content: EpisodeMediaAssemblyContentV1,
    budget: ImpactMaterializationBudget,
) -> None:
    """Admit metadata, existing probes and rights before their rows are materialized."""
    for media, _ in _media_refs(content):
        params = (content.project_id, media.asset_id, media.asset_version_id)
        row = connection.execute(
            "SELECT length(CAST(technical_json AS BLOB)) FROM media_asset_versions "
            "WHERE project_id=? AND asset_id=? AND id=?",
            params,
        ).fetchone()
        if row is not None:
            size = int(row[0])
            if size > MAX_ASSET_METADATA_BYTES:
                raise EpisodeAssemblyReadinessError(
                    "READINESS_METADATA_BUDGET", "Selected media metadata exceeds the read budget"
                )
            budget.admit("media-metadata:" + media.asset_version_id, size)
        probe = connection.execute(
            "SELECT length(CAST(probe_json AS BLOB)) FROM media_asset_probe_evidence "
            "WHERE project_id=? AND asset_id=? AND version_id=?",
            params,
        ).fetchone()
        if probe is not None:
            size = int(probe[0])
            if size > MAX_PERSISTED_PROBE_BYTES:
                raise EpisodeAssemblyReadinessError(
                    "READINESS_PROBE_BUDGET", "Selected probe exceeds the read budget"
                )
            budget.admit("media-probe:" + media.asset_version_id, size)
        rights = connection.execute(
            "SELECT count(*), coalesce(sum(length(CAST(basis_text AS BLOB)) + "
            "coalesce(length(CAST(supporting_reference AS BLOB)),0) + 1024),0) "
            "FROM media_asset_rights_decisions WHERE project_id=? AND asset_id=? AND version_id=?",
            params,
        ).fetchone()
        if rights[0] > MAX_RIGHTS_HISTORY:
            raise EpisodeAssemblyReadinessError(
                "READINESS_RIGHTS_BUDGET", "Selected rights history exceeds the read budget"
            )
        budget.admit("media-rights:" + media.asset_version_id, int(rights[1]))


class EpisodeAssemblyReadinessService:
    def __init__(self, repository: StudioRepository) -> None:
        self.repository = repository

    def inspect(
        self, project_id: str, episode_id: str, version_id: str, expected_content_hash: str
    ) -> EpisodeAssemblyReadinessData:
        if _HASH.fullmatch(expected_content_hash) is None:
            raise EpisodeAssemblyReadinessError(
                "READINESS_HASH_INVALID", "An exact saved content hash is required", 422
            )
        with (
            availability_read_scope(MAX_READINESS_ORIGINAL_BYTES),
            self.repository._connection() as connection,
        ):
            connection.execute("PRAGMA query_only=ON")
            connection.execute("BEGIN")
            budget = ImpactMaterializationBudget()
            record, content, script_status = EpisodeMediaAssemblyStore(
                self.repository
            )._read_version_in_connection(
                connection, project_id, episode_id, version_id=version_id, budget=budget
            )
            if record.version.content_hash != expected_content_hash:
                raise EpisodeAssemblyReadinessError(
                    "ASSEMBLY_HASH_CONFLICT", "Selected saved assembly hash differs", 409
                )
            _media_metadata_fence(connection, content, budget)
            checks = _collect_checks(
                connection,
                self.repository.database_path,
                content,
                writing=False,
            )
            assembly = _result(record, content, checks, script_status)
            sources: list[EpisodeAssemblyReadinessSourceCheck] = []
            blockers: list[EpisodeAssemblyReadinessBlocker] = []

            def block(code: str, scope: str, message: str) -> None:
                blockers.append(
                    EpisodeAssemblyReadinessBlocker.model_validate(
                        {"code": code, "scope": scope, "message": message}
                    )
                )

            try:
                validate_script_provenance(
                    self.repository, connection, content, fresh=True, budget=budget
                )
                confirmed = content.script_provenance is not None and (
                    content.script_provenance.mode == "CONFIRMED"
                )
                source = EpisodeAssemblyReadinessSourceCheck(
                    scope="SCRIPT",
                    status="CURRENT" if confirmed else "NOT_BOUND",
                    code="SCRIPT_CONFIRMED_CURRENT" if confirmed else "SCRIPT_NOT_CONFIRMED",
                )
            except AssemblyScriptProvenanceError as error:
                source = EpisodeAssemblyReadinessSourceCheck(
                    scope="SCRIPT",
                    status="UNKNOWN" if error.code == "SCRIPT_AUTHORITY_UNKNOWN" else "BLOCKED",
                    code=error.code,
                )
            if source.status != "CURRENT":
                block(source.code, "SCRIPT", "已保存剧本来源需要明确的当前人工确认。")
            sources.append(source)

            try:
                validate_storyboard_provenance(
                    self.repository,
                    connection,
                    content,
                    assembly_record=record,
                    fresh=True,
                    budget=budget,
                )
                pinned = all(s.storyboard_ref is not None for s in content.visual_segments)
                for board_id in sorted(
                    {
                        s.storyboard_ref.storyboard_version_id
                        for s in content.visual_segments
                        if s.storyboard_ref is not None
                    }
                ):
                    board = bounded_version_record(
                        self.repository,
                        connection,
                        project_id=project_id,
                        episode_id=episode_id,
                        artifact_type="episode_storyboard",
                        version_id=board_id,
                        budget=budget,
                    )
                    pinned = pinned and board.version.content.get("visual_bible_pin") is not None
                source = EpisodeAssemblyReadinessSourceCheck(
                    scope="STORYBOARD",
                    status="CURRENT" if pinned else "NOT_BOUND",
                    code="STORYBOARD_G5_CURRENT" if pinned else "STORYBOARD_G5_NOT_BOUND",
                )
            except AssemblyStoryboardReferenceError as error:
                source = EpisodeAssemblyReadinessSourceCheck(
                    scope="STORYBOARD",
                    status="BLOCKED",
                    code=error.code,
                )
            if source.status != "CURRENT":
                block(source.code, "STORYBOARD", "已保存画面来源需要可核验的当前G5批准。")
            sources.append(source)

            for check in checks:
                label = check.media.asset_version_id
                if check.availability != "VERIFIED":
                    block("MEDIA_" + check.availability, "MEDIA", f"原文件{label}尚未核验通过。")
                if check.rights_status != "CLEARED":
                    block(
                        "MEDIA_RIGHTS_" + check.rights_status,
                        "MEDIA",
                        f"素材{label}的权利需要核验。",
                    )
                if check.kind == "video" and check.technical_status != "PROBED_CFR_VIDEO":
                    block(
                        "VIDEO_PROBE_UNVERIFIED",
                        "MEDIA",
                        f"视频{label}缺少有效的已保存技术证据。",
                    )
                if check.kind == "audio":
                    row = connection.execute(
                        "SELECT * FROM media_asset_probe_evidence "
                        "WHERE project_id=? AND asset_id=? AND version_id=?",
                        (project_id, check.media.asset_id, check.media.asset_version_id),
                    ).fetchone()
                    if row is None:
                        block(
                            "AUDIO_PROBE_MISSING",
                            "SOUND",
                            f"音频{label}缺少已保存的采样时长证据。",
                        )
                        continue
                    try:
                        evidence = _from_audio_row(row)
                        if evidence.asset_sha256 != check.media.sha256 or evidence.byte_size != int(
                            connection.execute(
                                "SELECT byte_size FROM media_asset_versions "
                                "WHERE project_id=? AND asset_id=? AND id=?",
                                (project_id, check.media.asset_id, check.media.asset_version_id),
                            ).fetchone()[0]
                        ):
                            raise ValueError("Audio evidence identity differs")
                        audio = evidence.probe.audio
                        rate = content.sequence_timebase.frame_rate
                        for segment in content.audio_segments:
                            if segment.media != check.media:
                                continue

                            numerator = rate.den * audio.sample_rate_hz
                            start_sample = (2 * segment.start_frame * numerator + rate.num) // (
                                2 * rate.num
                            )
                            end_sample = (2 * segment.end_frame * numerator + rate.num) // (
                                2 * rate.num
                            )
                            required = end_sample - start_sample
                            if segment.source_in_sample + required > audio.total_samples:
                                block(
                                    "AUDIO_SOURCE_RANGE_INVALID",
                                    "SOUND",
                                    f"音频片段{segment.segment_id}超出已保存原件的采样时长。",
                                )
                    except (MediaAssetProbeEvidenceError, ValueError, TypeError):
                        block(
                            "AUDIO_PROBE_UNKNOWN",
                            "SOUND",
                            f"音频{label}的已保存采样证据无法核验。",
                        )

            is_current = record.head.latest_version_id == record.version.id
            if not is_current:
                block(
                    "ASSEMBLY_NOT_CURRENT_HEAD",
                    "ASSEMBLY",
                    "选中的已保存装配是历史版本，当前最新版本已变化。",
                )
            for code, scope, message in (
                (
                    "PICTURE_LOCK_MISSING",
                    "PICTURE_LOCK",
                    "此装配尚无G7B画面锁定记录。",
                ),
                (
                    "PICTURE_REVIEW_NOT_RECORDED",
                    "PICTURE_LOCK",
                    "帧边界与连续性缺少正式人工审查记录。",
                ),
                (
                    "SOUND_REVIEW_NOT_RECORDED",
                    "SOUND",
                    "对白内容、混音及口型缺少正式人工批准记录。",
                ),
                (
                    "SUBTITLE_REVIEW_NOT_RECORDED",
                    "SUBTITLE",
                    "字幕内容与呈现缺少正式人工批准记录。",
                ),
                (
                    "FINISHING_MASTERS_MISSING",
                    "FINISHING",
                    "精整画面、混音及字幕母版尚未接通。",
                ),
                (
                    "RELEASE_AUTHORITY_UNAVAILABLE",
                    "RELEASE",
                    "G8签发权限与已批准的正式输出编码器尚不可用。",
                ),
            ):
                block(code, scope, message)
            data = EpisodeAssemblyReadinessData(
                assembly=assembly,
                is_current_head=is_current,
                source_checks=tuple(sources),
                blockers=tuple(blockers),
                checked_at=datetime.now(UTC),
            )
            if (
                len(canonical_content_bytes(data.model_dump(mode="json")))
                > MAX_READINESS_RESPONSE_BYTES
            ):
                raise EpisodeAssemblyReadinessError(
                    "READINESS_RESPONSE_BUDGET", "Readiness observation exceeds the response budget"
                )
            connection.commit()
        return data
