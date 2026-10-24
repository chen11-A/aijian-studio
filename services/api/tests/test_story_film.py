"""Scene-to-MP4 coverage. The provider is the local placeholder, never a paid call."""

import base64
import json
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.local_media_toolchain import LocalMediaToolchainService
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from aijian_api.story_film import StoryFilmRequest, StoryFilmService, live_media_enabled
from aijian_api.xai_media import XaiHttpRequest, XaiHttpResponse
from fastapi.testclient import TestClient
from test_draft_export_runtime import toolchain

TOKEN = "s" * 43
HOST = "127.0.0.1:43131"


def _project(tmp_path):
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="16:9",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    return repository, project.id


def _request(provider="stub", **overrides) -> StoryFilmRequest:
    body = {
        "scene_label": "灯塔夜班",
        "narration": "雾散之前，不要回头。",
        "subtitle": "雾城来信",
        "provider": provider,
        "confirmed": False,
        "image_model": "grok-imagine-image-2.0",
        "video_model": "grok-imagine-video-1.5",
        "speech_model": "grok-tts",
        "voice_id": "eve",
        "connection_revision": "none",
        "currency": None,
        "amount_micro": None,
        "idempotency_key": f"story-film:v1:{uuid4()}",
    }
    body.update(overrides)
    return StoryFilmRequest(**body)


def test_live_media_stays_disabled_without_an_explicit_allow(monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("AIJIAN_ALLOW_LIVE_MEDIA", raising=False)
    monkeypatch.delenv("AIJIAN_FORBID_LIVE_MEDIA", raising=False)
    assert live_media_enabled() is False
    monkeypatch.setenv("AIJIAN_ALLOW_LIVE_MEDIA", "1")
    assert live_media_enabled() is True
    monkeypatch.setenv("AIJIAN_FORBID_LIVE_MEDIA", "1")
    assert live_media_enabled() is False
    monkeypatch.delenv("AIJIAN_FORBID_LIVE_MEDIA", raising=False)
    monkeypatch.setenv("CI", "true")
    assert live_media_enabled() is False
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    assert live_media_enabled() is False


def test_metered_and_chatgpt_stop_before_a_task_or_a_call(tmp_path):
    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    metered = service.produce(project_id, _request("xai_api_key"))
    assert metered.status == "BLOCKED"
    assert "花钱" in metered.message
    assert metered.fix
    confirmed = service.produce(
        project_id,
        _request("xai_api_key", confirmed=True, currency="USD", amount_micro=1_000_000),
    )
    assert confirmed.status == "BLOCKED"
    assert confirmed.suggested_provider in {"stub", "grok_subscription"}
    unknown = service.produce(project_id, _request("xai_api_key", confirmed=True))
    assert unknown.status == "BLOCKED"
    assert unknown.suggested_provider == "stub"
    chatgpt = service.produce(project_id, _request("chatgpt"))
    assert chatgpt.status == "BLOCKED"
    assert "ChatGPT" in chatgpt.message
    assert "Grok" in (chatgpt.fix or "")
    with repository._connection() as connection:
        tasks = connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0]
        reservations = connection.execute(
            "SELECT COUNT(*) FROM media_budget_reservations"
        ).fetchone()[0]
    assert tasks == 0
    assert reservations == 0


def test_subscription_without_live_permission_does_not_call_or_store_a_token(tmp_path):
    repository, project_id = _project(tmp_path)
    secret = "grok-token-should-not-be-stored"
    service = StoryFilmService(repository, toolchain)
    missing = service.produce(project_id, _request("grok_subscription"))
    assert missing.status == "BLOCKED"
    assert "登录" in missing.message
    result = service.produce(project_id, _request("grok_subscription"), media_token=secret)
    assert result.status == "BLOCKED"
    assert result.live_call is False
    assert "本地占位" in (result.fix or "")
    blob = (tmp_path / "workspace.db").read_bytes()
    assert secret.encode() not in blob


