"""Real local HTTP account/body attestation around GET-only recovery consumers."""

import base64
import hashlib
import hmac
import json
import time
from uuid import uuid4

from aijian_api.video_recovery_routes import create_video_recovery_router
from fastapi import FastAPI
from fastapi.testclient import TestClient
from recovery_read_diagnostics import (
    recovery_read_identity_observer as recovery_read_identity_observer,
)
from test_draft_export_runtime import toolchain
from test_video_recovery import ACCOUNT, Transport, setup
from test_video_recovery import media as media

KEY = "synthetic-session-key"
BEARER = "synthetic-account-token"


def headers(project, account=ACCOUNT, body=b"", key=KEY, bearer=BEARER):
    identifier = f"story-film:v1:{uuid4()}"
    expires = int(time.time()) + 60
    message = "\n".join(
        (
            "aivora-video-account-v1",
            project,
            identifier,
            hashlib.sha256(body).hexdigest(),
            hashlib.sha256(bearer.encode()).hexdigest(),
            account,
            str(expires),
        )
    )
    encoded = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "account": account,
                    "expires": expires,
                    "signature": hmac.new(
                        key.encode(), message.encode(), hashlib.sha256
                    ).hexdigest(),
                }
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    return {
        "Idempotency-Key": identifier,
        "X-Aivora-Generation-Account": encoded,
        "X-Aivora-Media-Bearer": bearer,
    }


def test_signed_actual_route_list_recover_then_explicit_read_preserves_bytes(tmp_path, media):
    repo, project, reservation = setup(tmp_path)
    original_sha = hashlib.sha256((tmp_path / "original.mp4").read_bytes()).hexdigest()
    transport = Transport(media)
    app = FastAPI()
    app.include_router(
        create_video_recovery_router(lambda: repo, toolchain, KEY, lambda: transport)
    )
    client = TestClient(app)
    url = f"/api/v1/projects/{project}/generation-video-recoveries"
    listing = client.get(url, headers=headers(project))
    assert listing.status_code == 200
    assert listing.json()["items"] == [{"attemptId": reservation.attempt_id, "state": "UNKNOWN"}]
    recovered = client.post(url + "/" + reservation.attempt_id, headers=headers(project))
    assert recovered.status_code == 200 and recovered.json()["kind"] == "RECOVERED"
    output = client.get(url + "/" + reservation.attempt_id + "/file", headers=headers(project))
    assert output.status_code == 200 and output.content == media
    assert transport.calls[0].headers["Authorization"] == f"Bearer {BEARER}"
    assert all(call.method == "GET" for call in transport.calls)
    public = listing.text + recovered.text
    assert not any(
        secret in public
        for secret in ["provider-id", ACCOUNT, KEY, BEARER, str(tmp_path), "b" * 64]
    )
    assert hashlib.sha256((tmp_path / "original.mp4").read_bytes()).hexdigest() == original_sha
    assert (
        client.get(url + "/" + reservation.attempt_id, headers=headers(project)).json()
        == recovered.json()
    )


def test_unsigned_or_changed_body_account_and_project_never_reach_provider(tmp_path):
    repo, project, reservation = setup(tmp_path)
    transport = Transport(b"")
    app = FastAPI()
    app.include_router(
        create_video_recovery_router(lambda: repo, toolchain, KEY, lambda: transport)
    )
    client = TestClient(app)
    url = f"/api/v1/projects/{project}/generation-video-recoveries/{reservation.attempt_id}"
    for signed in [headers(project, key="different-key"), headers(project, body=b"different"), {}]:
        assert client.post(url, headers=signed).status_code in {403, 422}
    wrong = client.post(url, headers=headers(project, account="c" * 64))
    assert wrong.json() == {"kind": "FAILED", "code": "NOT_FOUND"}
    assert client.get(url + "/file", headers=headers(project, account="c" * 64)).status_code == 404
    assert transport.calls == []
