"""Shortest scene-to-MP4 path on the existing task, artifact, and export ledgers.

The default provider is a local FFmpeg placeholder. Subscription logins are
recorded as zero-amount authorizations before any live call. Metered requests
stop at the budget assessment and are not sent upstream: the budget ledger's
dispatch receipt is defined as a no-network stub, so this path will not pretend
a paid call happened.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import uuid4

from aijian_api.artifacts import canonical_content_hash
from aijian_api.desktop_subscription_dispatch import (
    DesktopSubscriptionDispatchError,
    DesktopSubscriptionRequest,
    record_desktop_subscription_dispatch,
)
from aijian_api.dispatch_billing import budget_display_reason
from aijian_api.draft_export_contracts import CreateDraftExportRequest, DraftExportJob
from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
from aijian_api.draft_subtitles import DraftSubtitleError, prepare_subtitles
from aijian_api.episode_media_assembly_contracts import (
    ASSEMBLY_ARTIFACT_TYPE,
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
    EpisodeMediaAssemblyVersionData,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.grok_status_log import append_grok_status
from aijian_api.media_asset_contracts import MediaAssetData
from aijian_api.media_asset_store import MediaAssetError, MediaAssetStore
from aijian_api.media_budget_policy import BudgetAmount, evaluate_media_budget
from aijian_api.media_budget_store import MediaBudgetStore
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.repository import StudioRepository
from aijian_api.shot_pipeline import keyframe_prompt, video_prompt
from aijian_api.shot_plan import AI_GENERATED_NOTE
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import QueuedTask
from aijian_api.xai_media import (
    IMAGE_MODEL,
    TTS_MODEL,
    VIDEO_MODEL,
    XaiImage,
    XaiMediaClient,
    XaiMediaError,
    XaiTransport,
)

ProviderKind = Literal["stub", "grok_subscription", "xai_api_key", "chatgpt"]
FilmStatus = Literal["SUCCEEDED", "BLOCKED", "FAILED"]
DEFINITION_ID = "story-film.scene-to-mp4"
DEFINITION_VERSION = 1
NODE_KEY = "story_film"
TASK_KIND = "local.story_film.v1"
_GRAPH = {"nodes": [NODE_KEY], "intent": "scene-to-mp4"}
_DEFINITION_HASH = canonical_content_hash(_GRAPH)
_FRAME_RATE = 24
_CANVAS = (160, 90)
_LOUDNESS_I = -16
_LOUDNESS_TP = -1.5
_LOUDNESS_LRA = 11
_NARRATION_TAIL_SECONDS = 0.5
_CROSSFADE_SECONDS = 0.4


class StoryFilmError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        ffmpeg_stage: str | None = None,
        exit_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.ffmpeg_stage = ffmpeg_stage
        self.exit_code = exit_code


@dataclass(frozen=True, slots=True)
class StoryShot:
    narration: str
    prompt: str
    duration_seconds: int
    subtitle: str
    regenerate: bool = False
    size: str = ""
    angle: str = ""
    move: str = ""
    action: str = ""
    performance: str = ""
    identity: str = ""


@dataclass(frozen=True, slots=True)
class StoryFilmRequest:
    scene_label: str
    narration: str
    subtitle: str | None
    provider: ProviderKind
    confirmed: bool
    image_model: str
    video_model: str
    speech_model: str
    voice_id: str
    connection_revision: str
    currency: str | None
    amount_micro: int | None
    idempotency_key: str
    regenerate: bool = False
    shots: tuple[StoryShot, ...] = ()
    visual_prompt: str = ""
    style_block: str = ""


@dataclass(frozen=True, slots=True)
class StoryFilmResult:
    status: FilmStatus
    message: str
    provider_label: str
    billing_label: str
    suggested_provider: Literal["stub", "grok_subscription"] | None
    fix: str | None
    task_id: str | None
    attempt_id: str | None
    artifact_version_id: str | None
    output_path: str | None
    output_sha256: str | None
    duration_seconds: str | None
    has_video: bool
    has_audio: bool
    draft: bool
    live_call: bool
    preview_image: str | None = None


def live_media_enabled() -> bool:
    """Real generation stays off in CI and whenever this process forbids it."""

    if os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("CI") == "true":
        return False
    if os.environ.get("AIJIAN_FORBID_LIVE_MEDIA") == "1":
        return False
    return os.environ.get("AIJIAN_ALLOW_LIVE_MEDIA") == "1"


def provider_copy(provider: ProviderKind) -> tuple[str, str]:
    if provider == "stub":
        return "本地占位", "不花钱"
    if provider == "grok_subscription":
        return "Grok 订阅", "包含在订阅里，不另收费"
    if provider == "xai_api_key":
        return "xAI API Key", "按量计费，会花钱"
    return "ChatGPT 登录", "这个登录不能生成画面和声音"


class StoryFilmService:
    def __init__(
        self,
        repository: StudioRepository,
        toolchain_provider: Callable[[], MediaToolchain],
        *,
        transport: XaiTransport | None = None,
    ) -> None:
        self._repository = repository
        self._toolchain_provider = toolchain_provider
        self._transport = transport
        self._ledger = LocalTaskLedger(repository.database_path)
        self._sleep = time.sleep
        self._partial_note: str | None = None
        self._reuse_note: str | None = None
        self._shot_captions: list[tuple[str, float, float]] | None = None

    def produce(
        self,
        project_id: str,
        request: StoryFilmRequest,
        *,
        media_token: str | None = None,
    ) -> StoryFilmResult:
        self._partial_note = None
        self._reuse_note = None
        self._shot_captions = None
        clear_film_cancel(project_id)
        provider_label, billing_label = provider_copy(request.provider)
        blocked = self._preflight(project_id, request, media_token)
        if blocked is not None:
            return blocked
        if request.provider == "grok_subscription":
            recorded = self._record_subscription(project_id, request)
            if recorded is not None:
                return recorded
        try:
            queued = self._enqueue(project_id, request)
        except (ValueError, StoryFilmError) as error:
            return _blocked(
                str(error) if str(error) else "这次生成没有排上队。",
                provider_label,
                billing_label,
                "stub",
                "可以改用本地占位再试一次。",
            )
        if not queued.created:
            return _blocked(
                "同一次生成已经提交过。请重新开始一次，不要重复提交。",
                provider_label,
                billing_label,
                None,
                None,
            )
        claim = self._ledger.claim_ready_task(
            worker_id="story-film",
            lease_duration=timedelta(minutes=5),
            task_id=queued.task_id,
            task_kind=TASK_KIND,
        )
        if claim is None:
            return _failed(
                "生成任务没有开始。", provider_label, billing_label, queued.task_id, None
            )
        running = self._ledger.mark_attempt_running(claim)
        live_call = False
        try:
            if request.shots:
                image, clip, speech = self._shots_media(request, media_token, project_id)
                live_call = request.provider == "grok_subscription"
            elif request.provider == "grok_subscription":
                live_call = True
                image, clip, speech = self._live_media(request, media_token, project_id)
            else:
                image, clip, speech = self._placeholder_media(request)
            result = self._assemble_and_export(
                project_id,
                request,
                running.attempt_id,
                image,
                clip,
                speech,
            )
        except Exception as error:
            try:
                self._ledger.fail_local_task(running, error_code="STORY_FILM_FAILED")
            except Exception:
                pass
            grok = request.provider == "grok_subscription"
            progress = film_progress(project_id)
            saved = bool(progress.get("image_saved"))
            stage = str(progress.get("stage") or "image")
            made = self._saved_bundle(project_id, request) is not None
            message = _failure_message(error, stage, saved, made)
            mark_film_progress(project_id, "failed", message)
            preview = progress.get("preview_image")
            if grok:
                code = _failure_log_code(error)
                failure_stage = getattr(error, "ffmpeg_stage", None) or _failure_stage(
                    "assemble" if made else stage
                )
                append_grok_status(
                    _failure_event("assemble" if made else stage),
                    code=code,
                    http_status=getattr(error, "http_status", None),
                    error_stage=failure_stage if isinstance(failure_stage, str) else "assemble",
                    error_code=code,
                )
            return _failed(
                message,
                provider_label,
                billing_label,
                running.task_id,
                running.attempt_id,
                suggested=None if grok else "stub",
                fix="可以重试。" if grok else "请改用本地占位再试一次。",
                preview_image=preview if isinstance(preview, str) else None,
            )
        self._ledger.complete_local_task(
            running, output_version_id=result.artifact_version_id or ""
        )
        mark_film_progress(project_id, "done", result.message)
        if request.provider == "grok_subscription":
            append_grok_status("compose", code="ok")
        message = result.message
        if self._partial_note:
            message = f"{self._partial_note} 成片已保存。"
        if self._reuse_note:
            message = f"{message}{self._reuse_note}"
        if AI_GENERATED_NOTE not in message:
            message = f"{message}{AI_GENERATED_NOTE}"
        preview = film_progress(project_id).get("preview_image")
        return StoryFilmResult(
            status="SUCCEEDED",
            message=message,
            provider_label=provider_label,
            billing_label=billing_label,
            suggested_provider=None,
            fix=None,
            task_id=running.task_id,
            attempt_id=running.attempt_id,
            artifact_version_id=result.artifact_version_id,
            output_path=result.output_path,
            output_sha256=result.output_sha256,
            duration_seconds=result.duration_seconds,
            has_video=result.has_video,
            has_audio=result.has_audio,
            draft=True,
            live_call=live_call,
            preview_image=preview if isinstance(preview, str) else None,
        )

    def _preflight(
        self,
        project_id: str,
        request: StoryFilmRequest,
        media_token: str | None,
    ) -> StoryFilmResult | None:
        provider_label, billing_label = provider_copy(request.provider)
        if request.provider == "chatgpt":
            return _blocked(
                "ChatGPT 登录可以帮忙写故事，还不能生成画面、视频和配音。",
                provider_label,
                billing_label,
                "grok_subscription",
                "请改用 Grok 账号，或先用本地占位做成片。",
            )
        if request.provider == "xai_api_key":
            if not request.confirmed:
                return _blocked(
                    "这一步会花钱。请先确认一次，再继续。",
                    provider_label,
                    billing_label,
                    "stub",
                    "确认后才会检查预算。也可以改用本地占位，那不花钱。",
                )
            reason = self._budget_reason(project_id, request)
            if reason is not None:
                return _blocked(
                    reason,
                    provider_label,
                    billing_label,
                    "stub",
                    "请先为作品设置预算，或改用 Grok 订阅，或改用本地占位。",
                )
            return _blocked(
                "预算检查通过了。这一版仍不会用 API Key 扣费，"
                "因为预算门只做预留，不会把预留记成已经调用上游。",
                provider_label,
                billing_label,
                "grok_subscription",
                "请改用 Grok 订阅生成，或先用本地占位做成片。",
            )
        if request.provider == "grok_subscription":
            if not media_token:
                return _blocked(
                    "还没有登录 Grok，所以不能用订阅生成。",
                    provider_label,
                    billing_label,
                    "stub",
                    "请先用 Grok 账号登录。订阅内的画面、视频和配音不另收费。也可以先用本地占位。",
                )
            if not live_media_enabled():
                return _blocked(
                    "当前环境不会发起真实的画面、视频或配音请求，以免产生费用。",
                    provider_label,
                    billing_label,
                    "stub",
                    "可以改用本地占位做成片。真实账号请在你自己的电脑上再试。",
                )
        return None

    def _budget_reason(self, project_id: str, request: StoryFilmRequest) -> str | None:
        if request.currency is None or request.amount_micro is None:
            return budget_display_reason("UNKNOWN_AMOUNT")
        try:
            amount = BudgetAmount(request.currency, request.amount_micro)
        except ValueError:
            return budget_display_reason("UNKNOWN_AMOUNT")
        store = MediaBudgetStore(self._repository)
        try:
            project_usage, episode_usage = store.scope_usage(
                project_id, self._episode_id(project_id)
            )
        except Exception:
            return budget_display_reason("UNCONFIGURED")
        assessment = evaluate_media_budget(
            project=project_usage,
            episode=episode_usage,
            request=amount,
        )
        if assessment.status == "WITHIN_LIMIT":
            return None
        return budget_display_reason(assessment.status)

    def _record_subscription(
        self, project_id: str, request: StoryFilmRequest
    ) -> StoryFilmResult | None:
        digest = canonical_content_hash(
            {
                "scene_label": request.scene_label,
                "narration": request.narration,
                "provider": request.provider,
            }
        )
        now = datetime.now(UTC)
        for suffix, model in (
            ("image", request.image_model or IMAGE_MODEL),
            ("video", request.video_model or VIDEO_MODEL),
            ("speech", request.speech_model or TTS_MODEL),
        ):
            try:
                record_desktop_subscription_dispatch(
                    self._repository,
                    DesktopSubscriptionRequest(
                        project_id=project_id,
                        account_kind="grok_login",
                        model_id=model,
                        request_sha256=digest,
                        idempotency_key=(
                            "sf"
                            + suffix[:1]
                            + hashlib.sha256(
                                (request.idempotency_key + suffix).encode()
                            ).hexdigest()[:20]
                        ),
                    ),
                    now=now,
                )
            except DesktopSubscriptionDispatchError as error:
                return _blocked(
                    error.message,
                    *provider_copy("grok_subscription"),
                    "stub",
                    "可以改用本地占位做成片。",
                )
        return None

    def _enqueue(self, project_id: str, request: StoryFilmRequest) -> QueuedTask:
        bindings = {
            "scene_label": request.scene_label,
            "narration_sha256": hashlib.sha256(request.narration.encode()).hexdigest(),
            "subtitle": request.subtitle or "",
            "provider": request.provider,
            "image_model": request.image_model,
            "video_model": request.video_model,
            "speech_model": request.speech_model,
            "connection_revision": request.connection_revision,
            "billing_class": (
                "local_placeholder"
                if request.provider == "stub"
                else "subscription"
                if request.provider == "grok_subscription"
                else "metered"
            ),
            "confirmed_metered": request.confirmed and request.provider == "xai_api_key",
            "shot_count": len(request.shots),
        }
        input_hash = canonical_content_hash(bindings)
        fingerprint = canonical_content_hash(
            {
                "definition_id": DEFINITION_ID,
                "definition_version": DEFINITION_VERSION,
                "definition_hash": _DEFINITION_HASH,
                "input_hash": input_hash,
                "task_kind": TASK_KIND,
            }
        )
        return self._ledger.enqueue_local_node(
            project_id=project_id,
            definition_id=DEFINITION_ID,
            definition_version=DEFINITION_VERSION,
            definition_hash=_DEFINITION_HASH,
            graph=_GRAPH,
            workflow_input_hash=input_hash,
            node_key=NODE_KEY,
            node_type=NODE_KEY,
            contract_version=1,
            input_bindings=bindings,
            node_input_hash=input_hash,
            request_fingerprint=fingerprint,
            idempotency_key=request.idempotency_key,
            max_attempts=1,
            task_kind=TASK_KIND,
            priority=80,
            available_at=datetime.now(UTC),
        )

    def _placeholder_media(self, request: StoryFilmRequest) -> tuple[bytes, bytes, bytes]:
        tools = self._tools()
        directory = Path(self._repository.database_path).parent / "story-films" / "placeholder"
        directory.mkdir(parents=True, exist_ok=True)
        stem = hashlib.sha256(
            f"{request.idempotency_key}\n{request.narration}".encode()
        ).hexdigest()[:16]
        image_path = directory / f"{stem}.png"
        clip_path = directory / f"{stem}.mp4"
        audio_path = directory / f"{stem}.wav"
        _ffmpeg(
            tools.ffmpeg_path,
            [
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=160x90:rate=24",
                "-frames:v",
                "1",
                str(image_path),
            ],
        )
        _ffmpeg(
            tools.ffmpeg_path,
            [
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=160x90:rate=24",
                "-frames:v",
                "48",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-an",
                str(clip_path),
            ],
        )
        frames = _video_frames(tools.ffprobe_path, clip_path)
        _ffmpeg(
            tools.ffmpeg_path,
            [
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency=440:sample_rate=48000:duration={frames / _FRAME_RATE + 0.25:.3f}",
                "-c:a",
                "pcm_s16le",
                str(audio_path),
            ],
        )
        return image_path.read_bytes(), clip_path.read_bytes(), audio_path.read_bytes()

    def _shots_media(
        self,
        request: StoryFilmRequest,
        media_token: str | None,
        project_id: str,
    ) -> tuple[bytes, bytes, bytes]:
        tools = self._tools()
        total = len(request.shots)
        picture = None
        normalized: list[tuple[Path, Path, str]] = []
        with tempfile.TemporaryDirectory(prefix="aivora-shots-") as temporary:
            directory = Path(temporary)
            for index, shot in enumerate(request.shots, start=1):
                label = f"正在生成第 {index} 个镜头的起始画面，共 {total} 个。"
                mark_film_progress(project_id, "image", label)
                still = keyframe_prompt(
                    shot.prompt,
                    style_zh=request.style_block,
                    identity=shot.identity,
                    size=shot.size,
                    angle=shot.angle,
                    move=shot.move,
                    action=shot.action,
                    performance=shot.performance,
                )
                child = replace(
                    request,
                    scene_label=shot.prompt or request.scene_label,
                    narration=shot.narration,
                    subtitle=shot.subtitle or None,
                    visual_prompt=still,
                    regenerate=request.regenerate or shot.regenerate,
                    shots=(),
                )
                if request.provider == "grok_subscription":
                    image, clip, speech = self._live_media(
                        child,
                        media_token,
                        project_id,
                        duration=max(1, min(int(shot.duration_seconds), 15)),
                        shot_label=label,
                    )
                else:
                    image, clip, speech = self._placeholder_media(child)
                if picture is None and image:
                    picture = image
                clip_path = directory / f"shot-{index}.mp4"
                audio_path = directory / f"shot-{index}{_audio_suffix(speech)}"
                clip_path.write_bytes(clip)
                _fit_clip_length(
                    tools.ffmpeg_path,
                    tools.ffprobe_path,
                    clip_path,
                    max(1, min(int(shot.duration_seconds), 15)),
                )
                audio_path.write_bytes(speech)
                _width, _height, _frames, voiced = _normalize_film_media(
                    tools.ffmpeg_path, tools.ffprobe_path, clip_path, audio_path
                )
                synced = directory / f"shot-{index}-sync.wav"
                video_seconds = _media_duration(tools.ffprobe_path, clip_path)
                _ffmpeg(
                    tools.ffmpeg_path,
                    [
                        "-i",
                        str(voiced),
                        "-af",
                        f"apad=whole_dur={video_seconds:.3f},atrim=duration={video_seconds:.3f}",
                        "-ac",
                        "2",
                        "-ar",
                        "48000",
                        "-c:a",
                        "pcm_s16le",
                        str(synced),
                    ],
                    stage="normalize_voice",
                )
                normalized.append((clip_path, synced, shot.subtitle))
            if len(normalized) == 1:
                video = normalized[0][0].read_bytes()
                audio = normalized[0][1].read_bytes()
                self._shot_captions = [
                    (
                        normalized[0][2],
                        0.0,
                        _media_duration(tools.ffprobe_path, normalized[0][0]),
                    )
                ]
            else:
                video_path = directory / "joined.mp4"
                audio_path = directory / "joined.wav"
                self._shot_captions = _join_shot_files(
                    tools.ffmpeg_path,
                    tools.ffprobe_path,
                    [item[0] for item in normalized],
                    [item[1] for item in normalized],
                    [item[2] for item in normalized],
                    video_path,
                    audio_path,
                )
                video = video_path.read_bytes()
                audio = audio_path.read_bytes()
        return picture or _FALLBACK_PNG, video, audio

    def _live_media(
        self,
        request: StoryFilmRequest,
        media_token: str | None,
        project_id: str = "",
        *,
        duration: int = 2,
        prepared_image: XaiImage | None = None,
        shot_label: str | None = None,
        reference_url: str | None = None,
    ) -> tuple[bytes, bytes, bytes]:
        if not media_token or not live_media_enabled():
            raise StoryFilmError("LIVE_DISABLED", "当前环境不会发起真实生成。")
        bundle = None if request.regenerate else self._saved_bundle(project_id, request)
        if bundle is not None:
            image_bytes, saved_clip, saved_speech = bundle
            append_grok_status("image_saved", code="reused")
            append_grok_status("video_submit", code="reused")
            append_grok_status("video_poll", code="reused")
            append_grok_status("tts", code="reused")
            preview = _preview_data_url(image_bytes)
            self._reuse_note = "已用上次已生成的画面、视频和配音。"
            mark_film_progress(
                project_id,
                "assemble",
                self._reuse_note,
                image_saved=True,
                preview_image=preview,
            )
            return image_bytes, saved_clip, saved_speech
        if self._transport is None:
            from aijian_api.xai_media_transport import urllib_xai_transport

            transport = urllib_xai_transport()
        else:
            transport = self._transport
        client = XaiMediaClient(transport, token=media_token)
        self._partial_note = None
        self._ensure_running(project_id)
        saved = None if request.regenerate else self._find_saved_image(project_id, request)
        if saved is not None:
            data = saved.read_bytes()
            image = XaiImage(data=data, source_url=None, model=request.image_model or IMAGE_MODEL)
            append_grok_status("image_saved", code="reused")
            self._reuse_note = "已用上次已生成的画面。"
            mark_film_progress(
                project_id,
                "image",
                self._reuse_note,
                image_saved=True,
                preview_image=_preview_data_url(data),
            )
        elif prepared_image is not None:
            image = prepared_image
            append_grok_status("image_saved", code="reused")
            mark_film_progress(
                project_id,
                "image",
                shot_label or "已用这一场的角色定妆照。",
                image_saved=bool(image.data),
                preview_image=_preview_data_url(image.data) if image.data else None,
            )
        else:
            mark_film_progress(project_id, "image", shot_label or "正在生成画面。")
            image = client.generate_image(
                prompt=_styled(request.visual_prompt or request.scene_label, request.style_block),
                model=request.image_model or IMAGE_MODEL,
            )
            if image.data:
                self._persist_image(project_id, request, image.data)
                append_grok_status("image_saved", code="ok")
                mark_film_progress(
                    project_id,
                    "image",
                    shot_label or "画面已保存。",
                    image_saved=True,
                    preview_image=_preview_data_url(image.data),
                )
            else:
                mark_film_progress(
                    project_id,
                    "image",
                    shot_label or "画面地址已拿到，正在交给视频。",
                )
        self._ensure_running(project_id)
        kept = bool(image.data)
        mark_film_progress(project_id, "video", shot_label or "正在生成视频。", image_saved=kept)
        clip, video_note = self._live_video(
            client,
            request,
            image,
            project_id,
            duration=duration,
            reference_url=reference_url,
        )
        self._ensure_running(project_id)
        mark_film_progress(project_id, "speech", shot_label or "正在生成配音。", image_saved=kept)
        try:
            speech = client.synthesize(
                text=request.narration,
                voice_id=request.voice_id or "eve",
                language="zh",
            )
        except XaiMediaError as error:
            if clip is None:
                raise StoryFilmError(
                    "MEDIA_INCOMPLETE",
                    "画面已生成，视频和配音这一步没有成功，可以重试",
                ) from error
            raise StoryFilmError(
                "SPEECH_FAILED",
                "画面已生成，配音这一步没有成功，可以重试",
            ) from error
        real_clip = clip is not None
        if clip is None:
            if not image.data:
                raise StoryFilmError(
                    "MEDIA_INCOMPLETE",
                    video_note or "画面已生成，视频这一步没有成功，可以重试",
                )
            clip = self._still_clip(request, image.data, speech)
            self._partial_note = video_note or "画面已生成，视频这一步没有成功，可以重试"
            mark_film_progress(project_id, "assemble", self._partial_note, image_saved=True)
        else:
            mark_film_progress(project_id, "assemble", "正在合成。", image_saved=True)
        picture = image.data or _FALLBACK_PNG
        if real_clip:
            self._store_part(project_id, request, clip, "-clip.mp4")
            self._store_part(project_id, request, speech, f"-voice{_audio_suffix(speech)}")
        return picture, clip, speech

    def _ensure_running(self, project_id: str) -> None:
        if project_id and film_cancel_requested(project_id):
            raise StoryFilmError(
                "CANCELLED",
                "已停止等待。画面如果已经生成，会留在这台电脑上。可以重试。",
            )

    def _image_directory(self) -> Path:
        return Path(self._repository.database_path).parent / "story-films"

    def _image_stem(self, project_id: str, request: StoryFilmRequest) -> str:
        # Subtitle text is burned at compose, so it does not change this key.
        # A retry of the same scene, narration and voice reuses the files.
        raw = "\n".join(
            (
                project_id,
                request.scene_label,
                request.narration,
                request.voice_id or "eve",
            )
        ).encode()
        return hashlib.sha256(raw).hexdigest()[:16]

    def _find_saved_image(self, project_id: str, request: StoryFilmRequest) -> Path | None:
        directory = self._image_directory()
        stem = self._image_stem(project_id, request)
        for suffix in (".jpg", ".png", ".webp"):
            path = directory / f"{stem}-key{suffix}"
            if path.is_file() and path.stat().st_size > 0:
                return path
        return None

    def _saved_bundle(
        self, project_id: str, request: StoryFilmRequest
    ) -> tuple[bytes, bytes, bytes] | None:
        image = self._find_saved_image(project_id, request)
        if image is None:
            return None
        directory = self._image_directory()
        stem = self._image_stem(project_id, request)
        clip = directory / f"{stem}-clip.mp4"
        voice = self._saved_voice(directory, stem)
        if voice is None or not (clip.is_file() and clip.stat().st_size > 0):
            return None
        return image.read_bytes(), clip.read_bytes(), voice.read_bytes()

    def _saved_voice(self, directory: Path, stem: str) -> Path | None:
        mp3 = directory / f"{stem}-voice.mp3"
        if mp3.is_file() and mp3.stat().st_size > 0:
            return mp3
        wav = directory / f"{stem}-voice.wav"
        if not (wav.is_file() and wav.stat().st_size > 0):
            return None
        with wav.open("rb") as stream:
            header = stream.read(16)
        if _audio_suffix(header) != ".mp3":
            return wav
        wav.replace(mp3)
        return mp3

    def _store_part(
        self, project_id: str, request: StoryFilmRequest, data: bytes, suffix: str
    ) -> None:
        if not data:
            return
        directory = self._image_directory()
        directory.mkdir(parents=True, exist_ok=True)
        stem = self._image_stem(project_id, request)
        target = directory / f"{stem}{suffix}"
        if suffix.startswith("-voice") and request.regenerate:
            for old in (".mp3", ".wav"):
                previous = directory / f"{stem}-voice{old}"
                if previous != target and previous.is_file():
                    previous.unlink()
        target.write_bytes(data)

    def _artifact_head(
        self, project_id: str, artifact_type: str, episode_id: str | None
    ) -> tuple[str | None, int | None]:
        with self._repository._connection() as connection:
            row = connection.execute(
                """SELECT head.latest_version_id, head.revision
                   FROM artifact_heads AS head
                   JOIN artifacts AS artifact ON artifact.artifact_id = head.artifact_id
                   WHERE artifact.project_id = ? AND artifact.artifact_type = ?
                     AND artifact.episode_id IS ?""",
                (project_id, artifact_type, episode_id),
            ).fetchone()
        if row is None:
            return None, None
        return str(row["latest_version_id"]), int(row["revision"])

    def _persist_image(self, project_id: str, request: StoryFilmRequest, image: bytes) -> Path:
        directory = self._image_directory()
        directory.mkdir(parents=True, exist_ok=True)
        suffix = ".png"
        if image.startswith(b"\xff\xd8"):
            suffix = ".jpg"
        elif image.startswith(b"RIFF") and b"WEBP" in image[:16]:
            suffix = ".webp"
        stem = self._image_stem(project_id, request)
        path = directory / f"{stem}-key{suffix}"
        for old in (".jpg", ".png", ".webp"):
            previous = directory / f"{stem}-key{old}"
            if previous != path and previous.is_file():
                previous.unlink()
        path.write_bytes(image)
        return path

    def _live_video(
        self,
        client: XaiMediaClient,
        request: StoryFilmRequest,
        image: object,
        project_id: str,
        *,
        duration: int = 2,
        reference_url: str | None = None,
    ) -> tuple[bytes | None, str | None]:
        if not isinstance(image, XaiImage):
            raise StoryFilmError("IMAGE_RESPONSE_INVALID", "画面没有保存下来。")
        try:
            submitted = client.submit_video(
                prompt=_styled(
                    video_prompt(request.narration or request.visual_prompt),
                    request.style_block,
                ),
                image=image,
                model=request.video_model or VIDEO_MODEL,
                duration=max(1, min(duration, 15)),
                generate_audio=False,
                reference_images=(reference_url,) if reference_url else (),
            )
        except XaiMediaError:
            return None, "画面已生成，视频这一步没有成功，可以重试"
        for _ in range(90):
            self._ensure_running(project_id)
            try:
                polled = client.poll_video(submitted.request_id)
            except XaiMediaError:
                return None, "画面已生成，视频这一步没有成功，可以重试"
            if polled.status == "done" and polled.video_url:
                try:
                    return client.download(polled.video_url), None
                except XaiMediaError:
                    return None, "画面已生成，视频这一步没有成功，可以重试"
            if polled.status in {"failed", "expired"}:
                client.cancel_video(submitted.request_id)
                return None, "画面已生成，视频这一步没有成功，可以重试"
            self._sleep(2)
        client.cancel_video(submitted.request_id)
        return None, "画面已生成，视频这一步没有成功，可以重试"

    def _still_clip(self, request: StoryFilmRequest, image: bytes, speech: bytes) -> bytes:
        tools = self._tools()
        directory = Path(self._repository.database_path).parent / "story-films"
        directory.mkdir(parents=True, exist_ok=True)
        stem = hashlib.sha256(
            f"{request.idempotency_key}\n{request.narration}".encode()
        ).hexdigest()[:16]
        image_path = directory / f"{stem}-still-src.png"
        audio_path = directory / f"{stem}-still-voice.bin"
        clip_path = directory / f"{stem}-still.mp4"
        image_path.write_bytes(image)
        audio_path.write_bytes(speech)
        _ffmpeg(
            tools.ffmpeg_path,
            [
                "-loop",
                "1",
                "-framerate",
                "24",
                "-i",
                str(image_path),
                "-i",
                str(audio_path),
                "-t",
                "2",
                "-r",
                "24",
                "-vf",
                "scale=160:90",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(clip_path),
            ],
        )
        return clip_path.read_bytes()

    def _assemble_and_export(
        self,
        project_id: str,
        request: StoryFilmRequest,
        attempt_id: str,
        image: bytes,
        clip: bytes,
        speech: bytes,
    ) -> StoryFilmResult:
        tools = self._tools()
        directory = Path(self._repository.database_path).parent / "story-films"
        directory.mkdir(parents=True, exist_ok=True)
        stem = hashlib.sha256(request.idempotency_key.encode()).hexdigest()[:16]
        image_path = directory / f"{stem}-key.png"
        clip_path = directory / f"{stem}-clip.mp4"
        audio_path = directory / f"{stem}-voice{_audio_suffix(speech)}"
        image_path.write_bytes(image)
        clip_path.write_bytes(clip)
        audio_path.write_bytes(speech)
        width, height, frames, voiced = _normalize_film_media(
            tools.ffmpeg_path, tools.ffprobe_path, clip_path, audio_path
        )
        store = MediaAssetStore(self._repository)
        image_asset = store.import_local(project_id, image_path, display_filename="关键画面.png")
        clip_asset = store.import_local(project_id, clip_path, display_filename="镜头.mp4")
        audio_asset = store.import_local(project_id, voiced, display_filename="旁白.wav")
        episode_id = self._episode_id(project_id)
        subtitle = request.subtitle.strip() if request.subtitle else ""
        content: dict[str, object] = {
            "project_id": project_id,
            "episode_id": episode_id,
            "sequence_timebase": {
                "frame_rate": {"num": _FRAME_RATE, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": width,
            "canvas_height": height,
            "total_frames": frames,
            "visual_segments": [
                {
                    "segment_id": "seg_picture",
                    "media_kind": "video",
                    "media": _media_ref(clip_asset),
                    "start_frame": 0,
                    "end_frame": frames,
                    "embedded_audio": "MUTE",
                }
            ],
            "audio_segments": [
                {
                    "segment_id": "seg_narration",
                    "track_kind": "BGM",
                    "media": _media_ref(audio_asset),
                    "start_frame": 0,
                    "end_frame": frames,
                }
            ],
        }
        cues = _caption_segments(self._shot_captions, frames)
        if cues:
            content["subtitle_segments"] = cues
            subtitle = " ".join(str(cue["text"]) for cue in cues)
        elif subtitle:
            content["subtitle_segments"] = [
                {
                    "segment_id": "seg_caption",
                    "text": subtitle,
                    "start_frame": 0,
                    "end_frame": frames,
                    "render_profile": "noto-cjk-sc-bottom-v1",
                }
            ]
        output = directory / f"{stem}-film.mp4"
        runtime = DraftExportRuntime(
            self._repository,
            self._toolchain_provider,
            ProductExportJobManager() if sys.platform == "win32" else None,
        )
        subtitle_note = _save_subtitle_without_blocking(content, output, subtitle, frames)
        assembly, job = self._export_story_assembly(
            project_id, episode_id, content, output, runtime
        )
        if job.status != "SUCCEEDED" or job.output_path is None or job.output_sha256 is None:
            code = job.error_code or "EXPORT_FAILED"
            reason = _export_reason(code) or "合成没有完成"
            note = f"。{subtitle_note}" if subtitle_note else ""
            raise StoryFilmError(
                code if _safe_token(code) else "EXPORT_FAILED",
                f"画面、视频和配音都已经做好。{reason}{note}，可以重试。",
                ffmpeg_stage="assemble",
            )
        output_path = Path(job.output_path)
        _tag_ai_generated(tools.ffmpeg_path, tools.ffprobe_path, output_path)
        has_video, has_audio, duration = _probe_movie(tools.ffprobe_path, output_path)
        file_hash = hashlib.sha256(output_path.read_bytes()).hexdigest()
        manifest = {
            "schema_version": "1.0.0",
            "kind": "story_film",
            "provider": request.provider,
            "scene_label": request.scene_label,
            "image_asset_id": image_asset.id,
            "clip_asset_id": clip_asset.id,
            "audio_asset_id": audio_asset.id,
            "audio_role": "narration",
            "assembly_version_id": assembly.version_id,
            "assembly_content_hash": assembly.content_hash,
            "draft_operation_id": job.operation_id,
            "output_sha256": file_hash,
            "duration_frames": frames,
            "frame_rate": _FRAME_RATE,
            "draft": True,
            "ai_generated": True,
            "release_claim": False,
        }
        film_parent, film_revision = self._artifact_head(project_id, "story_film", None)
        record = self._repository.create_artifact_version(
            project_id=project_id,
            artifact_type="story_film",
            schema_version="1.0.0",
            content=manifest,
            author_actor_type="human",
            author_actor_id="story-film",
            change_summary="一句话故事的草稿成片",
            producer_attempt_id=attempt_id,
            parent_version_id=film_parent,
            expected_revision=film_revision,
        )
        provider_label, billing_label = provider_copy(request.provider)
        message = "草稿成片已经保存。这还不是正式发行，可以在播放器里打开看看。"
        if subtitle_note:
            message = f"{message}{subtitle_note}"
        return StoryFilmResult(
            status="SUCCEEDED",
            message=message,
            provider_label=provider_label,
            billing_label=billing_label,
            suggested_provider=None,
            fix=None,
            task_id=None,
            attempt_id=attempt_id,
            artifact_version_id=record.version.id,
            output_path=job.output_path,
            output_sha256=file_hash,
            duration_seconds=f"{duration:.3f}",
            has_video=has_video,
            has_audio=has_audio,
            draft=True,
            live_call=False,
        )

    def _export_story_assembly(
        self,
        project_id: str,
        episode_id: str,
        content: dict[str, object],
        output: Path,
        runtime: DraftExportRuntime,
    ) -> tuple[EpisodeMediaAssemblyVersionData, DraftExportJob]:
        parent_id, revision = self._artifact_head(project_id, ASSEMBLY_ARTIFACT_TYPE, episode_id)
        assembly = EpisodeMediaAssemblyStore(self._repository).create_version(
            project_id,
            episode_id,
            CreateEpisodeMediaAssemblyVersionRequest(
                content=EpisodeMediaAssemblyContentV1.model_validate(content),
                parent_version_id=parent_id,
                expected_revision=revision,
                change_summary="由一句话故事合成的草稿成片",
            ),
            author_actor_id="story-film",
        )
        export = CreateDraftExportRequest(
            operation_id="dmp_" + uuid4().hex,
            assembly_version_id=assembly.version_id,
            assembly_content_hash=assembly.content_hash,
            rights_declaration="OWNED_OR_SYNTHETIC",
            output_path=str(output),
        )
        runtime.submit(project_id, episode_id, export)
        job = _wait_export(runtime, project_id, episode_id, export.operation_id)
        runtime.join_workers()
        return assembly, job

    def _episode_id(self, project_id: str) -> str:
        episodes = self._repository.list_episodes(project_id)
        if not episodes:
            raise StoryFilmError("EPISODE_MISSING", "这个作品还没有一集，没法做成片。")
        return episodes[0].id

    def _tools(self) -> MediaToolchain:
        try:
            return self._toolchain_provider()
        except Exception as error:
            raise StoryFilmError(
                "TOOLCHAIN_UNAVAILABLE",
                "本机的视频工具还不可用，所以没法做成片。",
            ) from error


def _media_ref(asset: MediaAssetData) -> dict[str, str]:
    return {
        "asset_id": asset.id,
        "asset_version_id": asset.latest_version.id,
        "sha256": asset.latest_version.sha256,
    }


def _ffmpeg(ffmpeg: Path, args: list[str], *, stage: str | None = None) -> None:
    completed = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-nostdin", "-y", *args],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        if stage == "normalize_voice":
            message = "画面、视频和配音都已经做好。整理配音时没有成功，可以重试。"
        elif stage == "normalize_video":
            message = "画面、视频和配音都已经做好。整理视频时没有成功，可以重试。"
        else:
            message = "成片没有编码成功，可以重试。"
        raise StoryFilmError(
            "MEDIA_ENCODE_FAILED",
            message,
            ffmpeg_stage=stage,
            exit_code=completed.returncode,
        )


def _video_frames(ffprobe: Path, path: Path) -> int:
    payload = _ffprobe(
        ffprobe,
        [
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_frames,duration",
            "-of",
            "json",
            str(path),
        ],
    )
    streams = payload.get("streams")
    if not isinstance(streams, list) or not streams or not isinstance(streams[0], dict):
        raise StoryFilmError("PROBE_FAILED", "没有读到镜头的画面长度。")
    raw = streams[0].get("nb_frames")
    if isinstance(raw, str) and raw.isdigit() and int(raw) > 0:
        return int(raw)
    duration = streams[0].get("duration")
    if not isinstance(duration, str | int | float):
        raise StoryFilmError("PROBE_FAILED", "没有读到镜头的画面长度。")
    try:
        frames = int(round(float(duration) * _FRAME_RATE))
    except ValueError as error:
        raise StoryFilmError("PROBE_FAILED", "没有读到镜头的画面长度。") from error
    if frames < 1:
        raise StoryFilmError("PROBE_FAILED", "镜头太短，没法做成片。")
    return frames


def _probe_movie(ffprobe: Path, path: Path) -> tuple[bool, bool, float]:
    payload = _ffprobe(
        ffprobe,
        ["-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)],
    )
    streams = payload.get("streams")
    kinds = (
        {
            stream.get("codec_type")
            for stream in streams
            if isinstance(stream, dict) and isinstance(stream.get("codec_type"), str)
        }
        if isinstance(streams, list)
        else set()
    )
    fmt = payload.get("format")
    duration_raw = fmt.get("duration") if isinstance(fmt, dict) else None
    if not isinstance(duration_raw, str | int | float):
        raise StoryFilmError("PROBE_FAILED", "成片已写出，但没有读到时长。")
    try:
        duration = float(duration_raw)
    except ValueError as error:
        raise StoryFilmError("PROBE_FAILED", "成片已写出，但没有读到时长。") from error
    return "video" in kinds, "audio" in kinds, duration


def _ffprobe(ffprobe: Path, args: list[str]) -> dict[str, object]:
    completed = subprocess.run(
        [str(ffprobe), "-v", "error", *args],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise StoryFilmError(
            "PROBE_FAILED",
            "没有读到可以合成的画面。",
            ffmpeg_stage="probe_video",
            exit_code=completed.returncode,
        )
    try:
        payload = json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise StoryFilmError("PROBE_FAILED", "没有读到成片信息。") from error
    if not isinstance(payload, dict):
        raise StoryFilmError("PROBE_FAILED", "没有读到成片信息。")
    return payload


def _wait_export(
    runtime: DraftExportRuntime, project: str, episode: str, operation: str
) -> DraftExportJob:
    import time

    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = runtime.get(project, episode, operation)
        if job.status not in {"QUEUED", "RUNNING", "VERIFYING"}:
            return job
        time.sleep(0.05)
    raise StoryFilmError("EXPORT_TIMEOUT", "成片导出超时，没有当成成功。")


_PROGRESS_LOCK = threading.Lock()
_PROGRESS: dict[str, dict[str, object]] = {}
_CANCEL: set[str] = set()
_STAGE_LABELS = {
    "idle": "等待",
    "image": "画面",
    "video": "视频",
    "speech": "配音",
    "assemble": "合成",
    "done": "完成",
    "failed": "未完成",
}


def mark_film_progress(
    project_id: str,
    stage: str,
    message: str,
    *,
    image_saved: bool = False,
    preview_image: str | None = None,
) -> None:
    if not project_id:
        return
    with _PROGRESS_LOCK:
        current = _PROGRESS.get(project_id)
        continuing = current is not None and current.get("stage") not in {"done", "failed", "idle"}
        started = current.get("started") if current is not None and continuing else time.monotonic()
        saved = image_saved or bool(current and current.get("image_saved"))
        previous = current.get("preview_image") if current else None
        preview = preview_image or (previous if isinstance(previous, str) else None)
        _PROGRESS[project_id] = {
            "stage": stage,
            "message": message,
            "started": started,
            "image_saved": saved,
            "preview_image": preview,
        }


def film_progress(project_id: str) -> dict[str, object]:
    with _PROGRESS_LOCK:
        current = _PROGRESS.get(project_id)
    if not current:
        return {
            "stage": "idle",
            "label": "等待",
            "elapsed_seconds": 0,
            "image_saved": False,
            "message": "",
            "preview_image": None,
        }
    started = current.get("started")
    elapsed = max(0, int(time.monotonic() - float(started))) if isinstance(started, float) else 0
    stage = str(current.get("stage") or "idle")
    preview = current.get("preview_image")
    return {
        "stage": stage,
        "label": _STAGE_LABELS.get(stage, "等待"),
        "elapsed_seconds": elapsed,
        "image_saved": bool(current.get("image_saved")),
        "message": str(current.get("message") or ""),
        "preview_image": preview if isinstance(preview, str) else None,
    }


def request_film_cancel(project_id: str) -> None:
    with _PROGRESS_LOCK:
        _CANCEL.add(project_id)


def film_cancel_requested(project_id: str) -> bool:
    with _PROGRESS_LOCK:
        return project_id in _CANCEL


def clear_film_cancel(project_id: str) -> None:
    with _PROGRESS_LOCK:
        _CANCEL.discard(project_id)


_FALLBACK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
    "DwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _preview_data_url(data: bytes) -> str | None:
    if not data or len(data) > 1_500_000:
        return None
    mime = "image/png"
    if data.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        mime = "image/webp"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _safe_token(value: object) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_]{1,40}", value))


def _fit_canvas(width: int, height: int) -> tuple[int, int]:
    width = width - width % 2
    height = height - height % 2
    if width < 16 or height < 16:
        raise StoryFilmError("PROBE_FAILED", "画面太小，没法做成片。", ffmpeg_stage="probe_video")
    limit = 1920
    if max(width, height) > limit:
        scale = limit / max(width, height)
        width = max(16, int(width * scale) // 2 * 2)
        height = max(16, int(height * scale) // 2 * 2)
    return width, height


def _primary_video(streams: list[object]) -> tuple[int, int, int]:
    chosen: tuple[int, int, int, int] | None = None
    for index, stream in enumerate(streams):
        if not isinstance(stream, dict) or stream.get("codec_type") != "video":
            continue
        disposition = stream.get("disposition")
        attached = isinstance(disposition, dict) and disposition.get("attached_pic") in {1, "1"}
        codec = stream.get("codec_name")
        if attached or codec in {"mjpeg", "png", "jpeg", "gif"}:
            continue
        try:
            width = int(stream.get("width") or 0)
            height = int(stream.get("height") or 0)
        except (TypeError, ValueError):
            continue
        area = width * height
        if area < 4:
            continue
        if chosen is None or area > chosen[0]:
            chosen = (area, index, width, height)
    if chosen is None:
        raise StoryFilmError("PROBE_FAILED", "没有读到可以合成的画面。", ffmpeg_stage="probe_video")
    return chosen[1], chosen[2], chosen[3]


def _audio_suffix(header: bytes) -> str:
    """Pick an extension from the audio header, never from the filename.

    xAI TTS is requested as MP3. A file that is still named ``.wav`` can hold
    those bytes, and opening it with a wav demuxer fails. The same header rule
    as the draft encoder selects MP3.
    """

    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
        return ".wav"
    if header.startswith(b"ID3") or (
        len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE6 == 0xE2
    ):
        return ".mp3"
    return ".wav"


def _styled(text: str, style: str = "") -> str:
    block = style.strip()
    if not block or block in text:
        return text
    return f"{text.rstrip('。')}。{block}"


def _loudnorm_number(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    text = str(value).strip()
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", text):
        return None
    return text


def _measure_loudness(ffmpeg: Path, demuxer: str, audio_path: Path) -> dict[str, str] | None:
    completed = subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            demuxer,
            "-i",
            str(audio_path),
            "-af",
            (f"loudnorm=I={_LOUDNESS_I}:TP={_LOUDNESS_TP}:LRA={_LOUDNESS_LRA}:print_format=json"),
            "-f",
            "null",
            "-",
        ],
        check=False,
        capture_output=True,
    )
    text = completed.stderr.decode("utf-8", errors="replace")
    start = text.rfind("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    measured: dict[str, str] = {}
    for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset"):
        number = _loudnorm_number(payload.get(key))
        if number is None:
            return None
        measured[key] = number
    return measured


def _loudnorm_filter(measured: dict[str, str] | None) -> str:
    if measured is None:
        return f"loudnorm=I={_LOUDNESS_I}:TP={_LOUDNESS_TP}:LRA={_LOUDNESS_LRA}"
    return (
        f"loudnorm=I={_LOUDNESS_I}:TP={_LOUDNESS_TP}:LRA={_LOUDNESS_LRA}:linear=true:"
        f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
        f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
        f"offset={measured['target_offset']}"
    )


def _normalize_film_media(
    ffmpeg: Path, ffprobe: Path, clip_path: Path, audio_path: Path
) -> tuple[int, int, int, Path]:
    """Loudness-normalize the narration and hold the last frame instead of cutting it.

    The film is at least as long as the narration plus a short tail. A longer
    video is kept, and the narration is padded with silence rather than trimmed.
    """

    payload = _ffprobe(ffprobe, ["-show_streams", "-of", "json", str(clip_path)])
    streams = payload.get("streams")
    if not isinstance(streams, list):
        raise StoryFilmError("PROBE_FAILED", "没有读到可以合成的画面。", ffmpeg_stage="probe_video")
    index, width, height = _primary_video(streams)
    width, height = _fit_canvas(width, height)
    clean = clip_path.with_name(f"{clip_path.stem}-cfr.mp4")
    _ffmpeg(
        ffmpeg,
        [
            "-i",
            str(clip_path),
            "-map",
            f"0:{index}",
            "-an",
            "-vf",
            f"scale={width}:{height}:flags=lanczos,fps={_FRAME_RATE},format=yuv420p",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(_FRAME_RATE),
            str(clean),
        ],
        stage="normalize_video",
    )
    clean.replace(clip_path)
    frames = _video_frames(ffprobe, clip_path)
    with audio_path.open("rb") as stream:
        header = stream.read(16)
    demuxer = "mp3" if _audio_suffix(header) == ".mp3" else "wav"
    normalized = audio_path.with_name(f"{audio_path.stem}-norm.wav")
    _ffmpeg(
        ffmpeg,
        [
            "-f",
            demuxer,
            "-i",
            str(audio_path),
            "-af",
            _loudnorm_filter(_measure_loudness(ffmpeg, demuxer, audio_path)),
            "-ac",
            "2",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            str(normalized),
        ],
        stage="normalize_voice",
    )
    narration_seconds = _media_duration(ffprobe, normalized)
    target_frames = max(
        frames,
        math.ceil((narration_seconds + _NARRATION_TAIL_SECONDS) * _FRAME_RATE - 1e-6),
    )
    if target_frames > frames:
        extra = (target_frames - frames) / _FRAME_RATE
        held = clip_path.with_name(f"{clip_path.stem}-hold.mp4")
        _ffmpeg(
            ffmpeg,
            [
                "-i",
                str(clip_path),
                "-an",
                "-vf",
                f"tpad=stop_mode=clone:stop_duration={extra:.3f},format=yuv420p",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-r",
                str(_FRAME_RATE),
                str(held),
            ],
            stage="normalize_video",
        )
        held.replace(clip_path)
        frames = _video_frames(ffprobe, clip_path)
    pad_seconds = max(frames / _FRAME_RATE + 0.08, narration_seconds)
    voiced = audio_path.with_name(f"{audio_path.stem}-fit.wav")
    _ffmpeg(
        ffmpeg,
        [
            "-i",
            str(normalized),
            "-af",
            f"apad=whole_dur={pad_seconds:.3f},atrim=duration={pad_seconds:.3f}",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            str(voiced),
        ],
        stage="normalize_voice",
    )
    normalized.unlink(missing_ok=True)
    if audio_path.suffix.lower() == ".wav":
        voiced.replace(audio_path)
        return width, height, frames, audio_path
    return width, height, frames, voiced


def _fit_clip_length(ffmpeg: Path, ffprobe: Path, path: Path, seconds: int) -> None:
    """Cut a longer model clip to the length the user chose. A shorter clip stays as it is."""

    try:
        actual = _media_duration(ffprobe, path)
    except StoryFilmError:
        return
    if actual <= seconds + 0.25:
        return
    trimmed = path.with_name(f"{path.stem}-fit.mp4")
    _ffmpeg(
        ffmpeg,
        [
            "-i",
            str(path),
            "-t",
            f"{max(1, seconds):.3f}",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(trimmed),
        ],
        stage="trim_shot",
    )
    trimmed.replace(path)


def _media_duration(ffprobe: Path, path: Path) -> float:
    payload = _ffprobe(
        ffprobe,
        ["-show_entries", "format=duration", "-of", "json", str(path)],
    )
    fmt = payload.get("format")
    raw = fmt.get("duration") if isinstance(fmt, dict) else None
    try:
        duration = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        raise StoryFilmError(
            "PROBE_FAILED", "没有读到配音的长度。", ffmpeg_stage="probe_video"
        ) from error
    if duration <= 0:
        raise StoryFilmError("PROBE_FAILED", "没有读到配音的长度。", ffmpeg_stage="probe_video")
    return duration


def _join_shot_files(
    ffmpeg: Path,
    ffprobe: Path,
    clips: list[Path],
    audios: list[Path],
    subtitles: list[str],
    video_out: Path,
    audio_out: Path,
) -> list[tuple[str, float, float]]:
    if len(clips) < 2 or len(clips) != len(audios) or len(clips) != len(subtitles):
        raise StoryFilmError(
            "MEDIA_ENCODE_FAILED",
            "镜头不够，没法接在一起。",
            ffmpeg_stage="assemble",
        )
    durations = [_media_duration(ffprobe, path) for path in clips]
    fade = min(_CROSSFADE_SECONDS, min(durations) / 3)
    video_filters: list[str] = []
    offset = durations[0] - fade
    previous = "[0:v]"
    for index in range(1, len(clips)):
        label = "[vout]" if index == len(clips) - 1 else f"[v{index}]"
        video_filters.append(
            f"{previous}[{index}:v]xfade=transition=fade:"
            f"duration={fade:.3f}:offset={offset:.3f}{label}"
        )
        previous = label
        if index < len(clips) - 1:
            offset += durations[index] - fade
    count = len(clips)
    audio_filters: list[str] = []
    previous_audio = f"[{count}:a]"
    for index in range(1, count):
        label = "[aout]" if index == count - 1 else f"[a{index}]"
        audio_filters.append(
            f"{previous_audio}[{count + index}:a]acrossfade=d={fade:.3f}:c1=tri:c2=tri{label}"
        )
        previous_audio = label
    filter_complex = ";".join((*video_filters, *audio_filters, "[vout]format=yuv420p[vfmt]"))
    arguments: list[str] = []
    for path in (*clips, *audios):
        arguments.extend(["-i", str(path)])
    arguments.extend(
        [
            "-filter_complex",
            filter_complex,
            "-map",
            "[vfmt]",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(_FRAME_RATE),
            str(video_out),
            "-map",
            "[aout]",
            "-vn",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(audio_out),
        ]
    )
    _ffmpeg(ffmpeg, arguments, stage="assemble")
    starts = [0.0]
    for index in range(1, count):
        starts.append(starts[-1] + durations[index - 1] - fade)
    total = starts[-1] + durations[-1]
    captions: list[tuple[str, float, float]] = []
    for index, text in enumerate(subtitles):
        end = starts[index + 1] if index + 1 < count else total
        if end <= starts[index]:
            end = starts[index] + 1 / _FRAME_RATE
        captions.append((text, starts[index], end))
    return captions


def _caption_segments(
    captions: list[tuple[str, float, float]] | None, frames: int
) -> list[dict[str, object]]:
    if not captions:
        return []
    usable = [
        (text.strip()[:28], start, end) for text, start, end in captions if text and text.strip()
    ]
    cues: list[dict[str, object]] = []
    cursor = 0
    for index, (text, start, end) in enumerate(usable):
        start_frame = max(cursor, int(start * _FRAME_RATE))
        end_frame = int(round(end * _FRAME_RATE))
        if index == len(usable) - 1:
            end_frame = max(end_frame, start_frame + 1)
        end_frame = min(frames, max(start_frame + 1, end_frame))
        if start_frame >= frames:
            break
        cues.append(
            {
                "segment_id": f"seg_caption_{index + 1}",
                "text": text,
                "start_frame": start_frame,
                "end_frame": end_frame,
                "render_profile": "noto-cjk-sc-bottom-v1",
            }
        )
        cursor = end_frame
    return cues


def _tag_ai_generated(ffmpeg: Path, ffprobe: Path, path: Path) -> None:
    temporary = path.with_name(f"{path.stem}-ai.mp4")
    try:
        _ffmpeg(
            ffmpeg,
            [
                "-i",
                str(path),
                "-c",
                "copy",
                "-map",
                "0",
                "-metadata",
                "comment=AI-generated",
                str(temporary),
            ],
        )
        has_video, has_audio, _duration = _probe_movie(ffprobe, temporary)
        if has_video and has_audio:
            temporary.replace(path)
        else:
            temporary.unlink(missing_ok=True)
    except StoryFilmError:
        temporary.unlink(missing_ok=True)


_EXPORT_REASONS = {
    "SOURCE_PROBE_INVALID": "合成没有读懂视频里的封面或多余音轨",
    "VIDEO_FRAME_RATE_MISMATCH": "视频帧率和成片时间轴不一致",
    "VIDEO_VFR_UNSUPPORTED": "视频帧间隔不均匀",
    "AUDIO_RANGE_UNSUPPORTED": "配音比画面短，合成没有把声音补齐",
    "AUDIO_LAYOUT_UNSUPPORTED": "配音的采样率或声道合成没有接住",
    "AUDIO_TIMING_UNSUPPORTED": "配音的时间不连续，合成没有接住",
    "CANVAS_UNSUPPORTED": "画面尺寸合成没有接住",
    "VIDEO_ROTATION_UNSUPPORTED": "视频带有旋转信息，合成没有接住",
    "MEDIA_ENCODE_FAILED": "整理画面或配音时没有成功",
    "PROBE_FAILED": "没有读到可以合成的画面",
    "EXPORT_FAILED": "合成没有完成",
    "SUBTITLE_FONT_UNAVAILABLE": "没有找到可以压字幕的中文字体",
    "SUBTITLE_GLYPH_UNSUPPORTED": "字幕里有当前字体写不出的字",
    "SUBTITLE_FONT_INVALID": "字幕字体读不出来",
}


def _save_subtitle_without_blocking(
    content: dict[str, object], output: Path, subtitle: str, frames: int
) -> str | None:
    """Keep the film when the caption cannot be burned in, and leave an .srt beside it."""

    if not subtitle or "subtitle_segments" not in content:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="aivora-subtitle-check-") as temporary:
            prepare_subtitles(
                EpisodeMediaAssemblyContentV1.model_validate(content),
                Path(temporary),
            )
    except DraftSubtitleError:
        _write_srt(output.with_suffix(".srt"), subtitle, frames)
        content.pop("subtitle_segments", None)
        return "字幕没能压进视频，已单独保存为字幕文件"
    return None


def _srt_clock(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _write_srt(path: Path, text: str, frames: int) -> None:
    end = _srt_clock(frames / _FRAME_RATE)
    path.write_text(f"1\n00:00:00,000 --> {end}\n{text}\n", encoding="utf-8")


def _export_reason(code: object) -> str | None:
    if isinstance(code, str):
        return _EXPORT_REASONS.get(code)
    return None


def _failure_log_code(error: BaseException) -> str:
    exit_code = getattr(error, "exit_code", None)
    if isinstance(exit_code, int) and not isinstance(exit_code, bool):
        token = f"exit_{abs(exit_code)}"
        if _safe_token(token):
            return token
    code = getattr(error, "code", None)
    if _safe_token(code):
        return str(code)
    name = type(error).__name__
    return name if _safe_token(name) else "FAILED"


def _failure_message(error: BaseException, stage: str, saved: bool, made: bool) -> str:
    if made:
        if isinstance(error, StoryFilmError) and error.message:
            if "已经做好" in error.message:
                return error.message
            detail = error.message.rstrip("。")
            return f"画面、视频和配音都已经做好。{detail}，可以重试。"
        export_reason = _export_reason(getattr(error, "code", None))
        if export_reason:
            return f"画面、视频和配音都已经做好。{export_reason}，可以重试。"
        return "画面、视频和配音都已经做好，合成这一步没有成功，可以重试。"
    if isinstance(error, (StoryFilmError, XaiMediaError)):
        return _named_stage_message(stage, saved, error.message)
    if isinstance(error, (DraftExportError, MediaAssetError)):
        export_reason = _export_reason(getattr(error, "code", None))
        return export_reason or "成片没有做完。"
    return "成片没有做完。"


def _named_stage_message(stage: str, saved: bool, fallback: str) -> str:
    if saved and stage not in {"image", "idle"}:
        label = {"speech": "配音", "assemble": "合成"}.get(stage, "视频")
        return f"画面已生成，{label}这一步没有成功，可以重试"
    if stage in {"image", "idle", "failed"} or not saved:
        return "画面这一步没有成功，可以重试"
    return fallback


def _failure_event(stage: str) -> str:
    return {
        "video": "video_submit",
        "speech": "tts",
        "assemble": "compose",
    }.get(stage, "image_saved")


def _failure_stage(stage: str) -> str:
    if stage in {"image", "video", "speech", "assemble"}:
        return stage
    return "image"


def _blocked(
    message: str,
    provider_label: str,
    billing_label: str,
    suggested: Literal["stub", "grok_subscription"] | None,
    fix: str | None,
) -> StoryFilmResult:
    return StoryFilmResult(
        status="BLOCKED",
        message=message,
        provider_label=provider_label,
        billing_label=billing_label,
        suggested_provider=suggested,
        fix=fix,
        task_id=None,
        attempt_id=None,
        artifact_version_id=None,
        output_path=None,
        output_sha256=None,
        duration_seconds=None,
        has_video=False,
        has_audio=False,
        draft=True,
        live_call=False,
    )


def _failed(
    message: str,
    provider_label: str,
    billing_label: str,
    task_id: str | None,
    attempt_id: str | None,
    *,
    suggested: Literal["stub", "grok_subscription"] | None = "stub",
    fix: str | None = "请改用本地占位再试一次。",
    preview_image: str | None = None,
) -> StoryFilmResult:
    return StoryFilmResult(
        status="FAILED",
        message=message,
        provider_label=provider_label,
        billing_label=billing_label,
        suggested_provider=suggested,
        fix=fix,
        task_id=task_id,
        attempt_id=attempt_id,
        artifact_version_id=None,
        output_path=None,
        output_sha256=None,
        duration_seconds=None,
        has_video=False,
        has_audio=False,
        draft=True,
        live_call=False,
        preview_image=preview_image,
    )
