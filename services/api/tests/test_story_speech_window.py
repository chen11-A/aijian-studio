"""Actual local sample windows and provider-cache boundaries; no network/account calls."""

import hashlib
import io
import json
import struct
import wave
from pathlib import Path

import pytest
from aijian_api.story_film import (
    StoryFilmError,
    StoryFilmService,
    StoryShot,
    _ffmpeg,
    _media_duration,
    _normalize_film_media,
    _video_frames,
)
from aijian_api.story_speech_window import SPEECH_WINDOW, pad_pcm
from aijian_api.xai_media import XaiHttpResponse
from test_draft_export_runtime import toolchain
from test_story_film import _PNG, _allow_live, _project, _request, _ScriptedTransport


def pcm(seconds):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        # The non-silent body has a recognizable first/last sample and both polarities.
        audio.writeframes(struct.pack("<hh", 5000, -4000) * round(seconds * 24000))
    return output.getvalue()


def samples(path):
    with wave.open(str(path), "rb") as audio:
        return audio.getframerate(), audio.getnchannels(), audio.readframes(audio.getnframes())


def clip(path, seconds):
    _ffmpeg(
        toolchain().ffmpeg_path,
        [
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size=160x90:rate=24:duration={seconds}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(path),
        ],
    )
    return path.read_bytes()


def test_padding_preserves_every_body_sample_and_original_bytes(tmp_path):
    source = tmp_path / "raw.wav"
    source.write_bytes(pcm(1.25))
    original = source.read_bytes()
    target = tmp_path / "derived.wav"
    assert pad_pcm(source, target, SPEECH_WINDOW) == 2.25
    rate, channels, data = samples(target)
    body = samples(source)[2]
    assert (rate, channels) == (48000, 1)
    assert data == bytes(19200 * 2) + body + bytes(28800 * 2)
    assert source.read_bytes() == original


def test_real_normalization_keeps_mandatory_window_and_hold_within_one_second(tmp_path):
    video = tmp_path / "provider.mp4"
    original_video = clip(video, 2)
    voice = tmp_path / "voice.wav"
    voice.write_bytes(pcm(2))
    tools = toolchain()
    _, _, frames, padded = _normalize_film_media(
        tools.ffmpeg_path, tools.ffprobe_path, video, voice, 3, speech_window=SPEECH_WINDOW
    )
    assert frames == 72
    assert _video_frames(tools.ffprobe_path, video) - 48 <= 24
    rate, channels, data = samples(padded)
    width = channels * 2
    assert rate == 48000
    assert data[: 19200 * width] == bytes(19200 * width)
    assert any(data[19200 * width : round(2.4 * rate) * width])
    assert not any(data[round(2.4 * rate) * width :])
    assert len(data) / width / rate >= 3
    assert original_video != video.read_bytes()  # Local working copy only.


def test_new_window_never_shrinks_tail_to_fit_but_legacy_default_is_unchanged(tmp_path):
    tools = toolchain()
    for policy, expected in [(None, None), (SPEECH_WINDOW, "VIDEO_TOO_SHORT")]:
        video = tmp_path / f"clip-{policy is None}.mp4"
        clip(video, 2)
        voice = tmp_path / f"voice-{policy is None}.wav"
        voice.write_bytes(pcm(2.2))
        raw = voice.read_bytes()
        if expected:
            with pytest.raises(StoryFilmError) as failure:
                _normalize_film_media(
                    tools.ffmpeg_path,
                    tools.ffprobe_path,
                    video,
                    voice,
                    speech_window=policy,
                )
            assert failure.value.code == expected
            assert voice.read_bytes() == raw
        else:
            _, _, frames, _ = _normalize_film_media(
                tools.ffmpeg_path,
                tools.ffprobe_path,
                video,
                voice,
            )
            assert frames == 65  # Legacy 2.2 + optional 0.5, not the new 1s policy.


