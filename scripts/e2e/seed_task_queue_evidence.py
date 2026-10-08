"""Seed an idempotent task-queue fixture in the ignored local development database."""

import sys
from datetime import UTC, datetime
from importlib import import_module
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))
StudioRepository = import_module("aijian_api.repository").StudioRepository
LocalTaskLedger = import_module("aijian_api.task_ledger").LocalTaskLedger

NOW = datetime(2026, 8, 4, 9, 30, tzinfo=UTC)
DEFINITION_HASH = f"sha256:{'a' * 64}"
REQUEST_FINGERPRINT = f"sha256:{'b' * 64}"
EVIDENCE_PROJECT_NAME = "Aijian Studio · 自动化验收专用"


def main() -> None:
    database = REPOSITORY_ROOT / ".aijian-dev" / "workspace.sqlite3"
    if database.resolve().parent != (REPOSITORY_ROOT / ".aijian-dev").resolve():
        raise RuntimeError("evidence database must stay inside .aijian-dev")
    repository = StudioRepository(database)
    project = next(
        (item for item in repository.list_projects() if item.name == EVIDENCE_PROJECT_NAME),
        None,
    )
    if project is None:
        project = repository.create_project(
            name=EVIDENCE_PROJECT_NAME,
            aspect_ratio="9:16",
            target_duration_seconds=90,
            source_language="zh-CN",
        )
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    seeded = []
    for node_key, version_digit, priority in (
        ("story.extract", "1", 85),
        ("storyboard.plan", "2", 70),
        ("export.master", "3", 55),
    ):
        task = ledger.enqueue_local_node(
            project_id=project.id,
            definition_id=f"evidence-{node_key}",
            definition_version=1,
            definition_hash=DEFINITION_HASH,
            graph={"nodes": [node_key]},
            workflow_input_hash=DEFINITION_HASH,
            node_key=node_key,
            node_type=node_key,
            contract_version=1,
            input_bindings={"artifact_version_id": f"ver_{version_digit * 32}"},
            node_input_hash=DEFINITION_HASH,
            request_fingerprint=REQUEST_FINGERPRINT,
            idempotency_key=f"phase0-evidence:v2:{project.id}:{node_key}",
            max_attempts=2,
            task_kind=f"local.{node_key}",
            priority=priority,
            available_at=NOW,
        )
        seeded.append(task.task_id)
    print(f"Seeded task queue evidence for {project.id}: {len(seeded)} tasks")


if __name__ == "__main__":
    main()
