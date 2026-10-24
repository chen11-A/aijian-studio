"""Sidecar routes for the guided scene-to-film path."""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from aijian_api.contracts import ErrorResponse
from aijian_api.episode_contracts import PROJECT_ID_PATTERN
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.repository import StudioRepository
from aijian_api.story_film import (
    StoryFilmRequest,
    StoryFilmResult,
    StoryFilmService,
    StoryShot,
    film_progress,
    live_media_enabled,
    request_film_cancel,
)
from aijian_api.xai_media import IMAGE_MODEL, TTS_MODEL, VIDEO_MODEL

RepositoryProvider = Callable[[], StudioRepository]
ToolchainProvider = Callable[[], MediaToolchain]
_KEY = r"^story-film:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"


class StoryFilmProviderChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Literal["stub", "grok_subscription", "xai_api_key", "chatgpt"]
    label: str
    billing_label: str
    available: bool
    unavailable_reason: str | None = None
    fix: str | None = None


class StoryFilmPlanData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    live_media_enabled: bool
    default_provider: Literal["stub"] = "stub"
    providers: list[StoryFilmProviderChoice]


class StoryFilmPlanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryFilmPlanData
    request_id: UUID


class StoryShotBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    narration: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=400)
    subtitle: str = Field(default="", max_length=57)
    duration_seconds: int = Field(default=5, ge=1, le=15)
    regenerate: bool = False


class CreateStoryFilmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_label: str = Field(min_length=1, max_length=80)
    narration: str = Field(min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=57)
    provider: Literal["stub", "grok_subscription", "xai_api_key", "chatgpt"] = "stub"
    confirmed: bool = False
    image_model: str = Field(default=IMAGE_MODEL, min_length=1, max_length=200)
    video_model: str = Field(default=VIDEO_MODEL, min_length=1, max_length=200)
    speech_model: str = Field(default=TTS_MODEL, min_length=1, max_length=200)
    voice_id: str = Field(default="eve", min_length=1, max_length=64)
    connection_revision: str = Field(default="unspecified", min_length=1, max_length=80)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    amount_micro: int | None = Field(default=None, ge=0)
    regenerate: bool = False
    shots: list[StoryShotBody] = Field(default_factory=list, max_length=10)


class StoryFilmData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["SUCCEEDED", "BLOCKED", "FAILED"]
    message: str
    provider_label: str
    billing_label: str
    suggested_provider: Literal["stub", "grok_subscription"] | None = None
    fix: str | None = None
    task_id: str | None = None
    attempt_id: str | None = None
    artifact_version_id: str | None = None
    output_path: str | None = None
    output_sha256: str | None = None
    duration_seconds: str | None = None
    has_video: bool = False
    has_audio: bool = False
    draft: bool = True
    live_call: bool = False
    preview_image: str | None = None


class StoryFilmProgressData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: Literal["idle", "image", "video", "speech", "assemble", "done", "failed"]
    label: str
    elapsed_seconds: int
    image_saved: bool
    message: str
    preview_image: str | None = None


class StoryFilmProgressResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryFilmProgressData
    request_id: UUID


class StoryFilmCancelData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cancel_requested: bool = True


class StoryFilmCancelResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryFilmCancelData
    request_id: UUID


class StoryFilmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: StoryFilmData
    request_id: UUID


def story_film_plan() -> StoryFilmPlanData:
    live = live_media_enabled()
    return StoryFilmPlanData(
        live_media_enabled=live,
        providers=[
            StoryFilmProviderChoice(
                id="stub",
                label="本地占位",
                billing_label="不花钱",
                available=True,
                fix=None,
            ),
            StoryFilmProviderChoice(
                id="grok_subscription",
                label="Grok 订阅",
                billing_label="包含在订阅里，不另收费",
                available=live,
                unavailable_reason=None if live else "当前环境不会发起真实生成。",
                fix=None
                if live
                else "可以先用本地占位做成片。登录 Grok 后，在你自己的电脑上再试真实生成。",
            ),
            StoryFilmProviderChoice(
                id="xai_api_key",
                label="xAI API Key",
                billing_label="按量计费，会花钱",
                available=False,
                unavailable_reason="按量调用会先检查预算，但这一版不会真正扣费。",
                fix="请改用 Grok 订阅，或先用本地占位做成片。",
            ),
            StoryFilmProviderChoice(
                id="chatgpt",
                label="ChatGPT 登录",
                billing_label="不能生成画面和声音",
                available=False,
                unavailable_reason="ChatGPT 登录可以写故事，还不能生成画面、视频和配音。",
                fix="请改用 Grok 账号，或先用本地占位做成片。",
            ),
        ],
    )


