from pathlib import Path

from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient
from test_review_repository import approve_artifact
from test_story_bible import valid_story_bible_payload


def test_get_story_bible_returns_typed_latest_version_and_revision_etag(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    source_manifest = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_api_fixture"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="来源基线",
    )
    approve_artifact(repository, project, source_manifest, "source_manifest")
    created = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=valid_story_bible_payload(),
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="建立故事圣经",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source_manifest.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        required_accepted_upstream_version_id=source_manifest.version.id,
    )
    client = TestClient(create_app(repository=repository))

    response = client.get(f"/api/v1/projects/{project.id}/story-bible")

    assert response.status_code == 200
    assert response.headers["etag"] == '"revision-1"'
    data = response.json()["data"]
    assert data["head"]["latest_version_id"] == created.version.id
    assert data["latest_version"]["schema_version"] == "1.0.0"
    assert data["latest_version"]["content"]["title"] == "雾城来信"
    assert data["latest_version"]["content_hash"] == created.version.content_hash


def test_get_story_bible_returns_stable_not_found_error_and_openapi_contract(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="空项目",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    app = create_app(repository=repository)
    client = TestClient(app)

    response = client.get(f"/api/v1/projects/{project.id}/story-bible")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "STORY_BIBLE_NOT_FOUND"
    operation = app.openapi()["paths"]["/api/v1/projects/{project_id}/story-bible"]["get"]
    assert operation["operationId"] == "getStoryBible"
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StoryBibleResponse"
    }
