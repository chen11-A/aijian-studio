"""Story film against a local HTTPS stand-in for the documented xAI shapes.

The stand-in is a real HTTP server. The client uses the urllib transport, so a
download that dies inside that transport fails the film before any video POST.
"""

from __future__ import annotations

import base64
import json
import ssl
import subprocess
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from aijian_api.story_film import StoryFilmService
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
                script.video_bodies.append(json.loads(raw.decode()))
                self._send(200, b'{"request_id":"req-e2e"}', "application/json")
                return
            if self.path == "/v1/tts":
                script.tts += 1
                self._send(200, script.audio, "audio/wav")
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
                        "duration": 2,
                    },
                }
                self._send(200, json.dumps(done).encode(), "application/json")
                return
            if self.path.startswith("/vidgen/"):
                if agent.startswith("Python-urllib"):
                    self._send(403, b"forbidden", "text/plain")
                    return
                self._send(200, script.mp4, "video/mp4")
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


def _real_xai_media(tmp_path: Path) -> tuple[bytes, bytes]:
    """Portrait h264 + AAC + mjpeg cover, and a shorter mono wav at another rate.

    This is the shape that came back from a real SuperGrok run: 448x672,
    about 2.04s, an attached picture, and a voice file that does not match
    the clip length or sample rate.
    """

    tools = toolchain()
    directory = tmp_path / "real-xai"
    directory.mkdir()
    clip = directory / "clip.mp4"
    voice = directory / "voice.wav"
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
            "sine=frequency=330:sample_rate=24000:duration=2.0",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(voice),
        ],
        check=True,
        capture_output=True,
    )
    return clip.read_bytes(), voice.read_bytes()


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
    script.mp4, script.audio = _real_xai_media(tmp_path)
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
        assert names[:5] == ["image", "image_saved", "video_submit", "video_poll", "video_poll"]
        assert "tts" in names and "compose" in names
        again = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert again.status == "SUCCEEDED", again.message
        assert script.image_posts == 1
        assert len(script.video_bodies) == 1
        assert script.tts == 1
        tasks = TaskQueueReader(tmp_path / "workspace.db").list_project_tasks(project_id)
        films = [item for item in tasks if item.node_type == "story_film"]
        assert len(films) == 2
        assert {item.attempt_status for item in films} == {"SUCCEEDED"}
    finally:
        httpd.shutdown()


def test_b64_json_image_is_a_data_uri_and_tts_returns_audio(
    tmp_path, monkeypatch, _trusted_certificate
):
    script = _Script()
    script.mode = "b64"
    script.jpeg = _jpeg(tmp_path)
    script.mp4, script.audio = _real_xai_media(tmp_path)
    httpd, _host = _serve(script, _trusted_certificate)
    try:
        service, project_id, log_path = _service(monkeypatch, tmp_path, script)
        result = service.produce(
            project_id, _request("grok_subscription"), media_token="subscription-token"
        )
        assert result.status == "SUCCEEDED", result.message
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
    script.mp4, script.audio = _real_xai_media(tmp_path)
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
