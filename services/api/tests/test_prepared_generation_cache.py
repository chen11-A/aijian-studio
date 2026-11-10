"""Per-slot exact immutable cache choices; real SQLite, signed routes and local media."""

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest
from aijian_api.generation_failure_store import GenerationFailureError
from aijian_api.prepared_generation_cache import _MATCHED_RUNTIME_FIELDS
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
        cached_arm = arm(client, project, newer, body, slot=0, take="cache-slot-not-quota")
        assert cached_arm.status_code == 200, cached_arm.text
        with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
            PreparedGenerationStore(repo).claim_video(
                project,
                account=ACCOUNT,
                arm_id=cached_arm.json()["arm_id"],
                body_sha256=hashlib.sha256(
                    json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
                ).hexdigest(),
                idempotency_key="story-film:v1:00000000-0000-0000-0000-000000000001",
            )
        assert attempts() == before
        assert calls == []


def _enable_budgets(repo, project):
    from aijian_api.generation_failure_store import GenerationFailureStore

    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=3)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=3
    )


def _preparation_rows(repo, execution):
    with repo._connection() as connection:
        return connection.execute(
            "SELECT slot_index,preparation FROM prepared_generation_slot_preparation "
            "WHERE execution_id=? ORDER BY slot_index",
            (execution,),
        ).fetchall()


def _held_slots(repo, execution):
    with repo._connection() as connection:
        return [
            row[0]
            for row in connection.execute(
                "SELECT slot_index FROM prepared_generation_slot WHERE execution_id=? "
                "ORDER BY slot_index",
                (execution,),
            )
        ]


def test_reread_rejects_changed_source_bytes_canonical_and_mime(actual_cache):
    repo, project, registration, _, _ = actual_cache
    source = Path(registration["targets"][0]["sources"][0]["source"])
    with app_for(repo) as client:
        execution, first = prepared(client, project, registration)
        assert first.status_code == 200, first.text
        cached = first.json()["items"][0]["cache"]
        original_sources = cached["sources"]
        original_canonical = str(source.resolve())
        assert original_sources[0]["mime"] == "image/png"
        assert original_sources[0]["canonical_path"] == original_canonical
        assert original_sources[0]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
        intact = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
        )
        assert intact.status_code == 200, intact.text
        assert intact.json()["items"][0]["cache"]["sources"] == original_sources
        assert intact.json()["items"][0]["cache"]["snapshot_sha256"] == cached["snapshot_sha256"]

        original = source.read_bytes()
        source.write_bytes(b"\xff\xd8\xff" + original)
        changed = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
        )
        assert changed.status_code == 409 and changed.json()["detail"] == "INPUT_UNVERIFIABLE"
        source.write_bytes(original)
        claimed = deepcopy(registration)
        jpeg = b"\xff\xd8\xff\xd9"
        source.write_bytes(jpeg)
        claimed["targets"][0]["sources"][0]["sha256"] = hashlib.sha256(jpeg).hexdigest()
        retargeted = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": claimed},
        )
        assert retargeted.status_code == 409 and retargeted.json()["detail"] == "INPUT_UNVERIFIABLE"
        source.write_bytes(original)
        moved = source.with_name("relocated-owned.png")
        source.rename(moved)
        source.symlink_to(moved)
        relinked = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
        )
        assert relinked.status_code == 409 and relinked.json()["detail"] == "INPUT_UNVERIFIABLE"
        stored = PreparedGenerationStore(repo).preparations(project, execution, account=ACCOUNT)
        assert stored is not None
        assert stored[0].sources[0]["mime"] == "image/png"
        assert stored[0].sources[0]["sha256"] == hashlib.sha256(original).hexdigest()
        assert stored[0].sources[0]["canonical_path"] == original_canonical
        assert [tuple(row) for row in _preparation_rows(repo, execution)] == [
            (0, "STORYFILM_CACHE"),
            (1, "CLIENT_IMAGES"),
            (2, "CLIENT_IMAGES"),
        ]
    assert_no_attempt(repo)


