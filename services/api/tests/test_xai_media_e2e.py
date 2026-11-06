"""Story film against a local HTTPS stand-in for the documented xAI shapes.

The stand-in is a real HTTP server. The client uses the urllib transport, so a
download that dies inside that transport fails the film before any video POST.
"""

from __future__ import annotations

import base64
import json
import math
import ssl
import subprocess
import threading
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from aijian_api.story_film import StoryFilmService, _normalize_film_media, _video_frames
from aijian_api.task_queue_read import TaskQueueReader
from aijian_api.xai_media import XaiMediaClient
from test_draft_export_runtime import toolchain
from test_story_film import _allow_live, _project, _request

_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
    "DwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_REVISED = "revised-prompt-must-not-be-logged"


class _Script:
    def __init__(self) -> None:
        self.mode = "url"
        self.host = ""
        self.jpeg = b""
        self.mp4 = b""
        # Positive cases must answer the actual integer duration request. Empty
        # mapping deliberately retains a non-compliant short/broken response.
        self.clips_by_duration: dict[int, bytes] = {}
        self.pending_clip: bytes | None = None
        self.pending_duration = 2.04
        self.audio = b""
        self.image_posts = 0
        self.video_bodies: list[dict[str, object]] = []
        self.polls = 0
        self.tts = 0
        self.image_gets = 0
        self.forbid_image = False


@pytest.fixture(scope="module", autouse=True)
def _trusted_certificate(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    """Trust one local certificate on the real urllib opener.

    The full suite calls urlopen before this file, and that caches an opener
    whose trust store does not include the stand-in certificate. Setting
    SSL_CERT_FILE afterwards does not replace that opener, so every request
    fails before the image body is read. The transport, User-Agent, and
    response handling stay the production ones.
    """

    directory = tmp_path_factory.mktemp("xai-cert")
    cert, key = _certificate(directory)
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=str(cert))
    context.set_alpn_protocols(["http/1.1"])
    previous = urllib.request._opener
    urllib.request.install_opener(
        urllib.request.build_opener(urllib.request.HTTPSHandler(context=context))
    )
    try:
        yield cert, key
    finally:
        urllib.request._opener = previous


def _certificate(directory: Path) -> tuple[Path, Path]:
    key = directory / "key.pem"
    cert = directory / "cert.pem"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-days",
            "1",
            "-nodes",
            "-subj",
            "/CN=127.0.0.1",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )
    return cert, key


def _serve(script: _Script, certificate: tuple[Path, Path]) -> tuple[ThreadingHTTPServer, str]:
    cert, key = certificate

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def _read(self) -> bytes:
            length = int(self.headers.get("Content-Length", "0") or "0")
            return self.rfile.read(length) if length else b""

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802
            raw = self._read()
            if self.path == "/v1/images/generations":
                script.image_posts += 1
                if script.mode == "b64":
                    payload = {
                        "data": [
                            {
                                "b64_json": base64.b64encode(script.jpeg).decode("ascii"),
                                "url": None,
                                "revised_prompt": _REVISED,
                                "respect_moderation": True,
                                "mime_type": "image/jpeg",
                            }
                        ]
                    }
                else:
                    payload = {
                        "data": [
                            {
                                "b64_json": None,
                                "url": f"https://{script.host}/imgen/frame.jpeg",
                                "revised_prompt": _REVISED,
                                "respect_moderation": True,
                                "mime_type": "image/jpeg",
                            }
                        ]
                    }
                self._send(200, json.dumps(payload).encode(), "application/json")
                return
            if self.path == "/v1/videos/generations":
                body = json.loads(raw.decode())
                script.video_bodies.append(body)
                if script.clips_by_duration:
                    seconds = body.get("duration")
                    if type(seconds) is not int or seconds not in script.clips_by_duration:
                        self._send(
                            400, b'{"error":"unexpected fixture duration"}', "application/json"
                        )
                        return
                    script.pending_clip = script.clips_by_duration[seconds]
                    script.pending_duration = seconds
                self._send(200, b'{"request_id":"req-e2e"}', "application/json")
                return
            if self.path == "/v1/tts":
                script.tts += 1
                self._send(200, script.audio, "audio/mpeg")
                return
            self._send(404, b"{}", "application/json")

        def do_GET(self) -> None:  # noqa: N802
            agent = self.headers.get("User-Agent", "")
            if self.path.startswith("/imgen/"):
                script.image_gets += 1
                if script.forbid_image or agent.startswith("Python-urllib"):
                    self._send(403, b"forbidden", "text/plain")
                    return
                self._send(200, script.jpeg, "image/jpeg")
                return
            if self.path.startswith("/v1/videos/"):
                script.polls += 1
                if script.polls == 1:
                    self._send(200, b'{"status":"pending"}', "application/json")
                    return
                done = {
                    "status": "done",
                    "video": {
                        "url": f"https://{script.host}/vidgen/clip.mp4",
                        "duration": script.pending_duration,
                    },
                }
                self._send(200, json.dumps(done).encode(), "application/json")
                return
            if self.path.startswith("/vidgen/"):
                if agent.startswith("Python-urllib"):
                    self._send(403, b"forbidden", "text/plain")
                    return
                self._send(
                    200,
                    script.pending_clip if script.pending_clip is not None else script.mp4,
                    "video/mp4",
                )
                return
            self._send(404, b"{}", "application/json")

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    port = httpd.server_address[1]
    script.host = f"127.0.0.1:{port}"
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, script.host


