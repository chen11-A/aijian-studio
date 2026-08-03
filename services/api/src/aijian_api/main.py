"""FastAPI application composition root."""

from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from aijian_api import __version__
from aijian_api.contracts import ErrorBody, ErrorResponse, HealthData, HealthResponse
from aijian_api.security import SecurityFailure, SidecarSecurity

REQUEST_ID_HEADER = "X-Request-ID"


def _request_id(value: str | None) -> UUID:
    if value is None:
        return uuid4()
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        return uuid4()


def _security_error(code: SecurityFailure, request_id: UUID) -> JSONResponse:
    status_code = 401 if code == "SIDECAR_AUTH_REQUIRED" else 403
    message = (
        "Local sidecar authentication failed" if status_code == 401 else "Local request rejected"
    )
    error = ErrorResponse(
        error=ErrorBody(code=code, message=message, details={}, retryable=False),
        request_id=request_id,
    )
    return JSONResponse(status_code=status_code, content=error.model_dump(mode="json"))


def _apply_security_headers(response: Response, request_id: UUID) -> None:
    response.headers[REQUEST_ID_HEADER] = str(request_id)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"


def create_app(*, sidecar_security: SidecarSecurity | None = None) -> FastAPI:
    """Create an isolated application instance for runtime and tests."""

    app = FastAPI(
        title="Aijian Studio API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
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

    return app


app = create_app()
