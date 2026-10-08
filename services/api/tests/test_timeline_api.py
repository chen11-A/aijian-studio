from pathlib import Path

import pytest
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient

HASH_A = "sha256:" + "a" * 64
HASH_B = "sha256:" + "b" * 64


@pytest.fixture
def client_and_database(tmp_path: Path) -> tuple[TestClient, Path]:
    database = tmp_path / "workspace.db"
    return TestClient(create_app(repository=StudioRepository(database))), database


def create_project(client: TestClient) -> str:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": "雾城来信",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
        },
    )
    assert response.status_code == 201
    return response.json()["data"]["id"]


def timeline_payload() -> dict[str, object]:
    return {
        "timeline_id": "episode-01-main",
        "sequence_timebase": {
            "frame_rate": {"num": 24, "den": 1},
            "timecode_mode": "NON_DROP_FRAME",
        },
        "width": 1080,
        "height": 1920,
        "assets": [
            {
                "asset_id": "shot-rain",
                "source_asset_sha256": HASH_A,
                "source_frame_count": 120,
            },
            {
                "asset_id": "shot-letter",
                "source_asset_sha256": HASH_B,
                "source_frame_count": 96,
            },
        ],
        "clips": [
            {
                "clip_id": "clip-rain",
                "asset_id": "shot-rain",
                "source_in_frame": 0,
                "duration_frames": 48,
            },
            {
                "clip_id": "clip-letter",
                "asset_id": "shot-letter",
                "source_in_frame": 12,
                "duration_frames": 36,
            },
        ],
    }


def create_timeline(client: TestClient, project_id: str) -> dict[str, object]:
    response = client.post(f"/api/v1/projects/{project_id}/timeline", json=timeline_payload())
    assert response.status_code == 201
    assert response.headers["etag"] == '"revision-1"'
    return response.json()["data"]


def test_creates_reads_and_persists_an_immutable_timeline(
    client_and_database: tuple[TestClient, Path],
) -> None:
    client, database = client_and_database
    project_id = create_project(client)
    created = create_timeline(client, project_id)

    assert created["project_id"] == project_id
    assert created["timeline"]["revision"] == 1
    assert created["total_duration_frames"] == 84
    assert str(created["version_id"]).startswith("ver_")
    assert str(created["content_hash"]).startswith("sha256:")

    restarted = TestClient(create_app(repository=StudioRepository(database)))
    fetched = restarted.get(f"/api/v1/projects/{project_id}/timeline")
    assert fetched.status_code == 200
    assert fetched.headers["etag"] == '"revision-1"'
    assert fetched.json()["data"] == created


def test_applies_trim_reorder_and_replace_as_new_versions(
    client_and_database: tuple[TestClient, Path],
) -> None:
    client, _database = client_and_database
    project_id = create_project(client)
    create_timeline(client, project_id)

    trimmed = client.post(
        f"/api/v1/projects/{project_id}/timeline/trim",
        json={
            "clip_id": "clip-rain",
            "new_source_in_frame": 4,
            "new_duration_frames": 40,
            "expected_revision": 1,
        },
    )
    assert trimmed.status_code == 200
    assert trimmed.headers["etag"] == '"revision-2"'
    assert trimmed.json()["data"]["timeline"]["clips"][0]["source_in_frame"] == 4

    reordered = client.post(
        f"/api/v1/projects/{project_id}/timeline/reorder",
        json={"clip_id": "clip-letter", "new_index": 0, "expected_revision": 2},
    )
    assert reordered.status_code == 200
    assert reordered.json()["data"]["timeline"]["clips"][0]["clip_id"] == "clip-letter"

    replaced = client.post(
        f"/api/v1/projects/{project_id}/timeline/replace",
        json={
            "clip_id": "clip-letter",
            "replacement_asset_id": "shot-rain",
            "replacement_source_in_frame": 20,
            "expected_revision": 3,
        },
    )
    assert replaced.status_code == 200
    timeline = replaced.json()["data"]["timeline"]
    assert timeline["revision"] == 4
    assert timeline["clips"][0]["asset_id"] == "shot-rain"
    assert timeline["clips"][0]["duration_frames"] == 36


def test_rejects_missing_duplicate_stale_and_invalid_timeline_commands(
    client_and_database: tuple[TestClient, Path],
) -> None:
    client, _database = client_and_database
    project_id = create_project(client)

    missing = client.get(f"/api/v1/projects/{project_id}/timeline")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "TIMELINE_NOT_FOUND"

    create_timeline(client, project_id)
    duplicate = client.post(f"/api/v1/projects/{project_id}/timeline", json=timeline_payload())
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "TIMELINE_ALREADY_EXISTS"

    stale = client.post(
        f"/api/v1/projects/{project_id}/timeline/reorder",
        json={"clip_id": "clip-rain", "new_index": 1, "expected_revision": 9},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "TIMELINE_REVISION_CONFLICT"

    invalid = client.post(
        f"/api/v1/projects/{project_id}/timeline/trim",
        json={
            "clip_id": "clip-rain",
            "new_source_in_frame": 100,
            "new_duration_frames": 40,
            "expected_revision": 1,
        },
    )
    assert invalid.status_code == 409
    assert invalid.json()["error"]["code"] == "TIMELINE_EDIT_REJECTED"

    no_op = client.post(
        f"/api/v1/projects/{project_id}/timeline/trim",
        json={
            "clip_id": "clip-rain",
            "new_source_in_frame": 0,
            "new_duration_frames": 48,
            "expected_revision": 1,
        },
    )
    assert no_op.status_code == 409
    assert no_op.json()["error"]["code"] == "TIMELINE_EDIT_REJECTED"

    unchanged = client.get(f"/api/v1/projects/{project_id}/timeline")
    assert unchanged.json()["data"]["timeline"]["revision"] == 1
    serialized = unchanged.text.lower()
    assert "workspace.sqlite" not in serialized
    assert "sidecar" not in serialized
    assert "api_key" not in serialized


def test_timeline_requests_are_strict_and_project_scoped(
    client_and_database: tuple[TestClient, Path],
) -> None:
    client, _database = client_and_database
    project_id = create_project(client)
    payload = timeline_payload()
    payload["revision"] = 99
    assert client.post(f"/api/v1/projects/{project_id}/timeline", json=payload).status_code == 422

    unknown = "prj_" + "0" * 32
    missing_project = client.post(f"/api/v1/projects/{unknown}/timeline", json=timeline_payload())
    assert missing_project.status_code == 404
    assert missing_project.json()["error"]["code"] == "PROJECT_NOT_FOUND"
