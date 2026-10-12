"""Real temporary SQLite and owned PNG originals; no decoder/encoder/Provider runs."""

import json
import struct
import zlib
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_media_assembly_contracts import CreateEpisodeMediaAssemblyVersionRequest
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
from aijian_api.manual_media_candidate_contracts import CreateManualMediaCandidateRequest
from aijian_api.manual_media_candidate_store import (
    ManualMediaCandidateConflict,
    ManualMediaCandidateNotFound,
    ManualMediaCandidateStore,
)
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.media_preparation_store import MediaPreparationStore
from aijian_api.repository import ArtifactConflictError, StudioRepository
from test_episode_storyboard import payload as board_payload
from test_episode_storyboard import shot, write
from test_media_preparation import preparation
from test_media_preparation import setup as preparation_setup
from test_project_creative_library import make_project
from test_visual_bible_g5 import clear_rights


def setup(tmp_path):
    r, p, e, b = preparation_setup(tmp_path)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    png = tmp_path / "owned-candidate.png"
    png.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\0\0" * 16) * 16))
        + chunk(b"IEND", b"")
    )
    a = MediaAssetStore(r).import_local(p, png)
    request = (
        MediaPreparationStore(r)
        .write(p, e, str(uuid4()), preparation(p, e, b), "local-user")
        .version
    )
    payload = CreateManualMediaCandidateRequest.model_validate(
        {
            "input": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "preparation_version_id": request.version_id,
                "preparation_content_hash": request.content_hash,
                "asset_id": a.id,
                "asset_version_id": a.latest_version.id,
                "asset_sha256": a.latest_version.sha256,
                "association_note": "手工选择自有图片作为候选；未表示模型生成或已完成镜头。",
            },
            "parent_version_id": None,
            "expected_revision": None,
        }
    )
    return r, p, e, b, a, request, payload


def assemble(p, e, candidate, request, parent=None, revision=None):
    i = candidate.content.input
    return CreateEpisodeMediaAssemblyVersionRequest.model_validate(
        {
            "content": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "sequence_timebase": {
                    "frame_rate": {"num": request.content.snapshot.fps, "den": 1},
                    "timecode_mode": "NON_DROP_FRAME",
                },
                "canvas_width": 160,
                "canvas_height": 90,
                "total_frames": 75,
                "visual_segments": [
                    {
                        "segment_id": "seg_manual",
                        "media_kind": "image",
                        "media": {
                            "asset_id": i.asset_id,
                            "asset_version_id": i.asset_version_id,
                            "sha256": i.asset_sha256,
                        },
                        "start_frame": 0,
                        "end_frame": 75,
                        "source_in_frame": 0,
                        "embedded_audio": "MUTE",
                        "storyboard_ref": {
                            "storyboard_version_id": request.content.input.storyboard_version_id,
                            "shot_id": request.content.input.shot_id,
                        },
                        "manual_candidate_ref": {
                            "candidate_version_id": candidate.version_id,
                            "candidate_content_hash": candidate.content_hash,
                            "preparation_version_id": request.version_id,
                            "preparation_content_hash": request.content_hash,
                            "adoption_intent": "MANUAL_ADOPTION",
                        },
                    }
                ],
                "audio_segments": [],
                "subtitle_segments": [],
            },
            "parent_version_id": parent,
            "expected_revision": revision,
            "change_summary": "用户明确选入手工候选，保存本分集装配",
        }
    )


