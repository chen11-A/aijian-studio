"""Versioned shared relationships/costumes, legacy bytes and exact pin boundaries."""

import json
import sqlite3
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryConflictError,
    ProjectCreativeLibraryStorageError,
    ProjectCreativeLibraryStore,
)
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_project_creative_library import make_project, payload


def details_request(project: str) -> CreateProjectCreativeLibraryVersionRequest:
    candidate = payload(project).model_dump(mode="json")
    content = candidate["content"]
    content["schema_version"] = "1.1.0"
    content["characters"].append(
        {
            **content["characters"][0],
            "character_id": "chr_" + "c" * 32,
            "ordinal": 2,
            "name": "周岚",
        }
    )
    content["relationships"] = [
        {
            "relationship_id": "rel_" + "d" * 32,
            "ordinal": 1,
            "from_character_id": "chr_" + "a" * 32,
            "to_character_id": "chr_" + "c" * 32,
            "label": "同事",
            "description": "信任逐步建立",
        }
    ]
    content["costumes"] = [
        {
            "costume_id": "cst_" + "e" * 32,
            "ordinal": 1,
            "character_id": "chr_" + "a" * 32,
            "name": "雨衣",
            "description": "深蓝色旧雨衣",
        }
    ]
    return CreateProjectCreativeLibraryVersionRequest.model_validate(candidate)


def test_details_save_restart_history_replay_and_legacy_bytes(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)
    original = payload(project)
    old, _ = store.write(
        project_id=project, payload=original, idempotency_key="old", actor_id="human"
    )
    request = details_request(project).model_copy(
        update={"parent_version_id": old.version_id, "expected_revision": old.head_revision}
    )
    saved, _ = store.write(
        project_id=project, payload=request, idempotency_key="details", actor_id="human"
    )
    reopened = ProjectCreativeLibraryStore(StudioRepository(repository.database_path))
    exact = reopened.get_version(project_id=project, version_id=saved.version_id)
    assert exact.content.model_dump(mode="json") == request.content.model_dump(mode="json")
    assert exact.content_hash == canonical_content_hash(request.content.model_dump(mode="json"))
    historic = reopened.get_version(project_id=project, version_id=old.version_id)
    assert historic.content.model_dump(mode="json") == original.content.model_dump(mode="json")
    assert historic.content_hash == old.content_hash
    replay, replayed = reopened.write(
        project_id=project, payload=request, idempotency_key="details", actor_id="human"
    )
    assert replayed and replay.version_id == saved.version_id
    for key, changed in [("details", "different"), ("new-key", "new content")]:
        conflict = request.model_dump(mode="json")
        conflict["content"]["costumes"][0]["description"] = changed
        with pytest.raises(ProjectCreativeLibraryConflictError):
            reopened.write(
                project_id=project,
                payload=CreateProjectCreativeLibraryVersionRequest.model_validate(conflict),
                idempotency_key=key,
                actor_id="human",
            )
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (2,)
        assert connection.execute(
            "SELECT COUNT(*) FROM project_creative_library_write_requests"
        ).fetchone() == (2,)
        assert connection.execute("SELECT accepted_version_id FROM artifact_heads").fetchone() == (
            None,
        )


@pytest.mark.parametrize(
    "field,change",
    [
        ("relationships", {"from_character_id": "chr_" + "f" * 32}),
        ("relationships", {"to_character_id": "chr_" + "a" * 32}),
        ("relationships", {"ordinal": 2}),
        ("relationships", {"label": "   "}),
        ("relationships", {"description": "\ud800"}),
        ("relationships", {"approved": True}),
        ("costumes", {"character_id": "chr_" + "f" * 32}),
        ("costumes", {"name": "   "}),
        ("costumes", {"ordinal": 0}),
        ("costumes", {"reference_asset_id": "fabricated"}),
    ],
)
def test_closed_details_reject_orphan_self_blank_order_and_unknown_fields(
    field: str, change: dict[str, object]
) -> None:
    candidate = details_request("prj_" + "a" * 32).model_dump(mode="json")
    candidate["content"][field][0].update(change)
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(candidate)


