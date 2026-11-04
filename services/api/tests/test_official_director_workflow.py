"""Offline schema41 authority, raw-output, atomicity and explicit-review acceptance."""

import copy
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.official_director_contracts import (
    AdoptOfficialDirectorRequest,
    CompleteOfficialDirectorRequest,
    PrepareOfficialDirectorRequest,
    RejectOfficialDirectorRequest,
    ReserveOfficialDirectorRequest,
)
from aijian_api.official_director_prompt import text_request_hash
from aijian_api.official_director_store import OfficialDirectorError, OfficialDirectorStore
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.shot_plan_proposal_store import ShotPlanProposalStore
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_queue_read import TaskQueueReader
from pydantic import ValidationError
from test_shot_plan_proposals import request, setup


def prepared_case(tmp_path, count=7):
    repository, project, episode = setup(tmp_path)
    human = request(ShotPlanProposalStore(repository), project, episode, count).content
    payload = PrepareOfficialDirectorRequest.model_validate(
        {
            "operation_id": str(uuid4()),
            "profile_id": str(uuid4()),
            "model": "gpt-offline-test",
            "authority": human.authority.model_dump(mode="json"),
            "storyboard_base": None,
            "intent": "保留离别的余韵，避免无意义的镜头。",
            "options": {"target_shot_count": count, "pacing": "SLOW"},
        }
    )
    store = OfficialDirectorStore(repository)
    prepared = store.prepare(project, episode, payload)
    reserve = ReserveOfficialDirectorRequest.model_validate(
        prepared.model_dump(mode="json", include=set(ReserveOfficialDirectorRequest.model_fields))
    )
    content = human.model_dump(mode="json")
    content["provenance"] = "AI"
    completion = CompleteOfficialDirectorRequest(
        operation_id=payload.operation_id,
        profile_id=payload.profile_id,
        model=payload.model,
        request_hash=prepared.request_hash,
        response_id="resp_verified_fixture",
        text=json.dumps(content, ensure_ascii=False),
        completed_at="2026-10-08T23:00:00Z",
    )
    return repository, project, episode, store, payload, prepared, reserve, content, completion


def adoption_request(operation):
    return AdoptOfficialDirectorRequest(
        proposal_version_id=operation.proposal.version_id,
        proposal_content_hash=operation.proposal.content_hash,
        confirm=True,
    )


def test_prompt_is_server_owned_exact_proofs_and_preparation_does_not_reserve(tmp_path):
    repository, project, episode, store, payload, prepared, *_ = prepared_case(tmp_path)
    assert prepared.request_hash == text_request_hash(
        payload.model, prepared.input_text, prepared.instructions
    )
    assert "the form shp_" in prepared.instructions and "the form sht_" not in prepared.instructions
    assert len(prepared.instructions.encode("utf-16-le")) // 2 <= 20_000
    assert json.loads(prepared.input_text)["confirmed_script"] == prepared.script_stored_content
    assert (
        json.loads(prepared.input_text)["production_brief"]
        == prepared.production_brief_stored_content
    )
    assert store.list(project, episode) == []
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT count(*) FROM task_ledger").fetchone()[0] == 0


def test_reserve_complete_adopt_preserves_ai_proposal_exact_script_and_versions(tmp_path):
    repository, project, episode, store, _, prepared, reserve, content, completion = prepared_case(
        tmp_path, count=11
    )
    reserved, replayed = store.reserve(project, episode, reserve)
    assert not replayed and reserved.status == reserved.attempt_status == "REMOTE_UNKNOWN"
    assert reserved.proposal is None and reserved.completion is None
    assert store.reserve(project, episode, reserve)[1]
    completed, replayed = store.complete(project, episode, completion)
    assert (
        not replayed and completed.status == "COMPLETED" and completed.attempt_status == "SUCCEEDED"
    )
    assert completed.proposal.content.model_dump(mode="json") == content
    assert len(completed.proposal.content.shots) == 11
    assert completed.adoption is None and completed.rejection is None
    assert store.complete(project, episode, completion)[1]
    adopted, replayed = store.adopt(
        project, episode, reserve.operation_id, adoption_request(completed), "local-user"
    )
    assert not replayed and adopted.adoption is not None
    storyboard = EpisodeStoryboardStore(repository).get_latest(
        project_id=project, episode_id=episode
    )
    assert storyboard.content.script_version_id == prepared.authority.script.version_id
    assert len(storyboard.content.shots) == 11
    assert storyboard.author_actor_id == "local-user"
    assert store.adopt(
        project, episode, reserve.operation_id, adoption_request(completed), "local-user"
    )[1]
    assert store.get(project, episode, reserve.operation_id).completion == completion
    assert store.get(project, episode, reserve.operation_id).proposal.content.provenance == "AI"
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert connection.execute("SELECT count(*) FROM workflow_attempts").fetchone()[0] == 1
        producer = connection.execute(
            "SELECT author_actor_type, producer_attempt_id FROM artifact_versions "
            "WHERE version_id = ?",
            (completed.proposal.version_id,),
        ).fetchone()
        assert producer == ("agent", completed.attempt_id)


