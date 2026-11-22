"""Actual TTS transport is gated, not narration, cache presence metadata, or image/video."""

import base64
import json
from dataclasses import replace
from uuid import uuid4

import pytest
from aijian_api.story_film import StoryFilmService, StoryShot, story_shot_request
from aijian_api.xai_media import XaiHttpResponse
from test_draft_export_runtime import toolchain
from test_prepared_generation_cache import app_for
from test_prepared_generation_rejections import assert_no_attempt
from test_prepared_generation_routes import ACCOUNT, post
from test_story_film import (
    _allow_live,
    _byte_image,
    _configured_project,
    _request,
    _ScriptedTransport,
)
from test_story_speech_window import clip, pcm


def story(narration="对白。", *, provider="grok_subscription"):
    return _request(
        provider,
        narration="这是非空的整部作品概要，不是镜头旁白。",
        shots=(StoryShot(narration, "真实镜头", 3, "", still=_byte_image(), voice_id="leo"),),
    )


def run_story(repo, project, request, transport, *, deny=True):
    service = StoryFilmService(repo, toolchain, transport=transport)
    service._sleep = lambda _: None
    return service.produce(
        project,
        request,
        media_token="synthetic-account",
        dispatch_account=ACCOUNT,
        deny_new_speech=deny,
    )


def video_transport(video, *, speech=None):
    return _ScriptedTransport(
        [
            *([XaiHttpResponse(200, speech, "audio/wav")] if speech is not None else []),
            XaiHttpResponse(200, b'{"request_id":"speech-regression"}'),
            XaiHttpResponse(
                200, b'{"status":"done","video":{"url":"https://example.test/out.mp4"}}'
            ),
            XaiHttpResponse(200, video, "video/mp4"),
        ]
    )


def posts(transport):
    return [(row.url, json.loads(row.body)) for row in transport.requests if row.method == "POST"]


def test_unsupported_spoken_shot_stops_before_tts_video_or_parent_attempt(tmp_path, monkeypatch):
    repo, project = _configured_project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "tts.log")
    transport = _ScriptedTransport([])
    result = run_story(repo, project, story(), transport)
    assert result.status == "FAILED"
    assert result.user_message["code"] == "SPEECH_MODEL_UNSUPPORTED"
    assert "模型中心选择 Grok TTS" in result.message
    assert transport.requests == []
    assert_no_attempt(repo)


@pytest.mark.parametrize("narration", ["。", " （无台词） "])
def test_unsupported_selection_does_not_block_silent_video(tmp_path, monkeypatch, narration):
    repo, project = _configured_project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "tts.log")
    transport = video_transport(clip(tmp_path / "out.mp4", 3))
    result = run_story(repo, project, story(narration), transport)
    assert result.status == "SUCCEEDED", result.message
    assert [url for url, _ in posts(transport)] == ["https://api.x.ai/v1/videos/generations"]


def test_unsupported_selection_does_not_block_stub(tmp_path):
    repo, project = _configured_project(tmp_path)
    transport = _ScriptedTransport([])
    result = run_story(repo, project, story(provider="stub"), transport)
    assert result.status == "SUCCEEDED", result.message
    assert transport.requests == []
    assert_no_attempt(repo)


def test_reused_partial_voice_and_full_bundle_do_not_attempt_tts(tmp_path, monkeypatch):
    repo, project = _configured_project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "tts.log")
    request = story()
    transport = video_transport(clip(tmp_path / "out.mp4", 3))
    service = StoryFilmService(repo, toolchain)
    child = story_shot_request(request, request.shots[0], 1)
    voice = pcm(1)
    service._store_part(project, child, voice, "-voice.wav")

    first = run_story(repo, project, request, transport)
    assert first.status == "SUCCEEDED", first.message
    assert [url for url, _ in posts(transport)] == ["https://api.x.ai/v1/videos/generations"]

    # A manually supplied frame has no generated key file. Store those same
    # bytes to exercise the full legacy cache in addition to the partial voice.
    service._persist_image(project, child, base64.b64decode(_byte_image().split(",")[1]))
    local = _ScriptedTransport([])
    second = run_story(
        repo,
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        local,
    )
    assert second.status == "SUCCEEDED", second.message
    assert "已用上次" in second.message
    assert local.requests == []


def test_legacy_or_supported_selection_retains_exact_tts_payload(tmp_path, monkeypatch):
    repo, project = _configured_project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "tts.log")
    transport = video_transport(clip(tmp_path / "out.mp4", 3), speech=pcm(1))
    result = run_story(repo, project, story(), transport, deny=False)
    assert result.status == "SUCCEEDED", result.message
    assert posts(transport)[0] == (
        "https://api.x.ai/v1/tts",
        {
            "text": "对白。",
            "voice_id": "leo",
            "language": "zh",
            "output_format": {"codec": "mp3", "sample_rate": 24000, "bit_rate": 128000},
        },
    )


def test_legacy_sidecar_header_must_be_exact_and_in_the_account_attestation(tmp_path, monkeypatch):
    repo, project = _configured_project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "tts.log")
    transport = _ScriptedTransport([])

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, tools, transport=transport)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    body = {
        "scene_label": "真实镜头",
        "narration": "对白。",
        "provider": "grok_subscription",
        "shots": [
            {
                "narration": "对白。",
                "prompt": "真实镜头",
                "duration_seconds": 3,
                "still": _byte_image(),
            }
        ],
    }
    with app_for(repo) as client:
        for flag in ["0", "1"]:
            reply = post(
                client,
                project,
                "story-film",
                body,
                extra_headers={"X-Aivora-Deny-New-Speech": flag},
            )
            assert reply.status_code == 403
        blocked = post(client, project, "story-film", body, deny_new_speech=True)
        assert blocked.status_code == 200, blocked.text
        assert blocked.json()["data"]["user_message"]["code"] == "SPEECH_MODEL_UNSUPPORTED"
    assert transport.requests == []
    assert_no_attempt(repo)