def test_stub_pipeline_writes_a_playable_mp4_with_picture_and_sound(tmp_path):
    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    result = service.produce(project_id, _request())
    assert result.status == "SUCCEEDED", result.message
    assert result.draft is True
    assert result.live_call is False
    assert result.has_video and result.has_audio
    assert result.output_path and result.output_sha256
    assert result.task_id and result.attempt_id and result.artifact_version_id
    duration = float(result.duration_seconds or "0")
    assert 1.5 <= duration <= 3.2
    tools = toolchain()
    probe = subprocess.run(
        [
            str(tools.ffprobe_path),
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type",
            "-of",
            "json",
            result.output_path,
        ],
        check=True,
        capture_output=True,
    )
    payload = json.loads(probe.stdout)
    kinds = {stream["codec_type"] for stream in payload["streams"]}
    assert {"video", "audio"} <= kinds
    assert 1.5 <= float(payload["format"]["duration"]) <= 3.2
    with repository._connection() as connection:
        task = connection.execute(
            "SELECT status FROM task_ledger WHERE task_id = ?",
            (result.task_id,),
        ).fetchone()
        assert task[0] == "COMPLETED"
        reservations = connection.execute(
            "SELECT COUNT(*) FROM media_budget_reservations"
        ).fetchone()[0]
    assert reservations == 0


def test_missing_font_saves_srt_and_still_makes_the_film(tmp_path, monkeypatch):
    empty = tmp_path / "no-fonts"
    empty.mkdir()
    monkeypatch.setattr("aijian_api.draft_subtitles._font_root", lambda: empty)
    monkeypatch.setattr("aijian_api.draft_subtitles._font_candidates", lambda: [empty])
    monkeypatch.setattr("aijian_api.draft_subtitles._system_cjk_font", lambda: None)
    repository, project_id = _project(tmp_path)
    result = StoryFilmService(repository, toolchain).produce(project_id, _request())
    assert result.status == "SUCCEEDED", result.message
    assert "字幕没能压进视频，已单独保存为字幕文件" in (result.message or "")
    assert result.output_path
    srt = Path(result.output_path).with_suffix(".srt")
    assert "雾城来信" in srt.read_text(encoding="utf-8")
    assert result.has_video and result.has_audio


def test_story_film_route_explains_the_provider_before_any_call(tmp_path):
    repository, project_id = _project(tmp_path)
    app = create_app(
        repository=repository,
        local_media_toolchain=LocalMediaToolchainService(None, fallback=toolchain),
        sidecar_security=SidecarSecurity(token=TOKEN, host=HOST),
    )
    headers = {"Authorization": f"Bearer {TOKEN}", "Origin": "app://aijian"}
    with TestClient(app, base_url=f"http://{HOST}", client=("127.0.0.1", 1234)) as client:
        plan = client.get(f"/api/v1/projects/{project_id}/story-film/plan", headers=headers)
        assert plan.status_code == 200, plan.text
        providers = {item["id"]: item for item in plan.json()["data"]["providers"]}
        assert providers["stub"]["available"] is True
        assert providers["stub"]["billing_label"] == "不花钱"
        assert providers["xai_api_key"]["available"] is False
        assert providers["xai_api_key"]["fix"]
        created = client.post(
            f"/api/v1/projects/{project_id}/story-film",
            headers={**headers, "Idempotency-Key": f"story-film:v1:{uuid4()}"},
            json={
                "scene_label": "灯塔夜班",
                "narration": "雾散之前，不要回头。",
                "subtitle": "雾城来信",
                "provider": "stub",
            },
        )
        assert created.status_code == 200, created.text
        body = created.json()["data"]
        assert body["status"] == "SUCCEEDED"
        assert body["has_video"] is True and body["has_audio"] is True
        assert body["live_call"] is False
        assert "草稿" in body["message"]


_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
    "DwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_IMAGE = {"data": [{"b64_json": base64.b64encode(_PNG).decode()}]}


class _ScriptedTransport:
    def __init__(self, responses: list[XaiHttpResponse]) -> None:
        self.responses = responses
        self.requests: list[XaiHttpRequest] = []

    def send(self, request: XaiHttpRequest) -> XaiHttpResponse:
        self.requests.append(request)
        return self.responses.pop(0)


