import json
from pathlib import Path

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


def registry() -> AgentSkillRegistry:
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    return AgentSkillRegistry(
        agents=(AgentRegistration(bundle.agent_definition),),
        skills=(SkillRegistration(bundle.skill_definition),),
    )


def project_client(tmp_path: Path) -> tuple[TestClient, str]:
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="目录 API",
        aspect_ratio="9:16",
        target_duration_seconds=15,
        source_language="zh-CN",
    )
    app = create_app(repository=repository, agent_skill_registry=registry())
    return TestClient(app), project.id


def test_registry_catalogs_are_sorted_and_exclude_disabled_definitions() -> None:
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    newer_agent = bundle.agent_definition.model_copy(update={"version": "2.0.0"})
    newest_agent = bundle.agent_definition.model_copy(update={"version": "3.0.0"})
    newer_skill = bundle.skill_definition.model_copy(update={"version": "2.0.0"})
    newest_skill = bundle.skill_definition.model_copy(update={"version": "3.0.0"})
    catalog = AgentSkillRegistry(
        agents=(
            AgentRegistration(newest_agent),
            AgentRegistration(newer_agent),
            AgentRegistration(bundle.agent_definition, enabled=False),
        ),
        skills=(
            SkillRegistration(newest_skill),
            SkillRegistration(newer_skill),
            SkillRegistration(bundle.skill_definition, enabled=False),
        ),
    )

    assert catalog.list_agents() == (newer_agent, newest_agent)
    assert catalog.list_skills() == (newer_skill, newest_skill)


def test_project_agent_and_skill_catalogs_return_exact_enabled_definitions(
    tmp_path: Path,
) -> None:
    client, project_id = project_client(tmp_path)

    agents = client.get(f"/api/v1/projects/{project_id}/agents")
    skills = client.get(f"/api/v1/projects/{project_id}/skills")

    assert agents.status_code == 200
    assert skills.status_code == 200
    assert agents.json()["data"] == {
        "project_id": project_id,
        "agents": [registry().list_agents()[0].model_dump(mode="json")],
    }
    assert skills.json()["data"] == {
        "project_id": project_id,
        "skills": [registry().list_skills()[0].model_dump(mode="json")],
    }
    assert agents.json()["request_id"]
    assert skills.json()["request_id"]


def test_catalog_routes_are_project_scoped_and_missing_projects_fail_closed(
    tmp_path: Path,
) -> None:
    client, _ = project_client(tmp_path)
    missing_project = f"prj_{'f' * 32}"

    agents = client.get(f"/api/v1/projects/{missing_project}/agents")
    skills = client.get(f"/api/v1/projects/{missing_project}/skills")

    assert agents.status_code == 404
    assert skills.status_code == 404
    assert agents.json()["error"]["code"] == "PROJECT_NOT_FOUND"
    assert skills.json()["error"]["code"] == "PROJECT_NOT_FOUND"


def test_agent_skill_catalog_openapi_is_read_only_typed_and_stable(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    schema = create_app(repository=repository, agent_skill_registry=registry()).openapi()

    agent_path = schema["paths"]["/api/v1/projects/{project_id}/agents"]
    skill_path = schema["paths"]["/api/v1/projects/{project_id}/skills"]
    assert set(agent_path) == {"get"}
    assert set(skill_path) == {"get"}
    assert agent_path["get"]["operationId"] == "listProjectAgents"
    assert skill_path["get"]["operationId"] == "listProjectSkills"
    assert agent_path["get"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AgentCatalogResponse"
    }
    assert skill_path["get"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SkillCatalogResponse"
    }
    json.dumps(schema, ensure_ascii=False, allow_nan=False)
