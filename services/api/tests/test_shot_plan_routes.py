"""Real authenticated FastAPI boundary for manual plans; no provider request exists."""

from uuid import uuid4

from aijian_api.domain import TrustedReviewActor
from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from aijian_api.shot_plan_proposal_store import ShotPlanProposalStore
from aijian_api.shot_plan_routes import (
    create_shot_plan_public_router,
    create_shot_plan_write_router,
)
from fastapi.testclient import TestClient
from test_shot_plan_proposals import request, setup


def client_for(repository):
    security = SidecarSecurity(token="p" * 43, host="127.0.0.1:43127", origin="app://aijian")
    app = create_app(repository=repository, sidecar_security=security)
    # Parent owns registration. Register only these new factories on the real boundary.
    if not any(path.endswith("/shot-plan-proposals/human") for path in app.openapi()["paths"]):
        app.include_router(create_shot_plan_public_router(lambda: repository))
        app.include_router(
            create_shot_plan_write_router(
                lambda: repository, TrustedReviewActor("local-user", ("writer", "producer"))
            )
        )
    client = TestClient(app, base_url="http://127.0.0.1:43127", client=("127.0.0.1", 50102))
    client.headers.update({"Authorization": "Bearer " + "p" * 43, "Origin": "app://aijian"})
    return client