def test_real_candidate_receipt_source_hash_scope_restart_and_original_bytes(tmp_path):
    r, p, e, b, a, request, payload = setup(tmp_path)
    op = str(uuid4()).upper()
    store = ManualMediaCandidateStore(r)
    result = store.write(p, e, op, payload, "local-user")
    v = result.version
    assert (
        v.content.origin == "LOCAL_IMPORT"
        and v.content.association == "MANUAL_ASSOCIATION"
        and v.content.cost_status == "UNKNOWN"
    )
    assert v.content.asset_snapshot.sha256 == a.latest_version.sha256
    assert v.content_hash == canonical_content_hash(v.content.model_dump(mode="json"))
    restarted = ManualMediaCandidateStore(StudioRepository(r.database_path))
    assert (
        restarted.original_for_hash(
            p, e, op, canonical_content_hash(payload.model_dump(mode="json")), "local-user"
        )
        == result
    )
    assert restarted.get(p, e, v.version_id) == v
    assert restarted.list(p, e).items == (v,)
    for bad in [op.lower(), str(uuid4())]:
        with pytest.raises(ManualMediaCandidateNotFound):
            restarted.original_for_hash(
                p, e, bad, canonical_content_hash(payload.model_dump(mode="json")), "local-user"
            )
    with pytest.raises(ValueError):
        restarted.original_for_hash(p, e, op, "sha256:" + "0" * 64, "local-user")
    with pytest.raises(ValueError):
        restarted.original_for_hash(
            p, e, op, canonical_content_hash(payload.model_dump(mode="json")), "other"
        )
    with pytest.raises(ManualMediaCandidateConflict):
        store.write(
            p,
            e,
            op,
            payload.model_copy(
                update={
                    "input": payload.input.model_copy(update={"association_note": "另一个完整输入"})
                }
            ),
            "local-user",
        )
    with r._connection() as c:
        assert tuple(
            c.execute(
                "SELECT upstream_version_id,impact FROM artifact_dependencies "
                "WHERE downstream_version_id=?",
                (v.version_id,),
            ).fetchone()
        ) == (request.version_id, "blocking")
        assert c.execute("SELECT count(*) FROM media_asset_episode_references").fetchone()[0] == 0


def test_actual_saved_segment_consumes_same_candidate_and_original_revision_not_current_head(
    tmp_path,
):
    r, p, e, b, a, request, payload = setup(tmp_path)
    v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
    s = EpisodeMediaAssemblyStore(r)
    command = assemble(p, e, v, request)
    op = str(uuid4()).upper()
    result = s.write_exact(p, e, op, command, "local-user")
    assert (
        result.result_revision == 1
        and result.version.content.visual_segments[0].manual_candidate_ref.candidate_version_id
        == v.version_id
    )
    next = s.write_exact(
        p, e, str(uuid4()), assemble(p, e, v, request, result.version.version_id, 1), "local-user"
    )
    original = s.original_for_hash(
        p, e, op, canonical_content_hash(command.model_dump(mode="json")), "local-user"
    )
    assert original.result_revision == 1 and original.version.head_revision == 2
    assert s.read_version(p, e).version_id == next.version.version_id
    with r._connection() as c:
        edges = [
            tuple(x)
            for x in c.execute(
                "SELECT upstream_version_id,relationship,impact FROM artifact_dependencies "
                "WHERE downstream_version_id=?",
                (result.version.version_id,),
            )
        ]
        assert (v.version_id, "references", "blocking") in edges
    assert (
        canonical_content_hash(original.version.content.model_dump(mode="json"))
        == original.version.content_hash
    )


@pytest.mark.parametrize(
    "field",
    [
        "candidate_content_hash",
        "preparation_version_id",
        "preparation_content_hash",
        "candidate_version_id",
        "asset_sha256",
        "shot",
        "timebase",
    ],
)
def test_actual_consumers_refuse_mismatched_saved_candidate_sources(tmp_path, field):
    r, p, e, b, a, request, payload = setup(tmp_path)
    v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
    raw = assemble(p, e, v, request).model_dump(mode="json")
    seg = raw["content"]["visual_segments"][0]
    if field in ["candidate_content_hash", "preparation_content_hash"]:
        seg["manual_candidate_ref"][field] = "sha256:" + "0" * 64
    elif field in ["candidate_version_id", "preparation_version_id"]:
        seg["manual_candidate_ref"][field] = "ver_" + "0" * 32
    elif field == "asset_sha256":
        seg["media"]["sha256"] = "0" * 64
    elif field == "shot":
        seg["storyboard_ref"]["shot_id"] = "shp_" + "0" * 32
    else:
        raw["content"]["sequence_timebase"]["frame_rate"]["num"] = 24
    with pytest.raises(EpisodeMediaAssemblyError, match="candidate"):
        EpisodeMediaAssemblyStore(r).write_exact(
            p,
            e,
            str(uuid4()),
            CreateEpisodeMediaAssemblyVersionRequest.model_validate(raw),
            "local-user",
        )
    with r._connection() as c:
        assert c.execute("SELECT count(*) FROM assembly_exact_write_requests").fetchone()[0] == 0