def _real_xai_media(tmp_path: Path, clip_seconds: float = 2.04) -> tuple[bytes, bytes]:
    """The shape of a real SuperGrok run, including the mislabeled voice.

    The clip is h264 yuv420p, 24 fps, 448x672, 2.04s, plus AAC 48 kHz stereo
    and an mjpeg attached picture. The voice is MP3, 24 kHz, mono, 2.616s,
    longer than the original short clip. Positive stand-ins explicitly render the
    requested longer duration; the original short shape remains a negative case.
    The bytes are what matter; the filename is not.
    """

    tools = toolchain()
    directory = tmp_path / "real-xai"
    directory.mkdir()
    clip = directory / "clip.mp4"
    voice = directory / "voice.mp3"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size=448x672:rate=24:duration={clip_seconds}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=48000:duration={clip_seconds}",
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
            str(voice),
        ],
        check=True,
        capture_output=True,
    )
    clip_probe = json.loads(
        subprocess.run(
            [
                str(tools.ffprobe_path),
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(clip),
            ],
            check=True,
            capture_output=True,
        ).stdout
    )
    streams = clip_probe["streams"]
    picture = next(item for item in streams if item.get("codec_name") == "h264")
    assert (picture["width"], picture["height"], picture["pix_fmt"]) == (448, 672, "yuv420p")
    assert picture["avg_frame_rate"] == "24/1"
    audio = next(item for item in streams if item.get("codec_name") == "aac")
    assert audio["sample_rate"] == "48000" and int(audio["channels"]) == 2
    cover = next(item for item in streams if item.get("codec_name") == "mjpeg")
    assert cover["disposition"]["attached_pic"] == 1
    assert abs(float(clip_probe["format"]["duration"]) - clip_seconds) < 0.05
    voice_probe = json.loads(
        subprocess.run(
            [
                str(tools.ffprobe_path),
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(voice),
            ],
            check=True,
            capture_output=True,
        ).stdout
    )
    heard = voice_probe["streams"][0]
    assert heard["codec_name"] == "mp3"
    assert heard["sample_rate"] == "24000" and int(heard["channels"]) == 1
    voice_duration = float(voice_probe["format"]["duration"])
    if clip_seconds == 2.04:
        assert voice_duration > float(clip_probe["format"]["duration"])
    assert abs(voice_duration - 2.616) < 0.05
    return clip.read_bytes(), voice.read_bytes()