def _allow_live(monkeypatch, log_path):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    monkeypatch.delenv("AIJIAN_FORBID_LIVE_MEDIA", raising=False)
    monkeypatch.setenv("AIJIAN_ALLOW_LIVE_MEDIA", "1")
    monkeypatch.setenv("AIVORA_GROK_LOGIN_LOG", str(log_path))


def _media_bytes(tmp_path):
    tools = toolchain()
    clip = tmp_path / "upstream.mp4"
    voice = tmp_path / "voice.wav"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=24",
            "-frames:v",
            "48",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(clip),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
            "-c:a",
            "pcm_s16le",
            str(voice),
        ],
        check=True,
        capture_output=True,
    )
    return clip.read_bytes(), voice.read_bytes()


def test_subscription_hands_a_b64_image_to_video_and_logs_status_only(tmp_path, monkeypatch):
    repository, project_id = _project(tmp_path)
    log_path = tmp_path / "grok-login.log"
    _allow_live(monkeypatch, log_path)
    clip, voice = _media_bytes(tmp_path)
    token = "grok-subscription-token"
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, json.dumps({"request_id": "req-live"}).encode()),
            XaiHttpResponse(200, json.dumps({"status": "pending"}).encode()),
            XaiHttpResponse(
                200,
                json.dumps(
                    {"status": "done", "video": {"url": "https://vidgen.x.ai/live.mp4"}}
                ).encode(),
            ),
            XaiHttpResponse(200, clip, "video/mp4"),
            XaiHttpResponse(200, voice, "audio/wav"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _seconds: None
    result = service.produce(project_id, _request("grok_subscription"), media_token=token)
    assert result.status == "SUCCEEDED", result.message
    assert result.live_call is True
    assert result.has_video and result.has_audio
    assert result.suggested_provider is None
    assert result.output_path
    body = json.loads(transport.requests[1].body or b"{}")
    assert body["image"]["url"].startswith("data:image/png;base64,")
    assert body["model"] == "grok-imagine-video-1.5"
    assert body["duration"] == 2
    image_body = json.loads(transport.requests[0].body or b"{}")
    assert image_body["response_format"] == "url"
    saved = list((tmp_path / "story-films").glob("*-key.png"))
    assert saved and saved[0].read_bytes() == _PNG
    text = log_path.read_text()
    assert token not in text
    assert "灯塔夜班" not in text
    events = [json.loads(line)["event"] for line in text.splitlines()]
    assert events[:5] == ["image", "image_saved", "video_submit", "video_poll", "video_poll"]
    assert "tts" in events and "compose" in events


def test_subscription_keeps_the_image_and_voice_when_video_fails(tmp_path, monkeypatch):
    repository, project_id = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "grok-login.log")
    _clip, voice = _media_bytes(tmp_path)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, json.dumps({"request_id": "req-fail"}).encode()),
            XaiHttpResponse(200, json.dumps({"status": "failed"}).encode()),
            XaiHttpResponse(200, voice, "audio/wav"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _seconds: None
    result = service.produce(project_id, _request("grok_subscription"), media_token="token-value")
    assert result.status == "SUCCEEDED", result.message
    assert "画面" in result.message or "视频没有生成成功" in result.message
    assert result.suggested_provider is None
    assert result.fix is None
    assert "本地占位" not in result.message


def test_normalize_keeps_portrait_widescreen_and_square(tmp_path):
    from aijian_api.story_film import _normalize_film_media

    tools = toolchain()
    voice = tmp_path / "voice.wav"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:sample_rate=24000:duration=0.8",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(voice),
        ],
        check=True,
        capture_output=True,
    )
    expected = {"448x672": (448, 672), "640x360": (640, 360), "320x320": (320, 320)}
    for size, canvas in expected.items():
        clip = tmp_path / f"{size}.mp4"
        audio = tmp_path / f"{size}.wav"
        audio.write_bytes(voice.read_bytes())
        subprocess.run(
            [
                str(tools.ffmpeg_path),
                "-hide_banner",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"testsrc=size={size}:rate=24:duration=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=1",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=16x16:r=1:d=0.2",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-map",
                "2:v:0",
                "-c:v:0",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-r",
                "24",
                "-c:a",
                "aac",
                "-ac",
                "2",
                "-c:v:1",
                "mjpeg",
                "-disposition:v:1",
                "attached_pic",
                str(clip),
            ],
            check=True,
            capture_output=True,
        )
        width, height, frames, fitted = _normalize_film_media(
            tools.ffmpeg_path, tools.ffprobe_path, clip, audio
        )
        assert fitted == audio
        assert (width, height) == canvas
        assert frames >= 24
        probed = json.loads(
            subprocess.run(
                [
                    str(tools.ffprobe_path),
                    "-v",
                    "error",
                    "-show_streams",
                    "-of",
                    "json",
                    str(clip),
                ],
                check=True,
                capture_output=True,
            ).stdout
        )
        assert [stream["codec_type"] for stream in probed["streams"]] == ["video"]
        heard = json.loads(
            subprocess.run(
                [
                    str(tools.ffprobe_path),
                    "-v",
                    "error",
                    "-show_streams",
                    "-of",
                    "json",
                    str(audio),
                ],
                check=True,
                capture_output=True,
            ).stdout
        )
        track = heard["streams"][0]
        assert track["sample_rate"] == "48000"
        assert int(track["channels"]) == 2


