"""Finite project metadata support; no aspect mutation, G5 grant or media execution."""

import hashlib
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.main import create_app
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.security import SidecarSecurity
from aijian_api.visual_bible_contracts import VisualSafeAreaV1
from fastapi.testclient import TestClient
from pydantic import ValidationError


def environment(tmp_path: Path) -> tuple[StudioRepository, TestClient]:
    repository = StudioRepository(tmp_path / "workspace.db")
    host, token = "127.0.0.1:43137", "s" * 43
    client = TestClient(
        create_app(
            repository=repository,
            sidecar_security=SidecarSecurity(token=token, host=host, origin="app://aijian"),
        ),
        base_url=f"http://{host}",
        client=("127.0.0.1", 50137),
        raise_server_exceptions=False,
    )
    client.headers.update({"Authorization": f"Bearer {token}", "Origin": "app://aijian"})
    return repository, client


def settings_command(revision: int, description: str) -> dict[str, object]:
    return {
        "operation_id": f"pso_{uuid4().hex}",
        "expected_project_revision": revision,
        "changes": {"description": description},
    }


def test_actual_authenticated_creation_and_mixed_list_preserve_selected_aspects(tmp_path: Path):
    repository, client = environment(tmp_path)
    created = {}
    for ratio in ("9:16", "16:9"):
        response = client.post(
            "/api/v1/projects",
            json={"name": "Owned " + ratio, "aspect_ratio": ratio},
        )
        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        assert UUID(response.json()["request_id"])
        project = response.json()["data"]
        assert project["aspect_ratio"] == ratio
        assert project["revision"] == 1
        created[project["id"]] = project
        assert repository.get_project(project["id"]).aspect_ratio == ratio
        assert client.get(f"/api/v1/projects/{project['id']}").json()["data"] == project
        settings = client.get(f"/api/v1/projects/{project['id']}/settings")
        assert settings.status_code == 200
        assert settings.json()["data"]["aspect_ratio"] == ratio
        assert (
            settings.json()["boundary"]["aspect_duration_language"]
            == "READ_ONLY_PENDING_CONSUMER_CAPABILITIES"
        )
    listed = client.get("/api/v1/projects")
    assert listed.status_code == 200
    assert {p["id"]: p for p in listed.json()["data"]} == created
    assert len(repository.list_projects()) == 2


def test_omitted_aspect_keeps_existing_portrait_default(tmp_path: Path):
    repository, client = environment(tmp_path)
    response = client.post("/api/v1/projects", json={"name": "Existing default"})
    assert response.status_code == 201
    project = response.json()["data"]
    assert project["aspect_ratio"] == "9:16"
    assert repository.get_project(project["id"]).aspect_ratio == "9:16"


def test_existing_stored_landscape_gets_do_not_migrate_or_rewrite_any_db_bytes(tmp_path: Path):
    repository, client = environment(tmp_path)
    project = repository.create_project(
        name="Owned stored landscape",
        aspect_ratio="16:9",
        target_duration_seconds=60,
        source_language="zh-CN",
    )
    before = hashlib.sha256(repository.database_path.read_bytes()).hexdigest()
    with repository._connection() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 48
    listed = client.get("/api/v1/projects")
    fetched = client.get(f"/api/v1/projects/{project.id}")
    settings = client.get(f"/api/v1/projects/{project.id}/settings")
    assert listed.status_code == fetched.status_code == settings.status_code == 200
    assert listed.json()["data"] == [fetched.json()["data"]]
    assert fetched.json()["data"]["aspect_ratio"] == "16:9"
    assert settings.json()["data"]["aspect_ratio"] == "16:9"
    assert repository.get_project(project.id) == project
    assert hashlib.sha256(repository.database_path.read_bytes()).hexdigest() == before


