"""Real SQLite human review/environment graph; decoder evidence is controlled only."""

import copy
import sqlite3
from pathlib import Path

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_storyboard_store import EpisodeStoryboardInputError, EpisodeStoryboardStore
from aijian_api.gate_policy import DEFAULT_GATE_POLICIES, VISUAL_ENVIRONMENT_GATE_POLICY_V2
from aijian_api.invalidation_consumer import inspect_consumer
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.repository import GateNotReadyError, ReviewInvalidError, StudioRepository
from aijian_api.visual_bible_authority import visual_authority
from aijian_api.visual_bible_contracts import CreateVisualBibleVersionRequest
from aijian_api.visual_bible_integrity import fresh_visual_readiness
from aijian_api.visual_bible_routes import operation_data
from aijian_api.visual_bible_store import VisualBibleStore
from pydantic import ValidationError
from test_character_reference_assets import png
from test_g5_storyboard_consumption import approve, assembly, board_request, write_board
from test_project_creative_library import make_project
from test_project_environment import environment
from test_visual_bible_g5 import (
    ACTOR,
    clear_rights,
    consume_decision,
    decision_payload,
    inspect_fixture,
    prepare,
    setup_visual,
    signed,
)

STATE = "scv_" + "1" * 32
REF = "erf_" + "3" * 32


def setup(tmp_path: Path):
    repo, project, asset, request, old = setup_visual(tmp_path)
    env_asset = MediaAssetStore(repo).import_local(
        project, png(tmp_path / "state.png", b"\xff\0\0")
    )
    prior = ProjectCreativeLibraryStore(repo).get_latest(project_id=project)
    lib = environment(
        project, env_asset.id, env_asset.latest_version.id, env_asset.latest_version.sha256
    ).model_dump(mode="json")
    lib["content"]["references"] = prior.content.model_dump(mode="json")["references"]
    lib.update(parent_version_id=prior.version_id, expected_revision=prior.head_revision)
    saved_lib, _ = ProjectCreativeLibraryStore(repo).write(
        project_id=project,
        payload=CreateProjectCreativeLibraryVersionRequest.model_validate(lib),
        idempotency_key="environment",
        actor_id=ACTOR.subject_id,
    )
    value = request.model_dump(mode="json")
    value.update(parent_version_id=old.version.id, expected_revision=old.head.revision)
    value["content"].update(
        schema_version="1.1.0",
        creative_library_version_id=saved_lib.version_id,
        creative_library_content_hash=saved_lib.content_hash,
        environment_scope={
            "world_included": True,
            "scene_variant_ids": [STATE],
            "environment_reference_ids": ["erf_" + "1" * 32, REF],
        },
    )
    candidate, _ = VisualBibleStore(repo).write(
        project,
        CreateVisualBibleVersionRequest.model_validate(value),
        idempotency_key="env-visual",
        actor_id=ACTOR.subject_id,
    )
    for image in (asset, env_asset):
        clear_rights(repo, project, image)
        inspect_fixture(repo, project, image)
    return repo, project, asset, env_asset, value, candidate, old


def board(project, episode, candidate):
    value = board_request(project, episode, candidate, schema="1.4.0")
    value["content"]["schema_version"] = "1.5.0"
    value["content"]["shots"][0]["environment_binding"] = {
        "variant_id": STATE,
        "reference_ids": ["erf_" + "1" * 32, REF],
    }
    return value


def test_actual_policy_projection_receipt_and_legacy_hash(tmp_path):
    repo, p, _, _, value, candidate, old = setup(tmp_path)
    assert (
        DEFAULT_GATE_POLICIES["visual_bible"].snapshot_hash
        == "sha256:3fc41a93028d6e11532d2896c6b9d16fbd4e56681b5f7a5999f99a12f0c7244d"
    )
    assert (
        VisualBibleStore(repo).get_version(p, old.version.id).version.content_hash
        == old.version.content_hash
    )
    sign, report = signed(repo, p, candidate)
    challenge = prepare(
        repo, p, candidate, sign.head.revision, "decision", decision_payload(), report
    )
    assert challenge.report.policy_version == "2"
    assert (
        challenge.report.report["policy_snapshot_hash"]
        == VISUAL_ENVIRONMENT_GATE_POLICY_V2.snapshot_hash
    )
    projection = challenge.report.report["environment_projection"]
    assert projection["declaration"] == value["content"]["environment_scope"]
    assert projection["states"][0]["weather"] == "雨后"
    assert projection["references"][0]["scene_id"] is None
    assert len(challenge.report.report["originals"]) == 2
    result = consume_decision(repo, p, candidate, sign.head, challenge)
    reopened = StudioRepository(repo.database_path)
    receipt = operation_data(reopened, p, candidate.version.id, challenge.challenge.id, ACTOR)
    assert receipt.state == "COMPLETED" and receipt.decision.id == result.decision.id
    with reopened._connection() as conn:
        assert visual_authority(reopened, conn, p, candidate.version.id).status == "CURRENT"
        assert conn.execute("SELECT COUNT(*) FROM task_ledger").fetchone()[0] == 0
        old_record = reopened._get_artifact_version_in_connection(
            conn,
            project_id=p,
            artifact_type="visual_bible",
            version_id=old.version.id,
            episode_id=None,
        )
        assert set(fresh_visual_readiness(reopened, conn, old_record, p)) == {
            "ready",
            "blocking",
            "version_id",
            "content_hash",
            "creative_library_version_id",
            "creative_library_content_hash",
            "effective_scope",
            "props_declared_empty",
            "originals",
        }