def test_mp3_named_as_wav_is_trimmed_to_the_longer_voice(tmp_path):
    """The real xAI voice is MP3, 24 kHz, mono, 2.616s, often saved as .wav.

    The clip is 448x672 h264 yuv420p at 24 fps for 2.04s, with AAC 48 kHz
    stereo and an mjpeg cover. Forcing a wav demuxer from the filename fails.
    The narration is kept whole: the film holds the last frame instead of
    cutting the voice down to the clip.
    """

    from aijian_api.story_film import _audio_suffix, _normalize_film_media

    tools = toolchain()
    clip = tmp_path / "clip.mp4"
    named = tmp_path / "voice.wav"
    real = tmp_path / "voice.mp3"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=448x672:rate=24:duration=2.04",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2.04",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=32x32:r=1:d=0.2",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-map",
            "2:v:0",
            "-c:v:0",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "24",
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-c:v:1",
            "mjpeg",
            "-disposition:v:1",
            "attached_pic",
            str(clip),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:sample_rate=24000:duration=2.616",
            "-ac",
            "1",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "128k",
            str(real),
        ],
        check=True,
        capture_output=True,
    )
    mp3 = real.read_bytes()
    assert _audio_suffix(mp3) == ".mp3"
    named.write_bytes(mp3)
    width, height, frames, fitted = _normalize_film_media(
        tools.ffmpeg_path, tools.ffprobe_path, clip, named
    )
    assert (width, height) == (448, 672)
    assert frames >= int(2.616 * 24)
    assert fitted == named and fitted.read_bytes().startswith(b"RIFF")
    heard = json.loads(
        subprocess.run(
            [
                str(tools.ffprobe_path),
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,sample_rate,channels:format=duration",
                "-of",
                "json",
                str(fitted),
            ],
            check=True,
            capture_output=True,
        ).stdout
    )
    assert heard["streams"][0]["sample_rate"] == "48000"
    assert float(heard["format"]["duration"]) >= 2.616
    kept = tmp_path / "kept.mp3"
    kept.write_bytes(mp3)
    _width, _height, _frames, voiced = _normalize_film_media(
        tools.ffmpeg_path, tools.ffprobe_path, clip, kept
    )
    assert voiced.suffix == ".wav" and voiced.read_bytes().startswith(b"RIFF")
    assert kept.read_bytes() == mp3


def _integrated_loudness(ffmpeg: Path, path: Path, window: float) -> float:
    completed = subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-nostdin",
            "-i",
            str(path),
            "-af",
            f"atrim=duration={window:.3f},ebur128=peak=true",
            "-f",
            "null",
            "-",
        ],
        check=False,
        capture_output=True,
    )
    text = completed.stderr.decode("utf-8", errors="replace")
    matched = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("I:"):
            matched = stripped
    assert matched is not None, text[-800:]
    return float(matched.split()[1])


