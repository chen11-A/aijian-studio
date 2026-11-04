"""Exact manual environment use with real SQLite/originals, never a Provider call."""

import copy
import json
import sqlite3
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardConflictError,
    EpisodeStoryboardInputError,
    EpisodeStoryboardNotFoundError,
    EpisodeStoryboardStore,
)
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.repository import EpisodeNotFoundError, StudioRepository
from aijian_api.shot_plan_contracts import ShotPlanStoryboardBase
from aijian_api.shot_plan_projection import projection_schema_for_base
from pydantic import ValidationError
from test_episode_storyboard import payload, shot, write
from test_project_environment import setup
from test_storyboard_planning import planned


def environment_board(project, episode, library):
    value = planned(project, episode)
    value["content"].update(schema_version="1.4.0", creative_library_version_id=library)
    for one in value["content"]["shots"]:
        one.update(
            location_id="loc_" + "b" * 32,
            environment_binding={
                "variant_id": "scv_" + "1" * 32,
                "reference_ids": ["erf_" + str(i) * 32 for i in (1, 2, 3)],
            },
        )
    return value


def prepared(tmp_path):
    repository, project, image, request = setup(tmp_path)
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project, payload=request, idempotency_key="library", actor_id="human"
    )
    episode = repository.list_episodes(project)[0].id
    return repository, project, episode, image, library


def test_upgrade_restart_exact_history_replay_and_no_execution(tmp_path):
    repository, project, episode, _image, library = prepared(tmp_path)
    store = EpisodeStoryboardStore(repository)
    old, _ = write(store, payload(project, episode, shots=[shot(1), shot(2)]), "old")
    value = environment_board(project, episode, library.version_id)
    value.update(parent_version_id=old.version_id, expected_revision=old.head_revision)
    request = CreateEpisodeStoryboardVersionRequest.model_validate(value)
    saved, replayed = write(store, request, "environment")
    assert not replayed and saved.content == request.content
    reopened = EpisodeStoryboardStore(StudioRepository(repository.database_path))
    assert reopened.get_latest(project_id=project, episode_id=episode).content == request.content
    history = reopened.get_version(
        project_id=project, episode_id=episode, version_id=old.version_id
    )
    assert history.content_hash == old.content_hash and history.content == old.content
    assert "environment_binding" not in history.content.shots[0].model_dump()
    assert saved.content_hash == canonical_content_hash(request.content.model_dump(mode="json"))
    replay, replayed = write(reopened, request, "environment")
    assert replayed and replay.version_id == saved.version_id
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (0,)
        assert not any(
            row[0] for row in connection.execute("SELECT accepted_version_id FROM artifact_heads")
        )
        connection.row_factory = sqlite3.Row
        base = ShotPlanStoryboardBase(
            version_id=saved.version_id,
            content_hash=saved.content_hash,
            head_revision=saved.head_revision,
        )
        with pytest.raises(ValueError, match="discard"):
            projection_schema_for_base(repository, connection, project, episode, base)
    downgrade = value.copy()
    downgrade.update(parent_version_id=saved.version_id, expected_revision=saved.head_revision)
    downgrade["content"] = copy.deepcopy(value["content"])
    downgrade["content"]["schema_version"] = "1.3.0"
    for one in downgrade["content"]["shots"]:
        del one["environment_binding"]
    with pytest.raises(EpisodeStoryboardConflictError, match="downgraded"):
        write(store, CreateEpisodeStoryboardVersionRequest.model_validate(downgrade), "downgrade")


