"""Immutable visual versions and CAS receipts in the existing artifact repository."""

from __future__ import annotations

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.contracts import ArtifactHeadData
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.repository import ArtifactConflictError, ArtifactNotFoundError, StudioRepository
from aijian_api.visual_bible_contracts import (
    MAX_VISUAL_BIBLE_BYTES,
    CreateVisualBibleVersionRequest,
    VisualBibleHistoryEntry,
    VisualBibleHistoryPage,
    VisualBibleIndexData,
    VisualBibleReadData,
)
from aijian_api.visual_bible_integrity import (
    verify_visual_originals,
    visual_sources,
    visual_version,
)


class VisualBibleConflictError(ValueError):
    pass


class VisualBibleStore:
    def __init__(self, repository: StudioRepository) -> None:
        self.repository = repository

    @staticmethod
    def data(record: ArtifactVersionRecord, project_id: str) -> VisualBibleReadData:
        return VisualBibleReadData(
            project_id=project_id,
            head=ArtifactHeadData.model_validate(record.head),
            version=visual_version(record, project_id),
        )

    def _verified(self, record: ArtifactVersionRecord, project_id: str) -> VisualBibleReadData:
        data = self.data(record, project_id)
        with self.repository._connection() as connection:
            visual_sources(self.repository, connection, data.version.content)
        return data

    def get_version(self, project_id: str, version_id: str) -> VisualBibleReadData:
        return self._verified(
            self.repository.get_artifact_version(
                project_id,
                "visual_bible",
                version_id,
                episode_id=None,
            ),
            project_id,
        )

    def index(self, project_id: str) -> VisualBibleIndexData:
        record = self.repository.get_latest_artifact(project_id, "visual_bible", episode_id=None)
        latest = self._verified(record, project_id)
        head = latest.head
        return VisualBibleIndexData(
            project_id=project_id,
            head=head,
            latest_version=latest.version,
            review_version=self.get_version(project_id, head.review_version_id).version
            if head.review_version_id is not None
            else None,
            accepted_version=self.get_version(project_id, head.accepted_version_id).version
            if head.accepted_version_id is not None
            else None,
        )

    def history(
        self, project_id: str, *, limit: int = 20, cursor: str | None = None
    ) -> VisualBibleHistoryPage:
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError("History limit is outside the bounded page size")
        with self.repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            owners = connection.execute(
                "SELECT head.latest_version_id FROM artifacts AS artifact "
                "JOIN artifact_heads AS head ON head.artifact_id=artifact.artifact_id "
                "WHERE artifact.project_id=? AND artifact.artifact_type='visual_bible' "
                "AND artifact.episode_id IS NULL",
                (project_id,),
            ).fetchall()
            if not owners:
                raise ArtifactNotFoundError("Visual history was not found")
            if len(owners) != 1:
                raise ValueError("Visual history has ambiguous ownership")

            def read(version_id: str) -> VisualBibleReadData:
                record = self.repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=version_id,
                    episode_id=None,
                )
                result = self.data(record, project_id)
                visual_sources(self.repository, connection, result.version.content)
                return result

            latest = read(str(owners[0]["latest_version_id"]))
            before = (
                read(cursor).version.version_number
                if cursor is not None
                else latest.version.version_number + 1
            )
            rows = connection.execute(
                "SELECT version_id FROM artifact_versions WHERE artifact_id=? "
                "AND version_number<? ORDER BY version_number DESC LIMIT ?",
                (latest.head.artifact_id, before, limit + 1),
            ).fetchall()
            entries: list[VisualBibleHistoryEntry] = []
            for row in rows[:limit]:
                version = read(str(row["version_id"])).version
                entries.append(
                    VisualBibleHistoryEntry(
                        id=version.id,
                        artifact_id=version.artifact_id,
                        version_number=version.version_number,
                        content_hash=version.content_hash,
                        parent_version_id=version.parent_version_id,
                        creative_library_version_id=version.content.creative_library_version_id,
                        creative_library_content_hash=version.content.creative_library_content_hash,
                        author_actor_id=version.author_actor_id,
                        change_summary=version.change_summary,
                        change_reason=version.content.change_reason,
                        created_at=version.created_at,
                    )
                )
            return VisualBibleHistoryPage(
                project_id=project_id,
                head=latest.head,
                cursor=cursor,
                limit=limit,
                items=tuple(entries),
                next_cursor=entries[-1].id if len(rows) > limit else None,
            )

    def write(
        self,
        project_id: str,
        payload: CreateVisualBibleVersionRequest,
        *,
        idempotency_key: str,
        actor_id: str,
    ) -> tuple[VisualBibleReadData, bool]:
        if not 1 <= len(idempotency_key) <= 200 or not 1 <= len(actor_id.strip()) <= 240:
            raise ValueError("Bounded idempotency key and trusted actor are required")
        payload = CreateVisualBibleVersionRequest.model_validate(payload.model_dump(mode="python"))
        if payload.content.project_id != project_id:
            raise ValueError("Visual content project differs from the target")
        content = payload.content.model_dump(mode="json")
        if len(canonical_content_bytes(content)) > MAX_VISUAL_BIBLE_BYTES:
            raise ValueError("Visual version exceeds the supported byte budget")
        key_hash = canonical_content_hash({"value": idempotency_key})
        request_hash = canonical_content_hash(
            {
                "project_id": project_id,
                "actor_id": actor_id,
                "payload": payload.model_dump(mode="json"),
            }
        )
        with self.repository._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self.repository.get_project(project_id)
            receipt = connection.execute(
                "SELECT * FROM visual_bible_write_requests "
                "WHERE project_id=? AND idempotency_key_hash=?",
                (project_id, key_hash),
            ).fetchone()
            if receipt is not None:
                if str(receipt["request_hash"]) != request_hash:
                    raise VisualBibleConflictError(
                        "Idempotency key was reused with another visual input"
                    )
                record = self.repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project_id,
                    artifact_type="visual_bible",
                    version_id=str(receipt["version_id"]),
                    episode_id=None,
                )
                if record.version.artifact_id != str(receipt["artifact_id"]):
                    raise ValueError("Visual receipt scope is inconsistent")
                result = self.data(record, project_id)
                visual_sources(self.repository, connection, result.version.content)
                connection.commit()
                return result, True
            try:
                parent = self.repository.get_latest_artifact(
                    project_id, "visual_bible", episode_id=None
                )
            except ArtifactNotFoundError:
                parent = None
            if (
                parent is None
                and (payload.parent_version_id is not None or payload.expected_revision is not None)
            ) or (
                parent is not None
                and (
                    payload.parent_version_id != parent.version.id
                    or payload.expected_revision != parent.head.revision
                )
            ):
                raise VisualBibleConflictError("Visual head revision has changed")
            if (
                parent is not None
                and parent.version.schema_version == "1.1.0"
                and payload.content.schema_version != "1.1.0"
            ):
                raise ValueError("An environment-aware visual version cannot be downgraded")
            _, refs = visual_sources(self.repository, connection, payload.content)
            verify_visual_originals(self.repository, project_id, refs)

            def validate(record: ArtifactVersionRecord) -> None:
                self.data(record, project_id)

            try:
                record = self.repository.create_artifact_version(
                    project_id=project_id,
                    artifact_type="visual_bible",
                    episode_id=None,
                    schema_version=payload.content.schema_version,
                    content=content,
                    author_actor_type="human",
                    author_actor_id=actor_id,
                    change_summary=payload.change_summary,
                    parent_version_id=payload.parent_version_id,
                    expected_revision=payload.expected_revision,
                    dependencies=(
                        ArtifactDependencyDraft(
                            upstream_version_id=payload.content.creative_library_version_id,
                            relationship="references",
                            impact="blocking",
                        ),
                    ),
                    record_validator=validate,
                    _transaction_connection=connection,
                    _manage_transaction=False,
                )
            except ArtifactConflictError as error:
                raise VisualBibleConflictError("Visual head revision has changed") from error
            result = self.data(record, project_id)
            connection.execute(
                "INSERT INTO visual_bible_write_requests VALUES (?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    key_hash,
                    request_hash,
                    record.version.artifact_id,
                    record.version.id,
                    record.version.created_at.isoformat(),
                ),
            )
            connection.commit()
            return result, False
