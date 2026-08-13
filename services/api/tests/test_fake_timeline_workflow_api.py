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


def _import_source(client: TestClient, project_id: str) -> str:
    response = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "golden.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("第一章\n雨夜来信。".encode()).decode(),
        },
    )
    assert response.status_code == 201
    return str(response.json()["data"]["id"])


def test_deprecated_fake_timeline_route_never_runs_ffmpeg_in_request_thread(
    tmp_path: Path,
) -> None:
    client = TestClient(create_app(repository=StudioRepository(tmp_path / "workspace.db")))
    project_id = _project(client)
    _import_source(client, project_id)

    first = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")
    replay = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")

    assert first.status_code == replay.status_code == 409
    assert first.json()["error"]["code"] == "ASYNC_WORKFLOW_REQUIRED"
    assert replay.json()["error"]["code"] == "ASYNC_WORKFLOW_REQUIRED"
    tasks = client.get(f"/api/v1/projects/{project_id}/tasks")
    assert tasks.status_code == 200
    assert tasks.json()["data"]["summary"]["total"] == 0
    assert client.get(f"/api/v1/projects/{project_id}/timeline").status_code == 404


def test_deprecated_fake_timeline_route_still_requires_a_source(tmp_path: Path) -> None:
    client = TestClient(create_app(repository=StudioRepository(tmp_path / "workspace.db")))
    project_id = _project(client)

    response = client.post(f"/api/v1/projects/{project_id}/workflows/fake-timeline")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SOURCE_REQUIRED"


def test_deprecated_fake_timeline_route_keeps_its_typed_read_contract(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()

    operation = schema["paths"]["/api/v1/projects/{project_id}/workflows/fake-timeline"]["post"]
    assert operation["operationId"] == "startFakeTimelineWorkflow"
    assert operation["deprecated"] is True
    assert "TimelineResponse" in str(operation["responses"]["200"])
    assert "ErrorResponse" in str(operation["responses"]["409"])
