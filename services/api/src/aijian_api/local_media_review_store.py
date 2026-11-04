"""Bounded exact self observations. Historical reads never inspect today's media."""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.assembly_script_provenance import (
    AssemblyScriptProvenanceError,
    validate_script_provenance,
)
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import AssemblyTextSubtitleSegmentV1
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.local_media_original import _availability, availability_read_scope
from aijian_api.local_media_review_contracts import (
    MAX_LOCAL_REVIEW_BYTES,
    CreateLocalMediaReviewRequest,
    LocalMediaReviewContentV1,
    LocalMediaReviewCurrentAssemblyV1,
    LocalMediaReviewKind,
    LocalMediaReviewOperationData,
    LocalMediaReviewOriginalV1,
    LocalMediaReviewPageData,
    LocalMediaReviewScriptSourceV1,
    LocalMediaReviewStatusData,
    LocalMediaReviewStatusReason,
    LocalMediaReviewTargetData,
    LocalMediaReviewTargetSnapshotV1,
    LocalMediaReviewVersionData,
)
from aijian_api.media_asset_rights_store import _validated_history
from aijian_api.media_asset_selected_reader import _version_from_row
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.script_confirmation_impact_projection import (
    ImpactMaterializationBudget,
    bounded_version_record,
)

ARTIFACT_TYPE = "episode_local_media_review"
SUMMARY = "Record explicit local media self observation"


class LocalMediaReviewError(ValueError):
    def __init__(self, code: str, message: str, status: int = 422):
        self.code, self.status = code, status
        super().__init__(message)


