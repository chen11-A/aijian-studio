"""Optional urllib transport for a real xAI media call.

Imported only after the story-film gate has allowed a live request. Tests inject
their own transport and never load this module.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Callable

from aijian_api.xai_media import XaiHttpRequest, XaiHttpResponse, XaiMediaError, XaiTransport


def urllib_xai_transport() -> XaiTransport:
    def send(request: XaiHttpRequest) -> XaiHttpResponse:
        outgoing = urllib.request.Request(
            request.url,
            data=request.body,
            headers=dict(request.headers),
            method=request.method,
        )
        try:
            with urllib.request.urlopen(outgoing, timeout=30) as response:
                return XaiHttpResponse(
                    status=response.status,
                    body=response.read(),
                    content_type=response.headers.get("Content-Type", ""),
                )
        except urllib.error.HTTPError as error:
            raise XaiMediaError("UPSTREAM_HTTP", "生成服务没有成功返回，请稍后再试。") from error
        except urllib.error.URLError as error:
            raise XaiMediaError(
                "UPSTREAM_UNREACHABLE", "连不上生成服务，请检查网络后再试。"
            ) from error

    return _CallableTransport(send)


class _CallableTransport:
    def __init__(self, send: Callable[[XaiHttpRequest], XaiHttpResponse]) -> None:
        self._send = send

    def send(self, request: XaiHttpRequest) -> XaiHttpResponse:
        return self._send(request)