@pytest.mark.parametrize("phase", ["version_inserted", "receipt_inserted"])
@pytest.mark.parametrize("chain", ["candidate", "assembly"])
def test_each_write_phase_rolls_back_every_version_receipt_head_and_dependency(
    tmp_path, phase, chain
):
    r, p, e, b, a, request, payload = setup(tmp_path)
    if chain == "assembly":
        v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
        command = assemble(p, e, v, request)

    def counts():
        with r._connection() as c:
            return tuple(
                c.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                for table in [
                    "artifact_versions",
                    "artifact_heads",
                    "artifact_dependencies",
                    "manual_media_candidate_write_requests",
                    "assembly_exact_write_requests",
                ]
            )

    before = counts()

    def fail(operation, step):
        if (
            operation == ("manual_media_candidate" if chain == "candidate" else "assembly_exact")
            and step == phase
        ):
            raise RuntimeError("controlled transactional fault")

    r._transaction_hook = fail
    with pytest.raises(RuntimeError):
        if chain == "candidate":
            ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user")
        else:
            EpisodeMediaAssemblyStore(r).write_exact(p, e, str(uuid4()), command, "local-user")
    assert counts() == before


@pytest.mark.parametrize("mutation", ["missing", "changed"])
def test_history_retained_but_new_candidate_or_assembly_original_consumption_rejects_file_loss(
    tmp_path, mutation
):
    r, p, e, b, a, request, payload = setup(tmp_path)
    s = ManualMediaCandidateStore(r)
    v = s.write(p, e, str(uuid4()), payload, "local-user").version
    path = (
        r.database_path.parent
        / "media-assets"
        / "blobs"
        / a.latest_version.sha256[:2]
        / a.latest_version.sha256
    )
    if mutation == "missing":
        path.unlink()
    else:
        path.write_bytes(b"x" * a.latest_version.byte_size)
    assert s.get(p, e, v.version_id) == v
    with pytest.raises(ValueError):
        s.write(
            p,
            e,
            str(uuid4()),
            payload.model_copy(update={"parent_version_id": v.version_id, "expected_revision": 1}),
            "local-user",
        )
    with pytest.raises(EpisodeMediaAssemblyError):
        EpisodeMediaAssemblyStore(r).write_exact(
            p, e, str(uuid4()), assemble(p, e, v, request), "local-user"
        )


def test_bounded_exact_selected_asset_does_not_expand_unrelated_versions_or_reopen_connection(
    tmp_path, monkeypatch
):
    r, p, e, b, a, request, payload = setup(tmp_path)
    monkeypatch.setattr(
        MediaAssetStore,
        "get_asset",
        lambda *args, **kwargs: pytest.fail("must not bulk materialize asset history"),
    )
    v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
    saved = EpisodeMediaAssemblyStore(r).write_exact(
        p, e, str(uuid4()), assemble(p, e, v, request), "local-user"
    )
    assert saved.version.media_checks[0].availability == "VERIFIED"


def test_historical_legacy_assembly_without_optional_source_has_same_content_hash(tmp_path):
    r, p, e, b, a, request, payload = setup(tmp_path)
    v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
    raw = assemble(p, e, v, request).model_dump(mode="json")
    del raw["content"]["visual_segments"][0]["manual_candidate_ref"]
    legacy = CreateEpisodeMediaAssemblyVersionRequest.model_validate(raw)
    expected = canonical_content_hash(raw["content"])
    result = EpisodeMediaAssemblyStore(r).create_version(p, e, legacy, author_actor_id="local-user")
    assert result.content_hash == expected
    assert (
        "manual_candidate_ref" not in result.content.model_dump(mode="json")["visual_segments"][0]
    )


