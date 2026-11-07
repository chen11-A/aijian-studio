"""Real SQLite prerequisite reservations; recipes come from the actual StoryFilm compiler."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from aijian_api.generation_failure_store import GenerationFailureError, GenerationFailureStore
from aijian_api.prepared_generation_store import (
    PreparedGenerationStore,
    PreparedStage,
    PreparedTarget,
)
from aijian_api.repository import StudioRepository
from aijian_api.story_film import StoryFilmService, StoryShot
from test_draft_export_runtime import toolchain
from test_story_film import _byte_image, _project, _request

ACCOUNT = "a" * 64
BODY = "b" * 64
OUTPUT = "c" * 64


def fixture(tmp_path, limit=1):
    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=10)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=limit
    )
    service = StoryFilmService(repo, toolchain)
    service._begin_creation(
        _request("grok_subscription", shots=(StoryShot("你好。", "原始画面", 3, ""),))
    )
    recipe = service._creation_targets()[0]
    return repo, project, recipe


def register(repo, project, recipe, key, *, versions=1, target="shot-one"):
    store = PreparedGenerationStore(repo)
    execution = store.register(
        project,
        account=ACCOUNT,
        execution_key=key,
        targets=(PreparedTarget(target, recipe, versions),),
        stages=(PreparedStage("frame", {"kind": "shot-frame"}, (target,)),),
    )
    return store, execution


def rows(repo, table):
    with sqlite3.connect(repo.database_path) as connection:
        return connection.execute(f"SELECT * FROM {table}").fetchall()


def test_new_key_versions_target_ids_restart_and_subset_do_not_open_a_bucket(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    store, first = register(repo, project, recipe, "ordinary-three", versions=3)
    holds = store.before_image(project, first, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    assert len(holds) == 1  # Three explicitly requested versions are not pre-reserved.
    store.observed_image(
        project, first, account=ACCOUNT, stage_key="frame", body_sha256=BODY, output_sha256=None
    )
    restarted = StudioRepository(repo.database_path)
    new_store, second = register(
        restarted, project, recipe, "pipeline-one-subset", target="new-queued-target"
    )
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        new_store.before_image(
            project, second, account=ACCOUNT, stage_key="frame", body_sha256=BODY
        )
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "UNKNOWN"
    assert len(rows(repo, "story_creation_failure_attempt")) == 1


def test_shared_dependencies_reserve_atomically_and_identical_targets_share_one_first_hold(
    tmp_path,
):
    repo, project, recipe = fixture(tmp_path)
    store = PreparedGenerationStore(repo)
    execution = store.register(
        project,
        account=ACCOUNT,
        execution_key="shared-scene",
        targets=(PreparedTarget("one", recipe, 3), PreparedTarget("two", recipe, 1)),
        stages=(PreparedStage("scene", {"kind": "location-reference"}, ("one", "two")),),
    )
    assert (
        len(
            store.before_image(
                project, execution, account=ACCOUNT, stage_key="scene", body_sha256=BODY
            )
        )
        == 1
    )
    slots = rows(repo, "prepared_generation_slot")
    assert len(slots) == 2 and slots[0][3] == slots[1][3]
    # A readable image is lineage, not proof that either video succeeded.
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="scene",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "PENDING"
    assert rows(repo, "prepared_generation_stage")[0][-2:] == (OUTPUT, "READABLE")


def test_one_blocked_dependency_rolls_back_all_new_reservations_and_stage_transition(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    ledger = GenerationFailureStore(repo, scope="story_creation")
    blocked_store, blocked = register(repo, project, recipe, "already-pending")
    blocked_store.before_image(
        project, blocked, account=ACCOUNT, stage_key="frame", body_sha256=BODY
    )
    other = {**recipe, "video_prompt": "另一份实际创作"}
    store = PreparedGenerationStore(repo)
    execution = store.register(
        project,
        account=ACCOUNT,
        execution_key="atomic-shared",
        targets=(PreparedTarget("a-new", other, 1), PreparedTarget("z-blocked", recipe, 1)),
        stages=(PreparedStage("scene", {"kind": "location-reference"}, ("a-new", "z-blocked")),),
    )
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        store.before_image(project, execution, account=ACCOUNT, stage_key="scene", body_sha256=BODY)
    assert ledger.policy(project).failure_limit == 1
    assert len(rows(repo, "story_creation_failure_attempt")) == 1
    assert not [row for row in rows(repo, "prepared_generation_slot") if row[0] == execution]
    assert next(row for row in rows(repo, "prepared_generation_stage") if row[0] == execution)[
        -3:
    ] == (None, None, "UNSENT")


def test_concurrent_new_executions_and_account_body_observations_are_closed(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    executions = [register(repo, project, recipe, f"parallel-{index}") for index in range(4)]

    def submit(pair):
        store, execution = pair
        try:
            store.before_image(
                project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY
            )
            return True
        except GenerationFailureError as error:
            assert str(error) == "ATTEMPT_ALREADY_RESERVED"
            return False

    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sum(executor.map(submit, executions)) == 1
    stage = next(row for row in rows(repo, "prepared_generation_stage") if row[-1] == "PENDING")
    store = PreparedGenerationStore(repo)
    with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
        store.observed_image(
            project,
            stage[0],
            account="d" * 64,
            stage_key="frame",
            body_sha256=BODY,
            output_sha256=OUTPUT,
        )
    with pytest.raises(GenerationFailureError, match="ATTEMPT_NOT_PENDING"):
        store.observed_image(
            project,
            stage[0],
            account=ACCOUNT,
            stage_key="frame",
            body_sha256="e" * 64,
            output_sha256=OUTPUT,
        )
    assert all(row[-2] is None for row in rows(repo, "prepared_generation_stage"))


def test_registration_does_not_invent_allowance_or_mutate_existing_policy(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    with sqlite3.connect(repo.database_path) as connection:
        connection.execute("DELETE FROM story_creation_failure_policy")
    store, execution = register(repo, project, recipe, "unconfigured")
    with pytest.raises(GenerationFailureError, match="UNCONFIGURED"):
        store.before_image(project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    assert rows(repo, "story_creation_failure_policy") == []
    assert rows(repo, "story_creation_failure_attempt") == []
    invalid = replace(PreparedTarget("one", recipe, 1), versions=True)
    with pytest.raises(GenerationFailureError, match="INVALID_DISPATCH_IDENTITY"):
        store.register(
            project, account=ACCOUNT, execution_key="invalid", targets=(invalid,), stages=()
        )


def test_same_effective_recipe_with_new_local_id_is_same_but_actual_user_reference_differs(
    tmp_path,
):
    repo, project, _ = fixture(tmp_path)
    service = StoryFilmService(repo, toolchain)
    original = StoryShot("你好。", "同一有效画面", 3, "", still=_byte_image("user-original"))
    service._begin_creation(_request("grok_subscription", shots=(original,)))
    recipe = service._creation_targets()[0]
    store, first = register(repo, project, recipe, "first-local-id", target="old-shot")
    store.before_image(project, first, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    # Local shot identity is only a locator, not another failure bucket.
    copied_store, copied = register(repo, project, recipe, "copied-local-id", target="copied-shot")
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        copied_store.before_image(
            project, copied, account=ACCOUNT, stage_key="frame", body_sha256=BODY
        )
    service._begin_creation(
        _request(
            "grok_subscription", shots=(replace(original, still=_byte_image("user-replaced")),)
        )
    )
    changed = service._creation_targets()[0]
    assert changed["prepared_image"] != recipe["prepared_image"]
    changed_store, changed_execution = register(
        repo, project, changed, "real-reference-change", target="old-shot"
    )
    assert changed_store.before_image(
        project, changed_execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY
    )
    assert len(rows(repo, "story_creation_failure_attempt")) == 2


def test_retirement_ack_does_not_prove_unsent_but_real_no_transport_observation_can_release(
    tmp_path,
):
    repo, project, recipe = fixture(tmp_path)
    store, execution = register(repo, project, recipe, "no-send")
    store.before_image(project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    store.retire(project, execution, account=ACCOUNT)
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "PENDING"
    with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
        store.before_image(project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    store.image_was_not_sent(
        project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY
    )
    assert rows(repo, "story_creation_failure_attempt") == []
    assert rows(repo, "prepared_generation_slot") == []
    assert rows(repo, "prepared_generation_execution")[0][-1] == 1


def test_known_completed_image_cancel_keeps_one_failure_but_not_a_permanent_pending(tmp_path):
    repo, project, recipe = fixture(tmp_path, limit=2)
    store, execution = register(repo, project, recipe, "known-image")
    store.before_image(project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    store.retire(project, execution, account=ACCOUNT)
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "FAILED"
    later_store, later = register(repo, project, recipe, "explicit-next-attempt")
    later_store.before_image(project, later, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    assert len(rows(repo, "story_creation_failure_attempt")) == 2
    later_store.observed_image(
        project,
        later,
        account=ACCOUNT,
        stage_key="frame",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    later_store.retire(project, later, account=ACCOUNT)
    assert all(row[-1] == "FAILED" for row in rows(repo, "story_creation_failure_attempt"))
    third_store, third = register(repo, project, recipe, "must-not-reset-two")
    with pytest.raises(GenerationFailureError, match="INPUT_FAILURE_LIMIT"):
        third_store.before_image(
            project, third, account=ACCOUNT, stage_key="frame", body_sha256=BODY
        )
    assert rows(repo, "prepared_generation_stage")[0][-2:] == (OUTPUT, "READABLE")


def test_uncertain_transport_cancel_retains_unknown_and_rejects_fake_unsent(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    store, execution = register(repo, project, recipe, "uncertain-image")
    store.before_image(project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    store.observed_image(
        project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY, output_sha256=None
    )
    store.retire(project, execution, account=ACCOUNT)
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "UNKNOWN"
    with pytest.raises(GenerationFailureError, match="ATTEMPT_NOT_UNSUBMITTED"):
        store.image_was_not_sent(
            project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY
        )
    restarted = StudioRepository(repo.database_path)
    next_store, next_execution = register(restarted, project, recipe, "explicit-new-key")
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        next_store.before_image(
            project, next_execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY
        )


def test_single_slot_cancellation_preserves_other_confirmed_versions_and_shared_image_hold(
    tmp_path,
):
    repo, project, recipe = fixture(tmp_path)
    store, execution = register(repo, project, recipe, "three-slots", versions=3)
    store.before_image(project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    store.retire(project, execution, account=ACCOUNT, target_key="shot-one", slot_index=0)
    assert rows(repo, "prepared_generation_execution")[0][-1] == 0
    assert rows(repo, "prepared_generation_slot")[0][2] == 1
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "PENDING"
    assert len(rows(repo, "story_creation_failure_attempt")) == 1
    store.retire(project, execution, account=ACCOUNT, target_key="shot-one", slot_index=1)
    assert rows(repo, "prepared_generation_slot")[0][2] == 2
    store.retire(project, execution, account=ACCOUNT, target_key="shot-one", slot_index=2)
    assert rows(repo, "story_creation_failure_attempt")[0][-1] == "FAILED"


def arm(store, project, execution, target, slot, *, body=BODY, take="take"):
    return store.arm_video(
        project,
        execution,
        account=ACCOUNT,
        target_key=target,
        slot_index=slot,
        take_key=take,
        body_sha256=body,
        runtime_recipe={"wire": "store-unit"},
        expected_sources=[],
    )


def test_shared_first_hold_can_only_adopt_once_then_success_allows_next_same_input(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    store = PreparedGenerationStore(repo)
    execution = store.register(
        project,
        account=ACCOUNT,
        execution_key="shared-videos",
        targets=(PreparedTarget("a", recipe, 1), PreparedTarget("b", recipe, 1)),
        stages=(PreparedStage("frame", {"kind": "shot-frame"}, ("a", "b")),),
    )
    holds = store.before_image(
        project, execution, account=ACCOUNT, stage_key="frame", body_sha256=BODY
    )
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    first_arm = arm(store, project, execution, "a", 0, take="take-a")
    second_arm = arm(store, project, execution, "b", 0, take="take-b")
    first = store.claim_video(
        project,
        account=ACCOUNT,
        arm_id=first_arm,
        body_sha256=BODY,
        idempotency_key="video-a",
    )
    assert first == holds[0]
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        store.claim_video(
            project,
            account=ACCOUNT,
            arm_id=second_arm,
            body_sha256=BODY,
            idempotency_key="video-b",
        )
    GenerationFailureStore(repo, scope="story_creation").settle(project, first, "SUCCEEDED")
    second = store.claim_video(
        project,
        account=ACCOUNT,
        arm_id=second_arm,
        body_sha256=BODY,
        idempotency_key="video-b",
    )
    assert second.input_sha256 == first.input_sha256
    assert second.attempt_id != first.attempt_id
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        store.claim_video(
            project,
            account=ACCOUNT,
            arm_id=first_arm,
            body_sha256=BODY,
            idempotency_key="new-key-cannot-reuse-arm",
        )


def test_three_versions_have_distinct_attempts_same_bucket_and_unknown_blocks_later(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    store, execution = register(repo, project, recipe, "three-actual-videos", versions=3)
    attempts = []
    for slot in range(3):
        identifier = arm(store, project, execution, "shot-one", slot, take=f"take-{slot}")
        reservation = store.claim_video(
            project,
            account=ACCOUNT,
            arm_id=identifier,
            body_sha256=BODY,
            idempotency_key=f"request-{slot}",
        )
        attempts.append(reservation)
        GenerationFailureStore(repo, scope="story_creation").settle(
            project, reservation, "SUCCEEDED" if slot < 2 else "UNKNOWN"
        )
    assert len({row.attempt_id for row in attempts}) == 3
    assert len({row.input_sha256 for row in attempts}) == 1
    _, another = register(repo, project, recipe, "new-execution-key", versions=1)
    identifier = arm(store, project, another, "shot-one", 0)
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        store.claim_video(
            project,
            account=ACCOUNT,
            arm_id=identifier,
            body_sha256=BODY,
            idempotency_key="cannot-bypass-unknown",
        )


def test_arm_claim_rechecks_body_account_and_retirement_without_reserving(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    store, execution = register(repo, project, recipe, "no-send")
    identifier = arm(store, project, execution, "shot-one", 0)
    with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
        store.claim_video(
            project,
            account="d" * 64,
            arm_id=identifier,
            body_sha256=BODY,
            idempotency_key="wrong-account",
        )
    with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
        store.claim_video(
            project,
            account=ACCOUNT,
            arm_id=identifier,
            body_sha256="e" * 64,
            idempotency_key="wrong-body",
        )
    store.retire(project, execution, account=ACCOUNT)
    with pytest.raises(GenerationFailureError, match="EXECUTION_UNAVAILABLE"):
        store.claim_video(
            project,
            account=ACCOUNT,
            arm_id=identifier,
            body_sha256=BODY,
            idempotency_key="retired",
        )
    assert rows(repo, "story_creation_failure_attempt") == []


@pytest.mark.parametrize("state", ["PENDING", "UNKNOWN"])
def test_unresolved_same_intent_blocks_new_execution_even_after_explicit_limit_increase(
    tmp_path, state
):
    repo, project, recipe = fixture(tmp_path, limit=10)
    store, first = register(repo, project, recipe, "original")
    store.before_image(project, first, account=ACCOUNT, stage_key="frame", body_sha256=BODY)
    if state == "UNKNOWN":
        store.observed_image(
            project,
            first,
            account=ACCOUNT,
            stage_key="frame",
            body_sha256=BODY,
            output_sha256=None,
        )
    GenerationFailureStore(repo, scope="story_creation").configure(
        project,
        expected_revision=1,
        failure_limit=1000,
    )
    restart = StudioRepository(repo.database_path)
    newer, execution = register(
        restart, project, recipe, "new-mode-count-subset", versions=3, target="new-local-shot-id"
    )
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        newer.before_image(
            project,
            execution,
            account=ACCOUNT,
            stage_key="frame",
            body_sha256=BODY,
        )
    identifier = arm(newer, project, execution, "new-local-shot-id", 0)
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        newer.claim_video(
            project,
            account=ACCOUNT,
            arm_id=identifier,
            body_sha256=BODY,
            idempotency_key="new-video-key",
        )
    assert len(rows(repo, "story_creation_failure_attempt")) == 1


def test_second_dedicated_frame_after_shared_hold_success_uses_new_attempt_same_bucket(tmp_path):
    repo, project, recipe = fixture(tmp_path)
    store = PreparedGenerationStore(repo)
    execution = store.register(
        project,
        account=ACCOUNT,
        execution_key="common-a-then-b",
        targets=(PreparedTarget("a", recipe, 1), PreparedTarget("b", recipe, 1)),
        stages=(
            PreparedStage("common", {"kind": "location-reference"}, ("a", "b")),
            PreparedStage("frame-a", {"kind": "shot-frame"}, ("a",)),
            PreparedStage("frame-b", {"kind": "shot-frame"}, ("b",)),
        ),
    )
    common = store.before_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="common",
        body_sha256=BODY,
    )[0]
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="common",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    assert store.before_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame-a",
        body_sha256=BODY,
    ) == (common,)
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame-a",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    first = store.claim_video(
        project,
        account=ACCOUNT,
        arm_id=arm(store, project, execution, "a", 0, take="a"),
        body_sha256=BODY,
        idempotency_key="a",
    )
    assert first == common
    with pytest.raises(GenerationFailureError, match="ATTEMPT_ALREADY_RESERVED"):
        store.before_image(
            project,
            execution,
            account=ACCOUNT,
            stage_key="frame-b",
            body_sha256=BODY,
        )
    GenerationFailureStore(repo, scope="story_creation").settle(project, first, "SUCCEEDED")
    second = store.before_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame-b",
        body_sha256=BODY,
    )[0]
    assert second.attempt_id != first.attempt_id
    assert second.input_sha256 == first.input_sha256
    store.observed_image(
        project,
        execution,
        account=ACCOUNT,
        stage_key="frame-b",
        body_sha256=BODY,
        output_sha256=OUTPUT,
    )
    adopted = store.claim_video(
        project,
        account=ACCOUNT,
        arm_id=arm(store, project, execution, "b", 0, take="b"),
        body_sha256=BODY,
        idempotency_key="b",
    )
    assert adopted == second
