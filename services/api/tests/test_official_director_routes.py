"""Real sidecar/authentication boundary; ordinary API cannot accept model claims."""

from uuid import uuid4

from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_official_director_workflow import prepared_case


def client_for(repository):
    app = create_app(
        repository=repository,
        sidecar_security=SidecarSecurity(
            token="d" * 43, host="127.0.0.1:43127", origin="app://aijian"
        ),
    )
    client = TestClient(app, base_url="http://127.0.0.1:43127", client=("127.0.0.1", 50102))
    client.headers.update({"Authorization": "Bearer " + "d" * 43, "Origin": "app://aijian"})
    return client


def test_prepare_reserve_complete_review_adopt_routes_use_exact_server_truth(tmp_path):
    repository, project, episode, _, prepare, _, reserve, content, completion = prepared_case(
        tmp_path
    )
    client = client_for(repository)
    root = f"/api/v1/projects/{project}/episodes/{episode}/official-director"
    ready = client.post(root + "/preparation", json=prepare.model_dump(mode="json"))
    assert (
        ready.status_code == 200
        and ready.json()["data"]["request"]["request_hash"] == reserve.request_hash
    )
    reserved = client.post(root, json=reserve.model_dump(mode="json"))
    assert reserved.status_code == 200 and not reserved.json()["data"]["replayed"]
    operation = reserve.operation_id
    assert client.get(root + "/" + operation).json()["data"]["status"] == "REMOTE_UNKNOWN"
    done = client.post(root + f"/{operation}/completion", json=completion.model_dump(mode="json"))
    assert done.status_code == 200
    proposal = done.json()["data"]["operation"]["proposal"]
    assert proposal["content"] == content
    assert client.get(root).json()["data"][0]["completion"]["response_id"] == completion.response_id
    payload = {
        "proposal_version_id": proposal["version_id"],
        "proposal_content_hash": proposal["content_hash"],
        "confirm": True,
    }
    assert (
        client.post(root + f"/{operation}/adoption", json={**payload, "confirm": 1}).status_code
        == 422
    )
    adopted = client.post(root + f"/{operation}/adoption", json=payload)
    assert (
        adopted.status_code == 200 and adopted.json()["data"]["operation"]["adoption"] is not None
    )
    assert (
        client.post(
            root + f"/{operation}/rejection", json={**payload, "reason": "too late"}
        ).status_code
        == 409
    )


def test_auth_origin_host_client_and_forged_prompt_or_result_fail_before_reservation(tmp_path):
    repository, project, episode, _, prepare, _, reserve, _, completion = prepared_case(tmp_path)
    root = f"/api/v1/projects/{project}/episodes/{episode}/official-director"
    client = client_for(repository)
    client.headers.pop("Authorization")
    assert client.post(root, json=reserve.model_dump(mode="json")).status_code == 401
    client.headers["Authorization"] = "Bearer incorrect"
    assert client.post(root, json=reserve.model_dump(mode="json")).status_code == 401
    client.headers["Authorization"] = "Bearer " + "d" * 43
    client.headers["Origin"] = "https://hostile.invalid"
    assert client.post(root, json=reserve.model_dump(mode="json")).status_code == 403
    client.headers["Origin"] = "app://aijian"
    assert (
        client.post(
            root, json=reserve.model_dump(mode="json"), headers={"Host": "localhost:43127"}
        ).status_code
        == 403
    )
    forged = {**reserve.model_dump(mode="json"), "input_text": "renderer supplied prompt"}
    assert client.post(root, json=forged).status_code == 422
    forged = {**reserve.model_dump(mode="json"), "result": completion.model_dump(mode="json")}
    assert client.post(root, json=forged).status_code == 422
    forged = {**prepare.model_dump(mode="json"), "content": {"provenance": "AI"}}
    assert client.post(root + "/preparation", json=forged).status_code == 422
    assert client.get(root).json()["data"] == []
    unknown = str(uuid4())
    assert (
        client.post(
            root + f"/{unknown}/completion", json=completion.model_dump(mode="json")
        ).status_code
        == 422
    )


def test_non_sidecar_api_has_reads_but_no_generation_completion_or_adoption_capability(tmp_path):
    repository, project, episode, *_ = prepared_case(tmp_path)
    client = TestClient(create_app(repository=repository))
    root = f"/api/v1/projects/{project}/episodes/{episode}/official-director"
    assert client.get(root).status_code == 200
    for path in [
        "",
        "/preparation",
        f"/{uuid4()}/completion",
        f"/{uuid4()}/not-sent",
        f"/{uuid4()}/adoption",
        f"/{uuid4()}/rejection",
    ]:
        assert client.post(root + path, json={}).status_code in {404, 405}
    paths = client.app.openapi()["paths"]
    path = "/api/v1/projects/{project_id}/episodes/{episode_id}/official-director"
    assert "post" not in paths[path]


def test_read_scope_preparation_errors_and_not_sent_endpoint_return_stable_truth(tmp_path):
    repository, project, episode, _, prepare, _, reserve, _, _ = prepared_case(tmp_path)
    client = client_for(repository)
    root = f"/api/v1/projects/{project}/episodes/{episode}/official-director"
    missing = str(uuid4())
    assert client.get(root + "/" + missing).status_code == 404
    absent = f"/api/v1/projects/{'prj_' + '0' * 32}/episodes/{episode}/official-director"
    assert client.get(absent).status_code == 404
    malformed = prepare.model_dump(mode="json")
    malformed["authority"]["script"]["content_hash"] = "sha256:" + "0" * 64
    assert client.post(root + "/preparation", json=malformed).status_code == 422
    client.post(root, json=reserve.model_dump(mode="json"))
    not_sent = client.post(
        root + f"/{reserve.operation_id}/not-sent", json={"code": "USER_CANCELLED"}
    )
    assert not_sent.status_code == 200
    assert not_sent.json()["data"]["operation"]["attempt_status"] == "NOT_SUBMITTED"
    recent = client.get(root)
    assert recent.json()["has_more"] is False and len(recent.json()["data"]) == 1
