"""FastAPI router for controlled XAI saved-connection image generation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from aijian_api.credential_vault import CredentialVault
from aijian_api.repository import StudioRepository
from aijian_api.xai_connection_image import (
    ImageDispatchStatus,
    XaiConnectionImageRequest,
    XaiConnectionImageResult,
    XaiConnectionImageService,
)


class XaiConnectionImageCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_id: str = Field(min_length=1, max_length=200)
    model_id: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=4000)
    idempotency_key: str = Field(min_length=1, max_length=200)
    aspect_ratio: Literal["9:16", "16:9", "1:1"] | None = None
    reference_images: list[str] = Field(default_factory=list, max_length=5)


class XaiConnectionImageData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ImageDispatchStatus
    code: str
    message: str
    connection_id: str
    model_id: str
    attempt_id: str | None = None
    asset_path: str | None = None
    asset_sha256: str | None = None
    mime_type: str | None = None
    byte_size: int | None = None


class XaiConnectionImageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: XaiConnectionImageData
    request_id: str


def _serialize(result: XaiConnectionImageResult) -> XaiConnectionImageData:
    return XaiConnectionImageData(
        status=result.status,
        code=result.code,
        message=result.message,
        connection_id=result.connection_id,
        model_id=result.model_id,
        attempt_id=result.attempt_id,
        asset_path=result.asset_path,
        asset_sha256=result.asset_sha256,
        mime_type=result.mime_type,
        byte_size=result.byte_size,
    )


def create_xai_connection_image_router(
    repository_provider: Callable[[], StudioRepository],
    credential_vault_provider: Callable[[], CredentialVault],
) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/api/v1/projects/{project_id}/xai-connection-images",
        response_model=XaiConnectionImageResponse,
    )
    def create_xai_connection_image(
        project_id: str,
        payload: XaiConnectionImageCreatePayload,
        request: Request,
    ) -> XaiConnectionImageResponse:
        service = XaiConnectionImageService(
            repository_provider(),
            credential_vault_provider(),
        )
        result = service.generate(
            project_id,
            XaiConnectionImageRequest(
                connection_id=payload.connection_id,
                model_id=payload.model_id,
                prompt=payload.prompt,
                idempotency_key=payload.idempotency_key,
                aspect_ratio=payload.aspect_ratio,
                reference_images=tuple(payload.reference_images),
            ),
        )
        return XaiConnectionImageResponse(
            data=_serialize(result),
            request_id=str(request.state.request_id),
        )

    return router
