from datetime import UTC, datetime
from pathlib import Path

from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LocalTaskLedger
from fastapi.testclient import TestClient

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


def _project(repository: StudioRepository) -> str:
    return repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    ).id


def _enqueue(
    database: Path,
    project_id: str,
    *,
    node_key: str = "story.extract",
    version_digit: str = "1",
) -> None:
    LocalTaskLedger(database, clock=lambda: NOW).enqueue_local_node(
        project_id=project_id,
        definition_id="phase0-story",
        definition_version=1,
        definition_hash=HASH_A,
        graph={"nodes": ["story.extract"]},
        workflow_input_hash=HASH_A,
        node_key=node_key,
        node_type=node_key,
        contract_version=1,
        input_bindings={
            "source_manifest_version_id": f"ver_{version_digit * 32}",
            "ignored_note": "不得向界面泄漏的原始输入",
        },
        node_input_hash=HASH_A,
        request_fingerprint=HASH_B,
        idempotency_key=f"phase0-story:{node_key}",
        max_attempts=2,
        task_kind=f"local.{node_key}",
        priority=70,
        available_at=NOW,
    )


def test_lists_project_tasks_without_exposing_execution_secrets(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project_id = _project(repository)
    _enqueue(database, project_id)
    client = TestClient(create_app(repository=repository))

    response = client.get(f"/api/v1/projects/{project_id}/tasks")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["project_id"] == project_id
    assert payload["data"]["summary"] == {
        "total": 1,
        "attention": 0,
        "active": 1,
        "completed": 0,
    }
    task = payload["data"]["tasks"][0]
    assert task["node"] == {
        "workflow_run_id": task["node"]["workflow_run_id"],
        "node_run_id": task["node"]["node_run_id"],
        "node_key": "story.extract",
        "node_type": "story.extract",
        "status": "PENDING",
        "responsible_role": "编剧",
        "upstream_gate": "G1",
        "input_hash": HASH_A,
        "input_version_ids": [f"ver_{'1' * 32}"],
        "output_version_id": None,
        "attempt_count": 0,
        "max_attempts": 2,
        "updated_at": "2026-08-04T09:30:00Z",
    }
    assert task["attempt"]["number"] == 1
    assert task["attempt"]["status"] == "READY"
    assert task["attempt"]["execution_mode"] == "local"
    assert task["task"]["status"] == "READY"
    assert task["task"]["priority"] == 70
    assert task["cost"] == {
        "status": "NOT_RECORDED",
        "currency": None,
        "reserved": None,
        "accrued": None,
        "billed": None,
        "budget_limit": None,
        "retry_increment_limit": None,
    }
    assert task["presentation"] == {
        "status_label": "等待本地执行",
        "next_action_label": "等待执行器领取",
        "allowed_actions": ["VIEW_DETAILS"],
    }
    serialized = response.text
    for forbidden in (
        "lease_token",
        "idempotency_key",
        "request_fingerprint",
        "provider_account_id",
        "ignored_note",
    ):
        assert forbidden not in serialized


def test_task_list_is_empty_for_an_existing_project_and_404_for_unknown_project(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project_id = _project(repository)
    client = TestClient(create_app(repository=repository))

    response = client.get(f"/api/v1/projects/{project_id}/tasks")
    assert response.status_code == 200
    assert response.json()["data"]["tasks"] == []

    missing = client.get(f"/api/v1/projects/prj_{'f' * 32}/tasks")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PROJECT_NOT_FOUND"


def test_storyboard_is_owned_by_director_after_the_visual_bible_gate(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project_id = _project(repository)
    _enqueue(database, project_id, node_key="storyboard.plan", version_digit="2")

    response = TestClient(create_app(repository=repository)).get(
        f"/api/v1/projects/{project_id}/tasks"
    )

    assert response.status_code == 200
    node = response.json()["data"]["tasks"][0]["node"]
    assert node["responsible_role"] == "导演"
    assert node["upstream_gate"] == "G5"


def test_task_list_openapi_contract_is_public_and_typed(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()

    operation = schema["paths"]["/api/v1/projects/{project_id}/tasks"]["get"]
    assert operation["operationId"] == "listProjectTasks"
    assert "TaskQueueResponse" in str(operation["responses"]["200"])
    assert "TaskQueueItemData" in schema["components"]["schemas"]