@pytest.mark.parametrize(
    "field,value",
    [
        ("profile_id", str(uuid4())),
        ("model", "another-model"),
        ("request_hash", "sha256:" + "0" * 64),
    ],
)
def test_wrong_provider_identity_never_finishes_reserved_task(tmp_path, field, value):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    changed = completion.model_dump(mode="json")
    changed[field] = value
    with pytest.raises(OfficialDirectorError, match="COMPLETION_MISMATCH"):
        store.complete(project, episode, CompleteOfficialDirectorRequest.model_validate(changed))
    assert store.get(project, episode, reserve.operation_id).status == "REMOTE_UNKNOWN"


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "```json\n{}\n```",
        "{}",
        "[]",
        "null",
        "",
        "\x00",
        '{"provenance":"AI","provenance":"HUMAN"}',
        '{"schema_version":"1.0.0","number":NaN}',
        '{"number":Infinity}',
    ],
)
def test_invalid_json_is_retained_exactly_and_never_adoptable(tmp_path, raw):
    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    invalid = CompleteOfficialDirectorRequest.model_validate(
        {**completion.model_dump(mode="json"), "text": raw}
    )
    operation, replayed = store.complete(project, episode, invalid)
    assert not replayed and operation.status == "INVALID" and operation.attempt_status == "FAILED"
    assert operation.completion.text == raw and operation.proposal is None
    assert operation.validation_issues[0].code == "OFFICIAL_DIRECTOR_INVALID_JSON"
    assert store.complete(project, episode, invalid)[1]
    assert StudioRepository(repository.database_path)
    recovered = OfficialDirectorStore(repository).get(project, episode, reserve.operation_id)
    assert recovered.completion.text == raw
    with pytest.raises(OfficialDirectorError, match="NOT_ADOPTABLE"):
        store.adopt(
            project,
            episode,
            reserve.operation_id,
            AdoptOfficialDirectorRequest(
                proposal_version_id="ver_" + "a" * 32,
                proposal_content_hash="sha256:" + "a" * 64,
                confirm=True,
            ),
            "local-user",
        )
    with sqlite3.connect(repository.database_path) as connection:
        assert (
            connection.execute(
                "SELECT count(*) FROM artifacts WHERE artifact_type='official_director_proposal'"
            ).fetchone()[0]
            == 0
        )


@pytest.mark.parametrize(
    "mutation,expected_code",
    [
        ("scope", "OFFICIAL_DIRECTOR_SCOPE_MISMATCH"),
        ("authority", "OFFICIAL_DIRECTOR_AUTHORITY_MISMATCH"),
        ("missing_coverage", "OFFICIAL_DIRECTOR_SCRIPT_COVERAGE_INCOMPLETE"),
        ("wrong_block", "OFFICIAL_DIRECTOR_BLOCK_REFERENCE_INVALID"),
        ("provenance", "OFFICIAL_DIRECTOR_INVALID_JSON"),
        ("unknown_field", "OFFICIAL_DIRECTOR_INVALID_JSON"),
    ],
)
def test_model_cannot_forge_pins_scope_coverage_or_human_authorship(
    tmp_path, mutation, expected_code
):
    _, project, episode, store, _, _, reserve, content, completion = prepared_case(tmp_path)
    changed = copy.deepcopy(content)
    if mutation == "scope":
        changed["episode_id"] = "ep_" + "b" * 32
    if mutation == "authority":
        changed["authority"]["script"]["content_hash"] = "sha256:" + "b" * 64
    if mutation == "missing_coverage":
        changed["shots"] = [changed["shots"][0]]
    if mutation == "wrong_block":
        changed["shots"][0]["script_block_ids"] = ["sblk_" + "b" * 32]
    if mutation == "provenance":
        changed["provenance"] = "HUMAN"
    if mutation == "unknown_field":
        changed["producer_claim"] = "human approved"
    store.reserve(project, episode, reserve)
    operation, _ = store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest.model_validate(
            {**completion.model_dump(mode="json"), "text": json.dumps(changed, ensure_ascii=False)}
        ),
    )
    assert operation.status == "INVALID" and operation.proposal is None
    assert operation.validation_issues[0].code == expected_code


