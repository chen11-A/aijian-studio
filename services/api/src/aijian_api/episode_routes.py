"""Project-scoped Episode metadata endpoints."""

import sqlite3
from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Query, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from aijian_api.contracts import ErrorResponse
from aijian_api.episode_contracts import (
    EPISODE_ID_PATTERN,
    PROJECT_ID_PATTERN,
    CanonicalDecimal,
    CreateEpisodeRequest,
    EpisodeData,
    EpisodeListResponse,
    EpisodeResponse,
    parse_canonical_decimal,
)
from aijian_api.repository import StudioRepository

type RepositoryProvider = Callable[[], StudioRepository]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]


class EpisodeStorageError(RuntimeError):
    """A scoped safe failure for repository or persisted Episode incompatibility."""


def _episode_data(value: object) -> EpisodeData:
    try:
        return EpisodeData.model_validate(value)
    except (TypeError, ValueError, ValidationError) as error:
        raise EpisodeStorageError from error


def _repository_call(call: Callable[[], object]) -> object:
    try:
        return call()
    except sqlite3.Error as error:
        raise EpisodeStorageError from error


def _parse_offset(value: str) -> int:
    try:
        return parse_canonical_decimal(value, minimum=0, field_name="offset")
    except ValueError as error:
        raise RequestValidationError([]) from error


def create_episode_router(repository_provider: RepositoryProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Project or Episode not found", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        500: {"description": "Episode storage failed safely", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/episodes",
        operation_id="listEpisodes",
        response_model=EpisodeListResponse,
        responses=errors,
    )
    def list_episodes(
        request: Request,
        project_id: ProjectId,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: CanonicalDecimal = "0",
    ) -> EpisodeListResponse:
        parsed_offset = _parse_offset(offset)
        episodes = _repository_call(
            lambda: repository_provider().list_episodes(
                project_id, limit=limit, offset=parsed_offset
            )
        )
        return EpisodeListResponse(
            data=[_episode_data(episode) for episode in cast(list[object], episodes)],
            request_id=cast(UUID, request.state.request_id),
        )

    @router.post(
        "/api/v1/projects/{project_id}/episodes",
        operation_id="createEpisode",
        response_model=EpisodeResponse,
        status_code=status.HTTP_201_CREATED,
        responses=errors,
        description=(
            "A lost response after dispatch can still represent a successful creation. "
            "This endpoint provides no idempotency key, automatic retry, or title deduplication."
        ),
    )
    def create_episode(
        request: Request, project_id: ProjectId, payload: CreateEpisodeRequest
    ) -> EpisodeResponse:
        duration = (
            parse_canonical_decimal(
                payload.target_duration_seconds,
                minimum=1,
                field_name="target_duration_seconds",
            )
            if payload.target_duration_seconds is not None
            else None
        )
        episode = _repository_call(
            lambda: repository_provider().create_episode(
                project_id, title=payload.title, target_duration_seconds=duration
            )
        )
        return EpisodeResponse(
            data=_episode_data(episode), request_id=cast(UUID, request.state.request_id)
        )

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}",
        operation_id="getEpisode",
        response_model=EpisodeResponse,
        responses=errors,
    )
    def get_episode(
        request: Request, project_id: ProjectId, episode_id: EpisodeId
    ) -> EpisodeResponse:
        episode = _repository_call(
            lambda: repository_provider().get_episode(project_id, episode_id)
        )
        return EpisodeResponse(
            data=_episode_data(episode), request_id=cast(UUID, request.state.request_id)
        )

    return router
