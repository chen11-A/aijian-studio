"""Actual SQLite confirmation/source dependency closure; no provider or Windows claims."""

import copy
import hashlib
import sqlite3
import threading
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.assembly_script_provenance import script_subtitle_text
from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
from aijian_api.episode_media_assembly_contracts import EpisodeMediaAssemblyContentV1
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
    script_speaker_id,
)
from aijian_api.episode_script_confirmation_contracts import CreateEpisodeScriptConfirmationRequest
from aijian_api.episode_script_confirmation_store import EpisodeScriptConfirmationStore
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_assembly_storyboard_provenance import save, storyboard
from test_draft_export_runtime import request_for, toolchain, wait_final
from test_episode_media_assembly import dialogue_fixture
from test_production_brief import original_payload


def revise(repository, project, episode, script, **changes):
    content = script.content.model_dump(mode="json")
    content.update(changes)
    return EpisodeScriptStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest.model_validate(
            {
                "content": content,
                "parent_version_id": script.version_id,
                "expected_revision": script.head_revision,
                "change_summary": "Explicit script revision",
            }
        ),
        idempotency_key=uuid4().hex,
        actor_id="local-user",
    )[0]


def confirm(repository, project, episode, script):
    return (
        EpisodeScriptConfirmationStore(repository)
        .confirm(
            project_id=project,
            episode_id=episode,
            payload=CreateEpisodeScriptConfirmationRequest(
                version_id=script.version_id,
                expected_content_hash=script.content_hash,
                expected_head_revision=script.head_revision,
                confirm=True,
            ),
            idempotency_key=uuid4().hex,
            actor_id="local-user",
        )[0]
        .confirmation
    )


def source_fixture(tmp_path, *, confirmed=True):
    repository, project, episode, audio, script, assembly = dialogue_fixture(tmp_path)
    brief = repository.create_artifact_version(
        project_id=project,
        artifact_type="production_brief",
        schema_version="1.0.0",
        content=original_payload(),
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="Human intent",
    )
    script = revise(
        repository, project, episode, script, production_brief_version_id=brief.version.id
    )
    receipt = confirm(repository, project, episode, script) if confirmed else None
    value = assembly.content.model_dump(mode="json")
    value["audio_segments"][0].update(
        script_version_id=script.version_id,
        speaker_id=script_speaker_id(project, episode, script.version_id, "Synthetic speaker"),
    )
    value["subtitle_segments"] = [
        {
            "segment_id": "seg_script_subtitle",
            "start_frame": 12,
            "end_frame": 36,
            "text": "Synthetic test line.",
            "render_profile": "noto-cjk-sc-bottom-v1",
            "script_ref": {
                "script_version_id": script.version_id,
                "script_block_id": "sblk_" + "b" * 32,
                "script_content_hash": script.content_hash,
            },
        }
    ]
    value["script_provenance"] = (
        {
            "mode": "CONFIRMED",
            "confirmation_id": receipt.confirmation_id,
            "script_version_id": script.version_id,
            "script_content_hash": script.content_hash,
        }
        if receipt
        else {"mode": "DRAFT"}
    )
    saved = save(repository, project, episode, assembly, value)
    return repository, project, episode, audio, script, saved, receipt


def test_real_dependency_receipt_and_legacy_hash_survive_restart(tmp_path):
    repository, project, episode, _, script, saved, receipt = source_fixture(tmp_path)
    record = repository.get_artifact_version(
        project, "episode_media_assembly", saved.version_id, episode_id=episode
    )
    assert [(d.upstream_version_id, d.relationship, d.impact) for d in record.dependencies] == [
        (script.version_id, "references", "blocking")
    ]
    store = EpisodeMediaAssemblyStore(StudioRepository(repository.database_path))
    read = store.read_version(project, episode)
    assert read.content_hash == saved.content_hash == canonical_content_hash(record.version.content)
    assert read.script_source_status.state == "CONFIRMED_CURRENT"
    assert read.script_source_status.latest_confirmation == receipt
    assert read.script_source_status.dialogue_segment_ids == ("seg_dialogue",)
    assert read.script_source_status.subtitle_segment_ids == ("seg_script_subtitle",)
    legacy = store.read_version(project, episode, version_id=saved.parent_version_id)
    assert legacy.script_source_status is None
    assert "script_provenance" not in legacy.content.model_dump(mode="json")
    assert canonical_content_hash(legacy.content.model_dump(mode="json")) == legacy.content_hash