@pytest.mark.parametrize(
    "model,references,cap",
    [
        ("grok-imagine-video-1.5", (), 15),
        ("grok-imagine-video-1.5-lite", (), 15),
        ("grok-imagine-video", ("https://example.invalid/ref.png",), 10),
    ],
)
def test_padding_over_cap_keeps_raw_voice_and_retry_does_not_submit_video_or_tts(
    tmp_path,
    monkeypatch,
    model,
    references,
    cap,
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    raw = pcm(cap - 0.8)  # Raw speech fits, mandatory head/tail does not.
    transport = _ScriptedTransport([XaiHttpResponse(200, raw, "audio/wav")])
    service = StoryFilmService(repository, toolchain, transport=transport)
    request = _request(provider="grok_subscription", video_model=model)
    image_file = service._persist_image(project, request, _PNG)
    from aijian_api.xai_media import XaiImage

    for _ in range(2):
        with pytest.raises(StoryFilmError) as failure:
            service._live_media(
                request,
                "synthetic",
                project,
                prepared_image=XaiImage(_PNG, None, "fixture"),
                reference_images=references,
            )
        assert failure.value.code == "DIALOGUE_VIDEO_LIMIT"
        assert failure.value.detail["requiredSeconds"] == pytest.approx(cap + 0.2)
        assert failure.value.detail["maxSeconds"] == cap
    assert len(transport.requests) == 1
    assert b'"voice_id"' in transport.requests[0].body
    cached = service._saved_voice(service._image_directory(), service._image_stem(project, request))
    assert cached.read_bytes() == raw
    assert image_file.read_bytes() == _PNG


@pytest.mark.parametrize("shot_list", [False, True])
def test_production_window_is_applied_once_and_proof_uses_final_derived_audio(
    tmp_path,
    monkeypatch,
    shot_list,
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    raw = pcm(1)
    raw_clip = clip(tmp_path / "original-provider.mp4", 3)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, raw, "audio/wav"),
            XaiHttpResponse(200, json.dumps({"request_id": "window-video"}).encode()),
            XaiHttpResponse(
                200,
                json.dumps(
                    {
                        "status": "done",
                        "video": {
                            "url": "https://example.invalid/video.mp4",
                        },
                    }
                ).encode(),
            ),
            XaiHttpResponse(200, raw_clip, "video/mp4"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    request = _request(provider="grok_subscription", subtitle="完整对白")
    if shot_list:
        request = _request(
            provider="grok_subscription",
            shots=(
                StoryShot(
                    "完整对白", "书店", 2, "完整对白", still="https://example.invalid/start.png"
                ),
            ),
        )
    else:
        # Exact cached image is a local fixture, no image generation call.
        service._persist_image(project, request, _PNG)
    result = service.produce(project, request, media_token="synthetic")
    assert result.status == "SUCCEEDED", result.message
    video_requests = [
        call for call in transport.requests if call.url.endswith("/videos/generations")
    ]
    assert len(video_requests) == 1
    assert json.loads(video_requests[0].body)["duration"] == 2
    rate, channels, data = samples(Path(result.voice_path))
    width = channels * 2
    assert rate == 48000
    # Aggregate normalization must not produce 0.8s head / duplicate padding.
    assert not any(data[: round(0.4 * rate) * width])
    assert any(data[round(0.45 * rate) * width : round(0.9 * rate) * width])
    assert not any(data[round(1.4 * rate) * width :])
    assert _media_duration(toolchain().ffprobe_path, Path(result.output_path)) >= 2
    assert Path(tmp_path / "original-provider.mp4").read_bytes() == raw_clip
    assert list((tmp_path / "story-films").glob("*-voice.wav"))
    manifest = repository.get_artifact_version(
        project, "story_film", result.artifact_version_id
    ).version.content
    assert manifest["speech_window"]["version"] == SPEECH_WINDOW.version
    assert (
        manifest["output_sha256"]
        == hashlib.sha256(Path(result.output_path).read_bytes()).hexdigest()
    )
    assert result.subtitle_cues[0].start_seconds >= 0.4
    from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
    from aijian_api.media_asset_store import MediaAssetStore

    derived_sha = hashlib.sha256(Path(result.voice_path).read_bytes()).hexdigest()
    audio_asset = MediaAssetStore(repository).get_asset(
        project, manifest["audio_asset_id"], verify=True
    )
    assert audio_asset.latest_version.sha256 == derived_sha
    assert derived_sha != hashlib.sha256(raw).hexdigest()
    episode = repository.list_episodes(project)[0].id
    assembly = EpisodeMediaAssemblyStore(repository).read_version(
        project,
        episode,
        version_id=manifest["assembly_version_id"],
    )
    assert assembly.content.audio_segments[0].media.sha256 == derived_sha
    proof_id, _ = service._artifact_head(project, "story_film_clean_copy", episode)
    proof = repository.get_artifact_version(
        project,
        "story_film_clean_copy",
        proof_id,
        episode_id=episode,
    ).version.content
    assert (
        proof["output_sha256"]
        == hashlib.sha256(Path(result.clean_output_path).read_bytes()).hexdigest()
    )
    original_output = Path(result.output_path).read_bytes()
    original_clean = Path(result.clean_output_path).read_bytes()
    restored = service.remake_clean_copy(str(result.output_path), project_id=project)
    assert restored.status == "SUCCEEDED", restored.message
    # Recovery reuses the actual assembly audio, not today's padding default.
    assert (
        Path(result.voice_path).read_bytes()
        and hashlib.sha256(Path(result.voice_path).read_bytes()).hexdigest() == derived_sha
    )
    assert Path(result.output_path).read_bytes() == original_output
    assert Path(result.clean_output_path).read_bytes() == original_clean
    assert restored.subtitle_cues == result.subtitle_cues
    # Original raw cache remains unpadded, including after completed-idempotency reuse.
    raw_paths = list((tmp_path / "story-films").glob("*-voice.wav"))
    assert any(path.read_bytes() == raw for path in raw_paths)
    count = len(transport.requests)
    again = service.produce(project, request, media_token="synthetic")
    assert again.status == "BLOCKED"  # Existing subscription idempotency, no new dispatch.
    assert len(transport.requests) == count
    assert Path(result.output_path).is_file()


@pytest.mark.parametrize(
    "model,references,cap",
    [
        ("grok-imagine-video-1.5", (), 15),
        ("grok-imagine-video", ("https://example.invalid/ref.png",), 10),
    ],
)
def test_exact_cap_auto_duration_and_raw_cache_reuse_never_add_another_video(
    tmp_path,
    monkeypatch,
    model,
    references,
    cap,
):
    from aijian_api.xai_media import XaiImage

    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    raw = pcm(cap - 1)
    original = clip(tmp_path / "provider.mp4", cap)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, raw, "audio/wav"),
            XaiHttpResponse(200, b'{"request_id":"exact-cap"}'),
            XaiHttpResponse(
                200, b'{"status":"done","video":{"url":"https://example.invalid/a.mp4"}}'
            ),
            XaiHttpResponse(200, original, "video/mp4"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    request = _request(provider="grok_subscription", video_model=model)
    service._persist_image(project, request, _PNG)
    image = XaiImage(_PNG, None, "fixture")
    first = service._live_media(
        request,
        "synthetic",
        project,
        duration=2,
        prepared_image=image,
        reference_images=references,
    )
    video_calls = [call for call in transport.requests if call.url.endswith("/videos/generations")]
    assert len(video_calls) == 1
    assert json.loads(video_calls[0].body)["duration"] == cap
    assert first[1:] == (original, raw)
    assert (
        service._live_media(
            request,
            "synthetic",
            project,
            duration=2,
            reference_images=references,
        )
        == first
    )
    assert len(transport.requests) == 4


@pytest.mark.parametrize("referenced_shot", [False, True])
def test_empty_spoken_text_has_no_synthetic_window_or_policy(
    tmp_path, monkeypatch, referenced_shot
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    original = clip(tmp_path / "provider.mp4", 10 + 3 / 24 if referenced_shot else 2)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, b'{"request_id":"silent"}'),
            XaiHttpResponse(
                200, b'{"status":"done","video":{"url":"https://example.invalid/a.mp4"}}'
            ),
            XaiHttpResponse(200, original, "video/mp4"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    request = _request(provider="grok_subscription", narration="", subtitle="")
    if referenced_shot:
        request = _request(
            provider="grok_subscription",
            narration="",
            subtitle="",
            video_model="grok-imagine-video",
            shots=(
                StoryShot(
                    "",
                    "静音场景",
                    12,
                    "",
                    still="https://example.invalid/start.png",
                    references=("https://example.invalid/ref.png",),
                ),
            ),
        )
    service._persist_image(project, request, _PNG)
    result = service.produce(project, request, media_token="synthetic")
    assert result.status == "SUCCEEDED", result.message
    manifest = repository.get_artifact_version(project, "story_film", result.artifact_version_id)
    assert "speech_window" not in manifest.version.content
    assert len(transport.requests) == 3
    assert not any(samples(Path(result.voice_path))[2])
    if referenced_shot:
        assert _video_frames(toolchain().ffprobe_path, Path(result.output_path)) <= 10 * 24
        assert (tmp_path / "provider.mp4").read_bytes() == original


def test_two_shots_auto_extend_independently_keep_second_body_and_actual_layout(
    tmp_path, monkeypatch
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    originals = [clip(tmp_path / f"provider-{i}.mp4", seconds) for i, seconds in enumerate((3, 4))]
    voices = [pcm(2), pcm(2.5)]
    responses = []
    for index in range(2):
        responses.extend(
            [
                XaiHttpResponse(200, voices[index], "audio/wav"),
                XaiHttpResponse(200, json.dumps({"request_id": f"shot-{index}"}).encode()),
                XaiHttpResponse(
                    200, b'{"status":"done","video":{"url":"https://example.invalid/a.mp4"}}'
                ),
                XaiHttpResponse(200, originals[index], "video/mp4"),
            ]
        )
    transport = _ScriptedTransport(responses)
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    shots = tuple(
        StoryShot(
            f"第{index}句",
            f"场景{index}",
            2,
            f"第{index}句",
            still="https://example.invalid/start.png",
        )
        for index in range(2)
    )
    result = service.produce(
        project,
        _request(provider="grok_subscription", shots=shots),
        media_token="synthetic",
    )
    assert result.status == "SUCCEEDED", result.message
    requested = [
        json.loads(call.body)["duration"]
        for call in transport.requests
        if call.url.endswith("/videos/generations")
    ]
    assert requested == [3, 4]  # Original estimate sum4 must not crop the real joined6.6s.
    rate, channels, data = samples(Path(result.voice_path))
    width = channels * 2

    def active(start, end):
        return any(data[round(start * rate) * width : round(end * rate) * width])

    assert not active(0, 0.4)
    assert active(0.45, 2.35)
    assert not active(2.4, 3)
    assert active(3.05, 5.45)  # Complete 2.5s second body, not a cropped estimated tail.
    assert not active(5.5, 6.59)
    assert _media_duration(toolchain().ffprobe_path, Path(result.output_path)) == pytest.approx(
        6.6, abs=0.05
    )
    assert [cue.text for cue in result.subtitle_cues] == ["第0句", "第1句"]
    assert result.subtitle_cues[0].start_seconds == pytest.approx(10 / 24, abs=0.001)
    assert result.subtitle_cues[0].end_seconds == pytest.approx(2.6, abs=1 / 24)
    assert result.subtitle_cues[1].start_seconds == pytest.approx(3, abs=1 / 24)
    assert result.subtitle_cues[1].end_seconds >= 6.58
    for index, original in enumerate(originals):
        assert (tmp_path / f"provider-{index}.mp4").read_bytes() == original
    cached = [p.read_bytes() for p in (tmp_path / "story-films").glob("*-voice.wav")]
    assert all(raw in cached for raw in voices)


@pytest.mark.parametrize(
    "model,cap,references",
    [
        ("grok-imagine-video", 10, ("https://example.invalid/place.png",)),
        ("grok-imagine-video-1.5", 15, ()),
    ],
)
@pytest.mark.parametrize("extra_seconds", [2, 3 / 24])
def test_actual_long_provider_response_respects_effective_cap_in_production(
    tmp_path,
    monkeypatch,
    model,
    cap,
    references,
    extra_seconds,
):
    repository, project = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    raw = pcm(cap - 1)
    original = clip(tmp_path / "long-provider.mp4", cap + extra_seconds)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, raw, "audio/wav"),
            XaiHttpResponse(200, b'{"request_id":"long"}'),
            XaiHttpResponse(
                200, b'{"status":"done","video":{"url":"https://example.invalid/a.mp4"}}'
            ),
            XaiHttpResponse(200, original, "video/mp4"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    shot = StoryShot(
        "完整对白",
        "书店",
        2,
        "完整对白",
        still="https://example.invalid/start.png",
        references=references,
    )
    result = service.produce(
        project,
        _request(provider="grok_subscription", video_model=model, shots=(shot,)),
        media_token="synthetic",
    )
    assert result.status == "SUCCEEDED", result.message
    assert _video_frames(toolchain().ffprobe_path, Path(result.output_path)) <= cap * 24
    assert float(result.duration_seconds) == pytest.approx(cap, abs=1 / 24)
    rate, channels, data = samples(Path(result.voice_path))
    width = channels * 2
    assert not any(data[: 19200 * width])
    assert any(data[round((cap - 0.7) * rate) * width : round((cap - 0.61) * rate) * width])
    assert not any(data[round((cap - 0.6) * rate) * width :])
    assert (tmp_path / "long-provider.mp4").read_bytes() == original
    assert any(p.read_bytes() == original for p in (tmp_path / "story-films").glob("*-clip.mp4"))