def _compliant_media(script: _Script, tmp_path: Path) -> None:
    # This voice really decodes to2.616s. Production asks ceil(2.616+.4+.6)=4,
    # and the HTTPS server must serve that request rather than a fixed2.04s clip.
    script.mp4, script.audio = _real_xai_media(tmp_path, clip_seconds=4)
    script.clips_by_duration = {4: script.mp4}


def _assert_window(result, script: _Script, tmp_path: Path) -> None:
    assert [body["duration"] for body in script.video_bodies] == [4]
    tools = toolchain()
    raw = tmp_path / "raw-decoded.wav"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-v",
            "error",
            "-i",
            str(tmp_path / "real-xai" / "voice.mp3"),
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(raw),
        ],
        check=True,
        capture_output=True,
    )
    with wave.open(str(raw), "rb") as audio:
        body_frames = audio.getnframes()
    assert math.ceil(body_frames / 48000 + 1) == 4
    assert result.voice_path
    with wave.open(result.voice_path, "rb") as audio:
        assert (audio.getframerate(), audio.getsampwidth(), audio.getnchannels()) == (48000, 2, 2)
        data = audio.readframes(audio.getnframes())
    width = 4
    assert not any(data[: 19200 * width])
    assert any(data[19200 * width : (19200 + body_frames) * width])
    tail = data[(19200 + body_frames) * width :]
    assert len(tail) >= 28800 * width and not any(tail)
    assert float(result.duration_seconds) == pytest.approx(4, abs=1 / 24)


def _jpeg(tmp_path: Path) -> bytes:
    png = tmp_path / "pixel.png"
    jpeg = tmp_path / "pixel.jpg"
    png.write_bytes(_PNG)
    subprocess.run(
        [
            str(toolchain().ffmpeg_path),
            "-hide_banner",
            "-nostdin",
            "-y",
            "-i",
            str(png),
            "-frames:v",
            "1",
            str(jpeg),
        ],
        check=True,
        capture_output=True,
    )
    return jpeg.read_bytes()


def _service(monkeypatch, tmp_path: Path, script: _Script):
    repository, project_id = _project(tmp_path)
    log_path = tmp_path / "grok-login.log"
    _allow_live(monkeypatch, log_path)

    def client(transport, *, token, origin="https://api.x.ai", log=None):
        return XaiMediaClient(transport, token=token, origin=f"https://{script.host}", log=log)

    monkeypatch.setattr("aijian_api.story_film.XaiMediaClient", client)
    service = StoryFilmService(repository, toolchain)
    service._sleep = lambda _seconds: None
    return service, project_id, log_path


def _events(log_path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]


