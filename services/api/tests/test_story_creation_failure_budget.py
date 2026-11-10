"""Parent creation identity and actual first POST gates; no external provider calls."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

import pytest
from aijian_api.generation_dispatch_identity import story_creation_input_identity
from aijian_api.generation_failure_store import GenerationFailureError, GenerationFailureStore
from aijian_api.repository import StudioRepository
from aijian_api.story_film import StoryFilmService, StoryShot
from aijian_api.xai_media import XaiMediaClient
from prepared_generation_test_schema import (
    PREPARED_TABLES,
    assert_prepared_tables_empty,
    remove_empty_prepared_tables,
)
from test_draft_export_runtime import toolchain
from test_story_film import _allow_live, _byte_image, _project, _request

ACCOUNT = "a" * 64


class LostResponse:
    def __init__(self):
        self.requests = []

    def send(self, request):
        self.requests.append(request)
        raise OSError("synthetic response unavailable")


def configured(tmp_path, limit=1):
    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=10)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=limit
    )
    return repo, project


def identity(service, request, account=ACCOUNT):
    service._creation_request = request
    return story_creation_input_identity(account, service._creation_targets())


def test_parent_identity_uses_original_ordered_actual_recipe_not_key_refresh_or_outputs(tmp_path):
    repo, _project_id = _project(tmp_path)
    service = StoryFilmService(repo, toolchain)
    first = StoryShot("你好。", "画面一", 3, "subtitle", still=_byte_image("one"))
    second = StoryShot("再见。", "画面二", 4, "subtitle", still=_byte_image("two"))
    request = _request("grok_subscription", shots=(first, second))
    original = identity(service, request)
    assert original == identity(
        service,
        replace(
            request,
            idempotency_key="new-task",
            connection_revision="refreshed",
            regenerate=True,
            confirmed=False,
            currency="CNY",
            amount_micro=123,
        ),
    )
    assert original != identity(service, replace(request, shots=(second, first)))
    assert original != identity(
        service, replace(request, shots=(replace(first, still=_byte_image("changed")), second))
    )
    assert original != identity(
        service, replace(request, shots=(replace(first, delivery="语速慢"), second))
    )
    assert original != identity(service, replace(request, aspect_ratio="16:9"))
    assert original != identity(service, replace(request, video_model="other"))
    # A supplied first frame skips image generation: its unused image model
    # must not manufacture a new parent bucket for identical video/TTS inputs.
    assert original == identity(service, replace(request, image_model="unused-model"))
    assert original != identity(service, request, "b" * 64)
    # No generated first-frame bytes or output/cache paths enter this original recipe.
    assert "idempotency" not in str(service._creation_targets())


def test_unconfigured_parent_blocks_before_image_tts_video_and_never_uses_video_allowance(
    tmp_path, monkeypatch
):
    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=10)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transport = LostResponse()
    result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project, _request("grok_subscription"), media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert result.user_message["code"] == "CREATION_UNCONFIGURED"
    assert transport.requests == []
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )


def test_real_unknown_image_post_holds_parent_across_new_key_restart_token_refresh(
    tmp_path, monkeypatch
):
    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transport = LostResponse()
    request = _request("grok_subscription")
    first = StoryFilmService(repo, toolchain, transport=transport).produce(
        project, request, media_token="first-synthetic", dispatch_account=ACCOUNT
    )
    assert first.status == "FAILED"
    assert len(transport.requests) == 1
    assert transport.requests[0].method == "POST"
    assert "/images/" in transport.requests[0].url
    restarted = StoryFilmService(
        StudioRepository(repo.database_path), toolchain, transport=transport
    )
    second = restarted.produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}", connection_revision="refresh"),
        media_token="new-synthetic",
        dispatch_account=ACCOUNT,
    )
    assert second.user_message["code"] == "CREATION_INPUT_FAILURE_LIMIT"
    assert len(transport.requests) == 1
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchall()[0][0]
            == "UNKNOWN"
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )
    # An actual creative edit is a different recipe, not a new key or random generated image.
    changed = restarted.produce(
        project,
        replace(
            request, visual_prompt="different picture", idempotency_key=f"story-film:v1:{uuid4()}"
        ),
        media_token="new-synthetic",
        dispatch_account=ACCOUNT,
    )
    assert changed.status == "FAILED"
    assert len(transport.requests) == 2


def test_actual_send_body_must_match_original_recipe_at_zero_post(tmp_path, monkeypatch):
    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transport = LostResponse()
    real = XaiMediaClient.generate_image

    def changed(self, **kwargs):
        return real(self, **{**kwargs, "prompt": "unexpected actual provider prompt"})

    monkeypatch.setattr(XaiMediaClient, "generate_image", changed)
    result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project, _request("grok_subscription"), media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert result.user_message["code"] == "CREATION_INPUT_UNVERIFIABLE"
    assert transport.requests == []
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )


def test_parent_store_atomic_concurrency_no_default_and_no_revision_reset(tmp_path):
    repo, project = configured(tmp_path)
    store = GenerationFailureStore(repo, scope="story_creation")

    def reserve(number):
        try:
            return store.reserve(project, input_sha256="f" * 64, attempt_key=str(number))
        except GenerationFailureError as error:
            assert str(error) == "INPUT_FAILURE_LIMIT"
            return None

    with ThreadPoolExecutor(max_workers=4) as executor:
        attempts = [row for row in executor.map(reserve, range(8)) if row]
    assert len(attempts) == 1
    store.settle(project, attempts[0], "UNKNOWN")
    store.configure(project, expected_revision=1, failure_limit=2)
    store.configure(project, expected_revision=2, failure_limit=1)
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        store.reserve(project, input_sha256="f" * 64, attempt_key="again")
    # The old video scope has a separate explicit allowance and untouched ledger.
    assert GenerationFailureStore(repo).reserve(project, input_sha256="f" * 64, attempt_key="video")


def test_all_real_outputs_release_parent_before_later_local_assembly_failure(tmp_path, monkeypatch):
    import json

    from test_generation_failure_dispatch import scripted
    from test_story_film import _media_bytes

    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, voice = _media_bytes(tmp_path)
    transport = scripted(clip, voice)
    service = StoryFilmService(repo, toolchain, transport=transport)
    service._sleep = lambda _: None

    def local_failure(*_args, **_kwargs):
        raise OSError("synthetic local assembly failure")

    monkeypatch.setattr(service, "_assemble_and_export", local_failure)
    request = _request("grok_subscription")
    result = service.produce(project, request, media_token="synthetic", dispatch_account=ACCOUNT)
    assert result.status == "FAILED"
    assert [
        json.loads(row.body)["voice_id"] for row in transport.requests if row.url.endswith("/tts")
    ] == ["eve"]
    assert len([row for row in transport.requests if row.method == "POST"]) == 3
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchone()[0]
            == "SUCCEEDED"
        )
        assert (
            connection.execute("SELECT status FROM generation_failure_attempt").fetchone()[0]
            == "SUCCEEDED"
        )
    # The raw bundle was kept. Both now-zero allowances must still permit cache reuse.
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=1, failure_limit=0
    )
    GenerationFailureStore(repo).configure(project, expected_revision=1, failure_limit=0)
    before = len(transport.requests)
    cached = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="synthetic",
    )
    assert cached.status == "SUCCEEDED", cached.message
    assert len(transport.requests) == before


def test_two_target_parent_keeps_hold_when_later_actual_image_is_unknown(tmp_path, monkeypatch):
    from aijian_api.xai_media import XaiHttpResponse
    from test_story_film import _media_bytes, _ScriptedTransport

    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    clip, voice = _media_bytes(tmp_path)
    # First explicit still needs TTS/video; the second genuinely enters its image POST.
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, voice, "audio/wav"),
            XaiHttpResponse(200, b'{"request_id":"first"}'),
            XaiHttpResponse(
                200, b'{"status":"done","video":{"url":"https://vidgen.x.ai/first.mp4"}}'
            ),
            XaiHttpResponse(200, clip, "video/mp4"),
            OSError("second image response unknown"),
        ]
    )
    service = StoryFilmService(repo, toolchain, transport=transport)
    service._sleep = lambda _: None
    request = _request(
        "grok_subscription",
        shots=(
            StoryShot("你好。", "first", 3, "", still=_byte_image("first")),
            StoryShot("再见。", "second", 3, ""),
        ),
    )
    result = service.produce(project, request, media_token="synthetic", dispatch_account=ACCOUNT)
    assert result.status == "FAILED"
    assert any(row.method == "POST" and "/images/" in row.url for row in transport.requests)
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchone()[0]
            == "UNKNOWN"
        )
        assert (
            connection.execute("SELECT status FROM generation_failure_attempt").fetchone()[0]
            == "SUCCEEDED"
        )
    before = len(transport.requests)
    retried = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="refreshed",
        dispatch_account=ACCOUNT,
    )
    assert retried.user_message["code"] == "CREATION_INPUT_FAILURE_LIMIT"
    assert len(transport.requests) == before


def test_new_generated_image_cannot_reset_original_parent_after_unknown_tts(tmp_path, monkeypatch):
    import json

    from aijian_api.xai_media import XaiHttpResponse
    from test_story_film import _IMAGE, _ScriptedTransport

    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transport = _ScriptedTransport(
        [XaiHttpResponse(200, json.dumps(_IMAGE).encode()), OSError("tts response unknown")]
    )
    request = _request("grok_subscription")
    first = StoryFilmService(repo, toolchain, transport=transport).produce(
        project, request, media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert first.status == "FAILED"
    assert len(transport.requests) == 2
    assert transport.requests[-1].url.endswith("/tts")
    second = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        replace(request, regenerate=True, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="refreshed",
        dispatch_account=ACCOUNT,
    )
    assert second.user_message["code"] == "CREATION_INPUT_FAILURE_LIMIT"
    assert len(transport.requests) == 2


def test_cancel_while_parent_reserve_waits_proves_zero_post_and_releases_only_that_hold(
    tmp_path, monkeypatch
):
    from threading import Event

    from aijian_api.story_film import request_film_cancel

    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    transport = LostResponse()
    service = StoryFilmService(repo, toolchain, transport=transport)
    held, release = Event(), Event()
    reserve = service._creation_store.reserve

    def waiting(*args, **kwargs):
        result = reserve(*args, **kwargs)
        held.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(service._creation_store, "reserve", waiting)
    request = _request("grok_subscription")
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(
            service.produce, project, request, media_token="synthetic", dispatch_account=ACCOUNT
        )
        try:
            assert held.wait(5)
            request_film_cancel(project)
        finally:
            release.set()
        assert pending.result(timeout=5).status == "FAILED"
    assert transport.requests == []
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )
    # This is a new explicit task, not an automatic retry by cancellation handling.
    next_result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        replace(request, idempotency_key=f"story-film:v1:{uuid4()}"),
        media_token="synthetic",
        dispatch_account=ACCOUNT,
    )
    assert next_result.status == "FAILED"
    assert len(transport.requests) == 1


@pytest.mark.parametrize("change", ["within-cap-seconds", "generated-frame-bytes"])
def test_video_body_binds_this_actual_prepared_frame_and_speech_adaptive_seconds(
    tmp_path, monkeypatch, change
):
    import json

    from aijian_api.xai_media import XaiHttpResponse, XaiImage
    from test_story_film import _IMAGE, _media_bytes, _ScriptedTransport

    repo, project = configured(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    _clip, voice = _media_bytes(tmp_path)
    transport = _ScriptedTransport(
        [
            XaiHttpResponse(200, json.dumps(_IMAGE).encode()),
            XaiHttpResponse(200, voice, "audio/wav"),
        ]
    )
    real = XaiMediaClient.submit_video

    def changed(self, **kwargs):
        if change == "within-cap-seconds":
            kwargs["duration"] = kwargs["duration"] + 1
            assert kwargs["duration"] <= 15
        else:
            original = kwargs["image"]
            assert isinstance(original, XaiImage)
            kwargs["image"] = replace(original, data=original.data + b"not-the-generated-frame")
        return real(self, **kwargs)

    monkeypatch.setattr(XaiMediaClient, "submit_video", changed)
    result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project, _request("grok_subscription"), media_token="synthetic", dispatch_account=ACCOUNT
    )
    assert result.user_message["code"] == "CREATION_INPUT_UNVERIFIABLE"
    assert len(transport.requests) == 2
    assert not any("/videos/" in row.url for row in transport.requests)
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchone()[0]
            == "UNKNOWN"
        )


def test_additive_53_preserves_all_52_sql_rows_and_creates_no_allowance(tmp_path):
    import sqlite3

    from aijian_api.repository import SCHEMA_VERSION
    from aijian_api.video_recovery_store import VideoRecoveryStore

    repo, project = _project(tmp_path)
    video = GenerationFailureStore(repo)
    video.configure(project, expected_revision=0, failure_limit=3)
    attempt = video.reserve(project, input_sha256="b" * 64, attempt_key="existing-video")
    VideoRecoveryStore(repo).attach(project, attempt, ACCOUNT, "actual-original-request")
    video.settle(project, attempt, "UNKNOWN")
    with sqlite3.connect(repo.database_path) as connection:
        remove_empty_prepared_tables(connection)
        connection.execute("DROP TABLE story_creation_failure_attempt")
        connection.execute("DROP TABLE story_creation_failure_policy")
        connection.execute("PRAGMA user_version=52")
        before = connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
        ).fetchall()
        video_before = connection.execute("SELECT * FROM generation_failure_attempt").fetchall()
        recovery_before = connection.execute("SELECT * FROM generation_video_recovery").fetchall()
    reopened = StudioRepository(repo.database_path)
    with sqlite3.connect(reopened.database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 55
        assert_prepared_tables_empty(connection)
        after = connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master "
            "WHERE tbl_name NOT IN ('story_creation_failure_policy', "
            "'story_creation_failure_attempt') ORDER BY type,name"
        ).fetchall()
        assert [row for row in after if row[2] not in PREPARED_TABLES] == before
        assert (
            connection.execute("SELECT * FROM generation_failure_attempt").fetchall()
            == video_before
        )
        assert (
            connection.execute("SELECT * FROM generation_video_recovery").fetchall()
            == recovery_before
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_policy").fetchone()[0]
            == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )
    assert GenerationFailureStore(reopened).policy(project).failure_limit == 3
    assert GenerationFailureStore(reopened, scope="story_creation").policy(project) is None
