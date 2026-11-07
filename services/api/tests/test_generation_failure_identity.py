"""Invalid mutable or malformed evidence never acquires video identity authority."""

import base64
import hashlib
import hmac
import json

import pytest
from aijian_api.generation_dispatch_identity import account_attestation, video_input_identity


@pytest.mark.parametrize(
    "case", ["expired", "future", "bool-expiry", "extra-field", "wrong-signature", "bad-account"]
)
def test_main_assertion_rejects_invalid_time_shape_or_identity(monkeypatch, case):
    monkeypatch.setattr("aijian_api.generation_dispatch_identity.time.time", lambda: 1000)
    key, bearer, body = "private-session-key", "private-token", b'{"exact":true}'
    value = {"account": "a" * 64, "expires": 1060}
    if case == "expired":
        value["expires"] = 999
    if case == "future":
        value["expires"] = 1121
    if case == "bool-expiry":
        value["expires"] = True
    if case == "bad-account":
        value["account"] = "not-a-digest"
    message = "\n".join(
        (
            "aivora-video-account-v1",
            "project",
            "attempt",
            hashlib.sha256(body).hexdigest(),
            hashlib.sha256(bearer.encode()).hexdigest(),
            value["account"],
            str(value["expires"]),
        )
    )
    value["signature"] = hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()
    if case == "wrong-signature":
        value["signature"] = "f" * 64
    if case == "extra-field":
        value["private"] = "must-not-be-returned"
    encoded = base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    assert (
        account_attestation(
            encoded,
            key=key,
            project_id="project",
            idempotency_key="attempt",
            body=body,
            bearer=bearer,
        )
        is None
    )


@pytest.mark.parametrize(
    "image",
    [
        None,
        {"url": "https://example.invalid/changeable.png"},
        {"url": "data:image/png;base64,"},
        {"url": "data:image/png;base64,???"},
        {"url": "data:image/svg+xml;base64,aGVsbG8="},
        {"url": "data:image/png;base64,aGVsbG8=", "sha256": "invented"},
    ],
)
def test_reference_bytes_are_mandatory_not_arbitrary_metadata(image):
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        video_input_identity("a" * 64, json.dumps({"image": image}).encode())
