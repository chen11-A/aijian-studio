"""xAI media protocol against an injected transport. No network."""

import json

import pytest
from aijian_api.xai_media import (
    EDIT_MODEL,
    IMAGE_GENERATION_PATH,
    TTS_PATH,
    VIDEO_EDIT_PATH,
    VIDEO_EXTEND_PATH,
    VIDEO_GENERATION_PATH,
    VIDEO_MODEL,
    XaiHttpRequest,
    XaiHttpResponse,
    XaiMediaClient,
    XaiMediaError,
)


class RecordingTransport:
    def __init__(self, responses: list[XaiHttpResponse]) -> None:
        self.responses = responses
        self.requests: list[XaiHttpRequest] = []

    def send(self, request: XaiHttpRequest) -> XaiHttpResponse:
        self.requests.append(request)
        return self.responses.pop(0)


def test_image_video_and_speech_follow_documented_routes_without_a_socket():
    token = "test-token-not-a-secret"
    image = {"data": [{"b64_json": "aGVsbG8=", "url": "https://api.x.ai/generated/frame.png"}]}
    video = {"request_id": "req-1"}
    poll = {"status": "done", "video": {"url": "https://vidgen.x.ai/video.mp4", "duration": 2}}
    transport = RecordingTransport(
        [
            XaiHttpResponse(200, json.dumps(image).encode()),
            XaiHttpResponse(200, json.dumps(video).encode()),
            XaiHttpResponse(200, json.dumps(poll).encode()),
            XaiHttpResponse(200, b"mp4-bytes", "video/mp4"),
            XaiHttpResponse(200, b"mp3-bytes", "audio/mpeg"),
        ]
    )
    client = XaiMediaClient(transport, token=token)
    generated = client.generate_image(prompt="雾城灯塔")
    submitted = client.submit_video(prompt="不要回头", image_url=generated.source_url, duration=2)
    polled = client.poll_video(submitted.request_id)
    downloaded = client.download(polled.video_url or "")
    speech = client.synthesize(text="不要回头", language="zh")
    cancel = client.cancel_video(submitted.request_id)

    assert generated.data == b"hello"
    assert downloaded == b"mp4-bytes"
    assert speech == b"mp3-bytes"
    assert cancel.upstream_stopped is False
    assert cancel.billing_stopped is False
    assert len(transport.requests) == 5
    assert transport.requests[0].url.endswith(IMAGE_GENERATION_PATH)
    assert transport.requests[1].url.endswith(VIDEO_GENERATION_PATH)
    assert transport.requests[2].url.endswith("/v1/videos/req-1")
    assert transport.requests[3].url == "https://vidgen.x.ai/video.mp4"
    assert transport.requests[4].url.endswith(TTS_PATH)
    assert transport.requests[0].headers["Authorization"] == f"Bearer {token}"
    assert "Authorization" not in transport.requests[3].headers
    image_body = json.loads(transport.requests[0].body or b"{}")
    assert image_body["model"] == "grok-imagine-image-2.0"
    assert image_body["response_format"] == "url"
    video_body = json.loads(transport.requests[1].body or b"{}")
    assert video_body["image"] == {"url": generated.source_url}
    assert video_body["model"] == "grok-imagine-video-1.5"
    speech_body = json.loads(transport.requests[4].body or b"{}")
    assert speech_body["language"] == "zh"
    assert speech_body["voice_id"] == "eve"


