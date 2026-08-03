"""FastAPI application composition root."""

import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from threading import Lock
from typing import Any, cast
from uuid import UUID, uuid4

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from aijian_api import __version__
from aijian_api.contracts import (
    ArtifactHeadData,
    CreateProjectRequest,
    ErrorBody,
    ErrorResponse,
    HealthData,
    HealthResponse,
    ImportTextSourceRequest,
    ProjectData,
    ProjectListResponse,
    ProjectResponse,
    SourceBlockData,
    SourceDocumentData,
    SourceDocumentListResponse,
    SourceDocumentResponse,
    SourceDocumentSummaryData,
    SourceManifestData,
    SourceManifestResponse,
    SourceManifestVersionData,
)
from aijian_api.domain import ArtifactVersionRecord, SourceDocument
from aijian_api.ingestion import SourceValidationError, ingest_text_file
from aijian_api.repository import (
    ArtifactNotFoundError,
    ProjectNotFoundError,
    SourceAlreadyImportedError,
    StudioRepository,
)
from aijian_api.security import SecurityFailure, SidecarSecurity
from aijian_api.source_manifest import SourceManifestContentV1

REQUEST_ID_HEADER = "X-Request-ID"


def _request_id(value: str | None) -> UUID:
    if value is None:
        return uuid4()
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        return uuid4()


def _error_response(*, status_code: int, code: str, message: str, request_id: UUID) -> JSONResponse:
    error = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=request_id,
    )
    return JSONResponse(status_code=status_code, content=error.model_dump(mode="json"))


def _security_error(code: SecurityFailure, request_id: UUID) -> JSONResponse:
    status_code = 401 if code == "SIDECAR_AUTH_REQUIRED" else 403
    message = (
        "Local sidecar authentication failed" if status_code == 401 else "Local request rejected"
    )
    return _error_response(
        status_code=status_code,
        code=code,
        message=message,
        request_id=request_id,
    )


def _apply_security_headers(response: Response, request_id: UUID) -> None:
    response.headers[REQUEST_ID_HEADER] = str(request_id)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"


def _default_database_path() -> Path:
    configured = os.environ.get("AIJIAN_DATA_DIR")
    data_directory = Path(configured) if configured else Path.cwd() / ".aijian-dev"
    return data_directory / "workspace.sqlite3"


def _source_document_data(document: SourceDocument) -> SourceDocumentData:
    return SourceDocumentData(
        id=document.id,
        project_id=document.project_id,
        filename=document.filename,
        media_type="text/plain",
        encoding="utf-8",
        byte_size=document.byte_size,
        raw_sha256=document.raw_sha256,
        imported_at=document.imported_at,
        chapter_count=document.chapter_count,
        block_count=len(document.blocks),
        blocks=[SourceBlockData.model_validate(block) for block in document.blocks],
    )


def _source_manifest_data(record: ArtifactVersionRecord) -> SourceManifestData:
    version = record.version
    return SourceManifestData(
        head=ArtifactHeadData.model_validate(record.head),
        latest_version=SourceManifestVersionData(
            id=version.id,
            artifact_id=version.artifact_id,
            version_number=version.version_number,
            schema_version="1.0.0",
            content=SourceManifestContentV1.model_validate(version.content),
            content_hash=version.content_hash,
            parent_version_id=version.parent_version_id,
            change_summary=version.change_summary,
            created_at=version.created_at,
        ),
    )


