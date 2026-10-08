"""Validate exact storyboard provenance without retargeting it to current heads."""

from __future__ import annotations

import sqlite3

from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardStorageError,
    EpisodeStoryboardStore,
)
from aijian_api.repository import ArtifactConflictError, StudioRepository


class AssemblyStoryboardReferenceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def storyboard_dependencies(
    content: EpisodeMediaAssemblyContentV1,
) -> tuple[ArtifactDependencyDraft, ...]:
    return tuple(
        ArtifactDependencyDraft(
            upstream_version_id=version_id, relationship="references", impact="advisory"
        )
        for version_id in sorted(
            {
                segment.storyboard_ref.storyboard_version_id
                for segment in content.visual_segments
                if segment.storyboard_ref is not None
            }
        )
    )


def validate_storyboard_provenance(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    content: EpisodeMediaAssemblyContentV1,
    *,
    assembly_record: ArtifactVersionRecord | None = None,
) -> None:
    dependencies = storyboard_dependencies(content)
    if assembly_record is not None:
        actual = sorted(
            (edge.upstream_version_id, edge.relationship, edge.impact)
            for edge in assembly_record.dependencies
        )
        expected = sorted(
            (edge.upstream_version_id, edge.relationship, edge.impact) for edge in dependencies
        )
        if actual != expected:
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_DEPENDENCY_CONFLICT",
                "Assembly storyboard dependencies differ from its exact shot links",
            )
    for dependency in dependencies:
        try:
            record = repository._get_artifact_version_in_connection(
                connection,
                project_id=content.project_id,
                episode_id=content.episode_id,
                artifact_type="episode_storyboard",
                version_id=dependency.upstream_version_id,
            )
        except ArtifactConflictError as error:
            missing = str(error) == "Artifact version was not found"
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_VERSION_NOT_FOUND" if missing else "STORYBOARD_VERSION_CORRUPT",
                "Referenced storyboard version was not found in this episode"
                if missing
                else "Referenced storyboard version failed integrity checks",
            ) from error
        except (ValueError, TypeError, RuntimeError) as error:
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_VERSION_CORRUPT",
                "Referenced storyboard version failed integrity checks",
            ) from error
        try:
            storyboard = EpisodeStoryboardStore(repository)._verified_version_data(
                record,
                project_id=content.project_id,
                episode_id=content.episode_id,
                connection=connection,
            )
        except (EpisodeStoryboardStorageError, ValueError, RuntimeError) as error:
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_VERSION_CORRUPT",
                "Referenced storyboard version failed integrity checks",
            ) from error
        shot_ids = {shot.shot_id for shot in storyboard.content.shots}
        if any(
            reference.shot_id not in shot_ids
            for segment in content.visual_segments
            if (reference := segment.storyboard_ref) is not None
            and reference.storyboard_version_id == dependency.upstream_version_id
        ):
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_SHOT_NOT_FOUND",
                "Referenced shot was not found in the exact storyboard version",
            )
