"""Public provider connection routes with write-only credential input."""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Path, Request, Response, status

from aijian_api.contracts import ErrorResponse
from aijian_api.provider_connection_repository import ProviderModel
from aijian_api.provider_connections import (
    ProviderConnectionService,
    ProviderConnectionView,
)
from aijian_api.provider_contracts import (
    PROVIDER_CONNECTION_ID_PATTERN,
    PROVIDER_MUTATION_ID_PATTERN,
    CreateProviderConnectionRequest,
    EditSub2APIConnectionRequest,
    ProviderConnectionData,
    ProviderConnectionListResponse,
    ProviderConnectionResponse,
    ProviderModelData,
    ProviderRotationOperationData,
    ProviderRotationOperationResponse,
    RotateSub2APIKeyRequest,
)

type ProviderConnectionServiceProvider = Callable[[], ProviderConnectionService]


def _public_connection(view: ProviderConnectionView) -> ProviderConnectionData:
    connection = view.connection
    return ProviderConnectionData(
        id=connection.id,
        provider_kind=connection.provider_kind,
        display_name=connection.display_name,
        base_url=connection.base_url,
        origin_mode=connection.origin_mode,
        enabled=connection.enabled,
        models=[
            ProviderModelData(model_id=model.model_id, capabilities=list(model.capabilities))
            for model in connection.models
        ],
        credential_status=view.credential_status,
        revision=connection.revision,
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )


def create_provider_connection_router(
    service_provider: ProviderConnectionServiceProvider,
) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Local request boundary rejected", "model": ErrorResponse},
        409: {"description": "Provider connection conflicts", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
        503: {
            "description": "Operating-system credential vault unavailable",
            "model": ErrorResponse,
        },
    }

    @router.get(
        "/api/v1/provider-connections",
        operation_id="listProviderConnections",
        response_model=ProviderConnectionListResponse,
        responses=errors,
    )
    def list_provider_connections(request: Request) -> ProviderConnectionListResponse:
        return ProviderConnectionListResponse(
            data=[_public_connection(item) for item in service_provider().list()],
            request_id=request.state.request_id,
        )

    @router.post(
        "/api/v1/provider-connections",
        operation_id="createProviderConnection",
        response_model=ProviderConnectionResponse,
        status_code=status.HTTP_201_CREATED,
        responses=errors,
    )
    def create_provider_connection(
        payload: CreateProviderConnectionRequest,
        request: Request,
    ) -> ProviderConnectionResponse:
        api_key = payload.api_key.get_secret_value() if payload.api_key is not None else None
        view = service_provider().create(
            provider_kind=payload.provider_kind,
            display_name=payload.display_name,
            base_url=payload.base_url,
            enabled=payload.enabled,
            models=[
                ProviderModel(model_id=model.model_id, capabilities=tuple(model.capabilities))
                for model in payload.models
            ],
            api_key=api_key,
            origin_mode=payload.origin_mode,
        )
        return ProviderConnectionResponse(
            data=_public_connection(view),
            request_id=request.state.request_id,
        )

    @router.delete(
        "/api/v1/provider-connections/{connection_id}",
        operation_id="deleteProviderConnection",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
        responses={**errors, 404: {"description": "Provider not found", "model": ErrorResponse}},
    )
    def delete_provider_connection(
        connection_id: Annotated[str, Path(pattern=PROVIDER_CONNECTION_ID_PATTERN)],
    ) -> Response:
        service_provider().delete(connection_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.patch(
        "/api/v1/provider-connections/{connection_id}",
        operation_id="editSub2APIConnectionMetadata",
        response_model=ProviderConnectionResponse,
        responses={**errors, 404: {"description": "Provider not found", "model": ErrorResponse}},
    )
    def edit_sub2api_connection(
        connection_id: Annotated[str, Path(pattern=PROVIDER_CONNECTION_ID_PATTERN)],
        payload: EditSub2APIConnectionRequest,
        request: Request,
    ) -> ProviderConnectionResponse:
        view = service_provider().edit_sub2api(
            connection_id=connection_id,
            expected_revision=payload.expected_revision,
            display_name=payload.display_name,
            base_url=payload.base_url,
            origin_mode=payload.origin_mode,
            origin_mode_explicit="origin_mode" in payload.model_fields_set,
            enabled=payload.enabled,
            models=[
                ProviderModel(model_id=model.model_id, capabilities=tuple(model.capabilities))
                for model in payload.models
            ],
        )
        return ProviderConnectionResponse(
            data=_public_connection(view), request_id=request.state.request_id
        )

    @router.post(
        "/api/v1/provider-connections/{connection_id}/credential-rotations",
        operation_id="rotateSub2APIConnectionKey",
        response_model=ProviderConnectionResponse,
        responses={**errors, 404: {"description": "Provider not found", "model": ErrorResponse}},
    )
    def rotate_sub2api_key(
        connection_id: Annotated[str, Path(pattern=PROVIDER_CONNECTION_ID_PATTERN)],
        payload: RotateSub2APIKeyRequest,
        request: Request,
    ) -> ProviderConnectionResponse:
        view = service_provider().rotate_sub2api_key(
            connection_id=connection_id,
            expected_revision=payload.expected_revision,
            operation_id=payload.operation_id,
            api_key=payload.api_key.get_secret_value(),
        )
        return ProviderConnectionResponse(
            data=_public_connection(view), request_id=request.state.request_id
        )

    @router.get(
        "/api/v1/provider-connections/{connection_id}/credential-rotations/{operation_id}",
        operation_id="getSub2APIConnectionKeyRotation",
        response_model=ProviderRotationOperationResponse,
        responses={**errors, 404: {"description": "Rotation not found", "model": ErrorResponse}},
    )
    def get_sub2api_key_rotation(
        connection_id: Annotated[str, Path(pattern=PROVIDER_CONNECTION_ID_PATTERN)],
        operation_id: Annotated[str, Path(pattern=PROVIDER_MUTATION_ID_PATTERN)],
        request: Request,
    ) -> ProviderRotationOperationResponse:
        operation = service_provider().get_rotation_operation(
            connection_id=connection_id,
            operation_id=operation_id,
        )
        return ProviderRotationOperationResponse(
            data=ProviderRotationOperationData(
                operation_id=operation.operation_id,
                connection_id=operation.connection_id,
                expected_revision=operation.expected_revision,
                status=operation.status,
                applied_revision=operation.applied_revision,
                created_at=operation.created_at,
                updated_at=operation.updated_at,
            ),
            request_id=request.state.request_id,
        )

    return router