def create_app(
    *,
    sidecar_security: SidecarSecurity | None = None,
    repository: StudioRepository | None = None,
) -> FastAPI:
    """Create an isolated application instance for runtime and tests."""

    app = FastAPI(
        title="Aijian Studio API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    repository_holder = [repository]
    repository_lock = Lock()

    def get_repository() -> StudioRepository:
        with repository_lock:
            repository_instance = repository_holder[0]
            if repository_instance is None:
                repository_instance = StudioRepository(_default_database_path())
                repository_holder[0] = repository_instance
            return repository_instance

    def request_id(request: Request) -> UUID:
        return cast(UUID, request.state.request_id)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, _error: RequestValidationError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="VALIDATION_ERROR",
            message="Request validation failed",
            request_id=request_id(request),
        )

    @app.exception_handler(ProjectNotFoundError)
    async def project_not_found(request: Request, _error: ProjectNotFoundError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROJECT_NOT_FOUND",
            message="The requested project or source was not found",
            request_id=request_id(request),
        )

    @app.exception_handler(ArtifactNotFoundError)
    async def artifact_not_found(request: Request, error: ArtifactNotFoundError) -> JSONResponse:
        code = (
            "SOURCE_MANIFEST_NOT_FOUND"
            if error.artifact_type == "source_manifest"
            else "STORY_BIBLE_NOT_FOUND"
        )
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code=code,
            message="The requested artifact was not found",
            request_id=request_id(request),
        )

    @app.exception_handler(SourceAlreadyImportedError)
    async def source_already_imported(
        request: Request,
        _error: SourceAlreadyImportedError,
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="SOURCE_ALREADY_IMPORTED",
            message="This source is already part of the project",
            request_id=request_id(request),
        )

    @app.exception_handler(SourceValidationError)
    async def invalid_source(request: Request, error: SourceValidationError) -> JSONResponse:
        status_code = (
            status.HTTP_413_CONTENT_TOO_LARGE
            if error.code == "SOURCE_TOO_LARGE"
            else status.HTTP_400_BAD_REQUEST
        )
        return _error_response(
            status_code=status_code,
            code=error.code,
            message="The source file could not be imported",
            request_id=request_id(request),
        )

    @app.middleware("http")
    async def enforce_request_boundary(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request.state.request_id = _request_id(request.headers.get(REQUEST_ID_HEADER))
        if sidecar_security is not None:
            failure = sidecar_security.authorize(request)
            if failure is not None:
                security_response = _security_error(failure, request.state.request_id)
                _apply_security_headers(security_response, request.state.request_id)
                return security_response

        response = await call_next(request)
        _apply_security_headers(response, request.state.request_id)
        return response

    @app.get(
        "/api/v1/health",
        operation_id="getHealth",
        response_model=HealthResponse,
        responses={
            401: {"description": "Sidecar authentication required", "model": ErrorResponse},
            403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        },
    )
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(
            data=HealthData(version=__version__),
            request_id=request.state.request_id,
        )

    shared_errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @app.get(
        "/api/v1/projects",
        operation_id="listProjects",
        response_model=ProjectListResponse,
        responses=shared_errors,
    )
    def list_projects(request: Request) -> ProjectListResponse:
        projects = [
            ProjectData.model_validate(project) for project in get_repository().list_projects()
        ]
        return ProjectListResponse(data=projects, request_id=request_id(request))

    @app.post(
        "/api/v1/projects",
        operation_id="createProject",
        response_model=ProjectResponse,
        status_code=status.HTTP_201_CREATED,
        responses=shared_errors,
    )
    def create_project(request: Request, payload: CreateProjectRequest) -> ProjectResponse:
        project = get_repository().create_project(
            name=payload.name,
            aspect_ratio=payload.aspect_ratio,
            target_duration_seconds=payload.target_duration_seconds,
            source_language=payload.source_language,
        )
        return ProjectResponse(
            data=ProjectData.model_validate(project),
            request_id=request_id(request),
        )

    @app.get(
        "/api/v1/projects/{project_id}",
        operation_id="getProject",
        response_model=ProjectResponse,
        responses={
            **shared_errors,
            404: {"description": "Project not found", "model": ErrorResponse},
        },
    )
    def get_project(request: Request, project_id: str) -> ProjectResponse:
        project = get_repository().get_project(project_id)
        return ProjectResponse(
            data=ProjectData.model_validate(project),
            request_id=request_id(request),
        )

    @app.get(
        "/api/v1/projects/{project_id}/sources",
        operation_id="listSources",
        response_model=SourceDocumentListResponse,
        responses={
            **shared_errors,
            404: {"description": "Project not found", "model": ErrorResponse},
        },
    )
    def list_sources(request: Request, project_id: str) -> SourceDocumentListResponse:
        sources = [
            SourceDocumentSummaryData.model_validate(source)
            for source in get_repository().list_sources(project_id)
        ]
        return SourceDocumentListResponse(data=sources, request_id=request_id(request))

    @app.post(
        "/api/v1/projects/{project_id}/sources",
        operation_id="importTextSource",
        response_model=SourceDocumentResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            **shared_errors,
            400: {"description": "Invalid source file", "model": ErrorResponse},
            404: {"description": "Project not found", "model": ErrorResponse},
            409: {"description": "Source already imported", "model": ErrorResponse},
            413: {"description": "Source file too large", "model": ErrorResponse},
        },
    )
    def import_text_source(
        request: Request,
        project_id: str,
        payload: ImportTextSourceRequest,
    ) -> SourceDocumentResponse:
        parsed = ingest_text_file(filename=payload.filename, content=payload.decoded_content())
        document = get_repository().import_source(project_id, parsed)
        return SourceDocumentResponse(
            data=_source_document_data(document),
            request_id=request_id(request),
        )

    @app.get(
        "/api/v1/projects/{project_id}/sources/{source_id}",
        operation_id="getSource",
        response_model=SourceDocumentResponse,
        responses={
            **shared_errors,
            404: {"description": "Project or source not found", "model": ErrorResponse},
        },
    )
    def get_source(request: Request, project_id: str, source_id: str) -> SourceDocumentResponse:
        document = get_repository().get_source(project_id, source_id)
        return SourceDocumentResponse(
            data=_source_document_data(document),
            request_id=request_id(request),
        )

    @app.get(
        "/api/v1/projects/{project_id}/source-manifest",
        operation_id="getSourceManifest",
        response_model=SourceManifestResponse,
        responses={
            **shared_errors,
            404: {"description": "Project or SourceManifest not found", "model": ErrorResponse},
        },
    )
    def get_source_manifest(
        request: Request,
        response: Response,
        project_id: str,
    ) -> SourceManifestResponse:
        record = get_repository().get_latest_artifact(project_id, "source_manifest")
        response.headers["ETag"] = f'"revision-{record.head.revision}"'
        return SourceManifestResponse(
            data=_source_manifest_data(record),
            request_id=request_id(request),
        )

    return app


app = create_app()
