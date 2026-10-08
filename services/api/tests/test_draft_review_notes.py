"""Real draft receipt binding, append-only history, restart and release isolation."""

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.draft_review_contracts import (
    CreateDraftReviewNoteRequest,
    ResolveDraftReviewNoteRequest,
)
from aijian_api.draft_review_store import DraftReviewError, DraftReviewStore
from aijian_api.episode_media_assembly_contracts import CreateEpisodeMediaAssemblyVersionRequest
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.main import create_app
from aijian_api.repository import SCHEMA_VERSION, StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from pydantic import ValidationError
from test_draft_export_runtime import fixture, request_for, toolchain, wait_final
from test_migrations import database_version, migrate_through


@pytest.fixture
def saved(tmp_path):
    repository, project, episode, asset, assembly = fixture(tmp_path)
    runtime = DraftExportRuntime(repository, toolchain)
    request = request_for(assembly, tmp_path / "REVIEW-DRAFT.mp4")
    runtime.submit(project, episode, request)
    job = wait_final(runtime, project, episode, request.operation_id)
    assert job.status == "SUCCEEDED", job
    yield repository, runtime, project, episode, assembly, job, asset
    runtime.join_workers()


def command(job, **changes):
    return CreateDraftReviewNoteRequest(
        **{
            "note_id": "drn_" + uuid4().hex,
            "assembly_version_id": job.assembly_version_id,
            "assembly_content_hash": job.assembly_content_hash,
            "output_sha256": job.output_sha256,
            "output_bytes": job.output_bytes,
            "frame_index": 12,
            "text": "检查该帧的动作连续性。",
            **changes,
        }
    )


def resolution(job, **changes):
    return ResolveDraftReviewNoteRequest(
        **{
            "resolution_id": "drr_" + uuid4().hex,
            "assembly_version_id": job.assembly_version_id,
            "assembly_content_hash": job.assembly_content_hash,
            "output_sha256": job.output_sha256,
            "output_bytes": job.output_bytes,
            "expected_revision": 1,
            "reason": "已核对，该评论已处理；不代表发布批准。",
            **changes,
        }
    )


def test_reopen_exact_frame_identity_idempotency_and_resolve_no_release(saved):
    repository, runtime, project, episode, assembly, job, _asset = saved
    store = DraftReviewStore(repository, runtime)
    request = command(job)
    result = store.create(project, episode, job.operation_id, request, "local-reviewer")
    assert result.manual_review_only and result.output_verified
    assert result.target.assembly_content_hash == assembly.content_hash
    assert result.target.frame_rate_num == 24 and result.target.frame_rate_den == 1
    assert result.notes[0].frame_index == 12
    assert result.notes[0].actor_id == "local-reviewer"
    assert len(store.create(project, episode, job.operation_id, request, "other").notes) == 1
    reopened = DraftReviewStore(StudioRepository(repository.database_path), runtime)
    assert reopened.list(project, episode, job.operation_id) == result
    resolved = resolution(job)
    updated = reopened.resolve(project, episode, job.operation_id, request.note_id, resolved, "me")
    assert updated.notes[0].revision == 2
    assert updated.notes[0].text == request.text
    assert updated.notes[0].resolution.resolution_id == resolved.resolution_id
    assert (
        reopened.resolve(project, episode, job.operation_id, request.note_id, resolved, "me")
        == updated
    )
    with pytest.raises(DraftReviewError, match="REVISION_CONFLICT"):
        store.resolve(project, episode, job.operation_id, request.note_id, resolution(job), "me")
    with repository._connection() as connection:
        for table in (
            "review_submissions",
            "review_findings",
            "role_signoffs",
            "gate_decisions",
            "media_asset_rights_decisions",
        ):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            connection.execute("UPDATE draft_review_notes SET note_json='{}'")
        with pytest.raises(sqlite3.IntegrityError, match="preserved"):
            connection.execute("DELETE FROM draft_review_resolutions")


def test_new_assembly_and_new_output_preserve_older_notes(saved, tmp_path):
    repository, runtime, project, episode, assembly, job, _asset = saved
    store = DraftReviewStore(repository, runtime)
    note = command(job)
    store.create(project, episode, job.operation_id, note, "me")
    newer = EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=assembly.content.model_copy(update={"canvas_width": 90, "canvas_height": 160}),
            parent_version_id=assembly.version_id,
            expected_revision=assembly.head_revision,
            change_summary="Portrait revision",
        ),
        author_actor_id="me",
    )
    old = store.list(project, episode, job.operation_id)
    assert old.version_status == "OLDER_VERSION"
    assert old.current_assembly_version_id == newer.version_id
    assert old.target.assembly_version_id == assembly.version_id
    assert old.notes[0].note_id == note.note_id
    new_request = request_for(newer, tmp_path / "NEW-REVIEW-DRAFT.mp4")
    runtime.submit(project, episode, new_request)
    assert wait_final(runtime, project, episode, new_request.operation_id).status == "SUCCEEDED"
    current = store.list(project, episode, new_request.operation_id)
    assert current.version_status == "CURRENT" and current.notes == []
    assert store.list(project, episode, job.operation_id).notes == old.notes