@pytest.mark.parametrize(
    "fault", ["variant", "reference", "no-state", "other-location", "foreign-library"]
)
def test_wrong_exact_membership_rejects_without_append(tmp_path, fault):
    repository, project, episode, _image, library = prepared(tmp_path)
    value = environment_board(project, episode, library.version_id)
    one = value["content"]["shots"][0]
    if fault == "variant":
        one["environment_binding"]["variant_id"] = "scv_" + "f" * 32
    elif fault == "reference":
        one["environment_binding"]["reference_ids"] = ["erf_" + "f" * 32]
    elif fault == "no-state":
        one["environment_binding"]["variant_id"] = None
    elif fault == "other-location":
        one["location_id"] = None
        one["environment_binding"]["variant_id"] = None
    else:
        other_repo, other_project, _other_ep, _image, other_library = prepared(tmp_path / "other")
        assert other_repo.database_path != repository.database_path and other_project != project
        value["content"]["creative_library_version_id"] = other_library.version_id
    with pytest.raises(EpisodeStoryboardInputError):
        write(
            EpisodeStoryboardStore(repository),
            CreateEpisodeStoryboardVersionRequest.model_validate(value),
        )
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM episode_storyboard_write_requests"
        ).fetchone() == (0,)


@pytest.mark.parametrize("fault", ["missing", "changed"])
def test_history_and_original_replay_survive_loss_but_new_save_refuses(tmp_path, fault):
    repository, project, episode, image, library = prepared(tmp_path)
    store = EpisodeStoryboardStore(repository)
    value = environment_board(project, episode, library.version_id)
    request = CreateEpisodeStoryboardVersionRequest.model_validate(value)
    saved, _ = write(store, request, "environment")
    digest = image.latest_version.sha256
    blob = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
    if fault == "missing":
        blob.unlink()
    else:
        blob.write_bytes(b"x" * image.latest_version.byte_size)
    assert (
        store.get_version(
            project_id=project, episode_id=episode, version_id=saved.version_id
        ).content
        == request.content
    )
    replay, replayed = write(store, request, "environment")
    assert replayed and replay.version_id == saved.version_id
    value.update(parent_version_id=saved.version_id, expected_revision=saved.head_revision)
    with pytest.raises(EpisodeStoryboardInputError, match="environment"):
        write(store, CreateEpisodeStoryboardVersionRequest.model_validate(value), "new")
    assert store.get_latest(project_id=project, episode_id=episode).version_id == saved.version_id


@pytest.mark.parametrize(
    "fault",
    [
        "missing-binding",
        "variant-id",
        "duplicate",
        "extra",
        "null-location",
        "no-library",
        "g5",
        "old-schema",
        "unicode",
    ],
)
def test_closed_environment_contracts(fault):
    value = environment_board("prj_" + "a" * 32, "ep_" + "b" * 32, "ver_" + "c" * 32)
    one = value["content"]["shots"][0]
    if fault == "missing-binding":
        del one["environment_binding"]
    elif fault == "variant-id":
        one["environment_binding"]["variant_id"] = "invalid"
    elif fault == "duplicate":
        one["environment_binding"]["reference_ids"] *= 2
    elif fault == "extra":
        one["environment_binding"]["approved"] = True
    elif fault == "null-location":
        one["location_id"] = None
    elif fault == "no-library":
        value["content"]["creative_library_version_id"] = None
    elif fault == "g5":
        value["content"]["visual_bible_pin"] = {
            "version_id": "ver_" + "d" * 32,
            "content_hash": "sha256:" + "e" * 64,
        }
    elif fault == "old-schema":
        value["content"]["schema_version"] = "1.3.0"
    else:
        one["continuity_notes"] = "\ud800"
    with pytest.raises(ValidationError):
        CreateEpisodeStoryboardVersionRequest.model_validate(value)