def test_quiet_narration_is_lifted_and_not_cut_off(tmp_path):
    from aijian_api.story_film import _normalize_film_media

    tools = toolchain()
    voice = tmp_path / "quiet.wav"
    clip = tmp_path / "clip.mp4"
    narration = 2.28
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=48000:duration={narration}",
            "-af",
            "volume=-20dB",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(voice),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=448x672:rate=24:duration=2.04",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "24",
            str(clip),
        ],
        check=True,
        capture_output=True,
    )
    _width, _height, frames, fitted = _normalize_film_media(
        tools.ffmpeg_path, tools.ffprobe_path, clip, voice
    )
    assert frames / 24 >= narration
    loudness = _integrated_loudness(tools.ffmpeg_path, fitted, narration)
    assert -17 <= loudness <= -15


def test_two_shots_hold_a_character_still_and_join(tmp_path):
    from aijian_api.story_film import StoryShot

    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    shots = (
        StoryShot("林夏把阿凯推进巷口。", "雨夜巷口，全景，低机位。", 5, "林夏把阿凯推进巷口"),
        StoryShot("阿凯侧身躲开第一拳。", "躲开，中景，侧面。", 5, "阿凯侧身躲开第一拳"),
    )
    result = service.produce(
        project_id,
        _request(narration="雨夜巷战", subtitle=None, shots=shots),
    )
    assert result.status == "SUCCEEDED", result.message
    assert "AI 生成" in result.message
    assert float(result.duration_seconds or "0") >= 4
    assert list((tmp_path / "story-films").glob("*-cast.png"))


def test_each_shot_generates_its_own_still_and_mutes_video_audio(tmp_path, monkeypatch):
    from aijian_api.story_film import StoryShot

    repository, project_id = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "grok-login.log")
    clip, voice = _media_bytes(tmp_path)
    done = {"status": "done", "video": {"url": "https://vidgen.x.ai/live.mp4"}}
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, json.dumps({"request_id": "req-1"}).encode()),
            XaiHttpResponse(200, json.dumps(done).encode()),
            XaiHttpResponse(200, clip, "video/mp4"),
            XaiHttpResponse(200, voice, "audio/wav"),
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, json.dumps({"request_id": "req-2"}).encode()),
            XaiHttpResponse(200, json.dumps(done).encode()),
            XaiHttpResponse(200, clip, "video/mp4"),
            XaiHttpResponse(200, voice, "audio/wav"),
        ]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _seconds: None
    shots = (
        StoryShot("林夏把阿凯推进巷口。", "雨夜巷口，全景。", 5, "林夏把阿凯推进巷口"),
        StoryShot("阿凯侧身躲开第一拳。", "躲开，中景。", 5, "阿凯侧身躲开第一拳"),
    )
    result = service.produce(
        project_id,
        _request(narration="雨夜巷战", subtitle=None, shots=shots, provider="grok_subscription"),
        media_token="grok-subscription-token",
    )
    assert result.status == "SUCCEEDED", result.message
    bodies = []
    for item in transport.requests:
        raw = item.body or b""
        if raw.startswith(b"{"):
            bodies.append(json.loads(raw))
    image_prompts = [body["prompt"] for body in bodies if body.get("n") == 1]
    assert len(image_prompts) == 3
    assert "定妆照" in image_prompts[0]
    assert "起始画面" in image_prompts[1] and "雨夜巷口" in image_prompts[1]
    assert "起始画面" in image_prompts[2] and "躲开" in image_prompts[2]
    assert image_prompts[1] != image_prompts[2]
    videos = [body for body in bodies if body.get("duration")]
    assert len(videos) == 2
    assert all(body["generate_audio"] is False for body in videos)
    assert all("reference_images" not in body for body in videos)
    assert len(list((tmp_path / "story-films").glob("*-key.png"))) >= 2


