"""Controlled image generation adapter for saved XAI API-key connections.

Reads credentials strictly from the operating-system CredentialVault in memory,
reserves an attempt durably in GenerationFailureStore (scope="story_creation")
before entering HTTP transport, preserves UNKNOWN on uncertain transport failure,
and writes verified image bytes atomically to a brand-new file without ever
overwriting existing media.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

from aijian_api.credential_vault import CredentialVault, CredentialVaultUnavailableError
from aijian_api.generation_failure_store import (
    FailureReservation,
    GenerationFailureError,
    GenerationFailureStore,
)
from aijian_api.provider_connection_repository import (
    ProviderConnection,
    ProviderConnectionNotFoundError,
    ProviderConnectionRepository,
)
from aijian_api.repository import StudioRepository
from aijian_api.xai_media import (
    XAI_API_ORIGIN,
    XaiHttpRequest,
    XaiHttpResponse,
    XaiMediaClient,
    XaiMediaError,
    XaiTransport,
    image_prompt,
    valid_image_reference,
)

MAX_IMAGE_BYTES = 12 * 1024 * 1024
_ALLOWED_ORIGINS = frozenset({"https://api.x.ai", "https://api.x.ai/v1"})
_ID_PATTERN = re.compile(r"[^\s\x00-\x1f]{1,200}\Z")
_ASPECT_RATIOS = frozenset({"9:16", "16:9", "1:1"})

type ImageDispatchStatus = Literal[
    "SUCCEEDED",
    "CANCELLED",
    "BLOCKED",
    "FAILED",
    "UNKNOWN",
]


@dataclass(frozen=True, slots=True)
class XaiConnectionImageRequest:
    connection_id: str
    model_id: str
    prompt: str
    idempotency_key: str
    aspect_ratio: Literal["9:16", "16:9", "1:1"] | None = None
    reference_images: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class XaiConnectionImageResult:
    status: ImageDispatchStatus
    code: str
    message: str
    connection_id: str
    model_id: str
    attempt_id: str | None = None
    asset_path: str | None = None
    asset_sha256: str | None = None
    mime_type: str | None = None
    byte_size: int | None = None


def _normalize_xai_base_url(base_url: str) -> str | None:
    parts = urlsplit(base_url.strip())
    if parts.scheme != "https" or parts.username or parts.password or parts.query or parts.fragment:
        return None
    normalized = f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}"
    return normalized if normalized in _ALLOWED_ORIGINS else None


def _detect_image_format(data: bytes) -> tuple[str, str] | None:
    if len(data) < 12 or len(data) > MAX_IMAGE_BYTES:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("image/png", ".png")
    if data.startswith(b"\xff\xd8\xff"):
        return ("image/jpeg", ".jpg")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("image/webp", ".webp")
    return None


def _input_sha256(
    *,
    project_id: str,
    connection: ProviderConnection,
    model_id: str,
    prompt: str,
    aspect_ratio: str | None,
    reference_images: tuple[str, ...],
) -> str:
    payload = {
        "project_id": project_id,
        "connection_id": connection.id,
        "connection_revision": connection.revision,
        "model_id": model_id,
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "reference_images": list(reference_images),
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _write_new_image_file(output_dir: Path, data: bytes, extension: str) -> tuple[Path, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(data).hexdigest()
    target = output_dir / f"xai-{uuid4().hex[:12]}-{digest[:12]}{extension}"
    temp = output_dir / f".tmp-{uuid4().hex}.part"
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.link(temp, target)
    finally:
        if temp.exists():
            temp.unlink()
    verified = hashlib.sha256(target.read_bytes()).hexdigest()
    if verified != digest:
        target.unlink(missing_ok=True)
        raise OSError("written image digest mismatch")
    return target.resolve(strict=True), digest


class _TrackingTransport:
    def __init__(self, inner: XaiTransport) -> None:
        self._inner = inner
        self.entered = False

    def send(self, request: XaiHttpRequest) -> XaiHttpResponse:
        self.entered = True
        return self._inner.send(request)


class XaiConnectionImageService:
    """Controlled single-image generation over a vault-backed XAI connection."""

    def __init__(
        self,
        repository: StudioRepository,
        credential_vault: CredentialVault,
        *,
        transport_factory: Callable[[], XaiTransport] | None = None,
        output_root: Path | None = None,
    ) -> None:
        self._repository = repository
        self._connections = ProviderConnectionRepository(repository.database_path)
        self._vault = credential_vault
        self._failures = GenerationFailureStore(repository, scope="story_creation")
        self._transport_factory = transport_factory
        self._output_root = output_root or (
            repository.database_path.parent / "xai-connection-images"
        )

    def _blocked(
        self,
        request: XaiConnectionImageRequest,
        code: str,
        message: str,
    ) -> XaiConnectionImageResult:
        return XaiConnectionImageResult(
            status="BLOCKED",
            code=code,
            message=message,
            connection_id=request.connection_id,
            model_id=request.model_id,
        )

    def _resolve_connection(
        self, request: XaiConnectionImageRequest
    ) -> tuple[ProviderConnection | None, XaiConnectionImageResult | None]:
        if not _ID_PATTERN.fullmatch(request.connection_id) or not _ID_PATTERN.fullmatch(
            request.model_id
        ):
            return None, self._blocked(request, "INVALID_SELECTION", "图像连接或模型参数无效。")
        if not _ID_PATTERN.fullmatch(request.idempotency_key):
            return None, self._blocked(
                request, "INVALID_IDEMPOTENCY_KEY", "缺少有效的本次出图幂等标识。"
            )
        if request.aspect_ratio is not None and request.aspect_ratio not in _ASPECT_RATIOS:
            return None, self._blocked(request, "INVALID_ASPECT_RATIO", "画幅参数不受支持。")
        try:
            connection = self._connections.get(request.connection_id)
        except ProviderConnectionNotFoundError:
            return None, self._blocked(
                request, "CONNECTION_NOT_FOUND", "所选的 xAI 连接不存在或已被删除。"
            )
        if not connection.enabled:
            return None, self._blocked(request, "CONNECTION_DISABLED", "所选的 xAI 连接已被停用。")
        if connection.provider_kind != "XAI":
            return None, self._blocked(
                request, "PROVIDER_KIND_UNSUPPORTED", "该连接类型尚未接入受控生图。"
            )
        if _normalize_xai_base_url(connection.base_url) is None:
            return None, self._blocked(
                request,
                "CONNECTION_ORIGIN_UNSUPPORTED",
                "仅允许使用官方 https://api.x.ai 接口地址进行受控生图。",
            )
        eligible = any(
            model.model_id == request.model_id and "IMAGE" in model.capabilities
            for model in connection.models
        )
        if not eligible:
            return None, self._blocked(
                request,
                "MODEL_NOT_ELIGIBLE",
                "所选模型不在该 xAI 连接的图像能力目录内，未自动回退其他模型。",
            )
        return connection, None

    def generate(
        self,
        project_id: str,
        request: XaiConnectionImageRequest,
        *,
        cancel_check: Callable[[], bool] | None = None,
    ) -> XaiConnectionImageResult:
        connection, blocked = self._resolve_connection(request)
        if blocked is not None or connection is None:
            return blocked or self._blocked(request, "INVALID_SELECTION", "图像连接无效。")

        cleaned_prompt = image_prompt(request.prompt)
        if not cleaned_prompt:
            return self._blocked(request, "PROMPT_EMPTY", "没有可以出图的提示词。")
        references = tuple(dict.fromkeys(request.reference_images))
        if len(references) > 5:
            return self._blocked(request, "IMAGE_REFERENCE_LIMIT", "首帧最多使用 5 张参考图。")
        if any(not valid_image_reference(item) for item in references):
            return self._blocked(request, "IMAGE_REFERENCE_INVALID", "参考图无法读取。")

        if cancel_check is not None and cancel_check():
            return XaiConnectionImageResult(
                status="CANCELLED",
                code="CANCELLED",
                message="已取消本次出图，没有发起外部请求。",
                connection_id=request.connection_id,
                model_id=request.model_id,
            )

        try:
            secret = self._vault.get(connection.credential_ref)
        except CredentialVaultUnavailableError:
            return self._blocked(
                request, "CREDENTIAL_UNAVAILABLE", "系统安全凭据库当前不可用，已阻止出图。"
            )
        if not isinstance(secret, str) or secret.strip() == "" or any(ord(c) < 32 for c in secret):
            return self._blocked(
                request, "CREDENTIAL_MISSING", "该 xAI 连接缺少已保存的密钥，请重新保存后再试。"
            )

        if self._transport_factory is None and os.environ.get("AIJIAN_ALLOW_LIVE_MEDIA") != "1":
            return self._blocked(
                request,
                "LIVE_MEDIA_DISABLED",
                "当前环境未开启实时外部生图开关，已阻止外部调用。",
            )

        digest = _input_sha256(
            project_id=project_id,
            connection=connection,
            model_id=request.model_id,
            prompt=cleaned_prompt,
            aspect_ratio=request.aspect_ratio,
            reference_images=references,
        )
        attempt_key = f"xai-image:{connection.id}:{request.idempotency_key}"
        reservation: FailureReservation | None = None
        try:
            reservation = self._failures.reserve(
                project_id, input_sha256=digest, attempt_key=attempt_key
            )
        except GenerationFailureError as error:
            code = str(error)
            mapping = {
                "PROJECT_NOT_FOUND": ("PROJECT_NOT_FOUND", "当前作品不存在。"),
                "UNCONFIGURED": (
                    "BUDGET_UNCONFIGURED",
                    "请先为当前作品设置显式创作失败上限后再出图。",
                ),
                "INPUT_FAILURE_LIMIT": (
                    "FAILURE_LIMIT_REACHED",
                    "同一输入已达到失败或未决上限，已阻止再次派发。",
                ),
                "ATTEMPT_ALREADY_RESERVED": (
                    "ATTEMPT_DUPLICATE_BLOCKED",
                    "本次出图请求已登记或状态未决，已阻止重复派发。",
                ),
            }
            mapped_code, mapped_message = mapping.get(
                code, ("RESERVATION_REJECTED", "当前预算或失败保护策略拒绝本次出图。")
            )
            return self._blocked(request, mapped_code, mapped_message)

        if cancel_check is not None and cancel_check():
            self._failures.discard_before_transport(project_id, reservation)
            return XaiConnectionImageResult(
                status="CANCELLED",
                code="CANCELLED",
                message="已取消本次出图，没有发起外部请求。",
                connection_id=request.connection_id,
                model_id=request.model_id,
                attempt_id=reservation.attempt_id,
            )

        transport = self._build_transport()
        tracker = _TrackingTransport(transport)
        client = XaiMediaClient(tracker, token=secret, origin=XAI_API_ORIGIN)

        try:
            image = client.generate_image(
                prompt=cleaned_prompt,
                model=request.model_id,
                aspect_ratio=request.aspect_ratio,
                reference_images=references,
            )
            raw_bytes = image.data
            if not raw_bytes and image.source_url:
                downloaded = tracker.send(
                    XaiHttpRequest(
                        method="GET",
                        url=image.source_url,
                        headers={"Accept": "image/*"},
                        body=None,
                    )
                )
                if not 200 <= downloaded.status < 300:
                    raise XaiMediaError(
                        "IMAGE_DOWNLOAD_FAILED",
                        "生成图片下载失败，已有版本未被覆盖。",
                        http_status=downloaded.status,
                    )
                raw_bytes = downloaded.body
            detected = _detect_image_format(raw_bytes)
            if detected is None:
                self._failures.settle(project_id, reservation, "FAILED")
                return XaiConnectionImageResult(
                    status="FAILED",
                    code="IMAGE_INVALID_BYTES",
                    message="返回的图片字节无效或超过大小限制，已有版本保持不变。",
                    connection_id=request.connection_id,
                    model_id=request.model_id,
                    attempt_id=reservation.attempt_id,
                )
            mime_type, extension = detected
            saved_path, file_sha = _write_new_image_file(
                self._output_root / project_id, raw_bytes, extension
            )
            self._failures.settle(project_id, reservation, "SUCCEEDED")
            return XaiConnectionImageResult(
                status="SUCCEEDED",
                code="SUCCEEDED",
                message="图片已通过受控 xAI 连接生成并保存。",
                connection_id=request.connection_id,
                model_id=request.model_id,
                attempt_id=reservation.attempt_id,
                asset_path=str(saved_path),
                asset_sha256=file_sha,
                mime_type=mime_type,
                byte_size=len(raw_bytes),
            )
        except XaiMediaError as error:
            if not tracker.entered:
                self._failures.discard_before_transport(project_id, reservation)
                return self._blocked(request, error.code, error.message)
            if error.code in {"NETWORK", "UPSTREAM_UNREACHABLE"}:
                self._failures.settle(project_id, reservation, "UNKNOWN")
                return XaiConnectionImageResult(
                    status="UNKNOWN",
                    code="TRANSPORT_UNKNOWN",
                    message="外部生图请求结果未确认，已保留本次占位且不自动重发；已有版本保持不变。",
                    connection_id=request.connection_id,
                    model_id=request.model_id,
                    attempt_id=reservation.attempt_id,
                )
            self._failures.settle(project_id, reservation, "FAILED")
            code = (
                "PROVIDER_AUTH_FAILED"
                if error.http_status in {401, 403}
                else error.code or "IMAGE_GENERATION_FAILED"
            )
            return XaiConnectionImageResult(
                status="FAILED",
                code=code,
                message=error.message,
                connection_id=request.connection_id,
                model_id=request.model_id,
                attempt_id=reservation.attempt_id,
            )
        except Exception:
            if not tracker.entered:
                self._failures.discard_before_transport(project_id, reservation)
                return XaiConnectionImageResult(
                    status="FAILED",
                    code="DISPATCH_PREFLIGHT_FAILED",
                    message="出图准备失败，没有发起外部请求；已有版本保持不变。",
                    connection_id=request.connection_id,
                    model_id=request.model_id,
                    attempt_id=reservation.attempt_id,
                )
            self._failures.settle(project_id, reservation, "UNKNOWN")
            return XaiConnectionImageResult(
                status="UNKNOWN",
                code="TRANSPORT_UNKNOWN",
                message="外部生图响应状态未确认，已保留本次占位且不自动重发；已有版本保持不变。",
                connection_id=request.connection_id,
                model_id=request.model_id,
                attempt_id=reservation.attempt_id,
            )

    def _build_transport(self) -> XaiTransport:
        if self._transport_factory is not None:
            return self._transport_factory()
        from aijian_api.xai_media_transport import urllib_xai_transport

        return urllib_xai_transport()