def test_two_projects_two_episodes_exact_recovery_and_authenticated_http(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.media_asset_store import MediaAssetStore
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient
    from test_character_reference_assets import png
    from test_project_creative_library import make_project
    from test_project_environment import environment

    repository, project, episode, _image, library = prepared(tmp_path)
    other = make_project(repository)
    asset = MediaAssetStore(repository).import_local(other, png(tmp_path / "other.png"))
    second_library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=other,
        payload=environment(other, asset.id, asset.latest_version.id, asset.latest_version.sha256),
        idempotency_key="other",
        actor_id="human",
    )
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    with TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    ) as client:
        client.headers.update({"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"})
        saved = []
        for owner, basis in ((project, library), (other, second_library)):
            first = repository.list_episodes(owner)[0].id
            second = repository.create_episode(owner, title="Second").id
            for ep in (first, second):
                path = f"/api/v1/projects/{owner}/episodes/{ep}/storyboard"
                response = client.post(
                    path + "/versions",
                    json=environment_board(owner, ep, basis.version_id),
                    headers={"Idempotency-Key": ep},
                )
                assert response.status_code == 201, response.text
                version = response.json()["data"]["version"]
                saved.append((owner, ep, path, version))
        for owner, ep, path, version in reversed(saved):
            assert client.get(path).json()["data"] == version
            assert client.get(path + "/versions/" + version["version_id"]).json()["data"] == version
            assert version["content_hash"] == canonical_content_hash(version["content"])
            wrong = other if owner == project else project
            with pytest.raises((EpisodeStoryboardNotFoundError, EpisodeNotFoundError)):
                EpisodeStoryboardStore(repository).get_version(
                    project_id=wrong, episode_id=ep, version_id=version["version_id"]
                )
        client.headers.pop("Authorization")
        assert client.get(saved[0][2]).status_code == 401


def test_consumption_checks_only_referenced_shots_and_keeps_history(tmp_path):
    from aijian_api.assembly_storyboard_provenance import (
        AssemblyStoryboardReferenceError,
        validate_storyboard_provenance,
    )
    from aijian_api.episode_media_assembly_store import (
        EpisodeMediaAssemblyError,
        EpisodeMediaAssemblyStore,
    )
    from aijian_api.media_asset_store import MediaAssetStore
    from test_assembly_storyboard_provenance import linked_content, save
    from test_character_reference_assets import png
    from test_draft_export_runtime import fixture
    from test_project_environment import environment

    repository, project, episode, _asset, assembly = fixture(tmp_path)
    asset = MediaAssetStore(repository).import_local(project, png(tmp_path / "env.png"))
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=environment(
            project, asset.id, asset.latest_version.id, asset.latest_version.sha256
        ),
        idempotency_key="library",
        actor_id="human",
    )
    value = environment_board(project, episode, library.version_id)
    value["content"]["shots"][0]["environment_binding"] = {"variant_id": None, "reference_ids": []}
    source, _ = write(
        EpisodeStoryboardStore(repository),
        CreateEpisodeStoryboardVersionRequest.model_validate(value),
    )
    unused = save(repository, project, episode, assembly, linked_content(assembly, source))
    used = save(
        repository,
        project,
        episode,
        unused,
        linked_content(unused, source, source.content.shots[1].shot_id),
    )
    digest = asset.latest_version.sha256
    (tmp_path / "media-assets" / "blobs" / digest[:2] / digest).unlink()
    assert (
        EpisodeMediaAssemblyStore(repository)
        .read_version(project, episode, version_id=used.version_id)
        .content
        == used.content
    )
    assert (
        save(repository, project, episode, used, unused.content.model_dump(mode="json")).content
        == unused.content
    )
    with pytest.raises(EpisodeMediaAssemblyError) as error:
        save(
            repository,
            project,
            episode,
            EpisodeMediaAssemblyStore(repository).read_version(project, episode),
            used.content.model_dump(mode="json"),
        )
    assert error.value.code == "STORYBOARD_REFERENCE_STALE"
    with repository._connection() as connection:
        before = connection.total_changes
        validate_storyboard_provenance(repository, connection, unused.content, fresh=True)
        with pytest.raises(AssemblyStoryboardReferenceError) as error:
            validate_storyboard_provenance(repository, connection, used.content, fresh=True)
        assert error.value.code == "STORYBOARD_REFERENCE_STALE"
        assert connection.total_changes == before


def test_shared_fixture_is_canonical_backend_contract():
    fixture = json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "packages/contracts/fixtures/storyboard-environment.json"
        ).read_text(encoding="utf-8")
    )
    request = CreateEpisodeStoryboardVersionRequest.model_validate(fixture["request"])
    assert request.content.model_dump(mode="json") == fixture["response"]["data"]["content"]
    assert (
        canonical_content_hash(request.content.model_dump(mode="json"))
        == fixture["response"]["data"]["content_hash"]
    )
    CreateProjectCreativeLibraryVersionRequest.model_validate(fixture["library_request"])
