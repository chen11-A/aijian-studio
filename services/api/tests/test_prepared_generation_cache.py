"""Per-slot exact immutable cache choices; real SQLite, signed routes and local media."""

import hashlib
import json
from copy import deepcopy

import pytest
from aijian_api.generation_failure_store import GenerationFailureError
from aijian_api.prepared_generation_routes import (
    RegisterPreparedExecution,
    original_prepared_recipes,
)
from aijian_api.prepared_generation_store import PreparedGenerationStore
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.story_creation_cache import StoryCreationCache
from aijian_api.story_film import StoryFilmService
from test_draft_export_runtime import fixture, toolchain
from test_prepared_generation_rejections import assert_no_attempt
from test_prepared_generation_routes import ACCOUNT, post
from test_story_film import _allow_live
from test_story_speech_window import clip, pcm

PREFIX = "prepared-generation-executions"


def app_for(repo):
    from types import SimpleNamespace

    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient
    from test_story_film import HOST, TOKEN

    return TestClient(
        create_app(
            repository=repo,
            sidecar_security=SidecarSecurity(TOKEN, HOST),
            local_media_toolchain=SimpleNamespace(discover=toolchain),
        ),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 12345),
    )


@pytest.fixture
def actual_cache(tmp_path):
    repo, project, *_ = fixture(tmp_path)
    image = tmp_path / "owned-synthetic.png"
    image_bytes = image.read_bytes()
    body = {
        "provider": "grok_subscription",
        "confirmed": False,
        "scene_label": "固定原始创作",
        "narration": "你好。",
        "voice_id": "eve",
        "shots": [
            {
                "narration": "你好。",
                "prompt": "固定画面",
                "duration_seconds": 3,
                "still": str(image),
            }
        ],
    }
    registration = {
        "key": "native-cache-execution",
        "targets": [
            {
                "key": "one",
                "versions": 3,
                "body": body,
                "sources": [
                    {"source": str(image), "sha256": hashlib.sha256(image_bytes).hexdigest()}
                ],
            }
        ],
        "stages": [
            {
                "key": "frame",
                "kind": "shot-frame",
                "target_id": "one",
                "origin": {"prompt": "actual creation", "references": []},
                "target_keys": ["one"],
            }
        ],
    }
    recipe = original_prepared_recipes(
        repo, toolchain, RegisterPreparedExecution.model_validate(registration)
    )[0].recipe
    cache = StoryCreationCache(tmp_path / "story-films", project, recipe, repo.database_path)
    video = clip(tmp_path / "actual-provider.mp4", 3)
    voice = pcm(1)
    cache.put_bundle(
        image_bytes,
        video,
        voice,
        runtime_recipe={
            **recipe,
            "actual_video": {"image": recipe["prepared_image"], "seconds": 3},
        },
    )
    return repo, project, registration, cache, (image_bytes, video, voice)


def prepared(client, project, registration):
    reply = post(client, project, PREFIX, registration)
    assert reply.status_code == 200, reply.text
    execution = reply.json()["execution_id"]
    reply = post(
        client, project, f"{PREFIX}/{execution}/cache-preparations", {"registration": registration}
    )
    return execution, reply


def arm(client, project, execution, body, *, slot=0, take="queued-new"):
    wire = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    image = body["shots"][0]["still"]
    from pathlib import Path

    from aijian_api.generation_dispatch_identity import story_reference_identity
    from aijian_api.prepared_generation_sources import reference_snapshot

    uri, canonical = reference_snapshot(image)
    assert canonical == str(Path(image).resolve())
    return post(
        client,
        project,
        f"{PREFIX}/{execution}/video-arm",
        {
            "target_key": "one",
            "slot_index": slot,
            "take_key": take,
            "wire_body": wire,
            "body_sha256": hashlib.sha256(wire.encode()).hexdigest(),
            "sources": [
                {
                    "role": "still",
                    "index": 0,
                    "source": image,
                    "canonical_path": canonical,
                    **story_reference_identity(uri),
                }
            ],
        },
    )