def test_prompt_tampering_duplicate_operation_and_unknown_new_operation_block_before_send(tmp_path):
    _, project, episode, store, _, _, reserve, _, _ = prepared_case(tmp_path)
    with pytest.raises(OfficialDirectorError, match="PROMPT_MISMATCH"):
        store.reserve(
            project,
            episode,
            ReserveOfficialDirectorRequest.model_validate(
                {**reserve.model_dump(mode="json"), "request_hash": "sha256:" + "0" * 64}
            ),
        )
    store.reserve(project, episode, reserve)
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.reserve(
            project,
            episode,
            ReserveOfficialDirectorRequest.model_validate(
                {**reserve.model_dump(mode="json"), "intent": "Changed after approval"}
            ),
        )
    with pytest.raises(OfficialDirectorError, match="UNRESOLVED_OPERATION"):
        store.reserve(
            project,
            episode,
            ReserveOfficialDirectorRequest.model_validate(
                {**reserve.model_dump(mode="json"), "operation_id": str(uuid4())}
            ),
        )
    with pytest.raises(ValidationError):
        ReserveOfficialDirectorRequest.model_validate(
            {**reserve.model_dump(mode="json"), "input_text": "forged"}
        )


def test_not_sent_truth_is_terminal_and_recovered_unknown_is_not_replayed(tmp_path):
    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    initial, _ = store.reserve(project, episode, reserve)
    ledger = LocalTaskLedger(repository.database_path)
    assert ledger.recover_expired_remote_tasks(task_kind="official.director.plan").recovered == 0
    assert ledger.recover_expired_local_tasks(task_kind="official.director.plan").recovered == 0
    recovered = OfficialDirectorStore(StudioRepository(repository.database_path)).get(
        project, episode, reserve.operation_id
    )
    assert recovered.status == recovered.attempt_status == "REMOTE_UNKNOWN"
    assert recovered.task_id == initial.task_id and recovered.attempt_id == initial.attempt_id
    queue = TaskQueueReader(repository.database_path).list_project_tasks(project)
    assert len(queue) == 1 and queue[0].attempt_count == queue[0].max_attempts == 1
    assert (
        queue[0].attempt_status == "REMOTE_UNKNOWN"
        and queue[0].task_kind == "official.director.plan"
    )
    assert set(queue[0].input_version_ids) == {
        reserve.authority.script.version_id,
        reserve.authority.production_brief.version_id,
    }
    not_sent, replayed = store.not_sent(project, episode, reserve.operation_id, "USER_CANCELLED")
    assert (
        not replayed
        and not_sent.status == "NOT_SENT"
        and not_sent.attempt_status == "NOT_SUBMITTED"
    )
    assert store.not_sent(project, episode, reserve.operation_id, "USER_CANCELLED")[1]
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.complete(project, episode, completion)


def test_human_rejection_is_explicit_immutable_and_excludes_adoption(tmp_path):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(project, episode, completion)
    adopt = adoption_request(completed)
    rejection = RejectOfficialDirectorRequest(
        **adopt.model_dump(mode="json"), reason="节奏不适合本片"
    )
    rejected, replayed = store.reject(
        project, episode, reserve.operation_id, rejection, "local-user"
    )
    assert not replayed and rejected.rejection.reason == "节奏不适合本片"
    assert rejected.proposal == completed.proposal and rejected.adoption is None
    assert store.reject(project, episode, reserve.operation_id, rejection, "local-user")[1]
    with pytest.raises(OfficialDirectorError, match="REJECTED"):
        store.adopt(project, episode, reserve.operation_id, adopt, "local-user")
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.reject(
            project,
            episode,
            reserve.operation_id,
            RejectOfficialDirectorRequest(
                **adopt.model_dump(mode="json"), reason="改写历史拒绝原因"
            ),
            "local-user",
        )
    for confirm in [False, 1, "true"]:
        with pytest.raises(ValidationError):
            AdoptOfficialDirectorRequest.model_validate(
                {**adopt.model_dump(mode="json"), "confirm": confirm}
            )


@pytest.mark.parametrize(
    "phase",
    [
        "task_reserved",
        "operation_reserved",
        "proposal_created",
        "completion_recorded",
        "storyboard_created",
        "adoption_recorded",
        "rejection_recorded",
    ],
)
def test_transaction_crash_rolls_back_whole_transition_and_retry_is_idempotent(tmp_path, phase):
    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)

    def fail(at):
        if at == phase:
            raise RuntimeError("simulated crash")

    crashing = OfficialDirectorStore(repository, transaction_hook=fail)
    if phase in {"task_reserved", "operation_reserved"}:
        with pytest.raises(OfficialDirectorError, match="STORAGE_FAILED"):
            crashing.reserve(project, episode, reserve)
        assert store.list(project, episode) == []
        with sqlite3.connect(repository.database_path) as connection:
            assert connection.execute("SELECT count(*) FROM workflow_runs").fetchone()[0] == 0
        assert not store.reserve(project, episode, reserve)[1]
        return
    store.reserve(project, episode, reserve)
    if phase in {"proposal_created", "completion_recorded"}:
        with pytest.raises(OfficialDirectorError, match="STORAGE_FAILED"):
            crashing.complete(project, episode, completion)
        assert store.get(project, episode, reserve.operation_id).status == "REMOTE_UNKNOWN"
        assert not store.complete(project, episode, completion)[1]
        return
    completed, _ = store.complete(project, episode, completion)
    payload = adoption_request(completed)
    if phase == "rejection_recorded":
        rejection = RejectOfficialDirectorRequest(**payload.model_dump(mode="json"), reason="重做")
        with pytest.raises(OfficialDirectorError, match="STORAGE_FAILED"):
            crashing.reject(project, episode, reserve.operation_id, rejection, "local-user")
        assert store.get(project, episode, reserve.operation_id).rejection is None
        assert not store.reject(project, episode, reserve.operation_id, rejection, "local-user")[1]
    else:
        with pytest.raises(OfficialDirectorError, match="STORAGE_FAILED"):
            crashing.adopt(project, episode, reserve.operation_id, payload, "local-user")
        assert store.get(project, episode, reserve.operation_id).adoption is None
        with sqlite3.connect(repository.database_path) as connection:
            assert (
                connection.execute(
                    "SELECT count(*) FROM artifacts WHERE artifact_type='episode_storyboard'"
                ).fetchone()[0]
                == 0
            )
        assert not store.adopt(project, episode, reserve.operation_id, payload, "local-user")[1]


def test_concurrent_duplicate_reserve_complete_and_adopt_create_one_real_attempt_output(tmp_path):
    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        reserved = list(pool.map(lambda _: store.reserve(project, episode, reserve), range(4)))
        completed = list(pool.map(lambda _: store.complete(project, episode, completion), range(4)))
        payload = adoption_request(completed[0][0])
        adopted = list(
            pool.map(
                lambda _: store.adopt(
                    project, episode, reserve.operation_id, payload, "local-user"
                ),
                range(4),
            )
        )
    assert sum(not replay for _, replay in reserved) == 1
    assert sum(not replay for _, replay in completed) == 1
    assert sum(not replay for _, replay in adopted) == 1
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT count(*) FROM workflow_attempts").fetchone()[0] == 1
        assert (
            connection.execute("SELECT count(*) FROM official_director_adoptions").fetchone()[0]
            == 1
        )


