"""Authenticated, project-scoped product export claim and receipt routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.media_toolchain import MediaToolchainError
from aijian_api.product_export_claim import ProductExportClaimError
from aijian_api.product_export_contracts import (
    PRODUCT_EXPORT_OPERATION_ID_PATTERN,
    ProductExportClaimRequest,
    ProductExportOperationData,
)
from aijian_api.product_export_runtime import ProductExportRuntime
from aijian_api.product_export_single_video_service import ProductExportExecutionError
from aijian_api.product_export_store import ProductExportStateError
from aijian_api.product_timeline_export_contracts import (
    EPISODE_ID_PATTERN,
    PROJECT_ID_PATTERN,
)

type RuntimeProvider = Callable[[], ProductExportRuntime]
type ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
type EpisodeId = Annotated[str, Path(pattern=EPISODE_ID_PATTERN)]
type OperationId = Annotated[str, Path(pattern=PRODUCT_EXPORT_OPERATION_ID_PATTERN)]


class ProductExportOperationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: ProductExportOperationData
    request_id: UUID


_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
    404: {"description": "Product export operation not found", "model": ErrorResponse},
    409: {"description": "Product export claim or receipt conflict", "model": ErrorResponse},
    422: {"description": "Invalid product export request", "model": ErrorResponse},
    503: {"description": "Product export cannot safely proceed", "model": ErrorResponse},
}
_SUBMIT_RESPONSES = {
    **_ERRORS,
    200: {"description": "Existing final operation returned", "model": ProductExportOperationResponse},
}


def _error(request: Request, *, status_code: int, code: str, message: str) -> JSONResponse:
    envelope = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=cast(UUID, request.state.request_id),
    )
    return JSONResponse(status_code=status_code, content=envelope.model_dump(mode="json"))


def _receipt(request: Request, data: ProductExportOperationData) -> ProductExportOperationResponse:
    return ProductExportOperationResponse(
        data=data,
        request_id=cast(UUID, request.state.request_id),
    )


def create_product_export_operation_router(runtime_provider: RuntimeProvider) -> APIRouter:
    """Register only with an owner-lock-held sidecar runtime."""
    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/product-exports",
        operation_id="submitProductExport",
        response_model=ProductExportOperationResponse,
        status_code=status.HTTP_202_ACCEPTED,
        responses=_SUBMIT_RESPONSES,
    )
    def submit_product_export(
        request: Request,
        response: Response,
        project_id: ProjectId,
        episode_id: EpisodeId,
        payload: ProductExportClaimRequest,
    ) -> ProductExportOperationResponse | JSONResponse:
        try:
            data = runtime_provider().submit(project_id, episode_id, payload)
        except ProductExportClaimError as error:
            return _error(
                request, status_code=409, code=error.code,
                message="Product export claim was rejected",
            )
        except MediaToolchainError:
            return _error(
                request, status_code=503, code="PRODUCT_EXPORT_TOOLCHAIN_UNAVAILABLE",
                message="Product export toolchain is unavailable",
            )
        except ProductExportExecutionError as error:
            if error.code == "SHUTTING_DOWN":
                return _error(
                    request, status_code=503, code="PRODUCT_EXPORT_SHUTTING_DOWN",
                    message="Product export is shutting down",
                )
            return _error(
                request, status_code=503, code="PRODUCT_EXPORT_SUBMISSION_UNKNOWN",
                message="Submission outcome is unknown; read the operation before any further action",
            )
        except Exception:
            # A claim may already exist. Callers must inspect this operation ID;
            # another POST must not be treated as an automatic retry.
            return _error(
                request, status_code=503, code="PRODUCT_EXPORT_SUBMISSION_UNKNOWN",
                message="Submission outcome is unknown; read the operation before any further action",
            )
        if data.status in {"SUCCEEDED", "UNKNOWN", "CANCELLED"}:
            response.status_code = status.HTTP_200_OK
        return _receipt(request, data)

    @router.get(
        "/api/v1/projects/{project_id}/product-exports/{operation_id}",
        operation_id="getProductExportOperation",
        response_model=ProductExportOperationResponse,
        responses=_ERRORS,
    )
    def get_product_export_operation(
        request: Request,
        project_id: ProjectId,
        operation_id: OperationId,
    ) -> ProductExportOperationResponse | JSONResponse:
        try:
            return _receipt(request, runtime_provider().get(project_id, operation_id))
        except ProductExportExecutionError:
            return _error(
                request, status_code=503, code="PRODUCT_EXPORT_SHUTTING_DOWN",
                message="Product export is shutting down",
            )
        except ProductExportStateError as error:
            if error.code == "NOT_FOUND":
                return _error(
                    request, status_code=404, code="PRODUCT_EXPORT_OPERATION_NOT_FOUND",
                    message="The requested product export operation was not found",
                )
            return _error(
                request, status_code=409, code="PRODUCT_EXPORT_RECEIPT_INCONSISTENT",
                message="The stored product export receipt is inconsistent",
            )

    @router.post(
        "/api/v1/projects/{project_id}/product-exports/{operation_id}/cancellations",
        operation_id="requestProductExportCancellation",
        response_model=ProductExportOperationResponse,
        responses=_ERRORS,
    )
    def request_product_export_cancellation(
        request: Request,
        project_id: ProjectId,
        operation_id: OperationId,
    ) -> ProductExportOperationResponse | JSONResponse:
        try:
            return _receipt(request, runtime_provider().request_cancel(project_id, operation_id))
        except ProductExportExecutionError:
            return _error(
                request, status_code=503, code="PRODUCT_EXPORT_SHUTTING_DOWN",
                message="Product export is shutting down",
            )
        except ProductExportStateError as error:
            if error.code == "NOT_FOUND":
                return _error(
                    request, status_code=404, code="PRODUCT_EXPORT_OPERATION_NOT_FOUND",
                    message="The requested product export operation was not found",
                )
            return _error(
                request, status_code=409, code="PRODUCT_EXPORT_RECEIPT_INCONSISTENT",
                message="The stored product export receipt is inconsistent",
            )

    return router
