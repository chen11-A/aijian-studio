"""Shortest scene-to-MP4 path on the existing task, artifact, and export ledgers.

The default provider is a local FFmpeg placeholder. Subscription logins are
recorded as zero-amount authorizations before any live call. Metered requests
stop at the budget assessment and are not sent upstream: the budget ledger's
dispatch receipt is defined as a no-network stub, so this path will not pretend
a paid call happened.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
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
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.media_asset_contracts import MediaAssetData
from aijian_api.media_asset_store import MediaAssetError, MediaAssetStore
from aijian_api.media_budget_policy import BudgetAmount, evaluate_media_budget
from aijian_api.media_budget_store import MediaBudgetStore
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.repository import StudioRepository
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


class StoryFilmError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


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

    def produce(
        self,
        project_id: str,
        request: StoryFilmRequest,
        *,
        media_token: str | None = None,
    ) -> StoryFilmResult:
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
            if request.provider == "grok_subscription":
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
        except (StoryFilmError, DraftExportError, MediaAssetError, OSError, XaiMediaError) as error:
            self._ledger.fail_local_task(running, error_code="STORY_FILM_FAILED")
            detail = (
                error.message
                if isinstance(error, (StoryFilmError, XaiMediaError))
                else "成片没有做完。"
            )
            mark_film_progress(project_id, "failed", detail)
            if isinstance(error, (StoryFilmError, XaiMediaError)):
                message = error.message
            elif isinstance(error, (DraftExportError, MediaAssetError)):
                message = str(error)
            else:
                message = "成片没有做完。"
            grok = request.provider == "grok_subscription"
            return _failed(
                message,
                provider_label,
                billing_label,
                running.task_id,
                running.attempt_id,
                suggested=None if grok else "stub",
                fix="可以重试。" if grok else "请改用本地占位再试一次。",
            )
        self._ledger.complete_local_task(
            running, output_version_id=result.artifact_version_id or ""
        )
        mark_film_progress(project_id, "done", result.message)
        message = result.message
        if self._partial_note:
            message = f"{self._partial_note} 成片已保存。"
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
        stem = hashlib.sha256(request.idempotency_key.encode()).hexdigest()[:16]
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

    def _live_media(
        self, request: StoryFilmRequest, media_token: str | None, project_id: str = ""
    ) -> tuple[bytes, bytes, bytes]:
        if not media_token or not live_media_enabled():
            raise StoryFilmError("LIVE_DISABLED", "当前环境不会发起真实生成。")
        if self._transport is None:
            from aijian_api.xai_media_transport import urllib_xai_transport

            transport = urllib_xai_transport()
        else:
            transport = self._transport
        client = XaiMediaClient(transport, token=media_token)
        self._partial_note = None
        self._ensure_running(project_id)
        mark_film_progress(project_id, "image", "正在生成画面。")
        image = client.generate_image(
            prompt=request.scene_label, model=request.image_model or IMAGE_MODEL
        )
        image_path = self._persist_image(request, image.data)
        mark_film_progress(project_id, "image", "画面已保存。", image_saved=True)
        self._ensure_running(project_id)
        mark_film_progress(project_id, "video", "正在生成视频。", image_saved=True)
        clip, video_note = self._live_video(client, request, image, project_id, image_path)
        self._ensure_running(project_id)
        mark_film_progress(project_id, "speech", "正在生成配音。", image_saved=True)
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
                    f"画面已保存在本机：{image_path}。视频和配音都没有完成。可以重试。",
                ) from error
            raise StoryFilmError(
                "SPEECH_FAILED",
                f"视频已生成，配音没有完成。画面在 {image_path}。可以重试。",
            ) from error
        if clip is None:
            clip = self._still_clip(request, image.data, speech)
            self._partial_note = video_note or "视频没有完成，已用这张画面和配音做成片。"
            mark_film_progress(project_id, "assemble", self._partial_note, image_saved=True)
        else:
            mark_film_progress(project_id, "assemble", "正在合成。", image_saved=True)
        return image.data, clip, speech

    def _ensure_running(self, project_id: str) -> None:
        if project_id and film_cancel_requested(project_id):
            raise StoryFilmError(
                "CANCELLED",
                "已停止等待。画面如果已经生成，会留在这台电脑上。可以重试。",
            )

    def _persist_image(self, request: StoryFilmRequest, image: bytes) -> Path:
        directory = Path(self._repository.database_path).parent / "story-films"
        directory.mkdir(parents=True, exist_ok=True)
        stem = hashlib.sha256(request.idempotency_key.encode()).hexdigest()[:16]
        path = directory / f"{stem}-key.png"
        path.write_bytes(image)
        return path

    def _live_video(
        self,
        client: XaiMediaClient,
        request: StoryFilmRequest,
        image: object,
        project_id: str,
        image_path: Path,
    ) -> tuple[bytes | None, str | None]:
        if not isinstance(image, XaiImage):
            raise StoryFilmError("IMAGE_RESPONSE_INVALID", "画面没有保存下来。")
        try:
            submitted = client.submit_video(
                prompt=request.narration,
                image=image,
                model=request.video_model or VIDEO_MODEL,
                duration=2,
            )
        except XaiMediaError as error:
            return None, error.message
        for _ in range(90):
            self._ensure_running(project_id)
            try:
                polled = client.poll_video(submitted.request_id)
            except XaiMediaError as error:
                return None, error.message
            if polled.status == "done" and polled.video_url:
                try:
                    return client.download(polled.video_url), None
                except XaiMediaError as error:
                    return None, error.message
            if polled.status in {"failed", "expired"}:
                client.cancel_video(submitted.request_id)
                return None, "视频没有生成成功。画面已保留，可以重试。"
            self._sleep(2)
        client.cancel_video(submitted.request_id)
        return None, f"视频还在生成，已停止等待。画面在 {image_path}。可以重试。"

    def _still_clip(self, request: StoryFilmRequest, image: bytes, speech: bytes) -> bytes:
        tools = self._tools()
        directory = Path(self._repository.database_path).parent / "story-films"
        directory.mkdir(parents=True, exist_ok=True)
        stem = hashlib.sha256(request.idempotency_key.encode()).hexdigest()[:16]
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
        audio_path = directory / f"{stem}-voice.wav"
        image_path.write_bytes(image)
        clip_path.write_bytes(clip)
        audio_path.write_bytes(speech)
        frames = _video_frames(tools.ffprobe_path, clip_path)
        store = MediaAssetStore(self._repository)
        image_asset = store.import_local(project_id, image_path, display_filename="关键画面.png")
        clip_asset = store.import_local(project_id, clip_path, display_filename="镜头.mp4")
        audio_asset = store.import_local(project_id, audio_path, display_filename="旁白.wav")
        episode_id = self._episode_id(project_id)
        subtitle = request.subtitle.strip() if request.subtitle else ""
        content: dict[str, object] = {
            "project_id": project_id,
            "episode_id": episode_id,
            "sequence_timebase": {
                "frame_rate": {"num": _FRAME_RATE, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": _CANVAS[0],
            "canvas_height": _CANVAS[1],
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
        if subtitle:
            content["subtitle_segments"] = [
                {
                    "segment_id": "seg_caption",
                    "text": subtitle,
                    "start_frame": 0,
                    "end_frame": frames,
                    "render_profile": "noto-cjk-sc-bottom-v1",
                }
            ]
        assembly = EpisodeMediaAssemblyStore(self._repository).create_version(
            project_id,
            episode_id,
            CreateEpisodeMediaAssemblyVersionRequest(
                content=EpisodeMediaAssemblyContentV1.model_validate(content),
                change_summary="由一句话故事合成的草稿成片",
            ),
            author_actor_id="story-film",
        )
        output = directory / f"{stem}-film.mp4"
        runtime = DraftExportRuntime(
            self._repository,
            self._toolchain_provider,
            ProductExportJobManager() if sys.platform == "win32" else None,
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
        if job.status != "SUCCEEDED" or job.output_path is None or job.output_sha256 is None:
            raise StoryFilmError("EXPORT_FAILED", job.error_message or "成片导出没有完成。")
        has_video, has_audio, duration = _probe_movie(tools.ffprobe_path, Path(job.output_path))
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
            "draft_operation_id": export.operation_id,
            "output_sha256": job.output_sha256,
            "duration_frames": frames,
            "frame_rate": _FRAME_RATE,
            "draft": True,
            "release_claim": False,
        }
        record = self._repository.create_artifact_version(
            project_id=project_id,
            artifact_type="story_film",
            schema_version="1.0.0",
            content=manifest,
            author_actor_type="human",
            author_actor_id="story-film",
            change_summary="一句话故事的草稿成片",
            producer_attempt_id=attempt_id,
        )
        provider_label, billing_label = provider_copy(request.provider)
        return StoryFilmResult(
            status="SUCCEEDED",
            message="草稿成片已经保存。这还不是正式发行，可以在播放器里打开看看。",
            provider_label=provider_label,
            billing_label=billing_label,
            suggested_provider=None,
            fix=None,
            task_id=None,
            attempt_id=attempt_id,
            artifact_version_id=record.version.id,
            output_path=job.output_path,
            output_sha256=job.output_sha256,
            duration_seconds=f"{duration:.3f}",
            has_video=has_video,
            has_audio=has_audio,
            draft=True,
            live_call=False,
        )

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


def _ffmpeg(ffmpeg: Path, args: list[str]) -> None:
    completed = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-nostdin", "-y", *args],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise StoryFilmError("MEDIA_ENCODE_FAILED", "成片没有编码成功，请确认视频工具可用。")


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
        raise StoryFilmError("PROBE_FAILED", "没有读到成片信息。")
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
    project_id: str, stage: str, message: str, *, image_saved: bool = False
) -> None:
    if not project_id:
        return
    with _PROGRESS_LOCK:
        current = _PROGRESS.get(project_id)
        continuing = current is not None and current.get("stage") not in {"done", "failed", "idle"}
        started = current.get("started") if current is not None and continuing else time.monotonic()
        saved = image_saved or bool(current and current.get("image_saved"))
        _PROGRESS[project_id] = {
            "stage": stage,
            "message": message,
            "started": started,
            "image_saved": saved,
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
        }
    started = current.get("started")
    elapsed = max(0, int(time.monotonic() - float(started))) if isinstance(started, float) else 0
    stage = str(current.get("stage") or "idle")
    return {
        "stage": stage,
        "label": _STAGE_LABELS.get(stage, "等待"),
        "elapsed_seconds": elapsed,
        "image_saved": bool(current.get("image_saved")),
        "message": str(current.get("message") or ""),
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
    )
