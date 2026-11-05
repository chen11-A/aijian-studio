"""Ordered dialogue regression: synthetic voices and local FFmpeg, no account calls."""

import io
import json
import struct
import wave
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import pytest
from aijian_api.story_film import (
    StoryDialogue,
    StoryFilmError,
    StoryFilmService,
    StoryShot,
    _media_duration,
    clear_film_cancel,
    request_film_cancel,
)
from aijian_api.story_film_routes import StoryDialogueBody
from aijian_api.xai_media import XaiHttpResponse
from pydantic import ValidationError
from test_draft_export_runtime import toolchain
from test_story_film import _allow_live, _media_bytes, _project, _request, _ScriptedTransport


def wav(value, rate=16000):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(struct.pack("<h", value) * rate)
    return output.getvalue()


def test_ordered_speakers_decode_to_one_wav_and_cache_changes(tmp_path):
    repository, project = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    lines = (StoryDialogue("甲", "第一句。还有一句。", "rex"), StoryDialogue("乙", "回答。", "eve"))
    request = _request(provider="grok_subscription", dialogue_lines=lines)
    client = Mock()
    client.synthesize.side_effect = [wav(5000), wav(-5000, 24000)]
    result = service._dialogue_speech(client, request, project)
    assert [
        (call.kwargs["text"], call.kwargs["voice_id"]) for call in client.synthesize.call_args_list
    ] == [(line.text, line.voice_id) for line in lines]
    with wave.open(io.BytesIO(result)) as audio:
        assert audio.getframerate() == 48000
        assert audio.getnframes() == 96000
        values = struct.unpack("<" + "h" * audio.getnframes(), audio.readframes(audio.getnframes()))
        assert values[24000] > 0 and values[72000] < 0
    key = service._image_stem(project, request)
    for changed in [
        replace(lines[1], voice_id="leo"),
        replace(lines[1], speaker="丙"),
        replace(lines[1], text="另句。"),
    ]:
        assert (
            service._image_stem(project, replace(request, dialogue_lines=(lines[0], changed)))
            != key
        )
    assert (
        service._image_stem(project, replace(request, dialogue_lines=tuple(reversed(lines)))) != key
    )


def test_same_speaker_multiple_lines_still_synthesizes_every_line(tmp_path):
    repository, project = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    lines = (StoryDialogue("甲", "第一句。", "rex"), StoryDialogue("甲", "第二句。", "rex"))
    client = Mock()
    client.synthesize.return_value = wav(1000)
    service._dialogue_speech(client, _request(dialogue_lines=lines), project)
    assert [call.kwargs["text"] for call in client.synthesize.call_args_list] == [
        line.text for line in lines
    ]


def test_cancel_between_lines_stops_synthesis_and_never_returns_partial_audio(tmp_path):
    repository, project = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    client = Mock()

    def cancelled(**_kwargs):
        request_film_cancel(project)
        return wav(1000)

    client.synthesize.side_effect = cancelled
    try:
        with pytest.raises(StoryFilmError, match="已停止等待"):
            service._dialogue_speech(
                client,
                _request(
                    dialogue_lines=(
                        StoryDialogue("甲", "一", "rex"),
                        StoryDialogue("乙", "二", "eve"),
                    )
                ),
                project,
            )
        assert client.synthesize.call_count == 1
    finally:
        clear_film_cancel(project)


@pytest.mark.parametrize("voice", [" ", " rex", "r ex", "rex\n", "x\x00", "x" * 65])
def test_dialogue_route_rejects_invalid_voice_ids(voice):
    with pytest.raises(ValidationError):
        StoryDialogueBody(speaker="甲", text="一句。", voice_id=voice)


def test_non_member_multiple_voices_explicitly_blocked(tmp_path):
    repository, project = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    lines = (StoryDialogue("甲", "一", "rex"), StoryDialogue("乙", "二", "eve"))
    result = service.produce(
        project, _request(shots=(StoryShot("一二", "书店", 2, "一二", lines=lines),))
    )
    assert result.status == "BLOCKED"
    assert result.user_message["code"] == "MULTI_VOICE_PROVIDER_REQUIRED"


def test_member_two_voices_export_full_audio_beyond_requested_duration(tmp_path, monkeypatch):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "agents.log")
    clip, speech = _media_bytes(tmp_path)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps({"request_id": "dialogue-video"}).encode()),
            XaiHttpResponse(
                200,
                json.dumps(
                    {"status": "done", "video": {"url": "https://example.invalid/video.mp4"}}
                ).encode(),
            ),
            XaiHttpResponse(200, clip, "video/mp4"),
            XaiHttpResponse(200, speech, "audio/wav"),
            XaiHttpResponse(200, speech, "audio/wav"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    lines = (
        StoryDialogue("甲", "第一句。第二句。", "rex"),
        StoryDialogue("乙", "最后一句。", "eve"),
    )
    shot = StoryShot(
        "第一句。第二句。最后一句。",
        "书店",
        2,
        "第一句。第二句。最后一句。",
        still="https://example.invalid/start.png",
        lines=lines,
    )
    result = service.produce(
        project, _request(provider="grok_subscription", shots=(shot,)), media_token="synthetic"
    )
    assert result.status == "SUCCEEDED", result.message
    assert result.voice_path and result.output_path
    assert _media_duration(toolchain().ffprobe_path, Path(result.voice_path)) >= 4
    assert _media_duration(toolchain().ffprobe_path, Path(result.output_path)) >= 4
    calls = [
        json.loads(request.body)
        for request in transport.requests
        if request.body and b'"voice_id"' in request.body
    ]
    assert [(body["text"], body["voice_id"]) for body in calls] == [
        (line.text, line.voice_id) for line in lines
    ]
    assert service._shot_captions[0][0] == shot.subtitle
    assert service._shot_captions[0][2] >= 4
