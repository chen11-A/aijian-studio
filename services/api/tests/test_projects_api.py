import base64
import hashlib
from pathlib import Path

import pytest
from aijian_api import main
from aijian_api.ingestion import SourceValidationError
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(repository=StudioRepository(tmp_path / "workspace.db")))


def create_project(client: TestClient, name: str = "  雾城来信  ") -> dict[str, object]:
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
    return response.json()["data"]


def source_payload(text: str = "第一章 初见\n雨落在霓虹灯下😀") -> dict[str, str]:
    return {
        "filename": "雾城来信.txt",
        "media_type": "text/plain",
        "content_base64": base64.b64encode(text.encode()).decode("ascii"),
    }


def test_creates_lists_and_gets_a_typed_project(client: TestClient) -> None:
    project = create_project(client)

    assert str(project["id"]).startswith("prj_")
    assert project["name"] == "雾城来信"
    assert project["aspect_ratio"] == "9:16"
    assert project["target_duration_seconds"] == 90
    assert project["status"] == "active"
    assert project["revision"] == 1

    listed = client.get("/api/v1/projects")
    fetched = client.get(f"/api/v1/projects/{project['id']}")

    assert listed.status_code == 200
    assert listed.json()["data"] == [project]
    assert fetched.status_code == 200
    assert fetched.json()["data"] == project


def test_creates_a_landscape_project_with_extended_duration(client: TestClient) -> None:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": "横屏漫剧",
            "aspect_ratio": "16:9",
            "target_duration_seconds": 900,
            "source_language": "zh-CN",
        },
    )

    assert response.status_code == 201
    project = response.json()["data"]
    assert project["aspect_ratio"] == "16:9"
    assert project["target_duration_seconds"] == 900

    listed = client.get("/api/v1/projects")
    fetched = client.get(f"/api/v1/projects/{project['id']}")

    assert listed.status_code == 200
    assert listed.json()["data"] == [project]
    assert fetched.status_code == 200
    assert fetched.json()["data"] == project


@pytest.mark.parametrize("aspect_ratio", ["4:5", "1:1", "4:3"])
def test_creates_projects_in_additional_aspect_ratios(
    client: TestClient, aspect_ratio: str
) -> None:
    response = client.post(
        "/api/v1/projects",
        json={
            "name": f"{aspect_ratio} 项目",
            "aspect_ratio": aspect_ratio,
            "target_duration_seconds": 900,
            "source_language": "zh-CN",
        },
    )

    assert response.status_code == 201
    assert response.json()["data"]["aspect_ratio"] == aspect_ratio
    assert response.json()["data"]["target_duration_seconds"] == 900


def test_imports_original_bytes_and_returns_traceable_blocks(client: TestClient) -> None:
    project = create_project(client)

    response = client.post(
        f"/api/v1/projects/{project['id']}/sources",
        json=source_payload(),
    )

    assert response.status_code == 201
    document = response.json()["data"]
    assert document["filename"] == "雾城来信.txt"
    assert document["media_type"] == "text/plain"
    assert document["encoding"] == "utf-8"
    assert document["chapter_count"] == 1
    assert document["block_count"] == 2
    assert [block["kind"] for block in document["blocks"]] == [
        "chapter_heading",
        "paragraph",
    ]
    assert all(
        block["normalized_end_byte"] > block["normalized_start_byte"]
        for block in document["blocks"]
    )

    listed = client.get(f"/api/v1/projects/{project['id']}/sources")
    fetched = client.get(f"/api/v1/projects/{project['id']}/sources/{document['id']}")
    assert listed.status_code == 200
    assert listed.json()["data"] == [
        {key: value for key, value in document.items() if key != "blocks"}
    ]
    assert fetched.status_code == 200
    assert fetched.json()["data"] == document


