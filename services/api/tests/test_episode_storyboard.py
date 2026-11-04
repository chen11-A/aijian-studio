"""Manual storyboard persistence, exact upstream pins, boundaries and recovery."""

import copy
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardConflictError,
    EpisodeStoryboardInputError,
    EpisodeStoryboardNotFoundError,
    EpisodeStoryboardStorageError,
    EpisodeStoryboardStore,
    EpisodeStoryboardTooLargeError,
)
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from pydantic import ValidationError
from test_project_creative_library import make_project
from test_project_creative_library import payload as library_payload


def shot(number: int = 1, *, ordinal: int | None = None) -> dict[str, Any]:
    return {
        "shot_id": f"shp_{number:032x}",
        "ordinal": ordinal if ordinal is not None else number,
        "duration_frames": 75,
        "title": f"镜头 {number}",
        "description": "码头的灯火",
        "action": "角色回望",
        "dialogue": "我会回来。",
        "camera": "中景",
        "script_scene_id": None,
        "character_ids": [],
        "location_id": None,
    }


def payload(
    project: str,
    episode: str,
    *,
    shots: list[dict[str, Any]] | None = None,
    parent: str | None = None,
    revision: int | None = None,
    script: str | None = None,
    library: str | None = None,
) -> CreateEpisodeStoryboardVersionRequest:
    return CreateEpisodeStoryboardVersionRequest.model_validate(
        {
            "content": {
                "schema_version": "1.0.0",
                "project_id": project,
                "episode_id": episode,
                "fps": 25,
                "script_version_id": script,
                "creative_library_version_id": library,
                "shots": shots if shots is not None else [],
            },
            "parent_version_id": parent,
            "expected_revision": revision,
            "change_summary": "保存人工分镜草稿",
        }
    )


def write(
    store: EpisodeStoryboardStore,
    candidate: CreateEpisodeStoryboardVersionRequest,
    key: str = "save",
) -> Any:
    return store.write(
        project_id=candidate.content.project_id,
        episode_id=candidate.content.episode_id,
        payload=candidate,
        idempotency_key=key,
        actor_id="local-user",
    )


def script_version(repository: StudioRepository, project: str, episode: str) -> str:
    version, _ = EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": {
                    "project_id": project,
                    "episode_id": episode,
                    "scenes": [
                        {"scene_id": "scn_" + "a" * 32, "ordinal": 1, "heading": "外景 码头"}
                    ],
                },
                "change_summary": "人工剧本",
            }
        ),
        idempotency_key="script",
        actor_id="local-user",
    )
    return version.version_id


