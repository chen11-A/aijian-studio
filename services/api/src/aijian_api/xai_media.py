"""xAI image, video, and speech protocol. Callers inject the HTTP transport.

The client never opens a socket by itself. A production transport is constructed
only by the story-film service after the live-media gate allows it. Tokens stay
in memory for the call and are not written into task snapshots.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

XAI_API_ORIGIN = "https://api.x.ai"
IMAGE_GENERATION_PATH = "/v1/images/generations"
VIDEO_GENERATION_PATH = "/v1/videos/generations"
VIDEO_POLL_PATH = "/v1/videos/{request_id}"
TTS_PATH = "/v1/tts"
IMAGE_MODEL = "grok-imagine-image-2.0"
VIDEO_MODEL = "grok-imagine-video-1.5"
TTS_MODEL = "grok-tts"


class XaiMediaError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


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
        self, transport: XaiTransport, *, token: str, origin: str = XAI_API_ORIGIN
    ) -> None:
        if not isinstance(token, str) or token.strip() == "" or any(ord(c) < 32 for c in token):
            raise XaiMediaError("TOKEN_MISSING", "缺少可用的登录凭证，没有发起生成。")
        self._transport = transport
        self._token = token.strip()
        self._origin = origin.rstrip("/")

    def generate_image(self, *, prompt: str, model: str = IMAGE_MODEL) -> XaiImage:
        payload = self._post_json(
            IMAGE_GENERATION_PATH,
            {"model": model, "prompt": prompt, "n": 1, "response_format": "b64_json"},
        )
        rows = payload.get("data")
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise XaiMediaError("IMAGE_RESPONSE_INVALID", "画面接口没有返回可用的图片。")
        row = rows[0]
        encoded = row.get("b64_json")
        url = row.get("url") if isinstance(row.get("url"), str) else None
        if isinstance(encoded, str) and encoded:
            try:
                data = base64.b64decode(encoded, validate=True)
            except ValueError as error:
                raise XaiMediaError("IMAGE_RESPONSE_INVALID", "画面数据无法读取。") from error
        elif url:
            data = self.download(url)
        else:
            raise XaiMediaError("IMAGE_RESPONSE_INVALID", "画面接口没有返回图片内容。")
        if not data:
            raise XaiMediaError("IMAGE_EMPTY", "画面接口返回了空文件。")
        return XaiImage(data=data, source_url=url, model=model)

    def submit_video(
        self,
        *,
        prompt: str,
        image_url: str | None,
        model: str = VIDEO_MODEL,
        duration: int = 2,
    ) -> XaiVideoSubmit:
        body: dict[str, object] = {"model": model, "prompt": prompt, "duration": duration}
        if image_url:
            body["image"] = {"url": image_url}
        payload = self._post_json(VIDEO_GENERATION_PATH, body)
        request_id = payload.get("request_id")
        if not isinstance(request_id, str) or not request_id.strip():
            raise XaiMediaError("VIDEO_RESPONSE_INVALID", "视频接口没有返回任务编号。")
        return XaiVideoSubmit(request_id=request_id.strip(), model=model)

    def poll_video(self, request_id: str) -> XaiVideoPoll:
        payload = self._get_json(VIDEO_POLL_PATH.format(request_id=request_id))
        status = payload.get("status")
        if not isinstance(status, str):
            raise XaiMediaError("VIDEO_RESPONSE_INVALID", "视频进度里没有状态。")
        video = payload.get("video")
        url = None
        if isinstance(video, dict) and isinstance(video.get("url"), str):
            url = video["url"]
        return XaiVideoPoll(request_id=request_id, status=status, video_url=url)

    def download(self, url: str) -> bytes:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise XaiMediaError("DOWNLOAD_URL_INVALID", "生成结果的下载地址不可用。")
        headers = {"Accept": "*/*"}
        if parsed.netloc == "api.x.ai":
            headers["Authorization"] = f"Bearer {self._token}"
        response = self._transport.send(
            XaiHttpRequest(method="GET", url=url, headers=headers, body=None)
        )
        if response.status != 200 or not response.body:
            raise XaiMediaError("DOWNLOAD_FAILED", "生成结果没有下载成功。")
        return response.body

    def synthesize(self, *, text: str, voice_id: str = "eve", language: str = "zh") -> bytes:
        response = self._transport.send(
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
            )
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

    def _post_json(self, path: str, body: Mapping[str, object]) -> dict[str, object]:
        response = self._transport.send(
            XaiHttpRequest(
                method="POST",
                url=f"{self._origin}{path}",
                headers=self._json_headers(),
                body=_json_bytes(body),
            )
        )
        return self._json_body(response)

    def _get_json(self, path: str) -> dict[str, object]:
        response = self._transport.send(
            XaiHttpRequest(
                method="GET",
                url=f"{self._origin}{path}",
                headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                body=None,
            )
        )
        return self._json_body(response)

    def _json_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @staticmethod
    def _json_body(response: XaiHttpResponse) -> dict[str, object]:
        if response.status < 200 or response.status >= 300:
            raise XaiMediaError("UPSTREAM_HTTP", "生成服务没有成功返回，请稍后再试。")
        try:
            payload = json.loads(response.body.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise XaiMediaError("UPSTREAM_BODY", "生成服务的返回无法读取。") from error
        if not isinstance(payload, dict):
            raise XaiMediaError("UPSTREAM_BODY", "生成服务的返回无法读取。")
        return payload


def _json_bytes(body: Mapping[str, object]) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