def test_real_media_edges_name_the_stage_and_keep_even_canvases(tmp_path, monkeypatch):
    from aijian_api.draft_export_runtime import DraftExportError
    from aijian_api.media_asset_store import MediaAssetError
    from aijian_api.story_film import (
        StoryFilmError,
        _audio_suffix,
        _export_reason,
        _failure_event,
        _failure_log_code,
        _failure_message,
        _failure_stage,
        _ffmpeg,
        _ffprobe,
        _fit_canvas,
        _named_stage_message,
        _normalize_film_media,
        _preview_data_url,
        _primary_video,
        _video_frames,
    )
    from aijian_api.xai_media import XaiMediaError

    assert _fit_canvas(448, 672) == (448, 672)
    assert _fit_canvas(1919, 1079) == (1918, 1078)
    wide, high = _fit_canvas(3840, 2160)
    assert max(wide, high) <= 1920 and wide % 2 == 0 and high % 2 == 0
    with pytest.raises(StoryFilmError, match="画面太小"):
        _fit_canvas(15, 40)
    picture = {"codec_type": "video", "codec_name": "h264", "width": 448, "height": 672}
    cover = {
        "codec_type": "video",
        "codec_name": "mjpeg",
        "disposition": {"attached_pic": "1"},
        "width": 32,
        "height": 32,
    }
    assert _primary_video(["skip", {"codec_type": "audio"}, cover, picture]) == (3, 448, 672)
    with pytest.raises(StoryFilmError, match="没有读到可以合成的画面"):
        _primary_video(
            [
                cover,
                {"codec_type": "video", "codec_name": "h264", "width": [], "height": 20},
                {"codec_type": "video", "codec_name": "h264", "width": 1, "height": 1},
            ]
        )
    probed = StoryFilmError(
        "PROBE_FAILED",
        "没有读到可以合成的画面。",
        ffmpeg_stage="probe_video",
        exit_code=1,
    )
    assert "已经做好" in _failure_message(probed, "assemble", True, True)
    ready = StoryFilmError(
        "MEDIA_ENCODE_FAILED",
        "画面、视频和配音都已经做好。整理视频时没有成功，可以重试。",
        exit_code=1,
    )
    assert _failure_message(ready, "assemble", True, True) == ready.message

    class _Coded(Exception):
        code = "SOURCE_PROBE_INVALID"

    assert "封面" in _failure_message(_Coded(), "assemble", True, True)
    assert "合成这一步" in _failure_message(RuntimeError("plain"), "assemble", True, True)
    assert "配音" in _failure_message(StoryFilmError("X", "x"), "speech", True, False)
    assert "视频" in _failure_message(XaiMediaError("X", "x"), "video", True, False)
    assert "画面这一步" in _failure_message(StoryFilmError("X", "x"), "image", False, False)
    assert "成片没有做完" in _failure_message(
        MediaAssetError("SOURCE_SIZE", "big"), "assemble", False, False
    )
    assert "封面" in _failure_message(
        DraftExportError("SOURCE_PROBE_INVALID", "layout"), "assemble", False, False
    )
    assert _failure_message(RuntimeError("x"), "assemble", False, False) == "成片没有做完。"
    assert _failure_log_code(probed) == "exit_1"
    assert _failure_log_code(StoryFilmError("SOURCE_PROBE_INVALID", "x")) == "SOURCE_PROBE_INVALID"
    huge = StoryFilmError("OK_CODE", "m", exit_code=10**40)
    assert _failure_log_code(huge) == "OK_CODE"
    assert _failure_log_code(StoryFilmError("bad code", "m")) == "StoryFilmError"
    assert _failure_log_code(type("bad name", (Exception,), {})()) == "FAILED"
    assert _export_reason(None) is None
    assert _export_reason("EXPORT_FAILED") == "合成没有完成"
    assert _failure_event("video") == "video_submit"
    assert _failure_event("speech") == "tts"
    assert _failure_event("assemble") == "compose"
    assert _failure_event("other") == "image_saved"
    assert _failure_stage("video") == "video"
    assert _failure_stage("later") == "image"
    assert "合成" in _named_stage_message("assemble", True, "fallback")
    assert "视频" in _named_stage_message("other", True, "fallback")
    assert _named_stage_message("image", True, "fallback") == "画面这一步没有成功，可以重试"
    assert _preview_data_url(b"") is None
    assert _preview_data_url(b"\xff\xd8rest").startswith("data:image/jpeg")
    assert _preview_data_url(b"RIFFWEBP").startswith("data:image/webp")
    assert _preview_data_url(b"x" * 1_500_001) is None
    tools = toolchain()
    for stage, expected in (
        ("normalize_video", "整理视频"),
        ("normalize_voice", "整理配音"),
        (None, "没有编码成功"),
    ):
        with pytest.raises(StoryFilmError, match=expected) as caught:
            _ffmpeg(tools.ffmpeg_path, ["-i", str(tmp_path / "missing.bin")], stage=stage)
        assert isinstance(caught.value.exit_code, int) and caught.value.exit_code != 0
    with pytest.raises(StoryFilmError, match="没有读到可以合成的画面") as probed_file:
        _ffprobe(tools.ffprobe_path, [str(tmp_path / "missing.bin")])
    assert probed_file.value.exit_code
    voice = tmp_path / "only.wav"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=0.2",
            str(voice),
        ],
        check=True,
        capture_output=True,
    )
    with pytest.raises(StoryFilmError, match="没有读到镜头"):
        _video_frames(tools.ffprobe_path, voice)

    monkeypatch.setattr(
        "aijian_api.story_film._ffprobe", lambda *_args, **_kwargs: {"streams": None}
    )
    with pytest.raises(StoryFilmError, match="没有读到可以合成的画面"):
        _normalize_film_media(tools.ffmpeg_path, tools.ffprobe_path, voice, voice)
    repository, project_id = _project(tmp_path)
    service = StoryFilmService(repository, toolchain)
    request = _request()
    assert service._saved_bundle(project_id, request) is None
    service._store_part(project_id, request, b"", "-clip.mp4")
    service._persist_image(project_id, request, b"\xff\xd8jpeg")
    assert service._saved_bundle(project_id, request) is None
    service._store_part(project_id, request, b"clip", "-clip.mp4")
    assert service._saved_bundle(project_id, request) is None
    service._store_part(project_id, request, b"voice", "-voice.wav")
    assert service._saved_bundle(project_id, request) is not None
    assert _audio_suffix(b"RIFF" + b"\x00" * 4 + b"WAVE") == ".wav"
    assert _audio_suffix(b"ID3" + b"\x00" * 9) == ".mp3"
    assert _audio_suffix(b"\xff\xf3\xc4\xc4") == ".mp3"
    assert _audio_suffix(b"nope") == ".wav"
    service._store_part(project_id, request, b"\xff\xf3\xc4\xc4voice", "-voice.wav")
    renamed = service._saved_bundle(project_id, request)
    assert renamed is not None and renamed[2].startswith(b"\xff\xf3")
    assert not list((tmp_path / "story-films").glob("*-voice.wav"))
    service._store_part(project_id, request, b"RIFF" + b"\x00" * 4 + b"WAVEold", "-voice.wav")
    preferred = service._saved_bundle(project_id, request)
    assert preferred is not None and preferred[2].startswith(b"\xff\xf3")
    forced = _request(
        regenerate=True,
        scene_label=request.scene_label,
        narration=request.narration,
        voice_id=request.voice_id,
    )
    service._store_part(project_id, forced, b"RIFF" + b"\x00" * 4 + b"WAVEnew", "-voice.wav")
    replaced = service._saved_bundle(project_id, forced)
    assert replaced is not None and replaced[2].startswith(b"RIFF")
    assert not list((tmp_path / "story-films").glob("*-voice.mp3"))
    assert service._artifact_head(project_id, "story_film", None) == (None, None)

    def _broken_tools():
        raise RuntimeError("no ffmpeg")

    with pytest.raises(StoryFilmError, match="视频工具"):
        StoryFilmService(repository, _broken_tools)._tools()