def test_empty_save_restart_reorder_delete_and_history_keep_stable_ids(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    store = EpisodeStoryboardStore(repository)
    with pytest.raises(EpisodeStoryboardNotFoundError):
        store.get_latest(project_id=project, episode_id=episode)
    empty = payload(project, episode)
    first, replayed = write(store, empty, "empty")
    assert not replayed and first.content.shots == ()
    second, _ = write(
        store,
        payload(project, episode, shots=[shot(), shot(2)], parent=first.version_id, revision=1),
        "two-shots",
    )
    third, _ = write(
        store,
        payload(
            project,
            episode,
            shots=[shot(2, ordinal=1), shot(1, ordinal=2)],
            parent=second.version_id,
            revision=2,
        ),
        "reorder",
    )
    final, _ = write(
        store,
        payload(project, episode, shots=[shot(2, ordinal=1)], parent=third.version_id, revision=3),
        "delete",
    )
    reopened = EpisodeStoryboardStore(StudioRepository(repository.database_path))
    assert reopened.get_latest(project_id=project, episode_id=episode) == final
    history = reopened.get_version(
        project_id=project, episode_id=episode, version_id=second.version_id
    )
    assert [item.shot_id for item in history.content.shots] == [
        shot()["shot_id"],
        shot(2)["shot_id"],
    ]
    assert final.content.shots[0].shot_id == history.content.shots[1].shot_id
    assert history.content_hash == second.content_hash
    replay, replayed = write(reopened, empty, "empty")
    assert replayed and replay.version_id == first.version_id and replay.head_revision == 4
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (4,)
        assert connection.execute("SELECT accepted_version_id FROM artifact_heads").fetchall() == [
            (None,)
        ]
        assert connection.execute("SELECT artifact_type FROM artifacts").fetchall() == [
            ("episode_storyboard",)
        ]
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute(
                "UPDATE episode_storyboard_write_requests SET request_hash = request_hash"
            )


def test_exact_pins_survive_upstream_edits_and_allow_no_referenced_shots(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    script = script_version(repository, project, episode)
    library_store = ProjectCreativeLibraryStore(repository)
    library, _ = library_store.write(
        project_id=project,
        payload=library_payload(project),
        idempotency_key="library",
        actor_id="human",
    )
    store = EpisodeStoryboardStore(repository)
    first, _ = write(store, payload(project, episode, script=script, library=library.version_id))
    bound = shot()
    bound.update(
        script_scene_id="scn_" + "a" * 32,
        character_ids=["chr_" + "a" * 32],
        location_id="loc_" + "b" * 32,
    )
    second, _ = write(
        store,
        payload(
            project,
            episode,
            shots=[bound],
            script=script,
            library=library.version_id,
            parent=first.version_id,
            revision=1,
        ),
        "linked",
    )
    library_store.write(
        project_id=project,
        payload=library_payload(project, name="更新人物", parent=library.version_id, revision=1),
        idempotency_key="library-later",
        actor_id="human",
    )
    reopened = EpisodeStoryboardStore(StudioRepository(repository.database_path))
    assert reopened.get_latest(project_id=project, episode_id=episode).content == second.content
    assert (
        reopened.get_version(
            project_id=project, episode_id=episode, version_id=first.version_id
        ).content.shots
        == ()
    )
    with sqlite3.connect(repository.database_path) as connection:
        dependencies = connection.execute(
            "SELECT upstream_version_id, relationship, impact FROM artifact_dependencies "
            "WHERE downstream_version_id = ?",
            (second.version_id,),
        ).fetchall()
        assert sorted(dependencies) == sorted(
            [(script, "derived_from", "blocking"), (library.version_id, "derived_from", "blocking")]
        )


def test_pins_reject_other_episode_project_wrong_type_and_unknown_members(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    other_episode = repository.create_episode(project, title="第二集").id
    other_project = make_project(repository)
    other_default = repository.list_episodes(other_project)[0].id
    own_script = script_version(repository, project, episode)
    foreign_script = script_version(repository, project, other_episode)
    external_script = script_version(repository, other_project, other_default)
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=library_payload(project),
        idempotency_key="library",
        actor_id="human",
    )
    external_library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=other_project,
        payload=library_payload(other_project),
        idempotency_key="library",
        actor_id="human",
    )
    store = EpisodeStoryboardStore(repository)
    invalid = [
        payload(project, episode, script=foreign_script),
        payload(project, episode, script=external_script),
        payload(project, episode, script=library.version_id),
        payload(project, episode, library=external_library.version_id),
        payload(project, episode, library=own_script),
        payload(project, episode, script="ver_" + "f" * 32),
    ]
    for field, value in [
        ("script_scene_id", "scn_" + "f" * 32),
        ("character_ids", ["chr_" + "f" * 32]),
        ("location_id", "loc_" + "f" * 32),
    ]:
        missing_member = shot()
        missing_member[field] = value
        invalid.append(
            payload(
                project,
                episode,
                shots=[missing_member],
                script=own_script,
                library=library.version_id,
            )
        )
    for index, candidate in enumerate(invalid):
        with pytest.raises(EpisodeStoryboardInputError):
            write(store, candidate, f"invalid-{index}")
    with pytest.raises(EpisodeStoryboardNotFoundError):
        store.get_latest(project_id=project, episode_id=episode)


def test_scope_cas_idempotency_and_concurrent_writes(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    other = repository.create_episode(project, title="另一集").id
    store = EpisodeStoryboardStore(repository)
    candidate = payload(project, episode)
    with pytest.raises(EpisodeStoryboardInputError):
        store.write(
            project_id=project,
            episode_id=other,
            payload=candidate,
            idempotency_key="scope",
            actor_id="human",
        )

    def attempt(key: str) -> str:
        try:
            version, _ = write(store, candidate, key)
            return version.version_id
        except EpisodeStoryboardConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(attempt, ["one", "two"]))
    assert outcomes.count("conflict") == 1
    key = "one" if outcomes[0] != "conflict" else "two"
    first, replayed = write(store, candidate, key)
    assert replayed
    with pytest.raises(EpisodeStoryboardConflictError):
        write(store, payload(project, episode, shots=[shot()]), key)
    with pytest.raises(EpisodeStoryboardConflictError):
        write(store, payload(project, episode, parent=first.version_id, revision=2), "stale")
    other_version, _ = write(store, payload(project, other), key)
    assert other_version.version_id != first.version_id
    with pytest.raises(EpisodeStoryboardNotFoundError):
        store.get_version(project_id=project, episode_id=other, version_id=first.version_id)


@pytest.mark.parametrize(
    "field,value",
    [
        ("fps", True),
        ("fps", 0),
        ("fps", 121),
        ("fps", 25.5),
        ("episode_id", None),
        ("project_id", "invalid"),
        ("approved", True),
    ],
)
def test_closed_content_and_numeric_bounds(field: str, value: object) -> None:
    candidate = payload("prj_" + "a" * 32, "ep_" + "b" * 32).model_dump(mode="json")
    candidate["content"][field] = value
    with pytest.raises(ValidationError):
        CreateEpisodeStoryboardVersionRequest.model_validate(candidate)


@pytest.mark.parametrize(
    "field,value",
    [
        ("ordinal", 2),
        ("duration_frames", 0),
        ("duration_frames", True),
        ("duration_frames", 864001),
        ("title", "  "),
        ("title", "x" * 241),
        ("description", "x" * 20001),
        ("camera", "x" * 241),
        ("shot_id", "bad"),
        ("script_scene_id", "scn_" + "a" * 32),
        ("character_ids", ["chr_" + "a" * 32]),
        ("location_id", "loc_" + "a" * 32),
        ("image_asset_id", "media_unrequested"),
    ],
)
def test_closed_shots_require_pins_and_bounded_fields(field: str, value: object) -> None:
    candidate = payload("prj_" + "a" * 32, "ep_" + "b" * 32, shots=[shot()]).model_dump(mode="json")
    candidate["content"]["shots"][0][field] = value
    with pytest.raises(ValidationError):
        CreateEpisodeStoryboardVersionRequest.model_validate(candidate)


def test_duplicate_identity_characters_and_revision_pair_are_rejected() -> None:
    candidate = payload("prj_" + "a" * 32, "ep_" + "b" * 32, shots=[shot()]).model_dump(mode="json")
    duplicate = copy.deepcopy(candidate)
    duplicate["content"]["shots"].append(shot(1, ordinal=2))
    characters = copy.deepcopy(candidate)
    characters["content"]["creative_library_version_id"] = "ver_" + "c" * 32
    characters["content"]["shots"][0]["character_ids"] = ["chr_" + "c" * 32] * 2
    bad_pair = copy.deepcopy(candidate)
    bad_pair["expected_revision"] = 1
    for malformed in [duplicate, characters, bad_pair]:
        with pytest.raises(ValidationError):
            CreateEpisodeStoryboardVersionRequest.model_validate(malformed)


def test_readback_failure_rolls_back_version_receipt_and_head(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    store = EpisodeStoryboardStore(repository)

    def fail(*args: object, **kwargs: object) -> None:
        raise EpisodeStoryboardStorageError("injected integrity failure")

    monkeypatch.setattr(store, "_version_data", fail)
    with pytest.raises(EpisodeStoryboardStorageError):
        write(store, payload(project, episode, shots=[shot()]))
    with sqlite3.connect(repository.database_path) as connection:
        for table in ["artifact_versions", "artifact_heads", "episode_storyboard_write_requests"]:
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)


def test_corrupt_dependency_or_pinned_content_fails_readback(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    script = script_version(repository, project, episode)
    store = EpisodeStoryboardStore(repository)
    first, _ = write(store, payload(project, episode, script=script))
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_dependencies_immutable_delete")
        connection.execute(
            "DELETE FROM artifact_dependencies WHERE downstream_version_id = ?", (first.version_id,)
        )
    with pytest.raises(EpisodeStoryboardStorageError):
        store.get_latest(project_id=project, episode_id=episode)
    with pytest.raises(EpisodeStoryboardStorageError):
        write(store, payload(project, episode, script=script))


def test_size_guard_leaves_no_receipt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import aijian_api.episode_storyboard_store as module

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    monkeypatch.setattr(module, "MAX_STORYBOARD_BYTES", 1)
    with pytest.raises(EpisodeStoryboardTooLargeError):
        write(EpisodeStoryboardStore(repository), payload(project, episode))
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM episode_storyboard_write_requests"
        ).fetchone() == (0,)


def test_http_boundary_errors_hash_and_immutable_readback(tmp_path: Path) -> None:
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    path = f"/api/v1/projects/{project}/episodes/{episode}/storyboard"
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "app://aijian"})
    candidate = payload(project, episode, shots=[shot()]).model_dump(mode="json")
    assert client.get(path).json()["error"]["code"] == "STORYBOARD_NOT_FOUND"
    assert client.post(path + "/versions", json=candidate).status_code == 428
    response = client.post(
        path + "/versions", json=candidate, headers={"Idempotency-Key": "http-one"}
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]["version"]
    assert data["content"] == candidate["content"]
    assert data["content_hash"] == canonical_content_hash(candidate["content"])
    assert response.headers["x-request-id"] == response.json()["request_id"]
    assert client.get(path).json()["data"] == data
    assert client.get(path + "/versions/" + data["version_id"]).json()["data"] == data
    assert client.post(
        path + "/versions", json=candidate, headers={"Idempotency-Key": "http-one"}
    ).json()["data"]["replayed"]
    assert (
        client.post(
            path + "/versions", json=candidate, headers={"Idempotency-Key": "other"}
        ).status_code
        == 409
    )
    wrong_scope = copy.deepcopy(candidate)
    wrong_scope["content"]["episode_id"] = "ep_" + "c" * 32
    assert (
        client.post(
            path + "/versions", json=wrong_scope, headers={"Idempotency-Key": "wrong"}
        ).status_code
        == 422
    )
    client.headers.pop("Authorization")
    assert (
        client.post(
            path + "/versions", json=candidate, headers={"Idempotency-Key": "auth"}
        ).status_code
        == 401
    )
    assert TestClient(create_app(repository=repository)).post(
        path + "/versions", json=candidate
    ).status_code in (404, 405)


