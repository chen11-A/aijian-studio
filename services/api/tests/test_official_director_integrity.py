"""Fail-closed director history integrity and review/error boundaries."""

import json
import sqlite3
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.official_director_contracts import (
    AdoptOfficialDirectorRequest,
    CompleteOfficialDirectorRequest,
    RejectOfficialDirectorRequest,
    ReserveOfficialDirectorRequest,
)
from aijian_api.official_director_store import OfficialDirectorError
from aijian_api.repository import ArtifactConflictError
from aijian_api.shot_plan_validation import ShotPlanError
from test_official_director_workflow import adoption_request, prepared_case


def corrupt(connection, table, statement, parameters):
    # These tests deliberately remove protection only in their synthetic temporary database.
    triggers = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?", (table,)
    ).fetchall()
    for (name,) in triggers:
        connection.execute(f'DROP TRIGGER "{name}"')
    connection.execute("PRAGMA ignore_check_constraints=ON")
    connection.execute(statement, parameters)


@pytest.mark.parametrize(
    "mutation",
    [
        "request_hash",
        "frozen_proof",
        "completion_hash",
        "completion_identity",
        "missing_completion",
        "proposal_author",
        "status",
        "adoption_identity",
        "adoption_storyboard_hash",
        "rejection_identity",
    ],
)
def test_corrupt_persisted_truth_fails_closed_without_relabeling_or_adoption(tmp_path, mutation):
    repository, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(project, episode, completion)
    if mutation.startswith("adoption"):
        store.adopt(
            project, episode, reserve.operation_id, adoption_request(completed), "local-user"
        )
    if mutation == "rejection_identity":
        store.reject(
            project,
            episode,
            reserve.operation_id,
            RejectOfficialDirectorRequest(
                **adoption_request(completed).model_dump(mode="json"), reason="revise"
            ),
            "local-user",
        )
    with sqlite3.connect(repository.database_path) as connection:
        operation = reserve.operation_id
        if mutation == "request_hash":
            corrupt(
                connection,
                "official_director_operations",
                "UPDATE official_director_operations SET request_hash=? WHERE operation_id=?",
                ("sha256:" + "0" * 64, operation),
            )
        elif mutation == "frozen_proof":
            request = completed.request.model_dump(mode="json")
            request["script_stored_content"]["scenes"][0]["blocks"][0]["text"] = "tampered proof"
            corrupt(
                connection,
                "official_director_operations",
                "UPDATE official_director_operations SET request_json=?,request_hash=? "
                "WHERE operation_id=?",
                (
                    json.dumps(request, ensure_ascii=False),
                    canonical_content_hash(request),
                    operation,
                ),
            )
        elif mutation == "completion_hash":
            corrupt(
                connection,
                "official_director_operations",
                "UPDATE official_director_operations SET completion_hash=? WHERE operation_id=?",
                ("sha256:" + "0" * 64, operation),
            )
        elif mutation == "completion_identity":
            response = completion.model_dump(mode="json")
            response["model"] = "wrong-model"
            corrupt(
                connection,
                "official_director_operations",
                "UPDATE official_director_operations SET completion_json=?,completion_hash=? "
                "WHERE operation_id=?",
                (
                    json.dumps(response, ensure_ascii=False),
                    canonical_content_hash(response),
                    operation,
                ),
            )
        elif mutation == "missing_completion":
            corrupt(
                connection,
                "official_director_operations",
                "UPDATE official_director_operations SET completion_json=NULL,completion_hash=NULL "
                "WHERE operation_id=?",
                (operation,),
            )
        elif mutation == "proposal_author":
            corrupt(
                connection,
                "artifact_versions",
                "UPDATE artifact_versions SET author_actor_type='human' WHERE version_id=?",
                (completed.proposal.version_id,),
            )
        elif mutation == "status":
            corrupt(
                connection,
                "official_director_operations",
                "UPDATE official_director_operations SET status='INVALID' WHERE operation_id=?",
                (operation,),
            )
        elif mutation == "adoption_identity":
            corrupt(
                connection,
                "official_director_adoptions",
                "UPDATE official_director_adoptions SET proposal_content_hash=? "
                "WHERE operation_id=?",
                ("sha256:" + "0" * 64, operation),
            )
        elif mutation == "adoption_storyboard_hash":
            corrupt(
                connection,
                "official_director_adoptions",
                "UPDATE official_director_adoptions SET storyboard_content_hash=? "
                "WHERE operation_id=?",
                ("sha256:" + "0" * 64, operation),
            )
        elif mutation == "rejection_identity":
            corrupt(
                connection,
                "official_director_rejections",
                "UPDATE official_director_rejections SET proposal_content_hash=? "
                "WHERE operation_id=?",
                ("sha256:" + "0" * 64, operation),
            )
    with pytest.raises(OfficialDirectorError, match="STORAGE_FAILED"):
        store.get(project, episode, reserve.operation_id)


