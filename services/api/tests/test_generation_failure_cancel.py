"""Actual cancel at a blocking budget gate is still before video transport entry."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.story_film import StoryFilmService, StoryShot, request_film_cancel
from aijian_api.xai_media import XaiHttpResponse
from test_draft_export_runtime import toolchain
from test_story_film import (
    _allow_live,
    _byte_image,
    _configured_project,
    _media_bytes,
    _request,
    _ScriptedTransport,
)


def test_cancel_during_reservation_wait_never_enters_post_or_consumes_failure_slot(
    tmp_path, monkeypatch
):
    repository, project = _configured_project(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=1, failure_limit=1)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, _voice = _media_bytes(tmp_path)
    transport = _ScriptedTransport(
        [XaiHttpResponse(200, b'{"request_id":"must-not-be-submitted"}')]
    )
    service = StoryFilmService(repository, toolchain, transport=transport)
    held, release = threading.Event(), threading.Event()
    real_reserve = service._failure_store.reserve

    def reserve(*args, **kwargs):
        result = real_reserve(*args, **kwargs)
        held.set()
        assert release.wait(5), "controlled budget gate was not released"
        return result

    monkeypatch.setattr(service._failure_store, "reserve", reserve)
    request = _request(
        "grok_subscription",
        shots=(StoryShot("", "同一静音画面", 3, "", still=_byte_image("same")),),
    )
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(
            service.produce, project, request, media_token="synthetic", dispatch_account="a" * 64
        )
        try:
            assert held.wait(5), "reservation did not enter the controlled gate"
            request_film_cancel(project)
        finally:
            release.set()
        result = pending.result(timeout=5)
    assert result.status == "FAILED"
    assert transport.requests == []
    # A proven pre-transport cancellation is not an UNKNOWN provider submission.
    # The same actual input can still use the one explicitly configured slot.
    next_transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, b'{"request_id":"next-explicit-request"}'),
            XaiHttpResponse(
                200,
                json.dumps(
                    {"status": "done", "video": {"url": "https://vidgen.x.ai/v.mp4"}}
                ).encode(),
            ),
            XaiHttpResponse(200, clip, "video/mp4"),
        ]
    )
    restarted = StoryFilmService(repository, toolchain, transport=next_transport)
    restarted._sleep = lambda _: None
    actual = restarted.produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="synthetic",
        dispatch_account="a" * 64,
    )
    assert actual.status == "SUCCEEDED", actual.message
    assert (
        len([row for row in next_transport.requests if row.url.endswith("/videos/generations")])
        == 1
    )


def test_pretransport_release_cannot_erase_an_unknown_attempt(tmp_path):
    import pytest
    from aijian_api.generation_failure_store import GenerationFailureError

    repository, project = _configured_project(tmp_path)
    store = GenerationFailureStore(repository)
    store.configure(project, expected_revision=1, failure_limit=1)
    reservation = store.reserve(project, input_sha256="a" * 64, attempt_key="submitted")
    store.settle(project, reservation, "UNKNOWN")
    with pytest.raises(GenerationFailureError, match="ATTEMPT_NOT_UNSUBMITTED"):
        store.discard_before_transport(project, reservation)
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        store.reserve(project, input_sha256="a" * 64, attempt_key="new-key")