def test_historical_read_uses_frozen_prompt_and_authority_change_blocks_adoption(
    tmp_path, monkeypatch
):
    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(project, episode, completion)
    monkeypatch.setattr("aijian_api.official_director_prompt.PROMPT_VERSION", "future.v2")
    assert store.get(project, episode, reserve.operation_id).request == completed.request
    original = EpisodeScriptStore(repository).get_latest(project_id=project, episode_id=episode)
    updated = original.content.model_dump(mode="json")
    updated["scenes"][0]["blocks"][0]["text"] = "剧本已经修改。"
    EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": updated,
                "parent_version_id": original.version_id,
                "expected_revision": original.head_revision,
                "change_summary": "改稿",
            }
        ),
        idempotency_key="changed-script",
        actor_id="local-user",
    )
    assert store.get(project, episode, reserve.operation_id).proposal == completed.proposal
    with pytest.raises(OfficialDirectorError, match="SCRIPT_STALE"):
        store.adopt(
            project, episode, reserve.operation_id, adoption_request(completed), "local-user"
        )


def test_provider_response_id_cannot_be_reused_for_another_director_operation(tmp_path):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    first, _ = store.complete(project, episode, completion)
    another = ReserveOfficialDirectorRequest(
        **{**reserve.model_dump(mode="json"), "operation_id": str(uuid4())}
    )
    store.reserve(project, episode, another)
    reused = CompleteOfficialDirectorRequest(
        **{**completion.model_dump(mode="json"), "operation_id": another.operation_id}
    )
    with pytest.raises(OfficialDirectorError, match="RESPONSE_CONFLICT"):
        store.complete(project, episode, reused)
    assert store.get(project, episode, another.operation_id).status == "REMOTE_UNKNOWN"
    assert store.get(project, episode, reserve.operation_id).proposal == first.proposal


@pytest.mark.parametrize("phase", ["operation_reserved", "proposal_created", "adoption_recorded"])
def test_actual_process_exit_rolls_back_uncommitted_director_transition(tmp_path, phase):
    import os
    import subprocess
    import sys

    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    adoption = None
    if phase != "operation_reserved":
        store.reserve(project, episode, reserve)
    if phase == "adoption_recorded":
        completed, _ = store.complete(project, episode, completion)
        adoption = adoption_request(completed).model_dump(mode="json")
    child = """
import json, os, sys
from pathlib import Path
from aijian_api.repository import StudioRepository
from aijian_api.official_director_store import OfficialDirectorStore
from aijian_api.official_director_contracts import (
    ReserveOfficialDirectorRequest, CompleteOfficialDirectorRequest, AdoptOfficialDirectorRequest
)
args=json.loads(sys.argv[1])
def terminate(at):
    if at == args['phase']: os._exit(71)
store=OfficialDirectorStore(StudioRepository(Path(args['database'])), transaction_hook=terminate)
if args['phase']=='operation_reserved':
    store.reserve(args['project'],args['episode'],ReserveOfficialDirectorRequest.model_validate(args['reserve']))
elif args['phase']=='proposal_created':
    store.complete(args['project'],args['episode'],CompleteOfficialDirectorRequest.model_validate(args['completion']))
else:
    store.adopt(args['project'],args['episode'],args['reserve']['operation_id'],AdoptOfficialDirectorRequest.model_validate(args['adoption']),'local-user')
"""
    args = {
        "phase": phase,
        "database": str(repository.database_path),
        "project": project,
        "episode": episode,
        "reserve": reserve.model_dump(mode="json"),
        "completion": completion.model_dump(mode="json"),
        "adoption": adoption,
    }
    env = {**os.environ, "PYTHONPATH": "services/api/src"}
    process = subprocess.run(
        [sys.executable, "-c", child, json.dumps(args, ensure_ascii=False)], env=env, check=False
    )
    assert process.returncode == 71
    restarted = OfficialDirectorStore(StudioRepository(repository.database_path))
    if phase == "operation_reserved":
        assert restarted.list(project, episode) == []
        assert not restarted.reserve(project, episode, reserve)[1]
    elif phase == "proposal_created":
        unknown = restarted.get(project, episode, reserve.operation_id)
        assert (
            unknown.status == "REMOTE_UNKNOWN"
            and unknown.completion is None
            and unknown.proposal is None
        )
        assert not restarted.complete(project, episode, completion)[1]
    else:
        unchanged = restarted.get(project, episode, reserve.operation_id)
        assert unchanged.adoption is None and unchanged.proposal is not None
        assert not restarted.adopt(
            project, episode, reserve.operation_id, adoption_request(unchanged), "local-user"
        )[1]