def test_scope_not_found_exact_operation_and_duplicate_cross_episode_are_not_mutated(tmp_path):
    repository, project, episode, store, _, _, reserve, _, _ = prepared_case(tmp_path)
    with pytest.raises(OfficialDirectorError, match="SCOPE_NOT_FOUND"):
        store.list("prj_" + "0" * 32, episode)
    with pytest.raises(OfficialDirectorError, match="NOT_FOUND"):
        store.get(project, episode, str(uuid4()))
    store.reserve(project, episode, reserve)
    other = repository.create_episode(project, title="Other episode").id
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.reserve(project, other, reserve)


def test_explicit_review_requires_exact_proposal_and_actor_and_excludes_late_rejection(tmp_path):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(project, episode, completion)
    payload = adoption_request(completed)
    with pytest.raises(OfficialDirectorError, match="IDENTITY_INVALID"):
        store.adopt(project, episode, reserve.operation_id, payload, "")
    with pytest.raises(OfficialDirectorError, match="PROPOSAL_MISMATCH"):
        store.adopt(
            project,
            episode,
            reserve.operation_id,
            AdoptOfficialDirectorRequest(
                **{**payload.model_dump(mode="json"), "proposal_content_hash": "sha256:" + "0" * 64}
            ),
            "local-user",
        )
    store.adopt(project, episode, reserve.operation_id, payload, "local-user")
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.adopt(project, episode, reserve.operation_id, payload, "another-actor")
    with pytest.raises(OfficialDirectorError, match="ALREADY_ADOPTED"):
        store.reject(
            project,
            episode,
            reserve.operation_id,
            RejectOfficialDirectorRequest(**payload.model_dump(mode="json"), reason="late"),
            "local-user",
        )


def test_new_proposal_head_blocks_old_adoption_and_conflicting_completion_is_never_overwritten(
    tmp_path,
):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    first, _ = store.complete(project, episode, completion)
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.complete(
            project,
            episode,
            CompleteOfficialDirectorRequest(
                **{**completion.model_dump(mode="json"), "text": "changed known result"}
            ),
        )
    second = ReserveOfficialDirectorRequest(
        **{**reserve.model_dump(mode="json"), "operation_id": str(uuid4())}
    )
    store.reserve(project, episode, second)
    store.complete(
        project,
        episode,
        CompleteOfficialDirectorRequest(
            **{
                **completion.model_dump(mode="json"),
                "operation_id": second.operation_id,
                "response_id": "resp_new",
            }
        ),
    )
    with pytest.raises(OfficialDirectorError, match="PROPOSAL_STALE"):
        store.adopt(project, episode, reserve.operation_id, adoption_request(first), "local-user")
    assert store.get(project, episode, reserve.operation_id).proposal == first.proposal


@pytest.mark.parametrize(
    "error",
    [
        ShotPlanError("SHOT_PLAN_STORAGE_FAILED", 500),
        ArtifactConflictError("concurrent storage revision"),
    ],
)
def test_storage_fault_during_completion_preserves_unknown_and_never_creates_retry(
    tmp_path, monkeypatch, error
):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)

    def fail(*args, **kwargs):
        raise error

    if isinstance(error, ShotPlanError):
        monkeypatch.setattr("aijian_api.official_director_completion.validate_plan", fail)
    else:
        monkeypatch.setattr(store.repository, "create_artifact_version", fail)
    with pytest.raises(OfficialDirectorError):
        store.complete(project, episode, completion)
    assert store.get(project, episode, reserve.operation_id).status == "REMOTE_UNKNOWN"


def test_projection_failure_after_review_rolls_back_before_storyboard_write(tmp_path, monkeypatch):
    _, project, episode, store, _, _, reserve, _, completion = prepared_case(tmp_path)
    store.reserve(project, episode, reserve)
    completed, _ = store.complete(project, episode, completion)

    def unsupported(*args):
        raise ValueError("future projection unsupported")

    monkeypatch.setattr("aijian_api.official_director_adoption.project_storyboard", unsupported)
    with pytest.raises(OfficialDirectorError, match="PROJECTION_UNSUPPORTED"):
        store.adopt(
            project, episode, reserve.operation_id, adoption_request(completed), "local-user"
        )
    assert store.get(project, episode, reserve.operation_id).adoption is None


