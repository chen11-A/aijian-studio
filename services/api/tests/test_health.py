from uuid import UUID, uuid4

from aijian_api.main import create_app
from fastapi.testclient import TestClient


def test_health_returns_versioned_contract_and_request_id() -> None:
    client = TestClient(create_app())

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"] == {
        "status": "ok",
        "service": "aijian-api",
        "version": "0.1.0",
    }
    assert UUID(payload["request_id"])
    assert response.headers["X-Request-ID"] == payload["request_id"]


def test_health_preserves_a_valid_request_id() -> None:
    client = TestClient(create_app())
    request_id = str(uuid4())

    response = client.get("/api/v1/health", headers={"X-Request-ID": request_id})

    assert response.status_code == 200
    assert response.json()["request_id"] == request_id
    assert response.headers["X-Request-ID"] == request_id


def test_health_replaces_an_invalid_request_id() -> None:
    client = TestClient(create_app())

    response = client.get("/api/v1/health", headers={"X-Request-ID": "not-a-uuid"})

    assert response.status_code == 200
    request_id = response.json()["request_id"]
    assert UUID(request_id)
    assert request_id != "not-a-uuid"


def test_health_contract_is_published_in_openapi() -> None:
    schema = create_app().openapi()

    operation = schema["paths"]["/api/v1/health"]["get"]
    response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert response_schema["$ref"] == "#/components/schemas/HealthResponse"
