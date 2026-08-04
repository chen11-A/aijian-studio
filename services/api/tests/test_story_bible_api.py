from copy import deepcopy
from pathlib import Path
from typing import Any, NoReturn

import aijian_api.story_bible_routes as story_bible_routes
import pytest
from aijian_api.application_errors import StoryBiblePayloadTooLargeError
from aijian_api.contracts import StoryBibleVersionCreatedResponse, StoryBibleVersionResponse
from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient
from test_review_repository import LOCAL_ACTOR, approve_artifact
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


def test_get_story_bible_returns_lightweight_index_and_version_on_demand(tmp_path: Path) -> None:
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
    assert data["project_id"] == project.id
    assert data["head"]["latest_version_id"] == created.version.id
    assert data["latest_version"]["schema_version"] == "1.0.0"
    assert "content" not in data["latest_version"]
    assert "source_spans" not in data["latest_version"]
    assert data["latest_version"]["content_hash"] == created.version.content_hash
    assert data["review_version"] is None
    assert data["accepted_version"] is None

    loaded = client.get(f"/api/v1/projects/{project.id}/story-bible/versions/{created.version.id}")
    assert loaded.status_code == 200
    assert loaded.headers["etag"] == f'"{created.version.content_hash}"'
    assert loaded.json()["data"]["version"]["content"]["title"] == "雾城来信"
    assert loaded.json()["data"]["version"]["id"] == created.version.id

    prepared = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=created.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=created.head.revision,
    )
    repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="story_bible",
        version_id=created.version.id,
        expected_revision=created.head.revision,
        challenge_id=prepared.challenge.id,
        confirmation_token=prepared.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    reviewed = client.get(f"/api/v1/projects/{project.id}/story-bible")
    assert reviewed.status_code == 200
    assert reviewed.json()["data"]["review_version"]["id"] == created.version.id
    assert "content" not in reviewed.json()["data"]["review_version"]


def test_get_story_bible_returns_exact_accepted_version_when_latest_is_newer(
    tmp_path: Path,
) -> None:
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
    dependency = ArtifactDependencyDraft(
        upstream_version_id=source_manifest.version.id,
        relationship="derived_from",
        impact="blocking",
    )
    accepted = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=valid_story_bible_payload(),
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="已验收基线",
        dependencies=(dependency,),
        required_accepted_upstream_version_id=source_manifest.version.id,
    )
    approved = approve_artifact(repository, project, accepted)
    revised_content = valid_story_bible_payload()
    revised_content["logline"] = "这是尚未验收的第二版。"
    latest = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=revised_content,
        author_actor_type="human",
        author_actor_id="local-user",
        parent_version_id=accepted.version.id,
        change_summary="第二版草稿",
        expected_revision=approved.head.revision,
        dependencies=(dependency,),
        required_accepted_upstream_version_id=source_manifest.version.id,
    )
    client = TestClient(create_app(repository=repository))

    response = client.get(f"/api/v1/projects/{project.id}/story-bible")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["latest_version"]["id"] == latest.version.id
    assert data["latest_version"]["change_summary"] == "第二版草稿"
    assert data["review_version"] is None
    assert data["accepted_version"]["id"] == accepted.version.id
    assert data["accepted_version"]["change_summary"] == "已验收基线"


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
    assert operation["operationId"] == "getStoryBibleIndex"
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StoryBibleIndexResponse"
    }
    version_operation = app.openapi()["paths"][
        "/api/v1/projects/{project_id}/story-bible/versions/{version_id}"
    ]["get"]
    assert version_operation["operationId"] == "getStoryBibleVersion"
    assert version_operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StoryBibleVersionResponse"
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
    assert len(created_data["version"]["source_spans"]) == 3
    assert all(
        span["quote_hash"].startswith("sha256:") for span in created_data["version"]["source_spans"]
    )
    version_id = created_data["version"]["id"]
    stored = repository.get_artifact_version(project.id, "story_bible", version_id)
    assert len(stored.source_spans) == 3
    assert stored.dependencies[0].upstream_version_id == manifest.version.id
    assert all(span.quote_hash.startswith("sha256:") for span in stored.source_spans)

    loaded = client.get(f"/api/v1/projects/{project.id}/story-bible/versions/{version_id}")
    assert loaded.status_code == 200
    loaded_spans = loaded.json()["data"]["version"]["source_spans"]
    assert loaded_spans == created_data["version"]["source_spans"]

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


