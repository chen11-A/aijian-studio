"""Real local SQLite source facts and authenticated reads; no native/runtime claims."""

import copy
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from aijian_api import repository as repository_module
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_script_confirmation_contracts import CreateEpisodeScriptConfirmationRequest
from aijian_api.episode_script_confirmation_store import (
    EpisodeScriptConfirmationStorageError,
    EpisodeScriptConfirmationStore,
)
from aijian_api.repository import StudioRepository
from aijian_api.script_confirmation_impact_store import (
    ScriptConfirmationImpactError,
    ScriptConfirmationImpactNotFoundError,
    ScriptConfirmationImpactStore,
    _read_report,
)
from test_assembly_script_provenance import confirm, revise, source_fixture
from test_assembly_storyboard_provenance import save


def payload(script):
    return CreateEpisodeScriptConfirmationRequest(
        version_id=script.version_id,
        expected_content_hash=script.content_hash,
        expected_head_revision=script.head_revision,
        confirm=True,
    )


def replacement(repository, project, episode, script):
    scenes = copy.deepcopy(script.content.model_dump(mode="json")["scenes"])
    scenes[0]["blocks"][0]["text"] = "Explicit changed dialogue."
    newer = revise(repository, project, episode, script, scenes=scenes)
    return newer, confirm(repository, project, episode, newer)


def test_baseline_same_source_replaced_and_original_recovery_after_restart(tmp_path):
    repo, p, e, audio, script, assembly, first = source_fixture(tmp_path)
    store = ScriptConfirmationImpactStore(repo)
    baseline = store.lookup(p, e, first.confirmation_id)
    assert baseline.report.assessment.event_kind == "BASELINE"
    assert baseline.report.assessment.targets == ()
    duplicate = confirm(repo, p, e, script)
    same = store.lookup(p, e, duplicate.confirmation_id).report
    assert same.assessment.event_kind == "SAME_SOURCE" and not same.assessment.targets
    newer, receipt = replacement(repo, p, e, script)
    report = store.lookup(p, e, receipt.confirmation_id).report
    assert report.assessment.old_confirmation == duplicate
    target = next(t for t in report.assessment.targets if t.version_id == assembly.version_id)
    assert target.classification == "SOURCE_SUPERSEDED" and target.aggregate_impact == "blocking"
    assert target.context.sequence_timebase == assembly.content.sequence_timebase
    assert [(s.kind, s.segment.segment_id) for s in target.context.segments] == [
        ("DIALOGUE_AUDIO", "seg_dialogue"),
        ("TEXT_SUBTITLE", "seg_script_subtitle"),
    ]
    assert target.context.segments[0].segment.media.sha256 == audio.latest_version.sha256
    frozen = report.model_dump(mode="json")
    # Historic facts survive new drafts, later confirmations, and missing originals.
    audio_path = tmp_path / "owned-dialogue.wav"
    audio_path.unlink()
    next_script = revise(repo, p, e, newer)
    confirm(repo, p, e, next_script)
    reopened = ScriptConfirmationImpactStore(StudioRepository(repo.database_path))
    assert reopened.get(p, report.report_id).model_dump(mode="json") == frozen
    assert reopened.list_page(p, limit=1).next_cursor is not None
    page = reopened.list_page(p, cursor=report.report_id, limit=1)
    assert page.items[0].new_confirmation_id == duplicate.confirmation_id
    with repo._connection() as c:
        for table in ("gate_decisions", "invalidation_operations", "draft_export_jobs"):
            assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
        assert (
            c.execute(
                "SELECT count(*) FROM artifact_heads WHERE accepted_version_id IS NOT NULL"
            ).fetchone()[0]
            == 0
        )
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            c.execute(
                "UPDATE script_confirmation_impacts SET assessment_hash = ?",
                ("sha256:" + "0" * 64,),
            )


