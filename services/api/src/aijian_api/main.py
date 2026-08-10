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
from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_catalog_routes import create_agent_skill_catalog_router
from aijian_api.agent_skill_registry import AgentSkillRegistry
from aijian_api.application_errors import (
    PreconditionFailedError,
    PreconditionRequiredError,
    ProposalRunNotFoundError,
    StoryBiblePayloadTooLargeError,
)
from aijian_api.contracts import (
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
)
from aijian_api.credential_vault import (
    CredentialCleanupRequiredError,
    CredentialVault,
    CredentialVaultUnavailableError,
    SystemCredentialVault,
)
from aijian_api.domain import SourceDocument, TrustedReviewActor
from aijian_api.fake_timeline_workflow import (
    FakeTimelineWorkflowNotReadyError,
    SourceRequiredError,
)
from aijian_api.fake_timeline_workflow_routes import create_fake_timeline_workflow_router
from aijian_api.ingestion import SourceValidationError, ingest_text_file
from aijian_api.media_contracts import MediaCapabilitiesData, MediaCapabilitiesResponse
from aijian_api.proposal_run_routes import create_proposal_run_router
from aijian_api.provider_connection_repository import (
    ProviderConnectionConflictError,
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
)
from aijian_api.provider_connection_routes import create_provider_connection_router
from aijian_api.provider_connections import (
    ProviderConnectionService,
)
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    ArtifactNotFoundError,
    GateNotReadyError,
    ProjectNotFoundError,
    ReviewInvalidError,
    SourceAlreadyImportedError,
    SourceSpanInvalidError,
    StudioRepository,
)
from aijian_api.security import SecurityFailure, SidecarSecurity
from aijian_api.source_manifest_routes import (
    create_source_manifest_internal_router,
    create_source_manifest_public_router,
)
from aijian_api.story_bible_drafts import StoryBibleDraftInvalidError
from aijian_api.story_bible_routes import create_story_bible_public_router
from aijian_api.task_queue_read import TaskQueueReader
from aijian_api.task_queue_routes import create_task_queue_router
from aijian_api.timeline import TimelineEditError
from aijian_api.timeline_routes import (
    TimelineAlreadyExistsError,
    TimelineRevisionConflictError,
    create_timeline_router,
)

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