def test_url_image_is_saved_and_handed_to_video_tts_and_compose(
    tmp_path, monkeypatch, _trusted_certificate
):
    script = _Script()
    script.jpeg = _jpeg(tmp_path)
    _compliant_media(script, tmp_path)
    httpd, _host = _serve(script, _trusted_certificate)
    try:
        service, project_id, log_path = _service(monkeypatch, tmp_path, script)
        result = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert result.status == "SUCCEEDED", result.message
        assert result.has_video and result.has_audio
        assert result.output_path
        probed = json.loads(
            subprocess.run(
                [
                    str(toolchain().ffprobe_path),
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height",
                    "-of",
                    "json",
                    result.output_path,
                ],
                check=True,
                capture_output=True,
            ).stdout.decode()
        )
        picture = probed["streams"][0]
        assert (picture["width"], picture["height"]) == (448, 672)
        assert result.duration_seconds is not None
        _assert_window(result, script, tmp_path)
        voices = list((tmp_path / "story-films").glob("*-voice.mp3"))
        assert voices and all(path.read_bytes() == script.audio for path in voices)
        assert not list((tmp_path / "story-films").glob("*-voice.wav"))
        saved = list((tmp_path / "story-films").glob("*-key.png")) + list(
            (tmp_path / "story-films").glob("*-key.jpg")
        )
        assert saved and any(path.read_bytes() == script.jpeg for path in saved)
        assert script.video_bodies, "video was not submitted after the image response"
        image = script.video_bodies[0]["image"]
        assert isinstance(image, dict)
        assert image["url"] == f"https://{script.host}/imgen/frame.jpeg"
        assert not str(image["url"]).startswith("/")
        assert "story-films" not in str(image["url"])
        assert script.polls >= 2
        assert script.tts == 1
        text = log_path.read_text(encoding="utf-8")
        assert "subscription-token" not in text
        assert "灯塔夜班" not in text
        assert _REVISED not in text
        names = [item["event"] for item in _events(log_path)]
        # 3JR-B01: the voice is made and measured before the video is asked for, so the video
        # is long enough for the whole line; it is made once.
        assert names[:5] == ["image", "image_saved", "tts", "video_submit", "video_poll"]
        assert names.count("tts") == 1 and "compose" in names
        again = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert again.status == "SUCCEEDED", again.message
        assert "已用上次已生成的画面" in again.message
        assert script.image_posts == 1
        assert len(script.video_bodies) == 1
        assert script.tts == 1
        changed = service.produce(
            project_id,
            _request("grok_subscription", narration="灯塔换了班，雾还没有散。"),
            media_token="subscription-token",
        )
        assert changed.status == "SUCCEEDED", changed.message
        assert "已用上次已生成的画面" not in changed.message
        assert script.image_posts == 2
        assert len(script.video_bodies) == 2
        assert script.tts == 2
        forced = service.produce(
            project_id,
            _request("grok_subscription", regenerate=True),
            media_token="subscription-token",
        )
        assert forced.status == "SUCCEEDED", forced.message
        assert script.image_posts == 3
        assert len(script.video_bodies) == 3
        # 3JR-B01 (9a020d9): the voice is cached by line, voice and delivery. A new version makes
        # a new picture and video but reuses the same line's voice, keeping versions in sync and
        # not spending the subscription twice; a changed line (above) is voiced again.
        assert script.tts == 2
        tasks = TaskQueueReader(tmp_path / "workspace.db").list_project_tasks(project_id)
        films = [item for item in tasks if item.node_type == "story_film"]
        assert len(films) == 4
        assert {item.attempt_status for item in films} == {"SUCCEEDED"}
    finally:
        httpd.shutdown()


def test_b64_json_image_is_a_data_uri_and_tts_returns_audio(
    tmp_path, monkeypatch, _trusted_certificate
):
    script = _Script()
    script.mode = "b64"
    script.jpeg = _jpeg(tmp_path)
    _compliant_media(script, tmp_path)
    httpd, _host = _serve(script, _trusted_certificate)
    try:
        service, project_id, log_path = _service(monkeypatch, tmp_path, script)
        result = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert result.status == "SUCCEEDED", result.message
        _assert_window(result, script, tmp_path)
        assert script.image_gets == 0
        image = script.video_bodies[0]["image"]
        assert isinstance(image, dict)
        assert str(image["url"]).startswith("data:image/jpeg;base64,")
        assert script.tts == 1
        names = [item["event"] for item in _events(log_path)]
        assert "image_saved" in names and "tts" in names and "compose" in names
        assert _REVISED not in log_path.read_text(encoding="utf-8")
    finally:
        httpd.shutdown()


def test_image_cdn_forbidden_still_submits_the_https_url(
    tmp_path, monkeypatch, _trusted_certificate
):
    script = _Script()
    script.forbid_image = True
    script.jpeg = _jpeg(tmp_path)
    _compliant_media(script, tmp_path)
    httpd, _host = _serve(script, _trusted_certificate)
    try:
        service, project_id, log_path = _service(monkeypatch, tmp_path, script)
        result = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert script.video_bodies, result.message
        image = script.video_bodies[0]["image"]
        assert isinstance(image, dict)
        assert image["url"] == f"https://{script.host}/imgen/frame.jpeg"
        logged = _events(log_path)
        assert any(item.get("error_stage") == "image" for item in logged)
        assert any(item.get("error_code") for item in logged)
        assert "灯塔夜班" not in log_path.read_text(encoding="utf-8")
        assert result.status == "SUCCEEDED", result.message
        _assert_window(result, script, tmp_path)
    finally:
        httpd.shutdown()


