"""Append-only generation log. Status codes only: no prompts, tokens, or URLs."""

from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

_NAME = re.compile(r"[A-Za-z0-9_]{1,40}")
_SECRET = re.compile(
    r"bearer\s|access_token|refresh_token|code_verifier|device_code=|user_code=|eyJ[A-Za-z0-9_-]{8,}",
    re.IGNORECASE,
)


def _http_status(value: int | None) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 100 <= value <= 599


def append_grok_status(
    event: str,
    *,
    code: str | None = None,
    http_status: int | None = None,
    error_stage: str | None = None,
    error_code: str | None = None,
) -> None:
    raw = os.environ.get("AIVORA_GROK_LOGIN_LOG", "")
    if not raw or "\n" in raw or "\x00" in raw:
        return
    path = Path(raw)
    if not path.is_absolute():
        return
    name = event if _NAME.fullmatch(event) else "redacted"
    safe_code = code if code and _NAME.fullmatch(code) else None
    status = http_status if _http_status(http_status) else None
    payload: dict[str, object] = {"t": datetime.now(UTC).isoformat(), "event": name}
    if safe_code:
        payload["code"] = safe_code
    if status is not None:
        payload["httpStatus"] = status
    stage = error_stage if error_stage and _NAME.fullmatch(error_stage) else None
    failure = error_code if error_code and _NAME.fullmatch(error_code) else None
    if stage:
        payload["error_stage"] = stage
    if failure:
        payload["error_code"] = failure
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if _SECRET.search(line):
        line = json.dumps(
            {"t": payload["t"], "event": "redacted"}, ensure_ascii=False, separators=(",", ":")
        )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_APPEND | os.O_CREAT | os.O_WRONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags, 0o600)
        try:
            os.write(descriptor, f"{line}\n".encode())
        finally:
            os.close(descriptor)
    except OSError:
        return
