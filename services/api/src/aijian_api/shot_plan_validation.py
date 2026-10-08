"""Resolve exact creative authority and deterministic coverage in one DB snapshot."""

from __future__ import annotations

import sqlite3

from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactSourceSpanDraft, ArtifactVersionRecord
from aijian_api.episode_script_confirmation_store import (
    EpisodeScriptConfirmationNotFoundError,
    EpisodeScriptConfirmationStore,
)
from aijian_api.episode_script_contracts import EpisodeScriptContentV1
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.production_brief import ProductionBriefContentV1
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    StudioRepository,
)
from aijian_api.shot_plan_contracts import (
    ShotPlanAdaptedAuthority,
    ShotPlanContentV1,
    ShotPlanCreativeAuthority,
    ShotPlanStoryboardBase,
)
from aijian_api.source_extraction_routes import _validated_data


class ShotPlanError(RuntimeError):
    def __init__(self, code: str, status: int = 409) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def exact_record(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project: str,
    episode: str | None,
    artifact_type: str,
    version: str,
) -> ArtifactVersionRecord:
    try:
        record = repository._get_artifact_version_in_connection(
            connection,
            project_id=project,
            episode_id=episode,
            artifact_type=artifact_type,
            version_id=version,
        )
    except ArtifactConflictError as error:
        raise ShotPlanError("SHOT_PLAN_REFERENCE_NOT_FOUND", 422) from error
    if canonical_content_hash(record.version.content) != record.version.content_hash:
        raise ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500)
    return record


def resolve_authority(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project: str,
    episode: str,
    authority: ShotPlanCreativeAuthority,
    *,
    require_current: bool,
) -> tuple[EpisodeScriptContentV1, ProductionBriefContentV1]:
    pin = authority.script
    try:
        status = EpisodeScriptConfirmationStore(repository)._status_in_connection(
            connection,
            project_id=project,
            episode_id=episode,
            confirmation_id=pin.confirmation_id,
        )
    except EpisodeScriptConfirmationNotFoundError as error:
        raise ShotPlanError("SHOT_PLAN_CONFIRMATION_REQUIRED", 422) from error
    receipt = status.confirmation
    if receipt is None or (
        receipt.version_id != pin.version_id
        or receipt.content_hash != pin.content_hash
        or receipt.head_revision != pin.head_revision
    ):
        raise ShotPlanError("SHOT_PLAN_CONFIRMATION_MISMATCH", 422)
    if require_current and not status.current:
        raise ShotPlanError("SHOT_PLAN_SCRIPT_STALE")
    script_record = exact_record(
        repository,
        connection,
        project,
        episode,
        "episode_script",
        pin.version_id,
    )
    script = (
        EpisodeScriptStore(repository)
        ._verified_version_data(
            script_record,
            project_id=project,
            episode_id=episode,
            connection=connection,
        )
        .content
    )
    if script_record.version.content_hash != pin.content_hash:
        raise ShotPlanError("SHOT_PLAN_CONFIRMATION_MISMATCH", 422)
    brief_pin = authority.production_brief
    if script.production_brief_version_id != brief_pin.version_id:
        raise ShotPlanError("SHOT_PLAN_BRIEF_MISMATCH", 422)
    brief_record = exact_record(
        repository,
        connection,
        project,
        None,
        "production_brief",
        brief_pin.version_id,
    )
    if brief_record.version.content_hash != brief_pin.content_hash:
        raise ShotPlanError("SHOT_PLAN_BRIEF_MISMATCH", 422)
    if require_current and brief_record.head.latest_version_id != brief_pin.version_id:
        raise ShotPlanError("SHOT_PLAN_BRIEF_STALE")
    if brief_record.version.schema_version != "1.0.0":
        raise ShotPlanError("SHOT_PLAN_BRIEF_UNSUPPORTED", 422)
    brief = ProductionBriefContentV1.model_validate(brief_record.version.content)
    if authority.mode == "ORIGINAL":
        if brief.creative_entry.kind != "original_idea" or (
            script.source_extraction_version_id is not None
            or script.source_proposal_acceptance_id is not None
            or script.story_bible_version_id is not None
        ):
            raise ShotPlanError("SHOT_PLAN_AUTHORITY_MISMATCH", 422)
    else:
        resolve_adapted_authority(
            repository,
            connection,
            project,
            authority,
            script,
            brief,
            require_current=require_current,
        )
    return script, brief


