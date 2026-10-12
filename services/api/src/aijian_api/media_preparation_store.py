"""Append-only, episode-scoped inputs over the existing artifact truth."""

from __future__ import annotations

import sqlite3
from uuid import UUID

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.creative_reference_verification import verify_creative_references
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.media_preparation_contracts import (
    MAX_PREPARATION_BYTES,
    CreateMediaPreparationRequest,
    MediaPreparationContentV1,
    MediaPreparationInputV1,
    MediaPreparationOperationData,
    MediaPreparationPageData,
    MediaPreparationSnapshotV1,
    MediaPreparationVersionData,
)
from aijian_api.project_character_details_contracts import ProjectCharacterReferenceV1
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.project_environment_contracts import ProjectEnvironmentReferenceV1
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.script_confirmation_impact_projection import (
    ImpactMaterializationBudget,
    _preflight_board_sources,
    bounded_version_record,
)
from aijian_api.storyboard_character_bindings import selected_character_references
from aijian_api.storyboard_environment_bindings import selected_environment_references

ARTIFACT_TYPE = "episode_media_preparation"


class MediaPreparationError(ValueError):
    pass


class MediaPreparationConflict(MediaPreparationError):
    pass


class MediaPreparationNotFound(MediaPreparationError):
    pass


class MediaPreparationStore:
    def __init__(self, repository: StudioRepository):
        self.repository = repository

    def _snapshot(
        self,
        connection: sqlite3.Connection,
        input: MediaPreparationInputV1,
        *,
        fresh: bool,
        budget: ImpactMaterializationBudget | None = None,
        exact_originals: bool = False,
    ) -> MediaPreparationSnapshotV1:
        r = self.repository
        budget = budget if budget is not None else ImpactMaterializationBudget()
        record = bounded_version_record(
            r,
            connection,
            project_id=input.project_id,
            episode_id=input.episode_id,
            artifact_type="episode_storyboard",
            version_id=input.storyboard_version_id,
            budget=budget,
        )
        _preflight_board_sources(r, connection, record, input.project_id, input.episode_id, budget)
        board = EpisodeStoryboardStore(r)._verified_version_data(
            record, project_id=input.project_id, episode_id=input.episode_id, connection=connection
        )
        if board.content_hash != input.storyboard_content_hash:
            raise MediaPreparationError("Pinned storyboard hash differs")
        shot = next((s for s in board.content.shots if s.shot_id == input.shot_id), None)
        if shot is None:
            raise MediaPreparationError("Shot is not in this exact storyboard")
        refs: tuple[ProjectCharacterReferenceV1 | ProjectEnvironmentReferenceV1, ...] = ()
        if board.content.creative_library_version_id is not None:
            library_record = bounded_version_record(
                r,
                connection,
                project_id=input.project_id,
                artifact_type="project_creative_library",
                version_id=board.content.creative_library_version_id,
                budget=budget,
            )
            library = ProjectCreativeLibraryStore._version_data(
                library_record, project_id=input.project_id
            ).content
            selected = board.content.model_copy(update={"shots": (shot,)})
            refs = selected_character_references(
                selected, library
            ) + selected_environment_references(selected, library)
            if fresh:
                # Historical G5 authority is checked above. This preparation only
                # consumes the selected shot's originals; no current-G5 dispatch gate.
                if exact_originals:
                    from aijian_api.manual_media_original import exact_local_original

                    for reference in refs:
                        exact_local_original(
                            r,
                            connection,
                            input.project_id,
                            reference.asset_id,
                            reference.asset_version_id,
                            reference.asset_sha256,
                            fresh=True,
                        )
                else:
                    verify_creative_references(r, input.project_id, refs, connection=connection)
        pin = getattr(board.content, "visual_bible_pin", None)
        return MediaPreparationSnapshotV1(
            storyboard_schema_version=board.content.schema_version,
            fps=board.content.fps,
            shot=shot,
            script_version_id=board.content.script_version_id,
            creative_library_version_id=board.content.creative_library_version_id,
            visual_bible_version_id=pin.version_id if pin else None,
            selected_references=refs,
        )

    def _version(
        self,
        connection: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        version_id: str,
        budget: ImpactMaterializationBudget | None = None,
    ) -> MediaPreparationVersionData:
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
            metrics.content_json_bytes > MAX_PREPARATION_BYTES
            or metrics.source_span_count
            or edge_count != 1
        ):
            raise MediaPreparationError("Preparation SQL materialization fence rejected")
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
            "SELECT artifact_id FROM media_preparation_write_requests WHERE version_id=?",
            (version_id,),
        ).fetchall()
        if len(receipts) != 1 or receipts[0][0] != record.version.artifact_id:
            raise MediaPreparationError("Preparation original receipt is missing or orphaned")
        return self._data(connection, record, project_id, episode_id, budget)

    def _data(
        self,
        connection: sqlite3.Connection,
        record: ArtifactVersionRecord,
        project_id: str,
        episode_id: str,
        budget: ImpactMaterializationBudget | None = None,
    ) -> MediaPreparationVersionData:
        budget = budget if budget is not None else ImpactMaterializationBudget()
        v = record.version
        if len(canonical_content_bytes(v.content)) > MAX_PREPARATION_BYTES:
            raise MediaPreparationError("Preparation body exceeds the supported size")
        content = MediaPreparationContentV1.model_validate(v.content)
        actual = tuple(
            (e.upstream_version_id, e.relationship, e.impact) for e in record.dependencies
        )
        if (
            v.author_actor_id != "local-user"
            or v.author_actor_type != "human"
            or v.change_summary != "Save independent media request input"
            or v.schema_version != "1.0.0"
            or v.content_hash != canonical_content_hash(v.content)
            or content.input.project_id != project_id
            or content.input.episode_id != episode_id
            or content.model_dump(mode="json") != v.content
            or record.source_spans
            or actual != ((content.input.storyboard_version_id, "derived_from", "blocking"),)
            or content.snapshot
            != self._snapshot(connection, content.input, fresh=False, budget=budget)
        ):
            raise MediaPreparationError("Preparation immutable source or snapshot differs")
        return MediaPreparationVersionData(
            version_id=v.id,
            version_number=v.version_number,
            parent_version_id=v.parent_version_id,
            author_actor_id="local-user",
            content=content,
            content_hash=v.content_hash,
            created_at=v.created_at,
        )

    def get(self, project_id: str, episode_id: str, version_id: str) -> MediaPreparationVersionData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._version(c, project_id, episode_id, version_id)

    def list(
        self, project_id: str, episode_id: str, cursor: str | None = None
    ) -> MediaPreparationPageData:
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
                    raise MediaPreparationError("Preparation sequence head is missing")
                return MediaPreparationPageData(
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
                raise MediaPreparationError("Preparation sequence head is inconsistent")
            ids = c.execute(
                "SELECT version_id FROM artifact_versions WHERE artifact_id=? AND version_number<? "
                "ORDER BY version_number DESC LIMIT 21",
                (head["artifact_id"], before),
            ).fetchall()
            items = tuple(
                self._version(c, project_id, episode_id, row[0], budget) for row in ids[:20]
            )
            return MediaPreparationPageData(
                project_id=project_id,
                episode_id=episode_id,
                head_version_id=head["latest_version_id"],
                head_revision=head["revision"],
                items=items,
                next_cursor=items[-1].version_id if len(ids) > 20 else None,
            )

    @staticmethod
    def _hashes(
        operation_id: str, payload: CreateMediaPreparationRequest, actor_id: str
    ) -> tuple[str, str]:
        UUID(operation_id)
        if actor_id != "local-user":
            raise MediaPreparationError("Trusted local actor is required")
        return canonical_content_hash({"value": operation_id}), canonical_content_hash(
            {"payload": payload.model_dump(mode="json"), "actor_id": actor_id}
        )

    def _original(
        self,
        c: sqlite3.Connection,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateMediaPreparationRequest,
        actor_id: str,
    ) -> MediaPreparationOperationData:
        key, full = self._hashes(operation_id, payload, actor_id)
        row = c.execute(
            "SELECT * FROM media_preparation_write_requests WHERE project_id=? "
            "AND episode_id=? AND idempotency_key_hash=?",
            (project_id, episode_id, key),
        ).fetchone()
        if row is None or row["request_hash"] != full:
            raise MediaPreparationNotFound("Original full input is not attributable; do not resend")
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
            raise MediaPreparationError("Original receipt differs from immutable input")
        return MediaPreparationOperationData(
            operation_id=operation_id, payload=payload, version=version
        )

    def original(
        self,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateMediaPreparationRequest,
        actor_id: str,
    ) -> MediaPreparationOperationData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            return self._original(c, project_id, episode_id, operation_id, payload, actor_id)

    def original_for_hash(
        self, project_id: str, episode_id: str, operation_id: str, payload_hash: str, actor_id: str
    ) -> MediaPreparationOperationData:
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("PRAGMA query_only=ON")
            c.execute("BEGIN")
            key = canonical_content_hash({"value": operation_id})
            row = c.execute(
                "SELECT * FROM media_preparation_write_requests WHERE project_id=? "
                "AND episode_id=? AND idempotency_key_hash=?",
                (project_id, episode_id, key),
            ).fetchone()
            if row is None:
                raise MediaPreparationNotFound("Original receipt absent; do not resend")
            v = self._version(c, project_id, episode_id, row["version_id"])
            payload = CreateMediaPreparationRequest(
                input=v.content.input,
                parent_version_id=v.parent_version_id,
                expected_revision=row["expected_revision"],
            )
            if canonical_content_hash(payload.model_dump(mode="json")) != payload_hash:
                raise MediaPreparationNotFound("Original complete input hash differs")
            return self._original(c, project_id, episode_id, operation_id, payload, actor_id)

    def write(
        self,
        project_id: str,
        episode_id: str,
        operation_id: str,
        payload: CreateMediaPreparationRequest,
        actor_id: str,
    ) -> MediaPreparationOperationData:
        if (payload.input.project_id, payload.input.episode_id) != (project_id, episode_id):
            raise MediaPreparationError("Preparation scope differs from route")
        key, full = self._hashes(operation_id, payload, actor_id)
        self.repository.get_episode(project_id, episode_id)
        with self.repository._connection() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                "SELECT request_hash FROM media_preparation_write_requests WHERE project_id=? "
                "AND episode_id=? AND idempotency_key_hash=?",
                (project_id, episode_id, key),
            ).fetchone()
            if row:
                if row[0] != full:
                    raise MediaPreparationConflict("Operation input changed")
                result = self._original(c, project_id, episode_id, operation_id, payload, actor_id)
                c.commit()
                return result
            snapshot = self._snapshot(c, payload.input, fresh=True)
            content = MediaPreparationContentV1(
                schema_version="1.0.0", input=payload.input, snapshot=snapshot
            ).model_dump(mode="json")
            if len(canonical_content_bytes(content)) > MAX_PREPARATION_BYTES:
                raise MediaPreparationError("Preparation exceeds the supported size")

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
                    change_summary="Save independent media request input",
                    parent_version_id=payload.parent_version_id,
                    expected_revision=payload.expected_revision,
                    dependencies=(
                        ArtifactDependencyDraft(
                            upstream_version_id=payload.input.storyboard_version_id,
                            relationship="derived_from",
                            impact="blocking",
                        ),
                    ),
                    record_validator=validate_candidate,
                )
            except ArtifactConflictError as e:
                raise MediaPreparationConflict("Preparation history revision changed") from e
            if self.repository._transaction_hook:
                self.repository._transaction_hook("media_preparation", "version_inserted")
            c.execute(
                "INSERT INTO media_preparation_write_requests VALUES(?,?,?,?,?,?,?)",
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
                self.repository._transaction_hook("media_preparation", "receipt_inserted")
            result = self._original(c, project_id, episode_id, operation_id, payload, actor_id)
            c.commit()
            return result
