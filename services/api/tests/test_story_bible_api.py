from copy import deepcopy
from pathlib import Path
from typing import Any

from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient
from test_review_repository import approve_artifact
from test_story_bible import valid_story_bible_payload
from test_story_bible_drafts import draft_payload


def create_imported_source(
    repository: StudioRepository,
    *,
    approve: bool,
):
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    from aijian_api.ingestion import ingest_text_file

    source = repository.import_source(
        project.id,
        ingest_text_file(filename="雾城来信.txt", content="第一章\n雨夜来信".encode()),
    )
    manifest = repository.get_latest_artifact(project.id, "source_manifest")
    if approve:
        approve_artifact(repository, project, manifest, "source_manifest")
    return project, source, manifest


def story_draft_request(source, manifest) -> dict[str, Any]:
    content, _keys = draft_payload()
    content["source_scope"] = {
        "source_manifest_version_id": manifest.version.id,
        "scope_type": "full_work",
        "documents": [
            {
                "source_document_id": source.id,
                "raw_sha256": source.raw_sha256,
                "source_block_ids": [block.id for block in source.blocks],
                "chapter_indices": sorted({block.chapter_index for block in source.blocks}),
            }
        ],
        "exclusions": [],
    }
    evidence_block = source.blocks[-1]
    spans = [
        {
            "fact_id": fact["fact_id"],
            "source_document_id": source.id,
            "source_block_id": evidence_block.id,
            "role": "supports",
            "start_byte": evidence_block.normalized_start_byte,
            "end_byte": evidence_block.normalized_end_byte,
            "claim": "故事事实来源",
        }
        for fact in content["facts"]
    ]
    return {
        "content": content,
        "source_spans": spans,
        "parent_version_id": None,
        "change_summary": "建立故事圣经",
    }


def permanent_draft(value: object) -> object:
    if isinstance(value, list):
        return [permanent_draft(item) for item in value]
    if isinstance(value, dict):
        return {key: permanent_draft(item) for key, item in value.items()}
    if isinstance(value, str) and value.startswith(("ent_", "fact_", "qst_", "cfl_")):
        return {"ref_type": "permanent_id", "permanent_id": value}
    return value


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


def test_create_story_bible_allocates_ids_persists_evidence_and_supports_etag_revision(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project, source, manifest = create_imported_source(repository, approve=True)
    client = TestClient(create_app(repository=repository))
    request = story_draft_request(source, manifest)

    created = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=request,
    )

    assert created.status_code == 201
    assert created.headers["etag"] == '"revision-1"'
    created_data = created.json()["data"]
    assert len(created_data["id_map"]) == 6
    version_id = created_data["version"]["id"]
    stored = repository.get_artifact_version(project.id, "story_bible", version_id)
    assert len(stored.source_spans) == 3
    assert stored.dependencies[0].upstream_version_id == manifest.version.id
    assert all(span.quote_hash.startswith("sha256:") for span in stored.source_spans)

    revision_content = permanent_draft(created_data["version"]["content"])
    revision_spans = [
        {
            **span,
            "fact_id": permanent_draft(span["fact_id"]),
        }
        for span in request["source_spans"]
    ]
    for span, fact in zip(
        revision_spans,
        created_data["version"]["content"]["facts"],
        strict=True,
    ):
        span["fact_id"] = permanent_draft(fact["fact_id"])
    revision_request = {
        "content": revision_content,
        "source_spans": revision_spans,
        "parent_version_id": version_id,
        "change_summary": "修订说明",
    }
    missing_etag = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=revision_request,
    )
    assert missing_etag.status_code == 428

    missing_parent_request = {
        **revision_request,
        "parent_version_id": "ver_" + "9" * 32,
    }
    missing_parent = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        headers={"If-Match": created.headers["etag"]},
        json=missing_parent_request,
    )
    assert missing_parent.status_code == 404
    assert missing_parent.json()["error"]["code"] == "STORY_BIBLE_NOT_FOUND"

    revised = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        headers={"If-Match": created.headers["etag"]},
        json=revision_request,
    )
    assert revised.status_code == 201
    assert revised.headers["etag"] == '"revision-2"'
    assert revised.json()["data"]["id_map"] == {}

    stale_parent = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        headers={"If-Match": revised.headers["etag"]},
        json=revision_request,
    )
    assert stale_parent.status_code == 412
    assert stale_parent.json()["error"]["code"] == "PRECONDITION_FAILED"
    assert (
        repository.get_artifact_head(project.id, "story_bible").latest_version_id
        == revised.json()["data"]["version"]["id"]
    )


def test_create_story_bible_rejects_unaccepted_source_and_invalid_span(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project, source, manifest = create_imported_source(repository, approve=False)
    client = TestClient(create_app(repository=repository))
    request = story_draft_request(source, manifest)

    unaccepted = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=request,
    )
    assert unaccepted.status_code == 409
    assert unaccepted.json()["error"]["code"] == "ARTIFACT_DEPENDENCY_INVALID"

    approve_artifact(repository, project, manifest, "source_manifest")
    missing_evidence_request = deepcopy(request)
    missing_evidence_request["source_spans"].pop()
    missing_evidence = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=missing_evidence_request,
    )
    assert missing_evidence.status_code == 422
    assert missing_evidence.json()["error"]["code"] == "STORY_BIBLE_INVALID"

    request["source_spans"][0]["end_byte"] = source.blocks[-1].normalized_end_byte + 1
    invalid_span = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=request,
    )
    assert invalid_span.status_code == 422
    assert invalid_span.json()["error"]["code"] == "SOURCE_SPAN_INVALID"