def test_story_bible_response_limit_is_utf8_exact_and_create_rolls_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = StudioRepository(tmp_path / "reference.db")
    project, source, manifest = create_imported_source(repository, approve=True)
    client = TestClient(create_app(repository=repository))
    request = story_draft_request(source, manifest)
    request["change_summary"] = "建立📚故事圣经"
    created = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=request,
    )
    assert created.status_code == 201
    created_model = StoryBibleVersionCreatedResponse.model_validate(created.json())
    assert created_model.data.id_map
    created_bytes = created_model.model_dump_json().encode("utf-8")
    assert created.content == created_bytes
    response_model = StoryBibleVersionResponse.model_validate(
        {
            "data": {
                "project_id": project.id,
                "head": created.json()["data"]["head"],
                "version": created.json()["data"]["version"],
            },
            "request_id": created.json()["request_id"],
        }
    )
    exact_bytes = len(response_model.model_dump_json().encode("utf-8"))
    monkeypatch.setattr(story_bible_routes, "MAX_STORY_BIBLE_RESPONSE_BYTES", exact_bytes)
    story_bible_routes._enforce_story_bible_response_size(response_model)
    monkeypatch.setattr(story_bible_routes, "MAX_STORY_BIBLE_RESPONSE_BYTES", exact_bytes - 1)
    with pytest.raises(StoryBiblePayloadTooLargeError):
        story_bible_routes._enforce_story_bible_response_size(response_model)

    allowed_repository = StudioRepository(tmp_path / "allowed.db")
    allowed_project, allowed_source, allowed_manifest = create_imported_source(
        allowed_repository, approve=True
    )
    allowed_client = TestClient(create_app(repository=allowed_repository))
    allowed_request = story_draft_request(allowed_source, allowed_manifest)
    allowed_request["change_summary"] = "建立📚故事圣经"
    monkeypatch.setattr(
        story_bible_routes,
        "MAX_STORY_BIBLE_RESPONSE_BYTES",
        len(created_bytes),
    )
    allowed = allowed_client.post(
        f"/api/v1/projects/{allowed_project.id}/story-bible/versions",
        json=allowed_request,
    )
    assert allowed.status_code == 201
    assert len(allowed.content) == len(created_bytes)

    rejected_repository = StudioRepository(tmp_path / "rejected.db")
    rejected_project, rejected_source, rejected_manifest = create_imported_source(
        rejected_repository, approve=True
    )
    rejected_client = TestClient(create_app(repository=rejected_repository))
    rejected_request = story_draft_request(rejected_source, rejected_manifest)
    rejected_request["change_summary"] = "建立📚故事圣经"
    monkeypatch.setattr(
        story_bible_routes,
        "MAX_STORY_BIBLE_RESPONSE_BYTES",
        len(created_bytes) - 1,
    )
    rejected = rejected_client.post(
        f"/api/v1/projects/{rejected_project.id}/story-bible/versions",
        json=rejected_request,
    )
    assert rejected.status_code == 413
    assert rejected.json()["error"]["code"] == "STORY_BIBLE_TOO_LARGE"
    missing = rejected_client.get(f"/api/v1/projects/{rejected_project.id}/story-bible")
    assert missing.status_code == 404


def test_story_bible_historical_oversize_read_returns_413(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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
    version = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=valid_story_bible_payload(),
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="历史大版本",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source_manifest.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        required_accepted_upstream_version_id=source_manifest.version.id,
    )
    monkeypatch.setattr(story_bible_routes, "MAX_STORY_BIBLE_RESPONSE_BYTES", 500)

    def fail_if_materialized(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("oversize history must be rejected before full materialization")

    monkeypatch.setattr(
        repository,
        "_get_artifact_version_in_connection",
        fail_if_materialized,
    )
    client = TestClient(create_app(repository=repository))
    response = client.get(
        f"/api/v1/projects/{project.id}/story-bible/versions/{version.version.id}"
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "STORY_BIBLE_TOO_LARGE"


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