class LocalMediaReviewStore:
    def __init__(self, repository: StudioRepository):
        self.repository = repository

    @staticmethod
    def _head(c: sqlite3.Connection, p: str, e: str, kind: str) -> sqlite3.Row | None:
        head = c.execute(
            "SELECT h.latest_version_id,h.revision,a.artifact_id,v.content_hash,v.version_number "
            "FROM artifacts a JOIN artifact_heads h ON h.artifact_id=a.artifact_id "
            "JOIN artifact_versions v ON v.artifact_id=a.artifact_id "
            "AND v.version_id=h.latest_version_id "
            "WHERE a.project_id=? AND a.episode_id=? AND a.artifact_type=?",
            (p, e, kind),
        ).fetchone()
        if head is None:
            if c.execute(
                "SELECT 1 FROM artifacts WHERE project_id=? AND episode_id=? AND artifact_type=?",
                (p, e, kind),
            ).fetchone():
                raise RuntimeError("Stored sequence head is missing")
            return None
        newest = c.execute(
            "SELECT version_id FROM artifact_versions WHERE artifact_id=? ORDER BY "
            "version_number DESC LIMIT 1",
            (head["artifact_id"],),
        ).fetchone()
        if (
            newest is None
            or newest[0] != head["latest_version_id"]
            or head["revision"] != head["version_number"]
        ):
            raise RuntimeError("Stored sequence head is inconsistent")
        return cast(sqlite3.Row, head)

    def _target(
        self,
        c: sqlite3.Connection,
        p: str,
        e: str,
        v: str,
        digest: str,
        kind: LocalMediaReviewKind,
        segment_id: str,
        budget: ImpactMaterializationBudget,
        *,
        fresh: bool = True,
    ) -> LocalMediaReviewTargetData:
        head = self._head(c, p, e, "episode_media_assembly") if fresh else None
        if fresh and (
            head is None or head["latest_version_id"] != v or head["content_hash"] != digest
        ):
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_TARGET_CHANGED", "自审目标必须是本集当前已保存版本", 409
            )
        assembly_record, content, _ = EpisodeMediaAssemblyStore(
            self.repository
        )._read_version_in_connection(c, p, e, version_id=v, budget=budget)
        if assembly_record.version.content_hash != digest:
            raise RuntimeError("Historical target assembly hash differs")
        audio = (
            next((s for s in content.audio_segments if s.segment_id == segment_id), None)
            if kind == "AUDIO"
            else None
        )
        subtitle = (
            next(
                (
                    s
                    for s in content.subtitle_segments
                    if s.segment_id == segment_id and isinstance(s, AssemblyTextSubtitleSegmentV1)
                ),
                None,
            )
            if kind == "LITERAL_SUBTITLE"
            else None
        )
        segment = audio if audio is not None else subtitle
        if segment is None:
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_SEGMENT_NOT_FOUND", "请选择当前已保存的声音片段或固定文字字幕"
            )
        original = None
        source = None
        if audio is not None:
            ref = audio.media
            metrics = c.execute(
                "SELECT length(CAST(technical_json AS BLOB)) FROM media_asset_versions WHERE "
                "project_id=? AND asset_id=? AND id=?",
                (p, ref.asset_id, ref.asset_version_id),
            ).fetchone()
            if metrics is None or metrics[0] > 32 * 1024:
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_MEDIA_UNKNOWN", "无法有界核对选中的录音原件", 503
                )
            row = c.execute(
                "SELECT * FROM media_asset_versions WHERE project_id=? AND asset_id=? AND id=?",
                (p, ref.asset_id, ref.asset_version_id),
            ).fetchone()
            selected = _version_from_row(row, [])
            if (
                selected.kind != "audio"
                or selected.sha256 != ref.sha256
                or selected.mime_type not in ("audio/wav", "audio/mpeg")
            ):
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_MEDIA_CONFLICT", "录音原件与保存片段不一致"
                )
            if fresh:
                if (
                    c.execute(
                        "SELECT 1 FROM media_assets WHERE project_id=? AND id=? AND deleted_at "
                        "IS NULL",
                        (p, ref.asset_id),
                    ).fetchone()
                    is None
                ):
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_MEDIA_MISSING",
                        "录音素材已移除，旧观察不能用于当前来源",
                        409,
                    )
                history = _validated_history(c, p, ref.asset_id, ref.asset_version_id, ref.sha256)
                if (history[-1].decision if history else selected.rights_status) == "RESTRICTED":
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_RIGHTS_RESTRICTED", "录音原件权利受限", 409
                    )
                available = _availability(
                    self.repository.database_path, ref.sha256, selected.byte_size
                )
                if available != "VERIFIED":
                    status = 409 if available in ("MISSING", "CORRUPT") else 503
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_MEDIA_" + available,
                        "录音原件当前无法在读取限额内核验",
                        status,
                    )
            original = LocalMediaReviewOriginalV1(
                asset_id=ref.asset_id,
                asset_version_id=ref.asset_version_id,
                sha256=ref.sha256,
                byte_size=selected.byte_size,
                mime_type=cast(Literal["audio/wav", "audio/mpeg"], selected.mime_type),
                filename=selected.filename,
                origin="LOCAL_IMPORT",
            )
        source_id = (
            audio.script_version_id
            if audio
            else subtitle.script_ref.script_version_id
            if subtitle and subtitle.script_ref
            else None
        )
        block_id = (
            audio.script_block_id
            if audio
            else subtitle.script_ref.script_block_id
            if subtitle and subtitle.script_ref
            else None
        )
        if source_id is not None:
            record = bounded_version_record(
                self.repository,
                c,
                project_id=p,
                episode_id=e,
                artifact_type="episode_script",
                version_id=source_id,
                budget=budget,
            )
            script = EpisodeScriptContentV1.model_validate(record.version.content)
            block = next(
                (b for scene in script.scenes for b in scene.blocks if b.block_id == block_id), None
            )
            if block is None:
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_SOURCE_CONFLICT", "自审片段的确切剧本文字已无法核对"
                )
            source = LocalMediaReviewScriptSourceV1(
                script_version_id=source_id,
                script_content_hash=record.version.content_hash,
                script_block_id=block.block_id,
                block_content_hash=canonical_content_hash(block.model_dump(mode="json")),
            )
            if fresh:
                try:
                    validate_script_provenance(
                        self.repository, c, content, fresh=True, budget=budget
                    )
                except AssemblyScriptProvenanceError as error:
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_SOURCE_CHANGED"
                        if error.code == "SCRIPT_SOURCE_SUPERSEDED"
                        else "LOCAL_MEDIA_REVIEW_SOURCE_UNKNOWN",
                        "原确认剧本已替代，请重新绑定后自审"
                        if error.code == "SCRIPT_SOURCE_SUPERSEDED"
                        else "自审片段的当前剧本来源无法核对",
                        409 if error.code == "SCRIPT_SOURCE_SUPERSEDED" else 503,
                    ) from error
        snapshot = LocalMediaReviewTargetSnapshotV1(
            project_id=p,
            episode_id=e,
            assembly_version_id=v,
            assembly_content_hash=digest,
            assembly_head_revision=head["revision"]
            if head is not None
            else assembly_record.version.version_number,
            segment_kind=kind,
            segment_id=segment_id,
            segment_content_hash=canonical_content_hash(segment.model_dump(mode="json")),
            sequence_timebase=content.sequence_timebase,
            total_frames=content.total_frames,
            canvas_width=content.canvas_width,
            canvas_height=content.canvas_height,
            audio_segment=audio,
            subtitle_segment=subtitle,
            media_original=original,
            script_source=source,
            script_provenance=content.script_provenance,
        )
        return LocalMediaReviewTargetData(
            snapshot=snapshot,
            snapshot_hash=canonical_content_hash(snapshot.model_dump(mode="json")),
        )

    def target(
        self, p: str, e: str, v: str, digest: str, kind: LocalMediaReviewKind, segment_id: str
    ) -> LocalMediaReviewTargetData:
        self.repository.get_episode(p, e)
        with availability_read_scope(32 * 1024 * 1024), self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._target(c, p, e, v, digest, kind, segment_id, ImpactMaterializationBudget())

    def _data(
        self,
        c: sqlite3.Connection,
        record: ArtifactVersionRecord,
        p: str,
        e: str,
        budget: ImpactMaterializationBudget,
    ) -> LocalMediaReviewVersionData:
        v = record.version
        content = LocalMediaReviewContentV1.model_validate(v.content)
        target = content.target_snapshot
        actual = tuple(
            (d.upstream_version_id, d.relationship, d.impact) for d in record.dependencies
        )
        if (
            v.author_actor_type != "human"
            or v.author_actor_id != "local-user"
            or v.change_summary != SUMMARY
            or v.schema_version != "1.0.0"
            or v.content_hash != canonical_content_hash(v.content)
            or content.model_dump(mode="json") != v.content
            or (target.project_id, target.episode_id) != (p, e)
            or record.source_spans
            or actual != ((target.assembly_version_id, "derived_from", "blocking"),)
            or len(canonical_content_bytes(v.content)) > MAX_LOCAL_REVIEW_BYTES
        ):
            raise RuntimeError("Local self observation immutable provenance differs")
        # Historical evidence checks immutable source identity only: no current head,
        # original file, latest rights, today's confirmation or G5 approval reads.
        owner = c.execute(
            "SELECT v.content_hash FROM artifact_versions v JOIN artifacts a ON "
            "a.artifact_id=v.artifact_id WHERE a.project_id=? AND a.episode_id=? AND "
            "a.artifact_type='episode_media_assembly' AND v.version_id=?",
            (p, e, target.assembly_version_id),
        ).fetchone()
        if owner is None or owner[0] != target.assembly_content_hash:
            raise RuntimeError("Local self observation assembly identity differs")
        historical = self._target(
            c,
            p,
            e,
            target.assembly_version_id,
            target.assembly_content_hash,
            target.segment_kind,
            target.segment_id,
            budget,
            fresh=False,
        )
        if historical.snapshot != target:
            raise RuntimeError("Historical self observation target snapshot differs")
        return LocalMediaReviewVersionData(
            version_id=v.id,
            version_number=v.version_number,
            parent_version_id=v.parent_version_id,
            author_actor_id="local-user",
            content=content,
            content_hash=v.content_hash,
            created_at=v.created_at,
        )

    def _version(
        self, c: sqlite3.Connection, p: str, e: str, v: str, budget: ImpactMaterializationBudget
    ) -> LocalMediaReviewVersionData:
        metrics = self.repository._get_artifact_version_payload_metrics_in_connection(
            c, project_id=p, episode_id=e, artifact_type=ARTIFACT_TYPE, version_id=v
        )
        edges = c.execute(
            "SELECT count(*) FROM artifact_dependencies WHERE downstream_version_id=?", (v,)
        ).fetchone()[0]
        if (
            metrics.content_json_bytes > MAX_LOCAL_REVIEW_BYTES
            or metrics.source_span_count
            or edges != 1
        ):
            raise RuntimeError("Local self observation SQL materialization fence rejected")
        record = bounded_version_record(
            self.repository,
            c,
            project_id=p,
            episode_id=e,
            artifact_type=ARTIFACT_TYPE,
            version_id=v,
            budget=budget,
        )
        data = self._data(c, record, p, e, budget)
        row = c.execute(
            "SELECT * FROM local_media_review_write_requests WHERE project_id=? AND "
            "episode_id=? AND version_id=?",
            (p, e, v),
        ).fetchone()
        if (
            row is None
            or row["artifact_id"] != record.version.artifact_id
            or row["result_revision"] != data.version_number
        ):
            raise RuntimeError("Local self observation attribution receipt missing")
        expected = data.version_number - 1 if data.version_number > 1 else None
        previous = c.execute(
            "SELECT version_id FROM artifact_versions WHERE artifact_id=? AND version_number=?",
            (record.version.artifact_id, data.version_number - 1),
        ).fetchone()
        if row["expected_revision"] != expected or data.parent_version_id != (
            previous[0] if previous is not None else None
        ):
            raise RuntimeError("Local self observation original CAS lineage differs")
        payload = CreateLocalMediaReviewRequest(
            input=data.content.input,
            parent_version_id=data.parent_version_id,
            expected_revision=row["expected_revision"],
        )
        if row["request_hash"] != canonical_content_hash(
            {"payload": payload.model_dump(mode="json"), "actor_id": "local-user"}
        ):
            raise RuntimeError("Local self observation full original input differs")
        return data

    @staticmethod
    def _hashes(
        operation_id: str, payload: CreateLocalMediaReviewRequest, actor_id: str
    ) -> tuple[str, str]:
        if (
            actor_id != "local-user"
            or re.fullmatch(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
                operation_id,
            )
            is None
        ):
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_INPUT_REJECTED",
                "Canonical original UUID and trusted local user required",
            )
        UUID(operation_id)
        return canonical_content_hash({"value": operation_id}), canonical_content_hash(
            {"payload": payload.model_dump(mode="json"), "actor_id": actor_id}
        )

    def _original(
        self,
        c: sqlite3.Connection,
        p: str,
        e: str,
        operation_id: str,
        payload_hash: str,
        actor_id: str,
        budget: ImpactMaterializationBudget | None = None,
    ) -> LocalMediaReviewOperationData:
        key = canonical_content_hash({"value": operation_id})
        row = c.execute(
            "SELECT * FROM local_media_review_write_requests WHERE project_id=? AND "
            "episode_id=? AND idempotency_key_hash=?",
            (p, e, key),
        ).fetchone()
        if row is None:
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_OPERATION_NOT_FOUND",
                "原操作回执尚未找到；请保留原命令继续只读核对",
                404,
            )
        version = self._version(
            c,
            p,
            e,
            row["version_id"],
            budget if budget is not None else ImpactMaterializationBudget(),
        )
        payload = CreateLocalMediaReviewRequest(
            input=version.content.input,
            parent_version_id=version.parent_version_id,
            expected_revision=row["expected_revision"],
        )
        _, full = self._hashes(operation_id, payload, actor_id)
        if (
            canonical_content_hash(payload.model_dump(mode="json")) != payload_hash
            or full != row["request_hash"]
        ):
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_OPERATION_NOT_FOUND", "原操作完整输入未能对应；禁止重发", 404
            )
        return LocalMediaReviewOperationData(
            operation_id=operation_id,
            payload=payload,
            version=version,
            result_revision=row["result_revision"],
        )

    def original(
        self, p: str, e: str, operation_id: str, payload_hash: str, actor_id: str
    ) -> LocalMediaReviewOperationData:
        self.repository.get_episode(p, e)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._original(c, p, e, operation_id, payload_hash, actor_id)

    def write(
        self,
        p: str,
        e: str,
        operation_id: str,
        payload: CreateLocalMediaReviewRequest,
        actor_id: str,
    ) -> LocalMediaReviewOperationData:
        i = payload.input
        if (i.project_id, i.episode_id) != (p, e):
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_INPUT_REJECTED", "Review scope differs from route"
            )
        key, full = self._hashes(operation_id, payload, actor_id)
        self.repository.get_episode(p, e)
        with availability_read_scope(32 * 1024 * 1024), self.repository._connection() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                "SELECT request_hash FROM local_media_review_write_requests WHERE project_id=? "
                "AND episode_id=? AND idempotency_key_hash=?",
                (p, e, key),
            ).fetchone()
            payload_hash = canonical_content_hash(payload.model_dump(mode="json"))
            if row is not None:
                if row[0] != full:
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_CONFLICT", "Original operation input changed", 409
                    )
                try:
                    result = self._original(c, p, e, operation_id, payload_hash, actor_id)
                except Exception as error:
                    raise RuntimeError("Committed review receipt attribution failed") from error
                c.commit()
                return result
            budget = ImpactMaterializationBudget()
            target = self._target(
                c,
                p,
                e,
                i.assembly_version_id,
                i.assembly_content_hash,
                i.segment_kind,
                i.segment_id,
                budget,
            )
            for field in ("assembly_head_revision", "segment_content_hash"):
                if getattr(target.snapshot, field) != getattr(i, field):
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_CONFLICT", "Exact saved target changed", 409
                    )
            if target.snapshot_hash != i.target_snapshot_hash:
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_CONFLICT", "Exact target snapshot changed", 409
                )
            content = LocalMediaReviewContentV1(
                schema_version="1.0.0",
                input=i,
                target_snapshot=target.snapshot,
                observation_method="ORIGINAL_AUDIO_LISTENING"
                if i.segment_kind == "AUDIO"
                else "LITERAL_SUBTITLE_TEXT_AND_RANGE",
                manual_review_only=True,
                formal_status="BLOCKED",
            )
            content_size = len(canonical_content_bytes(content.model_dump(mode="json")))
            if content_size > MAX_LOCAL_REVIEW_BYTES:
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_INPUT_REJECTED", "Review exceeds bounded body"
                )
            # The generic append returns its new row before the record validator.
            # Fence that known new body as well as all admitted recursive sources.
            if (
                budget.body_bytes + content_size > 32 * 1024 * 1024
                or len(budget.version_ids) >= 10_000
            ):
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_SOURCE_UNKNOWN", "自审来源超过本次有界读取限额", 503
                )

            def validate_record(v: ArtifactVersionRecord) -> None:
                self._data(c, v, p, e, budget)

            try:
                record = self.repository._create_artifact_version_in_connection(
                    c,
                    project_id=p,
                    episode_id=e,
                    artifact_type=ARTIFACT_TYPE,
                    schema_version="1.0.0",
                    content=content.model_dump(mode="json"),
                    author_actor_type="human",
                    author_actor_id=actor_id,
                    change_summary=SUMMARY,
                    parent_version_id=payload.parent_version_id,
                    expected_revision=payload.expected_revision,
                    dependencies=(
                        ArtifactDependencyDraft(
                            upstream_version_id=i.assembly_version_id,
                            relationship="derived_from",
                            impact="blocking",
                        ),
                    ),
                    record_validator=validate_record,
                )
            except ArtifactConflictError as error:
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_CONFLICT", "Review history revision changed", 409
                ) from error
            self.repository._transaction_step("local_media_review", "version_inserted")
            c.execute(
                "INSERT INTO local_media_review_write_requests VALUES(?,?,?,?,?,?,?,?)",
                (
                    p,
                    e,
                    key,
                    full,
                    record.version.artifact_id,
                    record.version.id,
                    payload.expected_revision,
                    record.head.revision,
                ),
            )
            self.repository._transaction_step("local_media_review", "receipt_inserted")
            result = self._original(c, p, e, operation_id, payload_hash, actor_id, budget)
            c.commit()
            return result

    def get(self, p: str, e: str, v: str) -> LocalMediaReviewVersionData:
        self.repository.get_episode(p, e)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._version(c, p, e, v, ImpactMaterializationBudget())

    def list(
        self, p: str, e: str, cursor: str | None = None, limit: int = 20
    ) -> LocalMediaReviewPageData:
        if not 1 <= limit <= 20:
            raise LocalMediaReviewError(
                "LOCAL_MEDIA_REVIEW_INPUT_REJECTED", "Page limit must be 1..20"
            )
        self.repository.get_episode(p, e)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            head = self._head(c, p, e, ARTIFACT_TYPE)
            budget = ImpactMaterializationBudget()
            if head is not None:
                self._version(c, p, e, head["latest_version_id"], budget)
            before = (
                self._version(c, p, e, cursor, budget).version_number
                if cursor
                else 9_007_199_254_740_991
            )
            ids = (
                c.execute(
                    "SELECT version_id FROM artifact_versions WHERE artifact_id=? AND "
                    "version_number<? ORDER BY version_number DESC LIMIT ?",
                    (head["artifact_id"], before, limit + 1),
                ).fetchall()
                if head
                else []
            )
            items = tuple(self._version(c, p, e, row[0], budget) for row in ids[:limit])
            return LocalMediaReviewPageData(
                project_id=p,
                episode_id=e,
                head_version_id=head["latest_version_id"] if head else None,
                head_revision=head["revision"] if head else None,
                items=items,
                next_cursor=items[-1].version_id if len(ids) > limit else None,
            )

    def status(self, p: str, e: str, v: str, digest: str) -> LocalMediaReviewStatusData:
        self.repository.get_episode(p, e)
        with availability_read_scope(32 * 1024 * 1024), self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            budget = ImpactMaterializationBudget()
            review = self._version(c, p, e, v, budget)
            if digest != review.content_hash:
                raise LocalMediaReviewError(
                    "LOCAL_MEDIA_REVIEW_CONFLICT", "Review hash differs", 409
                )
            target = review.content.target_snapshot
            current = None
            reasons: tuple[LocalMediaReviewStatusReason, ...] = ()
            applicability: Literal["CURRENT", "STALE", "UNKNOWN"] = "UNKNOWN"
            try:
                head = self._head(c, p, e, "episode_media_assembly")
                if head is None:
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_TARGET_CHANGED", "本集当前装配已不存在", 409
                    )
                current = LocalMediaReviewCurrentAssemblyV1(
                    version_id=head["latest_version_id"],
                    content_hash=head["content_hash"],
                    head_revision=head["revision"],
                )
                fresh = self._target(
                    c,
                    p,
                    e,
                    target.assembly_version_id,
                    target.assembly_content_hash,
                    target.segment_kind,
                    target.segment_id,
                    budget,
                )
                if fresh.snapshot != target:
                    raise LocalMediaReviewError(
                        "LOCAL_MEDIA_REVIEW_TARGET_CHANGED",
                        "保存版本或确切来源已变更，请重新自审",
                        409,
                    )
                applicability = "CURRENT"
            except LocalMediaReviewError as error:
                applicability = "STALE" if error.status in (404, 409) else "UNKNOWN"
                reasons = (LocalMediaReviewStatusReason(code=error.code, message=str(error)),)
            except (ValueError, RuntimeError, sqlite3.Error):
                reasons = (
                    LocalMediaReviewStatusReason(
                        code="LOCAL_MEDIA_REVIEW_SOURCE_UNKNOWN",
                        message="当前来源暂时无法核对；历史观察仍可读取",
                    ),
                )
            return LocalMediaReviewStatusData(
                review_version_id=v,
                review_content_hash=digest,
                applicability=applicability,
                current_assembly=current,
                reasons=reasons,
                checked_at=datetime.now(UTC),
                formal_status="BLOCKED",
            )