@pytest.mark.parametrize(
    "fault", ["unknown-state", "unknown-ref", "unselected-state-ref", "library-hash", "downgrade"]
)
def test_invalid_scope_cannot_append(tmp_path, fault):
    repo, p, _, _, value, candidate, _ = setup(tmp_path)
    value.update(parent_version_id=candidate.version.id, expected_revision=candidate.head.revision)
    c = value["content"]
    if fault == "unknown-state":
        c["environment_scope"]["scene_variant_ids"] = ["scv_" + "f" * 32]
    if fault == "unknown-ref":
        c["environment_scope"]["environment_reference_ids"] = ["erf_" + "f" * 32]
    if fault == "unselected-state-ref":
        c["environment_scope"]["scene_variant_ids"] = []
    if fault == "library-hash":
        c["creative_library_content_hash"] = "sha256:" + "f" * 64
    if fault == "downgrade":
        c["schema_version"] = "1.0.0"
        del c["environment_scope"]
    with pytest.raises(ValueError):
        VisualBibleStore(repo).write(
            p,
            CreateVisualBibleVersionRequest.model_validate(value),
            idempotency_key="bad",
            actor_id=ACTOR.subject_id,
        )
    assert VisualBibleStore(repo).index(p).latest_version.id == candidate.version.id


def test_state_requires_own_selected_original_and_empty_scope_is_explicit(tmp_path):
    repo, p, _, _, value, candidate, _ = setup(tmp_path)
    value.update(parent_version_id=candidate.version.id, expected_revision=candidate.head.revision)
    value["content"]["environment_scope"]["environment_reference_ids"] = ["erf_" + "1" * 32]
    missing, _ = VisualBibleStore(repo).write(
        p,
        CreateVisualBibleVersionRequest.model_validate(value),
        idempotency_key="incomplete",
        actor_id=ACTOR.subject_id,
    )
    with pytest.raises(GateNotReadyError):
        prepare(repo, p, missing, missing.head.revision, "submit", {})
    value.update(parent_version_id=missing.version.id, expected_revision=missing.head.revision)
    value["content"]["environment_scope"] = {
        "world_included": True,
        "scene_variant_ids": [],
        "environment_reference_ids": [],
    }
    empty, _ = VisualBibleStore(repo).write(
        p,
        CreateVisualBibleVersionRequest.model_validate(value),
        idempotency_key="empty",
        actor_id=ACTOR.subject_id,
    )
    approve(repo, p, empty)
    e = repo.list_episodes(p)[0].id
    with pytest.raises(EpisodeStoryboardInputError):
        write_board(repo, p, e, board(p, e, empty))