def test_source_manifest_is_typed_versioned_and_exposes_head_etag(client: TestClient) -> None:
    project = create_project(client)
    missing = client.get(f"/api/v1/projects/{project['id']}/source-manifest")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SOURCE_MANIFEST_NOT_FOUND"

    first_text = "第一章 初见\n雨落在霓虹灯下😀"
    first_import = client.post(
        f"/api/v1/projects/{project['id']}/sources",
        json=source_payload(first_text),
    )
    assert first_import.status_code == 201
    first_source = first_import.json()["data"]
    first_manifest = client.get(f"/api/v1/projects/{project['id']}/source-manifest")

    assert first_manifest.status_code == 200
    assert first_manifest.headers["etag"] == '"revision-1"'
    first_data = first_manifest.json()["data"]
    assert first_data["head"]["latest_version_id"] == first_data["latest_version"]["id"]
    assert first_data["head"]["accepted_version_id"] is None
    assert first_data["latest_version"]["version_number"] == 1
    document = first_data["latest_version"]["content"]["documents"][0]
    assert document["source_document_id"] == first_source["id"]
    assert document["normalized_sha256"] == hashlib.sha256(first_text.encode()).hexdigest()
    assert [block["source_block_id"] for block in document["blocks"]] == [
        block["id"] for block in first_source["blocks"]
    ]

    second_import = client.post(
        f"/api/v1/projects/{project['id']}/sources",
        json={**source_payload("第二章 重逢\n她回到旧车站"), "filename": "第二章.txt"},
    )
    assert second_import.status_code == 201
    second_manifest = client.get(f"/api/v1/projects/{project['id']}/source-manifest")
    second_data = second_manifest.json()["data"]
    assert second_manifest.headers["etag"] == '"revision-2"'
    assert second_data["latest_version"]["version_number"] == 2
    assert second_data["latest_version"]["parent_version_id"] == first_data["latest_version"]["id"]
    assert len(second_data["latest_version"]["content"]["documents"]) == 2


def test_returns_stable_safe_errors_for_project_and_source_failures(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing = client.get("/api/v1/projects/prj_missing")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PROJECT_NOT_FOUND"

    project = create_project(client)
    first = client.post(f"/api/v1/projects/{project['id']}/sources", json=source_payload())
    duplicate = client.post(f"/api/v1/projects/{project['id']}/sources", json=source_payload())
    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "SOURCE_ALREADY_IMPORTED"
    assert source_payload()["content_base64"] not in duplicate.text

    invalid = client.post(
        f"/api/v1/projects/{project['id']}/sources",
        json={**source_payload(), "filename": "story.md"},
    )
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "INVALID_SOURCE_FILE"

    monkeypatch.setattr(
        main,
        "ingest_text_file",
        lambda **_kwargs: (_ for _ in ()).throw(SourceValidationError("SOURCE_TOO_LARGE")),
    )
    too_large = client.post(
        f"/api/v1/projects/{project['id']}/sources",
        json={**source_payload("different"), "filename": "large.txt"},
    )
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "SOURCE_TOO_LARGE"


@pytest.mark.parametrize(
    "payload",
    [
        {
            "name": "   ",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
        },
        {
            "name": "项目",
            "aspect_ratio": "2:1",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
        },
        {
            "name": "项目",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 901,
            "source_language": "zh-CN",
        },
        {
            "name": "项目",
            "aspect_ratio": "9:16",
            "target_duration_seconds": 90,
            "source_language": "zh-CN",
            "unexpected": True,
        },
    ],
)
def test_validation_errors_use_the_public_error_envelope(
    client: TestClient,
    payload: dict[str, object],
) -> None:
    response = client.post("/api/v1/projects", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"] == {}


def test_rejects_malformed_base64_without_echoing_it(client: TestClient) -> None:
    project = create_project(client)
    rejected = "not-valid-base64!!"

    response = client.post(
        f"/api/v1/projects/{project['id']}/sources",
        json={**source_payload(), "content_base64": rejected},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert rejected not in response.text


def test_project_and_source_contracts_are_published_in_openapi(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()

    assert schema["paths"]["/api/v1/projects"]["post"]["operationId"] == "createProject"
    assert schema["paths"]["/api/v1/projects"]["get"]["operationId"] == "listProjects"
    import_operation = schema["paths"]["/api/v1/projects/{project_id}/sources"]["post"]
    assert import_operation["operationId"] == "importTextSource"
    assert (
        import_operation["responses"]["201"]["content"]["application/json"]["schema"]["$ref"]
        == "#/components/schemas/SourceDocumentResponse"
    )
    for status_code in ("400", "404", "409", "413", "422"):
        assert (
            import_operation["responses"][status_code]["content"]["application/json"]["schema"][
                "$ref"
            ]
            == "#/components/schemas/ErrorResponse"
        )
    assert (
        schema["paths"]["/api/v1/projects/{project_id}/sources"]["get"]["operationId"]
        == "listSources"
    )
    assert (
        schema["paths"]["/api/v1/projects/{project_id}/sources/{source_id}"]["get"]["operationId"]
        == "getSource"
    )
    manifest_operation = schema["paths"]["/api/v1/projects/{project_id}/source-manifest"]["get"]
    assert manifest_operation["operationId"] == "getSourceManifest"
    assert (
        manifest_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        == "#/components/schemas/SourceManifestResponse"
    )
