"""Actual protocol POST/GET consumers with SQLite and local FFmpeg only."""

import base64
import hashlib
import hmac
import json
import time
from dataclasses import replace
from uuid import uuid4

import pytest
from aijian_api.generation_dispatch_identity import account_attestation, video_input_identity
from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.story_film import StoryFilmService
from aijian_api.xai_media import XaiHttpResponse
from test_draft_export_runtime import toolchain
from test_story_film import (
    _IMAGE,
    _allow_live,
    _media_bytes,
    _project,
    _request,
    _ScriptedTransport,
)

ACCOUNT = "a" * 64


def scripted(clip, voice):
    return _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, voice, "audio/wav"),
            XaiHttpResponse(200, b'{"request_id":"accepted"}'),
            XaiHttpResponse(200, b'{"status":"done","video":{"url":"https://vidgen.x.ai/v.mp4"}}'),
            XaiHttpResponse(200, clip, "video/mp4"),
        ]
    )


def test_unconfigured_and_unverified_account_precede_all_new_media(tmp_path, monkeypatch):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transport = _ScriptedTransport([])
    service = StoryFilmService(repository, toolchain, transport=transport)
    result = service.produce(
        project, _request("grok_subscription"), media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert result.user_message["code"] == "VIDEO_FAILURE_UNCONFIGURED"
    assert not transport.requests
    GenerationFailureStore(repository).configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repository, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=10,
    )
    result = service.produce(
        project,
        replace(_request("grok_subscription"), idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="synthetic",
    )
    assert result.user_message["code"] == "VIDEO_FAILURE_ACCOUNT_UNVERIFIABLE"
    assert not transport.requests


def test_real_post_and_get_success_then_cache_need_no_new_allowance(tmp_path, monkeypatch):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, voice = _media_bytes(tmp_path)
    transport = scripted(clip, voice)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repository, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=10,
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    request = _request("grok_subscription")
    result = service.produce(project, request, media_token="synthetic", dispatch_account=ACCOUNT)
    assert result.status == "SUCCEEDED", result.message
    assert (
        sum(
            row.method == "POST" and row.url.endswith("/videos/generations")
            for row in transport.requests
        )
        == 1
    )
    assert sum(row.method == "GET" and "/videos/" in row.url for row in transport.requests) == 1
    # Even a newly configured zero limit and unavailable account cannot bill a cache reuse.
    store.configure(project, expected_revision=1, failure_limit=0)
    before = len(transport.requests)
    cached = service.produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="synthetic",
    )
    assert cached.status == "SUCCEEDED", cached.message
    assert len(transport.requests) == before


def test_identity_binds_bytes_and_actual_video_parameters_not_task_key():
    body = {
        "model": "model",
        "prompt": "same",
        "duration": 3,
        "image": {"url": "data:image/png;base64," + base64.b64encode(b"first-frame").decode()},
    }
    original = video_input_identity(ACCOUNT, json.dumps(body).encode())
    assert original == video_input_identity(ACCOUNT, json.dumps(body, sort_keys=True).encode())
    for key, value in [("duration", 4), ("model", "other"), ("prompt", "changed")]:
        assert original != video_input_identity(ACCOUNT, json.dumps({**body, key: value}).encode())
    assert original != video_input_identity("b" * 64, json.dumps(body).encode())
    # New generated first-frame bytes genuinely change the video-only bucket;
    # this guard does not claim to cap a whole unchanged image/TTS/video workflow.
    body["image"] = {"url": "data:image/png;base64," + base64.b64encode(b"new-frame").decode()}
    assert original != video_input_identity(ACCOUNT, json.dumps(body).encode())
    body["image"] = {"url": "https://cdn.example/frame.png"}
    with pytest.raises(ValueError, match="INPUT_UNVERIFIABLE"):
        video_input_identity(ACCOUNT, json.dumps(body).encode())


def test_attestation_is_bound_to_raw_body_token_project_key_and_expiry():
    key, bearer, project, attempt, body = "s" * 43, "same-token", "project", "attempt", b'{"x":1}'
    expires = int(time.time()) + 60
    message = "\n".join(
        (
            "aivora-video-account-v1",
            project,
            attempt,
            hashlib.sha256(body).hexdigest(),
            hashlib.sha256(bearer.encode()).hexdigest(),
            ACCOUNT,
            str(expires),
        )
    )
    signature = hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()
    encoded = (
        base64.urlsafe_b64encode(
            json.dumps({"account": ACCOUNT, "expires": expires, "signature": signature}).encode()
        )
        .decode()
        .rstrip("=")
    )
    args = dict(key=key, project_id=project, idempotency_key=attempt, body=body, bearer=bearer)
    assert account_attestation(encoded, **args) == ACCOUNT
    for field, value in [
        ("key", "other"),
        ("project_id", "other"),
        ("idempotency_key", "other"),
        ("body", b'{"x": 1}'),
        ("bearer", "refreshed-token"),
    ]:
        assert account_attestation(encoded, **{**args, field: value}) is None
    assert account_attestation(encoded + "secret", **args) is None