def test_real_signed_mixed_slots_freeze_cache_zero_and_fresh_later_slots(actual_cache):
    repo, project, registration, cache, bundle = actual_cache
    with app_for(repo) as client:
        execution, reply = prepared(client, project, registration)
        assert reply.status_code == 200, reply.text
        facts = reply.json()["items"]
        assert [row["preparation"] for row in facts] == [
            "STORYFILM_CACHE",
            "CLIENT_IMAGES",
            "CLIENT_IMAGES",
        ]
        assert facts[1]["cache"] is None and facts[2]["cache"] is None
        frozen = PreparedGenerationStore(repo).preparations(project, execution, account=ACCOUNT)
        assert frozen[0].request == facts[0]["cache"]["request"]
        # Later provider output changes mutable record/bundle but not the accepted snapshot.
        cache.put_bundle(
            bundle[0],
            bundle[1],
            pcm(0.5),
            runtime_recipe={
                **facts[0]["cache"]["runtime_recipe"],
            },
        )
        again = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
        )
        assert again.json() == reply.json()
        assert cache.read_snapshot(frozen[0].snapshot) == bundle
        assert len(frozen[0].sources) == 1
    assert_no_attempt(repo)


def test_cache_only_actual_storyfilm_consumes_saved_video_without_provider_or_policy(
    actual_cache,
    tmp_path,
    monkeypatch,
):
    repo, project, registration, _, _ = actual_cache
    _allow_live(monkeypatch, tmp_path / "status.log")
    calls = []

    def no_provider(*args):
        calls.append(True)
        raise AssertionError("cache must not dispatch")

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=no_provider)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200
        body = observed.json()["items"][0]["cache"]["request"]
        armed = arm(client, project, execution, body)
        assert armed.status_code == 200, armed.text
        result = post(client, project, "story-film", body, arm=armed.json()["arm_id"])
        assert result.status_code == 200, result.text
        assert result.json()["data"]["status"] == "SUCCEEDED", result.json()
    assert calls == []
    assert_no_attempt(repo)


@pytest.mark.parametrize("change", ["missing", "same-size", "symlink"])
def test_late_cache_product_loss_never_falls_back_to_new_post(actual_cache, change):
    repo, project, registration, cache, _ = actual_cache
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200
        frozen = PreparedGenerationStore(repo).preparations(project, execution, account=ACCOUNT)[0]
        part = frozen.snapshot["parts"]["video"]
        path = cache.directory / f"video-{part['sha256']}.bin"
        original = path.read_bytes()
        if change == "same-size":
            path.write_bytes(bytes(len(original)))
        else:
            path.unlink()
            if change == "symlink":
                outside = cache.directory.parent / "not-owned-video"
                outside.write_bytes(original)
                try:
                    path.symlink_to(outside)
                except OSError:
                    pytest.skip("host does not allow a symbolic link")
        reply = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
        )
        assert reply.status_code == 409 and reply.json()["detail"] == "INPUT_UNVERIFIABLE"
    assert_no_attempt(repo)


@pytest.mark.parametrize("change", ["body", "key", "regenerate", "source"])
def test_preparation_cannot_rebind_original_intent_or_first_slot(actual_cache, change):
    repo, project, registration, _, _ = actual_cache
    with app_for(repo) as client:
        registered = post(client, project, PREFIX, registration)
        execution = registered.json()["execution_id"]
        altered = deepcopy(registration)
        if change == "body":
            altered["targets"][0]["body"]["shots"][0]["prompt"] = "用户改稿"
        elif change == "key":
            altered["key"] = "another-execution"
        elif change == "regenerate":
            altered["targets"][0]["first_regenerate"] = True
        else:
            altered["targets"][0]["sources"][0]["sha256"] = "f" * 64
        reply = post(
            client, project, f"{PREFIX}/{execution}/cache-preparations", {"registration": altered}
        )
        assert reply.status_code == 409 and reply.json()["detail"] == "INPUT_UNVERIFIABLE"
        assert (
            PreparedGenerationStore(repo).preparations(project, execution, account=ACCOUNT) is None
        )
    assert_no_attempt(repo)


def test_fresh_later_slot_cannot_arm_cache_body_or_claim_cached_slot(actual_cache):
    repo, project, registration, _, _ = actual_cache
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        body = observed.json()["items"][0]["cache"]["request"]
        rejected = arm(client, project, execution, body, slot=1)
        assert rejected.status_code == 409 and rejected.json()["detail"] == "INPUT_UNVERIFIABLE"
        accepted = arm(client, project, execution, body)
        assert accepted.status_code == 200
        with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
            PreparedGenerationStore(repo).claim_video(
                project,
                account=ACCOUNT,
                arm_id=accepted.json()["arm_id"],
                body_sha256=hashlib.sha256(
                    json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
                ).hexdigest(),
                idempotency_key="story-film:v1:00000000-0000-0000-0000-000000000000",
            )
    assert_no_attempt(repo)


