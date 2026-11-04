"""Exact, explicit script dependencies; confirmation is not an accepted Gate head."""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from aijian_api.script_confirmation_impact_projection import ImpactMaterializationBudget

from aijian_api.assembly_subtitles import validate_subtitle_text
from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.episode_media_assembly_contracts import (
    AssemblyScriptSourceStatusV1,
    AssemblySubtitleSegmentV1,
    AssemblyTextSubtitleSegmentV1,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_script_confirmation_store import (
    EpisodeScriptConfirmationNotFoundError,
    EpisodeScriptConfirmationStorageError,
    EpisodeScriptConfirmationStore,
)
from aijian_api.episode_script_store import EpisodeScriptStorageError, EpisodeScriptStore
from aijian_api.repository import ArtifactConflictError, StudioRepository


class AssemblyScriptProvenanceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def script_subtitle_text(text: str) -> str:
    """Only insert one deterministic line break; never truncate or paraphrase."""
    if "\n" not in text and 28 < len(text) <= 56:
        text = text[:28] + "\n" + text[28:]
    return validate_subtitle_text(text)


def script_segment_sources(
    content: EpisodeMediaAssemblyContentV1,
) -> tuple[tuple[str, str, str], ...]:
    sources = [
        ("DIALOGUE", segment.segment_id, segment.script_version_id)
        for segment in content.audio_segments
        if segment.track_kind == "DIALOGUE" and segment.script_version_id is not None
    ]
    for cue in content.subtitle_segments:
        if isinstance(cue, AssemblySubtitleSegmentV1):
            sources.append(("SUBTITLE", cue.segment_id, cue.script_version_id))
        elif cue.script_ref is not None:
            sources.append(("SUBTITLE", cue.segment_id, cue.script_ref.script_version_id))
    return tuple(sources)


def script_dependencies(
    content: EpisodeMediaAssemblyContentV1,
) -> tuple[ArtifactDependencyDraft, ...]:
    if content.script_provenance is None:
        return ()
    return tuple(
        ArtifactDependencyDraft(
            upstream_version_id=version,
            relationship="references",
            impact="blocking" if content.script_provenance.mode == "CONFIRMED" else "advisory",
        )
        for version in sorted({source[2] for source in script_segment_sources(content)})
    )


def validate_script_provenance(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    content: EpisodeMediaAssemblyContentV1,
    *,
    fresh: bool = False,
    budget: ImpactMaterializationBudget | None = None,
) -> AssemblyScriptSourceStatusV1 | None:
    from aijian_api.script_confirmation_impact_projection import (
        ImpactMaterializationBudget,
        bounded_version_record,
    )

    budget = budget if budget is not None else ImpactMaterializationBudget()
    provenance = content.script_provenance
    if provenance is None:
        return None
    sources = script_segment_sources(content)
    scripts = {}
    for version in {source[2] for source in sources}:
        try:
            record = bounded_version_record(
                repository,
                connection,
                project_id=content.project_id,
                episode_id=content.episode_id,
                artifact_type="episode_script",
                version_id=version,
                budget=budget,
            )
            scripts[version] = EpisodeScriptStore(repository)._verified_version_data(
                record,
                project_id=content.project_id,
                episode_id=content.episode_id,
                connection=connection,
            )
        except (
            ArtifactConflictError,
            EpisodeScriptStorageError,
            ValueError,
            RuntimeError,
        ) as error:
            raise AssemblyScriptProvenanceError(
                "SCRIPT_SOURCE_INVALID", "Exact script source failed integrity checks"
            ) from error
    for cue in content.subtitle_segments:
        if not isinstance(cue, AssemblyTextSubtitleSegmentV1) or cue.script_ref is None:
            continue
        ref = cue.script_ref
        script = scripts[ref.script_version_id]
        block = next(
            (
                block
                for scene in script.content.scenes
                for block in scene.blocks
                if block.block_id == ref.script_block_id
            ),
            None,
        )
        try:
            valid = (
                script.content_hash == ref.script_content_hash
                and block is not None
                and block.kind == "DIALOGUE"
                and script_subtitle_text(block.text) == cue.text
            )
        except ValueError:
            valid = False
        if not valid:
            raise AssemblyScriptProvenanceError(
                "SUBTITLE_SCRIPT_CONFLICT", "Subtitle differs from its exact saved dialogue"
            )

    confirmations = EpisodeScriptConfirmationStore(repository)
    if provenance.mode == "CONFIRMED":
        if not sources:
            raise AssemblyScriptProvenanceError(
                "SCRIPT_CONFIRMATION_CONFLICT", "Confirmed provenance needs script-bound segments"
            )
        try:
            exact = confirmations._status_in_connection(
                connection,
                project_id=content.project_id,
                episode_id=content.episode_id,
                confirmation_id=provenance.confirmation_id,
            ).confirmation
        except (EpisodeScriptConfirmationNotFoundError, EpisodeScriptConfirmationStorageError) as e:
            raise AssemblyScriptProvenanceError(
                "SCRIPT_CONFIRMATION_INVALID", "Exact confirmation could not be verified"
            ) from e
        if (
            exact is None
            or exact.version_id != provenance.script_version_id
            or exact.content_hash != provenance.script_content_hash
            or any(source[2] != exact.version_id for source in sources)
            or scripts[exact.version_id].content_hash != exact.content_hash
        ):
            raise AssemblyScriptProvenanceError(
                "SCRIPT_CONFIRMATION_CONFLICT", "Bindings differ from exact confirmed source"
            )
    latest = None
    newer_draft = False
    state = "DRAFT_UNCONFIRMED"
    try:
        status = confirmations._status_in_connection(
            connection, project_id=content.project_id, episode_id=content.episode_id
        )
        latest = status.confirmation
        newer_draft = latest is not None and status.latest_version_id != latest.version_id
        if provenance.mode == "CONFIRMED":
            state = (
                "AUTHORITY_UNKNOWN"
                if latest is None
                else "CONFIRMED_CURRENT"
                if latest.version_id == provenance.script_version_id
                and latest.content_hash == provenance.script_content_hash
                else "CONFIRMATION_SUPERSEDED"
            )
    except (EpisodeScriptConfirmationNotFoundError, EpisodeScriptConfirmationStorageError):
        if provenance.mode == "CONFIRMED":
            state = "AUTHORITY_UNKNOWN"
    if fresh and state in {"AUTHORITY_UNKNOWN", "CONFIRMATION_SUPERSEDED"}:
        raise AssemblyScriptProvenanceError(
            "SCRIPT_AUTHORITY_UNKNOWN"
            if state == "AUTHORITY_UNKNOWN"
            else "SCRIPT_SOURCE_SUPERSEDED",
            "Confirmed source must be checked and explicitly rebound before new consumption",
        )
    return AssemblyScriptSourceStatusV1.model_validate(
        {
            "state": state,
            "latest_confirmation": latest,
            "newer_draft_available": newer_draft,
            "dialogue_segment_ids": tuple(
                source[1] for source in sources if source[0] == "DIALOGUE"
            ),
            "subtitle_segment_ids": tuple(
                source[1] for source in sources if source[0] == "SUBTITLE"
            ),
        }
    )
