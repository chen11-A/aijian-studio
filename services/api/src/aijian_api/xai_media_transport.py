"""Optional urllib transport for a real xAI media call.

Imported only after the story-film gate has allowed a live request. Tests inject
their own transport and never load this module.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Callable

from aijian_api.xai_media import XaiHttpRequest, XaiHttpResponse, XaiMediaError, XaiTransport

_USER_AGENT = "AIVORA/0.2.5"


def urllib_xai_transport() -> XaiTransport:
    def send(request: XaiHttpRequest) -> XaiHttpResponse:
        headers = dict(request.headers)
        headers.setdefault("User-Agent", _USER_AGENT)
        outgoing = urllib.request.Request(
            request.url,
            data=request.body,
            headers=headers,
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
            payload = error.read()
            content_type = error.headers.get("Content-Type", "") if error.headers else ""
            return XaiHttpResponse(
                status=int(error.code),
                body=payload,
                content_type=content_type,
            )
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