def test_lineage_does_not_cross_account_or_project(actual_cache):
    repo, project, registration, _, _ = actual_cache
    _enable_budgets(repo, project)
    other = repo.create_project(
        name="另一项目",
        aspect_ratio="16:9",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    output = "d" * 64
    with app_for(repo) as client:
        execution = post(client, project, PREFIX, registration).json()["execution_id"]
        fact = {"stage_key": "frame", "body_sha256": "b" * 64}
        assert (
            post(client, project, f"{PREFIX}/{execution}/image-dispatch", fact).status_code == 200
        )
        assert (
            post(
                client,
                project,
                f"{PREFIX}/{execution}/image-observation",
                {**fact, "output_sha256": output},
            ).status_code
            == 200
        )
        facts = post(client, project, f"{PREFIX}/lineages", {"output_sha256s": [output]})
        assert facts.status_code == 200, facts.text
        assert len(facts.json()["items"]) == 1
        assert facts.json()["items"][0]["output_sha256"] == output
        wrong_account = post(
            client,
            project,
            f"{PREFIX}/lineages",
            {"output_sha256s": [output]},
            account="b" * 64,
        )
        assert wrong_account.status_code == 200, wrong_account.text
        assert wrong_account.json()["items"] == []
        wrong_project = post(client, other.id, f"{PREFIX}/lineages", {"output_sha256s": [output]})
        assert wrong_project.status_code == 200, wrong_project.text
        assert wrong_project.json()["items"] == []
        blocked = post(
            client,
            project,
            f"{PREFIX}/{execution}/cache-preparations",
            {"registration": registration},
        )
        assert blocked.status_code == 409 and blocked.json()["detail"] == "INPUT_UNVERIFIABLE"
        assert _preparation_rows(repo, execution) == []


def test_image_or_arm_before_freeze_leaves_no_table_and_freeze_skips_cache_quota(actual_cache):
    repo, project, registration, _, _ = actual_cache
    _enable_budgets(repo, project)
    body = registration["targets"][0]["body"]
    with app_for(repo) as client:
        started = post(client, project, PREFIX, registration).json()["execution_id"]
        assert (
            post(
                client,
                project,
                f"{PREFIX}/{started}/image-dispatch",
                {"stage_key": "frame", "body_sha256": "b" * 64},
            ).status_code
            == 200
        )
        denied = post(
            client,
            project,
            f"{PREFIX}/{started}/cache-preparations",
            {"registration": registration},
        )
        assert denied.status_code == 409 and denied.json()["detail"] == "INPUT_UNVERIFIABLE"
        assert _preparation_rows(repo, started) == []
        assert _held_slots(repo, started) == [0]

        armed_execution = post(
            client,
            project,
            PREFIX,
            {**registration, "key": "arm-before-freeze"},
        ).json()["execution_id"]
        assert arm(client, project, armed_execution, body).status_code == 200
        denied_arm = post(
            client,
            project,
            f"{PREFIX}/{armed_execution}/cache-preparations",
            {"registration": {**registration, "key": "arm-before-freeze"}},
        )
        assert denied_arm.status_code == 409 and denied_arm.json()["detail"] == "INPUT_UNVERIFIABLE"
        assert _preparation_rows(repo, armed_execution) == []
        assert _held_slots(repo, armed_execution) == []


def test_freeze_before_image_dispatch_holds_only_client_slots(actual_cache):
    repo, project, registration, _, _ = actual_cache
    _enable_budgets(repo, project)
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200, observed.text
        allowed = post(
            client,
            project,
            f"{PREFIX}/{execution}/image-dispatch",
            {"stage_key": "frame", "body_sha256": "b" * 64},
        )
        assert allowed.status_code == 200, allowed.text
        assert [tuple(row) for row in _preparation_rows(repo, execution)] == [
            (0, "STORYFILM_CACHE"),
            (1, "CLIENT_IMAGES"),
            (2, "CLIENT_IMAGES"),
        ]
        assert _held_slots(repo, execution) == [1]


def test_concurrent_prepare_and_image_dispatch_never_hold_a_cached_slot(actual_cache):
    from concurrent.futures import ThreadPoolExecutor

    repo, project, registration, _, _ = actual_cache
    _enable_budgets(repo, project)
    with app_for(repo) as client:
        execution = post(client, project, PREFIX, registration).json()["execution_id"]

    def prepare_table():
        with app_for(repo) as client:
            return post(
                client,
                project,
                f"{PREFIX}/{execution}/cache-preparations",
                {"registration": registration},
            )

    def dispatch_image():
        with app_for(repo) as client:
            return post(
                client,
                project,
                f"{PREFIX}/{execution}/image-dispatch",
                {"stage_key": "frame", "body_sha256": "b" * 64},
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        prepared_reply, image_reply = (
            future.result()
            for future in (
                executor.submit(prepare_table),
                executor.submit(dispatch_image),
            )
        )
    table = [tuple(row) for row in _preparation_rows(repo, execution)]
    held = _held_slots(repo, execution)
    if prepared_reply.status_code == 200:
        assert image_reply.status_code == 200, image_reply.text
        assert table == [(0, "STORYFILM_CACHE"), (1, "CLIENT_IMAGES"), (2, "CLIENT_IMAGES")]
        assert held == [1]
    else:
        assert prepared_reply.status_code == 409
        assert prepared_reply.json()["detail"] == "INPUT_UNVERIFIABLE"
        assert table == []
        assert image_reply.status_code == 200, image_reply.text
        assert held == [0]


def _rewrite_bundle(cache, mutate):
    path = cache.directory / "bundle.json"
    document = json.loads(path.read_text())
    mutate(document["runtime_recipe"])
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")


def _runtime(cache):
    return json.loads((cache.directory / "bundle.json").read_text())["runtime_recipe"]


def _recipe(repo, registration):
    return original_prepared_recipes(
        repo, toolchain, RegisterPreparedExecution.model_validate(registration)
    )[0].recipe


def _assert_unverifiable(reply):
    assert reply.status_code == 409
    assert reply.json() == {"detail": "INPUT_UNVERIFIABLE"}


def _assert_no_freeze_arm_or_budget(repo, project, execution):
    """Provider transport is not on this route, so no provider mock is consulted."""
    assert PreparedGenerationStore(repo).preparations(project, execution, account=ACCOUNT) is None
    with repo._connection() as connection:
        arms = connection.execute("SELECT COUNT(*) FROM prepared_generation_video_arm").fetchone()
    assert arms[0] == 0
    assert_no_attempt(repo)


def _assert_no_new_arm_or_budget(repo):
    with repo._connection() as connection:
        arms = connection.execute("SELECT COUNT(*) FROM prepared_generation_video_arm").fetchone()
    assert arms[0] == 0
    assert_no_attempt(repo)


def test_changed_runtime_prompt_never_freezes_a_cache_table(actual_cache):
    repo, project, registration, cache, _ = actual_cache
    goal = _recipe(repo, registration)
    _rewrite_bundle(cache, lambda runtime: runtime.__setitem__("video_prompt", "不是冻结配方"))
    runtime = _runtime(cache)
    assert runtime["video_prompt"] != goal["video_prompt"]
    assert all(
        runtime[field] == goal[field]
        for field in _MATCHED_RUNTIME_FIELDS
        if field != "video_prompt"
    )
    with app_for(repo) as client:
        execution, reply = prepared(client, project, registration)
    _assert_unverifiable(reply)
    _assert_no_freeze_arm_or_budget(repo, project, execution)


def test_runtime_still_identity_must_match_the_frozen_recipe(actual_cache):
    repo, project, registration, cache, _ = actual_cache
    goal = _recipe(repo, registration)
    _rewrite_bundle(
        cache,
        lambda runtime: runtime.__setitem__(
            "prepared_image", {"sha256": "ab" * 32, "mime": "image/png"}
        ),
    )
    runtime = _runtime(cache)
    assert runtime["actual_video"]["image"] == goal["prepared_image"]
    assert runtime["prepared_image"] != goal["prepared_image"]
    assert all(runtime[field] == goal[field] for field in _MATCHED_RUNTIME_FIELDS)
    with app_for(repo) as client:
        execution, reply = prepared(client, project, registration)
    _assert_unverifiable(reply)
    _assert_no_freeze_arm_or_budget(repo, project, execution)


def test_runtime_video_reference_count_must_match(actual_cache):
    repo, project, registration, cache, _ = actual_cache
    goal = _recipe(repo, registration)
    _rewrite_bundle(
        cache,
        lambda runtime: runtime.__setitem__(
            "video_references", [{"sha256": "cd" * 32, "mime": "image/png"}]
        ),
    )
    runtime = _runtime(cache)
    assert len(runtime["video_references"]) != len(goal["video_references"])
    assert all(runtime[field] == goal[field] for field in _MATCHED_RUNTIME_FIELDS)
    with app_for(repo) as client:
        execution, reply = prepared(client, project, registration)
    _assert_unverifiable(reply)
    _assert_no_freeze_arm_or_budget(repo, project, execution)


def test_non_byte_reference_does_not_match_a_byte_identity(actual_cache):
    repo, project, registration, _, _ = actual_cache
    from aijian_api.prepared_generation_cache import PreparedGenerationCache, byte_identity

    goal = _recipe(repo, registration)
    assert byte_identity(goal["prepared_image"])
    # A prepared local reference is rewritten to a data URL before shot linking,
    # so the public recipe does not currently carry a non-byte video reference.
    assert (
        PreparedGenerationCache(repo, toolchain)._reference_matches(
            project, ACCOUNT, goal["prepared_image"], "not-bytes"
        )
        is False
    )


def test_planned_image_without_lineage_does_not_freeze(actual_cache):
    repo, project, registration, _, bundle = actual_cache
    planned = deepcopy(registration)
    planned["key"] = "planned-cache-execution"
    planned["targets"][0]["key"] = "planned"
    planned["targets"][0]["body"]["shots"][0]["still"] = ""
    planned["targets"][0]["sources"] = []
    planned["stages"][0]["target_id"] = "planned"
    planned["stages"][0]["target_keys"] = ["planned"]
    recipe = original_prepared_recipes(
        repo, toolchain, RegisterPreparedExecution.model_validate(planned)
    )[0].recipe
    assert recipe["prepared_image"] is None
    from aijian_api.generation_dispatch_identity import story_reference_identity
    from aijian_api.xai_media import IMAGE_MODEL, XaiImage, _image_reference

    image_bytes, video, voice = bundle
    image = story_reference_identity(
        _image_reference(XaiImage(data=image_bytes, source_url=None, model=IMAGE_MODEL))["url"]
    )
    StoryCreationCache(
        Path(repo.database_path).parent / "story-films", project, recipe, repo.database_path
    ).put_bundle(
        image_bytes,
        video,
        voice,
        runtime_recipe={
            **recipe,
            "prepared_image": image,
            "actual_video": {"image": image, "seconds": 3},
        },
    )
    runtime = json.loads(
        (
            StoryCreationCache(
                Path(repo.database_path).parent / "story-films", project, recipe, repo.database_path
            ).directory
            / "bundle.json"
        ).read_text()
    )["runtime_recipe"]
    assert runtime["prepared_image"] == image
    assert runtime["actual_video"]["image"] == image
    assert all(runtime[field] == recipe[field] for field in _MATCHED_RUNTIME_FIELDS)
    assert (
        PreparedGenerationStore(repo).lineages(
            project, account=ACCOUNT, output_sha256s=(image["sha256"],)
        )
        == []
    )
    with app_for(repo) as client:
        execution, reply = prepared(client, project, planned)
    _assert_unverifiable(reply)
    _assert_no_freeze_arm_or_budget(repo, project, execution)


def test_shared_still_is_verified_once_across_targets(actual_cache, monkeypatch):
    repo, _, registration, _, _ = actual_cache
    import aijian_api.prepared_generation_routes as routes

    calls = {"n": 0}
    real = routes.reference_snapshot

    def counting(source):
        calls["n"] += 1
        return real(source)

    monkeypatch.setattr(routes, "reference_snapshot", counting)
    second = deepcopy(registration["targets"][0])
    second["key"] = "two"
    paired = deepcopy(registration)
    paired["targets"].append(second)
    recipes = original_prepared_recipes(
        repo, toolchain, RegisterPreparedExecution.model_validate(paired)
    )
    assert calls["n"] == 1
    assert recipes[0].recipe["prepared_image"] == recipes[1].recipe["prepared_image"]


def test_preconverted_source_cannot_also_be_captured(actual_cache):
    repo, _, registration, _, _ = actual_cache
    image = registration["targets"][0]["sources"][0]["source"]
    with pytest.raises(GenerationFailureError, match="INPUT_UNVERIFIABLE"):
        original_prepared_recipes(
            repo,
            toolchain,
            RegisterPreparedExecution.model_validate(registration),
            immutable_sources={image: "data:image/png;base64,aaaa"},
            captured_sources={},
        )


def test_unresolved_preconverted_source_is_unverifiable(actual_cache):
    repo, _, registration, _, _ = actual_cache
    image = registration["targets"][0]["sources"][0]["source"]
    with pytest.raises(GenerationFailureError, match="INPUT_UNVERIFIABLE"):
        original_prepared_recipes(
            repo,
            toolchain,
            RegisterPreparedExecution.model_validate(registration),
            immutable_sources={image: None},
        )


def test_arm_rejects_a_slot_outside_the_frozen_table(actual_cache):
    repo, project, registration, _, _ = actual_cache
    narrow = deepcopy(registration)
    narrow["targets"][0]["versions"] = 1
    with app_for(repo) as client:
        execution, observed = prepared(client, project, narrow)
        assert observed.status_code == 200, observed.text
        body = observed.json()["items"][0]["cache"]["request"]
        rejected = arm(client, project, execution, body, slot=1)
    _assert_unverifiable(rejected)
    _assert_no_new_arm_or_budget(repo)


def test_cache_slot_rejects_a_regenerate_flag(actual_cache):
    repo, project, registration, _, _ = actual_cache
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200, observed.text
        body = deepcopy(observed.json()["items"][0]["cache"]["request"])
        body["shots"][0]["regenerate"] = True
        rejected = arm(client, project, execution, body)
    _assert_unverifiable(rejected)
    _assert_no_new_arm_or_budget(repo)


@pytest.mark.parametrize("mutation", ["digest", "envelope", "shape"])
def test_damaged_frozen_cache_row_cannot_be_read(actual_cache, mutation):
    repo, project, registration, _, _ = actual_cache
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
    assert observed.status_code == 200, observed.text
    with repo._connection() as connection:
        if mutation == "digest":
            connection.execute(
                "UPDATE prepared_generation_slot_preparation SET cache_snapshot_sha256=? "
                "WHERE preparation='STORYFILM_CACHE'",
                ("0" * 64,),
            )
        else:
            raw = (
                '{"snapshot":1}'
                if mutation == "envelope"
                else '{"snapshot":{},"request":[],"sources":[]}'
            )
            connection.execute(
                "UPDATE prepared_generation_slot_preparation SET cache_snapshot_json=?, "
                "cache_snapshot_sha256=? WHERE preparation='STORYFILM_CACHE'",
                (raw, hashlib.sha256(raw.encode()).hexdigest()),
            )
        connection.commit()
    with pytest.raises(GenerationFailureError, match="INPUT_UNVERIFIABLE"):
        PreparedGenerationStore(repo).preparations(project, execution, account=ACCOUNT)


def test_damaged_frozen_cache_row_rejects_arm_without_writing_one(actual_cache):
    repo, project, registration, _, _ = actual_cache
    with app_for(repo) as client:
        execution, observed = prepared(client, project, registration)
        assert observed.status_code == 200
        body = observed.json()["items"][0]["cache"]["request"]
        with repo._connection() as connection:
            connection.execute(
                "UPDATE prepared_generation_slot_preparation SET cache_snapshot_sha256=? "
                "WHERE preparation='STORYFILM_CACHE'",
                ("0" * 64,),
            )
            connection.commit()
        rejected = arm(client, project, execution, body)
    _assert_unverifiable(rejected)
    _assert_no_new_arm_or_budget(repo)


def test_unreadable_reference_is_absent_from_the_cache_contract():
    from aijian_api.prepared_generation_routes import bounded_reference

    assert bounded_reference("/tmp/aivora-missing-reference.png") is None


def test_cache_preparations_schema_lists_only_input_unverifiable_for_409():
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity

    app = create_app(
        sidecar_security=SidecarSecurity(
            token="contract-export-token-without-runtime-authority",
            host="127.0.0.1:43127",
            origin="app://aijian",
        )
    )
    operation = app.openapi()["paths"][
        "/api/v1/projects/{project_id}/prepared-generation-executions/{execution_id}/cache-preparations"
    ]["post"]
    assert {"200", "409", "422"} <= set(operation["responses"])
    schema = operation["responses"]["409"]["content"]["application/json"]["schema"]
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        schema = app.openapi()["components"]["schemas"][name]
    assert schema["properties"]["detail"]["const"] == "INPUT_UNVERIFIABLE"


def test_concurrent_prepares_publish_one_identical_table(actual_cache):
    from concurrent.futures import ThreadPoolExecutor

    repo, project, registration, _, _ = actual_cache
    with app_for(repo) as client:
        execution = post(client, project, PREFIX, registration).json()["execution_id"]

    def prepare_table():
        with app_for(repo) as client:
            return post(
                client,
                project,
                f"{PREFIX}/{execution}/cache-preparations",
                {"registration": registration},
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        replies = list(executor.map(lambda _: prepare_table(), (0, 1)))
    assert [reply.status_code for reply in replies] == [200, 200]
    assert replies[0].json() == replies[1].json()
    assert [tuple(row) for row in _preparation_rows(repo, execution)] == [
        (0, "STORYFILM_CACHE"),
        (1, "CLIENT_IMAGES"),
        (2, "CLIENT_IMAGES"),
    ]
    assert_no_attempt(repo)
