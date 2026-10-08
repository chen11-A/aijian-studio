"""Authenticated local probe/readback for one selected project media version."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from aijian_api.contracts import ErrorBody, ErrorResponse, PROJECT_ID_PATTERN
from aijian_api.domain import TrustedReviewActor
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN
from aijian_api.media_asset_probe_store import (
    MediaAssetProbeEvidence, MediaAssetProbeEvidenceError, MediaAssetProbeEvidenceStore,
)
from aijian_api.media_probe import LocalMediaProbeData, MediaProbeError
from aijian_api.media_toolchain import MediaToolchain, MediaToolchainError
from aijian_api.repository import StudioRepository
from aijian_api.runtime_resources import PackagedResourceError

type RepositoryProvider = Callable[[], StudioRepository]
type ToolchainProvider = Callable[[], MediaToolchain]
ProjectId = Annotated[str, Path(pattern=PROJECT_ID_PATTERN)]
AssetId = Annotated[str, Path(pattern=ASSET_ID_PATTERN)]
VersionId = Annotated[str, Path(pattern=ASSET_VERSION_ID_PATTERN)]


class MediaAssetProbeEvidenceData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^mpe_[0-9a-f]{32}$")
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    asset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    byte_size: int = Field(gt=0)
    probe_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    toolchain_profile_id: str
    toolchain_version: str
    ffmpeg_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    ffprobe_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    created_at: str
    probe: LocalMediaProbeData


class MediaAssetProbeEvidenceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: MediaAssetProbeEvidenceData
    request_id: UUID


def _data(evidence: MediaAssetProbeEvidence) -> MediaAssetProbeEvidenceData:
    return MediaAssetProbeEvidenceData(
        id=evidence.id, project_id=evidence.project_id, asset_id=evidence.asset_id,
        version_id=evidence.version_id, asset_sha256=evidence.asset_sha256,
        byte_size=evidence.byte_size, probe_sha256=evidence.probe_sha256,
        toolchain_profile_id=evidence.toolchain_profile_id,
        toolchain_version=evidence.toolchain_version,
        ffmpeg_sha256=evidence.ffmpeg_sha256, ffprobe_sha256=evidence.ffprobe_sha256,
        created_at=evidence.created_at, probe=evidence.probe,
    )


_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "Sidecar authentication required", "model": ErrorResponse},
    403: {"description": "Local request boundary rejected", "model": ErrorResponse},
    404: {"description": "Selected media version or evidence not found", "model": ErrorResponse},
    409: {"description": "Selected media or immutable evidence conflict", "model": ErrorResponse},
    422: {"description": "Media probe rejected the selected original", "model": ErrorResponse},
    503: {"description": "Pinned toolchain, probe, or storage is unavailable", "model": ErrorResponse},
}


def _error(request: Request, code: str, message: str, status_code: int) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=cast(UUID, request.state.request_id),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def create_media_asset_probe_router(
    repository_provider: RepositoryProvider,
    toolchain_provider: ToolchainProvider,
    trusted_actor: TrustedReviewActor,
) -> APIRouter:
    """Main must mount this only under the authenticated desktop sidecar."""

    router = APIRouter()
    url = "/api/v1/projects/{project_id}/assets/{asset_id}/versions/{version_id}/probe-evidence"

    @router.get(url, operation_id="getMediaAssetProbeEvidence",
                response_model=MediaAssetProbeEvidenceResponse, responses=_ERRORS)
    def read_evidence(
        request: Request, response: Response,
        project_id: ProjectId, asset_id: AssetId, version_id: VersionId,
    ) -> MediaAssetProbeEvidenceResponse | JSONResponse:
        try:
            evidence = MediaAssetProbeEvidenceStore(repository_provider()).read(
                project_id, asset_id, version_id,
            )
        except MediaAssetProbeEvidenceError as error:
            code = 404 if error.code == "ASSET_VERSION_NOT_FOUND" else 409
            return _error(request, error.code, str(error), code)
        except sqlite3.Error:
            return _error(request, "PROBE_READ_UNKNOWN", "Probe evidence could not be read", 503)
        if evidence is None:
            return _error(request, "PROBE_NOT_FOUND", "Probe evidence was not found", 404)
        response.headers["Cache-Control"] = "no-store"
        return MediaAssetProbeEvidenceResponse(
            data=_data(evidence), request_id=cast(UUID, request.state.request_id),
        )

    @router.post(url, operation_id="probeSelectedMediaAssetVersion",
                 response_model=MediaAssetProbeEvidenceResponse,
                 status_code=status.HTTP_201_CREATED, responses=_ERRORS)
    def probe_version(
        request: Request, response: Response,
        project_id: ProjectId, asset_id: AssetId, version_id: VersionId,
    ) -> MediaAssetProbeEvidenceResponse | JSONResponse:
        if "writer" not in trusted_actor.roles:
            return _error(request, "PROBE_ACTOR_FORBIDDEN", "Local user cannot probe media", 403)
        store = MediaAssetProbeEvidenceStore(repository_provider())
        try:
            store.read(project_id, asset_id, version_id)
        except MediaAssetProbeEvidenceError as error:
            code = 404 if error.code == "ASSET_VERSION_NOT_FOUND" else 409
            return _error(request, error.code, str(error), code)
        except sqlite3.Error:
            return _error(request, "PROBE_READ_UNKNOWN", "Selected media could not be read", 503)
        try:
            toolchain = toolchain_provider()
        except (MediaToolchainError, PackagedResourceError):
            return _error(request, "TOOLCHAIN_UNAVAILABLE", "Pinned media tools are unavailable", 503)
        try:
            evidence = store.probe_selected_video(
                project_id, asset_id, version_id, toolchain,
            )
        except MediaAssetProbeEvidenceError as error:
            code = 404 if error.code == "ASSET_VERSION_NOT_FOUND" else 409
            return _error(request, error.code, str(error), code)
        except MediaProbeError as error:
            return _error(request, f"MEDIA_PROBE_{error.code.value}", str(error), 422)
        except sqlite3.Error:
            return _error(request, "PROBE_WRITE_UNKNOWN", "Probe evidence write outcome is unknown", 503)
        response.headers["Cache-Control"] = "no-store"
        return MediaAssetProbeEvidenceResponse(
            data=_data(evidence), request_id=cast(UUID, request.state.request_id),
        )

    return router
