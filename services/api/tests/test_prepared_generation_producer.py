"""Real StoryFilm before-send parent adoption; only synthetic transport is used."""

from dataclasses import replace

import pytest
from aijian_api.generation_dispatch_identity import story_reference_identity
from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.prepared_generation_store import (
    PreparedGenerationStore,
    PreparedStage,
    PreparedTarget,
)
from aijian_api.story_film import StoryFilmService, StoryShot
from test_draft_export_runtime import toolchain
from test_story_creation_failure_budget import LostResponse
from test_story_film import _allow_live, _byte_image, _project, _request

ACCOUNT = "a" * 64
BODY = "b" * 64


def original_context(tmp_path):
    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=10)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=1
    )
    request = _request("grok_subscription", shots=(StoryShot("你好。", "原始画面", 3, ""),))
    compiler = StoryFilmService(repo, toolchain)
    compiler._begin_creation(request)
    return repo, project, request, compiler._creation_targets()[0]


def execution(repo, project, recipe, key, *, image=None, runtime_image=None):
    store = PreparedGenerationStore(repo)
    identifier = store.register(
        project,
        account=ACCOUNT,
        execution_key=key,
        targets=(PreparedTarget("target", recipe, 1),),
        stages=(PreparedStage("frame", {"kind": "shot-frame"}, ("target",)),) if image else (),
    )
    if image:
        store.before_image(
            project, identifier, account=ACCOUNT, stage_key="frame", body_sha256=BODY
        )
        store.observed_image(
            project,
            identifier,
            account=ACCOUNT,
            stage_key="frame",
            body_sha256=BODY,
            output_sha256=story_reference_identity(image)["sha256"],
        )
    compiler = StoryFilmService(repo, toolchain)
    compiler._begin_creation(
        _request(
            "grok_subscription",
            shots=(
                StoryShot(
                    "你好。",
                    "原始画面",
                    3,
                    "",
                    still=runtime_image or image or _byte_image("frame"),
                ),
            ),
        )
    )
    runtime_recipe = compiler._creation_targets()[0]
    arm = store.arm_video(
        project,
        identifier,
        account=ACCOUNT,
        target_key="target",
        slot_index=0,
        take_key="queued-take",
        body_sha256=BODY,
        runtime_recipe=runtime_recipe,
        expected_sources=[
            {
                "role": "still",
                "index": 0,
                "source": runtime_image or image or _byte_image("frame"),
                "canonical_path": None,
                **story_reference_identity(runtime_image or image or _byte_image("frame")),
            }
        ],
    )
    return store, identifier, arm


def test_actual_tts_send_adopts_existing_parent_once_and_new_auto_image_does_not_open_bucket(
    tmp_path,
    monkeypatch,
):
    repo, project, original, recipe = original_context(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    image = _byte_image("auto-first")
    store, identifier, arm = execution(repo, project, recipe, "first-execution", image=image)
    actual = replace(original, shots=(replace(original.shots[0], still=image),))
    transport = LostResponse()
    result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        actual,
        media_token="synthetic",
        dispatch_account=ACCOUNT,
        prepared_generation=(arm, BODY),
    )
    assert result.status == "FAILED"
    assert len(transport.requests) == 1
    assert transport.requests[0].method == "POST" and transport.requests[0].url.endswith("/tts")
    with repo._connection() as connection:
        first = connection.execute(
            "SELECT id,input_sha256,status FROM story_creation_failure_attempt"
        ).fetchall()
        assert len(first) == 1 and first[0][2] == "UNKNOWN"
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )
    # A different automatically produced frame must not be treated as another
    # original creative input. No image/tts/video request may enter transport.
    _, _, again = execution(
        repo, project, recipe, "new-execution", runtime_image=_byte_image("different-auto-output")
    )
    newer = replace(
        actual,
        idempotency_key="new-task-key",
        shots=(replace(actual.shots[0], still=_byte_image("different-auto-output")),),
    )
    retried = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        newer,
        media_token="refreshed-synthetic",
        dispatch_account=ACCOUNT,
        prepared_generation=(again, BODY),
    )
    assert retried.status == "FAILED"
    assert retried.user_message["code"] == "CREATION_ATTEMPT_ALREADY_RESERVED"
    assert len(transport.requests) == 1
    store.retire(project, identifier, account=ACCOUNT)
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT status FROM story_creation_failure_attempt").fetchone()[0]
            == "UNKNOWN"
        )


@pytest.mark.parametrize("change", ["body", "retire", "account"])
def test_actual_creation_rejects_stale_arm_before_any_generation(tmp_path, monkeypatch, change):
    repo, project, original, recipe = original_context(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    store, identifier, arm = execution(repo, project, recipe, "one")
    if change == "retire":
        store.retire(project, identifier, account=ACCOUNT)
    transport = LostResponse()
    result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        replace(original, shots=(replace(original.shots[0], still=_byte_image("frame")),)),
        media_token="synthetic",
        dispatch_account="c" * 64 if change == "account" else ACCOUNT,
        prepared_generation=(arm, "d" * 64 if change == "body" else BODY),
    )
    assert result.status == "BLOCKED"
    assert transport.requests == []
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )


def test_arm_then_same_path_new_bytes_rejects_before_any_actual_generation(tmp_path, monkeypatch):
    import base64

    from aijian_api.prepared_generation_sources import reference_snapshot

    repo, project, original, recipe = original_context(tmp_path)
    _allow_live(monkeypatch, tmp_path / "status.log")
    path = tmp_path / "owned-frame.png"
    before = base64.b64decode(_byte_image("old").split(",", 1)[1])
    after = base64.b64decode(_byte_image("new").split(",", 1)[1])
    assert len(before) == len(after) and before != after
    path.write_bytes(before)
    actual = replace(original, shots=(replace(original.shots[0], still=str(path)),))
    compiler = StoryFilmService(repo, toolchain)
    compiler._begin_creation(actual)
    runtime = compiler._creation_targets()[0]
    uri, canonical = reference_snapshot(str(path))
    store = PreparedGenerationStore(repo)
    identifier = store.register(
        project,
        account=ACCOUNT,
        execution_key="pinned-native-intent",
        targets=(PreparedTarget("target", recipe, 1),),
        stages=(),
    )
    arm = store.arm_video(
        project,
        identifier,
        account=ACCOUNT,
        target_key="target",
        slot_index=0,
        take_key="queued",
        body_sha256=BODY,
        runtime_recipe=runtime,
        expected_sources=[
            {
                "role": "still",
                "index": 0,
                "source": str(path),
                "canonical_path": canonical,
                **story_reference_identity(uri),
            }
        ],
    )
    path.write_bytes(after)
    transport = LostResponse()
    result = StoryFilmService(repo, toolchain, transport=transport).produce(
        project,
        actual,
        media_token="synthetic",
        dispatch_account=ACCOUNT,
        prepared_generation=(arm, BODY),
    )
    assert result.status == "BLOCKED"
    assert result.user_message["code"] == "CREATION_INPUT_UNVERIFIABLE"
    assert transport.requests == []
    assert path.read_bytes() == after
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )
