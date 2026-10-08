"""Targeted persistence, immutable readback and CAS checks for manual drafts."""

import sqlite3
from pathlib import Path

import pytest
from aijian_api.project_creative_library_contracts import (
    CreateProjectCreativeLibraryVersionRequest,
)
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryConflictError,
    ProjectCreativeLibraryInputError,
    ProjectCreativeLibraryNotFoundError,
    ProjectCreativeLibraryStorageError,
    ProjectCreativeLibraryStore,
)
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from pydantic import ValidationError


def make_project(repository: StudioRepository) -> str:
    return repository.create_project(
        name="Manual library",
        aspect_ratio="16:9",
        target_duration_seconds=60,
        source_language="zh-CN",
    ).id


def payload(
    project_id: str, *, name: str = "林舟", parent: str | None = None, revision: int | None = None
) -> CreateProjectCreativeLibraryVersionRequest:
    return CreateProjectCreativeLibraryVersionRequest.model_validate(
        {
            "content": {
                "schema_version": "1.0.0",
                "project_id": project_id,
                "episode_id": None,
                "characters": [
                    {
                        "character_id": "chr_" + "a" * 32,
                        "ordinal": 1,
                        "name": name,
                        "role": "主角",
                        "description": "守护城市",
                        "appearance": "",
                        "personality": "谨慎",
                    }
                ],
                "world": {
                    "premise": "星夜之城",
                    "rules": "永夜",
                    "era": "未来",
                    "visual_style": "手绘",
                    "palette": "蓝紫",
                    "materials": "金属",
                },
                "scenes": [
                    {
                        "scene_id": "loc_" + "b" * 32,
                        "ordinal": 1,
                        "name": "码头",
                        "description": "",
                        "location": "旧城",
                        "time_of_day": "夜晚",
                        "weather": "雨",
                        "continuity": "灯未熄",
                    }
                ],
            },
            "parent_version_id": parent,
            "expected_revision": revision,
            "change_summary": "保存人工创作草稿",
        }
    )


def test_restart_exact_history_replay_and_project_shared_scope(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)
    with pytest.raises(ProjectCreativeLibraryNotFoundError):
        store.get_latest(project_id=project)
    original = payload(project)
    first, replayed = store.write(
        project_id=project, payload=original, idempotency_key="save-one", actor_id="local-user"
    )
    assert not replayed
    assert first.episode_id is None
    second, _ = store.write(
        project_id=project,
        payload=payload(project, name="林舟改", parent=first.version_id, revision=1),
        idempotency_key="save-two",
        actor_id="local-user",
    )
    reopened = ProjectCreativeLibraryStore(StudioRepository(repository.database_path))
    assert reopened.get_latest(project_id=project).version_id == second.version_id
    historic = reopened.get_version(project_id=project, version_id=first.version_id)
    assert historic.content == original.content
    assert historic.content_hash == first.content_hash
    replay, replayed = reopened.write(
        project_id=project, payload=original, idempotency_key="save-one", actor_id="local-user"
    )
    assert replayed and replay.version_id == first.version_id
    assert replay.content_hash == first.content_hash
    assert replay.head_revision == 2
    other = make_project(repository)
    with pytest.raises(ProjectCreativeLibraryNotFoundError):
        reopened.get_version(project_id=other, version_id=first.version_id)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute(
            "SELECT episode_id FROM artifacts WHERE artifact_type = 'project_creative_library'"
        ).fetchall() == [(None,)]
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (2,)
        assert connection.execute("SELECT accepted_version_id FROM artifact_heads").fetchone() == (
            None,
        )


def test_conflicts_and_scope_rejection_do_not_append(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    other = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)
    first, _ = store.write(
        project_id=project, payload=payload(project), idempotency_key="one", actor_id="human"
    )
    for candidate, key in [
        (payload(project, name="changed"), "one"),
        (payload(project), "different"),
    ]:
        with pytest.raises(ProjectCreativeLibraryConflictError):
            store.write(
                project_id=project, payload=candidate, idempotency_key=key, actor_id="human"
            )
    with pytest.raises(ProjectCreativeLibraryInputError):
        store.write(
            project_id=other, payload=payload(project), idempotency_key="one", actor_id="human"
        )
    assert store.get_latest(project_id=project).version_id == first.version_id


def test_contract_rejects_duplicate_ids_noncontiguous_order_and_episode_scope(
    tmp_path: Path,
) -> None:
    project = make_project(StudioRepository(tmp_path / "studio.sqlite3"))
    valid = payload(project).model_dump(mode="json")
    for mutate in (
        lambda content: content.update(episode_id="ep_" + "a" * 32),
        lambda content: content["characters"].append(content["characters"][0]),
        lambda content: content["scenes"][0].update(ordinal=3),
        lambda content: content["characters"][0].update(character_id="123"),
        lambda content: content["world"].update(approved=True),
    ):
        candidate = payload(project).model_dump(mode="json")
        mutate(candidate["content"])
        with pytest.raises(ValidationError):
            CreateProjectCreativeLibraryVersionRequest.model_validate(candidate)
    assert CreateProjectCreativeLibraryVersionRequest.model_validate(valid)


