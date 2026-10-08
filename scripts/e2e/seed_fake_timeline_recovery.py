"""Seed or inspect the isolated source fixture for C20 fake-timeline recovery."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))

from aijian_api.main import create_app  # noqa: E402
from aijian_api.repository import StudioRepository  # noqa: E402
from aijian_api.security import SidecarSecurity  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def confirmation(response):
    response.raise_for_status()
    body = response.json()["data"]
    return {
        "challenge_id": body["challenge"]["id"],
        "confirmation_token": body["confirmation_token"],
    }


def seed(database: Path, project_id: str, source_id: str) -> dict[str, object]:
    security = SidecarSecurity(token="e" * 43, host="127.0.0.1:43129", origin="app://aijian")
    with TestClient(
        create_app(repository=StudioRepository(database), sidecar_security=security),
        base_url="http://127.0.0.1:43129",
        client=("127.0.0.1", 50129),
    ) as client:
        client.headers.update({"Authorization": f"Bearer {'e' * 43}", "Origin": "app://aijian"})
        manifest = client.get(f"/api/v1/projects/{project_id}/source-manifest")
        manifest.raise_for_status()
        version_id = manifest.json()["data"]["latest_version"]["id"]
        revision = int(manifest.headers["etag"].strip('"').removeprefix("revision-"))
        base = f"/api/v1/internal/projects/{project_id}/source-manifest/versions/{version_id}"
        submit = client.post(
            f"{base}:prepare-submit", headers={"If-Match": manifest.headers["etag"]}, json={}
        )
        client.post(
            f"{base}:submit",
            headers={"If-Match": manifest.headers["etag"]},
            json=confirmation(submit),
        ).raise_for_status()
        signoff_etag = f'"revision-{revision + 1}"'
        signoff = client.post(
            f"{base}:prepare-signoff", headers={"If-Match": signoff_etag}, json={}
        )
        signed = client.post(
            f"{base}/signoffs", headers={"If-Match": signoff_etag}, json=confirmation(signoff)
        )
        signed.raise_for_status()
        decision_etag = f'"revision-{revision + 2}"'
        prepared = client.post(
            f"{base}:prepare-decision",
            headers={"If-Match": decision_etag},
            json={
                "decision": "approved",
                "rationale": "C20 isolated fixture",
                "readiness_report_id": signoff.json()["data"]["report"]["id"],
            },
        )
        client.post(
            f"{base}/decisions",
            headers={"If-Match": decision_etag},
            json={
                **confirmation(prepared),
                "decision": "approved",
                "rationale": "C20 isolated fixture",
            },
        ).raise_for_status()
        source = client.get(f"/api/v1/projects/{project_id}/sources/{source_id}")
        source.raise_for_status()
        block = source.json()["data"]["blocks"][-1]
        return {
            "project_id": project_id,
            "source_id": source_id,
            "source_manifest_version_id": version_id,
            "source_block_id": block["id"],
            "start_byte": block["normalized_start_byte"],
            "end_byte": block["normalized_end_byte"],
        }


def inspect(database: Path, project_id: str) -> dict[str, object]:
    connection = sqlite3.connect(database)
    try:
        queries = {
            "workflow_count": "SELECT COUNT(*) FROM workflow_runs WHERE project_id = ?",
            "node_count": (
                "SELECT COUNT(*) FROM workflow_node_runs AS node "
                "JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id "
                "WHERE workflow.project_id = ?"
            ),
            "attempt_count": (
                "SELECT COUNT(*) FROM workflow_attempts AS attempt "
                "JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id "
                "JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id "
                "WHERE workflow.project_id = ?"
            ),
            "task_count": (
                "SELECT COUNT(*) FROM task_ledger AS task "
                "JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id "
                "JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id "
                "JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id "
                "WHERE workflow.project_id = ?"
            ),
            "intent_count": "SELECT COUNT(*) FROM workflow_enqueue_keys WHERE project_id = ?",
            "timeline_count": (
                "SELECT COUNT(*) FROM artifact_versions AS version "
                "JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id "
                "WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline'"
            ),
        }
        counts = {
            name: connection.execute(query, (project_id,)).fetchone()[0]
            for name, query in queries.items()
        }
        terminal = connection.execute(
            """
            SELECT workflow.status, node.status, node.output_version_id, attempt.attempt_id,
                   attempt.status, attempt.error_code, task.status, task.task_kind
            FROM workflow_runs AS workflow
            LEFT JOIN workflow_node_runs AS node ON node.workflow_run_id = workflow.workflow_run_id
            LEFT JOIN workflow_attempts AS attempt ON attempt.attempt_id = node.active_attempt_id
            LEFT JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
            WHERE workflow.project_id = ?
            """,
            (project_id,),
        ).fetchone()
        timeline = connection.execute(
            """
            SELECT version.version_id, version.producer_attempt_id,
                   head.latest_version_id, head.accepted_version_id
            FROM artifact_versions AS version
            JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
            WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline'
            """,
            (project_id,),
        ).fetchone()
        gate_decision_count = connection.execute(
            """
            SELECT COUNT(*) FROM gate_decisions WHERE version_id IN (
              SELECT version.version_id FROM artifact_versions AS version
              JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
              WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline'
            )
            """,
            (project_id,),
        ).fetchone()[0]
        review_submission_count = connection.execute(
            """
            SELECT COUNT(*) FROM review_submissions WHERE version_id IN (
              SELECT version.version_id FROM artifact_versions AS version
              JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
              WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline'
            )
            """,
            (project_id,),
        ).fetchone()[0]
        provider_connection_count = connection.execute(
            "SELECT COUNT(*) FROM provider_connections"
        ).fetchone()[0]
        return {
            **counts,
            "workflow_status": None if terminal is None else terminal[0],
            "node_status": None if terminal is None else terminal[1],
            "output_version_id": None if terminal is None else terminal[2],
            "attempt_id": None if terminal is None else terminal[3],
            "attempt_status": None if terminal is None else terminal[4],
            "attempt_error_code": None if terminal is None else terminal[5],
            "task_status": None if terminal is None else terminal[6],
            "task_kind": None if terminal is None else terminal[7],
            "timeline_version_id": None if timeline is None else timeline[0],
            "producer_attempt_id": None if timeline is None else timeline[1],
            "timeline_latest_version_id": None if timeline is None else timeline[2],
            "timeline_accepted_version_id": None if timeline is None else timeline[3],
            "gate_decision_count": gate_decision_count,
            "review_submission_count": review_submission_count,
            "provider_connection_count": provider_connection_count,
        }
    finally:
        connection.close()


def main() -> None:
    if len(sys.argv) < 4 or sys.argv[1] not in {"seed", "inspect"}:
        raise RuntimeError(
            "usage: seed_fake_timeline_recovery.py <seed|inspect> <database> "
            "<project_id> [source_id]"
        )
    operation, database_arg, project_id = sys.argv[1:4]
    database = Path(database_arg).resolve()
    if (ROOT / ".aijian-dev").resolve() not in database.parents:
        raise RuntimeError("C20 fixture database must be inside .aijian-dev")
    if operation == "inspect":
        result = inspect(database, project_id)
    else:
        if len(sys.argv) != 5:
            raise RuntimeError("seed requires source_id")
        result = seed(database, project_id, sys.argv[4])
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
