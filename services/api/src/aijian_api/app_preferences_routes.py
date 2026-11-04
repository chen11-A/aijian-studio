"""Authenticated local read and revision-guarded save for application preferences."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from aijian_api.app_preferences_contracts import (
    AppPreferencesResponse,
    SaveAppPreferencesRequest,
)
from aijian_api.app_preferences_store import (
    AppPreferencesCorruptError,
    AppPreferencesRevisionConflictError,
    AppPreferencesStore,
)
from aijian_api.contracts import ErrorBody, ErrorResponse

type StoreProvider = Callable[[], AppPreferencesStore]


def _error(request: Request, *, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content=ErrorResponse(
            error=ErrorBody(code=code, message=message, details={}, retryable=False),
            request_id=cast(UUID, request.state.request_id),
        ).model_dump(mode="json"),
    )


def create_app_preferences_router(store_provider: StoreProvider) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request rejected", "model": ErrorResponse},
        409: {"description": "Preferences revision or storage conflict", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/app-preferences",
        operation_id="getAppPreferences",
        response_model=AppPreferencesResponse,
        responses=errors,
    )
    def get_preferences(
        request: Request, response: Response
    ) -> AppPreferencesResponse | JSONResponse:
        try:
            data = store_provider().read()
        except AppPreferencesCorruptError:
            return _error(
                request,
                code="APP_PREFERENCES_INCONSISTENT",
                message="Saved preferences are inconsistent",
            )
        response.headers["Cache-Control"] = "no-store"
        response.headers["ETag"] = f'"revision-{data.revision}"'
        return AppPreferencesResponse(data=data, request_id=cast(UUID, request.state.request_id))

    @router.patch(
        "/api/v1/app-preferences",
        operation_id="saveAppPreferences",
        response_model=AppPreferencesResponse,
        responses=errors,
    )
    def save_preferences(
        request: Request,
        response: Response,
        payload: SaveAppPreferencesRequest,
    ) -> AppPreferencesResponse | JSONResponse:
        try:
            data = store_provider().save(payload)
        except AppPreferencesRevisionConflictError:
            return _error(
                request,
                code="APP_PREFERENCES_REVISION_CONFLICT",
                message="Preferences changed; reload before saving",
            )
        except AppPreferencesCorruptError:
            return _error(
                request,
                code="APP_PREFERENCES_INCONSISTENT",
                message="Saved preferences are inconsistent",
            )
        response.headers["Cache-Control"] = "no-store"
        response.headers["ETag"] = f'"revision-{data.revision}"'
        return AppPreferencesResponse(data=data, request_id=cast(UUID, request.state.request_id))

    return router