@pytest.mark.parametrize("step", ["receipt_inserted", "report_inserted", "report_verified"])
def test_atomic_failure_rolls_back_receipt_and_report_and_retry_is_original_input(tmp_path, step):
    repo, p, e, _, script, _, _ = source_fixture(tmp_path, confirmed=False)
    operation = str(uuid4())

    def fail(operation_name, current_step):
        if operation_name == "script_confirmation_impact" and current_step == step:
            raise sqlite3.OperationalError("Controlled transaction failure")

    failing = StudioRepository(repo.database_path, transaction_hook=fail)
    writer = EpisodeScriptConfirmationStore(failing)
    with pytest.raises(EpisodeScriptConfirmationStorageError):
        writer.confirm(
            project_id=p,
            episode_id=e,
            payload=payload(script),
            idempotency_key=operation,
            actor_id="local-user",
        )
    with repo._connection() as c:
        assert c.execute("SELECT count(*) FROM episode_script_confirmations").fetchone()[0] == 0
        assert c.execute("SELECT count(*) FROM script_confirmation_impacts").fetchone()[0] == 0
    # This explicit test invocation exercises local idempotency, not production UNKNOWN retry.
    writer = EpisodeScriptConfirmationStore(repo)
    status, replayed = writer.confirm(
        project_id=p,
        episode_id=e,
        payload=payload(script),
        idempotency_key=operation,
        actor_id="local-user",
    )
    assert not replayed
    repeated, replayed = writer.confirm(
        project_id=p,
        episode_id=e,
        payload=payload(script),
        idempotency_key=operation,
        actor_id="local-user",
    )
    assert replayed and repeated == status
    exact = ScriptConfirmationImpactStore(repo).operation(
        p, e, operation, payload(script), "local-user"
    )
    assert exact.lookup.confirmation == status.confirmation
    assert exact.lookup.coverage == "RECORDED"
    revise(repo, p, e, script)
    assert (
        ScriptConfirmationImpactStore(repo).operation(
            p, e, operation, payload(script), "local-user"
        )
        == exact
    )
    with pytest.raises(ScriptConfirmationImpactError):
        ScriptConfirmationImpactStore(repo).operation(
            p, e, operation, payload(script), "another-actor"
        )
    with pytest.raises(ScriptConfirmationImpactError):
        ScriptConfirmationImpactStore(repo).operation(
            p,
            e,
            operation,
            payload(script).model_copy(update={"expected_head_revision": script.head_revision + 1}),
            "local-user",
        )
    with pytest.raises(ScriptConfirmationImpactNotFoundError):
        ScriptConfirmationImpactStore(repo).operation(
            p, e, str(uuid4()), payload(script), "local-user"
        )


def test_actual_43_to_44_migration_preserves_legacy_hash_and_requires_new_coverage(
    tmp_path, monkeypatch
):
    with monkeypatch.context() as m:
        m.setattr(repository_module, "SCHEMA_VERSION", 43)
        repo, p, e, _, script, _, _ = source_fixture(tmp_path, confirmed=False)
        original_id, operation = "esc_" + uuid4().hex, str(uuid4())
        original_payload = payload(script)
        request_hash = canonical_content_hash(
            {
                "project_id": p,
                "episode_id": e,
                "actor_id": "local-user",
                "payload": original_payload.model_dump(mode="json"),
            }
        )
        with repo._connection() as c:
            c.execute(
                "INSERT INTO episode_script_confirmations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    original_id,
                    p,
                    e,
                    script.artifact_id
                    if hasattr(script, "artifact_id")
                    else c.execute(
                        "SELECT artifact_id FROM artifact_versions WHERE version_id = ?",
                        (script.version_id,),
                    ).fetchone()[0],
                    script.version_id,
                    script.content_hash,
                    script.head_revision,
                    "local-user",
                    canonical_content_hash({"value": operation}),
                    request_hash,
                    datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                ),
            )
            c.commit()
            original_row = tuple(c.execute("SELECT * FROM episode_script_confirmations").fetchone())
    migrated = StudioRepository(repo.database_path)
    store = ScriptConfirmationImpactStore(migrated)
    lookup = store.lookup(p, e, original_id)
    assert lookup.coverage == "UNCOVERED_LEGACY" and lookup.report is None
    assert store.operation(p, e, operation, original_payload, "local-user").lookup == lookup
    with migrated._connection() as c:
        row = tuple(c.execute("SELECT * FROM episode_script_confirmations").fetchone())
        assert row[:-1] == original_row and row[-1] == 0
        assert c.execute("SELECT count(*) FROM script_confirmation_impacts").fetchone()[0] == 0
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            c.execute("UPDATE episode_script_confirmations SET impact_coverage_version = 1")
    newer, receipt = replacement(migrated, p, e, script)
    report = store.lookup(p, e, receipt.confirmation_id).report
    assert report.assessment.old_confirmation.confirmation_id == original_id
    assert store.list_page(p).preexisting_confirmation_count == 1


