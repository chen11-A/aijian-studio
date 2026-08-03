"""FastAPI application composition root."""

from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from fastapi import FastAPI, Request, Response

from aijian_api import __version__
from aijian_api.contracts import HealthData, HealthResponse

REQUEST_ID_HEADER = "X-Request-ID"


def _request_id(value: str | None) -> UUID:
    if value is None:
        return uuid4()
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        return uuid4()


def create_app() -> FastAPI:
    """Create an isolated application instance for runtime and tests."""

    app = FastAPI(
        title="Aijian Studio API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    @app.middleware("http")
    async def attach_request_id(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request.state.request_id = _request_id(request.headers.get(REQUEST_ID_HEADER))
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = str(request.state.request_id)
        return response

    @app.get("/api/v1/health", operation_id="getHealth", response_model=HealthResponse)
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(
            data=HealthData(version=__version__),
            request_id=request.state.request_id,
        )

    return app


app = create_app()
