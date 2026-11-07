"""Explicit per-project video failure configuration; no default count or prices."""

from collections.abc import Callable
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.generation_failure_store import GenerationFailureError, GenerationFailureStore
from aijian_api.repository import StudioRepository


class ConfigureGenerationFailure(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_revision: int = Field(ge=0, le=2**53 - 2)
    failure_limit: int = Field(ge=0, le=1000)


class GenerationFailurePolicyData(BaseModel):
    state: Literal["UNCONFIGURED", "CONFIGURED"]
    revision: int
    failure_limit: int | None
    scope: Literal["GROK_VIDEO_SUBMIT_FAILURES"] = "GROK_VIDEO_SUBMIT_FAILURES"


class StoryCreationFailurePolicyData(BaseModel):
    state: Literal["UNCONFIGURED", "CONFIGURED"]
    revision: int
    failure_limit: int | None
    scope: Literal["GROK_STORY_CREATION_FAILURES"] = "GROK_STORY_CREATION_FAILURES"


def create_generation_failure_router(
    repository: Callable[[], StudioRepository],
) -> APIRouter:
    router = APIRouter()

    def response(project_id: str) -> GenerationFailurePolicyData:
        try:
            policy = GenerationFailureStore(repository()).policy(project_id)
        except GenerationFailureError as error:
            raise HTTPException(404, "PROJECT_NOT_FOUND") from error
        return GenerationFailurePolicyData(
            state="UNCONFIGURED" if policy is None else "CONFIGURED",
            revision=0 if policy is None else policy.revision,
            failure_limit=None if policy is None else policy.failure_limit,
        )

    @router.get(
        "/api/v1/projects/{project_id}/generation-failure-policy",
        response_model=GenerationFailurePolicyData,
        operation_id="getGenerationFailurePolicy",
    )
    def read(
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
    ) -> GenerationFailurePolicyData:
        return response(project_id)

    @router.put(
        "/api/v1/projects/{project_id}/generation-failure-policy",
        response_model=GenerationFailurePolicyData,
        operation_id="configureGenerationFailurePolicy",
    )
    def configure(
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
        body: ConfigureGenerationFailure,
    ) -> GenerationFailurePolicyData:
        try:
            policy = GenerationFailureStore(repository()).configure(
                project_id,
                expected_revision=body.expected_revision,
                failure_limit=body.failure_limit,
            )
        except GenerationFailureError as error:
            raise HTTPException(
                404 if str(error) == "PROJECT_NOT_FOUND" else 409, str(error)
            ) from error
        return GenerationFailurePolicyData(
            state="CONFIGURED",
            revision=policy.revision,
            failure_limit=policy.failure_limit,
        )

    @router.get(
        "/api/v1/projects/{project_id}/story-creation-failure-policy",
        response_model=StoryCreationFailurePolicyData,
        operation_id="getStoryCreationFailurePolicy",
    )
    def read_creation(
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
    ) -> StoryCreationFailurePolicyData:
        try:
            policy = GenerationFailureStore(repository(), scope="story_creation").policy(project_id)
        except GenerationFailureError as error:
            raise HTTPException(404, "PROJECT_NOT_FOUND") from error
        return StoryCreationFailurePolicyData(
            state="UNCONFIGURED" if policy is None else "CONFIGURED",
            revision=0 if policy is None else policy.revision,
            failure_limit=None if policy is None else policy.failure_limit,
        )

    @router.put(
        "/api/v1/projects/{project_id}/story-creation-failure-policy",
        response_model=StoryCreationFailurePolicyData,
        operation_id="configureStoryCreationFailurePolicy",
    )
    def configure_creation(
        project_id: Annotated[str, Path(pattern=PROJECT_ID_PATTERN)],
        body: ConfigureGenerationFailure,
    ) -> StoryCreationFailurePolicyData:
        try:
            policy = GenerationFailureStore(repository(), scope="story_creation").configure(
                project_id,
                expected_revision=body.expected_revision,
                failure_limit=body.failure_limit,
            )
        except GenerationFailureError as error:
            raise HTTPException(
                404 if str(error) == "PROJECT_NOT_FOUND" else 409, str(error)
            ) from error
        return StoryCreationFailurePolicyData(
            state="CONFIGURED",
            revision=policy.revision,
            failure_limit=policy.failure_limit,
        )

    return router
