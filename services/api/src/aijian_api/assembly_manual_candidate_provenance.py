"""Validate real saved assembly consumption of exact, human-associated originals."""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.episode_script_confirmation_store import EpisodeScriptConfirmationStore

if TYPE_CHECKING:
    from aijian_api.repository import StudioRepository
    from aijian_api.script_confirmation_impact_projection import ImpactMaterializationBudget


def validate_manual_candidate_provenance(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    content: EpisodeMediaAssemblyContentV1,
    *,
    fresh: bool,
    budget: ImpactMaterializationBudget,
) -> tuple[ArtifactDependencyDraft, ...]:
    # Imports stay inside the validator: the original bounded projection module
    # also consumes assemblies. All calls share the caller's recursive budget.
    from aijian_api.assembly_storyboard_provenance import AssemblyStoryboardReferenceError
    from aijian_api.manual_media_candidate_store import ManualMediaCandidateStore
    from aijian_api.media_preparation_store import MediaPreparationStore

    dependencies = {}
    candidates = {}
    preparations = {}
    for segment in content.visual_segments:
        ref = segment.manual_candidate_ref
        if ref is None:
            continue
        try:
            if ref.candidate_version_id not in candidates:
                candidates[ref.candidate_version_id] = ManualMediaCandidateStore(
                    repository
                )._version(
                    connection,
                    content.project_id,
                    content.episode_id,
                    ref.candidate_version_id,
                    budget,
                )
            candidate = candidates[ref.candidate_version_id]
            selected = candidate.content.input
            if selected.preparation_version_id not in preparations:
                preparations[selected.preparation_version_id] = MediaPreparationStore(
                    repository
                )._version(
                    connection,
                    content.project_id,
                    content.episode_id,
                    selected.preparation_version_id,
                    budget,
                )
            preparation = preparations[selected.preparation_version_id]
            rate = content.sequence_timebase.frame_rate
            if (
                candidate.content_hash != ref.candidate_content_hash
                or selected.preparation_version_id != ref.preparation_version_id
                or selected.preparation_content_hash != ref.preparation_content_hash
                or preparation.content_hash != ref.preparation_content_hash
                or segment.media.asset_id != selected.asset_id
                or segment.media.asset_version_id != selected.asset_version_id
                or segment.media.sha256 != selected.asset_sha256
                or segment.media_kind != candidate.content.asset_snapshot.kind
                or segment.storyboard_ref is None
                or segment.storyboard_ref.storyboard_version_id
                != preparation.content.input.storyboard_version_id
                or segment.storyboard_ref.shot_id != preparation.content.input.shot_id
                or rate.den != 1
                or rate.num != preparation.content.snapshot.fps
            ):
                raise ValueError(
                    "Saved segment differs from exact manual candidate/input/asset/shot/timebase"
                )
            if fresh:
                store = ManualMediaCandidateStore(repository)
                if (
                    store._snapshot(connection, selected, fresh=True, budget=budget)
                    != candidate.content.asset_snapshot
                ):
                    raise ValueError("Imported candidate original changed")
                # Current selected references are validated independently of a
                # historical preparation receipt. G5 is checked by the central
                # storyboard validator, never by treating association as approval.
                MediaPreparationStore(repository)._snapshot(
                    connection,
                    preparation.content.input,
                    fresh=True,
                    budget=budget,
                    exact_originals=True,
                )
                script = preparation.content.snapshot.script_version_id
                if script is not None:
                    current = (
                        EpisodeScriptConfirmationStore(repository)
                        ._status_in_connection(
                            connection, project_id=content.project_id, episode_id=content.episode_id
                        )
                        .confirmation
                    )
                    if current is None or current.version_id != script:
                        raise ValueError(
                            "Manual source needs the current exact script confirmation"
                        )
            dependencies[ref.candidate_version_id] = ArtifactDependencyDraft(
                upstream_version_id=ref.candidate_version_id,
                relationship="references",
                impact="blocking",
            )
        except (ValueError, TypeError, RuntimeError, KeyError) as error:
            raise AssemblyStoryboardReferenceError(
                "MANUAL_CANDIDATE_SOURCE_INVALID",
                "Exact manual candidate source or current authority could not be verified",
            ) from error
    return tuple(dependencies[id] for id in sorted(dependencies))
