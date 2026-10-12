"""Immutable manual planning, old schemas and loss-aware downstream consumption."""

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardConflictError,
    EpisodeStoryboardStore,
)
from aijian_api.repository import StudioRepository
from aijian_api.shot_plan_contracts import ShotPlanStoryboardBase
from aijian_api.shot_plan_projection import projection_schema_for_base
from pydantic import ValidationError
from test_episode_storyboard import payload, shot, write
from test_project_creative_library import make_project


def planned(project, episode, *, parent=None, revision=None):
    value = payload(
        project, episode, shots=[shot(1), shot(2)], parent=parent, revision=revision
    ).model_dump(mode="json")
    value["content"].update(schema_version="1.3.0", visual_bible_pin=None)
    for one in value["content"]["shots"]:
        one.update(
            character_bindings=[],
            coverage_notes="反应镜头 🎬",
            continuity_notes="方向与道具衔接",
            transition_notes="动作匹配切",
        )
    return value


def test_planning_upgrade_replay_history_and_no_downgrade(tmp_path: Path):
    repository = StudioRepository(tmp_path / "studio.sqlite")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    store = EpisodeStoryboardStore(repository)
    old, _ = write(store, payload(project, episode, shots=[shot(1), shot(2)]), "old")
    request = CreateEpisodeStoryboardVersionRequest.model_validate(
        planned(project, episode, parent=old.version_id, revision=old.head_revision)
    )
    saved, replayed = write(store, request, "plan")
    assert not replayed and saved.content.schema_version == "1.3.0"
    assert saved.content.shots[0].coverage_notes == "反应镜头 🎬"
    assert saved.content_hash == canonical_content_hash(request.content.model_dump(mode="json"))
    again, replayed = write(store, request, "plan")
    assert replayed and again.version_id == saved.version_id
    historic = store.get_version(project_id=project, episode_id=episode, version_id=old.version_id)
    assert historic.content.schema_version == "1.0.0" and historic.content_hash == old.content_hash
    assert "coverage_notes" not in historic.content.shots[0].model_dump()
    downgraded = request.model_dump(mode="json")
    downgraded.update(parent_version_id=saved.version_id, expected_revision=saved.head_revision)
    downgraded["content"]["schema_version"] = "1.2.0"
    for one in downgraded["content"]["shots"]:
        for key in ("coverage_notes", "continuity_notes", "transition_notes"):
            del one[key]
    with pytest.raises(EpisodeStoryboardConflictError, match="downgraded"):
        write(store, CreateEpisodeStoryboardVersionRequest.model_validate(downgraded), "downgrade")
    assert store.get_latest(project_id=project, episode_id=episode).version_id == saved.version_id


@pytest.mark.parametrize(
    "fault", ["missing", "number", "too-long", "extra", "old-schema", "unicode"]
)
def test_planning_closed_contracts(fault: str):
    value = planned("prj_" + "1" * 32, "ep_" + "2" * 32)
    one = value["content"]["shots"][0]
    if fault == "missing":
        del one["transition_notes"]
    elif fault == "number":
        one["coverage_notes"] = 0
    elif fault == "too-long":
        one["continuity_notes"] = "字" * 20_001
    elif fault == "extra":
        one["auto_approved"] = True
    elif fault == "old-schema":
        value["content"]["schema_version"] = "1.2.0"
    else:
        one["transition_notes"] = "\ud800"
    with pytest.raises(ValidationError):
        CreateEpisodeStoryboardVersionRequest.model_validate(value)


def test_planning_isolated_heads_and_loss_aware_projection(tmp_path: Path):
    repository = StudioRepository(tmp_path / "studio.sqlite")
    store = EpisodeStoryboardStore(repository)
    versions = []
    for _ in range(2):
        project = make_project(repository)
        first = repository.list_episodes(project)[0].id
        second = repository.create_episode(project, title="Second").id
        for episode in (first, second):
            saved, _ = write(
                store,
                CreateEpisodeStoryboardVersionRequest.model_validate(planned(project, episode)),
                uuid4().hex,
            )
            versions.append((project, episode, saved))
    for project, episode, saved in reversed(versions):
        assert (
            store.get_latest(project_id=project, episode_id=episode).version_id == saved.version_id
        )
        base = ShotPlanStoryboardBase(
            version_id=saved.version_id,
            content_hash=saved.content_hash,
            head_revision=saved.head_revision,
        )
        with sqlite3.connect(repository.database_path) as connection:
            connection.row_factory = sqlite3.Row
            before = connection.total_changes
            with pytest.raises(ValueError, match="planning"):
                projection_schema_for_base(repository, connection, project, episode, base)
            assert connection.total_changes == before
