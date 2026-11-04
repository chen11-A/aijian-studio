"""Correct-behavior regressions for referenced first frames; transports are injected."""

import base64
import json

import pytest
from aijian_api.grok_status_log import append_grok_status
from aijian_api.story_film import (
    StoryDialogue,
    StoryFilmService,
    StoryShot,
    prepared_reference_image,
)
from aijian_api.story_film_routes import StoryShotBody, _data
from aijian_api.xai_media import XaiHttpResponse, XaiMediaClient, XaiMediaError
from test_draft_export_runtime import toolchain
from test_story_film import (
    _PNG,
    _allow_live,
    _media_bytes,
    _project,
    _request,
    _ScriptedTransport,
)


def test_image_edit_request_keeps_https_and_data_and_omits_video_declarations(
    tmp_path, monkeypatch
):
    log = tmp_path / "agents.log"
    monkeypatch.setenv("AIVORA_GROK_LOGIN_LOG", str(log))
    refs = (
        "https://example.invalid/face.png",
        "data:image/png;base64," + base64.b64encode(_PNG).decode(),
    )
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(
                200, json.dumps({"data": [{"b64_json": base64.b64encode(_PNG).decode()}]}).encode()
            )
        ]
    )
    client = XaiMediaClient(transport, token="synthetic-secret")
    image = client.generate_image(
        prompt="<IMAGE_1> 是人物定妆照。雨夜书店。", reference_images=refs
    )
    assert image.data == _PNG
    request = transport.requests[0]
    assert request.url.endswith("/images/edits")
    body = json.loads(request.body)
    assert body["images"] == [{"type": "image_url", "url": url} for url in refs]
    assert body["prompt"] == "雨夜书店。"
    logged = log.read_text()
    assert all(
        value not in logged
        for value in ["synthetic-secret", "face.png", "雨夜书店", "定妆照", "base64"]
    )
    metadata = json.loads(logged)
    assert metadata["referenceImageCount"] == 2
    assert metadata["requestBytes"] > 0 and metadata["responseBytes"] > 0
    assert metadata["durationMs"] >= 0
    assert "debug" not in metadata
    with pytest.raises(XaiMediaError, match="最多使用 5"):
        client.generate_image(
            prompt="雨夜",
            reference_images=tuple(f"https://example.invalid/{i}.png" for i in range(6)),
        )
    with pytest.raises(XaiMediaError, match="无法读取"):
        client.generate_image(prompt="雨夜", reference_images=("http://example.invalid/face.png",))
    assert len(transport.requests) == 1


def test_debug_requires_explicit_opt_in_and_still_logs_only_metadata(tmp_path, monkeypatch):
    path = tmp_path / "agents.log"
    monkeypatch.setenv("AIVORA_GROK_LOGIN_LOG", str(path))
    monkeypatch.delenv("AIVORA_AGENT_DEBUG", raising=False)
    append_grok_status("image", reference_image_count=3)
    monkeypatch.setenv("AIVORA_AGENT_DEBUG", "1")
    append_grok_status("image", reference_image_count=3)
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert "debug" not in rows[0]
    assert rows[1]["debug"] is True
    assert set(rows[1]) <= {
        "t",
        "event",
        "referenceImageCount",
        "requestBytes",
        "responseBytes",
        "durationMs",
        "debug",
    }


@pytest.mark.parametrize("remote_still", [False, True])
def test_service_autoframe_uses_five_refs_and_video_keeps_thirteen(
    tmp_path, monkeypatch, remote_still
):
    repository, project_id = _project(tmp_path)
    _allow_live(monkeypatch, tmp_path / "agents.log")
    clip, speech = _media_bytes(tmp_path)
    portrait = tmp_path / "portrait.png"
    portrait.write_bytes(_PNG)
    refs = (str(portrait), *(f"https://example.invalid/face-{index}.png" for index in range(12)))
    responses = [
        XaiHttpResponse(200, json.dumps({"request_id": "ref-video"}).encode()),
        XaiHttpResponse(
            200,
            json.dumps(
                {"status": "done", "video": {"url": "https://example.invalid/result.mp4"}}
            ).encode(),
        ),
        XaiHttpResponse(200, clip, "video/mp4"),
        XaiHttpResponse(200, speech, "audio/wav"),
    ]
    if not remote_still:
        responses.insert(
            0,
            XaiHttpResponse(
                200, json.dumps({"data": [{"b64_json": base64.b64encode(_PNG).decode()}]}).encode()
            ),
        )
    transport = _ScriptedTransport(responses)
    service = StoryFilmService(repository, toolchain, transport=transport)
    service._sleep = lambda _: None
    shot = StoryShot(
        "台词。",
        "<IMAGE_1> 是人物定妆照。雨夜书店。",
        2,
        "台词。",
        still="https://example.invalid/start.png" if remote_still else "",
        references=refs,
    )
    result = service.produce(
        project_id, _request(provider="grok_subscription", shots=(shot,)), media_token="synthetic"
    )
    assert result.status == "SUCCEEDED", result.message
    expected_refs = ("data:image/png;base64," + base64.b64encode(_PNG).decode(), *refs[1:])
    image_requests = [request for request in transport.requests if "/images/" in request.url]
    if remote_still:
        assert image_requests == []
    else:
        assert image_requests[0].url.endswith("/images/edits")
        image_body = json.loads(image_requests[0].body)
        assert image_body["images"] == [
            {"type": "image_url", "url": url} for url in expected_refs[:5]
        ]
        assert "<IMAGE_" not in image_body["prompt"]
        assert "是人物定妆照" not in image_body["prompt"]
    video_request = next(
        request for request in transport.requests if request.url.endswith("/videos/generations")
    )
    video = json.loads(video_request.body)
    assert video["reference_images"] == [{"url": url} for url in expected_refs]
    assert video["image"]["url"] == (
        "https://example.invalid/start.png"
        if remote_still
        else "data:image/png;base64," + base64.b64encode(_PNG).decode()
    )


def test_prepared_reference_formats_keep_remote_images(tmp_path):
    remote = prepared_reference_image("https://example.invalid/face.png")
    assert remote is not None and remote.source_url == "https://example.invalid/face.png"
    assert prepared_reference_image("data:image/png;base64,!") is None
    assert prepared_reference_image("data:image/png;base64,a") is None
    picture = tmp_path / "face.png"
    picture.write_bytes(_PNG)
    local = prepared_reference_image(str(picture))
    assert local is not None and local.data == _PNG


def test_multiple_speakers_stop_before_billing_without_losing_lines_or_subtitles(tmp_path):
    repository, project_id = _project(tmp_path)
    transport = _ScriptedTransport([])
    service = StoryFilmService(repository, toolchain, transport=transport)
    lines = (StoryDialogue("甲", "第一句。"), StoryDialogue("乙", "第二句。"))
    shot = StoryShot("第一句。第二句。", "书店", 3, "第一句。第二句。", lines=lines)
    result = service.produce(
        project_id, _request(provider="grok_subscription", shots=(shot,)), media_token="synthetic"
    )
    assert result.status == "BLOCKED"
    assert _data(result).user_message["code"] == "MULTI_VOICE_REQUIRED"
    assert shot.lines == lines and shot.subtitle == "第一句。第二句。"
    assert transport.requests == []
    with repository._connection() as connection:
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0] == 0
    parsed = StoryShotBody(
        narration=shot.narration,
        prompt=shot.prompt,
        lines=[{"speaker": line.speaker, "text": line.text} for line in lines],
    )
    assert [line.text for line in parsed.lines] == ["第一句。", "第二句。"]