def test_new_draft_is_warning_duplicate_confirmation_same_source_is_valid(tmp_path):
    repository, project, episode, _, script, saved, original = source_fixture(tmp_path)
    duplicate = confirm(repository, project, episode, script)
    assert duplicate.confirmation_id != original.confirmation_id
    saved = save(repository, project, episode, saved, saved.content.model_dump(mode="json"))
    scenes = copy.deepcopy(script.content.model_dump(mode="json")["scenes"])
    scenes[0]["blocks"][0]["text"] = "Changed unconfirmed text."
    revise(repository, project, episode, script, scenes=scenes)
    assert (
        not EpisodeScriptConfirmationStore(repository)
        .get_status(project_id=project, episode_id=episode)
        .current
    )
    read = EpisodeMediaAssemblyStore(repository).read_version(project, episode)
    assert read.script_source_status.state == "CONFIRMED_CURRENT"
    assert read.script_source_status.newer_draft_available
    assert read.content.script_provenance.confirmation_id == original.confirmation_id
    newer = save(repository, project, episode, read, read.content.model_dump(mode="json"))
    assert newer.content_hash == read.content_hash


def test_confirmed_replacement_blocks_new_save_export_before_tools_and_explicit_repair(tmp_path):
    repository, project, episode, _, script, saved, _ = source_fixture(tmp_path)
    scenes = copy.deepcopy(script.content.model_dump(mode="json")["scenes"])
    scenes[0]["blocks"][0]["text"] = "Changed confirmed text."
    new_script = revise(repository, project, episode, script, scenes=scenes)
    receipt = confirm(repository, project, episode, new_script)
    reopened = EpisodeMediaAssemblyStore(repository).read_version(project, episode)
    assert reopened.content_hash == saved.content_hash
    assert reopened.script_source_status.state == "CONFIRMATION_SUPERSEDED"
    with pytest.raises(EpisodeMediaAssemblyError) as e:
        save(repository, project, episode, saved, saved.content.model_dump(mode="json"))
    assert e.value.code == "SCRIPT_SOURCE_SUPERSEDED"
    runtime = DraftExportRuntime(repository, lambda: pytest.fail("superseded must precede tools"))
    with pytest.raises(DraftExportError) as e:
        runtime.submit(project, episode, request_for(saved, tmp_path / "superseded.mp4"))
    assert e.value.code == "SCRIPT_SOURCE_SUPERSEDED"
    fixed = saved.content.model_dump(mode="json")
    fixed["audio_segments"][0].update(
        script_version_id=new_script.version_id,
        speaker_id=script_speaker_id(project, episode, new_script.version_id, "Synthetic speaker"),
    )
    with pytest.raises(EpisodeMediaAssemblyError) as e:
        save(repository, project, episode, saved, fixed)
    assert e.value.code == "SCRIPT_CONFIRMATION_CONFLICT"  # partial edit is never saved
    fixed["subtitle_segments"][0].update(
        text="Changed confirmed text.",
        script_ref={
            "script_version_id": new_script.version_id,
            "script_block_id": "sblk_" + "b" * 32,
            "script_content_hash": new_script.content_hash,
        },
    )
    fixed["script_provenance"].update(
        confirmation_id=receipt.confirmation_id,
        script_version_id=new_script.version_id,
        script_content_hash=new_script.content_hash,
    )
    repaired = save(repository, project, episode, saved, fixed)
    assert repaired.version_id != saved.version_id
    assert repaired.script_source_status.state == "CONFIRMED_CURRENT"
    with repository._connection() as c:
        assert c.execute("SELECT count(*) FROM gate_decisions").fetchone()[0] == 0
        assert c.execute("SELECT count(*) FROM invalidation_operations").fetchone()[0] == 0
        assert c.execute("SELECT count(*) FROM draft_export_jobs").fetchone()[0] == 0
        assert (
            c.execute(
                "SELECT count(*) FROM artifact_heads WHERE accepted_version_id IS NOT NULL"
            ).fetchone()[0]
            == 0
        )


@pytest.mark.parametrize("mode", ["CONFIRMED", "DRAFT"])
def test_full_storyboard_and_script_dependency_set_and_tampered_edges(tmp_path, mode):
    repository, project, episode, _, script, saved, _ = source_fixture(
        tmp_path, confirmed=mode == "CONFIRMED"
    )
    board = storyboard(repository, project, episode)
    content = saved.content.model_dump(mode="json")
    content["visual_segments"][0]["storyboard_ref"] = {
        "storyboard_version_id": board.version_id,
        "shot_id": board.content.shots[0].shot_id,
    }
    saved = save(repository, project, episode, saved, content)
    record = repository.get_artifact_version(
        project, "episode_media_assembly", saved.version_id, episode_id=episode
    )
    assert {(d.upstream_version_id, d.impact) for d in record.dependencies} == {
        (board.version_id, "advisory"),
        (script.version_id, "blocking" if mode == "CONFIRMED" else "advisory"),
    }
    with sqlite3.connect(repository.database_path) as c:
        c.execute("DROP TRIGGER artifact_dependencies_immutable_delete")
        c.execute(
            "DELETE FROM artifact_dependencies "
            "WHERE downstream_version_id=? AND upstream_version_id=?",
            (saved.version_id, script.version_id),
        )
    with pytest.raises(EpisodeMediaAssemblyError, match="dependencies"):
        EpisodeMediaAssemblyStore(repository).read_version(project, episode)


@pytest.mark.parametrize(
    "change,code",
    [
        ({"confirmation_id": "esc_" + "0" * 32}, "SCRIPT_CONFIRMATION_INVALID"),
        ({"script_content_hash": "sha256:" + "0" * 64}, "SCRIPT_CONFIRMATION_CONFLICT"),
        ({"script_version_id": "ver_" + "0" * 32}, "SCRIPT_CONFIRMATION_CONFLICT"),
    ],
)
def test_bad_confirmation_identity_never_saves(tmp_path, change, code):
    repository, project, episode, _, _, saved, _ = source_fixture(tmp_path)
    value = saved.content.model_dump(mode="json")
    value["script_provenance"].update(change)
    with pytest.raises(EpisodeMediaAssemblyError) as e:
        save(repository, project, episode, saved, value)
    assert e.value.code == code
    assert (
        EpisodeMediaAssemblyStore(repository).read_version(project, episode).version_id
        == saved.version_id
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("text", "Invented caption."),
        ("script_block_id", "sblk_" + "c" * 32),
        ("script_content_hash", "sha256:" + "0" * 64),
    ],
)
def test_subtitle_exact_text_dialogue_hash_and_no_untracked_source(tmp_path, field, value):
    repository, project, episode, _, _, saved, _ = source_fixture(tmp_path)
    content = saved.content.model_dump(mode="json")
    if field == "text":
        content["subtitle_segments"][0][field] = value
    else:
        content["subtitle_segments"][0]["script_ref"][field] = value
    with pytest.raises(EpisodeMediaAssemblyError) as e:
        save(repository, project, episode, saved, content)
    assert e.value.code == "SUBTITLE_SCRIPT_CONFLICT"
    del content["script_provenance"]
    with pytest.raises(ValidationError, match="explicit script provenance"):
        EpisodeMediaAssemblyContentV1.model_validate(content)


def test_subtitle_formatting_never_truncates_or_substitutes():
    assert script_subtitle_text("字" * 56) == "字" * 28 + "\n" + "字" * 28
    assert script_subtitle_text("保留\n文字") == "保留\n文字"
    for text in ["字" * 57, "hello😀", "a\nb\nc"]:
        with pytest.raises(ValueError):
            script_subtitle_text(text)


def test_foreign_confirmation_and_source_are_scoped_to_episode_and_project(tmp_path):
    r1, p1, e1, _, _, a1, _ = source_fixture(tmp_path / "one")
    r2, p2, e2, _, s2, _, c2 = source_fixture(tmp_path / "two")
    value = a1.content.model_dump(mode="json")
    value["script_provenance"]["confirmation_id"] = c2.confirmation_id
    with pytest.raises(EpisodeMediaAssemblyError) as e:
        save(r1, p1, e1, a1, value)
    assert e.value.code == "SCRIPT_CONFIRMATION_INVALID"
    # A different actual episode in the same project also cannot consume this source.
    other = r2.create_episode(p2, title="Second episode")
    value["project_id"], value["episode_id"] = p2, other.id
    value["subtitle_segments"][0]["script_ref"]["script_version_id"] = s2.version_id
    with pytest.raises(EpisodeMediaAssemblyError):
        save(r2, p2, other.id, a1, value)
    assert e2 != e1 and p2 != p1


def test_no_bound_segments_cannot_claim_confirmed_source(tmp_path):
    repository, project, episode, _, _, saved, _ = source_fixture(tmp_path)
    value = saved.content.model_dump(mode="json")
    value["audio_segments"], value["subtitle_segments"] = [], []
    with pytest.raises(EpisodeMediaAssemblyError) as e:
        save(repository, project, episode, saved, value)
    assert e.value.code == "SCRIPT_CONFIRMATION_CONFLICT"


def test_authority_change_after_admission_stops_worker_before_encoder(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder

    repository, project, episode, _, script, saved, _ = source_fixture(tmp_path)
    tools = toolchain()  # Existing local development profile, no build/install/live call.
    runtime = DraftExportRuntime(repository, lambda: tools)
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    monkeypatch.setattr(
        draft_export_encoder, "encode_draft", lambda *a, **k: pytest.fail("stale before encode")
    )
    request = request_for(saved, tmp_path / "queued.mp4")
    runtime.submit(project, episode, request)
    newer = revise(repository, project, episode, script)
    confirm(repository, project, episode, newer)
    runtime._run(project, episode, request, saved, tools, runtime._cancel[request.operation_id])
    result = runtime.get(project, episode, request.operation_id)
    assert result.status == "FAILED" and result.error_code == "SCRIPT_SOURCE_SUPERSEDED"
    assert result.output_path is None and not (tmp_path / "queued.mp4").exists()


def test_confirmation_during_encode_cannot_publish_stale_output(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder
    from aijian_api.product_export_output_verify import VerifiedProductOutput

    repository, project, episode, _, script, saved, _ = source_fixture(tmp_path)
    calls = []

    def controlled_encode(assembly, sources, temporary, tools, **kwargs):
        # Controlled protocol output, deliberately not an actual MP4/Windows acceptance claim.
        calls.append("encode")
        body = b"owned protocol output"
        temporary.write_bytes(body)
        newer = revise(repository, project, episode, script)
        confirm(repository, project, episode, newer)
        return VerifiedProductOutput(
            str(temporary),
            hashlib.sha256(body).hexdigest(),
            len(body),
            "{}",
            "0" * 64,
            "2026-10-11T00:00:00Z",
        )

    monkeypatch.setattr(draft_export_encoder, "encode_draft", controlled_encode)
    runtime = DraftExportRuntime(repository, toolchain)
    request = request_for(saved, tmp_path / "stale-output.mp4")
    runtime.submit(project, episode, request)
    result = wait_final(runtime, project, episode, request.operation_id)
    runtime.join_workers()
    assert calls == ["encode"]
    assert result.status == "FAILED" and result.error_code == "SCRIPT_SOURCE_SUPERSEDED"
    assert result.output_path is None and result.output_sha256 is None
    assert not (tmp_path / "stale-output.mp4").exists()
    assert not list(tmp_path.glob(".*draft*"))


def test_actual_authenticated_http_reads_and_rejects_superseded_write(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository, project, episode, _, script, saved, _ = source_fixture(tmp_path)
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    app = create_app(repository=repository, sidecar_security=security)
    path = f"/api/v1/projects/{project}/episodes/{episode}/media-assembly"
    headers = {"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"}
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        assert client.get(path).status_code == 401
        read = client.get(path, headers=headers)
        assert (
            read.status_code == 200
            and read.json()["data"]["script_source_status"]["state"] == "CONFIRMED_CURRENT"
        )
        newer = revise(repository, project, episode, script)
        confirm(repository, project, episode, newer)
        post = client.post(
            path + "/versions",
            headers=headers,
            json={
                "content": saved.content.model_dump(mode="json"),
                "parent_version_id": saved.version_id,
                "expected_revision": saved.head_revision,
                "change_summary": "Explicit stale input",
            },
        )
        assert (
            post.status_code == 409 and post.json()["error"]["code"] == "SCRIPT_SOURCE_SUPERSEDED"
        )
        old = client.get(path + "/versions/" + saved.version_id, headers=headers).json()["data"]
        assert (
            old["content_hash"] == saved.content_hash
            and old["script_source_status"]["state"] == "CONFIRMATION_SUPERSEDED"
        )
