"""Seed and snapshot a production invalidation-operation workspace for Electron smoke tests."""

from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import sys
from collections import defaultdict
from datetime import UTC, datetime
from importlib import import_module
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))
ArtifactDependencyDraft = import_module("aijian_api.domain").ArtifactDependencyDraft
TrustedReviewActor = import_module("aijian_api.domain").TrustedReviewActor
StudioRepository = import_module("aijian_api.repository").StudioRepository

NOW = datetime(2026, 9, 3, 9, 0, tzinfo=UTC)
ACTOR = TrustedReviewActor(
    subject_id="local-smoke",
    roles=("writer", "continuity_reviewer", "producer"),
)
STORY_CONTENT: dict[str, object] = {
    "title": "Smoke dependency",
    "logline": "A deterministic production-only invalidation fixture.",
    "entities": [{"kind": "character", "name": "Smoke Actor"}],
    "facts": [{"importance": "core", "canon_status": "confirmed", "kind": "event_fact"}],
}


def deterministic_ids() -> Any:
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def workspace_database(workspace: str) -> Path:
    path = Path(workspace).resolve()
    allowed_root = (REPOSITORY_ROOT / ".aijian-dev").resolve()
    if path.parent != allowed_root and allowed_root not in path.parents:
        raise RuntimeError("workspace must stay below .aijian-dev")
    return path / "workspace.sqlite3"


def approve(repository: Any, project_id: str, artifact: Any, artifact_type: str) -> Any:
    roles = (
        ("writer", "producer")
        if artifact_type == "source_manifest"
        else (
            "writer",
            "continuity_reviewer",
            "producer",
        )
    )
    submitted_action = repository.prepare_review_action(
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=ACTOR,
        expected_revision=artifact.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        expected_revision=artifact.head.revision,
        challenge_id=submitted_action.challenge.id,
        confirmation_token=submitted_action.confirmation_token,
        actor=ACTOR,
    )
    signoff_action = repository.prepare_review_action(
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=signoff_action.challenge.id,
        confirmation_token=signoff_action.confirmation_token,
        actor=ACTOR,
    )
    rationale = "Deterministic smoke acceptance"
    decision_action = repository.prepare_review_action(
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        action="decision",
        action_payload={"decision": "approved", "rationale": rationale, "actor_role": "producer"},
        actor=ACTOR,
        readiness_report_id=signoff_action.report.id,
        expected_revision=signed.head.revision,
    )
    return repository.decide_artifact_gate(
        project_id=project_id,
        artifact_type=artifact_type,
        version_id=artifact.version.id,
        decision="approved",
        rationale=rationale,
        expected_revision=signed.head.revision,
        challenge_id=decision_action.challenge.id,
        confirmation_token=decision_action.confirmation_token,
        actor=ACTOR,
        actor_role="producer",
    )


def operation_data(operation: Any) -> dict[str, object]:
    return {
        "operation_id": operation.id,
        "project_id": operation.project_id,
        "changed_artifact_id": operation.changed_artifact_id,
        "old_accepted_version_id": operation.old_accepted_version_id,
        "new_accepted_version_id": operation.new_accepted_version_id,
        "gate_decision_id": operation.gate_decision_id,
        "assessment_hash": operation.assessment_hash,
        "created_at": operation.created_at.isoformat().replace("+00:00", "Z"),
        "paths": [
            {
                "path_id": path.id,
                "operation_id": path.operation_id,
                "project_id": path.project_id,
                "affected_artifact_id": path.affected_artifact_id,
                "affected_version_id": path.affected_version_id,
                "classification": path.classification,
                "aggregate_impact": path.aggregate_impact,
                "dependency_ids": list(path.dependency_ids),
                "relationships": list(path.relationships),
                "edge_impacts": list(path.edge_impacts),
                "effective_impact": path.effective_impact,
                "ordinal": path.ordinal,
                "created_at": path.created_at.isoformat().replace("+00:00", "Z"),
            }
            for path in operation.paths
        ],
    }


def seed(workspace: str) -> dict[str, object]:
    database = workspace_database(workspace)
    if database.exists():
        raise RuntimeError("seed workspace database must not already exist")
    repository = StudioRepository(
        database,
        id_factory=deterministic_ids(),
        clock=lambda: NOW,
        challenge_token_factory=lambda: "smoke-confirmation-token",
    )
    project = repository.create_project(
        name="Invalidation operation smoke",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    source_v1 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_smoke_v1"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="Smoke source v1",
    )
    approve(repository, project.id, source_v1, "source_manifest")
    downstream = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=STORY_CONTENT,
        author_actor_type="human",
        author_actor_id="local-smoke",
        change_summary="Accepted downstream dependency",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=source_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        required_accepted_upstream_version_id=source_v1.version.id,
    )
    approve(repository, project.id, downstream, "story_bible")
    source_v2 = repository.create_artifact_version(
        project_id=project.id,
        artifact_type="source_manifest",
        schema_version="1.0.0",
        content={"documents": [{"source_document_id": "src_smoke_v2"}]},
        author_actor_type="system",
        author_actor_id="source-ingestion",
        change_summary="Smoke source v2",
        parent_version_id=source_v1.version.id,
        expected_revision=repository.get_artifact_head(project.id, "source_manifest").revision,
    )
    approve(repository, project.id, source_v2, "source_manifest")
    operations = repository.list_invalidation_operations(project.id)
    if len(operations) != 1 or not operations[0].paths:
        raise RuntimeError("Gate did not create a non-empty invalidation operation")
    operation = operations[0]
    return {
        "project_id": project.id,
        "operation_id": operation.id,
        "expected_data": operation_data(operation),
    }


def normalize_value(value: object) -> object:
    if isinstance(value, bytes):
        return {"bytes_base64": base64.b64encode(value).decode("ascii")}
    return value


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def snapshot(workspace: str) -> dict[str, object]:
    database = workspace_database(workspace)
    if not database.is_file():
        raise RuntimeError("snapshot workspace database is missing")
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    try:
        tables = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        logical_tables = []
        counts: dict[str, int] = {}
        for table in tables:
            columns = [
                str(row[1])
                for row in connection.execute(f"PRAGMA table_info({quote_identifier(table)})")
            ]
            selected = ", ".join(quote_identifier(column) for column in columns)
            order = ", ".join(quote_identifier(column) for column in columns)
            rows = [
                [normalize_value(value) for value in row]
                for row in connection.execute(
                    f"SELECT {selected} FROM {quote_identifier(table)} ORDER BY {order}"
                )
            ]
            counts[table] = len(rows)
            logical_tables.append({"table": table, "columns": columns, "rows": rows})
        payload = json.dumps(
            logical_tables, ensure_ascii=True, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        return {"sha256": hashlib.sha256(payload).hexdigest(), "counts": counts}
    finally:
        connection.close()


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"seed", "snapshot"}:
        raise SystemExit(
            "usage: seed_invalidation_operation_workspace.py {seed|snapshot} WORKSPACE"
        )
    result = seed(sys.argv[2]) if sys.argv[1] == "seed" else snapshot(sys.argv[2])
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