@pytest.mark.parametrize("fault", ["missing", "changed", "rights", "inspection", "legacy-policy"])
def test_environment_evidence_race_refuses_and_rolls_back(tmp_path, fault, monkeypatch):
    repo, p, _, image, _, candidate, _ = setup(tmp_path)
    sign, report = signed(repo, p, candidate)
    challenge = prepare(
        repo, p, candidate, sign.head.revision, "decision", decision_payload(), report
    )
    v = image.latest_version
    if fault in ("missing", "changed"):
        blob = tmp_path / "media-assets" / "blobs" / v.sha256[:2] / v.sha256
        if fault == "missing":
            blob.unlink()
        else:
            blob.write_bytes(b"x" * v.byte_size)
    elif fault == "rights":
        clear_rights(repo, p, image, revision=1, decision="RESTRICTED")
    elif fault == "inspection":
        inspect_fixture(repo, p, image)
    else:
        # Simulate a wrongly configured legacy policy without bypassing immutable rows.
        monkeypatch.setattr(
            repo, "_gate_policy", lambda *args, **kwargs: DEFAULT_GATE_POLICIES["visual_bible"]
        )
    with pytest.raises((ReviewInvalidError, GateNotReadyError)):
        consume_decision(repo, p, candidate, sign.head, challenge)
    with repo._connection() as conn:
        assert (
            conn.execute(
                "SELECT consumed_at FROM confirmation_challenges WHERE challenge_id=?",
                (challenge.challenge.id,),
            ).fetchone()[0]
            is None
        )
        assert conn.execute("SELECT COUNT(*) FROM gate_decisions").fetchone()[0] == 0
    if fault != "legacy-policy":
        assert (
            operation_data(repo, p, candidate.version.id, challenge.challenge.id, ACTOR).state
            == "NOT_CONSUMED"
        )
    else:
        with pytest.raises(ReviewInvalidError):
            operation_data(repo, p, candidate.version.id, challenge.challenge.id, ACTOR)