def test_legacy_actual_content_references_are_advisory_without_forged_edges(tmp_path):
    repo, p, e, _, script, saved, _ = source_fixture(tmp_path)
    # New source Fixture's predecessor is a real pre-provenance assembly. Save another
    # exact legacy body referencing the now-confirmed source, without adding a new field.
    legacy_content = saved.content.model_dump(mode="json")
    del legacy_content["script_provenance"]
    legacy_content["subtitle_segments"] = [
        {
            "segment_id": "seg_script_subtitle",
            "start_frame": 12,
            "end_frame": 36,
            "script_version_id": script.version_id,
            "script_block_id": "sblk_" + "b" * 32,
        }
    ]
    legacy = save(repo, p, e, saved, legacy_content)
    _, receipt = replacement(repo, p, e, script)
    target = next(
        t
        for t in ScriptConfirmationImpactStore(repo)
        .lookup(p, e, receipt.confirmation_id)
        .report.assessment.targets
        if t.version_id == legacy.version_id
    )
    assert target.classification == "ADVISORY_LEGACY_REVIEW"
    assert target.reasons[0].origin == "LEGACY_CONTENT_REFERENCE" and target.reasons[0].edges == ()
    assert len(target.context.segments) == 2
    with repo._connection() as c:
        assert (
            c.execute(
                "SELECT count(*) FROM artifact_dependencies WHERE downstream_version_id = ?",
                (legacy.version_id,),
            ).fetchone()[0]
            == 0
        )


def test_actual_project_and_episode_report_scope_and_corrupt_hash_fail_closed(tmp_path):
    a = source_fixture(tmp_path / "a")
    b = source_fixture(tmp_path / "b")
    repo, p, e, _, script, _, _ = a
    _, receipt = replacement(repo, p, e, script)
    store = ScriptConfirmationImpactStore(repo)
    report = store.lookup(p, e, receipt.confirmation_id).report
    with pytest.raises(ScriptConfirmationImpactNotFoundError):
        store.get(b[1], report.report_id)
    with pytest.raises(ScriptConfirmationImpactNotFoundError):
        store.lookup(p, b[2], receipt.confirmation_id)
    # Controlled in-memory bad receipt, retaining DB immutability protections.
    with repo._connection() as c:
        row = dict(
            c.execute(
                "SELECT * FROM script_confirmation_impacts WHERE report_id = ?", (report.report_id,)
            ).fetchone()
        )
        row["assessment_hash"] = "sha256:" + "0" * 64
        with pytest.raises(ScriptConfirmationImpactError, match="integrity"):
            _read_report(repo, c, row)


def test_authenticated_native_original_get_is_private_and_never_establishes_not_submitted(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repo, p, e, _, script, _, _ = source_fixture(tmp_path, confirmed=False)
    operation = str(uuid4())
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    app = create_app(repository=repo, sidecar_security=security)
    path = f"/api/v1/projects/{p}/episodes/{e}/script/confirmation-operations/{operation}"
    headers = {"Authorization": "Bearer " + "x" * 43, "Origin": "app://aijian"}
    params = payload(script).model_dump(mode="json")
    del params["confirm"]
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        assert client.get(path, params=params).status_code == 401
        unknown = client.get(path, headers=headers, params=params)
        assert unknown.status_code == 404
        assert unknown.json()["error"]["code"] == "SCRIPT_CONFIRMATION_OPERATION_UNKNOWN"
        status, _ = EpisodeScriptConfirmationStore(repo).confirm(
            project_id=p,
            episode_id=e,
            payload=payload(script),
            idempotency_key=operation,
            actor_id="local-user",
        )
        response = client.get(path, headers=headers, params=params)
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        assert (
            response.json()["data"]["lookup"]["confirmation"]["confirmation_id"]
            == status.confirmation.confirmation_id
        )
        history = client.get(f"/api/v1/projects/{p}/script-confirmation-impacts", headers=headers)
        assert history.status_code == 200 and len(history.json()["data"]["items"]) == 1
        assert not any("confirmation-operations" in value for value in app.openapi()["paths"])


def test_assessment_byte_budget_rolls_back_both_atomic_rows(tmp_path, monkeypatch):
    from aijian_api import script_confirmation_impact_store as impact_module

    repo, p, e, _, script, _, _ = source_fixture(tmp_path, confirmed=False)
    monkeypatch.setattr(impact_module, "MAX_ASSESSMENT_BYTES", 100)
    with pytest.raises(EpisodeScriptConfirmationStorageError):
        confirm(repo, p, e, script)
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT count(*) FROM episode_script_confirmations").fetchone()[0]
            == 0
        )
        assert (
            connection.execute("SELECT count(*) FROM script_confirmation_impacts").fetchone()[0]
            == 0
        )