@pytest.mark.parametrize("ratio", ["9:16", "16:9"])
def test_metadata_cas_and_historical_receipt_keep_aspect_identity_and_other_scope(
    tmp_path: Path, ratio: str
):
    repository, client = environment(tmp_path)
    project = repository.create_project(
        name="Owned original",
        aspect_ratio=ratio,
        target_duration_seconds=60,
        source_language="zh-CN",
    )
    other = repository.create_project(
        name="Other", aspect_ratio="9:16", target_duration_seconds=60, source_language="zh-CN"
    )
    artifact_type = "owned_aspect_history_control"
    artifact = repository.create_artifact_version(
        project_id=project.id,
        artifact_type=artifact_type,
        schema_version="1.0.0",
        content={"literal": "old exact artifact, not formal approval"},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="Owned history control",
    )
    episodes = repository.list_episodes(project.id)
    other_before = repository.get_project(other.id)
    old_version = artifact.version
    old_head = artifact.head

    root = f"/api/v1/projects/{project.id}"
    renamed = client.patch(
        root, json={"name": "Owned renamed"}, headers={"If-Match": '"revision-1"'}
    )
    assert renamed.status_code == 200
    assert renamed.headers["etag"] == '"revision-2"'
    assert renamed.json()["data"]["aspect_ratio"] == ratio
    first_command = settings_command(2, "Owned original receipt")
    first = client.post(root + "/settings", json=first_command)
    assert first.status_code == 200
    receipt = first.json()["data"]
    assert receipt["request_hash"] == canonical_content_hash(
        {"project_id": project.id, **first_command}
    )
    assert receipt["result"]["aspect_ratio"] == ratio
    assert receipt["base_revision"] == 2 and receipt["result_revision"] == 3
    operation_id = first_command["operation_id"]
    with repository._connection() as connection:
        original_row = tuple(
            connection.execute(
                "SELECT * FROM project_settings_write_receipts WHERE operation_id = ?",
                (operation_id,),
            ).fetchone()
        )
    archived = client.patch(root, json={"status": "archived"}, headers={"If-Match": '"revision-3"'})
    assert archived.status_code == 200
    assert archived.json()["data"]["aspect_ratio"] == ratio
    assert archived.json()["data"]["revision"] == 4
    assert client.post(root + "/settings", json=settings_command(3, "Stale")).status_code == 409
    changed_identity = first_command | {"changes": {"description": "Replacement original intent"}}
    assert client.post(root + "/settings", json=changed_identity).status_code == 409

    # Original operation GET, not a resend: it remains the immutable old result at head revision 4.
    historical = client.get(root + f"/settings/operations/{operation_id}")
    assert historical.status_code == 200
    assert historical.json()["data"] == receipt
    assert client.get(root + "/settings").json()["data"]["revision"] == 4
    assert (
        client.get(f"/api/v1/projects/{other.id}/settings/operations/{operation_id}").status_code
        == 404
    )
    with repository._connection() as connection:
        assert (
            tuple(
                connection.execute(
                    "SELECT * FROM project_settings_write_receipts WHERE operation_id = ?",
                    (operation_id,),
                ).fetchone()
            )
            == original_row
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM project_settings_write_receipts").fetchone()[0]
            == 1
        )
        assert connection.execute("SELECT COUNT(*) FROM gate_decisions").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0] == 0
    assert repository.get_project(other.id) == other_before
    assert repository.list_episodes(project.id) == episodes
    assert (
        repository.get_artifact_version(project.id, artifact_type, old_version.id).version
        == old_version
    )
    assert repository.get_artifact_head(project.id, artifact_type) == old_head


@pytest.mark.parametrize("ratio", ["1:1", "2.39:1", "16:9 ", "16/9", "", None, 169, True, []])
def test_unsupported_aspects_are_not_coerced_or_persisted(tmp_path: Path, ratio: object):
    repository, client = environment(tmp_path)
    response = client.post("/api/v1/projects", json={"name": "Rejected", "aspect_ratio": ratio})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert repository.list_projects() == []
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM episodes").fetchone()[0] == 0


def test_unknown_stored_aspect_is_blocked_without_silent_portrait_conversion(tmp_path: Path):
    repository, client = environment(tmp_path)
    project = repository.create_project(
        name="Owned unsupported stored value",
        aspect_ratio="1:1",
        target_duration_seconds=60,
        source_language="zh-CN",
    )
    before = hashlib.sha256(repository.database_path.read_bytes()).hexdigest()
    assert client.get("/api/v1/projects").status_code == 500
    assert client.get(f"/api/v1/projects/{project.id}").status_code == 500
    response = client.get(f"/api/v1/projects/{project.id}/settings")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "PROJECT_SETTINGS_STORAGE_ERROR"
    assert repository.get_project(project.id).aspect_ratio == "1:1"
    assert hashlib.sha256(repository.database_path.read_bytes()).hexdigest() == before


def test_landscape_metadata_does_not_expand_visual_g5_safe_area_policy():
    portrait = {
        "canvas_width": 1080,
        "canvas_height": 1920,
        "x": 0,
        "y": 0,
        "width": 1080,
        "height": 1920,
    }
    assert VisualSafeAreaV1.model_validate(portrait).canvas_width == 1080
    landscape = portrait | {
        "canvas_width": 1920,
        "canvas_height": 1080,
        "width": 1920,
        "height": 1080,
    }
    with pytest.raises(ValidationError, match="G5 portrait safety reference must be 9:16"):
        VisualSafeAreaV1.model_validate(landscape)
