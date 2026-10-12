"""Authenticated read-only derivation of an exact saved native-preview plan."""

import sqlite3
from collections.abc import Callable
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Path, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aijian_api.assembly_storyboard_provenance import (
    AssemblyStoryboardReferenceError,
    validate_storyboard_provenance,
)
from aijian_api.contracts import ErrorBody, ErrorResponse
from aijian_api.episode_contracts import EPISODE_ID_PATTERN, PROJECT_ID_PATTERN
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_media_execution_plan import (
    MediaExecutionPlanError,
    build_assembly_execution_plan,
)
from aijian_api.episode_script_contracts import VERSION_ID_PATTERN
from aijian_api.media_asset_probe_store import (
    MediaAssetProbeEvidenceError,
    MediaAssetProbeEvidenceStore,
)
from aijian_api.media_execution_plan_contracts import MediaExecutionPlanReceiptV1
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactNotFoundError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    StudioRepository,
)


class MediaPreviewPlanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    data: MediaExecutionPlanReceiptV1
    request_id: UUID


def derive_native_preview_plan(
    repository: StudioRepository, project_id: str, episode_id: str, version_id: str
) -> MediaExecutionPlanReceiptV1:
    """Shared exact fresh derivation; private source preparation does not duplicate truth."""
    version = EpisodeMediaAssemblyStore(repository).read_version(
        project_id, episode_id, version_id=version_id
    )
    record = repository.get_artifact_version(
        project_id, "episode_media_assembly", version_id, episode_id=episode_id
    )
    with repository._connection() as connection:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        validate_storyboard_provenance(
            repository, connection, version.content, assembly_record=record, fresh=True
        )
        connection.commit()
    evidence = MediaAssetProbeEvidenceStore(repository)
    probes = {}
    for segment in version.content.visual_segments:
        if segment.media_kind == "video" and segment.media.asset_version_id not in probes:
            probe = evidence.read(
                project_id, segment.media.asset_id, segment.media.asset_version_id
            )
            if probe is not None:
                probes[segment.media.asset_version_id] = probe
    plan = build_assembly_execution_plan(version, probes)
    return MediaExecutionPlanReceiptV1(plan=plan, plan_hash=plan.plan_hash)


def create_media_preview_plan_router(provider: Callable[[], StudioRepository]) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-assembly/versions/{version_id}/native-preview-plan",
        operation_id="getNativeMediaPreviewPlan",
        response_model=MediaPreviewPlanResponse,
        responses={
            401: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    def read(
        request: Request,
        response: Response,
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
        episode_id: Annotated[str, Path(pattern=EPISODE_ID_PATTERN)],
        version_id: Annotated[str, Path(pattern=VERSION_ID_PATTERN)],
    ) -> MediaPreviewPlanResponse | JSONResponse:
        request_id = cast(UUID, request.state.request_id)

        def error(code: str, status: int) -> JSONResponse:
            payload = ErrorResponse(
                error=ErrorBody(
                    code=code,
                    message="Native preview plan is unavailable for this exact saved version",
                    details={},
                    retryable=False,
                ),
                request_id=request_id,
            )
            return JSONResponse(
                status_code=status,
                content=payload.model_dump(mode="json"),
                headers={"Cache-Control": "no-store"},
            )

        try:
            repository = provider()
            receipt = derive_native_preview_plan(repository, project_id, episode_id, version_id)
        except (
            ArtifactConflictError,
            ArtifactNotFoundError,
            EpisodeNotFoundError,
            ProjectNotFoundError,
        ):
            return error("ASSEMBLY_VERSION_NOT_FOUND", 404)
        except (
            EpisodeMediaAssemblyError,
            MediaExecutionPlanError,
            MediaAssetProbeEvidenceError,
            AssemblyStoryboardReferenceError,
        ) as failure:
            return error(failure.code, 409)
        except (sqlite3.Error, ValueError, OSError, RuntimeError):
            return error("NATIVE_PREVIEW_PLAN_UNKNOWN", 503)
        response.headers["Cache-Control"] = "no-store"
        return MediaPreviewPlanResponse(
            data=receipt,
            request_id=request_id,
        )

    return router
