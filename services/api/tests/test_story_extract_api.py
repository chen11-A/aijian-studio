from datetime import timedelta
from pathlib import Path

from aijian_api.ingestion import ingest_text_file
from aijian_api.local_executor import LocalExecutor
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.story_extract import StoryExtractService
from aijian_api.task_ledger import LocalTaskLedger
from fastapi.testclient import TestClient
from test_review_repository import approve_artifact
from test_story_extract import SOURCE_TEXT


def _accepted_client(tmp_path: Path) -> tuple[TestClient, StudioRepository, str, str]:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    repository.import_source(
        project.id,
        ingest_text_file(filename="雾城来信.txt", content=SOURCE_TEXT.encode()),
    )
    manifest = repository.get_latest_artifact(project.id, "source_manifest")
    approve_artifact(repository, project, manifest, "source_manifest")
    accepted_id = repository.get_latest_artifact(
        project.id, "source_manifest"
    ).head.accepted_version_id
    assert accepted_id is not None
    client = TestClient(create_app(repository=repository))
    return client, repository, project.id, accepted_id


def test_start_story_extract_requires_accepted_g1(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    client = TestClient(create_app(repository=repository))

    missing = client.post(f"/api/v1/projects/{project.id}/story-extract", json={})
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "G1_MISSING"
    assert missing.json()["error"]["retryable"] is False

    repository.import_source(
        project.id,
        ingest_text_file(filename="雾城来信.txt", content=SOURCE_TEXT.encode()),
    )
    unaccepted = client.post(f"/api/v1/projects/{project.id}/story-extract", json={})
    assert unaccepted.status_code == 409
    assert unaccepted.json()["error"]["code"] == "G1_UNACCEPTED"


def test_start_and_inspect_story_extract_are_typed_and_task_backed(tmp_path: Path) -> None:
    client, repository, project_id, accepted_id = _accepted_client(tmp_path)

    started = client.post(
        f"/api/v1/projects/{project_id}/story-extract",
        json={"source_manifest_version_id": accepted_id},
    )
    assert started.status_code == 202
    data = started.json()["data"]
    assert data["project_id"] == project_id
    assert data["source_manifest_version_id"] == accepted_id
    assert data["node_status"] == "PENDING"
    assert data["attempt_status"] == "READY"
    assert data["output_version_id"] is None

    replayed = client.post(f"/api/v1/projects/{project_id}/story-extract", json={})
    assert replayed.status_code == 202
    assert replayed.json()["data"]["node_run_id"] == data["node_run_id"]

    service = StoryExtractService(repository, LocalTaskLedger(repository.database_path))
    assert LocalExecutor(
        LocalTaskLedger(repository.database_path),
        worker_id="worker-api",
        lease_duration=timedelta(seconds=30),
        handler=service.execute_claimed_task,
    ).run_once()

    inspected = client.get(f"/api/v1/projects/{project_id}/story-extract/{data['node_run_id']}")
    assert inspected.status_code == 200
    body = inspected.json()["data"]
    assert body["node_status"] == "SUCCEEDED"
    assert body["attempt_status"] == "SUCCEEDED"
    assert body["output_version_id"]
    assert body["producer_attempt_id"] == data["attempt_id"]

    missing = client.get(f"/api/v1/projects/{project_id}/story-extract/node_{'f' * 32}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "STORY_EXTRACT_NOT_FOUND"


def test_story_extract_openapi_contract_is_public_and_typed(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()
    start = schema["paths"]["/api/v1/projects/{project_id}/story-extract"]["post"]
    inspect = schema["paths"]["/api/v1/projects/{project_id}/story-extract/{node_run_id}"]["get"]
    assert start["operationId"] == "startStoryExtract"
    assert inspect["operationId"] == "getStoryExtractTask"
    assert "202" in start["responses"]
    assert "409" in start["responses"]
    assert "200" in inspect["responses"]
    assert "404" in inspect["responses"]
