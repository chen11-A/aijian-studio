"""Exact G5 consumption by a manually selected storyboard version."""

from __future__ import annotations

import sqlite3

from aijian_api.episode_storyboard_contracts import EpisodeStoryboardContent
from aijian_api.repository import StudioRepository
from aijian_api.storyboard_environment_bindings import selected_environment_references
from aijian_api.visual_bible_authority import visual_authority
from aijian_api.visual_bible_integrity import visual_sources, visual_version


def storyboard_source_ids(content: EpisodeStoryboardContent) -> tuple[str, ...]:
    return tuple(
        x
        for x in (
            content.script_version_id,
            content.creative_library_version_id,
            content.visual_bible_pin.version_id
            if content.schema_version in ("1.2.0", "1.3.0", "1.4.0", "1.5.0")
            and content.visual_bible_pin is not None
            else None,
        )
        if x is not None
    )


def verify_storyboard_visual_pin(
    repository: StudioRepository,
    connection: sqlite3.Connection,
    content: EpisodeStoryboardContent,
    *,
    fresh: bool,
    exact_originals: bool = False,
) -> None:
    if (
        content.schema_version not in ("1.2.0", "1.3.0", "1.4.0", "1.5.0")
        or content.visual_bible_pin is None
    ):
        return
    pin = content.visual_bible_pin
    record = repository._get_artifact_version_in_connection(
        connection,
        project_id=content.project_id,
        artifact_type="visual_bible",
        version_id=pin.version_id,
        episode_id=None,
    )
    bible = visual_version(record, content.project_id)
    if (
        pin.content_hash != bible.content_hash
        or content.creative_library_version_id != bible.content.creative_library_version_id
    ):
        raise ValueError("Storyboard visual pin differs from its exact approved basis")
    library, _ = visual_sources(repository, connection, bible.content)
    if bible.content.schema_version == "1.1.0" and content.schema_version != "1.5.0":
        raise ValueError("Explicit environment G5 adoption requires storyboard schema 1.5")
    if content.schema_version == "1.5.0":
        if bible.content.schema_version != "1.1.0":
            raise ValueError("An environment-aware storyboard requires explicit environment G5")
        scope = bible.content.environment_scope
        for environment_shot in content.shots:
            environment_binding = environment_shot.environment_binding
            if (
                environment_binding.variant_id is not None
                and environment_binding.variant_id not in scope.scene_variant_ids
            ) or not set(environment_binding.reference_ids) <= set(scope.environment_reference_ids):
                raise ValueError("Shot environment choices are outside the approved G5 scope")
        selected_environment_references(content, library)
    authority = visual_authority(
        repository,
        connection,
        content.project_id,
        pin.version_id,
        require_current=fresh,
        verify_fresh=fresh,
        exact_originals=exact_originals,
    )
    if authority.gate_decision_id is None:
        raise ValueError("Storyboard visual source has never been approved")
    refs = (
        {x.reference_id: x for x in library.references}
        if library.schema_version in ("1.2.0", "1.3.0")
        else {}
    )
    approved = set(bible.content.character_reference_ids)
    for shot in content.shots:
        if {b.character_id for b in shot.character_bindings} != set(shot.character_ids):
            raise ValueError("Every G5-bound shot character needs an explicit identity binding")
        for binding in shot.character_bindings:
            if not binding.reference_ids or not set(binding.reference_ids) <= approved:
                raise ValueError(
                    "Shot identity references must belong to the approved visual scope"
                )
            chosen = [refs.get(id) for id in binding.reference_ids]
            if any(
                r is None
                or r.character_id != binding.character_id
                or r.costume_id not in (None, binding.costume_id)
                for r in chosen
            ):
                raise ValueError(
                    "Shot reference identity differs from the approved character/costume"
                )
            if binding.costume_id is not None and not any(
                r is not None and r.costume_id == binding.costume_id for r in chosen
            ):
                raise ValueError("Selected costume requires its own approved visual reference")
