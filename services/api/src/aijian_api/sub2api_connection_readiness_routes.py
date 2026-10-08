"""Authenticated readback of local Sub2API setup prerequisites."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.provider_connection_repository import ProviderConnectionNotFoundError
from aijian_api.provider_contracts import PROVIDER_CONNECTION_ID_PATTERN
from aijian_api.sub2api_connection_readiness import (
    Sub2APIConfiguredReadiness,
    Sub2APIConfiguredReadinessData,
)

type ReadinessProvider = Callable[[], Sub2APIConfiguredReadiness]


class Sub2APIConfiguredReadinessResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: Sub2APIConfiguredReadinessData
    request_id: UUID


def create_sub2api_connection_readiness_router(
    readiness_provider: ReadinessProvider,
) -> APIRouter:
    """Register only under the authenticated desktop sidecar branch."""
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        404: {"description": "Provider connection not found", "model": ErrorResponse},
        422: {"description": "Invalid model or connection id", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/provider-connections/{connection_id}/sub2api-configured-readiness",
        operation_id="readSub2APIConfiguredReadiness",
        response_model=Sub2APIConfiguredReadinessResponse,
        responses=errors,
    )
    def configured_readiness(
        request: Request,
        response: Response,
        connection_id: Annotated[str, Path(pattern=PROVIDER_CONNECTION_ID_PATTERN)],
        model_id: Annotated[str, Query(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")],
    ) -> Sub2APIConfiguredReadinessResponse | JSONResponse:
        try:
            data = readiness_provider().read(connection_id, model_id)
        except ProviderConnectionNotFoundError:
            payload = ErrorResponse(
                error=ErrorBody(
                    code="PROVIDER_CONNECTION_NOT_FOUND",
                    message="Provider connection was not found",
                    details={},
                    retryable=False,
                ),
                request_id=cast(UUID, request.state.request_id),
            )
            return JSONResponse(status_code=404, content=payload.model_dump(mode="json"))
        response.headers["Cache-Control"] = "no-store"
        return Sub2APIConfiguredReadinessResponse(
            data=data, request_id=cast(UUID, request.state.request_id),
        )

    return router