def test_two_episode_real_replacement_report_survives_reopen_original_loss_and_isolation(tmp_path):
    repo, p, asset, image, value, candidate, _ = setup(tmp_path)
    approved = approve(repo, p, candidate)
    episodes = [repo.list_episodes(p)[0].id, repo.create_episode(p, title="第二集").id]
    boards = [write_board(repo, p, e, board(p, e, candidate)) for e in episodes]
    assemblies = [assembly(repo, p, e, asset, b) for e, b in zip(episodes, boards, strict=True)]
    value.update(parent_version_id=candidate.version.id, expected_revision=approved.head.revision)
    value["content"]["change_reason"] = "雨后状态与共享环境另行人工复核批准"
    replacement, _ = VisualBibleStore(repo).write(
        p,
        CreateVisualBibleVersionRequest.model_validate(value),
        idempotency_key="replacement",
        actor_id=ACTOR.subject_id,
    )
    assert repo.list_invalidation_operations(p) == ()
    approve(repo, p, replacement)
    reopened = StudioRepository(repo.database_path)
    reports = reopened.list_invalidation_operations(p)
    assert len(reports) == 1
    report = reports[0]
    assert (
        report.old_accepted_version_id == candidate.version.id
        and report.new_accepted_version_id == replacement.version.id
    )
    affected = {
        path.affected_version_id for path in report.paths if path.aggregate_impact == "blocking"
    }
    assert {v.version_id for v in [*boards, *assemblies]} <= affected
    other = make_project(reopened)
    assert reopened.list_invalidation_operations(other) == ()
    for e, b, a in zip(episodes, boards, assemblies, strict=True):
        assert (
            EpisodeStoryboardStore(reopened)
            .get_version(project_id=p, episode_id=e, version_id=b.version_id)
            .content_hash
            == b.content_hash
        )
        with pytest.raises(EpisodeMediaAssemblyError):
            assembly(reopened, p, e, asset, b)
        assert (
            EpisodeMediaAssemblyStore(reopened)
            .read_version(p, e, version_id=a.version_id)
            .content_hash
            == a.content_hash
        )
    digest = image.latest_version.sha256
    (tmp_path / "media-assets" / "blobs" / digest[:2] / digest).unlink()
    before = repo.database_path.read_bytes()
    for path in report.paths:
        if path.affected_version_id in affected:
            inspected = inspect_consumer(reopened, p, report.id, path.id)
            assert inspected.shots and inspected.episode.id in episodes
    assert repo.database_path.read_bytes() == before
    assert (
        VisualBibleStore(reopened)
        .get_version(p, replacement.version.id)
        .version.content.change_reason
        == value["content"]["change_reason"]
    )
    with sqlite3.connect(repo.database_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (0,)


def test_old_g5_cannot_approve_environment_board_and_scope_membership_preserves_body(tmp_path):
    repo, p, _, _, _, candidate, old = setup(tmp_path)
    e = repo.list_episodes(p)[0].id
    with pytest.raises(EpisodeStoryboardInputError):
        write_board(repo, p, e, board(p, e, old))
    approve(repo, p, candidate)
    good = board(p, e, candidate)
    good["content"]["shots"][0]["environment_binding"]["reference_ids"] = ["erf_" + "1" * 32]
    saved = write_board(
        repo, p, e, good
    )  # World-only shot choice is allowed; the reviewed state has its own proof.
    assert saved.content.schema_version == "1.5.0"
    assert canonical_content_hash(saved.content.model_dump(mode="json")) == saved.content_hash
    from aijian_api.shot_plan_contracts import ShotPlanStoryboardBase
    from aijian_api.shot_plan_projection import projection_schema_for_base

    with repo._connection() as conn:
        with pytest.raises(ValueError, match="discard"):
            projection_schema_for_base(
                repo,
                conn,
                p,
                e,
                ShotPlanStoryboardBase(
                    version_id=saved.version_id,
                    content_hash=saved.content_hash,
                    head_revision=saved.head_revision,
                ),
            )
    bad = copy.deepcopy(good)
    bad.update(parent_version_id=saved.version_id, expected_revision=saved.head_revision)
    bad["content"]["shots"][0]["environment_binding"]["reference_ids"] = ["erf_" + "2" * 32]
    with pytest.raises(EpisodeStoryboardInputError):
        write_board(repo, p, e, bad)
    legacy_new_pin = board_request(p, e, candidate, schema="1.4.0")
    legacy_new_pin.update(parent_version_id=saved.version_id, expected_revision=saved.head_revision)
    with pytest.raises(EpisodeStoryboardInputError):
        write_board(repo, p, e, legacy_new_pin)
    good["content"]["schema_version"] = "1.4.0"
    from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest

    with pytest.raises(ValidationError):
        CreateEpisodeStoryboardVersionRequest.model_validate(good)


@pytest.mark.parametrize(
    "fault", ["unknown-field", "duplicate-state", "duplicate-ref", "world-number", "world-false"]
)
def test_environment_scope_is_closed(fault):
    from aijian_api.visual_bible_contracts import VisualEnvironmentScopeV1

    value = {
        "world_included": True,
        "scene_variant_ids": [STATE],
        "environment_reference_ids": [REF],
    }
    if fault == "unknown-field":
        value["approved"] = True
    if fault == "duplicate-state":
        value["scene_variant_ids"] = [STATE, STATE]
    if fault == "duplicate-ref":
        value["environment_reference_ids"] = [REF, REF]
    if fault == "world-number":
        value["world_included"] = 1
    if fault == "world-false":
        value["world_included"] = False
    with pytest.raises(ValidationError):
        VisualEnvironmentScopeV1.model_validate(value)


def test_authenticated_http_fresh_state_and_explicit_review_keep_real_v2_policy(tmp_path):
    from aijian_api.main import create_app
    from fastapi.testclient import TestClient
    from test_invalidation_api import _protected_client, _valid_headers

    repo, p, _, _, _, candidate, _ = setup(tmp_path)
    client = _protected_client(repo)
    client.headers.update(_valid_headers())
    version = candidate.version.id
    public = f"/api/v1/projects/{p}/visual-bible/versions/{version}"
    internal = f"/api/v1/internal/projects/{p}/visual-bible/versions/{version}"
    readiness = client.get(public + "/readiness")
    assert readiness.status_code == 200, readiness.text
    assert readiness.json()["data"]["report"]["policy_version"] == "2"
    assert client.get(public).json()["data"]["version"]["content"]["schema_version"] == "1.1.0"
    revision = candidate.head.revision
    signed_report = None
    for action in (
        {"action": "submit"},
        {"action": "signoff", "roles": ["continuity_reviewer", "producer"]},
        {"action": "decision", "decision": "approved", "rationale": "明确环境人工核对"},
    ):
        if action["action"] == "decision":
            action["readiness_report_id"] = signed_report
        prepared = client.post(
            internal + "/review:prepare",
            json=action,
            headers={"If-Match": f'"revision-{revision}"'},
        )
        assert prepared.status_code == 200, prepared.text
        data = prepared.json()["data"]
        if action["action"] == "signoff":
            signed_report = data["report"]["id"]
        assert data["report"]["policy_version"] == "2"
        confirmed = client.post(
            internal + "/review:confirm",
            json={
                **action,
                "challenge_id": data["challenge"]["id"],
                "confirmation_token": data["confirmation_token"],
            },
            headers={"If-Match": f'"revision-{revision}"'},
        )
        assert confirmed.status_code == 200, confirmed.text
        revision = confirmed.json()["data"]["result_revision"]
    state = client.get(public + "/review-state")
    assert state.status_code == 200 and all(
        r["policy_version"] == "2" for r in state.json()["data"]["reports"]
    )
    assert client.get(public + "/authority").json()["data"]["status"] == "CURRENT"
    denied = TestClient(create_app(repository=repo))
    assert (
        denied.post(
            internal + "/review:prepare",
            json={"action": "submit"},
            headers={"If-Match": f'"revision-{revision}"'},
        ).status_code
        == 404
    )