def test_b64_image_is_sent_to_video_as_a_data_uri_and_logged(tmp_path, monkeypatch):
    log_path = tmp_path / "grok-login.log"
    monkeypatch.setenv("AIVORA_GROK_LOGIN_LOG", str(log_path))
    png = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
        "DwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    image = {"data": [{"b64_json": png}]}
    video = {"request_id": "req-b64"}
    pending = {"status": "pending"}
    done = {"status": "done", "video": {"url": "https://vidgen.x.ai/clip.mp4", "duration": 2}}
    transport = RecordingTransport(
        [
            XaiHttpResponse(200, json.dumps(image).encode()),
            XaiHttpResponse(200, json.dumps(video).encode()),
            XaiHttpResponse(200, json.dumps(pending).encode()),
            XaiHttpResponse(200, json.dumps(done).encode()),
            XaiHttpResponse(200, b"mp4", "video/mp4"),
            XaiHttpResponse(200, b"mp3", "audio/mpeg"),
        ]
    )
    client = XaiMediaClient(transport, token="test-token-not-a-secret")
    generated = client.generate_image(prompt="雨夜灯塔")
    assert generated.source_url is None
    assert generated.data.startswith(b"\x89PNG")
    submitted = client.submit_video(prompt="来信", image=generated, duration=2)
    first = client.poll_video(submitted.request_id)
    assert first.status == "pending" and first.video_url is None
    polled = client.poll_video(submitted.request_id)
    assert polled.video_url == "https://vidgen.x.ai/clip.mp4"
    client.download(polled.video_url or "")
    client.synthesize(text="来信", voice_id="ara", language="zh")
    video_body = json.loads(transport.requests[1].body or b"{}")
    assert video_body["image"]["url"].startswith("data:image/png;base64,")
    assert "雨夜灯塔" not in log_path.read_text()
    assert "test-token" not in log_path.read_text()
    events = [json.loads(line)["event"] for line in log_path.read_text().splitlines()]
    assert events == ["image", "video_submit", "video_poll", "video_poll", "tts"]
    logged = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert all(item["httpStatus"] == 200 and item["code"] == "ok" for item in logged)


def test_generation_can_pin_frames_and_mute_audio_without_using_the_edit_route():
    transport = RecordingTransport(
        [XaiHttpResponse(200, json.dumps({"request_id": "req-pin"}).encode())]
    )
    client = XaiMediaClient(transport, token="test-token-not-a-secret")
    client.submit_video(
        prompt="侧身让过",
        image_url="https://api.x.ai/generated/start.png",
        duration=3,
        generate_audio=False,
        resolution="720p",
        reference_images=("https://api.x.ai/generated/face.png",),
        last_frame_url="https://api.x.ai/generated/end.png",
    )
    body = json.loads(transport.requests[0].body or b"{}")
    assert transport.requests[0].url.endswith(VIDEO_GENERATION_PATH)
    assert body["model"] == VIDEO_MODEL
    assert body["generate_audio"] is False
    assert body["resolution"] == "720p"
    assert body["reference_images"] == [{"url": "https://api.x.ai/generated/face.png"}]
    assert body["last_frame"] == {"url": "https://api.x.ai/generated/end.png"}
    plain = RecordingTransport([XaiHttpResponse(200, json.dumps({"request_id": "plain"}).encode())])
    XaiMediaClient(plain, token="test-token-not-a-secret").submit_video(prompt="原样", duration=2)
    assert "generate_audio" not in json.loads(plain.requests[0].body or b"{}")


def test_edits_and_extensions_use_the_older_model_and_reject_1_5():
    transport = RecordingTransport(
        [
            XaiHttpResponse(200, json.dumps({"request_id": "edit-1"}).encode()),
            XaiHttpResponse(200, json.dumps({"request_id": "ext-1"}).encode()),
        ]
    )
    client = XaiMediaClient(transport, token="test-token-not-a-secret")
    edited = client.edit_video(
        prompt="只把铁棍换成木棍，其他不变", video_url="https://vidgen.x.ai/clip.mp4"
    )
    extended = client.extend_video(
        prompt="雨还在下，两人分开",
        video_url="https://vidgen.x.ai/clip.mp4",
        duration=4,
    )
    assert edited.request_id == "edit-1"
    assert extended.request_id == "ext-1"
    assert transport.requests[0].url.endswith(VIDEO_EDIT_PATH)
    assert transport.requests[1].url.endswith(VIDEO_EXTEND_PATH)
    assert json.loads(transport.requests[0].body or b"{}")["model"] == EDIT_MODEL
    assert json.loads(transport.requests[1].body or b"{}")["duration"] == 4
    with pytest.raises(XaiMediaError, match="还不能用现在登录到的成片模型"):
        client.edit_video(
            prompt="不行",
            video_url="https://vidgen.x.ai/clip.mp4",
            model=VIDEO_MODEL,
        )
