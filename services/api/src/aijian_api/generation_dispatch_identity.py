"""Main-owned account attestations and exact, byte-backed video input identity.

This is an additional sidecar-local assertion, not provider authorization. The
signing key is the existing private main/sidecar session key, never renderer data.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time

_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


def account_attestation(
    encoded: str | None,
    *,
    key: str | None,
    project_id: str,
    idempotency_key: str,
    body: bytes,
    bearer: str | None,
) -> str | None:
    if not encoded or not key or not bearer or len(encoded) > 2048:
        return None
    try:
        value = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if not isinstance(value, dict) or set(value) != {"account", "expires", "signature"}:
            return None
        account, expires, signature = value["account"], value["expires"], value["signature"]
        if not isinstance(account, str) or not _DIGEST.fullmatch(account):
            return None
        if type(expires) is not int or not time.time() <= expires <= time.time() + 120:
            return None
        if not isinstance(signature, str) or not _DIGEST.fullmatch(signature):
            return None
        message = "\n".join(
            (
                "aivora-video-account-v1",
                project_id,
                idempotency_key,
                hashlib.sha256(body).hexdigest(),
                hashlib.sha256(bearer.encode()).hexdigest(),
                account,
                str(expires),
            )
        )
        expected = hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()
        return account if hmac.compare_digest(expected, signature) else None
    except (ValueError, TypeError, UnicodeError):
        return None


def video_input_identity(account: str, body: bytes) -> str:
    """Hash actual POST semantics; mutable remote references are not proof of bytes."""
    if not _DIGEST.fullmatch(account):
        raise ValueError("ACCOUNT_UNVERIFIABLE")
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeError) as error:
        raise ValueError("INPUT_UNVERIFIABLE") from error
    if not isinstance(payload, dict):
        raise ValueError("INPUT_UNVERIFIABLE")
    for field in ("image", "last_frame"):
        if field in payload:
            payload[field] = _image_identity(payload[field])
    if "reference_images" in payload:
        references = payload["reference_images"]
        if not isinstance(references, list) or len(references) > 13:
            raise ValueError("INPUT_UNVERIFIABLE")
        payload["reference_images"] = [_image_identity(row) for row in references]
    identity = {"version": 1, "account": account, "video": payload}
    return hashlib.sha256(
        json.dumps(
            identity,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _image_identity(value: object) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"url"}:
        raise ValueError("INPUT_UNVERIFIABLE")
    url = value["url"]
    if not isinstance(url, str) or not url.startswith("data:image/") or ";base64," not in url:
        raise ValueError("INPUT_UNVERIFIABLE")
    prefix, encoded = url.split(";base64,", 1)
    if prefix not in {"data:image/png", "data:image/jpeg", "data:image/webp"}:
        raise ValueError("INPUT_UNVERIFIABLE")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise ValueError("INPUT_UNVERIFIABLE") from error
    if not raw:
        raise ValueError("INPUT_UNVERIFIABLE")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "mime": prefix[5:]}


def story_creation_input_identity(account: str, targets: list[dict[str, object]]) -> str:
    """Hash the ordered original generation recipe, never generated image results.

    The caller builds effective prompts/voices with the production pure producers.
    Image references are replaced by their actual bytes, not mutable URLs.
    """
    if not _DIGEST.fullmatch(account):
        raise ValueError("ACCOUNT_UNVERIFIABLE")
    if not targets or len(targets) > 256:
        raise ValueError("INPUT_UNVERIFIABLE")
    return hashlib.sha256(
        json.dumps(
            {"schema": "story-creation-v1", "account": account, "targets": targets},
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()


def story_reference_identity(source: str) -> dict[str, str]:
    return _image_identity({"url": source})
