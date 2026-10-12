"""Read exact affected-version context without retargeting, file I/O or mutations."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.artifact_invalidation_ledger import (
    InvalidationLedgerError,
    InvalidationOperationNotFoundError,
    get_invalidation_operation,
)
from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.assembly_script_provenance import validate_script_provenance
from aijian_api.assembly_storyboard_provenance import validate_storyboard_provenance
from aijian_api.contracts import (
    ARTIFACT_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    PROJECT_ID_PATTERN,
    VERSION_ID_PATTERN,
)
from aijian_api.episode_contracts import EPISODE_ID_PATTERN
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.episode_media_assembly_store import _validate_script_refs
from aijian_api.episode_storyboard_contracts import SHOT_ID_PATTERN
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.invalidation_contracts import OPERATION_ID_PATTERN, PATH_ID_PATTERN
from aijian_api.repository import StudioRepository
from aijian_api.script_confirmation_impact_projection import (
    ImpactMaterializationBudget,
    bounded_version_record,
)


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class InvalidationConsumerEpisode(_Closed):
    id: str = Field(pattern=EPISODE_ID_PATTERN)
    position: str = Field(pattern=r"^[1-9][0-9]{0,18}$")
    title: str = Field(min_length=1, max_length=80)
    revision: str = Field(pattern=r"^[1-9][0-9]{0,18}$")
    label_origin: Literal["CURRENT_EPISODE"] = "CURRENT_EPISODE"


class InvalidationConsumerShot(_Closed):
    storyboard_version_id: str = Field(pattern=VERSION_ID_PATTERN)
    storyboard_content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)
    ordinal: int = Field(ge=1, le=1000)
    title: str = Field(min_length=1, max_length=240)


class InvalidationConsumerData(_Closed):
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    operation_id: str = Field(pattern=OPERATION_ID_PATTERN)
    path_id: str = Field(pattern=PATH_ID_PATTERN)
    assessment_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    artifact_id: str = Field(pattern=ARTIFACT_ID_PATTERN)
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    version_number: int = Field(ge=1)
    artifact_type: str = Field(min_length=1, max_length=120)
    episode: InvalidationConsumerEpisode | None
    shot_scope: Literal[
        "WHOLE_STORYBOARD_VERSION", "ASSEMBLY_REFERENCED_SHOTS", "NO_SHOT_PROJECTION"
    ]
    shots: tuple[InvalidationConsumerShot, ...] = Field(max_length=1000)


class InvalidationConsumerResponse(_Closed):
    data: InvalidationConsumerData
    request_id: UUID


def inspect_consumer(
    repository: StudioRepository, project: str, operation: str, path_id: str
) -> InvalidationConsumerData:
    with repository._connection() as connection:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        report = get_invalidation_operation(connection, project, operation)
        path = next((p for p in report.paths if p.id == path_id), None)
        if path is None:
            raise InvalidationOperationNotFoundError("Impact path was not found in this operation")
        owner = connection.execute(
            "SELECT artifact_type, episode_id FROM artifacts WHERE project_id=? AND artifact_id=?",
            (project, path.affected_artifact_id),
        ).fetchone()
        if owner is None:
            raise InvalidationLedgerError("Affected artifact owner is inconsistent")
        kind, episode_id = str(owner["artifact_type"]), owner["episode_id"]
        budget = ImpactMaterializationBudget()
        record = bounded_version_record(
            repository,
            connection,
            project_id=project,
            artifact_type=kind,
            episode_id=episode_id,
            version_id=path.affected_version_id,
            budget=budget,
        )
        version = record.version
        if (
            version.artifact_id != path.affected_artifact_id
            or version.content_hash != canonical_content_hash(version.content)
        ):
            raise InvalidationLedgerError("Affected immutable version is inconsistent")
        episode = None
        if episode_id is not None:
            row = connection.execute(
                "SELECT id,position,title,revision FROM episodes WHERE project_id=? AND id=?",
                (project, episode_id),
            ).fetchone()
            if row is None:
                raise InvalidationLedgerError("Affected episode is inconsistent")
            episode = InvalidationConsumerEpisode(
                id=row["id"],
                position=str(row["position"]),
                title=row["title"],
                revision=str(row["revision"]),
            )
        shots: list[InvalidationConsumerShot] = []
        scope: Literal[
            "WHOLE_STORYBOARD_VERSION", "ASSEMBLY_REFERENCED_SHOTS", "NO_SHOT_PROJECTION"
        ] = "NO_SHOT_PROJECTION"
        boards = EpisodeStoryboardStore(repository)
        if kind == "episode_storyboard":
            if not isinstance(episode_id, str):
                raise InvalidationLedgerError("Storyboard episode is missing")
            data = boards._verified_version_data(
                record, project_id=project, episode_id=episode_id, connection=connection
            )
            scope = "WHOLE_STORYBOARD_VERSION"
            shots = [
                InvalidationConsumerShot(
                    storyboard_version_id=data.version_id,
                    storyboard_content_hash=data.content_hash,
                    shot_id=s.shot_id,
                    ordinal=s.ordinal,
                    title=s.title,
                )
                for s in data.content.shots
            ]
        elif kind == "episode_media_assembly":
            content = EpisodeMediaAssemblyContentV1.model_validate(version.content)
            if (
                content.project_id != project
                or content.episode_id != episode_id
                or version.schema_version != content.schema_version
            ):
                raise InvalidationLedgerError("Assembly scope/schema is inconsistent")
            _validate_script_refs(repository, connection, content, budget=budget)
            validate_storyboard_provenance(
                repository, connection, content, assembly_record=record, budget=budget
            )
            validate_script_provenance(repository, connection, content, budget=budget)
            scope = "ASSEMBLY_REFERENCED_SHOTS"
            seen: set[tuple[str, str]] = set()
            for segment in content.visual_segments:
                ref = segment.storyboard_ref
                if ref is None or (ref.storyboard_version_id, ref.shot_id) in seen:
                    continue
                seen.add((ref.storyboard_version_id, ref.shot_id))
                source = repository._get_artifact_version_in_connection(
                    connection,
                    project_id=project,
                    artifact_type="episode_storyboard",
                    episode_id=content.episode_id,
                    version_id=ref.storyboard_version_id,
                )
                data = boards._verified_version_data(
                    source, project_id=project, episode_id=content.episode_id, connection=connection
                )
                shot = next(s for s in data.content.shots if s.shot_id == ref.shot_id)
                shots.append(
                    InvalidationConsumerShot(
                        storyboard_version_id=data.version_id,
                        storyboard_content_hash=data.content_hash,
                        shot_id=shot.shot_id,
                        ordinal=shot.ordinal,
                        title=shot.title,
                    )
                )
        result = InvalidationConsumerData(
            project_id=project,
            operation_id=operation,
            path_id=path_id,
            assessment_hash=report.assessment_hash,
            artifact_id=version.artifact_id,
            version_id=version.id,
            content_hash=version.content_hash,
            version_number=version.version_number,
            artifact_type=kind,
            episode=episode,
            shot_scope=scope,
            shots=tuple(shots),
        )
        if len(canonical_content_bytes(result.model_dump(mode="json"))) > 1024 * 1024:
            raise InvalidationLedgerError("Affected version projection is too large")
        connection.commit()
        return result
