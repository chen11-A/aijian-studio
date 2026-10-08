import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.agent_skill_contracts import (
    AgentSkillFixtureBundleV1,
    AttemptSnapshotV1,
    canonical_sha256,
)
from aijian_api.artifact_proposal_store import (
    ArtifactProposalConflictError,
    ArtifactProposalStore,
)
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import ClaimedTask
from aijian_api.task_ledger_snapshots import canonical_snapshot_json
from fastapi.testclient import TestClient

NOW = datetime(2026, 8, 10, 14, 0, tzinfo=UTC)
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


def persisted_proposal_client(
    tmp_path: Path,
) -> tuple[TestClient, StudioRepository, str, str]:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="提案审阅",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    fields = bundle.attempt.model_dump(mode="json")
    fields["project_id"] = project.id
    fingerprint_payload = {
        key: value
        for key, value in fields.items()
        if key not in {"schema_version", "attempt_id", "attempt_fingerprint"}
    }
    fields["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
    snapshot = AttemptSnapshotV1.model_validate(fields)
    ledger = LocalTaskLedger(repository.database_path, clock=lambda: NOW)
    queued = ledger.enqueue_local_node(
        project_id=project.id,
        definition_id="agent-skill-fake-runtime",
        definition_version=1,
        definition_hash=snapshot.input_hash,
        graph={"nodes": [snapshot.skill_definition_id]},
        workflow_input_hash=snapshot.input_hash,
        node_key=snapshot.skill_definition_id,
        node_type="agent.skill.fake",
        contract_version=1,
        input_bindings={"context_manifest_id": bundle.context_manifest.context_manifest_id},
        node_input_hash=snapshot.input_hash,
        request_fingerprint=snapshot.attempt_fingerprint,
        idempotency_key=snapshot.idempotency_key,
        max_attempts=2,
        task_kind="local.agent-skill.fake",
        priority=80,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot.model_dump(mode="json", exclude={"attempt_id"}),
    )
    claim = ledger.claim_ready_task(
        worker_id="proposal-api-fixture",
        lease_duration=timedelta(seconds=30),
        task_id=queued.task_id,
    )
    assert claim is not None
    proposal = bundle.artifact_proposal.model_copy(update={"project_id": project.id})
    ArtifactProposalStore(repository.database_path, clock=lambda: NOW).persist(claim, proposal)
    return (
        TestClient(create_app(repository=repository)),
        repository,
        project.id,
        proposal.proposal_id,
    )


def enqueue_unpersisted_fixture_attempt(
    repository: StudioRepository, project_id: str
) -> tuple[AgentSkillFixtureBundleV1, ClaimedTask]:
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    fields = bundle.attempt.model_dump(mode="json")
    fields["project_id"] = project_id
    fingerprint_payload = {
        key: value
        for key, value in fields.items()
        if key not in {"schema_version", "attempt_id", "attempt_fingerprint"}
    }
    fields["attempt_fingerprint"] = canonical_sha256(fingerprint_payload)
    snapshot = AttemptSnapshotV1.model_validate(fields)
    ledger = LocalTaskLedger(repository.database_path, clock=lambda: NOW)
    queued = ledger.enqueue_local_node(
        project_id=project_id,
        definition_id="agent-skill-fake-runtime",
        definition_version=1,
        definition_hash=snapshot.input_hash,
        graph={"nodes": [snapshot.skill_definition_id]},
        workflow_input_hash=snapshot.input_hash,
        node_key=snapshot.skill_definition_id,
        node_type="agent.skill.fake",
        contract_version=1,
        input_bindings={"context_manifest_id": bundle.context_manifest.context_manifest_id},
        node_input_hash=snapshot.input_hash,
        request_fingerprint=snapshot.attempt_fingerprint,
        idempotency_key=snapshot.idempotency_key,
        max_attempts=2,
        task_kind="local.agent-skill.fake",
        priority=80,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot.model_dump(mode="json", exclude={"attempt_id"}),
    )
    claim = ledger.claim_ready_task(
        worker_id="proposal-api-tamper-fixture",
        lease_duration=timedelta(seconds=30),
        task_id=queued.task_id,
    )
    assert claim is not None
    return bundle, claim


def test_reads_project_scoped_artifact_proposal_for_proposal_card(tmp_path: Path) -> None:
    client, _repository, project_id, proposal_id = persisted_proposal_client(tmp_path)

    response = client.get(f"/api/v1/projects/{project_id}/proposals/{proposal_id}")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_id"] == project_id
    assert data["proposal_id"] == proposal_id
    assert data["proposal"]["source_spans"]
    assert data["proposal"]["diff"]
    assert data["proposal"]["impacts"]
    assert data["proposal"]["dependencies"]
    assert data["proposal"]["capability_losses"] == []
    assert data["proposal"]["cost"]["actual_micros"] == 0
    assert data["proposal"]["confidence_basis_points"] == 9000
    assert data["proposal"]["qc"]
    assert data["proposal"]["producer_agent_run_id"].startswith("agr_")
    assert data["proposal"]["producer_skill_run_id"].startswith("skr_")
    assert data["producer_attempt_id"].startswith("att_")
    assert data["proposal_hash"].startswith("sha256:")
    assert data["created_at"]


def test_proposal_read_fails_closed_for_other_project_unknown_and_malformed_ids(
    tmp_path: Path,
) -> None:
    client, repository, _project_id, proposal_id = persisted_proposal_client(tmp_path)
    other = repository.create_project(
        name="Other",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )

    cross_project = client.get(f"/api/v1/projects/{other.id}/proposals/{proposal_id}")
    missing = client.get(f"/api/v1/projects/{other.id}/proposals/prp_{'f' * 32}")
    malformed = client.get(f"/api/v1/projects/{other.id}/proposals/not-a-proposal")

    assert cross_project.status_code == missing.status_code == 404
    assert cross_project.json()["error"]["code"] == "ARTIFACT_PROPOSAL_NOT_FOUND"
    assert missing.json()["error"]["code"] == "ARTIFACT_PROPOSAL_NOT_FOUND"
    assert malformed.status_code == 422


def test_proposal_read_rejects_cross_project_producer_attempt_tampering(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    source_project = repository.create_project(
        name="Source",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    bundle, claim = enqueue_unpersisted_fixture_attempt(repository, source_project.id)
    target_project = repository.create_project(
        name="Target",
        aspect_ratio="9:16",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    tampered = bundle.artifact_proposal.model_copy(
        update={"project_id": target_project.id, "proposal_id": f"prp_{'e' * 32}"}
    )
    payload = tampered.model_dump(mode="json")
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute(
            """
            INSERT INTO agent_artifact_proposals (
                proposal_id, project_id, producer_attempt_id,
                producer_agent_run_id, producer_skill_run_id,
                target_artifact_type, proposal_json, proposal_hash, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tampered.proposal_id,
                target_project.id,
                claim.attempt_id,
                tampered.producer_agent_run_id,
                tampered.producer_skill_run_id,
                tampered.target_artifact_type,
                canonical_snapshot_json(payload),
                canonical_sha256(payload),
                "2026-08-10T14:00:00.000000Z",
            ),
        )

    with pytest.raises(ArtifactProposalConflictError, match="integrity validation"):
        ArtifactProposalStore(repository.database_path).get(target_project.id, tampered.proposal_id)


def test_proposal_read_openapi_is_typed_and_read_only(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()
    path = schema["paths"]["/api/v1/projects/{project_id}/proposals/{proposal_id}"]

    assert set(path) == {"get"}
    assert path["get"]["operationId"] == "getArtifactProposal"
    assert path["get"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ArtifactProposalResponse"
    }
    parameters = {parameter["name"]: parameter for parameter in path["get"]["parameters"]}
    assert parameters["project_id"]["schema"]["pattern"] == r"^prj_[0-9a-f]{32}$"
    assert parameters["proposal_id"]["schema"]["pattern"] == r"^prp_[0-9a-f]{32}$"
