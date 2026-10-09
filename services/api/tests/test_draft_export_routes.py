"""Native authentication, episode identity and terminal receipt route coverage."""

from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_draft_export_runtime import fixture, request_for, runtime_for, wait_final

TOKEN = "d" * 43
HOST = "127.0.0.1:43123"


def test_draft_route_is_native_authenticated_scoped_and_durable(tmp_path):
    repository, project, episode, _asset, assembly = fixture(tmp_path)
    runtime = runtime_for(repository)
    app = create_app(
        repository=repository,
        draft_export_runtime=runtime,
        sidecar_security=SidecarSecurity(token=TOKEN, host=HOST),
    )
    path = f"/api/v1/projects/{project}/episodes/{episode}/draft-exports"
    request = request_for(assembly, tmp_path / "API-DRAFT.mp4")
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 1234)) as client:
        assert client.post(path, json=request.model_dump()).status_code == 401
        headers = {"Authorization": f"Bearer {TOKEN}", "Origin": "app://aijian"}
        assert (
            client.post(
                path,
                json=request.model_dump(),
                headers={**headers, "Origin": "https://evil.example"},
            ).status_code
            == 403
        )
        payload = request.model_dump(exclude={"rights_declaration"})
        assert client.post(path, json=payload, headers=headers).status_code == 422
        submitted = client.post(path, json=request.model_dump(), headers=headers)
        assert submitted.status_code == 202, submitted.text
        assert submitted.json()["data"]["output_path"] is None
        result = wait_final(runtime, project, episode, request.operation_id)
        assert result.status == "SUCCEEDED", result
        assert (
            client.get(path + "/" + request.operation_id, headers=headers).json()["data"][
                "output_sha256"
            ]
            == result.output_sha256
        )
        assert client.get(path, headers=headers).json()["data"]["items"][0]["draft"] is True
        second = repository.create_episode(project, title="Other episode")
        wrong = path.replace(episode, second.id)
        missing = client.get(wrong + "/" + request.operation_id, headers=headers)
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "DRAFT_EXPORT_NOT_FOUND"
        cancel_done = client.post(
            path + "/" + request.operation_id + "/cancellations", headers=headers
        )
        assert cancel_done.json()["data"]["status"] == "SUCCEEDED"
    runtime.join_workers()


def test_public_api_has_no_draft_filesystem_write_route(tmp_path):
    repository, project, episode, _asset, assembly = fixture(tmp_path)
    app = create_app(repository=repository)
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/projects/{project}/episodes/{episode}/draft-exports",
            json=request_for(assembly, tmp_path / "PUBLIC.mp4").model_dump(),
        )
        assert response.status_code == 404
    assert not (tmp_path / "PUBLIC.mp4").exists()
