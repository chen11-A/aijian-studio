"""Atomic HUMAN proposal/review/adoption over the existing immutable artifact store."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_script_confirmation_store import (
    EpisodeScriptConfirmationNotFoundError,
    EpisodeScriptConfirmationStore,
)
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.shot_plan_contracts import (
    MAX_SHOT_PLAN_BYTES,
    AdoptShotPlanRequest,
    CreateHumanShotPlanRequest,
    ShotPlanAdaptedAuthority,
    ShotPlanAdoptionData,
    ShotPlanContentV1,
    ShotPlanCreativeAuthority,
    ShotPlanExactVersion,
    ShotPlanOriginalAuthority,
    ShotPlanPreparationData,
    ShotPlanProposalData,
    ShotPlanScriptPin,
)
from aijian_api.shot_plan_projection import project_storyboard, review_capability_losses
from aijian_api.shot_plan_validation import (
    ShotPlanError,
    exact_record,
    resolve_authority,
    storyboard_base,
    validate_coverage,
)
from aijian_api.task_ledger_models import timestamp, utc_now

ARTIFACT_TYPE = "shot_plan_proposal"


def dependencies(content: ShotPlanContentV1) -> tuple[ArtifactDependencyDraft, ...]:
    authority = content.authority
    versions = [authority.script.version_id, authority.production_brief.version_id]
    if isinstance(authority, ShotPlanAdaptedAuthority):
        versions.append(authority.source_extraction.version_id)
    return tuple(
        ArtifactDependencyDraft(
            upstream_version_id=version,
            relationship="derived_from",
            impact="blocking",
        )
        for version in versions
    )


class ShotPlanProposalStore:
    def __init__(
        self,
        repository: StudioRepository,
        *,
        clock: Callable[[], datetime] = utc_now,
        transaction_hook: Callable[[str], None] | None = None,
    ) -> None:
        self.repository = repository
        self._clock = clock
        self._hook = transaction_hook

    @contextmanager
    def connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.repository.database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            if not write:
                connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except ShotPlanError:
            connection.rollback()
            raise
        except EpisodeScriptConfirmationNotFoundError as error:
            connection.rollback()
            raise ShotPlanError("SHOT_PLAN_CONFIRMATION_REQUIRED", 422) from error
        except ArtifactConflictError as error:
            connection.rollback()
            raise ShotPlanError("SHOT_PLAN_CONFLICT") from error
        except (sqlite3.DatabaseError, ValueError, TypeError, KeyError, RuntimeError) as error:
            connection.rollback()
            raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500) from error
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _identity(key: str, actor: str) -> None:
        if not key.strip() or len(key) > 240 or not actor.strip() or len(actor) > 240:
            raise ShotPlanError("SHOT_PLAN_IDENTITY_INVALID", 422)

    def prepare(self, project: str, episode: str) -> ShotPlanPreparationData:
        with self.connection() as connection:
            status = EpisodeScriptConfirmationStore(self.repository)._status_in_connection(
                connection,
                project_id=project,
                episode_id=episode,
            )
            receipt = status.confirmation
            if not status.current or receipt is None:
                raise ShotPlanError("SHOT_PLAN_CONFIRMATION_REQUIRED", 422)
            record = exact_record(
                self.repository,
                connection,
                project,
                episode,
                "episode_script",
                receipt.version_id,
            )
            brief_id = record.version.content.get("production_brief_version_id")
            if not isinstance(brief_id, str):
                raise ShotPlanError("SHOT_PLAN_PRODUCTION_BRIEF_REQUIRED", 422)
            brief = exact_record(
                self.repository,
                connection,
                project,
                None,
                "production_brief",
                brief_id,
            )
            script_pin = ShotPlanScriptPin(
                confirmation_id=receipt.confirmation_id,
                version_id=receipt.version_id,
                content_hash=receipt.content_hash,
                head_revision=receipt.head_revision,
            )
            brief_pin = ShotPlanExactVersion(
                version_id=brief.version.id,
                content_hash=brief.version.content_hash,
            )
            authority: ShotPlanCreativeAuthority
            entry = brief.version.content.get("creative_entry")
            if isinstance(entry, dict) and entry.get("kind") == "original_idea":
                authority = ShotPlanOriginalAuthority(
                    mode="ORIGINAL",
                    script=script_pin,
                    production_brief=brief_pin,
                )
            else:
                source_id = record.version.content.get("source_extraction_version_id")
                acceptance_id = record.version.content.get("source_proposal_acceptance_id")
                if not isinstance(source_id, str) or not isinstance(acceptance_id, str):
                    raise ShotPlanError("SHOT_PLAN_ADAPTED_SOURCE_REQUIRED", 422)
                source = exact_record(
                    self.repository,
                    connection,
                    project,
                    None,
                    "source_extraction",
                    source_id,
                )
                authority = ShotPlanAdaptedAuthority(
                    mode="ADAPTED",
                    script=script_pin,
                    production_brief=brief_pin,
                    source_extraction=ShotPlanExactVersion(
                        version_id=source.version.id,
                        content_hash=source.version.content_hash,
                    ),
                    source_proposal_acceptance_id=acceptance_id,
                    source_span_ids=tuple(span.fact_id for span in source.source_spans),
                )
            script, brief_content = resolve_authority(
                self.repository,
                connection,
                project,
                episode,
                authority,
                require_current=True,
            )
            return ShotPlanPreparationData(
                project_id=project,
                episode_id=episode,
                authority=authority,
                script_content=script,
                production_brief_content=brief_content,
                script_stored_content=record.version.content,
                production_brief_stored_content=brief.version.content,
                storyboard_base=storyboard_base(self.repository, connection, project, episode),
            )

    def _adoption(
        self,
        connection: sqlite3.Connection,
        project: str,
        episode: str,
        record: ArtifactVersionRecord,
        content: ShotPlanContentV1,
    ) -> ShotPlanAdoptionData | None:
        row = connection.execute(
            """SELECT * FROM shot_plan_adoptions WHERE project_id = ? AND episode_id = ?
            AND proposal_version_id = ?""",
            (project, episode, record.version.id),
        ).fetchone()
        if row is None:
            return None
        if (
            row["proposal_content_hash"] != record.version.content_hash
            or row["proposal_artifact_id"] != record.version.artifact_id
        ):
            raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500)
        storyboard = exact_record(
            self.repository,
            connection,
            project,
            episode,
            "episode_storyboard",
            str(row["storyboard_version_id"]),
        )
        stored = EpisodeStoryboardStore(self.repository)._verified_version_data(
            storyboard,
            project_id=project,
            episode_id=episode,
            connection=connection,
        )
        script, _ = resolve_authority(
            self.repository,
            connection,
            project,
            episode,
            content.authority,
            require_current=False,
        )
        if (
            storyboard.version.artifact_id != row["storyboard_artifact_id"]
            or stored.content_hash != row["storyboard_content_hash"]
            or stored.content != project_storyboard(content, script)
            or stored.author_actor_id != row["actor_id"]
            or stored.parent_version_id
            != (content.storyboard_base.version_id if content.storyboard_base else None)
        ):
            raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500)
        return ShotPlanAdoptionData(
            proposal_version_id=record.version.id,
            proposal_content_hash=record.version.content_hash,
            storyboard_version_id=stored.version_id,
            storyboard_content_hash=stored.content_hash,
            actor_id=str(row["actor_id"]),
            adopted_at=datetime.fromisoformat(str(row["adopted_at"]).replace("Z", "+00:00")),
        )

    def _verified_data(
        self,
        connection: sqlite3.Connection,
        project: str,
        episode: str,
        record: ArtifactVersionRecord,
    ) -> ShotPlanProposalData:
        version = record.version
        content = ShotPlanContentV1.model_validate(version.content)
        author = connection.execute(
            """SELECT author_actor_type, producer_attempt_id FROM artifact_versions
            WHERE version_id = ?""",
            (version.id,),
        ).fetchone()
        expected = {
            (item.upstream_version_id, item.relationship, item.impact)
            for item in dependencies(content)
        }
        actual = {
            (item.upstream_version_id, item.relationship, item.impact)
            for item in record.dependencies
        }
        if (
            content.project_id != project
            or content.episode_id != episode
            or version.schema_version != "1.0.0"
            or content.model_dump(mode="json") != version.content
            or canonical_content_hash(version.content) != version.content_hash
            or len(canonical_content_bytes(version.content)) > MAX_SHOT_PLAN_BYTES
            or record.source_spans
            or expected != actual
            or len(actual) != len(record.dependencies)
            or author is None
            or author["author_actor_type"] != "human"
            or author["producer_attempt_id"] is not None
        ):
            raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500)
        script, _ = resolve_authority(
            self.repository,
            connection,
            project,
            episode,
            content.authority,
            require_current=False,
        )
        validate_coverage(content, script)
        return ShotPlanProposalData(
            version_id=version.id,
            content_hash=version.content_hash,
            version_number=version.version_number,
            head_revision=record.head.revision,
            parent_version_id=version.parent_version_id,
            content=content,
            author_actor_id=version.author_actor_id,
            created_at=version.created_at,
            capability_losses=review_capability_losses(content, script),
            adoption=self._adoption(connection, project, episode, record, content),
        )

    def _data(
        self,
        connection: sqlite3.Connection,
        project: str,
        episode: str,
        record: ArtifactVersionRecord,
    ) -> ShotPlanProposalData:
        try:
            return self._verified_data(connection, project, episode, record)
        except ShotPlanError as error:
            # Invalid persisted authority is uncertain storage truth, never a user-input rejection.
            raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500) from error

    def _read(
        self,
        connection: sqlite3.Connection,
        project: str,
        episode: str,
        version: str,
    ) -> ShotPlanProposalData:
        record = exact_record(self.repository, connection, project, episode, ARTIFACT_TYPE, version)
        return self._data(connection, project, episode, record)

    def get_version(self, project: str, episode: str, version: str) -> ShotPlanProposalData:
        with self.connection() as connection:
            return self._read(connection, project, episode, version)

    def get_latest(self, project: str, episode: str) -> ShotPlanProposalData:
        with self.connection() as connection:
            EpisodeStoryboardStore._require_episode(connection, project, episode)
            row = connection.execute(
                """SELECT head.latest_version_id FROM artifacts AS artifact
                JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
                WHERE artifact.project_id = ? AND artifact.episode_id = ?
                  AND artifact.artifact_type = ?""",
                (project, episode, ARTIFACT_TYPE),
            ).fetchone()
            if row is None:
                raise ShotPlanError("SHOT_PLAN_NOT_FOUND", 404)
            return self._read(connection, project, episode, str(row[0]))

    def get_write_status(self, project: str, episode: str, key: str) -> ShotPlanProposalData | None:
        with self.connection() as connection:
            EpisodeStoryboardStore._require_episode(connection, project, episode)
            row = connection.execute(
                """SELECT artifact_id, version_id FROM shot_plan_write_requests WHERE project_id = ?
                AND episode_id = ? AND idempotency_key_hash = ?""",
                (project, episode, canonical_content_hash({"value": key})),
            ).fetchone()
            if row is None:
                return None
            record = exact_record(
                self.repository,
                connection,
                project,
                episode,
                ARTIFACT_TYPE,
                str(row["version_id"]),
            )
            if record.version.artifact_id != row["artifact_id"]:
                raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500)
            return self._data(connection, project, episode, record)

    def write(
        self,
        project: str,
        episode: str,
        payload: CreateHumanShotPlanRequest,
        key: str,
        actor: str,
    ) -> tuple[ShotPlanProposalData, bool]:
        self._identity(key, actor)
        payload = CreateHumanShotPlanRequest.model_validate(payload.model_dump(mode="json"))
        content = payload.content
        if content.project_id != project or content.episode_id != episode:
            raise ShotPlanError("SHOT_PLAN_SCOPE_MISMATCH", 422)
        content_json = content.model_dump(mode="json")
        if len(canonical_content_bytes(content_json)) > MAX_SHOT_PLAN_BYTES:
            raise ShotPlanError("SHOT_PLAN_TOO_LARGE", 413)
        key_hash = canonical_content_hash({"value": key})
        request_hash = canonical_content_hash(
            {
                "project": project,
                "episode": episode,
                "actor": actor,
                "payload": payload.model_dump(mode="json"),
            }
        )
        with self.connection(write=True) as connection:
            EpisodeStoryboardStore._require_episode(connection, project, episode)
            prior = connection.execute(
                """SELECT request_hash, version_id FROM shot_plan_write_requests
                WHERE project_id = ? AND episode_id = ? AND idempotency_key_hash = ?""",
                (project, episode, key_hash),
            ).fetchone()
            if prior:
                if prior["request_hash"] != request_hash:
                    raise ShotPlanError("SHOT_PLAN_IDEMPOTENCY_CONFLICT")
                return self._read(connection, project, episode, str(prior["version_id"])), True
            script, _ = resolve_authority(
                self.repository,
                connection,
                project,
                episode,
                content.authority,
                require_current=True,
            )
            validate_coverage(content, script)
            if (
                storyboard_base(self.repository, connection, project, episode)
                != content.storyboard_base
            ):
                raise ShotPlanError("SHOT_PLAN_STORYBOARD_STALE")
            head = connection.execute(
                """SELECT head.latest_version_id, head.revision FROM artifacts AS artifact
                JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
                WHERE artifact.project_id = ? AND artifact.episode_id = ?
                  AND artifact.artifact_type = ?""",
                (project, episode, ARTIFACT_TYPE),
            ).fetchone()
            if (head is None and payload.parent_version_id is not None) or (
                head is not None
                and (
                    payload.parent_version_id != head["latest_version_id"]
                    or payload.expected_revision != head["revision"]
                )
            ):
                raise ShotPlanError("SHOT_PLAN_PROPOSAL_STALE")
            record = self.repository.create_artifact_version(
                project_id=project,
                episode_id=episode,
                artifact_type=ARTIFACT_TYPE,
                schema_version="1.0.0",
                content=content_json,
                author_actor_type="human",
                author_actor_id=actor,
                change_summary=payload.change_summary,
                parent_version_id=payload.parent_version_id,
                expected_revision=payload.expected_revision,
                dependencies=dependencies(content),
                _transaction_connection=connection,
                _manage_transaction=False,
            )
            connection.execute(
                """INSERT INTO shot_plan_write_requests VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    project,
                    episode,
                    key_hash,
                    request_hash,
                    record.version.artifact_id,
                    record.version.id,
                    timestamp(record.version.created_at),
                ),
            )
            if self._hook:
                self._hook("proposal_created")
            return self._data(connection, project, episode, record), False

    def adopt(
        self,
        project: str,
        episode: str,
        version: str,
        payload: AdoptShotPlanRequest,
        key: str,
        actor: str,
    ) -> tuple[ShotPlanProposalData, bool]:
        self._identity(key, actor)
        payload = AdoptShotPlanRequest.model_validate(payload.model_dump(mode="json"))
        key_hash = canonical_content_hash({"value": key})
        request_hash = canonical_content_hash(
            {
                "project": project,
                "episode": episode,
                "version": version,
                "actor": actor,
                "payload": payload.model_dump(mode="json"),
            }
        )
        with self.connection(write=True) as connection:
            data = self._read(connection, project, episode, version)
            if data.content_hash != payload.proposal_content_hash:
                raise ShotPlanError("SHOT_PLAN_PROPOSAL_MISMATCH", 422)
            prior = connection.execute(
                """SELECT request_hash, proposal_version_id FROM shot_plan_adoption_requests
                WHERE project_id = ? AND episode_id = ? AND idempotency_key_hash = ?""",
                (project, episode, key_hash),
            ).fetchone()
            if prior and (
                prior["request_hash"] != request_hash or prior["proposal_version_id"] != version
            ):
                raise ShotPlanError("SHOT_PLAN_IDEMPOTENCY_CONFLICT")
            if data.adoption is not None:
                if not prior:
                    connection.execute(
                        "INSERT INTO shot_plan_adoption_requests VALUES (?, ?, ?, ?, ?)",
                        (project, episode, key_hash, request_hash, version),
                    )
                return data, True
            if prior:
                raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500)
            if any(
                issue.severity == "BLOCKING"
                for issue in (
                    *data.content.issues,
                    *data.capability_losses,
                )
            ):
                raise ShotPlanError("SHOT_PLAN_BLOCKING_ISSUES", 422)
            if (
                data.version_id
                != connection.execute(
                    "SELECT latest_version_id FROM artifact_heads WHERE artifact_id = "
                    "(SELECT artifact_id FROM artifact_versions WHERE version_id = ?)",
                    (version,),
                ).fetchone()[0]
            ):
                raise ShotPlanError("SHOT_PLAN_PROPOSAL_STALE")
            script, _ = resolve_authority(
                self.repository,
                connection,
                project,
                episode,
                data.content.authority,
                require_current=True,
            )
            if (
                storyboard_base(self.repository, connection, project, episode)
                != data.content.storyboard_base
            ):
                raise ShotPlanError("SHOT_PLAN_STORYBOARD_STALE")
            validate_coverage(data.content, script)
            try:
                projected = project_storyboard(data.content, script)
            except ValueError as error:
                raise ShotPlanError("SHOT_PLAN_PROJECTION_UNSUPPORTED", 422) from error
            base = data.content.storyboard_base
            storyboard_store = EpisodeStoryboardStore(self.repository)

            def verify(candidate: ArtifactVersionRecord) -> None:
                storyboard_store._verified_version_data(
                    candidate,
                    project_id=project,
                    episode_id=episode,
                    connection=connection,
                )

            storyboard = self.repository.create_artifact_version(
                project_id=project,
                episode_id=episode,
                artifact_type="episode_storyboard",
                schema_version="1.0.0",
                content=projected.model_dump(mode="json"),
                author_actor_type="human",
                author_actor_id=actor,
                change_summary=f"采纳人工导演提案 {version}",
                parent_version_id=base.version_id if base else None,
                expected_revision=base.head_revision if base else None,
                dependencies=(
                    ArtifactDependencyDraft(
                        upstream_version_id=data.content.authority.script.version_id,
                        relationship="derived_from",
                        impact="blocking",
                    ),
                ),
                record_validator=verify,
                _transaction_connection=connection,
                _manage_transaction=False,
            )
            if self._hook:
                self._hook("storyboard_created")
            proposal_record = exact_record(
                self.repository,
                connection,
                project,
                episode,
                ARTIFACT_TYPE,
                version,
            )
            connection.execute(
                "INSERT INTO shot_plan_adoptions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    project,
                    episode,
                    proposal_record.version.artifact_id,
                    version,
                    data.content_hash,
                    storyboard.version.artifact_id,
                    storyboard.version.id,
                    storyboard.version.content_hash,
                    actor,
                    timestamp(self._clock()),
                ),
            )
            connection.execute(
                "INSERT INTO shot_plan_adoption_requests VALUES (?, ?, ?, ?, ?)",
                (project, episode, key_hash, request_hash, version),
            )
            if self._hook:
                self._hook("adoption_recorded")
            return self._read(connection, project, episode, version), False
