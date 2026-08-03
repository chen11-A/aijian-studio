import base64
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
    assert project["status"] == "active"
    assert project["revision"] == 1

    listed = client.get("/api/v1/projects")
    fetched = client.get(f"/api/v1/projects/{project['id']}")

    assert listed.status_code == 200
    assert listed.json()["data"] == [project]
    assert fetched.status_code == 200
    assert fetched.json()["data"] == project


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
            "aspect_ratio": "16:9",
            "target_duration_seconds": 90,
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
