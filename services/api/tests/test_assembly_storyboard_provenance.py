"""Exact optional shot links without changing legacy assembly hashes."""

import copy
import json
import sqlite3

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_draft_export_runtime import fixture
from test_episode_storyboard import payload, shot


def storyboard(repository, project, episode, *, shots=None, parent=None):
    return EpisodeStoryboardStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=payload(
            project,
            episode,
            shots=shots if shots is not None else [shot(1)],
            parent=parent.version_id if parent else None,
            revision=parent.head_revision if parent else None,
        ),
        idempotency_key=f"storyboard-{parent.version_id if parent else episode}",
        actor_id="local-user",
    )[0]


def linked_content(assembly, version, shot_id=None):
    content = copy.deepcopy(assembly.content.model_dump(mode="json"))
    content["visual_segments"][0]["storyboard_ref"] = {
        "storyboard_version_id": version.version_id,
        "shot_id": shot_id or version.content.shots[0].shot_id,
    }
    return content


def save(repository, project, episode, prior, content):
    return EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest.model_validate(
            {
                "content": content,
                "parent_version_id": prior.version_id,
                "expected_revision": prior.head_revision,
                "change_summary": "Bind exact shot",
            }
        ),
        author_actor_id="local-user",
    )


def test_legacy_serialization_and_hash_are_unchanged(tmp_path):
    repository, project, episode, _, assembly = fixture(tmp_path)
    before = assembly.content.model_dump(mode="json")
    assert "storyboard_ref" not in before["visual_segments"][0]
    reopened = EpisodeMediaAssemblyStore(StudioRepository(repository.database_path)).read_version(
        project, episode
    )
    assert reopened.content.model_dump(mode="json") == before
    assert canonical_content_hash(before) == assembly.content_hash == reopened.content_hash


def test_exact_refs_survive_new_storyboard_deletion_reopen_and_new_assembly(tmp_path):
    repository, project, episode, _, assembly = fixture(tmp_path)
    source = storyboard(repository, project, episode)
    bound = save(repository, project, episode, assembly, linked_content(assembly, source))
    newer = storyboard(repository, project, episode, shots=[], parent=source)
    assert newer.content.shots == ()
    store = EpisodeMediaAssemblyStore(StudioRepository(repository.database_path))
    reopened = store.read_version(project, episode, version_id=bound.version_id)
    assert (
        reopened.content.visual_segments[0].storyboard_ref.storyboard_version_id
        == source.version_id
    )
    assert (
        reopened.content.visual_segments[0].storyboard_ref.shot_id
        == source.content.shots[0].shot_id
    )
    assert reopened.content_hash == bound.content_hash
    record = repository.get_artifact_version(
        project, "episode_media_assembly", bound.version_id, episode_id=episode
    )
    assert [
        (edge.upstream_version_id, edge.relationship, edge.impact) for edge in record.dependencies
    ] == [(source.version_id, "references", "advisory")]
    assert (
        save(repository, project, episode, bound, reopened.content.model_dump(mode="json")).content
        == reopened.content
    )
    assert (
        store.read_version(project, episode, version_id=assembly.version_id).content
        == assembly.content
    )


def test_unknown_shot_and_foreign_episode_are_rejected_without_mutation(tmp_path):
    repository, project, episode, _, assembly = fixture(tmp_path)
    source = storyboard(repository, project, episode)
    with pytest.raises(EpisodeMediaAssemblyError, match="shot"):
        save(
            repository,
            project,
            episode,
            assembly,
            linked_content(assembly, source, "shp_" + "f" * 32),
        )
    other = repository.create_episode(project, title="Other episode")
    foreign = storyboard(repository, project, other.id)
    with pytest.raises(EpisodeMediaAssemblyError) as error:
        save(repository, project, episode, assembly, linked_content(assembly, foreign))
    assert error.value.code == "STORYBOARD_VERSION_NOT_FOUND"
    assert (
        EpisodeMediaAssemblyStore(repository).read_version(project, episode).version_id
        == assembly.version_id
    )


def test_duplicate_shot_links_use_one_dependency_and_strict_fields(tmp_path):
    repository, project, episode, _, assembly = fixture(tmp_path)
    source = storyboard(repository, project, episode)
    content = linked_content(assembly, source)
    first = content["visual_segments"][0]
    first["end_frame"] = 12
    second = {**copy.deepcopy(first), "segment_id": "seg_split", "start_frame": 12, "end_frame": 24}
    content["visual_segments"].append(second)
    bound = save(repository, project, episode, assembly, content)
    record = repository.get_artifact_version(
        project, "episode_media_assembly", bound.version_id, episode_id=episode
    )
    assert len(record.dependencies) == 1
    for bad in [
        {"storyboard_version_id": source.version_id},
        {"storyboard_version_id": source.version_id, "shot_id": "shp_bad"},
        {**first["storyboard_ref"], "fulfilled": True},
    ]:
        altered = copy.deepcopy(content)
        altered["visual_segments"][0]["storyboard_ref"] = bad
        with pytest.raises(ValidationError):
            EpisodeMediaAssemblyContentV1.model_validate(altered)


