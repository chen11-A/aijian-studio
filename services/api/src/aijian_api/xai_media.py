"""xAI image, video, and speech protocol. Callers inject the HTTP transport.

The client never opens a socket by itself. A production transport is constructed
only by the story-film service after the live-media gate allows it. Tokens stay
in memory for the call and are not written into task snapshots.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

from aijian_api.grok_status_log import append_grok_status

XAI_API_ORIGIN = "https://api.x.ai"
_USER_AGENT = "AIVORA/0.2.5"
IMAGE_GENERATION_PATH = "/v1/images/generations"
VIDEO_GENERATION_PATH = "/v1/videos/generations"
VIDEO_POLL_PATH = "/v1/videos/{request_id}"
TTS_PATH = "/v1/tts"
IMAGE_MODEL = "grok-imagine-image-2.0"
VIDEO_MODEL = "grok-imagine-video-1.5"
TTS_MODEL = "grok-tts"


class XaiMediaError(RuntimeError):
    def __init__(self, code: str, message: str, *, http_status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@dataclass(frozen=True, slots=True)
class XaiHttpRequest:
    method: str
    url: str
    headers: Mapping[str, str]
    body: bytes | None


@dataclass(frozen=True, slots=True)
class XaiHttpResponse:
    status: int
    body: bytes
    content_type: str = ""


class XaiTransport(Protocol):
    def send(self, request: XaiHttpRequest) -> XaiHttpResponse:
        """Perform one HTTP round trip. Must not log the authorization header."""


@dataclass(frozen=True, slots=True)
class XaiImage:
    data: bytes
    source_url: str | None
    model: str


@dataclass(frozen=True, slots=True)
class XaiVideoSubmit:
    request_id: str
    model: str


@dataclass(frozen=True, slots=True)
class XaiVideoPoll:
    request_id: str
    status: str
    video_url: str | None


@dataclass(frozen=True, slots=True)
class XaiCancelResult:
    request_id: str
    upstream_stopped: bool
    billing_stopped: bool
    detail: str


class XaiMediaClient:
    """Submit, poll, download, and cancel against the documented xAI media routes."""

    def __init__(
        self,
        transport: XaiTransport,
        *,
        token: str,
        origin: str = XAI_API_ORIGIN,
        log: Callable[..., None] | None = None,
    ) -> None:
        if not isinstance(token, str) or token.strip() == "" or any(ord(c) < 32 for c in token):
            raise XaiMediaError("TOKEN_MISSING", "缺少可用的登录凭证，没有发起生成。")
        self._transport = transport
        self._token = token.strip()
        self._origin = origin.rstrip("/")
        self._log = log

    def generate_image(self, *, prompt: str, model: str = IMAGE_MODEL) -> XaiImage:
        payload = self._post_json(
            IMAGE_GENERATION_PATH,
            {"model": model, "prompt": prompt, "n": 1, "response_format": "url"},
            "image",
        )
        rows = payload.get("data")
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise XaiMediaError("IMAGE_RESPONSE_INVALID", "画面接口没有返回可用的图片。")
        data, source_url = self._image_bytes(rows[0])
        if not data and not (isinstance(source_url, str) and source_url.startswith("https://")):
            raise XaiMediaError("IMAGE_EMPTY", "画面接口返回了空文件。")
        return XaiImage(data=data, source_url=source_url, model=model)

    def submit_video(
        self,
        *,
        prompt: str,
        image_url: str | None = None,
        image: XaiImage | None = None,
        model: str = VIDEO_MODEL,
        duration: int = 2,
    ) -> XaiVideoSubmit:
        body: dict[str, object] = {"model": model, "prompt": prompt, "duration": duration}
        reference = _image_reference(image) if image is not None else None
        if reference is None and isinstance(image_url, str) and image_url.startswith("https://"):
            reference = {"url": image_url}
        if reference is not None:
            body["image"] = reference
        payload = self._post_json(VIDEO_GENERATION_PATH, body, "video_submit")
        request_id = payload.get("request_id")
        if not isinstance(request_id, str) or not request_id.strip():
            raise XaiMediaError("VIDEO_RESPONSE_INVALID", "视频接口没有返回任务编号。")
        return XaiVideoSubmit(request_id=request_id.strip(), model=model)

    def poll_video(self, request_id: str) -> XaiVideoPoll:
        payload = self._get_json(VIDEO_POLL_PATH.format(request_id=request_id), "video_poll")
        status = payload.get("status")
        if not isinstance(status, str):
            raise XaiMediaError("VIDEO_RESPONSE_INVALID", "视频进度里没有状态。")
        normalized = status.strip().lower()
        if normalized in {"completed", "succeeded", "success"}:
            normalized = "done"
        return XaiVideoPoll(
            request_id=request_id, status=normalized, video_url=_video_url(payload, normalized)
        )

    def _image_bytes(self, row: Mapping[str, object]) -> tuple[bytes, str | None]:
        # revised_prompt is display text from the provider. It is never logged.
        _ = row.get("revised_prompt")
        encoded = row.get("b64_json")
        if not isinstance(encoded, str) or not encoded.strip():
            encoded = row.get("b64") if isinstance(row.get("b64"), str) else None
        url = row.get("url") if isinstance(row.get("url"), str) else None
        if isinstance(url, str) and url.startswith("/"):
            url = f"{self._origin}{url}"
        https = url if isinstance(url, str) and url.startswith("https://") else None
        has_picture = (
            (isinstance(encoded, str) and bool(encoded.strip()))
            or bool(https)
            or (isinstance(url, str) and url.startswith("data:image/"))
        )
        if row.get("respect_moderation") is False and not has_picture:
            raise XaiMediaError("IMAGE_FILTERED", "画面没有通过内容检查，没有可保存的图片。")
        if isinstance(encoded, str) and encoded.strip():
            data = _decode_image(encoded)
            return data, https
        if isinstance(url, str) and url.startswith("data:image/"):
            return _decode_image(url), None
        if https:
            try:
                return self.download(https), https
            except XaiMediaError as error:
                self._note(
                    "image_saved",
                    code=error.code,
                    http_status=error.http_status,
                    error_stage="image",
                    error_code=error.code,
                )
                return b"", https
        raise XaiMediaError("IMAGE_RESPONSE_INVALID", "画面接口没有返回图片内容。")

    def download(self, url: str) -> bytes:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise XaiMediaError("DOWNLOAD_URL_INVALID", "生成结果的下载地址不可用。")
        headers = {"Accept": "*/*", "User-Agent": _USER_AGENT}
        if parsed.netloc == "api.x.ai":
            headers["Authorization"] = f"Bearer {self._token}"
        response = self._transport.send(
            XaiHttpRequest(method="GET", url=url, headers=headers, body=None)
        )
        if response.status != 200 or not response.body:
            raise XaiMediaError(
                "DOWNLOAD_FAILED",
                "生成结果没有下载成功。",
                http_status=response.status,
            )
        return response.body

    def synthesize(self, *, text: str, voice_id: str = "eve", language: str = "zh") -> bytes:
        response = self._send(
            XaiHttpRequest(
                method="POST",
                url=f"{self._origin}{TTS_PATH}",
                headers=self._json_headers(),
                body=_json_bytes(
                    {
                        "text": text,
                        "voice_id": voice_id,
                        "language": language,
                        "output_format": {"codec": "mp3", "sample_rate": 24000, "bit_rate": 128000},
                    }
                ),
            ),
            "tts",
        )
        if response.status != 200 or not response.body:
            raise XaiMediaError("SPEECH_FAILED", "配音没有生成成功。")
        content_type = response.content_type.lower()
        if "json" in content_type:
            raise XaiMediaError("SPEECH_FAILED", "配音接口没有返回音频。")
        return response.body

    def cancel_video(self, request_id: str) -> XaiCancelResult:
        """xAI documents poll statuses, not a cancel that stops billing.

        Local cancellation therefore does not send a request and must not be
        described as an upstream stop.
        """

        _ = self
        return XaiCancelResult(
            request_id=request_id,
            upstream_stopped=False,
            billing_stopped=False,
            detail="xAI 没有提供会停止计费的取消接口。本地已停止等待，上游任务可能仍在生成。",
        )

    def _post_json(self, path: str, body: Mapping[str, object], event: str) -> dict[str, object]:
        response = self._send(
            XaiHttpRequest(
                method="POST",
                url=f"{self._origin}{path}",
                headers=self._json_headers(),
                body=_json_bytes(body),
            ),
            event,
        )
        return self._json_body(response)

    def _get_json(self, path: str, event: str) -> dict[str, object]:
        response = self._send(
            XaiHttpRequest(
                method="GET",
                url=f"{self._origin}{path}",
                headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                body=None,
            ),
            event,
        )
        return self._json_body(response)

    def _send(self, request: XaiHttpRequest, event: str) -> XaiHttpResponse:
        try:
            response = self._transport.send(request)
        except Exception as error:
            self._note(
                event,
                code="NETWORK",
                http_status=None,
                error_stage=_event_stage(event),
                error_code="NETWORK",
            )
            raise XaiMediaError("NETWORK", "生成服务没有连上。") from error
        ok = 200 <= response.status < 300
        self._note(
            event,
            code="ok" if ok else "UPSTREAM_HTTP",
            http_status=response.status,
            error_stage=None if ok else _event_stage(event),
            error_code=None if ok else "UPSTREAM_HTTP",
        )
        return response

    def _note(
        self,
        event: str,
        *,
        code: str | None,
        http_status: int | None,
        error_stage: str | None = None,
        error_code: str | None = None,
    ) -> None:
        if self._log is not None:
            self._log(
                event,
                code=code,
                http_status=http_status,
                error_stage=error_stage,
                error_code=error_code,
            )
            return
        append_grok_status(
            event,
            code=code,
            http_status=http_status,
            error_stage=error_stage,
            error_code=error_code,
        )

    def _json_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @staticmethod
    def _json_body(response: XaiHttpResponse) -> dict[str, object]:
        if response.status < 200 or response.status >= 300:
            raise XaiMediaError(
                "UPSTREAM_HTTP",
                "生成服务没有成功返回，请稍后再试。",
                http_status=response.status,
            )
        try:
            payload = json.loads(response.body.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise XaiMediaError("UPSTREAM_BODY", "生成服务的返回无法读取。") from error
        if not isinstance(payload, dict):
            raise XaiMediaError("UPSTREAM_BODY", "生成服务的返回无法读取。")
        return payload


def _json_bytes(body: Mapping[str, object]) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _decode_image(encoded: str) -> bytes:
    payload = encoded.strip()
    if payload.startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]
    payload = "".join(payload.split())
    payload += "=" * ((-len(payload)) % 4)
    try:
        data = base64.b64decode(payload, validate=False)
    except ValueError as error:
        raise XaiMediaError("IMAGE_RESPONSE_INVALID", "画面数据无法读取。") from error
    if not data:
        raise XaiMediaError("IMAGE_EMPTY", "画面接口返回了空文件。")
    return data


def _event_stage(event: str) -> str:
    if event in {"video_submit", "video_poll"}:
        return "video"
    if event == "tts":
        return "speech"
    if event == "compose":
        return "assemble"
    return "image"


def _image_reference(image: XaiImage) -> dict[str, str]:
    """Pass an https URL when xAI returned one, otherwise the image bytes as a data URI."""

    if image.source_url and image.source_url.startswith("https://"):
        return {"url": image.source_url}
    mime = "image/png"
    if image.data.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif image.data.startswith(b"RIFF") and b"WEBP" in image.data[:16]:
        mime = "image/webp"
    encoded = base64.b64encode(image.data).decode("ascii")
    return {"url": f"data:{mime};base64,{encoded}"}


def _video_url(payload: Mapping[str, object], status: str) -> str | None:
    video = payload.get("video")
    if isinstance(video, str) and video.startswith("https://"):
        return video
    candidates: list[object] = []
    if isinstance(video, dict):
        candidates.extend(video.get(key) for key in ("url", "video_url"))
    if status == "done":
        candidates.extend(payload.get(key) for key in ("url", "video_url"))
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.startswith("https://"):
            return candidate
    return None
