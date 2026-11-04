"""Path-bearing commands are accepted only through the authenticated native sidecar."""

from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from aijian_api.local_media_toolchain import LocalMediaToolchainService, LocalMediaToolchainStatus


class SelectLocalMediaToolchain(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    directory: Annotated[str, Field(min_length=1, max_length=4096)]


def create_local_media_toolchain_router(service: LocalMediaToolchainService) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/v1/local-media-toolchain/status",
        response_model=LocalMediaToolchainStatus,
        operation_id="getLocalMediaToolchainStatus",
    )
    def read_status() -> LocalMediaToolchainStatus:
        return service.status()

    @router.put(
        "/api/v1/local-media-toolchain/selection",
        response_model=LocalMediaToolchainStatus,
        operation_id="selectLocalMediaToolchain",
    )
    def select(command: SelectLocalMediaToolchain) -> LocalMediaToolchainStatus:
        return service.select(command.directory)

    @router.delete(
        "/api/v1/local-media-toolchain/selection",
        response_model=LocalMediaToolchainStatus,
        operation_id="clearLocalMediaToolchain",
    )
    def clear() -> LocalMediaToolchainStatus:
        return service.clear()

    return router
