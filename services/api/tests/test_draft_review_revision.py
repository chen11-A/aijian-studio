"""Manual revision lifecycle and fail-closed evidence; no provider execution."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from aijian_api.draft_review_revision_contracts import (
    ApproveDraftReviewRevisionPlanRequest,
    AttachDraftReviewRevisionCandidateRequest,
    CreateDraftReviewRevisionPlanRequest,
    RecheckDraftReviewRevisionCandidateRequest,
)
from aijian_api.draft_review_revision_schema import DRAFT_REVIEW_REVISION_MIGRATION
from aijian_api.draft_review_revision_store import (
    DraftReviewRevisionError,
    DraftReviewRevisionStore,
)
from aijian_api.draft_review_store import DraftReviewError, DraftReviewStore
from aijian_api.episode_media_assembly_contracts import CreateEpisodeMediaAssemblyVersionRequest
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from pydantic import ValidationError
from test_draft_export_runtime import request_for, wait_final
from test_draft_review_notes import command, resolution
from test_draft_review_notes import saved as saved


def identity(job):
    return {
        key: getattr(job, key)
        for key in ("assembly_version_id", "assembly_content_hash", "output_sha256", "output_bytes")
    }


@pytest.fixture
def revision(saved):
    repository, runtime, project, episode, assembly, job, asset = saved
    # Standalone worker checkout has schema40. Integrated parent registers42 after41.
    with repository._connection() as connection:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE name='draft_review_revision_plans'"
        ).fetchone()
        if exists is None:
            for statement in DRAFT_REVIEW_REVISION_MIGRATION:
                connection.execute(statement)
            connection.commit()
    notes = DraftReviewStore(repository, runtime)
    note = command(job)
    notes.create(project, episode, job.operation_id, note, "human")
    store = DraftReviewRevisionStore(repository, runtime)
    plan = CreateDraftReviewRevisionPlanRequest(
        **identity(job),
        plan_id="drp_" + uuid4().hex,
        note_ids=[note.note_id],
        affected_segment_ids=["seg_a"],
        instruction="手工核对动作并修改构图。",
    )
    return store, notes, note, plan, saved


def approve(store, project, episode, operation, entry):
    request = ApproveDraftReviewRevisionPlanRequest(
        approval_id="dra_" + uuid4().hex, expected_plan_hash=entry.plan.plan_hash
    )
    data = store.approve(project, episode, operation, entry.plan.plan_id, request, "human")
    return data.plans[0], request


def later_output(saved, tmp_path):
    repository, runtime, project, episode, assembly, job, asset = saved
    updated = EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=assembly.content.model_copy(update={"canvas_width": 180}),
            parent_version_id=assembly.version_id,
            expected_revision=assembly.head_revision,
            change_summary="Manual composition",
        ),
        author_actor_id="human",
    )
    request = request_for(updated, tmp_path / (uuid4().hex + "-DRAFT.mp4"))
    runtime.submit(project, episode, request)
    output = wait_final(runtime, project, episode, request.operation_id)
    assert output.status == "SUCCEEDED"
    return updated, output


def attach_command(entry, output):
    return AttachDraftReviewRevisionCandidateRequest(
        **identity(output),
        candidate_id="drc_" + uuid4().hex,
        expected_plan_hash=entry.plan.plan_hash,
        approval_id=entry.approval.approval_id,
        candidate_operation_id=output.operation_id,
        change_summary="手工修改画幅，待对照复查。",
    )


def test_complete_manual_lifecycle_and_preserved_history(revision, tmp_path):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    source_job_before = dict(
        store.review._job(next_connection := repository._open(), project, episode, job.operation_id)
    )
    next_connection.close()
    data = store.create(project, episode, job.operation_id, plan, "human")
    assert data.plans[0].approval is None and data.plans[0].candidates == []
    assert store.create(project, episode, job.operation_id, plan, "human") == data
    entry, approval = approve(store, project, episode, job.operation_id, data.plans[0])
    assert (
        store.approve(project, episode, job.operation_id, plan.plan_id, approval, "human").plans[0]
        == entry
    )
    updated, output = later_output(saved, tmp_path)
    candidate = attach_command(entry, output)
    data = store.attach(project, episode, job.operation_id, plan.plan_id, candidate, "human")
    candidate_entry = data.plans[0].candidates[0]
    assert candidate_entry.candidate.target.assembly_version_id == updated.version_id
    assert candidate_entry.candidate.comparison.sequence_settings_changed
    assert candidate_entry.candidate.comparison.unchanged_segment_ids == ["seg_a"]
    assert (
        store.attach(project, episode, job.operation_id, plan.plan_id, candidate, "human") == data
    )
    recheck = RecheckDraftReviewRevisionCandidateRequest(
        recheck_id="drk_" + uuid4().hex,
        expected_candidate_hash=candidate_entry.candidate.candidate_hash,
        outcome="MANUALLY_CHECKED",
        reason="已人工对照原版和新草稿。",
    )
    data = store.recheck(
        project, episode, job.operation_id, plan.plan_id, candidate.candidate_id, recheck, "human"
    )
    assert data.plans[0].candidates[0].recheck.outcome == "MANUALLY_CHECKED"
    assert (
        store.recheck(
            project,
            episode,
            job.operation_id,
            plan.plan_id,
            candidate.candidate_id,
            recheck,
            "human",
        )
        == data
    )
    notes.resolve(project, episode, job.operation_id, note.note_id, resolution(job), "human")
    assert store.list(project, episode, job.operation_id).plans[0].plan.notes[0].text == note.text
    reopened = DraftReviewRevisionStore(repository, runtime)
    assert reopened.list(project, episode, job.operation_id) == data
    with repository._connection() as connection:
        assert (
            dict(store.review._job(connection, project, episode, job.operation_id))
            == source_job_before
        )
        assert (
            connection.execute(
                "SELECT note_json FROM draft_review_notes WHERE note_id=?", (note.note_id,)
            )
            .fetchone()[0]
            .find(note.text)
            >= 0
        )
        for table in (
            "review_submissions",
            "role_signoffs",
            "gate_decisions",
            "media_asset_rights_decisions",
        ):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_approval_is_distinct_and_preexisting_candidate_rejected(revision, tmp_path):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    data = store.create(project, episode, job.operation_id, plan, "human")
    updated, output = later_output(saved, tmp_path)
    fake = AttachDraftReviewRevisionCandidateRequest(
        **identity(output),
        candidate_id="drc_" + uuid4().hex,
        expected_plan_hash=data.plans[0].plan.plan_hash,
        approval_id="dra_" + uuid4().hex,
        candidate_operation_id=output.operation_id,
        change_summary="comparison",
    )
    with pytest.raises(DraftReviewRevisionError, match="EXPLICIT_APPROVAL_REQUIRED"):
        store.attach(project, episode, job.operation_id, plan.plan_id, fake, "human")
    entry, approval = approve(store, project, episode, job.operation_id, data.plans[0])
    with pytest.raises(DraftReviewRevisionError, match="CANDIDATE_NOT_LATER"):
        store.attach(
            project, episode, job.operation_id, plan.plan_id, attach_command(entry, output), "human"
        )
    with pytest.raises(DraftReviewRevisionError, match="CANDIDATE_NOT_LATER"):
        store.attach(
            project, episode, job.operation_id, plan.plan_id, attach_command(entry, job), "human"
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"note_ids": []},
        {"affected_segment_ids": []},
        {"note_ids": ["drn_" + "a" * 32] * 2},
        {"affected_segment_ids": ["seg_a"] * 2},
        {"instruction": "  "},
        {"instruction": "bad\0text"},
        {"note_ids": ["../path"]},
        {"affected_segment_ids": ["/local/file"]},
        {"instruction": "x" * 2001},
    ],
)
def test_closed_bounded_commands(revision, changes):
    store, notes, note, plan, saved = revision
    with pytest.raises(ValidationError):
        CreateDraftReviewRevisionPlanRequest.model_validate({**plan.model_dump(), **changes})


def test_wrong_scope_selections_hash_and_reused_ids(revision):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    for changes in ({"note_ids": ["drn_" + "a" * 32]}, {"affected_segment_ids": ["seg_missing"]}):
        with pytest.raises(DraftReviewRevisionError, match="SELECTION_NOT_FOUND"):
            store.create(
                project, episode, job.operation_id, plan.model_copy(update=changes), "human"
            )
    data = store.create(project, episode, job.operation_id, plan, "human")
    with pytest.raises(DraftReviewRevisionError, match="ID_REUSED"):
        store.create(
            project,
            episode,
            job.operation_id,
            plan.model_copy(update={"instruction": "changed"}),
            "human",
        )
    with pytest.raises(DraftReviewRevisionError, match="PLAN_HASH_MISMATCH"):
        store.approve(
            project,
            episode,
            job.operation_id,
            plan.plan_id,
            ApproveDraftReviewRevisionPlanRequest(
                approval_id="dra_" + uuid4().hex, expected_plan_hash="sha256:" + "0" * 64
            ),
            "human",
        )
    with pytest.raises(DraftReviewError, match="DRAFT_REVIEW_NOT_FOUND"):
        store.list(project, "ep_" + "a" * 32, job.operation_id)
    assert store.list(project, episode, job.operation_id) == data


def test_parallel_identical_create_one_event(revision):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: store.create(project, episode, job.operation_id, plan, "human"), range(2)
            )
        )
    assert results[0] == results[1]
    assert len(results[0].plans) == 1


def test_missing_bytes_preserve_history_and_fail_closed(revision, tmp_path):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    data = store.create(project, episode, job.operation_id, plan, "human")
    entry, approval = approve(store, project, episode, job.operation_id, data.plans[0])
    updated, output = later_output(saved, tmp_path)
    candidate = attach_command(entry, output)
    data = store.attach(project, episode, job.operation_id, plan.plan_id, candidate, "human")
    from pathlib import Path

    Path(output.output_path).unlink()
    before = None
    with repository._connection() as connection:
        before = dict(store.review._job(connection, project, episode, output.operation_id))
    history = store.list(project, episode, job.operation_id)
    assert history.plans[0].candidates[0].output_verified is False
    check = RecheckDraftReviewRevisionCandidateRequest(
        recheck_id="drk_" + uuid4().hex,
        expected_candidate_hash=data.plans[0].candidates[0].candidate.candidate_hash,
        outcome="NEEDS_MORE_WORK",
        reason="missing file",
    )
    with pytest.raises(DraftReviewRevisionError, match="OUTPUT_UNAVAILABLE"):
        store.recheck(
            project, episode, job.operation_id, plan.plan_id, candidate.candidate_id, check, "human"
        )
    Path(job.output_path).unlink()
    assert store.list(project, episode, job.operation_id).output_verified is False
    with pytest.raises(DraftReviewRevisionError, match="OUTPUT_UNAVAILABLE"):
        store.create(
            project,
            episode,
            job.operation_id,
            plan.model_copy(update={"plan_id": "drp_" + uuid4().hex}),
            "human",
        )
    with repository._connection() as connection:
        assert dict(store.review._job(connection, project, episode, output.operation_id)) == before


def test_immutable_triggers_and_corruption_rejected(revision):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    store.create(project, episode, job.operation_id, plan, "human")
    with repository._connection() as connection:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("UPDATE draft_review_revision_plans SET event_json='{}'")
        with pytest.raises(sqlite3.IntegrityError, match="preserved"):
            connection.execute("DELETE FROM draft_review_revision_plan_notes")
        connection.execute("DROP TRIGGER draft_review_revision_plans_immutable")
        connection.execute(
            "UPDATE draft_review_revision_plans SET event_hash=?", ("sha256:" + "0" * 64,)
        )
        connection.commit()
    with pytest.raises(DraftReviewRevisionError, match="HISTORY_CORRUPT"):
        store.list(project, episode, job.operation_id)


def test_output_changes_between_read_and_mutation_gate(revision, monkeypatch):
    from pathlib import Path

    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    original = store._verified

    def remove_before_gate(connection, target, verified):
        Path(job.output_path).unlink()
        return original(connection, target, verified)

    monkeypatch.setattr(store, "_verified", remove_before_gate)
    with repository._connection() as connection:
        before = dict(store.review._job(connection, project, episode, job.operation_id))
    with pytest.raises(DraftReviewRevisionError, match="OUTPUT_UNAVAILABLE"):
        store.create(project, episode, job.operation_id, plan, "human")
    with repository._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM draft_review_revision_plans").fetchone()[0]
            == 0
        )
        assert dict(store.review._job(connection, project, episode, job.operation_id)) == before


def test_junction_scope_corruption_fails_closed(revision):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    store.create(project, episode, job.operation_id, plan, "human")
    with repository._connection() as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("DROP TRIGGER draft_review_revision_plan_notes_immutable")
        connection.execute("UPDATE draft_review_revision_plan_notes SET episode_id='corrupt'")
        connection.commit()
    with pytest.raises(DraftReviewRevisionError, match="HISTORY_CORRUPT"):
        store.list(project, episode, job.operation_id)


@pytest.mark.parametrize("change", ["invalid-json", "wrong-hash", "wrong-frames", "incomplete"])
def test_saved_export_proof_corruption_fails_closed_without_job_writes(revision, change):
    import json

    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    with repository._connection() as connection:
        row = store.review._job(connection, project, episode, job.operation_id)
        proof = json.loads(row["verification_json"])
        if change == "incomplete":
            connection.execute(
                "UPDATE draft_export_jobs SET progress_frames=0 WHERE operation_id=?",
                (job.operation_id,),
            )
        else:
            if change == "wrong-hash":
                proof["sha256"] = "0" * 64
            if change == "wrong-frames":
                proof["frames"] = 1
            connection.execute(
                "UPDATE draft_export_jobs SET verification_json=? WHERE operation_id=?",
                ("invalid" if change == "invalid-json" else json.dumps(proof), job.operation_id),
            )
        connection.commit()
        before = dict(store.review._job(connection, project, episode, job.operation_id))
    with pytest.raises(DraftReviewRevisionError, match="TARGET_CORRUPT"):
        store.list(project, episode, job.operation_id)
    with repository._connection() as connection:
        assert dict(store.review._job(connection, project, episode, job.operation_id)) == before


def test_candidate_scope_corruption_fails_closed(revision, tmp_path):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    data = store.create(project, episode, job.operation_id, plan, "human")
    entry, approval = approve(store, project, episode, job.operation_id, data.plans[0])
    updated, output = later_output(saved, tmp_path)
    candidate = attach_command(entry, output)
    store.attach(project, episode, job.operation_id, plan.plan_id, candidate, "human")
    with repository._connection() as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("DROP TRIGGER draft_review_revision_candidates_immutable")
        connection.execute("UPDATE draft_review_revision_candidates SET project_id='corrupt'")
        connection.commit()
    with pytest.raises(DraftReviewRevisionError, match="HISTORY_CORRUPT"):
        store.list(project, episode, job.operation_id)


def test_native_revision_routes_auth_closed_commands_and_durable_readback(revision):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    host, token = "127.0.0.1:43123", "r" * 43
    path = (
        f"/api/v1/projects/{project}/episodes/{episode}"
        f"/draft-exports/{job.operation_id}/revision-plans"
    )
    app = create_app(
        repository=repository,
        draft_export_runtime=runtime,
        sidecar_security=SidecarSecurity(token=token, host=host),
    )
    with TestClient(app, base_url=f"http://{host}", client=("127.0.0.1", 1234)) as client:
        assert client.get(path).status_code == 401
        headers = {"Authorization": f"Bearer {token}", "Origin": "app://aijian"}
        assert (
            client.get(path, headers={**headers, "Origin": "https://evil.example"}).status_code
            == 403
        )
        assert (
            client.post(
                path, headers=headers, json={**plan.model_dump(), "generate": True}
            ).status_code
            == 422
        )
        scope = client.get(path + "/scope", headers=headers)
        assert scope.status_code == 200
        assert scope.json()["data"]["segments"][0]["segment_id"] == "seg_a"
        created = client.post(path, headers=headers, json=plan.model_dump())
        assert created.status_code == 200, created.text
        assert created.json()["data"]["plans"][0]["plan"]["actor_id"] == "local-user"
        assert created.json()["data"]["plans"][0]["approval"] is None
        assert client.get(path, headers=headers).json()["data"] == created.json()["data"]
    with TestClient(create_app(repository=repository)) as public:
        assert public.get(path).status_code == 404


def test_integrated_schema42_upgrade_rollback_after_director41(tmp_path):
    from aijian_api.repository import SCHEMA_VERSION, StudioRepository
    from test_migrations import database_version, migrate_through

    path = tmp_path / "before-revision.db"
    migrate_through(path, 41)

    def interrupt(version, step):
        if version == 42 and step == 3:
            raise RuntimeError("interrupt manual revision migration")

    with pytest.raises(RuntimeError, match="interrupt manual revision migration"):
        StudioRepository(path, migration_hook=interrupt)
    assert database_version(path) == 41
    with sqlite3.connect(path) as connection:
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name='draft_review_revision_plans'"
            ).fetchone()
            is None
        )
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name='draft_review_notes'"
            ).fetchone()
            is not None
        )
    StudioRepository(path)
    assert database_version(path) == SCHEMA_VERSION
    StudioRepository(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_note_must_lie_in_selected_original_segment(revision, tmp_path):
    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    first = assembly.content.visual_segments[0]
    content = assembly.content.model_copy(
        update={
            "visual_segments": (
                first.model_copy(update={"end_frame": 12}),
                first.model_copy(update={"segment_id": "seg_b", "start_frame": 12}),
            )
        }
    )
    source = EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=content,
            parent_version_id=assembly.version_id,
            expected_revision=assembly.head_revision,
            change_summary="Manual split",
        ),
        author_actor_id="human",
    )
    export = request_for(source, tmp_path / "SPLIT-SOURCE-DRAFT.mp4")
    runtime.submit(project, episode, export)
    output = wait_final(runtime, project, episode, export.operation_id)
    assert output.status == "SUCCEEDED"
    selected = command(output, frame_index=12)
    notes.create(project, episode, output.operation_id, selected, "human")
    invalid = CreateDraftReviewRevisionPlanRequest(
        **identity(output),
        plan_id="drp_" + uuid4().hex,
        note_ids=[selected.note_id],
        affected_segment_ids=["seg_a"],
        instruction="Only first segment",
    )
    with pytest.raises(DraftReviewRevisionError, match="NOTE_OUTSIDE_SEGMENTS"):
        store.create(project, episode, output.operation_id, invalid, "human")
    valid = invalid.model_copy(update={"affected_segment_ids": ["seg_b"]})
    assert (
        store.create(project, episode, output.operation_id, valid, "human")
        .plans[0]
        .plan.notes[0]
        .frame_index
        == 12
    )


def test_all_event_retries_survive_missing_bytes_and_reused_ids_conflict(revision, tmp_path):
    from pathlib import Path

    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    data = store.create(project, episode, job.operation_id, plan, "human")
    entry, approval = approve(store, project, episode, job.operation_id, data.plans[0])
    updated, output = later_output(saved, tmp_path)
    attached = attach_command(entry, output)
    data = store.attach(project, episode, job.operation_id, plan.plan_id, attached, "human")
    candidate = data.plans[0].candidates[0].candidate
    checked = RecheckDraftReviewRevisionCandidateRequest(
        recheck_id="drk_" + uuid4().hex,
        expected_candidate_hash=candidate.candidate_hash,
        outcome="NEEDS_MORE_WORK",
        reason="More manual work needed",
    )
    store.recheck(
        project, episode, job.operation_id, plan.plan_id, candidate.candidate_id, checked, "human"
    )
    with pytest.raises(DraftReviewRevisionError, match="ID_REUSED"):
        store.attach(
            project,
            episode,
            job.operation_id,
            plan.plan_id,
            attached.model_copy(update={"change_summary": "different"}),
            "human",
        )
    with pytest.raises(DraftReviewRevisionError, match="ID_REUSED"):
        store.recheck(
            project,
            episode,
            job.operation_id,
            plan.plan_id,
            candidate.candidate_id,
            checked.model_copy(update={"reason": "different"}),
            "human",
        )
    Path(job.output_path).unlink()
    Path(output.output_path).unlink()
    assert (
        store.create(project, episode, job.operation_id, plan, "human").plans[0].plan.plan_id
        == plan.plan_id
    )
    assert (
        store.approve(project, episode, job.operation_id, plan.plan_id, approval, "human")
        .plans[0]
        .approval.approval_id
        == approval.approval_id
    )
    assert (
        store.attach(project, episode, job.operation_id, plan.plan_id, attached, "human")
        .plans[0]
        .candidates[0]
        .candidate.candidate_id
        == attached.candidate_id
    )
    assert (
        store.recheck(
            project,
            episode,
            job.operation_id,
            plan.plan_id,
            candidate.candidate_id,
            checked,
            "human",
        )
        .plans[0]
        .candidates[0]
        .recheck.recheck_id
        == checked.recheck_id
    )
    with repository._connection() as connection:
        for table in ("plans", "approvals", "candidates", "rechecks"):
            assert (
                connection.execute(
                    f"SELECT COUNT(*) FROM draft_review_revision_{table}"
                ).fetchone()[0]
                == 1
            )


def test_history_size_budget_rejects_before_commit(revision, monkeypatch):
    import aijian_api.draft_review_revision_store as module

    store, notes, note, plan, saved = revision
    repository, runtime, project, episode, assembly, job, asset = saved
    monkeypatch.setattr(module, "canonical_content_bytes", lambda _: b"x" * (12 * 1024 * 1024 + 1))
    with pytest.raises(DraftReviewRevisionError, match="HISTORY_LIMIT"):
        store.create(project, episode, job.operation_id, plan, "human")
    with repository._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM draft_review_revision_plans").fetchone()[0]
            == 0
        )