def resolve_adapted_authority(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project: str,
    authority: ShotPlanAdaptedAuthority,
    script: EpisodeScriptContentV1,
    brief: ProductionBriefContentV1,
    *,
    require_current: bool,
) -> None:
    entry = brief.creative_entry
    if entry.kind != "source_adaptation" or (
        script.source_extraction_version_id != authority.source_extraction.version_id
        or script.source_proposal_acceptance_id != authority.source_proposal_acceptance_id
    ):
        raise ShotPlanError("SHOT_PLAN_AUTHORITY_MISMATCH", 422)
    source = exact_record(
        repository,
        connection,
        project,
        None,
        "source_extraction",
        authority.source_extraction.version_id,
    )
    verified = _validated_data(connection, project, source)
    acceptance = connection.execute(
        """SELECT acceptance_id FROM artifact_proposal_draft_acceptances
        WHERE project_id = ? AND draft_version_id = ? AND acceptance_id = ?""",
        (project, source.version.id, authority.source_proposal_acceptance_id),
    ).fetchone()
    if (
        acceptance is None
        or source.version.content_hash != authority.source_extraction.content_hash
        or set(authority.source_span_ids) != {span.fact_id for span in verified.source_spans}
        or entry.source_manifest_version_id != source.dependencies[0].upstream_version_id
        or not set(entry.source_block_ids).issubset(
            {
                span.source_block_id
                for span in verified.source_spans
                if span.source_document_id == entry.source_document_id
            }
        )
    ):
        raise ShotPlanError("SHOT_PLAN_SOURCE_EVIDENCE_MISMATCH", 422)
    if require_current:
        if source.head.latest_version_id != source.version.id:
            raise ShotPlanError("SHOT_PLAN_SOURCE_STALE")
        try:
            # Reuse accepted-only membership validation with real, verified stored spans.
            repository._validate_accepted_source_manifest_membership(
                connection,
                project_id=project,
                manifest_version_id=entry.source_manifest_version_id,
                source_spans=tuple(
                    ArtifactSourceSpanDraft(
                        fact_id=span.fact_id,
                        source_document_id=span.source_document_id,
                        source_block_id=span.source_block_id,
                        role=span.role,
                        start_byte=span.start_byte,
                        end_byte=span.end_byte,
                        claim=span.claim,
                    )
                    for span in source.source_spans
                ),
            )
        except ArtifactDependencyInvalidError as error:
            raise ShotPlanError("SHOT_PLAN_SOURCE_STALE") from error


def validate_coverage(content: ShotPlanContentV1, script: EpisodeScriptContentV1) -> None:
    scenes = {
        scene.scene_id: {block.block_id: block for block in scene.blocks} for scene in script.scenes
    }
    covered: set[str] = set()
    for shot in content.shots:
        blocks = scenes.get(shot.script_scene_id)
        if blocks is None or not set(shot.script_block_ids).issubset(blocks):
            raise ShotPlanError("SHOT_PLAN_BLOCK_REFERENCE_INVALID", 422)
        dialogue = {
            block_id for block_id in shot.script_block_ids if blocks[block_id].kind == "DIALOGUE"
        }
        if set(shot.dialogue_block_ids) != dialogue:
            raise ShotPlanError("SHOT_PLAN_DIALOGUE_REFERENCE_INVALID", 422)
        for block_id in shot.script_block_ids:
            if blocks[block_id].kind not in shot.coverage:
                raise ShotPlanError("SHOT_PLAN_COVERAGE_INVALID", 422)
            covered.add(block_id)
    all_blocks = {block_id for blocks in scenes.values() for block_id in blocks}
    if covered != all_blocks:
        raise ShotPlanError("SHOT_PLAN_SCRIPT_COVERAGE_INCOMPLETE", 422)


def storyboard_base(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    project: str,
    episode: str,
) -> ShotPlanStoryboardBase | None:
    row = connection.execute(
        """SELECT head.latest_version_id FROM artifacts AS artifact
        JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
        WHERE artifact.project_id = ? AND artifact.episode_id = ?
          AND artifact.artifact_type = 'episode_storyboard'""",
        (project, episode),
    ).fetchone()
    if row is None:
        return None
    record = exact_record(
        repository,
        connection,
        project,
        episode,
        "episode_storyboard",
        str(row[0]),
    )
    version = EpisodeStoryboardStore(repository)._verified_version_data(
        record,
        project_id=project,
        episode_id=episode,
        connection=connection,
    )
    return ShotPlanStoryboardBase(
        version_id=version.version_id,
        content_hash=version.content_hash,
        head_revision=version.head_revision,
    )
