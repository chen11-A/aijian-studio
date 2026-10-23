"""Scene-to-MP4 coverage. The provider is the local placeholder, never a paid call."""

import base64
import json
import subprocess
from uuid import uuid4

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
    assert 1.5 <= duration <= 2.5
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
    assert 1.5 <= float(payload["format"]["duration"]) <= 2.5
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