def test_additive_55_preserves_every_54_sql_object_and_empty_old_state(tmp_path):
    repo = StudioRepository(tmp_path / "migration.sqlite3")
    with repo._connection() as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 55
        connection.execute("DROP TABLE prepared_generation_slot_preparation")
        old = connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name"
        ).fetchall()
        connection.execute("PRAGMA user_version=54")
    StudioRepository(repo.database_path)
    with repo._connection() as connection:
        current = connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master "
            "WHERE tbl_name<>'prepared_generation_slot_preparation' "
            "ORDER BY name"
        ).fetchall()
        assert current == old
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM prepared_generation_slot_preparation"
            ).fetchone()[0]
            == 0
        )


@pytest.mark.parametrize("change", ["product", "intent-source"])
def test_late_loss_after_real_arm_is_blocked_before_any_provider_send(
    actual_cache,
    tmp_path,
    monkeypatch,
    change,
):
    repo, project, registration, cache, _ = actual_cache
    _allow_live(monkeypatch, tmp_path / "status.log")
    calls = []

    def no_provider(*args):
        calls.append(True)
        raise AssertionError("cache loss must not dispatch")

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=no_provider)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        body = observed.json()["items"][0]["cache"]["request"]
        armed = arm(client, project, execution, body)
        assert armed.status_code == 200
        if change == "product":
            part = observed.json()["items"][0]["cache"]["parts"]["video"]
            (cache.directory / f"video-{part['sha256']}.bin").unlink()
        else:
            from pathlib import Path

            frame = Path(body["shots"][0]["still"])
            frame.write_bytes(bytes(len(frame.read_bytes())))
        reply = post(client, project, "story-film", body, arm=armed.json()["arm_id"])
        assert reply.status_code == 200
        assert reply.json()["data"]["status"] in {"BLOCKED", "FAILED"}
        assert reply.json()["data"]["user_message"]["code"] == "CREATION_INPUT_UNVERIFIABLE"
    assert calls == []
    assert_no_attempt(repo)


def test_shared_image_hold_skips_cache_zero_and_cannot_relabel_after_dispatch(actual_cache):
    from aijian_api.generation_failure_store import GenerationFailureStore

    repo, project, registration, _, _ = actual_cache
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=3)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=3
    )
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200
        dispatch = post(
            client,
            project,
            f"{PREFIX}/{execution}/image-dispatch",
            {
                "stage_key": "frame",
                "body_sha256": "a" * 64,
            },
        )
        assert dispatch.status_code == 200, dispatch.text
        with repo._connection() as connection:
            held = connection.execute(
                "SELECT target_key,slot_index FROM prepared_generation_slot WHERE execution_id=?",
                (execution,),
            ).fetchall()
        assert [tuple(row) for row in held] == [("one", 1)]
        # Idempotent inspection keeps the exact earlier cache table, without new reserve.
        assert (
            post(
                client,
                project,
                f"{PREFIX}/{execution}/cache-preparations",
                {"registration": registration},
            ).json()
            == observed.json()
        )
        fresh = deepcopy(registration)
        fresh["key"] = "not-yet-frozen"
        new = post(client, project, PREFIX, fresh).json()["execution_id"]
        # Reserve in the new execution is blocked by the original unknown/in-flight identity.
        blocked = post(
            client,
            project,
            f"{PREFIX}/{new}/image-dispatch",
            {
                "stage_key": "frame",
                "body_sha256": "a" * 64,
            },
        )
        assert blocked.status_code == 409
        with repo._connection() as connection:
            assert (
                connection.execute(
                    "SELECT COUNT(*) FROM story_creation_failure_attempt"
                ).fetchone()[0]
                == 1
            )


@pytest.mark.parametrize("scope", ["account", "retired", "started"])
def test_cache_freeze_obeys_original_execution_account_retirement_and_dispatch_gate(
    actual_cache,
    scope,
):
    from aijian_api.generation_failure_store import GenerationFailureStore

    repo, project, registration, _, _ = actual_cache
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=3)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=3
    )
    with app_for(repo) as client:
        execution = post(client, project, PREFIX, registration).json()["execution_id"]
        account = ACCOUNT
        if scope == "account":
            account = "b" * 64
        elif scope == "retired":
            assert (
                post(
                    client,
                    project,
                    f"{PREFIX}/{execution}/retire",
                    {"target_key": None, "slot_index": None},
                ).status_code
                == 200
            )
        else:
            assert (
                post(
                    client,
                    project,
                    f"{PREFIX}/{execution}/image-dispatch",
                    {
                        "stage_key": "frame",
                        "body_sha256": "a" * 64,
                    },
                ).status_code
                == 200
            )
        denied = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
            account=account,
        )
        assert denied.status_code == 409 and denied.json()["detail"] == "INPUT_UNVERIFIABLE"
        with repo._connection() as connection:
            assert (
                connection.execute(
                    "SELECT COUNT(*) FROM prepared_generation_slot_preparation"
                ).fetchone()[0]
                == 0
            )


