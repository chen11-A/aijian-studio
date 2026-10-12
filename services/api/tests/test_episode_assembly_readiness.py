"""Real SQLite read observations; no encoder, Provider, native probe or Gate issuance."""

import copy
import os
from uuid import uuid4

import pytest
from aijian_api import episode_assembly_readiness_service as readiness_module
from aijian_api import local_media_original as originals
from aijian_api.audio_asset_probe_store import AudioAssetProbeEvidenceStore
from aijian_api.episode_assembly_readiness_service import (
    EpisodeAssemblyReadinessError,
    EpisodeAssemblyReadinessService,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.manual_media_candidate_contracts import CreateManualMediaCandidateRequest
from aijian_api.manual_media_candidate_store import ManualMediaCandidateStore
from aijian_api.media_asset_probe_store import persist_selected_probe
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_preparation_store import MediaPreparationStore
from aijian_api.media_probe import LocalAudioProbeData
from aijian_api.repository import ArtifactConflictError
from test_assembly_script_provenance import confirm, revise, source_fixture
from test_assembly_storyboard_provenance import linked_content, save, storyboard
from test_draft_export_runtime import fixture
from test_g5_storyboard_consumption import approve, assembly, board_request, write_board
from test_manual_media_candidates import assemble as candidate_assembly
from test_media_preparation import preparation
from test_media_probe import _toolchain
from test_visual_bible_g5 import clear_rights, inspect_fixture, setup_visual
from test_visual_environment_g5 import board as environment_board
from test_visual_environment_g5 import setup as environment_setup


def inspect(repo, project, episode, version):
    return EpisodeAssemblyReadinessService(repo).inspect(
        project, episode, version.version_id, version.content_hash
    )


def codes(result):
    return {item.code for item in result.blockers}


def snapshot(repository):
    with repository._connection() as connection:
        return tuple(connection.iterdump())


def test_read_only_exact_saved_snapshot_never_mints_lock_or_release(tmp_path):
    repo, p, e, _, saved = fixture(tmp_path)
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert snapshot(repo) == before
    assert result.assembly == EpisodeMediaAssemblyStore(repo).read_version(p, e)
    assert result.is_current_head
    assert tuple((s.scope, s.status) for s in result.source_checks) == (
        ("SCRIPT", "NOT_BOUND"),
        ("STORYBOARD", "NOT_BOUND"),
    )
    assert result.formal_status == "BLOCKED"
    assert result.picture_lock_status == "NO_PICTURE_LOCK"
    assert result.export_status == "NO_EXPORT_CLAIM"
    assert {
        "PICTURE_LOCK_MISSING",
        "SOUND_REVIEW_NOT_RECORDED",
        "SUBTITLE_REVIEW_NOT_RECORDED",
    } <= codes(result)


def test_historic_selected_version_is_preserved_and_not_retargeted(tmp_path):
    repo, p, e, _, saved = fixture(tmp_path)
    value = saved.content.model_dump(mode="json")
    value["total_frames"] = value["visual_segments"][0]["end_frame"] = 36
    newer = save(repo, p, e, saved, value)
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert not result.is_current_head
    assert result.assembly.version_id == saved.version_id
    assert result.assembly.content_hash == saved.content_hash
    assert result.assembly.head_revision == newer.head_revision
    assert "ASSEMBLY_NOT_CURRENT_HEAD" in codes(result)
    assert snapshot(repo) == before


@pytest.mark.parametrize(
    ("digest", "code", "status"),
    [
        ("sha256:" + "f" * 64, "ASSEMBLY_HASH_CONFLICT", 409),
        ("invalid", "READINESS_HASH_INVALID", 422),
    ],
)
def test_wrong_hash_rejects_before_original_reads(tmp_path, monkeypatch, digest, code, status):
    repo, p, e, _, saved = fixture(tmp_path)
    monkeypatch.setattr(
        originals, "_open_local_source", lambda *args: pytest.fail("no original read")
    )
    before = snapshot(repo)
    with pytest.raises(EpisodeAssemblyReadinessError) as error:
        EpisodeAssemblyReadinessService(repo).inspect(p, e, saved.version_id, digest)
    assert (error.value.code, error.value.status) == (code, status)
    assert snapshot(repo) == before


@pytest.mark.parametrize("scope", ["episode", "project"])
def test_scoped_version_cannot_be_read_from_another_owner(tmp_path, scope):
    repo, p, e, _, saved = fixture(tmp_path)
    if scope == "episode":
        e = repo.create_episode(p, title="Other episode").id
    else:
        other = repo.create_project(
            name="Other", aspect_ratio="16:9", target_duration_seconds=30, source_language="zh-CN"
        )
        p, e = other.id, repo.list_episodes(other.id)[0].id
    before = snapshot(repo)
    with pytest.raises(ArtifactConflictError):
        inspect(repo, p, e, saved)
    assert snapshot(repo) == before


def test_same_source_confirmation_and_new_unconfirmed_draft_preserve_current_pin(tmp_path):
    repo, p, e, _, script, saved, original = source_fixture(tmp_path)
    duplicate = confirm(repo, p, e, script)
    assert duplicate.confirmation_id != original.confirmation_id
    scenes = copy.deepcopy(script.content.model_dump(mode="json")["scenes"])
    scenes[0]["blocks"][0]["text"] = "Unconfirmed next draft."
    revise(repo, p, e, script, scenes=scenes)
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert result.source_checks[0].status == "CURRENT"
    assert result.assembly.script_source_status.newer_draft_available
    assert result.assembly.content.script_provenance.confirmation_id == original.confirmation_id
    assert snapshot(repo) == before


def test_confirmed_source_replacement_blocks_fresh_check_but_preserves_history(tmp_path):
    repo, p, e, _, script, saved, _ = source_fixture(tmp_path)
    scenes = copy.deepcopy(script.content.model_dump(mode="json")["scenes"])
    scenes[0]["blocks"][0]["text"] = "New confirmed source."
    confirm(repo, p, e, revise(repo, p, e, script, scenes=scenes))
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert result.source_checks[0].status == "BLOCKED"
    assert "SCRIPT_SOURCE_SUPERSEDED" in codes(result)
    assert result.assembly.content_hash == saved.content_hash
    assert snapshot(repo) == before


def test_legacy_storyboard_is_bound_but_not_g5_approved(tmp_path):
    repo, p, e, _, initial = fixture(tmp_path)
    board = storyboard(repo, p, e)
    saved = save(repo, p, e, initial, linked_content(initial, board))
    result = inspect(repo, p, e, saved)
    assert result.source_checks[1].status == "NOT_BOUND"
    assert "STORYBOARD_G5_NOT_BOUND" in codes(result)


def test_actual_g5_source_is_current_then_restricted_fresh_evidence_is_blocked(tmp_path):
    repo, p, asset, _, visual = setup_visual(tmp_path)
    e = repo.list_episodes(p)[0].id
    clear_rights(repo, p, asset)
    inspect_fixture(repo, p, asset)
    approve(repo, p, visual)
    board = write_board(repo, p, e, board_request(p, e, visual))
    saved = assembly(repo, p, e, asset, board)
    assert inspect(repo, p, e, saved).source_checks[1].status == "CURRENT"
    clear_rights(repo, p, asset, revision=1, decision="RESTRICTED")
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert result.source_checks[1].status == "BLOCKED"
    assert "G5_AUTHORITY_CHANGED" in codes(result)
    assert result.assembly.content_hash == saved.content_hash
    assert snapshot(repo) == before


@pytest.mark.parametrize("fault", ["missing", "changed", "restricted", "budget"])
def test_original_and_latest_rights_are_checked_without_writes(tmp_path, monkeypatch, fault):
    repo, p, e, asset, saved = fixture(tmp_path)
    version = asset.latest_version
    blob = tmp_path / "media-assets" / "blobs" / version.sha256[:2] / version.sha256
    if fault == "missing":
        blob.unlink()
    elif fault == "changed":
        blob.write_bytes(b"x" * version.byte_size)
    elif fault == "restricted":
        MediaAssetRightsStore(repo).append_human_decision(
            p,
            asset.id,
            version.id,
            HumanRightsDecisionInput(
                operation_id="rdop_" + uuid4().hex,
                expected_revision=0,
                decision="RESTRICTED",
                basis_text="Synthetic restriction for readonly prerequisite check",
            ),
            actor_id="local-user",
        )
    else:
        monkeypatch.setattr(readiness_module, "MAX_READINESS_ORIGINAL_BYTES", version.byte_size - 1)
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    expected = {
        "missing": "MEDIA_MISSING",
        "changed": "MEDIA_CORRUPT",
        "restricted": "MEDIA_RIGHTS_RESTRICTED",
        "budget": "MEDIA_UNVERIFIED_SIZE_LIMIT",
    }[fault]
    assert expected in codes(result)
    assert snapshot(repo) == before


def audio_evidence(repo, p, audio, path, *, total_samples=132300):
    v = audio.latest_version
    data = LocalAudioProbeData.model_validate(
        {
            "source_asset_sha256": "sha256:" + v.sha256,
            "byte_size": v.byte_size,
            "format_names": ("wav",),
            "container_duration": {"num": 3, "den": 1},
            "video": None,
            "audio": {
                "stream_index": 0,
                "codec_name": "pcm_s16le",
                "sample_rate_hz": 44100,
                "channels": 1,
                "channel_layout": "mono",
                "time_base": {"num": 1, "den": 44100},
                "total_samples": total_samples,
            },
        }
    )
    persist_selected_probe(repo, p, audio.id, v.id, data, _toolchain(path), kind="audio")


def test_audio_probe_is_existing_pure_read_not_new_probe_or_content_approval(tmp_path, monkeypatch):
    repo, p, e, audio, _, saved, _ = source_fixture(tmp_path)
    assert "AUDIO_PROBE_MISSING" in codes(inspect(repo, p, e, saved))
    audio_evidence(repo, p, audio, tmp_path)
    monkeypatch.setattr(
        AudioAssetProbeEvidenceStore,
        "probe_selected_audio",
        lambda *args: pytest.fail("must not probe"),
    )
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert "AUDIO_PROBE_MISSING" not in codes(result)
    assert "AUDIO_PROBE_UNKNOWN" not in codes(result)
    assert "SOUND_REVIEW_NOT_RECORDED" in codes(result)
    assert snapshot(repo) == before


def test_audio_source_range_uses_stored_original_sample_rate(tmp_path):
    repo, p, e, audio, _, saved, _ = source_fixture(tmp_path)
    audio_evidence(repo, p, audio, tmp_path, total_samples=1_000)
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert "AUDIO_SOURCE_RANGE_INVALID" in codes(result)
    assert "AUDIO_PROBE_UNKNOWN" not in codes(result)
    assert snapshot(repo) == before


@pytest.mark.parametrize("limit", ["metadata", "probe", "rights"])
def test_sql_metadata_fences_reject_before_media_json_and_file_reads(tmp_path, monkeypatch, limit):
    if limit == "probe":
        repo, p, e, audio, _, saved, _ = source_fixture(tmp_path)
        audio_evidence(repo, p, audio, tmp_path)
        constant, code = "MAX_PERSISTED_PROBE_BYTES", "READINESS_PROBE_BUDGET"
    else:
        repo, p, e, asset, saved = fixture(tmp_path)
        constant, code = "MAX_ASSET_METADATA_BYTES", "READINESS_METADATA_BUDGET"
        if limit == "rights":
            clear_rights(repo, p, asset)
            constant, code = "MAX_RIGHTS_HISTORY", "READINESS_RIGHTS_BUDGET"
    monkeypatch.setattr(readiness_module, constant, 0)
    monkeypatch.setattr(
        readiness_module, "_collect_checks", lambda *args, **kwargs: pytest.fail("no JSON load")
    )
    monkeypatch.setattr(
        originals, "_open_local_source", lambda *args: pytest.fail("no original read")
    )
    before = snapshot(repo)
    with pytest.raises(EpisodeAssemblyReadinessError) as error:
        inspect(repo, p, e, saved)
    assert error.value.code == code
    assert snapshot(repo) == before


def test_cumulative_original_budget_deduplicates_same_hash(tmp_path):
    repo, p, e, _, saved = fixture(tmp_path)
    content = saved.content.model_dump(mode="json")
    first = content["visual_segments"][0]
    first["end_frame"] = 12
    content["visual_segments"].append(
        {**first, "segment_id": "seg_b", "start_frame": 12, "end_frame": 24}
    )
    saved = save(repo, p, e, saved, content)
    result = inspect(repo, p, e, saved)
    assert len(result.assembly.media_checks) == 1
    assert result.assembly.media_checks[0].availability == "VERIFIED"


def recursive_fixture(tmp_path, *, manual):
    repo, p, asset, environment, _, visual, _ = environment_setup(tmp_path)
    approve(repo, p, visual)
    e = repo.list_episodes(p)[0].id
    board = write_board(repo, p, e, environment_board(p, e, visual))
    if not manual:
        saved = assembly(repo, p, e, asset, board)
    else:
        request = (
            MediaPreparationStore(repo)
            .write(p, e, str(uuid4()), preparation(p, e, board), "local-user")
            .version
        )
        candidate = (
            ManualMediaCandidateStore(repo)
            .write(
                p,
                e,
                str(uuid4()),
                CreateManualMediaCandidateRequest.model_validate(
                    {
                        "input": {
                            "schema_version": "1.0.0",
                            "project_id": p,
                            "episode_id": e,
                            "preparation_version_id": request.version_id,
                            "preparation_content_hash": request.content_hash,
                            "asset_id": asset.id,
                            "asset_version_id": asset.latest_version.id,
                            "asset_sha256": asset.latest_version.sha256,
                            "association_note": "Owned recursive budget control",
                        },
                        "parent_version_id": None,
                        "expected_revision": None,
                    }
                ),
                "local-user",
            )
            .version
        )
        saved = (
            EpisodeMediaAssemblyStore(repo)
            .write_exact(
                p, e, str(uuid4()), candidate_assembly(p, e, candidate, request), "local-user"
            )
            .version
        )
    assert asset.latest_version.sha256 != environment.latest_version.sha256
    return repo, p, e, asset, environment, saved


@pytest.mark.parametrize("manual", [False, True])
def test_recursive_candidate_and_g5_originals_share_direct_read_allowance(
    tmp_path, monkeypatch, manual
):
    repo, p, e, asset, _, saved = recursive_fixture(tmp_path, manual=manual)
    assert inspect(repo, p, e, saved).source_checks[1].status == "CURRENT"
    monkeypatch.setattr(
        readiness_module, "MAX_READINESS_ORIGINAL_BYTES", asset.latest_version.byte_size
    )
    real_open, opened = originals._open_local_source, []

    def track(path):
        opened.append(path)
        return real_open(path)

    monkeypatch.setattr(originals, "_open_local_source", track)
    before = snapshot(repo)
    result = inspect(repo, p, e, saved)
    assert result.source_checks[1].status == "BLOCKED"
    assert ("MANUAL_CANDIDATE_SOURCE_INVALID" if manual else "G5_AUTHORITY_CHANGED") in codes(
        result
    )
    assert len(opened) == 1
    assert result.assembly.media_checks[0].availability == "VERIFIED"
    assert snapshot(repo) == before


def test_recursive_duplicate_originals_hash_once_and_independent_request_resets(
    tmp_path, monkeypatch
):
    repo, p, e, asset, environment, saved = recursive_fixture(tmp_path, manual=True)
    allowance = asset.latest_version.byte_size + environment.latest_version.byte_size
    monkeypatch.setattr(readiness_module, "MAX_READINESS_ORIGINAL_BYTES", allowance)
    real_open, opened = originals._open_local_source, []

    def track(path):
        opened.append(path)
        return real_open(path)

    monkeypatch.setattr(originals, "_open_local_source", track)
    for _ in range(2):
        result = inspect(repo, p, e, saved)
        assert result.source_checks[1].status == "CURRENT"
    assert len(opened) == 4
    assert len(set(opened)) == 2


def test_original_scope_does_not_cache_changed_identity_and_always_resets(tmp_path):
    repo, _, _, asset, _ = fixture(tmp_path)
    v = asset.latest_version
    blob = tmp_path / "media-assets" / "blobs" / v.sha256[:2] / v.sha256
    with pytest.raises(RuntimeError, match="abort read"):
        with originals.availability_read_scope(v.byte_size):
            assert originals._availability(repo.database_path, v.sha256, v.byte_size) == "VERIFIED"
            with originals.availability_read_scope(v.byte_size):
                assert originals._availability(repo.database_path, v.sha256, v.byte_size) == (
                    "VERIFIED"
                )
            before = blob.stat()
            os.utime(blob, ns=(before.st_atime_ns, before.st_mtime_ns + 1))
            assert originals._availability(repo.database_path, v.sha256, v.byte_size) == (
                "UNKNOWN_MEDIA_CHANGED"
            )
            raise RuntimeError("abort read")
    assert originals._READ_BUDGET.get() is None
    with originals.availability_read_scope(v.byte_size):
        assert originals._availability(repo.database_path, v.sha256, v.byte_size) == "VERIFIED"


def test_failed_original_hash_does_not_refund_allowance(tmp_path):
    repo, _, _, asset, _ = fixture(tmp_path)
    v = asset.latest_version
    blob = tmp_path / "media-assets" / "blobs" / v.sha256[:2] / v.sha256
    blob.write_bytes(b"x" * v.byte_size)
    with originals.availability_read_scope(v.byte_size):
        assert originals._availability(repo.database_path, v.sha256, v.byte_size) == "CORRUPT"
        assert originals._availability(repo.database_path, v.sha256, v.byte_size) == (
            "UNVERIFIED_SIZE_LIMIT"
        )


def test_read_transaction_is_query_only_and_shared_across_fresh_validators(tmp_path, monkeypatch):
    repo, p, e, _, saved = fixture(tmp_path)
    connections, budgets = [], []
    real_script = readiness_module.validate_script_provenance
    real_board = readiness_module.validate_storyboard_provenance

    def trace(real):
        def wrapped(repository, connection, content, **kwargs):
            assert connection.execute("PRAGMA query_only").fetchone()[0] == 1
            assert connection.in_transaction
            connections.append(connection)
            budgets.append(kwargs["budget"])
            return real(repository, connection, content, **kwargs)

        return wrapped

    monkeypatch.setattr(readiness_module, "validate_script_provenance", trace(real_script))
    monkeypatch.setattr(readiness_module, "validate_storyboard_provenance", trace(real_board))
    inspect(repo, p, e, saved)
    assert len(connections) == 2 and connections[0] is connections[1]
    assert budgets[0] is budgets[1]


def test_actual_authenticated_read_route_matches_exact_contract_and_no_store(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repo, p, e, _, saved = fixture(tmp_path)
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    app = create_app(repository=repo, sidecar_security=security)
    route = (
        "/api/v1/projects/{project_id}/episodes/{episode_id}/media-assembly/versions/"
        "{version_id}/readiness"
    )
    assert route in app.openapi()["paths"]
    path = f"/api/v1/projects/{p}/episodes/{e}/media-assembly/versions/{saved.version_id}/readiness"
    params = {"expected_content_hash": saved.content_hash}
    headers = {"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"}
    before = snapshot(repo)
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        assert client.get(path, params=params).status_code == 401
        found = client.get(path, params=params, headers=headers)
        assert found.status_code == 200, found.text
        assert found.headers["cache-control"] == "no-store"
        data = found.json()["data"]
        assert set(data) == {
            "assembly",
            "is_current_head",
            "source_checks",
            "blockers",
            "checked_at",
            "picture_lock_status",
            "export_status",
            "formal_status",
        }
        assert data["formal_status"] == "BLOCKED"
        changed = client.get(
            path, params={"expected_content_hash": "sha256:" + "f" * 64}, headers=headers
        )
        assert changed.status_code == 409 and changed.headers["cache-control"] == "no-store"
        assert client.get(path, headers=headers).status_code == 422
    assert snapshot(repo) == before