def test_tampered_storyboard_and_dependency_fail_closed_on_read(tmp_path):
    repository, project, episode, _, assembly = fixture(tmp_path)
    source = storyboard(repository, project, episode)
    bound = save(repository, project, episode, assembly, linked_content(assembly, source))
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_dependencies_immutable_delete")
        connection.execute(
            "DELETE FROM artifact_dependencies WHERE downstream_version_id = ?", (bound.version_id,)
        )
    with pytest.raises(EpisodeMediaAssemblyError) as error:
        EpisodeMediaAssemblyStore(repository).read_version(
            project, episode, version_id=bound.version_id
        )
    assert error.value.code == "STORYBOARD_DEPENDENCY_CONFLICT"
    # A corrupt exact source cannot be legitimized by creating a later assembly.
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_versions_immutable_update")
        raw = json.loads(
            connection.execute(
                "SELECT content_json FROM artifact_versions WHERE version_id = ?",
                (source.version_id,),
            ).fetchone()[0]
        )
        raw["shots"][0]["title"] = "tampered"
        connection.execute(
            "UPDATE artifact_versions SET content_json = ? WHERE version_id = ?",
            (json.dumps(raw), source.version_id),
        )
    with pytest.raises(EpisodeMediaAssemblyError) as error:
        save(repository, project, episode, bound, linked_content(bound, source))
    assert error.value.code == "STORYBOARD_VERSION_CORRUPT"


def test_authenticated_http_readback_keeps_optional_links_and_legacy_hashes(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository, project, episode, _, assembly = fixture(tmp_path)
    source = storyboard(repository, project, episode)
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    with TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    ) as client:
        path = f"/api/v1/projects/{project}/episodes/{episode}/media-assembly"
        candidate = {
            "content": linked_content(assembly, source),
            "parent_version_id": assembly.version_id,
            "expected_revision": assembly.head_revision,
            "change_summary": "Bind shot",
        }
        assert client.post(path + "/versions", json=candidate).status_code == 401
        client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "app://aijian"})
        response = client.post(path + "/versions", json=candidate)
        assert response.status_code == 201, response.text
        saved = response.json()["data"]
        assert saved["content"] == candidate["content"]
        assert saved["content_hash"] == canonical_content_hash(candidate["content"])
        assert client.get(path).json()["data"] == saved
        assert (
            client.get(path + "/versions/" + assembly.version_id).json()["data"]["content_hash"]
            == assembly.content_hash
        )


def test_linked_assembly_still_exports_real_draft_after_storyboard_head_changes(tmp_path):
    from aijian_api.draft_export_runtime import DraftExportRuntime
    from test_draft_export_runtime import request_for, toolchain, wait_final

    repository, project, episode, _, assembly = fixture(tmp_path)
    source = storyboard(repository, project, episode)
    bound = save(repository, project, episode, assembly, linked_content(assembly, source))
    storyboard(repository, project, episode, shots=[], parent=source)
    runtime = DraftExportRuntime(repository, toolchain)
    request = request_for(bound, tmp_path / "linked-DRAFT.mp4")
    try:
        runtime.submit(project, episode, request)
        result = wait_final(runtime, project, episode, request.operation_id)
        assert result.status == "SUCCEEDED", result
        assert result.assembly_version_id == bound.version_id
        assert result.assembly_content_hash == bound.content_hash
        assert (tmp_path / "linked-DRAFT.mp4").stat().st_size > 0
        with sqlite3.connect(repository.database_path) as connection:
            row = connection.execute(
                "SELECT provenance_json FROM draft_export_jobs WHERE operation_id = ?",
                (request.operation_id,),
            ).fetchone()
        provenance = json.loads(row[0])
        assert provenance["assembly"]["content"]["visual_segments"][0]["storyboard_ref"] == {
            "storyboard_version_id": source.version_id,
            "shot_id": source.content.shots[0].shot_id,
        }
        assert provenance["assembly"]["media_checks"][0]["rights_status"] == "PENDING_REVIEW"
    finally:
        runtime.join_workers()