def test_two_projects_two_episodes_in_one_database_remain_exactly_isolated(tmp_path):
    from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
    from aijian_api.episode_script_store import EpisodeScriptStore
    from test_production_brief import original_payload

    repo, p, e, _, script, _, first = source_fixture(tmp_path)
    other_project = repo.create_project(
        name="Second owned project",
        aspect_ratio="16:9",
        target_duration_seconds=60,
        source_language="zh",
    ).id
    other_episode = repo.create_episode(p, title="Second owned episode").id
    other_project_episode = repo.list_episodes(other_project)[0].id
    fourth_episode = repo.create_episode(other_project, title="Second episode B").id
    briefs = {p: repo.get_latest_artifact(p, "production_brief")}
    others = []
    for owner, episode in (
        (p, other_episode),
        (other_project, other_project_episode),
        (other_project, fourth_episode),
    ):
        if owner not in briefs:
            briefs[owner] = repo.create_artifact_version(
                project_id=owner,
                artifact_type="production_brief",
                schema_version="1.0.0",
                content=original_payload(),
                author_actor_type="human",
                author_actor_id="local-user",
                change_summary="Independent owned intent",
            )
        brief = briefs[owner]
        content = script.content.model_dump(mode="json")
        content.update(
            project_id=owner, episode_id=episode, production_brief_version_id=brief.version.id
        )
        other, _ = EpisodeScriptStore(repo).write(
            project_id=owner,
            episode_id=episode,
            payload=CreateEpisodeScriptVersionRequest.model_validate(
                {"content": content, "change_summary": "Independent owned episode script"}
            ),
            idempotency_key=str(uuid4()),
            actor_id="local-user",
        )
        others.append((owner, episode, confirm(repo, owner, episode, other)))
    _, next_receipt = replacement(repo, p, e, script)
    store = ScriptConfirmationImpactStore(repo)
    exact = store.lookup(p, e, next_receipt.confirmation_id).report
    assert all(target.episode_id == e for target in exact.assessment.targets)
    assert len(store.list_page(p).items) == 3
    assert len(store.list_page(other_project).items) == 2
    assert store.lookup(p, e, first.confirmation_id).report.assessment.event_kind == "BASELINE"
    for owner, episode, receipt in others:
        assert store.lookup(owner, episode, receipt.confirmation_id).report.assessment.targets == ()
        with pytest.raises(ScriptConfirmationImpactNotFoundError):
            store.lookup(p, e, receipt.confirmation_id)
    with pytest.raises(ScriptConfirmationImpactNotFoundError):
        store.list_page(other_project, cursor=exact.report_id)


def test_exact_storyboard_and_assembly_shots_are_frozen_with_weakest_path_strength(tmp_path):
    from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
    from test_episode_storyboard import payload as board_payload
    from test_episode_storyboard import shot

    repo, p, e, _, script, saved, _ = source_fixture(tmp_path)
    board, _ = EpisodeStoryboardStore(repo).write(
        project_id=p,
        episode_id=e,
        payload=board_payload(p, e, script=script.version_id, shots=[shot(1)]),
        idempotency_key=str(uuid4()),
        actor_id="local-user",
    )
    content = saved.content.model_dump(mode="json")
    content["visual_segments"][0]["storyboard_ref"] = {
        "storyboard_version_id": board.version_id,
        "shot_id": board.content.shots[0].shot_id,
    }
    linked = save(repo, p, e, saved, content)
    _, receipt = replacement(repo, p, e, script)
    report = ScriptConfirmationImpactStore(repo).lookup(p, e, receipt.confirmation_id).report
    target = next(t for t in report.assessment.targets if t.version_id == linked.version_id)
    assert target.aggregate_impact == "blocking"
    assert {reason.effective_impact for reason in target.reasons} == {"blocking", "advisory"}
    assert len(target.context.storyboard_references) == 1
    ref = target.context.storyboard_references[0]
    assert (ref.storyboard_version_id, ref.storyboard_content_hash, ref.shot.shot_id) == (
        board.version_id,
        board.content_hash,
        board.content.shots[0].shot_id,
    )
    board_target = next(t for t in report.assessment.targets if t.version_id == board.version_id)
    assert board_target.context.kind == "STORYBOARD" and board_target.aggregate_impact == "blocking"