def test_preparation_human_create_review_adopt_and_read_only_recovery(tmp_path):
    repository, project, episode = setup(tmp_path)
    client = client_for(repository)
    base = f"/api/v1/projects/{project}/episodes/{episode}/shot-plan-proposals"
    ready = client.get(base + "/preparation")
    assert ready.status_code == 200
    assert ready.json()["data"]["generation_status"] == "UNAVAILABLE"
    assert ready.json()["data"]["authority"]["mode"] == "ORIGINAL"
    assert client.get(base).status_code == 404
    operation = str(uuid4())
    empty_receipt = client.get(base + f"/human-operations/{operation}")
    assert empty_receipt.status_code == 200 and empty_receipt.json()["data"]["proposal"] is None
    candidate = request(ShotPlanProposalStore(repository), project, episode, 11).model_dump(
        mode="json"
    )
    created = client.post(base + "/human", json=candidate, headers={"Idempotency-Key": operation})
    assert created.status_code == 201
    data = created.json()["data"]["proposal"]
    assert data["generation_status"] == "UNAVAILABLE" and data["content"]["provenance"] == "HUMAN"
    assert len(data["content"]["shots"]) == 11
    version = data["version_id"]
    assert client.get(base + f"/versions/{version}").json()["data"] == data
    assert client.get(base + f"/human-operations/{operation}").json()["data"]["proposal"] == data
    # Multiple read-only uncertainty checks do not replay an adoption mutation.
    for _ in range(3):
        status = client.get(base + f"/versions/{version}/adoption")
        assert status.status_code == 200 and status.json()["data"]["adoption"] is None
    assert (
        client.post(
            base + f"/versions/{version}/adopt",
            json={
                "proposal_content_hash": data["content_hash"],
                "confirm": 1,
            },
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 422
    )
    adopted = client.post(
        base + f"/versions/{version}/adopt",
        json={
            "proposal_content_hash": data["content_hash"],
            "confirm": True,
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert adopted.status_code == 200 and not adopted.json()["data"]["replayed"]
    adoption = adopted.json()["data"]["proposal"]["adoption"]
    assert client.get(base + f"/versions/{version}/adoption").json()["data"]["adoption"] == adoption
    assert client.get(base).json()["data"]["adoption"] == adoption
    assert (
        client.post(base + "/complete", json={"model": "fake", "text": "pretend"}).status_code
        == 404
    )


def test_route_auth_origin_provenance_and_key_gates_reject_before_mutation(tmp_path):
    repository, project, episode = setup(tmp_path)
    client = client_for(repository)
    base = f"/api/v1/projects/{project}/episodes/{episode}/shot-plan-proposals"
    value = request(ShotPlanProposalStore(repository), project, episode).model_dump(mode="json")
    assert client.post(base + "/human", json=value).status_code == 428
    client.headers.pop("Authorization")
    assert (
        client.post(base + "/human", json=value, headers={"Idempotency-Key": "blocked"}).status_code
        == 401
    )
    client.headers["Authorization"] = "Bearer " + "p" * 43
    client.headers["Origin"] = "https://hostile.invalid"
    assert (
        client.post(base + "/human", json=value, headers={"Idempotency-Key": "blocked"}).status_code
        == 403
    )
    client.headers["Origin"] = "app://aijian"
    value["content"]["provenance"] = "AI"
    assert (
        client.post(base + "/human", json=value, headers={"Idempotency-Key": "fake-ai"}).status_code
        == 422
    )
    assert client.get(base).status_code == 404
    assert client.get(base + "/human-operations/invalid").status_code == 422


def test_noncanonical_keys_reject_before_write_and_valid_uuid_recovers(tmp_path):
    import sqlite3
    from uuid import uuid1

    repository, project, episode = setup(tmp_path)
    client = client_for(repository)
    base = f"/api/v1/projects/{project}/episodes/{episode}/shot-plan-proposals"
    candidate = request(ShotPlanProposalStore(repository), project, episode).model_dump(mode="json")
    canonical = str(uuid4())
    invalid_keys = [
        "manual-plan",
        str(uuid1()),
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        canonical + " ",
        " " + canonical,
        canonical + "x",
    ]
    for key in invalid_keys:
        response = client.post(base + "/human", json=candidate, headers={"Idempotency-Key": key})
        assert response.status_code == 422
        with sqlite3.connect(repository.database_path) as connection:
            assert (
                connection.execute("SELECT count(*) FROM shot_plan_write_requests").fetchone()[0]
                == 0
            )
            assert not connection.execute(
                "SELECT 1 FROM artifacts WHERE artifact_type = 'shot_plan_proposal'"
            ).fetchone()

    # Simulate lost POST acknowledgement; recover only via the original UUID status read.
    submitted = client.post(base + "/human", json=candidate, headers={"Idempotency-Key": canonical})
    assert submitted.status_code == 201
    recovered = client.get(base + f"/human-operations/{canonical}")
    assert recovered.status_code == 200
    proposal = recovered.json()["data"]["proposal"]
    assert proposal is not None and proposal["content"] == candidate["content"]
    assert (
        client.get(base + f"/human-operations/{canonical}").json()["data"]["proposal"] == proposal
    )
    with sqlite3.connect(repository.database_path) as connection:
        assert (
            connection.execute("SELECT count(*) FROM shot_plan_write_requests").fetchone()[0] == 1
        )

    adopt_payload = {"proposal_content_hash": proposal["content_hash"], "confirm": True}
    version = proposal["version_id"]
    for key in invalid_keys:
        response = client.post(
            base + f"/versions/{version}/adopt",
            json=adopt_payload,
            headers={"Idempotency-Key": key},
        )
        assert response.status_code == 422
        with sqlite3.connect(repository.database_path) as connection:
            assert connection.execute("SELECT count(*) FROM shot_plan_adoptions").fetchone()[0] == 0
            assert (
                connection.execute("SELECT count(*) FROM shot_plan_adoption_requests").fetchone()[0]
                == 0
            )
            assert not connection.execute(
                "SELECT 1 FROM artifacts WHERE artifact_type = 'episode_storyboard'"
            ).fetchone()
    assert (
        client.post(
            base + f"/versions/{version}/adopt",
            json=adopt_payload,
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 200
    )
    first_status = client.get(base + f"/versions/{version}/adoption").json()["data"]
    assert first_status["adoption"] is not None
    assert client.get(base + f"/versions/{version}/adoption").json()["data"] == first_status
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT count(*) FROM shot_plan_adoptions").fetchone()[0] == 1
        assert (
            connection.execute("SELECT count(*) FROM shot_plan_adoption_requests").fetchone()[0]
            == 1
        )