def test_parser_rejects_implicit_normalization_and_complete_artifact_byte_overflow(
    tmp_path, monkeypatch
):
    import copy

    from aijian_api.official_director_completion import parse_plan
    from aijian_api.official_director_contracts import OfficialDirectorContentV1

    _, _, _, _, _, _, _, content, _ = prepared_case(tmp_path)
    canonical = OfficialDirectorContentV1.model_validate(content)
    normalized = canonical.model_copy(update={"visual_constraints": ("implicitly normalized",)})
    with monkeypatch.context() as context:
        context.setattr(OfficialDirectorContentV1, "model_validate", lambda value: normalized)
        with pytest.raises(ValueError, match="exact typed contract"):
            parse_plan(json.dumps(content, ensure_ascii=False))
    oversized = copy.deepcopy(content)
    template = oversized["shots"][0]
    template["narrative_purpose"] = "x" * 4000
    oversized["shots"] = [
        {**template, "shot_id": f"shp_{number:032x}", "ordinal": number} for number in range(1, 501)
    ]
    with pytest.raises(ValueError, match="artifact byte ceiling"):
        parse_plan(json.dumps(oversized, ensure_ascii=False))


@pytest.mark.parametrize(
    "field,value",
    [("response_id", " "), ("model", "\x00"), ("completed_at", "2026-10-08T23:00:00.000")],
)
def test_completion_metadata_requires_meaningful_identity_safe_unicode_and_timezone(
    tmp_path, field, value
):
    from pydantic import ValidationError

    _, _, _, _, _, _, _, _, completion = prepared_case(tmp_path)
    with pytest.raises(ValidationError):
        CompleteOfficialDirectorRequest.model_validate(
            {**completion.model_dump(mode="json"), field: value}
        )


def test_intent_and_rejection_reason_cannot_be_blank(tmp_path):
    from aijian_api.official_director_contracts import PrepareOfficialDirectorRequest
    from pydantic import ValidationError

    _, _, _, _, payload, _, _, _, _ = prepared_case(tmp_path)
    with pytest.raises(ValidationError):
        PrepareOfficialDirectorRequest.model_validate(
            {**payload.model_dump(mode="json"), "intent": " "}
        )
    with pytest.raises(ValidationError):
        RejectOfficialDirectorRequest(
            proposal_version_id="ver_" + "a" * 32,
            proposal_content_hash="sha256:" + "a" * 64,
            confirm=True,
            reason=" ",
        )


def test_changed_storyboard_and_corrupt_input_proof_fail_before_reservation(tmp_path, monkeypatch):
    from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
    from test_episode_storyboard import payload as storyboard_payload

    repository, project, episode, store, payload, _, _, _, _ = prepared_case(tmp_path)
    with monkeypatch.context() as context:
        context.setattr(
            "aijian_api.official_director_prompt.canonical_content_hash",
            lambda value: "sha256:" + "0" * 64,
        )
        with pytest.raises(OfficialDirectorError, match="STORAGE_FAILED"):
            store.prepare(project, episode, payload)
    EpisodeStoryboardStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=storyboard_payload(project, episode),
        idempotency_key="manual",
        actor_id="local-user",
    )
    with pytest.raises(OfficialDirectorError, match="STORYBOARD_STALE"):
        store.prepare(project, episode, payload)
    assert store.list(project, episode) == []


def test_unknown_proof_survives_io_failure_and_not_sent_conflict(tmp_path):
    from aijian_api.official_director_store import OfficialDirectorStore

    repository, project, episode, store, _, _, reserve, _, _ = prepared_case(tmp_path)

    def fail(phase):
        raise OSError("interrupted I/O")

    failing = OfficialDirectorStore(repository, transaction_hook=fail)
    with pytest.raises(OSError, match="interrupted"):
        failing.reserve(project, episode, reserve)
    assert store.list(project, episode) == []
    store.reserve(project, episode, reserve)
    store.not_sent(project, episode, reserve.operation_id, "USER_CANCELLED")
    with pytest.raises(OfficialDirectorError, match="OPERATION_CONFLICT"):
        store.not_sent(project, episode, reserve.operation_id, "DIFFERENT_CAUSE")