def test_migration_35_failure_rolls_back_and_retry_preserves_existing_rows(tmp_path: Path) -> None:
    database = tmp_path / "upgrade.sqlite3"

    def stop(version: int, step: int) -> None:
        if version == 35:
            raise RuntimeError("baseline 34")

    with pytest.raises(RuntimeError, match="baseline 34"):
        StudioRepository(database, migration_hook=stop)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (34,)
        connection.execute(
            "INSERT INTO projects (id, name, aspect_ratio, target_duration_seconds, "
            "source_language, status, revision, created_at, updated_at) "
            "VALUES (?, 'Existing', '16:9', 60, 'zh-CN', 'active', 1, ?, ?)",
            ("prj_" + "d" * 32, "2026-10-08T00:00:00Z", "2026-10-08T00:00:00Z"),
        )

    def interrupt(version: int, step: int) -> None:
        if version == 35 and step == 1:
            raise RuntimeError("interrupted")

    with pytest.raises(RuntimeError, match="interrupted"):
        StudioRepository(database, migration_hook=interrupt)
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (34,)
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'episode_storyboard_write_requests'"
            ).fetchall()
            == []
        )
        assert connection.execute("SELECT name FROM projects").fetchall() == [("Existing",)]
    repository = StudioRepository(database)
    assert repository.get_project("prj_" + "d" * 32).name == "Existing"
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (SCHEMA_VERSION,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    StudioRepository(database)


@pytest.mark.parametrize("source", ["script", "library"])
def test_readback_rechecks_membership_even_when_source_hash_is_valid(
    tmp_path: Path, source: str
) -> None:
    import json

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    script = script_version(repository, project, episode)
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=library_payload(project),
        idempotency_key="library",
        actor_id="human",
    )
    bound = shot()
    bound.update(
        script_scene_id="scn_" + "a" * 32,
        character_ids=["chr_" + "a" * 32],
        location_id="loc_" + "b" * 32,
    )
    store = EpisodeStoryboardStore(repository)
    candidate = payload(project, episode, shots=[bound], script=script, library=library.version_id)
    version, _ = write(store, candidate)
    with sqlite3.connect(repository.database_path) as connection:
        source_id = script if source == "script" else library.version_id
        content = json.loads(
            connection.execute(
                "SELECT content_json FROM artifact_versions WHERE version_id = ?", (source_id,)
            ).fetchone()[0]
        )
        content["scenes" if source == "script" else "characters"] = []
        connection.execute("DROP TRIGGER artifact_versions_immutable_update")
        connection.execute(
            "UPDATE artifact_versions SET content_json = ?, content_hash = ? WHERE version_id = ?",
            (json.dumps(content), canonical_content_hash(content), source_id),
        )
    with pytest.raises(EpisodeStoryboardStorageError):
        store.get_version(project_id=project, episode_id=episode, version_id=version.version_id)
    with pytest.raises(EpisodeStoryboardStorageError):
        write(store, candidate)


def test_manual_storyboard_does_not_bypass_shot_outline_source_gate(tmp_path: Path) -> None:
    from aijian_api.repository import ArtifactDependencyInvalidError

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    write(EpisodeStoryboardStore(repository), payload(project, episode, shots=[shot()]))
    with pytest.raises(ArtifactDependencyInvalidError, match="accepted SourceManifest"):
        repository.create_artifact_version(
            project_id=project,
            artifact_type="shot_outline",
            episode_id=episode,
            schema_version="1.0.0",
            content={},
            author_actor_type="human",
            author_actor_id="local-user",
            change_summary="Cannot masquerade as accepted outline",
        )
