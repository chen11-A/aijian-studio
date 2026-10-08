import json
from pathlib import Path

from aijian_api.agent_context_builder import (
    ContextFragment,
    _mint_resolved_context_inputs,
    build_context,
)
from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_contracts import AgentSkillFixtureBundleV1
from aijian_api.agent_skill_registry import (
    AgentRegistration,
    AgentSkillRegistry,
    SkillRegistration,
)
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from fastapi.testclient import TestClient

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


def persisted_run_client(tmp_path: Path) -> tuple[TestClient, StudioRepository, str, str]:
    database = tmp_path / "workspace.db"
    repository = StudioRepository(database)
    project = repository.create_project(
        name="提案运行读取",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    )
    fixture = AgentSkillFixtureBundleV1.model_validate_json(
        FIXTURE_PATH.read_text(encoding="utf-8")
    )
    registry = AgentSkillRegistry(
        agents=(AgentRegistration(fixture.agent_definition),),
        skills=(SkillRegistration(fixture.skill_definition),),
    )
    delegation = registry.resolve_delegation(
        fixture.agent_run.agent_definition,
        fixture.skill_run.skill_definition,
    )
    trusted_inputs = _mint_resolved_context_inputs(
        project_id=project.id,
        delegation=delegation,
        role_invariants=ContextFragment(
            ref="agent:writer.source-analyst",
            version="1.0.0",
            content="Only extract evidence-backed source facts.",
        ),
        skill_instructions=ContextFragment(
            ref="skill:source.extract",
            version="1.0.0",
            content="Return a closed SourceExtractionProposal.",
        ),
        approved_artifacts=(
            ContextFragment(
                ref=f"artifact:SourceManifest/ver_{'1' * 32}",
                version="1.0.0",
                content="Approved source manifest metadata.",
            ),
        ),
        source_spans=(
            ContextFragment(
                ref=f"source:spn_{'2' * 32}",
                version="source-v1",
                content="Untrusted source excerpt.",
            ),
        ),
        task_output_schema=ContextFragment(
            ref="schema:SourceExtractionProposal",
            version="1.0.0",
            content='{"type":"object","additionalProperties":false}',
        ),
    )
    built_context = build_context(delegation=delegation, trusted_inputs=trusted_inputs)
    agent_run = fixture.agent_run.model_copy(update={"project_id": project.id, "status": "PENDING"})
    skill_run = fixture.skill_run.model_copy(
        update={
            "project_id": project.id,
            "context_manifest_id": built_context.manifest.context_manifest_id,
            "status": "PENDING",
            "proposal_id": None,
        }
    )
    AgentRunStore(database).persist_pending_bundle(
        agent_run=agent_run,
        skill_run=skill_run,
        built_context=built_context,
        delegation=delegation,
    )
    return (
        TestClient(create_app(repository=repository, agent_skill_registry=registry)),
        repository,
        project.id,
        agent_run.agent_run_id,
    )


def test_reads_project_scoped_proposal_run_truth_without_context_plaintext(
    tmp_path: Path,
) -> None:
    client, _repository, project_id, run_id = persisted_run_client(tmp_path)

    response = client.get(f"/api/v1/projects/{project_id}/proposal-runs/{run_id}")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["project_id"] == project_id
    assert data["run_id"] == run_id
    assert data["agent_run"]["status"] == "PENDING"
    assert data["skill_run"]["status"] == "PENDING"
    assert data["context_manifest"]["project_id"] == project_id
    assert data["agent_revision"] == data["skill_revision"] == 1
    assert data["created_at"]
    assert data["updated_at"]
    serialized = json.dumps(response.json(), ensure_ascii=False)
    assert "Untrusted source excerpt" not in serialized
    assert "Only extract evidence-backed" not in serialized


def test_proposal_run_read_fails_closed_for_other_project_and_unknown_run(
    tmp_path: Path,
) -> None:
    client, repository, _project_id, run_id = persisted_run_client(tmp_path)
    other_project = repository.create_project(
        name="其他项目",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    ).id

    cross_project = client.get(f"/api/v1/projects/{other_project}/proposal-runs/{run_id}")
    missing = client.get(f"/api/v1/projects/{other_project}/proposal-runs/agr_{'f' * 32}")
    malformed = client.get(f"/api/v1/projects/{other_project}/proposal-runs/not-an-agent-run")

    assert cross_project.status_code == missing.status_code == 404
    assert cross_project.json()["error"]["code"] == "PROPOSAL_RUN_NOT_FOUND"
    assert missing.json()["error"]["code"] == "PROPOSAL_RUN_NOT_FOUND"
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "VALIDATION_ERROR"


def test_proposal_run_read_openapi_is_typed_and_does_not_publish_a_write_route(
    tmp_path: Path,
) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()
    path = schema["paths"]["/api/v1/projects/{project_id}/proposal-runs/{run_id}"]

    assert set(path) == {"get"}
    operation = path["get"]
    assert operation["operationId"] == "getProposalRun"
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ProposalRunResponse"
    }
    assert "ErrorResponse" in str(operation["responses"]["404"])
    parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}
    assert parameters["project_id"]["schema"]["pattern"] == r"^prj_[0-9a-f]{32}$"
    assert parameters["run_id"]["schema"]["pattern"] == r"^agr_[0-9a-f]{32}$"
    assert "/api/v1/projects/{project_id}/proposal-runs" not in schema["paths"]
