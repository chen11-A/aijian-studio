"""Authenticated sidecar configuration and exact main/body account assertions."""

import base64
import hashlib
import hmac
import json
import time
from uuid import uuid4

import pytest
from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from aijian_api.story_film import StoryFilmService
from fastapi.testclient import TestClient
from test_story_film import HOST, TOKEN, _project


def assertion(project, attempt, body, bearer):
    expires = int(time.time()) + 60
    account = "a" * 64
    message = "\n".join(
        (
            "aivora-video-account-v1",
            project,
            attempt,
            hashlib.sha256(body).hexdigest(),
            hashlib.sha256(bearer.encode()).hexdigest(),
            account,
            str(expires),
        )
    )
    signature = hmac.new(TOKEN.encode(), message.encode(), hashlib.sha256).hexdigest()
    return (
        base64.urlsafe_b64encode(
            json.dumps({"account": account, "expires": expires, "signature": signature}).encode()
        )
        .decode()
        .rstrip("=")
    )


def test_explicit_configuration_is_authenticated_closed_and_revisioned_without_reset(tmp_path):
    repository, project = _project(tmp_path)
    app = create_app(repository=repository, sidecar_security=SidecarSecurity(TOKEN, HOST))
    headers = {"Authorization": f"Bearer {TOKEN}", "Origin": "app://aijian"}
    endpoint = f"/api/v1/projects/{project}/generation-failure-policy"
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 12345)) as client:
        assert client.get(endpoint).status_code == 401
        assert client.get(endpoint, headers=headers).json() == {
            "state": "UNCONFIGURED",
            "revision": 0,
            "failure_limit": None,
            "scope": "GROK_VIDEO_SUBMIT_FAILURES",
        }
        for body in [
            {"expected_revision": 0, "failure_limit": True},
            {"expected_revision": 0, "failure_limit": 1, "account": "forged"},
            {"expected_revision": 0, "failure_limit": -1},
        ]:
            assert client.put(endpoint, json=body, headers=headers).status_code == 422
        response = client.put(
            endpoint, json={"expected_revision": 0, "failure_limit": 2}, headers=headers
        )
        assert response.status_code == 200
        assert response.json()["revision"] == 1
        assert (
            client.put(
                endpoint, json={"expected_revision": 0, "failure_limit": 3}, headers=headers
            ).status_code
            == 409
        )
        assert client.get(endpoint, headers=headers).json()["failure_limit"] == 2
        for revision, limit in [(1, 1000), (2, 0)]:
            saved = client.put(
                endpoint,
                json={"expected_revision": revision, "failure_limit": limit},
                headers=headers,
            )
            assert saved.status_code == 200
            assert saved.json()["failure_limit"] == limit
            assert saved.json()["revision"] == revision + 1


@pytest.mark.parametrize("change", ["none", "body", "bearer", "attempt", "unsigned"])
def test_api_accepts_only_attestation_for_this_actual_request(tmp_path, monkeypatch, change):
    repository, project = _project(tmp_path)
    app = create_app(repository=repository, sidecar_security=SidecarSecurity(TOKEN, HOST))
    body = b'{"scene_label":"scene","narration":"line","provider":"grok_subscription"}'
    bearer = "synthetic-private-bearer"
    attempt = f"story-film:v1:{uuid4()}"
    signed = assertion(project, attempt, body, bearer)
    if change == "body":
        body = body.replace(b"line", b"changed")
    if change == "bearer":
        bearer += "-changed"
    if change == "attempt":
        attempt = f"story-film:v1:{uuid4()}"
    captured = []
    original = StoryFilmService.produce

    def produce(self, project_id, request, **kwargs):
        captured.append(kwargs.get("dispatch_account"))
        # Stop at the existing live-disabled gate: no tool or provider is invoked.
        return original(self, project_id, request, **kwargs)

    monkeypatch.delenv("AIJIAN_ALLOW_LIVE_MEDIA", raising=False)
    monkeypatch.setattr(StoryFilmService, "produce", produce)
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": "app://aijian",
        "Content-Type": "application/json",
        "Idempotency-Key": attempt,
        "X-Aivora-Media-Bearer": bearer,
    }
    if change != "unsigned":
        headers["X-Aivora-Generation-Account"] = signed
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 12345)) as client:
        response = client.post(
            f"/api/v1/projects/{project}/story-film", content=body, headers=headers
        )
    assert response.status_code == 200, response.text
    assert captured == ["a" * 64 if change == "none" else None]
    assert bearer not in response.text
    assert signed not in response.text


def test_authenticated_sidecar_cannot_invent_account_without_main_attestation(
    tmp_path, monkeypatch
):
    from aijian_api.generation_failure_store import GenerationFailureStore
    from test_story_film import _allow_live

    repository, project = _project(tmp_path)
    GenerationFailureStore(repository).configure(project, expected_revision=0, failure_limit=1)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transports = []

    def forbidden_transport():
        transports.append(True)
        raise AssertionError("provider must not be created")

    monkeypatch.setattr("aijian_api.xai_media_transport.urllib_xai_transport", forbidden_transport)
    app = create_app(repository=repository, sidecar_security=SidecarSecurity(TOKEN, HOST))
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 12345)) as client:
        response = client.post(
            f"/api/v1/projects/{project}/story-film",
            json={
                "scene_label": "same",
                "narration": "line",
                "provider": "grok_subscription",
            },
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Origin": "app://aijian",
                "Idempotency-Key": f"story-film:v1:{uuid4()}",
                "X-Aivora-Media-Bearer": "synthetic-private-token",
                "X-Aivora-Generation-Account": "a" * 64,
            },
        )
    assert response.status_code == 200
    assert response.json()["data"]["user_message"]["code"] == "VIDEO_FAILURE_ACCOUNT_UNVERIFIABLE"
    assert transports == []
