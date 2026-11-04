"""In-process HTTP and real temporary storage; PNG headers are not decoded images."""

import hashlib
from unittest.mock import Mock
from urllib.parse import quote

import pytest
from aijian_api import media_asset_routes as routes
from aijian_api.media_asset_store import MediaAssetError
from test_proposal_run_create_api import sidecar_client

PNG = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR" + (2).to_bytes(4, "big") * 2 + b"synthetic"


@pytest.fixture
def client_data(tmp_path):
    client, repository = sidecar_client(tmp_path)
    project = repository.create_project(
        name="Media HTTP", aspect_ratio="9:16", target_duration_seconds=10, source_language="zh-CN"
    )
    episode = repository.list_episodes(project.id)[0].id
    return client, repository, project.id, episode


def upload(client, project, *, asset=None, body=PNG, headers=None):
    path = f"/api/v1/projects/{project}/assets/" + (
        f"{asset}/versions/import" if asset else "import"
    )
    return client.post(
        path,
        content=body,
        headers={
            "Content-Type": "application/octet-stream",
            "X-Aivora-Filename": quote("图片.png"),
            **(headers or {}),
        },
    )


def test_media_http_lifecycle_preserves_versions_and_binary_read_headers(client_data):
    client, repository, project, episode = client_data
    imported = upload(client, project)
    assert imported.status_code == 201
    asset = imported.json()["data"]
    asset_id, version = asset["id"], asset["latest_version"]["id"]
    assert asset["latest_version"]["filename"] == "图片.png"
    assert asset["latest_version"]["technical_metadata"]["inspection_status"] == "HEADER_ONLY"
    base = f"/api/v1/projects/{project}/assets/{asset_id}"
    listed = client.get(f"/api/v1/projects/{project}/assets")
    assert listed.status_code == 200 and [item["id"] for item in listed.json()["data"]] == [
        asset_id
    ]
    got = client.get(base)
    assert (
        got.status_code == 200
        and got.json()["data"]["latest_version"]["availability"] == "VERIFIED"
    )
    content = client.get(base + f"/versions/{version}/content")
    assert content.status_code == 200 and content.content == PNG
    assert content.headers["cache-control"] == "no-store"
    assert content.headers["x-content-type-options"] == "nosniff"
    assert content.headers["etag"] == f'"sha256-{hashlib.sha256(PNG).hexdigest()}"'
    revised = upload(client, project, asset=asset_id, body=PNG + b"second")
    assert revised.status_code == 201
    assert [item["ordinal"] for item in revised.json()["data"]["versions"]] == [2, 1]
    assert client.get(base + f"/versions/{version}/content").content == PNG
    reference = {"episode_id": episode, "version_id": version, "role": "reference"}
    assert client.post(base + "/episode-references", json=reference).status_code == 200
    assert client.delete(base).status_code == 409
    assert (
        client.delete(
            base + f"/episode-references/{episode}", params={"role": "reference"}
        ).status_code
        == 200
    )
    assert client.delete(base).status_code == 204
    assert client.get(base).status_code == 404
    assert client.get(f"/api/v1/projects/{project}/assets").json()["data"] == []
    assert list((repository.database_path.parent / "media-assets" / "staging").iterdir()) == []


@pytest.mark.parametrize(
    ("case", "status", "code"),
    [
        ("type", 415, "UNSUPPORTED_MEDIA"),
        ("long_name", 400, "INVALID_FILENAME"),
        ("bad_encoding", 400, "INVALID_FILENAME"),
        ("empty", 413, "SOURCE_SIZE"),
        ("unsupported", 415, "UNSUPPORTED_MEDIA"),
        ("too_large", 413, "SOURCE_SIZE"),
        ("unknown_project", 404, "PROJECT_NOT_FOUND"),
        ("unknown_asset", 404, "ASSET_NOT_FOUND"),
        ("bad_asset", 400, "INVALID_ASSET_ID"),
    ],
)
def test_import_rejection_leaves_no_asset_and_no_incoming_file(
    client_data, monkeypatch, case, status, code
):
    client, repository, project, _ = client_data
    kwargs = {}
    if case == "type":
        kwargs["headers"] = {"Content-Type": "application/json"}
    elif case == "long_name":
        kwargs["headers"] = {"X-Aivora-Filename": "x" * 1025}
    elif case == "bad_encoding":
        kwargs["headers"] = {"X-Aivora-Filename": "%ff"}
    elif case == "empty":
        kwargs["body"] = b""
    elif case == "unsupported":
        kwargs["body"] = b"synthetic not media"
    elif case == "too_large":
        monkeypatch.setattr(routes, "MAX_MEDIA_INPUT_BYTES", 5)
    elif case == "unknown_project":
        project = "prj_" + "f" * 32
    elif case == "unknown_asset":
        kwargs["asset"] = "asset_" + "f" * 32
    else:
        kwargs["asset"] = "bad"
    result = upload(client, project, **kwargs)
    assert result.status_code == status
    assert result.json()["error"]["code"] == code
    assert result.json()["error"]["retryable"] is False
    with repository._connection() as connection:
        assert connection.execute("SELECT count(*) FROM media_assets").fetchone()[0] == 0
    staging = repository.database_path.parent / "media-assets" / "staging"
    assert not staging.exists() or list(staging.iterdir()) == []


def test_missing_filename_header_is_a_bounded_client_error(client_data):
    client, _, project, _ = client_data
    result = client.post(
        f"/api/v1/projects/{project}/assets/import",
        content=PNG,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert result.status_code == 400
    assert result.json()["error"]["code"] == "INVALID_FILENAME"


@pytest.mark.parametrize(
    ("method", "action", "path"),
    [
        ("list_assets", "get", ""),
        ("get_asset", "get", "/asset_{asset}"),
        ("read_verified_preview", "get", "/asset_{asset}/versions/asv_{version}/content"),
        ("add_episode_reference", "post", "/asset_{asset}/episode-references"),
        (
            "remove_episode_reference",
            "delete",
            "/asset_{asset}/episode-references/{episode}?role=reference",
        ),
        ("soft_delete", "delete", "/asset_{asset}"),
    ],
)
@pytest.mark.parametrize(("code", "status"), [("MEDIA_CORRUPT", 409), ("UNSAFE_STORAGE", 500)])
def test_storage_failures_are_typed_and_internal_details_redacted(
    client_data, monkeypatch, method, action, path, code, status
):
    client, _, project, episode = client_data
    service = Mock()
    getattr(service, method).side_effect = MediaAssetError(
        code, "synthetic private filesystem detail"
    )
    monkeypatch.setattr(routes, "MediaAssetStore", Mock(return_value=service))
    url = f"/api/v1/projects/{project}/assets" + path.format(
        asset="a" * 32, version="b" * 32, episode=episode
    )
    kwargs = (
        {"json": {"episode_id": episode, "version_id": "asv_" + "b" * 32, "role": "reference"}}
        if action == "post"
        else {}
    )
    result = getattr(client, action)(url, **kwargs)
    assert result.status_code == status
    assert result.json()["error"]["code"] == code
    assert result.json()["error"]["retryable"] is False
    if status == 500:
        assert "synthetic private filesystem detail" not in result.text
    getattr(service, method).assert_called_once()
