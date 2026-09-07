"""Behavior and public-contract coverage for project Episode metadata."""

import sqlite3
from pathlib import Path
from uuid import UUID

import pytest
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient

TOKEN = "e" * 43
HOST = "127.0.0.1:43128"
ORIGIN = "app://aijian"


@pytest.fixture
def client(tmp_path: Path) -> tuple[TestClient, StudioRepository]:
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    app = create_app(
        repository=repository,
        sidecar_security=SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN),
    )
    test_client = TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 50103))
    test_client.headers.update({"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN})
    return test_client, repository


def create_project(client: TestClient, *, name: str = "Episode project") -> dict[str, object]:
    response = client.post("/api/v1/projects", json={"name": name})
    assert response.status_code == 201
    return response.json()["data"]


def error_code(response, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code


def assert_response_identity(response) -> None:
    payload = response.json()
    assert response.headers["X-Request-ID"] == payload["request_id"]
    assert UUID(payload["request_id"])
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_default_episode_is_listed_and_read_as_canonical_strings(client) -> None:
    test_client, _repository = client
    project = create_project(test_client)

    listed = test_client.get(f"/api/v1/projects/{project['id']}/episodes")
    assert listed.status_code == 200
    assert_response_identity(listed)
    episode = listed.json()["data"]
    assert len(episode) == 1
    assert episode[0]["id"] == f"ep_{project['id']}"
    assert episode[0]["position"] == "1"
    assert episode[0]["revision"] == "1"
    assert episode[0]["target_duration_seconds"] == "90"
    assert episode[0]["is_default"] is True

    fetched = test_client.get(f"/api/v1/projects/{project['id']}/episodes/{episode[0]['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"] == episode[0]


def test_create_episode_preserves_null_and_reopens_from_repository(client, tmp_path: Path) -> None:
    test_client, repository = client
    project = create_project(test_client)
    created = test_client.post(
        f"/api/v1/projects/{project['id']}/episodes", json={"title": "  第二集  "}
    )
    assert created.status_code == 201
    assert created.json()["data"]["title"] == "第二集"
    assert created.json()["data"]["target_duration_seconds"] is None
    database = repository.database_path

    reopened = StudioRepository(database).get_episode(project["id"], created.json()["data"]["id"])
    assert reopened.title == "第二集"
    assert reopened.target_duration_seconds is None


@pytest.mark.parametrize("duration", ["1", "3600", "9223372036854775807", None])
def test_create_accepts_only_nullable_canonical_duration(client, duration: str | None) -> None:
    test_client, _repository = client
    project = create_project(test_client)
    payload: dict[str, object] = {"title": "Duration"}
    if duration is not None:
        payload["target_duration_seconds"] = duration
    response = test_client.post(f"/api/v1/projects/{project['id']}/episodes", json=payload)
    assert response.status_code == 201
    assert response.json()["data"]["target_duration_seconds"] == duration


@pytest.mark.parametrize(
    "value",
    [1, True, 1.0, "0", "01", "+1", " 1", "1 ", "1e1", "-1", "9223372036854775808"],
)
def test_create_rejects_noncanonical_duration_wire_values(client, value: object) -> None:
    test_client, _repository = client
    project = create_project(test_client)
    response = test_client.post(
        f"/api/v1/projects/{project['id']}/episodes",
        json={"title": "Invalid", "target_duration_seconds": value},
    )
    error_code(response, 422, "VALIDATION_ERROR")


@pytest.mark.parametrize(
    "offset",
    [True, 1.0, "00", "+0", " 0", "1e0", "-1", "9223372036854775808"],
)
def test_list_rejects_noncanonical_offset_wire_values(client, offset: object) -> None:
    test_client, _repository = client
    project = create_project(test_client)
    response = test_client.get(
        f"/api/v1/projects/{project['id']}/episodes", params={"offset": offset}
    )
    error_code(response, 422, "VALIDATION_ERROR")


def test_list_paging_order_and_project_isolation(client) -> None:
    test_client, _repository = client
    first = create_project(test_client, name="First")
    second = create_project(test_client, name="Second")
    for title in ("Two", "Three"):
        assert (
            test_client.post(
                f"/api/v1/projects/{first['id']}/episodes", json={"title": title}
            ).status_code
            == 201
        )
    assert (
        test_client.post(
            f"/api/v1/projects/{second['id']}/episodes", json={"title": "Other"}
        ).status_code
        == 201
    )

    page = test_client.get(f"/api/v1/projects/{first['id']}/episodes?limit=1&offset=1")
    assert page.status_code == 200
    assert [entry["title"] for entry in page.json()["data"]] == ["Two"]
    all_first = test_client.get(f"/api/v1/projects/{first['id']}/episodes").json()["data"]
    assert [entry["position"] for entry in all_first] == ["1", "2", "3"]
    assert {entry["title"] for entry in all_first} == {"第 1 集", "Two", "Three"}


def test_errors_are_scoped_and_foreign_episode_is_indistinguishable(client) -> None:
    test_client, _repository = client
    first = create_project(test_client, name="First")
    second = create_project(test_client, name="Second")
    foreign = test_client.get(f"/api/v1/projects/{second['id']}/episodes").json()["data"][0]["id"]
    error_code(
        test_client.get("/api/v1/projects/prj_" + "0" * 32 + "/episodes"),
        404,
        "PROJECT_NOT_FOUND",
    )
    error_code(
        test_client.get(f"/api/v1/projects/{first['id']}/episodes/{foreign}"),
        404,
        "EPISODE_NOT_FOUND",
    )
    error_code(
        test_client.get(f"/api/v1/projects/{first['id']}/episodes/invalid"), 422, "VALIDATION_ERROR"
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"title": ""},
        {"title": "x" * 81},
        {"title": "bad\nname"},
        {"title": "Good", "position": "2"},
        {"title": "Good", "unknown": True},
    ],
)
def test_create_rejects_invalid_title_and_extra_fields(client, payload: dict[str, object]) -> None:
    test_client, _repository = client
    project = create_project(test_client)
    error_code(
        test_client.post(f"/api/v1/projects/{project['id']}/episodes", json=payload),
        422,
        "VALIDATION_ERROR",
    )


def test_security_and_get_nonmutation(client) -> None:
    test_client, repository = client
    project = create_project(test_client)
    database = repository.database_path
    before = sqlite3.connect(database).execute("SELECT * FROM episodes").fetchall()
    listed = test_client.get(f"/api/v1/projects/{project['id']}/episodes")
    fetched = test_client.get(
        f"/api/v1/projects/{project['id']}/episodes/{listed.json()['data'][0]['id']}"
    )
    after = sqlite3.connect(database).execute("SELECT * FROM episodes").fetchall()
    assert listed.status_code == fetched.status_code == 200
    assert before == after
    error_code(
        test_client.get(
            f"/api/v1/projects/{project['id']}/episodes", headers={"Authorization": ""}
        ),
        401,
        "SIDECAR_AUTH_REQUIRED",
    )


def test_storage_fault_is_sanitized(client, monkeypatch) -> None:
    test_client, repository = client
    project = create_project(test_client)

    def fail(*_args, **_kwargs):
        raise sqlite3.OperationalError("C:/secret/workspace.sqlite3")

    monkeypatch.setattr(repository, "list_episodes", fail)
    response = test_client.get(f"/api/v1/projects/{project['id']}/episodes")
    error_code(response, 500, "EPISODE_STORAGE_FAILED")
    assert "workspace.sqlite3" not in response.text


def test_existing_project_api_remains_compatible(client) -> None:
    test_client, _repository = client
    project = create_project(test_client)
    response = test_client.get(f"/api/v1/projects/{project['id']}")
    assert response.status_code == 200
    assert isinstance(response.json()["data"]["target_duration_seconds"], int)