def test_two_projects_two_episodes_isolate_candidates_and_saved_adoptions(tmp_path):
    r, p, e, b, a, request, payload = setup(tmp_path)
    scopes = []
    source = tmp_path / "owned-candidate.png"
    for project in (p, make_project(r)):
        asset = a if project == p else MediaAssetStore(r).import_local(project, source)
        for episode in (r.list_episodes(project)[0].id, r.create_episode(project, title="二").id):
            board = (
                b
                if (project, episode) == (p, e)
                else write(
                    EpisodeStoryboardStore(r), board_payload(project, episode, shots=[shot()])
                )[0]
            )
            prep = (
                request
                if (project, episode) == (p, e)
                else MediaPreparationStore(r)
                .write(
                    project,
                    episode,
                    str(uuid4()),
                    preparation(project, episode, board),
                    "local-user",
                )
                .version
            )
            raw = payload.model_dump(mode="json")
            raw["input"].update(
                project_id=project,
                episode_id=episode,
                preparation_version_id=prep.version_id,
                preparation_content_hash=prep.content_hash,
                asset_id=asset.id,
                asset_version_id=asset.latest_version.id,
                asset_sha256=asset.latest_version.sha256,
            )
            v = (
                ManualMediaCandidateStore(r)
                .write(
                    project,
                    episode,
                    str(uuid4()),
                    CreateManualMediaCandidateRequest.model_validate(raw),
                    "local-user",
                )
                .version
            )
            saved = (
                EpisodeMediaAssemblyStore(r)
                .write_exact(
                    project,
                    episode,
                    str(uuid4()),
                    assemble(project, episode, v, prep),
                    "local-user",
                )
                .version
            )
            scopes.append((project, episode, v, saved))
    for project, episode, v, saved in scopes:
        assert [
            item.version_id for item in ManualMediaCandidateStore(r).list(project, episode).items
        ] == [v.version_id]
        assert (
            EpisodeMediaAssemblyStore(r).read_version(project, episode).version_id
            == saved.version_id
        )
        for other_p, other_e, other, other_saved in scopes:
            if (other_p, other_e) != (project, episode):
                with pytest.raises((ValueError, ArtifactConflictError)):
                    ManualMediaCandidateStore(r).get(project, episode, other.version_id)
                with pytest.raises(ArtifactConflictError):
                    EpisodeMediaAssemblyStore(r).read_version(
                        project, episode, version_id=other_saved.version_id
                    )
    with r._connection() as c:
        for table in (
            "workflow_runs",
            "workflow_attempts",
            "draft_export_jobs",
            "gate_decisions",
            "task_ledger",
        ):
            assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0


def test_latest_rights_restriction_preserves_history_but_blocks_new_consumption_before_tools(
    tmp_path,
):
    from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
    from test_draft_export_runtime import request_for

    r, p, e, b, a, request, payload = setup(tmp_path)
    store = ManualMediaCandidateStore(r)
    v = store.write(p, e, str(uuid4()), payload, "local-user").version
    saved = (
        EpisodeMediaAssemblyStore(r)
        .write_exact(p, e, str(uuid4()), assemble(p, e, v, request), "local-user")
        .version
    )
    clear_rights(r, p, a, decision="RESTRICTED")
    assert store.get(p, e, v.version_id) == v
    assert EpisodeMediaAssemblyStore(r).read_version(p, e).content_hash == saved.content_hash
    with pytest.raises(ValueError, match="rights"):
        store.write(
            p,
            e,
            str(uuid4()),
            payload.model_copy(update={"parent_version_id": v.version_id, "expected_revision": 1}),
            "local-user",
        )
    with pytest.raises(EpisodeMediaAssemblyError):
        EpisodeMediaAssemblyStore(r).write_exact(
            p, e, str(uuid4()), assemble(p, e, v, request, saved.version_id, 1), "local-user"
        )
    runtime = DraftExportRuntime(
        r, lambda: pytest.fail("restricted candidate must fail before encoder access")
    )
    with pytest.raises(DraftExportError):
        runtime.submit(p, e, request_for(saved, tmp_path / "blocked-rights.mp4"))
    with r._connection() as c:
        assert c.execute("SELECT count(*) FROM draft_export_jobs").fetchone()[0] == 0


