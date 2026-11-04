"""Regression coverage for reconstructed episode-scoped repository contracts."""

from pathlib import Path

import pytest
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    EpisodeNotFoundError,
    StudioRepository,
)


def test_project_and_episode_artifacts_remain_isolated_after_reopen(tmp_path: Path) -> None:
    database = tmp_path / "scope.db"
    repository = StudioRepository(database)
    project = repository.create_project(
        name="Scope regression",
        aspect_ratio="16:9",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    first = repository.list_episodes(project.id)[0]
    second = repository.create_episode(project.id, title="Second episode")
    records = {}
    for episode_id in (None, first.id, second.id):
        records[episode_id] = repository.create_artifact_version(
            project_id=project.id,
            episode_id=episode_id,
            artifact_type="scope_fixture",
            schema_version="1.0.0",
            content={"episode": episode_id},
            author_actor_type="human",
            author_actor_id="test-user",
            change_summary="Initial",
        )
    assert len({record.version.artifact_id for record in records.values()}) == 3
    reopened = StudioRepository(database)
    for episode_id, record in records.items():
        assert (
            reopened.get_latest_artifact(
                project.id,
                "scope_fixture",
                episode_id=episode_id,
            )
            == record
        )
        assert (
            reopened.get_artifact_head(
                project.id,
                "scope_fixture",
                episode_id=episode_id,
            )
            == record.head
        )
        assert (
            reopened.get_artifact_role_index(
                project.id,
                "scope_fixture",
                episode_id=episode_id,
            ).head
            == record.head
        )
        assert (
            reopened.get_artifact_version(
                project.id,
                "scope_fixture",
                record.version.id,
                episode_id=episode_id,
                payload_metrics_validator=lambda metrics: None,
            )
            == record
        )
        for wrong_scope in set(records) - {episode_id}:
            with pytest.raises(ArtifactConflictError, match="not found"):
                reopened.get_artifact_version(
                    project.id,
                    "scope_fixture",
                    record.version.id,
                    episode_id=wrong_scope,
                )
    initial = records[first.id]
    updated = reopened.create_artifact_version(
        project_id=project.id,
        episode_id=first.id,
        artifact_type="scope_fixture",
        schema_version="1.0.0",
        content={"updated": True},
        author_actor_type="human",
        author_actor_id="test-user",
        change_summary="Update first episode",
        parent_version_id=initial.version.id,
        expected_revision=initial.head.revision,
    )
    assert updated.head.revision == initial.head.revision + 1
    assert reopened.get_latest_artifact(project.id, "scope_fixture") == records[None]
    assert (
        reopened.get_latest_artifact(
            project.id,
            "scope_fixture",
            episode_id=second.id,
        )
        == records[second.id]
    )
    with pytest.raises(ArtifactConflictError):
        reopened.create_artifact_version(
            project_id=project.id,
            episode_id=first.id,
            artifact_type="scope_fixture",
            schema_version="1.0.0",
            content={},
            author_actor_type="human",
            author_actor_id="test-user",
            change_summary="Stale edit",
            parent_version_id=initial.version.id,
            expected_revision=initial.head.revision,
        )


def test_cross_project_episode_write_and_project_scope_fallback_are_rejected(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "cross-project.db")
    projects = [
        repository.create_project(
            name=name,
            aspect_ratio="16:9",
            target_duration_seconds=30,
            source_language="zh-CN",
        )
        for name in ("First", "Second")
    ]
    episode = repository.list_episodes(projects[0].id)[0]
    with pytest.raises(EpisodeNotFoundError):
        repository.create_artifact_version(
            project_id=projects[1].id,
            episode_id=episode.id,
            artifact_type="scope_fixture",
            schema_version="1.0.0",
            content={},
            author_actor_type="human",
            author_actor_id="test-user",
            change_summary="Wrong project",
        )
    repository.create_artifact_version(
        project_id=projects[0].id,
        episode_id=episode.id,
        artifact_type="scope_fixture",
        schema_version="1.0.0",
        content={},
        author_actor_type="human",
        author_actor_id="test-user",
        change_summary="Episode only",
    )
    with pytest.raises(ArtifactNotFoundError):
        repository.get_latest_artifact(projects[0].id, "scope_fixture")