def test_cache_read_does_not_settle_unknown_or_unlock_it_with_new_limit_or_execution(
    actual_cache,
    tmp_path,
    monkeypatch,
):
    """A verified cache read keeps the original UNKNOWN row and spends no new budget."""
    from aijian_api.generation_failure_store import GenerationFailureStore

    repo, project, registration, _, bundle = actual_cache
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=3)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=1
    )
    prior = deepcopy(registration)
    prior["key"] = "prior-unknown-execution"
    fact = {"stage_key": "frame", "body_sha256": "b" * 64}

    def attempts():
        with repo._connection() as connection:
            return connection.execute(
                "SELECT id,status FROM story_creation_failure_attempt ORDER BY id"
            ).fetchall()

    _allow_live(monkeypatch, tmp_path / "unknown-cache-status.log")
    calls = []

    def no_provider(*_args):
        calls.append(True)
        raise AssertionError("cache read must not dispatch")

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=no_provider)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    with app_for(repo) as client:
        prior_execution = post(client, project, PREFIX, prior).json()["execution_id"]
        dispatched = post(client, project, f"{PREFIX}/{prior_execution}/image-dispatch", fact)
        assert dispatched.status_code == 200, dispatched.text
        missing = post(
            client,
            project,
            f"{PREFIX}/{prior_execution}/image-observation",
            {**fact, "output_sha256": None},
        )
        assert missing.status_code == 200, missing.text
        before = attempts()
        assert [row[1] for row in before] == ["UNKNOWN"]

        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200, observed.text
        items = observed.json()["items"]
        assert [row["preparation"] for row in items] == [
            "STORYFILM_CACHE",
            "CLIENT_IMAGES",
            "CLIENT_IMAGES",
        ]
        assert items[1]["cache"] is None and items[2]["cache"] is None
        cached = items[0]["cache"]
        body = cached["request"]
        assert cached["runtime_recipe"]["requested_seconds"] == 3
        assert cached["runtime_recipe"]["cap"] in {10, 15}
        assert len(cached["sources"]) == 1
        for role, data in zip(("image", "video", "voice"), bundle, strict=True):
            assert cached["parts"][role]["sha256"] == hashlib.sha256(data).hexdigest()
            assert cached["parts"][role]["bytes"] == len(data)
        assert attempts() == before

        armed = arm(client, project, execution, body)
        assert armed.status_code == 200, armed.text
        result = post(client, project, "story-film", body, arm=armed.json()["arm_id"])
        assert result.status_code == 200, result.text
        assert result.json()["data"]["status"] == "SUCCEEDED", result.text
        assert calls == []
        assert attempts() == before

        GenerationFailureStore(repo, scope="story_creation").configure(
            project, expected_revision=1, failure_limit=1000
        )
        fresh = deepcopy(registration)
        fresh["key"] = "raised-limit-new-execution"
        newer = post(client, project, PREFIX, fresh).json()["execution_id"]
        again = post(
            client,
            project,
            f"{PREFIX}/{newer}/cache-preparations",
            {"registration": fresh},
        )
        assert again.status_code == 200, again.text
        later = again.json()["items"]
        assert [row["preparation"] for row in later] == [
            "STORYFILM_CACHE",
            "CLIENT_IMAGES",
            "CLIENT_IMAGES",
        ]
        assert later[1]["cache"] is None and later[2]["cache"] is None
        blocked = post(client, project, f"{PREFIX}/{newer}/image-dispatch", fact)
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["detail"] == "ATTEMPT_ALREADY_RESERVED"
        borrowed = arm(client, project, newer, body, slot=1, take="borrowed-cache-request")
        assert borrowed.status_code == 409, borrowed.text
        assert borrowed.json()["detail"] == "INPUT_UNVERIFIABLE"
        assert attempts() == before
        assert calls == []
