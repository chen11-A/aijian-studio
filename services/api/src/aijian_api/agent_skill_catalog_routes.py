"""Read-only, project-scoped Agent and Skill catalogs."""

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Request

from aijian_api.agent_skill_registry import AgentSkillRegistry
from aijian_api.contracts import (
    AgentCatalogData,
    AgentCatalogResponse,
    ErrorResponse,
    SkillCatalogData,
    SkillCatalogResponse,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
type RegistryProvider = Callable[[], AgentSkillRegistry]


def create_agent_skill_catalog_router(
    repository_provider: RepositoryProvider,
    registry_provider: RegistryProvider,
) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project not found", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/agents",
        operation_id="listProjectAgents",
        response_model=AgentCatalogResponse,
        responses=errors,
    )
    def list_project_agents(request: Request, project_id: str) -> AgentCatalogResponse:
        repository_provider().get_project(project_id)
        return AgentCatalogResponse(
            data=AgentCatalogData(
                project_id=project_id,
                agents=registry_provider().list_agents(),
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    @router.get(
        "/api/v1/projects/{project_id}/skills",
        operation_id="listProjectSkills",
        response_model=SkillCatalogResponse,
        responses=errors,
    )
    def list_project_skills(request: Request, project_id: str) -> SkillCatalogResponse:
        repository_provider().get_project(project_id)
        return SkillCatalogResponse(
            data=SkillCatalogData(
                project_id=project_id,
                skills=registry_provider().list_skills(),
            ),
            request_id=cast(UUID, request.state.request_id),
        )

    return router