@pytest.mark.parametrize(
    "technical",
    [{"invalid": True}, {"invalid": 1.5}, {"invalid": {"nested": 1}}, {"oversize": "x" * 33000}],
)
def test_selected_asset_metadata_is_sql_bounded_and_closed_without_changing_immutable_rows(
    tmp_path, technical, monkeypatch
):
    import aijian_api.manual_media_original as reader

    r, p, e, b, a, request, payload = setup(tmp_path)
    new_id = "asv_" + uuid4().hex
    with r._connection() as c:
        c.execute(
            "INSERT INTO media_asset_versions SELECT ?,project_id,asset_id,2,filename,kind,"
            "mime_type,byte_size,sha256,rights_status,source_kind,?,created_at "
            "FROM media_asset_versions WHERE id=?",
            (new_id, json.dumps(technical), a.latest_version.id),
        )
    if "oversize" in technical:
        monkeypatch.setattr(
            reader,
            "_version_from_row",
            lambda *args: pytest.fail("SQL budget must precede JSON materialization"),
        )
    altered = payload.model_copy(
        update={"input": payload.input.model_copy(update={"asset_version_id": new_id})}
    )
    with pytest.raises(ValueError):
        ManualMediaCandidateStore(r).write(p, e, str(uuid4()), altered, "local-user")
    assert ManualMediaCandidateStore(r).list(p, e).items == ()
    with r._connection() as c:
        assert (
            c.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").fetchone()[0]
            >= 182
        )
        assert (
            c.execute(
                "SELECT ordinal FROM media_asset_versions WHERE id=?", (a.latest_version.id,)
            ).fetchone()[0]
            == 1
        )


def test_g5_replacement_invalidates_manual_candidate_chain_without_retargeting_history(tmp_path):
    from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
    from aijian_api.visual_bible_contracts import CreateVisualBibleVersionRequest
    from aijian_api.visual_bible_store import VisualBibleStore
    from test_draft_export_runtime import request_for
    from test_g5_storyboard_consumption import approve, write_board
    from test_visual_environment_g5 import board as environment_board
    from test_visual_environment_g5 import setup as environment_setup

    r, p, a, env_asset, value, visual, old = environment_setup(tmp_path)
    authority = approve(r, p, visual)
    e = r.list_episodes(p)[0].id
    board = write_board(r, p, e, environment_board(p, e, visual))
    prep = (
        MediaPreparationStore(r)
        .write(p, e, str(uuid4()), preparation(p, e, board), "local-user")
        .version
    )
    payload = CreateManualMediaCandidateRequest.model_validate(
        {
            "input": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "preparation_version_id": prep.version_id,
                "preparation_content_hash": prep.content_hash,
                "asset_id": a.id,
                "asset_version_id": a.latest_version.id,
                "asset_sha256": a.latest_version.sha256,
                "association_note": "显式关联自有素材",
            },
            "parent_version_id": None,
            "expected_revision": None,
        }
    )
    v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
    saved = (
        EpisodeMediaAssemblyStore(r)
        .write_exact(p, e, str(uuid4()), assemble(p, e, v, prep), "local-user")
        .version
    )
    value.update(parent_version_id=visual.version.id, expected_revision=authority.head.revision)
    value["content"]["change_reason"] = "明确更换作品共享视觉批准"
    newer, _ = VisualBibleStore(r).write(
        p,
        CreateVisualBibleVersionRequest.model_validate(value),
        idempotency_key=uuid4().hex,
        actor_id="local-user",
    )
    approve(r, p, newer)
    assert ManualMediaCandidateStore(r).get(p, e, v.version_id) == v
    assert EpisodeMediaAssemblyStore(r).read_version(p, e).content_hash == saved.content_hash
    affected = {
        path.affected_version_id for op in r.list_invalidation_operations(p) for path in op.paths
    }
    assert {board.version_id, prep.version_id, v.version_id, saved.version_id} <= affected
    # A manual association may record the old exact input. It grants no current
    # G5 authority, and cannot be consumed as a new saved assembly below.
    newer_association = (
        ManualMediaCandidateStore(r)
        .write(
            p,
            e,
            str(uuid4()),
            payload.model_copy(update={"parent_version_id": v.version_id, "expected_revision": 1}),
            "local-user",
        )
        .version
    )
    with pytest.raises(EpisodeMediaAssemblyError):
        EpisodeMediaAssemblyStore(r).write_exact(
            p, e, str(uuid4()), assemble(p, e, v, prep, saved.version_id, 1), "local-user"
        )
    with pytest.raises(EpisodeMediaAssemblyError):
        EpisodeMediaAssemblyStore(r).write_exact(
            p,
            e,
            str(uuid4()),
            assemble(p, e, newer_association, prep, saved.version_id, 1),
            "local-user",
        )
    with pytest.raises(DraftExportError):
        DraftExportRuntime(
            r, lambda: pytest.fail("stale G5 must fail before encoder access")
        ).submit(p, e, request_for(saved, tmp_path / "blocked-g5.mp4"))