@pytest.mark.parametrize(
    "change",
    [
        {"assembly_version_id": "ver_" + "a" * 32},
        {"assembly_content_hash": "sha256:" + "a" * 64},
        {"output_sha256": "a" * 64},
        {"output_bytes": 1},
        {"frame_index": 24},
    ],
)
def test_rejects_forged_target_and_out_of_range_frame(saved, change):
    repository, runtime, project, episode, _assembly, job, _asset = saved
    store = DraftReviewStore(repository, runtime)
    with pytest.raises(DraftReviewError):
        store.create(project, episode, job.operation_id, command(job, **change), "me")
    assert store.list(project, episode, job.operation_id).notes == []


def test_scope_duplicate_id_conflicts_and_resolution_identity(saved):
    repository, runtime, project, episode, _assembly, job, _asset = saved
    store = DraftReviewStore(repository, runtime)
    request = command(job)
    store.create(project, episode, job.operation_id, request, "me")
    with pytest.raises(DraftReviewError, match="ID_REUSED"):
        store.create(
            project, episode, job.operation_id, request.model_copy(update={"text": "Changed"}), "me"
        )
    other = repository.create_episode(project, title="Other")
    with pytest.raises(DraftReviewError, match="NOT_FOUND"):
        store.list(project, other.id, job.operation_id)
    with pytest.raises(DraftReviewError, match="TARGET_MISMATCH"):
        store.resolve(
            project,
            episode,
            job.operation_id,
            request.note_id,
            resolution(job, output_sha256="b" * 64),
            "me",
        )
    assert store.list(project, episode, job.operation_id).notes[0].revision == 1


def test_missing_output_retains_history_blocks_new_notes_and_allows_original_resolution(saved):
    repository, runtime, project, episode, _assembly, job, _asset = saved
    store = DraftReviewStore(repository, runtime)
    request = command(job)
    store.create(project, episode, job.operation_id, request, "me")
    Path(job.output_path).unlink()
    read = store.list(project, episode, job.operation_id)
    assert not read.output_verified and read.notes[0].note_id == request.note_id
    assert read.target.output_sha256 == job.output_sha256
    with pytest.raises(DraftReviewError, match="OUTPUT_UNAVAILABLE"):
        store.create(project, episode, job.operation_id, command(job), "me")
    assert len(store.create(project, episode, job.operation_id, request, "me").notes) == 1
    assert (
        store.resolve(project, episode, job.operation_id, request.note_id, resolution(job), "me")
        .notes[0]
        .revision
        == 2
    )


def test_corrupt_note_readback_fails_closed(saved):
    repository, runtime, project, episode, _assembly, job, _asset = saved
    store = DraftReviewStore(repository, runtime)
    store.create(project, episode, job.operation_id, command(job), "me")
    with repository._connection() as connection:
        connection.execute("DROP TRIGGER draft_review_note_immutable")
        connection.execute("UPDATE draft_review_notes SET note_hash='corrupt'")
        connection.commit()
    with pytest.raises(DraftReviewError, match="HISTORY_CORRUPT"):
        store.list(project, episode, job.operation_id)


def test_native_routes_auth_closed_input_and_readback(saved):
    repository, runtime, project, episode, _assembly, job, _asset = saved
    host, token = "127.0.0.1:43123", "d" * 43
    path = (
        f"/api/v1/projects/{project}/episodes/{episode}"
        f"/draft-exports/{job.operation_id}/review-notes"
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
        request = command(job)
        assert (
            client.post(
                path, headers=headers, json={**request.model_dump(), "approved": True}
            ).status_code
            == 422
        )
        saved_response = client.post(path, headers=headers, json=request.model_dump())
        assert saved_response.status_code == 200, saved_response.text
        assert saved_response.json()["data"]["notes"][0]["actor_id"] == "local-user"
        assert client.get(path, headers=headers).json()["data"] == saved_response.json()["data"]
        resolved = client.post(
            path + f"/{request.note_id}/resolutions",
            headers=headers,
            json=resolution(job).model_dump(),
        )
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["data"]["notes"][0]["revision"] == 2
    with TestClient(create_app(repository=repository)) as public:
        assert public.get(path).status_code == 404


def test_schema38_upgrade_and_transactional_rollback(tmp_path):
    path = tmp_path / "old.db"
    migrate_through(path, 37)

    def interrupt(version, step):
        if version == 38 and step == 2:
            raise RuntimeError("stop migration")

    with pytest.raises(RuntimeError, match="stop migration"):
        StudioRepository(path, migration_hook=interrupt)
    assert database_version(path) == 37
    with sqlite3.connect(path) as connection:
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name='draft_review_notes'"
            ).fetchone()
            is None
        )
    StudioRepository(path)
    assert database_version(path) == SCHEMA_VERSION


@pytest.mark.parametrize("text", ["", "  ", "invalid\0text", "a" * 2001])
def test_closed_note_text_rejects_empty_unbounded_and_nul(text):
    with pytest.raises(ValidationError):
        CreateDraftReviewNoteRequest(
            note_id="drn_" + "a" * 32,
            assembly_version_id="ver_" + "b" * 32,
            assembly_content_hash="sha256:" + "c" * 64,
            output_sha256="d" * 64,
            output_bytes=100,
            frame_index=0,
            text=text,
        )
