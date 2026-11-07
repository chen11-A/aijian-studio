"""Signed actual sidecar routes and StoryFilm consumer; transport is synthetic only."""

import base64
import hashlib
import hmac
import json
import time
from uuid import uuid4

from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from aijian_api.story_film import StoryFilmService
from fastapi.testclient import TestClient
from test_draft_export_runtime import toolchain
from test_story_creation_failure_budget import LostResponse
from test_story_film import HOST, TOKEN, _allow_live, _byte_image, _project

ACCOUNT = "a" * 64
BEARER = "synthetic-current-account-bearer"


def post(client, project, suffix, value, *, arm=None):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    key = f"story-film:v1:{uuid4()}"
    expires = int(time.time()) + 60
    message = "\n".join(
        (
            "aivora-video-account-v2" if arm else "aivora-video-account-v1",
            project,
            key,
            hashlib.sha256(raw).hexdigest(),
            hashlib.sha256(BEARER.encode()).hexdigest(),
            ACCOUNT,
            str(expires),
            *((arm,) if arm else ()),
        )
    )
    signed = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "account": ACCOUNT,
                    "expires": expires,
                    "signature": hmac.new(
                        TOKEN.encode(), message.encode(), hashlib.sha256
                    ).hexdigest(),
                }
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    return client.post(
        f"/api/v1/projects/{project}/{suffix}",
        content=raw,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Origin": "app://aijian",
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            "X-Aivora-Media-Bearer": BEARER,
            "X-Aivora-Generation-Account": signed,
            **({"X-Aivora-Prepared-Generation": arm} if arm else {}),
        },
    )


def test_signed_register_image_fact_arm_and_actual_create_use_one_parent_and_no_extra_post(
    tmp_path,
    monkeypatch,
):
    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=10)
    parent = GenerationFailureStore(repo, scope="story_creation")
    parent.configure(project, expected_revision=0, failure_limit=1)
    _allow_live(monkeypatch, tmp_path / "status.log")
    frame = tmp_path / "owned.png"
    data = base64.b64decode(_byte_image("signed").split(",", 1)[1])
    frame.write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    body = {
        "scene_label": "固定输入",
        "narration": "你好。",
        "subtitle": None,
        "provider": "grok_subscription",
        "confirmed": False,
        "shots": [
            {
                "narration": "你好。",
                "prompt": "固定画面",
                "duration_seconds": 3,
                "still": str(frame),
            }
        ],
    }
    registration = {
        "key": "native-session",
        "targets": [
            {
                "key": "target",
                "versions": 1,
                "first_regenerate": False,
                "body": body,
                "sources": [{"source": str(frame), "sha256": sha}],
            }
        ],
        "stages": [
            {
                "key": "unused-portrait",
                "kind": "portrait",
                "target_id": "unused",
                "view": "正面",
                "origin": {"references": []},
                "target_keys": ["target"],
            }
        ],
    }
    transport = LostResponse()

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=transport)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    app = create_app(repository=repo, sidecar_security=SidecarSecurity(TOKEN, HOST))
    prefix = "prepared-generation-executions"
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 12345)) as client:
        unsigned = client.post(f"/api/v1/projects/{project}/{prefix}", json=registration)
        assert unsigned.status_code == 401
        registered = post(client, project, prefix, registration)
        assert registered.status_code == 200, registered.text
        execution = registered.json()["execution_id"]
        fact = {"stage_key": "unused-portrait", "body_sha256": "b" * 64}
        reserved = post(client, project, f"{prefix}/{execution}/image-dispatch", fact)
        assert reserved.json() == {"kind": "RECORDED"}
        observed = post(
            client,
            project,
            f"{prefix}/{execution}/image-observation",
            {**fact, "output_sha256": sha},
        )
        assert observed.json() == {"kind": "RECORDED"}
        lineage = post(client, project, f"{prefix}/lineages", {"output_sha256s": [sha]})
        assert lineage.status_code == 200 and len(lineage.json()["items"]) == 1
        wire = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        armed = post(
            client,
            project,
            f"{prefix}/{execution}/video-arm",
            {
                "target_key": "target",
                "slot_index": 0,
                "take_key": "actual-queued-take",
                "wire_body": wire,
                "body_sha256": hashlib.sha256(wire.encode()).hexdigest(),
                "sources": [
                    {
                        "role": "still",
                        "index": 0,
                        "source": str(frame),
                        "canonical_path": str(frame.resolve()),
                        "sha256": sha,
                        "mime": "image/png",
                    }
                ],
            },
        )
        assert armed.status_code == 200, armed.text
        result = post(client, project, "story-film", body, arm=armed.json()["arm_id"])
        assert result.status_code == 200, result.text
        assert result.json()["data"]["status"] == "FAILED"
        assert len(transport.requests) == 1, result.json()["data"].get("user_message")
        assert transport.requests[0].url.endswith("/tts")
        parent.configure(project, expected_revision=1, failure_limit=1000)
        registration["key"] = "different-execution-same-original-input"
        again = post(client, project, prefix, registration)
        assert again.status_code == 200
        refused = post(
            client, project, f"{prefix}/{again.json()['execution_id']}/image-dispatch", fact
        )
        assert refused.status_code == 409 and refused.json()["detail"] == "ATTEMPT_ALREADY_RESERVED"
        retired = post(
            client,
            project,
            f"{prefix}/{execution}/retire",
            {"target_key": None, "slot_index": None},
        )
        assert retired.json() == {"kind": "RECORDED"}
    assert len(transport.requests) == 1
    assert frame.read_bytes() == data
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchall()[0][0]
            == "UNKNOWN"
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 1
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )
