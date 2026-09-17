import base64
from pathlib import Path

from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_production_brief import original_payload

TOKEN = "p" * 43
HOST = "127.0.0.1:43129"
ORIGIN = "app://aijian"


def _client(tmp_path: Path) -> TestClient:
    client = TestClient(
        create_app(
            repository=StudioRepository(tmp_path / "workspace.db"),
            sidecar_security=SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN),
        ),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50104),
    )
    client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    return client


def _project(client: TestClient) -> str:
    response = client.post("/api/v1/projects", json={"name": "Brief"})
    assert response.status_code == 201
    return response.json()["data"]["id"]


def test_sidecar_write_replays_receipt_and_exact_version_read_is_project_scoped(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path)
    project_id = _project(client)
    body = {"content": original_payload(), "change_summary": "创建原创简报"}
    path = f"/api/v1/projects/{project_id}/production-brief/versions"
    created = client.post(path, json=body, headers={"Idempotency-Key": "brief-create"})
    assert created.status_code == 201
    version_id = created.json()["data"]["version"]["id"]
    replay = client.post(path, json=body, headers={"Idempotency-Key": "brief-create"})
    assert replay.status_code == 201
    assert replay.json()["data"]["version"]["id"] == version_id
    assert client.get(f"/api/v1/projects/{project_id}/production-brief").status_code == 200
    exact = client.get(f"{path.rsplit('/versions', 1)[0]}/versions/{version_id}")
    assert exact.status_code == 200
    other_project = _project(client)
    hidden = client.get(f"/api/v1/projects/{other_project}/production-brief/versions/{version_id}")
    assert hidden.status_code == 404


def test_missing_or_reused_idempotency_key_is_rejected(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = _project(client)
    path = f"/api/v1/projects/{project_id}/production-brief/versions"
    body = {"content": original_payload(), "change_summary": "创建原创简报"}
    assert client.post(path, json=body).status_code == 428
    assert client.post(path, json=body, headers={"Idempotency-Key": "same"}).status_code == 201
    body["change_summary"] = "不同输入"
    reused = client.post(path, json=body, headers={"Idempotency-Key": "same"})
    assert reused.status_code == 409


def test_revision_conflict_is_a_409(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = _project(client)
    path = f"/api/v1/projects/{project_id}/production-brief/versions"
    created = client.post(
        path,
        json={"content": original_payload(), "change_summary": "创建原创简报"},
        headers={"Idempotency-Key": "first"},
    )
    version_id = created.json()["data"]["version"]["id"]
    conflict = client.post(
        path,
        json={
            "content": original_payload(),
            "change_summary": "错误修订",
            "parent_version_id": version_id,
            "expected_revision": 99,
        },
        headers={"Idempotency-Key": "conflict"},
    )
    assert conflict.status_code == 409


def test_write_is_absent_without_sidecar_and_rejects_missing_sidecar_token(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    public = TestClient(create_app(repository=repository))
    project = repository.create_project(
        name="Public", aspect_ratio="16:9", target_duration_seconds=90, source_language="zh-CN"
    )
    path = f"/api/v1/projects/{project.id}/production-brief/versions"
    assert public.post(path, json={}).status_code == 404

    client = _client(tmp_path / "protected")
    protected_project = _project(client)
    denied = client.post(
        f"/api/v1/projects/{protected_project}/production-brief/versions",
        json={"content": original_payload(), "change_summary": "创建原创简报"},
        headers={"Authorization": "", "Idempotency-Key": "denied"},
    )
    assert denied.status_code == 401


def test_exact_read_rejects_same_project_version_of_another_artifact_type(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = _project(client)
    imported = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={
            "filename": "source.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("第一章\n来源".encode()).decode(),
        },
    )
    assert imported.status_code == 201
    source_version_id = client.get(f"/api/v1/projects/{project_id}/source-manifest").json()["data"][
        "latest_version"
    ]["id"]
    response = client.get(
        f"/api/v1/projects/{project_id}/production-brief/versions/{source_version_id}"
    )
    assert response.status_code == 404