@pytest.mark.parametrize("field", ["relationships", "costumes"])
def test_duplicate_ids_and_legacy_mislabel_rejected(field: str) -> None:
    candidate = details_request("prj_" + "a" * 32).model_dump(mode="json")
    entry = {**candidate["content"][field][0], "ordinal": 2}
    candidate["content"][field].append(entry)
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(candidate)
    candidate["content"]["schema_version"] = "1.0.0"
    with pytest.raises(ValidationError):
        CreateProjectCreativeLibraryVersionRequest.model_validate(candidate)


def test_valid_hash_cannot_hide_orphan_relationship_on_read(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)
    saved, _ = store.write(
        project_id=project,
        payload=details_request(project),
        idempotency_key="details",
        actor_id="human",
    )
    corrupt = saved.content.model_dump(mode="json")
    corrupt["relationships"][0]["to_character_id"] = "chr_" + "f" * 32
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_versions_immutable_update")
        connection.execute(
            "UPDATE artifact_versions SET content_json = ?, content_hash = ? WHERE version_id = ?",
            (
                json.dumps(corrupt, ensure_ascii=False),
                canonical_content_hash(corrupt),
                saved.version_id,
            ),
        )
    with pytest.raises(ProjectCreativeLibraryStorageError):
        store.get_version(project_id=project, version_id=saved.version_id)


def test_new_schema_cannot_be_silently_downgraded(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)
    saved, _ = store.write(
        project_id=project,
        payload=details_request(project),
        idempotency_key="details",
        actor_id="human",
    )
    legacy = payload(project, parent=saved.version_id, revision=saved.head_revision)
    with pytest.raises(ProjectCreativeLibraryConflictError):
        store.write(
            project_id=project, payload=legacy, idempotency_key="downgrade", actor_id="human"
        )
    assert store.get_latest(project_id=project).version_id == saved.version_id


def test_two_episodes_pin_exact_v2_members_and_retain_history_after_shared_changes(
    tmp_path: Path,
) -> None:
    from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
    from test_episode_storyboard import payload as storyboard_payload
    from test_episode_storyboard import shot, write

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    other = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)
    library, _ = store.write(
        project_id=project,
        payload=details_request(project),
        idempotency_key="details",
        actor_id="human",
    )
    episodes = [
        repository.list_episodes(project)[0].id,
        repository.create_episode(project, title="第二集").id,
    ]
    boards = EpisodeStoryboardStore(repository)
    linked = shot()
    linked["character_ids"] = ["chr_" + "a" * 32]
    saved = [
        write(
            boards, storyboard_payload(project, episode, shots=[linked], library=library.version_id)
        )[0]
        for episode in episodes
    ]
    changed = details_request(project).model_dump(mode="json")
    changed["parent_version_id"] = library.version_id
    changed["expected_revision"] = library.head_revision
    changed["content"]["costumes"][0]["description"] = "新版灰色雨衣"
    next_version, _ = store.write(
        project_id=project,
        payload=CreateProjectCreativeLibraryVersionRequest.model_validate(changed),
        idempotency_key="next",
        actor_id="human",
    )
    assert next_version.content_hash != library.content_hash
    for board in saved:
        exact = boards.get_version(
            project_id=project, episode_id=board.episode_id, version_id=board.version_id
        )
        assert exact.content.creative_library_version_id == library.version_id
    from aijian_api.project_creative_library_store import ProjectCreativeLibraryNotFoundError

    with pytest.raises(ProjectCreativeLibraryNotFoundError):
        store.get_version(project_id=other, version_id=library.version_id)


def test_authenticated_http_validates_and_reads_exact_v2_content(tmp_path: Path) -> None:
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "app://aijian"})
    path = f"/api/v1/projects/{project}/creative-library"
    candidate = details_request(project).model_dump(mode="json")
    created = client.post(path + "/versions", json=candidate, headers={"Idempotency-Key": "v2"})
    assert created.status_code == 201, created.text
    data = created.json()["data"]["version"]
    assert data["content"] == candidate["content"]
    assert client.get(path + "/versions/" + data["version_id"]).json()["data"] == data
    candidate["content"]["relationships"][0]["to_character_id"] = "chr_" + "f" * 32
    assert (
        client.post(
            path + "/versions", json=candidate, headers={"Idempotency-Key": "invalid"}
        ).status_code
        == 422
    )