def test_manual_candidate_consumption_requires_the_current_exact_script_confirmation(tmp_path):
    from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
    from test_assembly_script_provenance import confirm, revise, source_fixture
    from test_character_reference_assets import png
    from test_draft_export_runtime import request_for

    r, p, e, audio, script, prior, confirmation = source_fixture(tmp_path)
    asset = MediaAssetStore(r).import_local(p, png(tmp_path / "owned-manual.png", b"\xff\0\0"))
    board = write(
        EpisodeStoryboardStore(r), board_payload(p, e, shots=[shot()], script=script.version_id)
    )[0]
    prep = (
        MediaPreparationStore(r)
        .write(p, e, str(uuid4()), preparation(p, e, board), "local-user")
        .version
    )
    payload = CreateManualMediaCandidateRequest.model_validate(
        {
            "input": {
                "schema_version": "1.0.0",
                "project_id": p,
                "episode_id": e,
                "preparation_version_id": prep.version_id,
                "preparation_content_hash": prep.content_hash,
                "asset_id": asset.id,
                "asset_version_id": asset.latest_version.id,
                "asset_sha256": asset.latest_version.sha256,
                "association_note": "记录确切剧本分镜的手工候选",
            },
            "parent_version_id": None,
            "expected_revision": None,
        }
    )
    v = ManualMediaCandidateStore(r).write(p, e, str(uuid4()), payload, "local-user").version
    saved = (
        EpisodeMediaAssemblyStore(r)
        .write_exact(
            p,
            e,
            str(uuid4()),
            assemble(p, e, v, prep, prior.version_id, prior.head_revision),
            "local-user",
        )
        .version
    )
    scenes = script.content.model_dump(mode="json")["scenes"]
    scenes[0]["blocks"][0]["text"] = "新确认的另一份对白"
    replacement = revise(r, p, e, script, scenes=scenes)
    confirm(r, p, e, replacement)
    assert ManualMediaCandidateStore(r).get(p, e, v.version_id) == v
    assert EpisodeMediaAssemblyStore(r).read_version(p, e).content_hash == saved.content_hash
    with pytest.raises(EpisodeMediaAssemblyError):
        EpisodeMediaAssemblyStore(r).write_exact(
            p,
            e,
            str(uuid4()),
            assemble(p, e, v, prep, saved.version_id, saved.head_revision),
            "local-user",
        )
    with pytest.raises(DraftExportError):
        DraftExportRuntime(
            r, lambda: pytest.fail("stale script must fail before encoder access")
        ).submit(p, e, request_for(saved, tmp_path / "blocked-script.mp4"))
