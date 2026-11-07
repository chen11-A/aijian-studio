"""Authenticated, account-bound read/recover/export of original video attempts."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from pydantic import BaseModel, ConfigDict

from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.generation_dispatch_identity import account_attestation
from aijian_api.generation_failure_store import GenerationFailureError
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.repository import StudioRepository
from aijian_api.story_film import StoryFilmService
from aijian_api.video_recovery import VideoRecoveryService
from aijian_api.xai_media import XaiMediaClient, XaiTransport


class RecoveredVideoFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fileName: str
    sha256: str
    bytes: int


class VideoRecoveryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attemptId: str
    state: Literal["UNKNOWN", "RECOVERED"]
    file: RecoveredVideoFile | None = None


class VideoRecoveryList(BaseModel):
    kind: Literal["ATTEMPTS"] = "ATTEMPTS"
    items: list[VideoRecoveryItem]
    hasMore: bool


class VideoRecoveryResult(BaseModel):
    kind: Literal["RECOVERED", "UNKNOWN", "FAILED"]
    attemptId: str | None = None
    file: RecoveredVideoFile | None = None
    reason: Literal["WAITING", "UNREACHABLE", "NO_VALID_VIDEO", "PROVIDER_FAILED"] | None = None
    code: Literal["BUSY", "NOT_FOUND", "UNAVAILABLE", "WRITE_UNCONFIRMED"] | None = None


def create_video_recovery_router(
    repository: Callable[[], StudioRepository],
    tools: Callable[[], MediaToolchain],
    signing_key: str | None,
    transport: Callable[[], XaiTransport] | None = None,
) -> APIRouter:
    router = APIRouter()
    prefix = "/api/v1/projects/{project_id}/generation-video-recoveries"

    async def account(
        request: Request,
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
        key: Annotated[
            str, Header(alias="Idempotency-Key", pattern=r"^story-film:v1:[0-9a-f-]{36}$")
        ],
    ) -> str:
        identity = account_attestation(
            request.headers.get("X-Aivora-Generation-Account"),
            key=signing_key,
            project_id=project_id,
            idempotency_key=key,
            body=await request.body(),
            bearer=request.headers.get("X-Aivora-Media-Bearer"),
        )
        if identity is None:
            raise HTTPException(403, "ACCOUNT_UNAVAILABLE")
        return identity

    def service() -> VideoRecoveryService:
        repo = repository()
        return VideoRecoveryService(repo, StoryFilmService(repo, tools))

    @router.get(
        prefix,
        response_model=VideoRecoveryList,
        response_model_exclude_none=True,
        operation_id="listGenerationVideoRecoveries",
    )
    def list_attempts(project_id: str, identity: str = Depends(account)) -> dict[str, Any]:
        try:
            return service().list(project_id, identity)
        except GenerationFailureError as error:
            raise HTTPException(404, "NOT_FOUND") from error

    @router.get(
        prefix + "/{attempt_id}",
        response_model=VideoRecoveryResult,
        response_model_exclude_none=True,
        operation_id="getRecoveredGenerationVideo",
    )
    def describe(
        project_id: str,
        attempt_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")],
        identity: str = Depends(account),
    ) -> dict[str, Any]:
        try:
            return service().describe(project_id, identity, attempt_id)
        except (GenerationFailureError, OSError) as error:
            raise HTTPException(404, "NOT_FOUND") from error

    @router.post(
        prefix + "/{attempt_id}",
        response_model=VideoRecoveryResult,
        response_model_exclude_none=True,
        operation_id="recoverGenerationVideo",
    )
    def recover(
        request: Request,
        project_id: str,
        attempt_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")],
        identity: str = Depends(account),
    ) -> dict[str, Any]:
        from aijian_api.xai_media_transport import urllib_xai_transport

        client = XaiMediaClient(
            transport() if transport else urllib_xai_transport(),
            token=request.headers["X-Aivora-Media-Bearer"],
        )
        try:
            return service().recover(project_id, identity, attempt_id, client)
        except GenerationFailureError:
            return {"kind": "FAILED", "code": "NOT_FOUND"}
        except OSError:
            return {"kind": "FAILED", "code": "WRITE_UNCONFIRMED"}

    @router.get(prefix + "/{attempt_id}/file", operation_id="readRecoveredGenerationVideo")
    def read_file(
        project_id: str,
        attempt_id: Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")],
        identity: str = Depends(account),
    ) -> Response:
        try:
            data = service().bytes(project_id, identity, attempt_id)
        except (GenerationFailureError, OSError) as error:
            raise HTTPException(404, "NOT_FOUND") from error
        return Response(content=data, media_type="video/mp4")

    return router
