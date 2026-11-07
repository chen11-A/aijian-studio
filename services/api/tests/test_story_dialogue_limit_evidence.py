"""Verified target-bound facts and actual API serialization; synthetic/local data only."""

import hashlib
import json
from dataclasses import asdict, replace
from uuid import uuid4

import pytest
from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from aijian_api.story_dialogue_limit import dialogue_request_sha256
from aijian_api.story_film import (
    StoryDialogue,
    StoryFilmError,
    StoryFilmService,
    _check_speech_window,
    _failed,
)
from aijian_api.story_film_routes import _data
from aijian_api.user_messages import user_message
from fastapi.testclient import TestClient
from test_story_film import HOST, TOKEN, _project, _request
from test_story_speech_window import pcm


def evidence(tmp_path, *, index=None, saved=True):
    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, lambda: pytest.fail("No tool execution expected"))
    request = replace(
        _request(provider="grok_subscription"),
        narration="甲：一整句。\n乙：第二句😀。",
        delivery="轻声",
        dialogue_lines=(
            StoryDialogue("甲", "一整句。", "eve"),
            StoryDialogue("乙", "第二句😀。", "leo"),
        ),
        shot_index=index,
    )
    raw = pcm(1)
    if saved:
        service._store_part(project_id, request, raw, "-voice.wav")
    with pytest.raises(StoryFilmError) as caught:
        service._check_before_target_video(request, project_id, raw, 16.25, 15)
    assert caught.value.code == "DIALOGUE_VIDEO_LIMIT"
    limit = caught.value.dialogue_limit
    assert limit is not None
    return project_id, request, raw, limit


@pytest.mark.parametrize("index", [None, 1, 2])
def test_pre_target_video_limit_binds_actual_request_and_raw_bytes_without_claiming_batch_zero(
    tmp_path, index
):
    _, request, raw, limit = evidence(tmp_path, index=index)
    assert limit.shot_index == index
    assert limit.raw_audio_saved is True
    assert limit.raw_audio_sha256 == hashlib.sha256(raw).hexdigest()
    assert limit.target_video_submitted is False
    expected = [
        request.video_model,
        request.voice_id,
        request.delivery,
        request.narration,
        [[line.speaker, line.text, line.voice_id] for line in request.dialogue_lines],
        request.speech_model,
    ]
    assert (
        limit.request_sha256
        == hashlib.sha256(
            json.dumps(expected, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()
    )
    assert "batch_video_submitted" not in asdict(limit)
    assert "path" not in asdict(limit)
    for changed in [
        replace(request, narration="不同台词"),
        replace(request, voice_id="rex"),
        replace(request, delivery="大声"),
        replace(request, video_model="grok-imagine-video-1.5-lite"),
        replace(request, speech_model="other-tts"),
    ]:
        assert (
            dialogue_request_sha256(
                changed.video_model,
                changed.voice_id,
                changed.delivery,
                changed.narration,
                tuple((row.speaker, row.text, row.voice_id) for row in changed.dialogue_lines),
                speech_model=changed.speech_model,
            )
            != limit.request_sha256
        )


def test_missing_or_different_cache_cannot_be_reported_as_saved_raw(tmp_path):
    _, _, _, limit = evidence(tmp_path, saved=False)
    assert limit.raw_audio_saved is False
    assert limit.raw_audio_sha256 is None


def test_post_video_generic_limit_has_no_pre_dispatch_or_raw_saved_flags():
    with pytest.raises(StoryFilmError) as caught:
        _check_speech_window(16.25, 15, 2)
    assert caught.value.dialogue_limit is None
    result = replace(
        _failed("限制", "本地", "不花钱", None, None),
        user_message=user_message("DIALOGUE_VIDEO_LIMIT", "限制"),
    )
    assert _data(result).dialogue_limit is None


def test_real_route_serializes_structured_facts_without_requiring_message_parsing(
    tmp_path, monkeypatch
):
    repository, project_id = _project(tmp_path)
    _, _, _, limit = evidence(tmp_path / "evidence", index=2)
    result = replace(
        _failed("限制", "本地替身", "不花钱", None, None),
        dialogue_limit=limit,
        user_message=user_message("DIALOGUE_VIDEO_LIMIT", "请拆分对白。", "仅给人阅读的说明"),
    )
    calls = []

    def produce(self, actual_project, request, *args, **kwargs):
        calls.append((actual_project, len(request.shots)))
        return result

    monkeypatch.setattr(StoryFilmService, "produce", produce)
    app = create_app(
        repository=repository, sidecar_security=SidecarSecurity(token=TOKEN, host=HOST)
    )
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 1234)) as client:
        response = client.post(
            f"/api/v1/projects/{project_id}/story-film",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Origin": "app://aijian",
                "Idempotency-Key": f"story-film:v1:{uuid4()}",
            },
            json={
                "scene_label": "测试",
                "narration": "完整台词。",
                "provider": "stub",
                "confirmed": True,
            },
        )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user_message"]["code"] == "DIALOGUE_VIDEO_LIMIT"
    assert data["dialogue_limit"] == asdict(limit)
    assert data["dialogue_limit"]["shot_index"] == 2
    assert calls == [(project_id, 0)]


