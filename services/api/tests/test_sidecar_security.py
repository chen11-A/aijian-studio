from uuid import UUID

import pytest
from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from httpx2 import Response

TOKEN = "x" * 43
HOST = "127.0.0.1:43123"
ORIGIN = "app://aijian"


def protected_client(*, client_host: str = "127.0.0.1") -> TestClient:
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    return TestClient(
        create_app(sidecar_security=security),
        base_url=f"http://{HOST}",
        client=(client_host, 50100),
    )


def valid_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Host": HOST,
    }


def assert_safe_error(response: Response, expected_status: int, expected_code: str) -> None:
    assert response.status_code == expected_status
    payload = response.json()
    assert payload["error"]["code"] == expected_code
    assert payload["error"]["retryable"] is False
    assert TOKEN not in response.text
    assert UUID(payload["request_id"])
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_protected_health_accepts_only_the_complete_sidecar_session() -> None:
    response = protected_client().get("/api/v1/health", headers=valid_headers())

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "ok"
    assert response.headers["Cache-Control"] == "no-store"
    assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.parametrize(
    "authorization",
    [None, "Bearer wrong-token", "Basic eDp4", "Bearer"],
)
def test_protected_health_rejects_missing_or_wrong_tokens(authorization: str | None) -> None:
    headers = valid_headers()
    if authorization is None:
        del headers["Authorization"]
    else:
        headers["Authorization"] = authorization

    response = protected_client().get("/api/v1/health", headers=headers)

    assert_safe_error(response, 401, "SIDECAR_AUTH_REQUIRED")


@pytest.mark.parametrize(
    ("header", "value"),
    [
        ("Origin", "http://127.0.0.1:5173"),
        ("Origin", "null"),
        ("Host", "127.0.0.1:8000"),
        ("Host", "localhost:43123"),
    ],
)
def test_protected_health_rejects_wrong_origin_or_host(header: str, value: str) -> None:
    headers = valid_headers()
    headers[header] = value

    response = protected_client().get("/api/v1/health", headers=headers)

    assert_safe_error(response, 403, "SIDECAR_REQUEST_REJECTED")


def test_protected_health_rejects_non_loopback_clients() -> None:
    response = protected_client(client_host="10.20.30.40").get(
        "/api/v1/health",
        headers=valid_headers(),
    )

    assert_safe_error(response, 403, "SIDECAR_REQUEST_REJECTED")


@pytest.mark.parametrize(
    ("token", "host", "origin"),
    [
        ("short", HOST, ORIGIN),
        (TOKEN, "localhost:43123", ORIGIN),
        (TOKEN, "127.0.0.1", ORIGIN),
        (TOKEN, HOST, "http://127.0.0.1:5173"),
    ],
)
def test_sidecar_security_rejects_weak_or_noncanonical_configuration(
    token: str,
    host: str,
    origin: str,
) -> None:
    with pytest.raises(ValueError):
        SidecarSecurity(token=token, host=host, origin=origin)
