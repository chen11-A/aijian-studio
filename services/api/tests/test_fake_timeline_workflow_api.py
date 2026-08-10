import base64
from pathlib import Path

from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient


def _project(client: TestClient, name: str = "雾城来信") -> str:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": name,
            "aspect_ratio": "9:16",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
        },
    )
    assert response.status_code == 201
    return str(response.json()["data"]["id"])


def _import_source(client: TestClient, project_id: str, text: str = "第一章\n雨夜来信。") -> str:
    response = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "golden.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode(text.encode()).decode(),
        },
    )
    assert response.status_code == 201
    return str(response.json()["data"]["id"])


def test_starts_idempotent_fake_timeline_workflow_without_database_seeding(
    tmp_path: Path,
) -> None:
    client = TestClient(create_app(repository=StudioRepository(tmp_path / "workspace.db")))
    project_id = _project(client)
    _import_source(client, project_id)

    first = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    repeated = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")

    assert first.status_code == repeated.status_code == 200
    assert repeated.json()["data"]["version_id"] == first.json()["data"]["version_id"]
    timeline = first.json()["data"]["timeline"]
    assert timeline["revision"] == 1
    assert len(timeline["assets"]) == len(timeline["clips"]) == 3
    assert first.json()["data"]["total_duration_frames"] == 150

    tasks = client.get(f"/api/v1/projects/{project_id}/tasks")
    assert tasks.status_code == 200
    assert tasks.json()["data"]["summary"] == {
        "total": 1,
        "attention": 0,
        "active": 0,
        "completed": 1,
    }
    task = tasks.json()["data"]["tasks"][0]
    assert task["node"]["node_type"] == "timeline.assemble.fake"
    assert task["node"]["output_version_id"] == first.json()["data"]["version_id"]
    assert task["attempt"]["status"] == "SUCCEEDED"
    assert task["presentation"]["status_label"] == "已完成"
    assert len(task["node"]["input_version_ids"]) == 1


def test_fake_timeline_workflow_requires_a_source_and_preserves_existing_timeline(
    tmp_path: Path,
) -> None:
    client = TestClient(create_app(repository=StudioRepository(tmp_path / "workspace.db")))
    project_id = _project(client)

    missing_source = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    assert missing_source.status_code == 409
    assert missing_source.json()["error"]["code"] == "SOURCE_REQUIRED"

    _import_source(client, project_id)
    created = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    assert created.status_code == 200
    original_version = created.json()["data"]["version_id"]

    _import_source(client, project_id, "第二章\n新的来源版本。")
    stale = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "TIMELINE_ALREADY_EXISTS"
    assert (
        client.get(f"/api/v1/projects/{project_id}/timeline").json()["data"]["version_id"]
        == original_version
    )


def test_fake_timeline_workflow_is_public_and_typed(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()

    operation = schema["paths"]["/api/v1/projects/{project_id}/workflows/fake-timeline"]["post"]
    assert operation["operationId"] == "startFakeTimelineWorkflow"
    assert "TimelineResponse" in str(operation["responses"]["200"])
    assert "ErrorResponse" in str(operation["responses"]["409"])