def test_submitted_unknown_survives_new_key_and_restart_without_another_video_post(
    tmp_path, monkeypatch
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    _clip, voice = _media_bytes(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repository, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=10,
    )
    # POST is entered but no response is available: an actual uncertain dispatch,
    # not a local validation failure or a GET poll counted as another generation.
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, voice, "audio/wav"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    request = _request("grok_subscription")
    service.produce(project, request, media_token="synthetic", dispatch_account=ACCOUNT)
    posts = [row for row in transport.requests if row.url.endswith("/videos/generations")]
    assert len(posts) == 1
    restarted = StoryFilmService(repository, toolchain, transport=transport)
    result = restarted.produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="refreshed-synthetic",
        dispatch_account=ACCOUNT,
    )
    assert result.user_message["code"] == "VIDEO_FAILURE_INPUT_FAILURE_LIMIT"
    assert len([row for row in transport.requests if row.url.endswith("/videos/generations")]) == 1
    # Raising then lowering the config revision never erases the unresolved row.
    store.configure(project, expected_revision=1, failure_limit=2)
    store.configure(project, expected_revision=2, failure_limit=1)
    result = restarted.produce(
        project,
        replace(
            request,
            idempotency_key=f"story-film:v1:{uuid4()}",
            connection_revision="new-connection-revision",
        ),
        media_token="synthetic",
        dispatch_account=ACCOUNT,
    )
    assert result.user_message["code"] == "VIDEO_FAILURE_INPUT_FAILURE_LIMIT"


def test_two_identical_video_inputs_in_one_film_release_each_known_success(tmp_path, monkeypatch):
    from aijian_api.story_film import StoryShot
    from test_story_film import _byte_image

    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, voice = _media_bytes(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repository, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=1,
    )
    # Distinct target indices, identical actual video bodies; raw voice can be reused.
    responses = [XaiHttpResponse(200, voice, "audio/wav")]
    for _ in range(2):
        responses += [
            XaiHttpResponse(200, b'{"request_id":"accepted"}'),
            XaiHttpResponse(200, b'{"status":"done","video":{"url":"https://vidgen.x.ai/v.mp4"}}'),
            XaiHttpResponse(200, clip, "video/mp4"),
        ]
    transport = _ScriptedTransport(responses)
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    shot = StoryShot("一样。", "同画面", 3, "", still=_byte_image("same"))
    request = _request("grok_subscription", shots=(shot, shot))
    result = service.produce(project, request, media_token="synthetic", dispatch_account=ACCOUNT)
    posts = [row for row in transport.requests if row.url.endswith("/videos/generations")]
    assert len(posts) == 2, result.message
    assert posts[0].body == posts[1].body
    assert result.status == "SUCCEEDED", result.message
    with repository._connection() as connection:
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchall()[0][0]
            == "SUCCEEDED"
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 1
        )


def test_known_video_success_is_not_reclassified_by_local_export_failure(tmp_path, monkeypatch):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, voice = _media_bytes(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repository, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=10,
    )
    transport = scripted(clip, voice)
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None

    def fail_local(*args, **kwargs):
        raise OSError("controlled local postprocessing failure")

    monkeypatch.setattr(service, "_assemble_and_export", fail_local)
    result = service.produce(
        project, _request("grok_subscription"), media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert result.status == "FAILED"
    posted = next(row for row in transport.requests if row.url.endswith("/videos/generations"))
    digest = video_input_identity(
        ACCOUNT,
        posted.body,
    )
    # A new actual attempt is admissible under limit1: provider success was proven
    # before the unrelated local export failed; no extra POST is issued by this assertion.
    with repository._connection() as connection:
        row = connection.execute(
            "SELECT input_sha256,status FROM generation_failure_attempt"
        ).fetchone()
        assert row["input_sha256"] == digest
        assert row["status"] == "SUCCEEDED"
    assert store.reserve(project, input_sha256=digest, attempt_key="explicit-next-attempt")
    assert len([row for row in transport.requests if row.url.endswith("/videos/generations")]) == 1


@pytest.mark.parametrize("remote_kind", ["prepared", "reference"])
def test_known_unverifiable_reference_blocks_before_any_new_image_or_tts(
    tmp_path, monkeypatch, remote_kind
):
    from aijian_api.story_film import StoryShot
    from test_story_film import _byte_image

    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    GenerationFailureStore(repository).configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repository, scope="story_creation").configure(
        project,
        expected_revision=0,
        failure_limit=10,
    )
    transport = _ScriptedTransport([])
    service = StoryFilmService(repository, toolchain, transport=transport)
    shot = StoryShot(
        "一句。",
        "画面",
        3,
        "",
        still="https://cdn.example/unknown.png"
        if remote_kind == "prepared"
        else _byte_image("known"),
        references=("https://cdn.example/unknown-ref.png",) if remote_kind == "reference" else (),
    )
    result = service.produce(
        project,
        _request("grok_subscription", shots=(shot,)),
        media_token="synthetic",
        dispatch_account=ACCOUNT,
    )
    assert result.user_message["code"] == "VIDEO_FAILURE_INPUT_UNVERIFIABLE"
    assert transport.requests == []
