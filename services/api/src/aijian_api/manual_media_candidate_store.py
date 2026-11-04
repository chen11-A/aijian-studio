"""Append-only, episode-scoped inputs over the existing artifact truth."""

from __future__ import annotations

import re
import sqlite3
from uuid import UUID

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.manual_media_candidate_contracts import (
    MAX_CANDIDATE_BYTES,
    CreateManualMediaCandidateRequest,
    ManualMediaAssetSnapshotV1,
    ManualMediaCandidateContentV1,
    ManualMediaCandidateInputV1,
    ManualMediaCandidateOperationData,
    ManualMediaCandidatePageData,
    ManualMediaCandidateVersionData,
)
from aijian_api.manual_media_original import exact_local_original
from aijian_api.media_preparation_store import MediaPreparationStore
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.script_confirmation_impact_projection import (
    ImpactMaterializationBudget,
    bounded_version_record,
)

ARTIFACT_TYPE = "episode_manual_media_candidate"


class ManualMediaCandidateError(ValueError):
    pass


class ManualMediaCandidateConflict(ManualMediaCandidateError):
    pass


class ManualMediaCandidateNotFound(ManualMediaCandidateError):
    pass


class ManualMediaCandidateStore:
    def __init__(self, repository: StudioRepository):
        self.repository = repository

    def _snapshot(
        self,
        connection: sqlite3.Connection,
        input: ManualMediaCandidateInputV1,
        *,
        fresh: bool,
        budget: ImpactMaterializationBudget | None = None,
    ) -> ManualMediaAssetSnapshotV1:
        budget = budget if budget is not None else ImpactMaterializationBudget()
        preparation = MediaPreparationStore(self.repository)._version(
            connection, input.project_id, input.episode_id, input.preparation_version_id, budget
        )
        if preparation.content_hash != input.preparation_content_hash:
            raise ManualMediaCandidateError("Pinned complete preparation hash differs")
        selected = exact_local_original(
            self.repository,
            connection,
            input.project_id,
            input.asset_id,
            input.asset_version_id,
            input.asset_sha256,
            fresh=fresh,
        )
        if (
            selected.kind != preparation.content.input.capability_intent.lower()
            or selected.kind == "audio"
        ):
            raise ManualMediaCandidateError("Imported asset kind differs from exact input intent")
        snapshot = ManualMediaAssetSnapshotV1(
            filename=selected.filename,
            kind=selected.kind,
            mime_type=selected.mime_type,
            byte_size=selected.byte_size,
            sha256=selected.sha256,
            technical_metadata=selected.technical_metadata,
        )
        return snapshot

    def _version(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        version_id: str,
        budget: ImpactMaterializationBudget | None = None,
    ) -> ManualMediaCandidateVersionData:
        budget = budget if budget is not None else ImpactMaterializationBudget()
        metrics = self.repository._get_artifact_version_payload_metrics_in_connection(
            connection,
            project_id=project_id,
            episode_id=episode_id,
            artifact_type=ARTIFACT_TYPE,
            version_id=version_id,
        )
        edge_count = connection.execute(
            "SELECT count(*) FROM artifact_dependencies WHERE downstream_version_id=?",
            (version_id,),
        ).fetchone()[0]
        if (
            metrics.content_json_bytes > MAX_CANDIDATE_BYTES
            or metrics.source_span_count
            or edge_count != 1
        ):
            raise ManualMediaCandidateError("Candidate SQL materialization fence rejected")
        record = bounded_version_record(
            self.repository,
            connection,
            project_id=project_id,
            episode_id=episode_id,
            artifact_type=ARTIFACT_TYPE,
            version_id=version_id,
            budget=budget,
        )
        receipts = connection.execute(
            "SELECT * FROM manual_media_candidate_write_requests WHERE version_id=?",
            (version_id,),
        ).fetchall()
        if len(receipts) != 1 or receipts[0]["artifact_id"] != record.version.artifact_id:
            raise ManualMediaCandidateError("Candidate original receipt is missing or orphaned")
        result = self._data(connection, record, project_id, episode_id, budget)
        original_payload = CreateManualMediaCandidateRequest(
            input=result.content.input,
            parent_version_id=result.parent_version_id,
            expected_revision=receipts[0]["expected_revision"],
        )
        full = canonical_content_hash(
            {"payload": original_payload.model_dump(mode="json"), "actor_id": "local-user"}
        )
        if receipts[0]["request_hash"] != full:
            raise ManualMediaCandidateError(
                "Candidate original receipt hash differs from exact input"
            )
        return result

    def _data(
        self,
        connection: sqlite3.Connection,
        record: ArtifactVersionRecord,
        project_id: str,
        episode_id: str,
        budget: ImpactMaterializationBudget | None = None,
    ) -> ManualMediaCandidateVersionData:
        budget = budget if budget is not None else ImpactMaterializationBudget()
        v = record.version
        if len(canonical_content_bytes(v.content)) > MAX_CANDIDATE_BYTES:
            raise ManualMediaCandidateError("Candidate body exceeds the supported size")
        content = ManualMediaCandidateContentV1.model_validate(v.content)
        actual = tuple(
            (e.upstream_version_id, e.relationship, e.impact) for e in record.dependencies
        )
        if (
            v.author_actor_id != "local-user"
            or v.author_actor_type != "human"
            or v.change_summary != "Associate exact local-import media candidate"
            or v.schema_version != "1.0.0"
            or v.content_hash != canonical_content_hash(v.content)
            or content.input.project_id != project_id
            or content.input.episode_id != episode_id
            or content.model_dump(mode="json") != v.content
            or record.source_spans
            or actual != ((content.input.preparation_version_id, "derived_from", "blocking"),)
            or content.asset_snapshot
            != self._snapshot(connection, content.input, fresh=False, budget=budget)
        ):
            raise ManualMediaCandidateError("Candidate immutable source or snapshot differs")
        return ManualMediaCandidateVersionData(
            version_id=v.id,
            version_number=v.version_number,
            parent_version_id=v.parent_version_id,
            author_actor_id="local-user",
            content=content,
            content_hash=v.content_hash,
            created_at=v.created_at,
        )

    def get(
        self, project_id: str, episode_id: str, version_id: str
    ) -> ManualMediaCandidateVersionData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._version(c, project_id, episode_id, version_id)

    def list(
        self, project_id: str, episode_id: str, cursor: str | None = None
    ) -> ManualMediaCandidatePageData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            head = c.execute(
                """SELECT h.latest_version_id,h.revision,a.artifact_id
                   FROM artifacts a JOIN artifact_heads h ON h.artifact_id=a.artifact_id
                   WHERE a.project_id=? AND a.episode_id=? AND a.artifact_type=?""",
                (project_id, episode_id, ARTIFACT_TYPE),
            ).fetchone()
            budget = ImpactMaterializationBudget()
            before = 9_007_199_254_740_991
            if cursor:
                old = self._version(c, project_id, episode_id, cursor, budget)
                before = old.version_number
            if head is None:
                if c.execute(
                    "SELECT 1 FROM artifacts WHERE project_id=? AND episode_id=? "
                    "AND artifact_type=?",
                    (project_id, episode_id, ARTIFACT_TYPE),
                ).fetchone():
                    raise ManualMediaCandidateError("Candidate sequence head is missing")
                return ManualMediaCandidatePageData(
                    project_id=project_id,
                    episode_id=episode_id,
                    head_version_id=None,
                    head_revision=None,
                    items=(),
                    next_cursor=None,
                )
            newest = c.execute(
                "SELECT version_id FROM artifact_versions WHERE artifact_id=? "
                "ORDER BY version_number DESC LIMIT 1",
                (head["artifact_id"],),
            ).fetchone()
            if newest is None or newest[0] != head["latest_version_id"]:
                raise ManualMediaCandidateError("Candidate sequence head is inconsistent")
            ids = c.execute(
                "SELECT version_id FROM artifact_versions WHERE artifact_id=? AND version_number<? "
                "ORDER BY version_number DESC LIMIT 21",
                (head["artifact_id"], before),
            ).fetchall()
            items = tuple(
                self._version(c, project_id, episode_id, row[0], budget) for row in ids[:20]
            )
            return ManualMediaCandidatePageData(
                project_id=project_id,
                episode_id=episode_id,
                head_version_id=head["latest_version_id"],
                head_revision=head["revision"],
                items=items,
                next_cursor=items[-1].version_id if len(ids) > 20 else None,
            )

    @staticmethod
    def _hashes(
        operation_id: str, payload: CreateManualMediaCandidateRequest, actor_id: str
    ) -> tuple[str, str]:
        UUID(operation_id)
        if (
            re.fullmatch(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
                operation_id,
            )
            is None
        ):
            raise ManualMediaCandidateError("Canonical original UUID bytes required")
        if actor_id != "local-user":
            raise ManualMediaCandidateError("Trusted local actor is required")
        return canonical_content_hash({"value": operation_id}), canonical_content_hash(
            {"payload": payload.model_dump(mode="json"), "actor_id": actor_id}
        )

    def _original(
        self,
        c: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateManualMediaCandidateRequest,
        actor_id: str,
    ) -> ManualMediaCandidateOperationData:
        key, full = self._hashes(operation_id, payload, actor_id)
        row = c.execute(
            "SELECT * FROM manual_media_candidate_write_requests WHERE project_id=? "
            "AND episode_id=? AND idempotency_key_hash=?",
            (project_id, episode_id, key),
        ).fetchone()
        if row is None or row["request_hash"] != full:
            raise ManualMediaCandidateNotFound(
                "Original full input is not attributable; do not resend"
            )
        version = self._version(c, project_id, episode_id, row["version_id"])
        record = self.repository._get_artifact_version_in_connection(
            c,
            project_id=project_id,
            episode_id=episode_id,
            artifact_type=ARTIFACT_TYPE,
            version_id=version.version_id,
        )
        if (
            record.version.artifact_id != row["artifact_id"]
            or version.content.input != payload.input
            or version.parent_version_id != payload.parent_version_id
            or version.author_actor_id != actor_id
            or payload.expected_revision != row["expected_revision"]
        ):
            raise ManualMediaCandidateError("Original receipt differs from immutable input")
        return ManualMediaCandidateOperationData(
            operation_id=operation_id, payload=payload, version=version
        )

    def original(
        self,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateManualMediaCandidateRequest,
        actor_id: str,
    ) -> ManualMediaCandidateOperationData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._original(c, project_id, episode_id, operation_id, payload, actor_id)

    def original_for_hash(
        self, project_id: str, episode_id: str, operation_id: str, payload_hash: str, actor_id: str
    ) -> ManualMediaCandidateOperationData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            key = canonical_content_hash({"value": operation_id})
            row = c.execute(
                "SELECT * FROM manual_media_candidate_write_requests WHERE project_id=? "
                "AND episode_id=? AND idempotency_key_hash=?",
                (project_id, episode_id, key),
            ).fetchone()
            if row is None:
                raise ManualMediaCandidateNotFound("Original receipt absent; do not resend")
            v = self._version(c, project_id, episode_id, row["version_id"])
            payload = CreateManualMediaCandidateRequest(
                input=v.content.input,
                parent_version_id=v.parent_version_id,
                expected_revision=row["expected_revision"],
            )
            if canonical_content_hash(payload.model_dump(mode="json")) != payload_hash:
                raise ManualMediaCandidateNotFound("Original complete input hash differs")
            return self._original(c, project_id, episode_id, operation_id, payload, actor_id)

    def write(
        self,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateManualMediaCandidateRequest,
        actor_id: str,
    ) -> ManualMediaCandidateOperationData:
        if (payload.input.project_id, payload.input.episode_id) != (project_id, episode_id):
            raise ManualMediaCandidateError("Candidate scope differs from route")
        key, full = self._hashes(operation_id, payload, actor_id)
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                "SELECT request_hash FROM manual_media_candidate_write_requests WHERE project_id=? "
                "AND episode_id=? AND idempotency_key_hash=?",
                (project_id, episode_id, key),
            ).fetchone()
            if row:
                if row[0] != full:
                    raise ManualMediaCandidateConflict("Operation input changed")
                try:
                    result = self._original(
                        c, project_id, episode_id, operation_id, payload, actor_id
                    )
                except Exception as error:
                    raise RuntimeError("Existing candidate receipt attribution failed") from error
                c.commit()
                return result
            snapshot = self._snapshot(c, payload.input, fresh=True)
            content = ManualMediaCandidateContentV1(
                schema_version="1.0.0",
                input=payload.input,
                asset_snapshot=snapshot,
                origin="LOCAL_IMPORT",
                association="MANUAL_ASSOCIATION",
                cost_status="UNKNOWN",
            ).model_dump(mode="json")
            if len(canonical_content_bytes(content)) > MAX_CANDIDATE_BYTES:
                raise ManualMediaCandidateError("Candidate exceeds the supported size")

            def validate_candidate(v: ArtifactVersionRecord) -> None:
                self._data(c, v, project_id, episode_id)

            try:
                record = self.repository._create_artifact_version_in_connection(
                    c,
                    project_id=project_id,
                    episode_id=episode_id,
                    artifact_type=ARTIFACT_TYPE,
                    schema_version="1.0.0",
                    content=content,
                    author_actor_type="human",
                    author_actor_id=actor_id,
                    change_summary="Associate exact local-import media candidate",
                    parent_version_id=payload.parent_version_id,
                    expected_revision=payload.expected_revision,
                    dependencies=(
                        ArtifactDependencyDraft(
                            upstream_version_id=payload.input.preparation_version_id,
                            relationship="derived_from",
                            impact="blocking",
                        ),
                    ),
                    record_validator=validate_candidate,
                )
            except ArtifactConflictError as e:
                raise ManualMediaCandidateConflict("Candidate history revision changed") from e
            if self.repository._transaction_hook:
                self.repository._transaction_hook("manual_media_candidate", "version_inserted")
            c.execute(
                "INSERT INTO manual_media_candidate_write_requests VALUES(?,?,?,?,?,?,?)",
                (
                    project_id,
                    episode_id,
                    key,
                    full,
                    record.version.artifact_id,
                    record.version.id,
                    payload.expected_revision,
                ),
            )
            if self.repository._transaction_hook:
                self.repository._transaction_hook("manual_media_candidate", "receipt_inserted")
            result = self._original(c, project_id, episode_id, operation_id, payload, actor_id)
            c.commit()
            return result