def test_readback_failure_rolls_back_version_and_receipt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    store = ProjectCreativeLibraryStore(repository)

    def fail(*args: object, **kwargs: object) -> None:
        raise ProjectCreativeLibraryStorageError("injected readback failure")

    monkeypatch.setattr(store, "_version_data", fail)
    with pytest.raises(ProjectCreativeLibraryStorageError):
        store.write(
            project_id=project, payload=payload(project), idempotency_key="one", actor_id="human"
        )
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (0,)
        assert connection.execute(
            "SELECT COUNT(*) FROM project_creative_library_write_requests"
        ).fetchone() == (0,)


def test_http_writes_require_desktop_boundary_and_return_exact_hash(tmp_path: Path) -> None:
    from aijian_api.artifacts import canonical_content_hash
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    path = f"/api/v1/projects/{project}/creative-library"
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "app://aijian"})
    request = payload(project).model_dump(mode="json")
    assert client.get(path).json()["error"]["code"] == "CREATIVE_LIBRARY_NOT_FOUND"
    assert client.post(path + "/versions", json=request).status_code == 428
    response = client.post(
        path + "/versions", json=request, headers={"Idempotency-Key": "manual-one"}
    )
    assert response.status_code == 201, response.text
    version = response.json()["data"]["version"]
    assert version["content"] == request["content"]
    assert version["content_hash"] == canonical_content_hash(request["content"])
    assert response.headers["x-request-id"] == response.json()["request_id"]
    assert client.get(path + "/versions/" + version["version_id"]).json()["data"] == version
    assert client.post(
        path + "/versions", json=request, headers={"Idempotency-Key": "manual-one"}
    ).json()["data"]["replayed"]
    assert (
        client.post(
            path + "/versions", json=request, headers={"Idempotency-Key": "other"}
        ).status_code
        == 409
    )
    client.headers.pop("Authorization")
    assert (
        client.post(
            path + "/versions", json=request, headers={"Idempotency-Key": "unauthorized"}
        ).status_code
        == 401
    )
    public = TestClient(create_app(repository=repository))
    assert public.post(path + "/versions", json=request).status_code in (404, 405)


def test_migration_34_rolls_back_and_preserves_baseline_33(tmp_path: Path) -> None:
    path = tmp_path / "upgrade.sqlite3"

    def stop_before(version: int, step: int) -> None:
        if version == 34:
            raise RuntimeError("keep baseline 33")

    with pytest.raises(RuntimeError, match="keep baseline 33"):
        StudioRepository(path, migration_hook=stop_before)
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (33,)
        connection.execute(
            "INSERT INTO projects (id, name, aspect_ratio, target_duration_seconds, "
            "source_language, status, revision, created_at, updated_at) "
            "VALUES (?, 'Existing', '16:9', 60, 'zh-CN', 'active', 1, ?, ?)",
            ("prj_" + "c" * 32, "2026-10-08T00:00:00Z", "2026-10-08T00:00:00Z"),
        )

    def fail_after_statement(version: int, step: int) -> None:
        if version == 34 and step == 1:
            raise RuntimeError("interrupted new migration")

    with pytest.raises(RuntimeError, match="interrupted new migration"):
        StudioRepository(path, migration_hook=fail_after_statement)
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (33,)
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name = "
                "'project_creative_library_write_requests'"
            ).fetchall()
            == []
        )
        assert connection.execute("SELECT name FROM projects").fetchall() == [("Existing",)]
    repository = StudioRepository(path)
    assert repository.get_project("prj_" + "c" * 32).name == "Existing"
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone() == (SCHEMA_VERSION,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_concurrent_initial_writers_cannot_duplicate_or_overwrite(tmp_path: Path) -> None:
    from concurrent.futures import ThreadPoolExecutor

    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)

    def write(key: str) -> str:
        store = ProjectCreativeLibraryStore(repository)
        try:
            version, _ = store.write(
                project_id=project, payload=payload(project), idempotency_key=key, actor_id="human"
            )
            return version.version_id
        except ProjectCreativeLibraryConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(write, ["one", "two"]))
    assert outcomes.count("conflict") == 1
    winning_key = "one" if outcomes[0] != "conflict" else "two"
    with ThreadPoolExecutor(max_workers=2) as executor:
        replayed = list(executor.map(write, [winning_key, winning_key]))
    assert replayed[0] == replayed[1] != "conflict"
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (1,)
