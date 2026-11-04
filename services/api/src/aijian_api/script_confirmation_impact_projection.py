"""Immutable consumer projections; never probe files or consult today's authority."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.assembly_script_provenance import script_subtitle_text
from aijian_api.assembly_storyboard_provenance import validate_storyboard_provenance
from aijian_api.domain import ArtifactVersionRecord
from aijian_api.episode_media_assembly_contracts import (
    AssemblySubtitleSegmentV1,
    AssemblyTextSubtitleSegmentV1,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import _media_refs, _validate_script_refs
from aijian_api.episode_script_confirmation_contracts import EpisodeScriptConfirmationData
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.repository import StudioRepository
from aijian_api.script_confirmation_impact_contracts import (
    ScriptImpactAssemblyContextV1,
    ScriptImpactAudioV1,
    ScriptImpactContextV1,
    ScriptImpactOtherContextV1,
    ScriptImpactReferenceSubtitleV1,
    ScriptImpactSegmentV1,
    ScriptImpactShotV1,
    ScriptImpactStoryboardContextV1,
    ScriptImpactStoryboardReferenceV1,
    ScriptImpactTextSubtitleV1,
)
from aijian_api.visual_bible_integrity import visual_version


@dataclass
class ImpactMaterializationBudget:
    """Shared control bound for distinct bodies, including recursive sources."""

    version_ids: set[str] = field(default_factory=set)
    body_bytes: int = 0

    def admit(self, version_id: str, byte_size: int) -> None:
        if version_id in self.version_ids:
            return
        if len(self.version_ids) >= 10_000 or self.body_bytes + byte_size > 32 * 1024 * 1024:
            raise ValueError("Impact recursive source materialization budget exceeded")
        self.version_ids.add(version_id)
        self.body_bytes += byte_size


def bounded_version_record(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    *,
    project_id: str,
    artifact_type: str,
    version_id: str,
    episode_id: str | None = None,
    budget: ImpactMaterializationBudget | None = None,
) -> ArtifactVersionRecord:
    metrics = repository._get_artifact_version_payload_metrics_in_connection(
        connection,
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=version_id,
        episode_id=episode_id,
    )
    dependencies = connection.execute(
        "SELECT count(*) FROM artifact_dependencies WHERE downstream_version_id = ?",
        (version_id,),
    ).fetchone()[0]
    if (
        metrics.content_json_bytes > 2_000_000
        or metrics.source_span_claim_bytes > 2_000_000
        or metrics.source_span_count > 10_000
        or dependencies > 40_000
        or artifact_type in {"episode_script", "episode_storyboard", "episode_media_assembly"}
        and metrics.source_span_count
    ):
        raise ValueError("Immutable impact version exceeds its materialization budget")
    if budget is not None:
        budget.admit(version_id, metrics.content_json_bytes + metrics.source_span_claim_bytes)
    return repository._get_artifact_version_in_connection(
        connection,
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=version_id,
        episode_id=episode_id,
    )


def _preflight_board_sources(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    record: ArtifactVersionRecord,
    project_id: str,
    episode_id: str,
    budget: ImpactMaterializationBudget,
) -> None:
    # Fence every exact body the original full validators will recursively load.
    # Keep their integrity/authority checks; this does not approve or replace them.
    board = EpisodeStoryboardStore._version_data(
        record, project_id=project_id, episode_id=episode_id
    ).content
    for version_id, artifact_type, source_episode in (
        (board.script_version_id, "episode_script", episode_id),
        (board.creative_library_version_id, "project_creative_library", None),
    ):
        if version_id is not None:
            bounded_version_record(
                repository,
                connection,
                project_id=project_id,
                episode_id=source_episode,
                artifact_type=artifact_type,
                version_id=version_id,
                budget=budget,
            )
    if board.schema_version in ("1.2.0", "1.3.0", "1.4.0", "1.5.0") and board.visual_bible_pin:
        visual_record = bounded_version_record(
            repository,
            connection,
            project_id=project_id,
            artifact_type="visual_bible",
            version_id=board.visual_bible_pin.version_id,
            budget=budget,
        )
        visual = visual_version(visual_record, project_id)
        bounded_version_record(
            repository,
            connection,
            project_id=project_id,
            artifact_type="project_creative_library",
            version_id=visual.content.creative_library_version_id,
            budget=budget,
        )


def immutable_consumer_context(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    record: ArtifactVersionRecord,
    source: EpisodeScriptConfirmationData,
    *,
    artifact_type: str,
    episode_id: str | None,
    budget: ImpactMaterializationBudget | None = None,
) -> ScriptImpactContextV1:
    budget = budget if budget is not None else ImpactMaterializationBudget()
    version = record.version
    if canonical_content_hash(version.content) != version.content_hash:
        raise ValueError("Impact consumer content hash is inconsistent")
    if artifact_type == "episode_storyboard":
        if episode_id is None:
            raise ValueError("Storyboard consumer has no episode")
        _preflight_board_sources(
            repository, connection, record, source.project_id, episode_id, budget
        )
        board = (
            EpisodeStoryboardStore(repository)
            ._verified_version_data(
                record,
                project_id=source.project_id,
                episode_id=episode_id,
                connection=connection,
            )
            .content
        )
        return ScriptImpactStoryboardContextV1(
            kind="STORYBOARD",
            script_version_id=board.script_version_id,
            shots=tuple(
                ScriptImpactShotV1.model_validate(
                    {
                        "shot_id": shot.shot_id,
                        "ordinal": shot.ordinal,
                        "title": shot.title,
                        "duration_frames": shot.duration_frames,
                        "script_scene_id": shot.script_scene_id,
                    }
                )
                for shot in board.shots
            ),
        )
    if artifact_type != "episode_media_assembly":
        return ScriptImpactOtherContextV1(kind="OTHER")
    if len(canonical_content_bytes(version.content)) > 2_000_000:
        raise ValueError("Impact assembly exceeds its stored body budget")
    content = EpisodeMediaAssemblyContentV1.model_validate(version.content)
    if (
        version.schema_version != content.schema_version
        or content.project_id != source.project_id
        or content.episode_id != episode_id
        or content.model_dump(mode="json") != version.content
        or record.source_spans
    ):
        raise ValueError("Impact assembly body is inconsistent")
    # Legacy un-edged bindings may name additional scripts beyond the replaced
    # source. SQL-fence every one before the existing raw JSON validator loads it.
    script_ids = {
        segment.script_version_id
        for segment in content.audio_segments
        if segment.script_version_id is not None
    }
    for subtitle in content.subtitle_segments:
        if isinstance(subtitle, AssemblySubtitleSegmentV1):
            script_ids.add(subtitle.script_version_id)
        elif subtitle.script_ref is not None:
            script_ids.add(subtitle.script_ref.script_version_id)
    for script_id in sorted(script_ids):
        bounded_version_record(
            repository,
            connection,
            project_id=content.project_id,
            episode_id=content.episode_id,
            artifact_type="episode_script",
            version_id=script_id,
            budget=budget,
        )
    board_ids = {
        segment.storyboard_ref.storyboard_version_id
        for segment in content.visual_segments
        if segment.storyboard_ref is not None
    }
    for board_id in sorted(board_ids):
        board_record = bounded_version_record(
            repository,
            connection,
            project_id=content.project_id,
            episode_id=content.episode_id,
            artifact_type="episode_storyboard",
            version_id=board_id,
            budget=budget,
        )
        _preflight_board_sources(
            repository,
            connection,
            board_record,
            content.project_id,
            content.episode_id,
            budget,
        )
    _validate_script_refs(repository, connection, content, budget=budget)
    validate_storyboard_provenance(
        repository, connection, content, assembly_record=record, budget=budget
    )
    # Exact stored owner/kind/hash only. Soft deletion, today's rights/probe and
    # media files are deliberately outside historical fact verification.
    for media, expected_kind in _media_refs(content):
        exact_media = connection.execute(
            "SELECT kind, sha256 FROM media_asset_versions "
            "WHERE project_id = ? AND asset_id = ? AND id = ?",
            (content.project_id, media.asset_id, media.asset_version_id),
        ).fetchone()
        if exact_media is None or (exact_media["kind"], exact_media["sha256"]) != (
            expected_kind,
            media.sha256,
        ):
            raise ValueError("Impact assembly media differs from its exact immutable identity")
    # Verify only exact immutable receipts, not computed current confirmation status.
    if content.script_provenance is not None and content.script_provenance.mode == "CONFIRMED":
        pin = content.script_provenance
        row = connection.execute(
            """SELECT version_id, content_hash FROM episode_script_confirmations
               WHERE confirmation_id = ? AND project_id = ? AND episode_id = ?""",
            (pin.confirmation_id, content.project_id, content.episode_id),
        ).fetchone()
        if row is None or (row["version_id"], row["content_hash"]) != (
            pin.script_version_id,
            pin.script_content_hash,
        ):
            raise ValueError("Impact assembly confirmation pin is inconsistent")
        refs = [s.script_version_id for s in content.audio_segments if s.track_kind == "DIALOGUE"]
        for subtitle in content.subtitle_segments:
            if isinstance(subtitle, AssemblySubtitleSegmentV1):
                refs.append(subtitle.script_version_id)
            elif subtitle.script_ref is not None:
                refs.append(subtitle.script_ref.script_version_id)
        if not refs or any(ref != pin.script_version_id for ref in refs):
            raise ValueError("Impact assembly mixes confirmed script sources")
    script = EpisodeScriptStore(repository)._verified_version_data(
        bounded_version_record(
            repository,
            connection,
            project_id=source.project_id,
            episode_id=source.episode_id,
            artifact_type="episode_script",
            version_id=source.version_id,
            budget=budget,
        ),
        project_id=source.project_id,
        episode_id=source.episode_id,
        connection=connection,
    )
    if script.content_hash != source.content_hash:
        raise ValueError("Impact source script differs from its receipt")
    blocks = {b.block_id: b for scene in script.content.scenes for b in scene.blocks}
    segments: list[ScriptImpactSegmentV1] = [
        ScriptImpactAudioV1(
            kind="DIALOGUE_AUDIO", script_content_hash=source.content_hash, segment=s
        )
        for s in content.audio_segments
        if s.track_kind == "DIALOGUE" and s.script_version_id == source.version_id
    ]
    for cue in content.subtitle_segments:
        if isinstance(cue, AssemblySubtitleSegmentV1):
            if cue.script_version_id == source.version_id:
                segments.append(
                    ScriptImpactReferenceSubtitleV1(
                        kind="REFERENCE_SUBTITLE",
                        script_content_hash=source.content_hash,
                        segment=cue,
                    )
                )
        elif isinstance(cue, AssemblyTextSubtitleSegmentV1) and cue.script_ref is not None:
            ref = cue.script_ref
            # Verify every literal source, including another source in a legacy assembly.
            exact = (
                script
                if ref.script_version_id == source.version_id
                else (
                    EpisodeScriptStore(repository)._verified_version_data(
                        bounded_version_record(
                            repository,
                            connection,
                            project_id=content.project_id,
                            episode_id=content.episode_id,
                            artifact_type="episode_script",
                            version_id=ref.script_version_id,
                            budget=budget,
                        ),
                        project_id=content.project_id,
                        episode_id=content.episode_id,
                        connection=connection,
                    )
                )
            )
            block = next(
                (
                    b
                    for sc in exact.content.scenes
                    for b in sc.blocks
                    if b.block_id == ref.script_block_id
                ),
                None,
            )
            if (
                exact.content_hash != ref.script_content_hash
                or block is None
                or block.kind != "DIALOGUE"
                or script_subtitle_text(block.text) != cue.text
            ):
                raise ValueError("Impact literal subtitle has an invalid exact source")
            if ref.script_version_id == source.version_id:
                segments.append(
                    ScriptImpactTextSubtitleV1(
                        kind="TEXT_SUBTITLE",
                        script_content_hash=source.content_hash,
                        segment=cue,
                    )
                )
    for impacted in segments:
        if isinstance(impacted, ScriptImpactTextSubtitleV1):
            literal_ref = impacted.segment.script_ref
            if literal_ref is None:
                raise ValueError("Impact literal subtitle has no exact source")
            block_id: str | None = literal_ref.script_block_id
        else:
            block_id = impacted.segment.script_block_id
        if (
            block_id is None
            or block_id not in blocks
            or (
                not isinstance(impacted, ScriptImpactReferenceSubtitleV1)
                and blocks[block_id].kind != "DIALOGUE"
            )
        ):
            raise ValueError("Impact segment does not refer to its exact script block")
    boards = {}
    references = []
    for segment in content.visual_segments:
        if segment.storyboard_ref is None:
            continue
        board_ref = segment.storyboard_ref
        if board_ref.storyboard_version_id not in boards:
            boards[board_ref.storyboard_version_id] = EpisodeStoryboardStore(
                repository
            )._verified_version_data(
                bounded_version_record(
                    repository,
                    connection,
                    project_id=content.project_id,
                    episode_id=content.episode_id,
                    artifact_type="episode_storyboard",
                    version_id=board_ref.storyboard_version_id,
                    budget=budget,
                ),
                project_id=content.project_id,
                episode_id=content.episode_id,
                connection=connection,
            )
        board_version = boards[board_ref.storyboard_version_id]
        if board_version.content.script_version_id != source.version_id:
            continue
        shot = next(
            (s for s in board_version.content.shots if s.shot_id == board_ref.shot_id), None
        )
        if shot is None:
            raise ValueError("Impact assembly has a missing exact storyboard shot")
        references.append(
            ScriptImpactStoryboardReferenceV1(
                segment_id=segment.segment_id,
                start_frame=segment.start_frame,
                end_frame=segment.end_frame,
                storyboard_version_id=board_version.version_id,
                storyboard_content_hash=board_version.content_hash,
                shot=ScriptImpactShotV1(
                    shot_id=shot.shot_id,
                    ordinal=shot.ordinal,
                    title=shot.title,
                    duration_frames=shot.duration_frames,
                    script_scene_id=shot.script_scene_id,
                ),
            )
        )
    return ScriptImpactAssemblyContextV1(
        kind="ASSEMBLY",
        sequence_timebase=content.sequence_timebase,
        script_provenance=content.script_provenance,
        segments=tuple(segments),
        storyboard_references=tuple(references),
    )