def create_story_film_router(
    repository_provider: RepositoryProvider,
    toolchain_provider: ToolchainProvider,
) -> APIRouter:
    router = APIRouter()
    errors: dict[int | str, dict[str, Any]] = {
        401: {"description": "Sidecar authentication required", "model": ErrorResponse},
        403: {"description": "Sidecar request boundary rejected", "model": ErrorResponse},
        422: {"description": "Request validation failed", "model": ErrorResponse},
    }

    @router.get(
        "/api/v1/projects/{project_id}/story-film/plan",
        operation_id="getStoryFilmPlan",
        response_model=StoryFilmPlanResponse,
        responses=errors,
    )
    def get_plan(
        request: Request, project_id: Annotated[str, Field(pattern=PROJECT_ID_PATTERN)]
    ) -> StoryFilmPlanResponse:
        _ = project_id
        return StoryFilmPlanResponse(data=story_film_plan(), request_id=request.state.request_id)

    @router.get(
        "/api/v1/projects/{project_id}/story-film/progress",
        operation_id="getStoryFilmProgress",
        response_model=StoryFilmProgressResponse,
        responses=errors,
    )
    def get_progress(
        request: Request, project_id: Annotated[str, Field(pattern=PROJECT_ID_PATTERN)]
    ) -> StoryFilmProgressResponse:
        current = film_progress(project_id)
        return StoryFilmProgressResponse(
            data=StoryFilmProgressData.model_validate(current),
            request_id=request.state.request_id,
        )

    @router.post(
        "/api/v1/projects/{project_id}/story-film/cancel",
        operation_id="cancelStoryFilm",
        response_model=StoryFilmCancelResponse,
        responses=errors,
    )
    def cancel_film(
        request: Request, project_id: Annotated[str, Field(pattern=PROJECT_ID_PATTERN)]
    ) -> StoryFilmCancelResponse:
        request_film_cancel(project_id)
        return StoryFilmCancelResponse(
            data=StoryFilmCancelData(), request_id=request.state.request_id
        )

    @router.post(
        "/api/v1/projects/{project_id}/story-film",
        operation_id="createStoryFilm",
        response_model=StoryFilmResponse,
        responses=errors,
    )
    def create_film(
        request: Request,
        project_id: Annotated[str, Field(pattern=PROJECT_ID_PATTERN)],
        payload: CreateStoryFilmBody,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", pattern=_KEY)],
    ) -> StoryFilmResponse:
        token = request.headers.get("X-Aivora-Media-Bearer")
        if token is not None:
            token = token.strip()
            if not token or len(token) > 8192 or any(ord(character) < 32 for character in token):
                token = None
        result = StoryFilmService(repository_provider(), toolchain_provider).produce(
            project_id,
            StoryFilmRequest(
                scene_label=payload.scene_label.strip(),
                narration=payload.narration.strip(),
                subtitle=payload.subtitle.strip() if payload.subtitle else None,
                provider=payload.provider,
                confirmed=payload.confirmed,
                image_model=payload.image_model,
                video_model=payload.video_model,
                speech_model=payload.speech_model,
                voice_id=payload.voice_id,
                connection_revision=payload.connection_revision,
                currency=payload.currency,
                amount_micro=payload.amount_micro,
                idempotency_key=idempotency_key,
                regenerate=payload.regenerate,
                shots=tuple(
                    StoryShot(
                        narration=shot.narration.strip(),
                        prompt=shot.prompt.strip(),
                        duration_seconds=shot.duration_seconds,
                        subtitle=shot.subtitle.strip(),
                        regenerate=shot.regenerate,
                    )
                    for shot in payload.shots
                ),
            ),
            media_token=token,
        )
        return StoryFilmResponse(data=_data(result), request_id=request.state.request_id)

    return router


def _data(result: StoryFilmResult) -> StoryFilmData:
    return StoryFilmData(
        status=result.status,
        message=result.message,
        provider_label=result.provider_label,
        billing_label=result.billing_label,
        suggested_provider=result.suggested_provider,
        fix=result.fix,
        task_id=result.task_id,
        attempt_id=result.attempt_id,
        artifact_version_id=result.artifact_version_id,
        output_path=result.output_path,
        output_sha256=result.output_sha256,
        duration_seconds=result.duration_seconds,
        has_video=result.has_video,
        has_audio=result.has_audio,
        draft=result.draft,
        live_call=result.live_call,
        preview_image=result.preview_image,
    )