def create_app(
    *,
    sidecar_security: SidecarSecurity | None = None,
    repository: StudioRepository | None = None,
    review_actor: TrustedReviewActor | None = None,
    credential_vault: CredentialVault | None = None,
    agent_skill_registry: AgentSkillRegistry | None = None,
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
    trusted_review_actor = review_actor or TrustedReviewActor(
        subject_id="local-user",
        roles=("writer", "continuity_reviewer", "producer"),
    )
    resolved_credential_vault = credential_vault or SystemCredentialVault()
    resolved_agent_skill_registry = agent_skill_registry or AgentSkillRegistry(agents=(), skills=())

    def get_repository() -> StudioRepository:
        with repository_lock:
            repository_instance = repository_holder[0]
            if repository_instance is None:
                repository_instance = StudioRepository(_default_database_path())
                repository_holder[0] = repository_instance
            return repository_instance

    def get_task_queue_reader() -> TaskQueueReader:
        return TaskQueueReader(get_repository().database_path)

    def get_agent_run_store() -> AgentRunStore:
        return AgentRunStore(get_repository().database_path)

    def get_provider_connection_service() -> ProviderConnectionService:
        return ProviderConnectionService(
            ProviderConnectionRepository(get_repository().database_path),
            resolved_credential_vault,
        )

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

    @app.exception_handler(ProposalRunNotFoundError)
    async def proposal_run_not_found(
        request: Request, _error: ProposalRunNotFoundError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROPOSAL_RUN_NOT_FOUND",
            message="The requested proposal run was not found",
            request_id=request_id(request),
        )

    @app.exception_handler(ArtifactNotFoundError)
    async def artifact_not_found(request: Request, error: ArtifactNotFoundError) -> JSONResponse:
        code = {
            "source_manifest": "SOURCE_MANIFEST_NOT_FOUND",
            "story_bible": "STORY_BIBLE_NOT_FOUND",
            "timeline": "TIMELINE_NOT_FOUND",
        }.get(error.artifact_type, "ARTIFACT_NOT_FOUND")
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code=code,
            message="The requested artifact was not found",
            request_id=request_id(request),
        )

    @app.exception_handler(TimelineAlreadyExistsError)
    async def timeline_already_exists(
        request: Request, _error: TimelineAlreadyExistsError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="TIMELINE_ALREADY_EXISTS",
            message="The project timeline already exists",
            request_id=request_id(request),
        )

    @app.exception_handler(TimelineRevisionConflictError)
    async def timeline_revision_conflict(
        request: Request, _error: TimelineRevisionConflictError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="TIMELINE_REVISION_CONFLICT",
            message="The timeline revision has changed",
            request_id=request_id(request),
        )

    @app.exception_handler(TimelineEditError)
    async def timeline_edit_rejected(request: Request, error: TimelineEditError) -> JSONResponse:
        revision_conflict = str(error) == "timeline revision conflict"
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="TIMELINE_REVISION_CONFLICT" if revision_conflict else "TIMELINE_EDIT_REJECTED",
            message=(
                "The timeline revision has changed"
                if revision_conflict
                else "The timeline edit was rejected"
            ),
            request_id=request_id(request),
        )

    @app.exception_handler(SourceRequiredError)
    async def source_required(request: Request, _error: SourceRequiredError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="SOURCE_REQUIRED",
            message="Import a source before starting the preview workflow",
            request_id=request_id(request),
        )

    @app.exception_handler(FakeTimelineWorkflowNotReadyError)
    async def fake_workflow_not_ready(
        request: Request,
        _error: FakeTimelineWorkflowNotReadyError,
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="FAKE_WORKFLOW_NOT_READY",
            message="The preview workflow task is already being processed",
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

    @app.exception_handler(PreconditionRequiredError)
    async def precondition_required(
        request: Request, _error: PreconditionRequiredError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            code="PRECONDITION_REQUIRED",
            message="If-Match is required for this artifact action",
            request_id=request_id(request),
        )

    @app.exception_handler(PreconditionFailedError)
    async def precondition_failed(
        request: Request, _error: PreconditionFailedError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            code="PRECONDITION_FAILED",
            message="The artifact revision no longer matches",
            request_id=request_id(request),
        )

    @app.exception_handler(ArtifactConflictError)
    async def artifact_conflict(request: Request, _error: ArtifactConflictError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            code="PRECONDITION_FAILED",
            message="The artifact revision no longer matches",
            request_id=request_id(request),
        )

    @app.exception_handler(ArtifactDependencyInvalidError)
    async def artifact_dependency_invalid(
        request: Request, _error: ArtifactDependencyInvalidError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="ARTIFACT_DEPENDENCY_INVALID",
            message="The required accepted upstream artifact is not available",
            request_id=request_id(request),
        )

    @app.exception_handler(StoryBibleDraftInvalidError)
    async def story_bible_draft_invalid(
        request: Request, _error: StoryBibleDraftInvalidError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="STORY_BIBLE_INVALID",
            message="The StoryBible draft violates the canonical content rules",
            request_id=request_id(request),
        )

    @app.exception_handler(StoryBiblePayloadTooLargeError)
    async def story_bible_too_large(
        request: Request, _error: StoryBiblePayloadTooLargeError
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            code="STORY_BIBLE_TOO_LARGE",
            message="The StoryBible version exceeds the local desktop safety limit",
            request_id=request_id(request),
        )

    @app.exception_handler(SourceSpanInvalidError)
    async def source_span_invalid(request: Request, _error: SourceSpanInvalidError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code="SOURCE_SPAN_INVALID",
            message="A StoryBible source span is invalid",
            request_id=request_id(request),
        )

    @app.exception_handler(GateNotReadyError)
    async def gate_not_ready(request: Request, _error: GateNotReadyError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="GATE_NOT_READY",
            message="The artifact has blocking readiness checks",
            request_id=request_id(request),
        )

    @app.exception_handler(ReviewInvalidError)
    async def review_invalid(request: Request, _error: ReviewInvalidError) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="REVIEW_INVALID",
            message="The review action is not valid for the current artifact state",
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

    @app.exception_handler(ProviderConnectionConflictError)
    async def provider_connection_conflict(
        request: Request,
        _error: ProviderConnectionConflictError,
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_409_CONFLICT,
            code="PROVIDER_CONNECTION_CONFLICT",
            message="A provider connection with this name already exists",
            request_id=request_id(request),
        )

    @app.exception_handler(ProviderConnectionNotFoundError)
    async def provider_connection_not_found(
        request: Request,
        _error: ProviderConnectionNotFoundError,
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROVIDER_CONNECTION_NOT_FOUND",
            message="The provider connection was not found",
            request_id=request_id(request),
        )

    @app.exception_handler(CredentialCleanupRequiredError)
    async def credential_cleanup_required(
        request: Request,
        _error: CredentialCleanupRequiredError,
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="CREDENTIAL_CLEANUP_REQUIRED",
            message="A provider credential may require explicit cleanup",
            request_id=request_id(request),
        )

    @app.exception_handler(CredentialVaultUnavailableError)
    async def credential_vault_unavailable(
        request: Request,
        _error: CredentialVaultUnavailableError,
    ) -> JSONResponse:
        return _error_response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="CREDENTIAL_VAULT_UNAVAILABLE",
            message="The operating-system credential vault is unavailable",
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

    @app.get(
        "/api/v1/media/capabilities",
        operation_id="getMediaCapabilities",
        response_model=MediaCapabilitiesResponse,
        responses={
            401: {"description": "Sidecar authentication required", "model": ErrorResponse},
            403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        },
    )
    async def media_capabilities(request: Request) -> MediaCapabilitiesResponse:
        return MediaCapabilitiesResponse(
            data=MediaCapabilitiesData.phase0(),
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

    app.include_router(create_source_manifest_public_router(get_repository))
    app.include_router(create_story_bible_public_router(get_repository, trusted_review_actor))
    app.include_router(create_task_queue_router(get_task_queue_reader))
    app.include_router(
        create_agent_skill_catalog_router(
            get_repository,
            lambda: resolved_agent_skill_registry,
        )
    )
    app.include_router(create_proposal_run_router(get_agent_run_store))
    app.include_router(create_provider_connection_router(get_provider_connection_service))
    app.include_router(create_timeline_router(get_repository))
    app.include_router(create_fake_timeline_workflow_router(get_repository))
    if sidecar_security is not None:
        app.include_router(
            create_source_manifest_internal_router(get_repository, trusted_review_actor)
        )

    return app


app = create_app()