def test_produce_keeps_typed_facts_from_real_prevideo_audio_check_and_same_key_does_not_call_again(
    tmp_path, monkeypatch
):
    from aijian_api.xai_media import XaiHttpResponse
    from test_draft_export_runtime import toolchain
    from test_story_film import _PNG, _allow_live, _ScriptedTransport

    repository, project_id = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    raw = pcm(15.2)
    transport = _ScriptedTransport([XaiHttpResponse(200, raw, "audio/wav")])
    service = StoryFilmService(repository, toolchain, transport=transport)
    request = _request(provider="grok_subscription", confirmed=True)
    service._persist_image(project_id, request, _PNG)
    result = service.produce(project_id, request, media_token="synthetic")
    assert result.status == "FAILED"
    assert result.user_message["code"] == "DIALOGUE_VIDEO_LIMIT"
    assert result.dialogue_limit is not None
    assert result.dialogue_limit.raw_audio_saved is True
    assert result.dialogue_limit.target_video_submitted is False
    assert result.dialogue_limit.required_seconds == pytest.approx(16.2)
    assert _data(result).dialogue_limit.model_dump() == asdict(result.dialogue_limit)
    assert len(transport.requests) == 1
    replay = service.produce(project_id, request, media_token="synthetic")
    assert replay.status == "BLOCKED"
    assert len(transport.requests) == 1


def test_actual_shot_list_uses_failed_child_index_and_does_not_call_earlier_video_a_batch_zero(
    tmp_path, monkeypatch
):
    from aijian_api.story_film import StoryShot
    from test_draft_export_runtime import toolchain
    from test_story_film import _PNG
    from test_story_speech_window import clip

    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    first_video = clip(tmp_path / "first.mp4", 3)
    raw = pcm(16)
    video_targets = []
    children = []

    def live(child, *_args, **_kwargs):
        children.append(child)
        if child.shot_index == 1:
            video_targets.append(1)  # Successful local provider replacement, not a paid call.
            return _PNG, first_video, pcm(1)
        service._store_part(project_id, child, raw, "-voice.wav")
        service._check_before_target_video(child, project_id, raw, 17, 15)
        pytest.fail("Second video must not be reached")

    monkeypatch.setattr(service, "_live_media", live)
    request = replace(
        _request(provider="grok_subscription"),
        shots=(
            StoryShot(narration="第一句。", prompt="第一镜", duration_seconds=3, subtitle=""),
            StoryShot(narration="第二句。", prompt="第二镜", duration_seconds=3, subtitle=""),
        ),
    )
    with pytest.raises(StoryFilmError) as caught:
        service._shots_media(request, "synthetic", project_id)
    limit = caught.value.dialogue_limit
    assert limit is not None
    assert limit.shot_index == 2
    assert limit.target_video_submitted is False
    assert video_targets == [1]
    assert children[1].narration == "第二句。"
    assert limit.request_sha256 == dialogue_request_sha256(
        children[1].video_model,
        children[1].voice_id,
        children[1].delivery,
        children[1].narration,
        (),
    )


def test_cached_bundle_limit_is_pre_target_video_in_this_request_and_keeps_raw_bytes(
    tmp_path, monkeypatch
):
    from aijian_api.xai_media import XaiImage
    from test_draft_export_runtime import toolchain
    from test_story_film import _PNG, _allow_live, _ScriptedTransport

    repository, project_id = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    raw = pcm(15.2)
    transport = _ScriptedTransport([])
    service = StoryFilmService(repository, toolchain, transport=transport)
    request = _request(provider="grok_subscription")
    service._persist_image(project_id, request, _PNG)
    service._store_part(project_id, request, raw, "-voice.wav")
    service._store_part(project_id, request, b"prior cached video bytes", "-clip.mp4")
    with pytest.raises(StoryFilmError) as caught:
        service._live_media(
            request, "synthetic", project_id, prepared_image=XaiImage(_PNG, None, "fixture")
        )
    limit = caught.value.dialogue_limit
    assert limit is not None
    assert limit.raw_audio_sha256 == hashlib.sha256(raw).hexdigest()
    assert limit.raw_audio_saved is True
    assert limit.target_video_submitted is False
    assert transport.requests == []
