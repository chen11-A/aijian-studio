"""Validate exact storyboard provenance without retargeting it to current heads."""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from aijian_api.script_confirmation_impact_projection import ImpactMaterializationBudget

from aijian_api.assembly_script_provenance import script_dependencies
from aijian_api.domain import ArtifactDependencyDraft, ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardInputError,
    EpisodeStoryboardStorageError,
    EpisodeStoryboardStore,
)
from aijian_api.repository import ArtifactConflictError, StudioRepository
from aijian_api.storyboard_visual_bible import verify_storyboard_visual_pin


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
    fresh: bool = False,
    budget: ImpactMaterializationBudget | None = None,
) -> tuple[ArtifactDependencyDraft, ...]:
    from aijian_api.assembly_manual_candidate_provenance import validate_manual_candidate_provenance
    from aijian_api.script_confirmation_impact_projection import (
        ImpactMaterializationBudget,
        _preflight_board_sources,
        bounded_version_record,
    )

    budget = budget if budget is not None else ImpactMaterializationBudget()
    # All audio, reference/literal subtitles and explicit script provenance share
    # the same SQL-before-JSON fence as candidates and their recursive sources.
    from aijian_api.episode_media_assembly_store import (
        EpisodeMediaAssemblyError,
        _validate_script_refs,
    )

    try:
        _validate_script_refs(repository, connection, content, budget=budget)
    except EpisodeMediaAssemblyError as error:
        raise AssemblyStoryboardReferenceError(error.code, str(error)) from error
    candidate_edges = validate_manual_candidate_provenance(
        repository,
        connection,
        content,
        fresh=fresh,
        budget=budget,
    )
    dependencies = storyboard_dependencies(content)
    resolved: list[ArtifactDependencyDraft] = []
    for dependency in dependencies:
        try:
            record = bounded_version_record(
                repository,
                connection,
                project_id=content.project_id,
                episode_id=content.episode_id,
                artifact_type="episode_storyboard",
                version_id=dependency.upstream_version_id,
                budget=budget,
            )
            _preflight_board_sources(
                repository, connection, record, content.project_id, content.episode_id, budget
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
        pinned_visual = (
            storyboard.content.schema_version in ("1.2.0", "1.3.0", "1.4.0", "1.5.0")
            and storyboard.content.visual_bible_pin is not None
        )
        referenced_shot_ids = frozenset(
            reference.shot_id
            for segment in content.visual_segments
            if (reference := segment.storyboard_ref) is not None
            and reference.storyboard_version_id == dependency.upstream_version_id
        )
        if not referenced_shot_ids.issubset({shot.shot_id for shot in storyboard.content.shots}):
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_SHOT_NOT_FOUND",
                "Referenced shot was not found in the exact storyboard version",
            )
        if fresh and storyboard.content.schema_version in ("1.4.0", "1.5.0") and not pinned_visual:
            try:
                EpisodeStoryboardStore(repository)._require_references(
                    connection,
                    storyboard.content,
                    verify_originals=True,
                    original_shot_ids=referenced_shot_ids,
                    exact_originals=True,
                )
            except (EpisodeStoryboardInputError, ValueError, RuntimeError) as error:
                raise AssemblyStoryboardReferenceError(
                    "STORYBOARD_REFERENCE_STALE",
                    "Assembly environment source needs valid exact originals",
                ) from error
        if pinned_visual and fresh:
            try:
                verify_storyboard_visual_pin(
                    repository, connection, storyboard.content, fresh=True, exact_originals=True
                )
            except (ValueError, RuntimeError) as error:
                raise AssemblyStoryboardReferenceError(
                    "G5_AUTHORITY_CHANGED", "Assembly source needs current valid G5 approval"
                ) from error
        resolved.append(
            ArtifactDependencyDraft(
                upstream_version_id=dependency.upstream_version_id,
                relationship="references",
                impact="blocking" if pinned_visual else "advisory",
            )
        )
    if assembly_record is not None:
        actual = sorted(
            (edge.upstream_version_id, edge.relationship, edge.impact)
            for edge in assembly_record.dependencies
        )
        expected = sorted(
            (edge.upstream_version_id, edge.relationship, edge.impact)
            for edge in (*resolved, *candidate_edges, *script_dependencies(content))
        )
        if actual != expected:
            raise AssemblyStoryboardReferenceError(
                "STORYBOARD_DEPENDENCY_CONFLICT",
                "Assembly dependencies differ from exact shot/G5 links",
            )
    return (*resolved, *candidate_edges)
