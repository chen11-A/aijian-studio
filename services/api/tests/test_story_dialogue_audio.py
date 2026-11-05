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
    _ffmpeg,
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


@pytest.mark.parametrize(
    "model, planned, expected_duration, references",
    [
        ("grok-imagine-video-1.5", 2, 5, ()),
        ("grok-imagine-video", 12, 10, ("https://example.invalid/place.png",)),
    ],
)
def test_member_two_voices_export_full_audio_beyond_requested_duration(
    tmp_path, monkeypatch, model, planned, expected_duration, references
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "agents.log")
    _clip, speech = _media_bytes(tmp_path)
    clip_path = tmp_path / "long-enough.mp4"
    _ffmpeg(
        toolchain().ffmpeg_path,
        [
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=24:duration=4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(clip_path),
        ],
    )
    clip = clip_path.read_bytes()
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, speech, "audio/wav"),
            XaiHttpResponse(200, speech, "audio/wav"),
            XaiHttpResponse(200, json.dumps({"request_id": "dialogue-video"}).encode()),
            XaiHttpResponse(
                200,
                json.dumps(
                    {"status": "done", "video": {"url": "https://example.invalid/video.mp4"}}
                ).encode(),
            ),
            XaiHttpResponse(200, clip, "video/mp4"),
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
        planned,
        "第一句。第二句。最后一句。",
        still="https://example.invalid/start.png",
        lines=lines,
        references=references,
    )
    result = service.produce(
        project,
        _request(provider="grok_subscription", video_model=model, shots=(shot,)),
        media_token="synthetic",
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
    video_requests = [
        request for request in transport.requests if request.url.endswith("/videos/generations")
    ]
    assert len(video_requests) == 1
    assert json.loads(video_requests[0].body)["duration"] == expected_duration
    assert transport.requests.index(video_requests[0]) == 2
    assert _media_duration(toolchain().ffprobe_path, Path(result.output_path)) <= 5


@pytest.mark.parametrize(
    "model, seconds, references, cap",
    [
        ("grok-imagine-video-1.5", 16, (), 15),
        ("grok-imagine-video", 11, ("https://example.invalid/place.png",), 10),
    ],
)
def test_dialogue_over_video_cap_fails_before_video_submission(
    tmp_path, monkeypatch, model, seconds, references, cap
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "agents.log")
    with io.BytesIO() as output:
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(struct.pack("<h", 1000) * 16000 * seconds)
        speech = output.getvalue()
    transport = _ScriptedTransport([XaiHttpResponse(200, speech, "audio/wav")])
    service = StoryFilmService(repository, toolchain, transport=transport)
    lines = (StoryDialogue("甲", "这是一句完整保留的长对白。", "rex"),)
    shot = StoryShot(
        lines[0].text,
        "书店",
        2,
        lines[0].text,
        still="https://example.invalid/start.png",
        lines=lines,
        references=references,
    )
    result = service.produce(
        project,
        _request(provider="grok_subscription", video_model=model, shots=(shot,)),
        media_token="synthetic",
    )
    assert result.status == "FAILED"
    assert result.user_message["code"] == "DIALOGUE_VIDEO_LIMIT"
    assert len(transport.requests) == 1
    assert b'"voice_id"' in transport.requests[0].body
    assert shot.lines == lines
    assert (
        result.user_message["detail"]
        == f"第 1 镜对白约 {seconds} 秒，视频最多 {cap} 秒；请拆分对白。"
    )
    assert all(
        value not in result.user_message["detail"]
        for value in ("requiredSeconds", "maxSeconds", "{", "DIALOGUE_VIDEO_LIMIT")
    )
    retry = service.produce(
        project,
        _request(provider="grok_subscription", video_model=model, shots=(shot,), regenerate=True),
        media_token="synthetic",
    )
    assert retry.user_message["code"] == "DIALOGUE_VIDEO_LIMIT"
    assert len(transport.requests) == 1
    assert list((tmp_path / "story-films").glob("*-voice.wav"))


def test_normalize_refuses_long_hold_without_trimming_speech(tmp_path):
    from aijian_api.story_film import _normalize_film_media

    _clip, _speech = _media_bytes(tmp_path)
    clip = tmp_path / "short.mp4"
    clip.write_bytes(_clip)
    audio = tmp_path / "long.wav"
    _ffmpeg(
        toolchain().ffmpeg_path,
        ["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "pcm_s16le", str(audio)],
    )
    original = audio.read_bytes()
    with pytest.raises(StoryFilmError) as failure:
        _normalize_film_media(toolchain().ffmpeg_path, toolchain().ffprobe_path, clip, audio)
    assert failure.value.code == "VIDEO_TOO_SHORT"
    assert audio.read_bytes() == original


def test_one_second_hold_budget_preserves_audio_and_never_adds_long_silence(tmp_path):
    from aijian_api.story_film import _normalize_film_media

    clip_bytes, _ = _media_bytes(tmp_path)
    clip = tmp_path / "budget.mp4"
    clip.write_bytes(clip_bytes)
    audio = tmp_path / "three-seconds.wav"
    _ffmpeg(
        toolchain().ffmpeg_path,
        ["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "pcm_s16le", str(audio)],
    )
    _, _, frames, fitted = _normalize_film_media(
        toolchain().ffmpeg_path, toolchain().ffprobe_path, clip, audio
    )
    assert frames == 72
    assert _media_duration(toolchain().ffprobe_path, clip) <= 3
    assert _media_duration(toolchain().ffprobe_path, fitted) >= 3


def test_old_short_cached_video_refuses_without_submitting_again(tmp_path, monkeypatch):
    from test_story_film import _PNG

    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "agents.log")
    clip, _ = _media_bytes(tmp_path)
    audio = tmp_path / "long-cache.wav"
    _ffmpeg(
        toolchain().ffmpeg_path,
        ["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "pcm_s16le", str(audio)],
    )
    transport = _ScriptedTransport([])
    service = StoryFilmService(repository, toolchain, transport=transport)
    monkeypatch.setattr(service, "_saved_bundle", lambda *_: (_PNG, clip, audio.read_bytes()))
    with pytest.raises(StoryFilmError) as failed:
        service._live_media(_request(provider="grok_subscription"), "synthetic", project)
    assert failed.value.code == "VIDEO_TOO_SHORT"
    assert transport.requests == []