def test_broken_clip_names_the_ffmpeg_exit_and_retries_without_xai(
    tmp_path, monkeypatch, _trusted_certificate
):
    script = _Script()
    script.jpeg = _jpeg(tmp_path)
    _clip, script.audio = _real_xai_media(tmp_path)
    script.mp4 = b"not-a-video"
    httpd, _host = _serve(script, _trusted_certificate)
    try:
        service, project_id, log_path = _service(monkeypatch, tmp_path, script)
        result = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert result.status == "FAILED"
        assert "画面、视频和配音都已经做好" in result.message
        assert "整理视频" in result.message or "没有读到可以合成的画面" in result.message
        first = [item for item in _events(log_path) if item["event"] == "compose"]
        assert len(first) == 1
        assert first[0]["error_stage"] in {"normalize_video", "probe_video"}
        assert str(first[0]["error_code"]).startswith("exit_")
        again = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert again.status == "FAILED"
        assert "画面、视频和配音都已经做好" in again.message
        compose = [item for item in _events(log_path) if item["event"] == "compose"]
        assert len(compose) == 2
        assert all(str(item["error_code"]).startswith("exit_") for item in compose)
        assert all(item.get("error_stage") for item in compose)
        assert script.image_posts == 1
        assert len(script.video_bodies) == 1
        assert script.tts == 1
        tasks = TaskQueueReader(tmp_path / "workspace.db").list_project_tasks(project_id)
        films = [item for item in tasks if item.node_type == "story_film"]
        assert len(films) == 2
        assert {item.attempt_status for item in films} == {"FAILED"}
    finally:
        httpd.shutdown()


def test_old_short_response_is_rejected_without_cutting_raw_voice_or_repeating_upstream(
    tmp_path,
    monkeypatch,
    _trusted_certificate,
):
    script = _Script()
    script.jpeg = _jpeg(tmp_path)
    script.mp4, script.audio = _real_xai_media(tmp_path)
    # Before B07, the legacy optional tail could shrink and the <=1s hold was
    # enough. Prove that exact original shape remains supported by that policy,
    # while the new mandatory head+tail below correctly refuses the short reply.
    legacy_clip = tmp_path / "legacy-clip.mp4"
    legacy_voice = tmp_path / "legacy-voice.mp3"
    legacy_clip.write_bytes(script.mp4)
    legacy_voice.write_bytes(script.audio)
    tools = toolchain()
    original_frames = _video_frames(tools.ffprobe_path, legacy_clip)
    _, _, legacy_frames, _ = _normalize_film_media(
        tools.ffmpeg_path,
        tools.ffprobe_path,
        legacy_clip,
        legacy_voice,
    )
    assert original_frames == 49 and legacy_frames == 73
    assert legacy_frames - original_frames == 24
    assert legacy_voice.read_bytes() == script.audio
    httpd, _host = _serve(script, _trusted_certificate)
    try:
        service, project_id, log_path = _service(monkeypatch, tmp_path, script)
        for _ in range(2):
            result = service.produce(
                project_id, _request("grok_subscription"), media_token="subscription-token"
            )
            assert result.status == "FAILED"
            assert result.user_message["code"] == "VIDEO_TOO_SHORT"
        assert [body["duration"] for body in script.video_bodies] == [4]
        assert script.tts == 1 and script.image_posts == 1
        assert not script.clips_by_duration  # Intentionally still returns2.04s, not4.
        folder = tmp_path / "story-films"
        assert any(path.read_bytes() == script.audio for path in folder.glob("*-voice.mp3"))
        assert any(path.read_bytes() == script.mp4 for path in folder.glob("*-clip.mp4"))
        assert any(item.get("error_code") == "VIDEO_TOO_SHORT" for item in _events(log_path))
        text = log_path.read_text()
        assert all(value not in text for value in ("subscription-token", "灯塔夜班", _REVISED))
    finally:
        httpd.shutdown()
