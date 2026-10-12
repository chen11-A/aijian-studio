"""G5 exact immutable evidence and human approval; native decoder is not run here."""

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.domain import TrustedReviewActor
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.repository import (
    ArtifactConflictError,
    GateNotReadyError,
    ReviewInvalidError,
    StudioRepository,
)
from aijian_api.visual_bible_contracts import (
    CreateVisualBibleVersionRequest,
    VisualImageInspectionInput,
)
from aijian_api.visual_bible_store import VisualBibleConflictError, VisualBibleStore
from aijian_api.visual_media_inspection_store import (
    VisualInspectionError,
    VisualMediaInspectionStore,
)
from test_character_reference_assets import candidate, png
from test_project_creative_library import make_project

ACTOR = TrustedReviewActor("local-user", ("writer", "continuity_reviewer", "producer"))
ROLES = ("continuity_reviewer", "producer")


def setup_visual(tmp_path: Path):
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    asset = MediaAssetStore(repository).import_local(project, png(tmp_path / "image.png"))
    original = asset.latest_version
    library_request = candidate(project, asset.id, original.id, original.sha256).model_dump(
        mode="json"
    )
    library_request["content"]["references"].append(
        {
            **library_request["content"]["references"][0],
            "reference_id": "crf_" + "0" * 32,
            "ordinal": 2,
            "character_id": "chr_" + "c" * 32,
            "costume_id": None,
        }
    )
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=CreateProjectCreativeLibraryVersionRequest.model_validate(library_request),
        idempotency_key="library",
        actor_id=ACTOR.subject_id,
    )
    request = CreateVisualBibleVersionRequest.model_validate(
        {
            "content": {
                "schema_version": "1.0.0",
                "project_id": project,
                "creative_library_version_id": library.version_id,
                "creative_library_content_hash": library.content_hash,
                "character_reference_ids": ["crf_" + "f" * 32, "crf_" + "0" * 32],
                "scenes": [
                    {
                        "scene_id": "loc_" + "b" * 32,
                        "assets": [
                            {
                                "asset_id": asset.id,
                                "asset_version_id": original.id,
                                "sha256": original.sha256,
                            }
                        ],
                    }
                ],
                "props": [],
                "safe_area": {
                    "canvas_width": 1080,
                    "canvas_height": 1920,
                    "x": 54,
                    "y": 96,
                    "width": 972,
                    "height": 1728,
                },
                "effective_scope": "PROJECT",
                "change_reason": "人工选择完整视觉基线",
            },
            "parent_version_id": None,
            "expected_revision": None,
            "change_summary": "保存视觉版本供人工审签",
        }
    )
    saved, _ = VisualBibleStore(repository).write(
        project,
        request,
        idempotency_key="visual",
        actor_id=ACTOR.subject_id,
    )
    return repository, project, asset, request, saved


def clear_rights(repository, project, asset, revision=0, decision="CLEARED"):
    return MediaAssetRightsStore(repository).append_human_decision(
        project,
        asset.id,
        asset.latest_version.id,
        HumanRightsDecisionInput(
            operation_id="rdop_" + uuid4().hex,
            expected_revision=revision,
            decision=decision,
            basis_text="This is an explicit synthetic fixture declaration for testing only.",
        ),
        actor_id=ACTOR.subject_id,
    )


def inspect_fixture(repository, project, asset):
    # Controlled trusted-adapter evidence. No claim of Electron/Windows decode acceptance.
    version = asset.latest_version
    evidence = VisualImageInspectionInput(
        operation_id="vinop_" + uuid4().hex,
        asset_sha256=version.sha256,
        byte_size=version.byte_size,
        mime_type="image/png",
        width=1,
        height=1,
        pixel_sha256="f" * 64,
        decoder="ELECTRON_NATIVE_IMAGE",
        decoder_version="TEST_ADAPTER",
    )
    return VisualMediaInspectionStore(repository).append(
        project,
        asset.id,
        version.id,
        evidence,
        actor_id=ACTOR.subject_id,
    )[0]


def prepare(repository, project, saved, revision, action, payload, report_id=None):
    return repository.prepare_review_action(
        project_id=project,
        artifact_type="visual_bible",
        version_id=saved.version.id,
        action=action,
        action_payload=payload,
        actor=ACTOR,
        expected_revision=revision,
        readiness_report_id=report_id,
    )


def submitted(repository, project, saved):
    challenge = prepare(repository, project, saved, saved.head.revision, "submit", {})
    return repository.submit_artifact_review(
        project_id=project,
        artifact_type="visual_bible",
        version_id=saved.version.id,
        expected_revision=saved.head.revision,
        challenge_id=challenge.challenge.id,
        confirmation_token=challenge.confirmation_token,
        actor=ACTOR,
    )


def signed(repository, project, saved):
    sub = submitted(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sub.head.revision, "signoff", {"roles": list(ROLES)}
    )
    sign = repository.signoff_artifact_review(
        project_id=project,
        artifact_type="visual_bible",
        version_id=saved.version.id,
        roles=ROLES,
        expected_revision=sub.head.revision,
        challenge_id=challenge.challenge.id,
        confirmation_token=challenge.confirmation_token,
        actor=ACTOR,
    )
    return sign, challenge.report.id


def decision_payload(decision="approved"):
    return {"decision": decision, "rationale": "人工核对后明确决定", "actor_role": "producer"}


def consume_decision(repository, project, saved, head, challenge, decision="approved"):
    return repository.decide_artifact_gate(
        project_id=project,
        artifact_type="visual_bible",
        version_id=saved.version.id,
        decision=decision,
        rationale=decision_payload(decision)["rationale"],
        expected_revision=head.revision,
        challenge_id=challenge.challenge.id,
        confirmation_token=challenge.confirmation_token,
        actor=ACTOR,
        actor_role="producer",
    )


def test_full_manual_approval_restart_replay_exact_scope(tmp_path):
    repository, project, asset, request, saved = setup_visual(tmp_path)
    with pytest.raises(GateNotReadyError):
        prepare(repository, project, saved, 1, "submit", {})
    clear_rights(repository, project, asset)
    with pytest.raises(GateNotReadyError):
        prepare(repository, project, saved, 1, "submit", {})
    inspection = inspect_fixture(repository, project, asset)
    replay, replayed = VisualMediaInspectionStore(repository).append(
        project,
        asset.id,
        asset.latest_version.id,
        inspection.evidence,
        actor_id=ACTOR.subject_id,
    )
    assert replayed and replay == inspection
    sign, report = signed(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload(), report
    )
    approved = consume_decision(repository, project, saved, sign.head, challenge)
    assert approved.head.accepted_version_id == saved.version.id
    assert approved.decision.gate == "G5" and approved.decision.self_review
    reopened = StudioRepository(repository.database_path)
    assert VisualBibleStore(reopened).index(project).accepted_version == saved.version
    original, replayed = VisualBibleStore(reopened).write(
        project,
        request,
        idempotency_key="visual",
        actor_id=ACTOR.subject_id,
    )
    assert replayed and original.version == saved.version
    with pytest.raises(ReviewInvalidError):
        consume_decision(repository, project, saved, sign.head, challenge)
    other = make_project(repository)
    with pytest.raises(ArtifactConflictError):
        VisualBibleStore(repository).get_version(other, saved.version.id)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM gate_decisions").fetchone() == (1,)
        assert connection.execute(
            "SELECT COUNT(*) FROM visual_bible_write_requests"
        ).fetchone() == (1,)


@pytest.mark.parametrize("fault", ["missing", "changed", "rights", "inspection"])
def test_approval_rechecks_after_prepare_without_consuming_on_failure(tmp_path, fault):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sign, report = signed(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload(), report
    )
    version = asset.latest_version
    blob = (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    )
    if fault == "missing":
        blob.unlink()
    elif fault == "changed":
        blob.write_bytes(b"x" * version.byte_size)
    elif fault == "rights":
        clear_rights(repository, project, asset, revision=1, decision="RESTRICTED")
    else:
        inspect_fixture(repository, project, asset)
    with pytest.raises(ReviewInvalidError):
        consume_decision(repository, project, saved, sign.head, challenge)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM gate_decisions").fetchone() == (0,)
        assert connection.execute(
            "SELECT consumed_at FROM confirmation_challenges WHERE challenge_id=?",
            (challenge.challenge.id,),
        ).fetchone() == (None,)
        assert connection.execute(
            "SELECT accepted_version_id FROM artifact_heads WHERE artifact_id=?",
            (saved.version.artifact_id,),
        ).fetchone() == (None,)


def test_prepared_signed_report_is_rechecked_not_only_on_consume(tmp_path):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sign, report = signed(repository, project, saved)
    clear_rights(repository, project, asset, revision=1, decision="RESTRICTED")
    with pytest.raises(ReviewInvalidError):
        prepare(
            repository, project, saved, sign.head.revision, "decision", decision_payload(), report
        )


def test_approval_cannot_skip_required_signature_or_trusted_actor(tmp_path):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sub = submitted(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sub.head.revision, "decision", decision_payload()
    )
    with pytest.raises(ReviewInvalidError, match="signoffs"):
        consume_decision(repository, project, saved, sub.head, challenge)
    with pytest.raises(ReviewInvalidError):
        repository.prepare_review_action(
            project_id=project,
            artifact_type="visual_bible",
            version_id=saved.version.id,
            action="decision",
            action_payload=decision_payload(),
            actor=TrustedReviewActor("view", ("viewer",)),
            expected_revision=sub.head.revision,
        )


def test_visual_write_cas_key_hash_and_inspection_scope(tmp_path):
    repository, project, asset, request, saved = setup_visual(tmp_path)
    with pytest.raises(VisualBibleConflictError):
        VisualBibleStore(repository).write(
            project, request, idempotency_key="new", actor_id=ACTOR.subject_id
        )
    altered = request.model_copy(update={"change_summary": "different"})
    with pytest.raises(VisualBibleConflictError):
        VisualBibleStore(repository).write(
            project, altered, idempotency_key="visual", actor_id=ACTOR.subject_id
        )
    proof = inspect_fixture(repository, project, asset)
    altered_proof = proof.evidence.model_copy(update={"pixel_sha256": "e" * 64})
    with pytest.raises(VisualInspectionError):
        VisualMediaInspectionStore(repository).append(
            project, asset.id, asset.latest_version.id, altered_proof, actor_id=ACTOR.subject_id
        )
    other = make_project(repository)
    with pytest.raises(VisualInspectionError):
        VisualMediaInspectionStore(repository).read_operation(other, proof.evidence.operation_id)


def test_api_manual_actions_recovery_and_authority(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    security = SidecarSecurity(token="x" * 43, host="127.0.0.1:43124", origin="app://aijian")
    client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    client.headers.update({"Authorization": f"Bearer {'x' * 43}", "Origin": "app://aijian"})
    path = f"/api/v1/projects/{project}/visual-bible/versions/{saved.version.id}"
    internal = f"/api/v1/internal/projects/{project}/visual-bible/versions/{saved.version.id}"
    assert client.get(path + "/readiness").json()["data"]["report"]["ready"] is True
    revision = saved.head.revision
    signed_report = None
    for action in ("submit", "signoff", "decision"):
        payload = {
            "action": action,
            "roles": list(ROLES) if action == "signoff" else [],
            "decision": "approved" if action == "decision" else None,
            "rationale": "经人工完整核对明确批准" if action == "decision" else None,
            "readiness_report_id": signed_report if action == "decision" else None,
        }
        prepared = client.post(
            internal + "/review:prepare",
            json=payload,
            headers={"If-Match": f'"revision-{revision}"'},
        )
        assert prepared.status_code == 200, prepared.text
        data = prepared.json()["data"]
        read = client.get(path + "/review-operations/" + data["challenge"]["id"])
        assert read.status_code == 200, read.text
        assert read.json()["data"]["state"] == "NOT_CONSUMED"
        assert read.json()["data"]["terminal_no_write"] is False
        confirmed = client.post(
            internal + "/review:confirm",
            json={
                **payload,
                "challenge_id": data["challenge"]["id"],
                "confirmation_token": data["confirmation_token"],
            },
            headers={"If-Match": f'"revision-{revision}"'},
        )
        assert confirmed.status_code == 200, confirmed.text
        receipt = confirmed.json()["data"]
        assert receipt["state"] == "COMPLETED" and receipt["result_revision"] == revision + 1
        assert receipt["terminal_no_write"] is False
        assert (
            client.get(path + "/review-operations/" + data["challenge"]["id"]).json()["data"]
            == receipt
        )
        if action == "signoff":
            signed_report = data["report"]["id"]
            state = client.get(path + "/review-state").json()["data"]
            assert {x["role"] for x in state["signoffs"]} == set(ROLES)
            assert state["reports"][0]["id"] == signed_report
        revision += 1
    assert client.get(path + "/authority").json()["data"]["status"] == "CURRENT"
    clear_rights(repository, project, asset, revision=1, decision="RESTRICTED")
    assert client.get(path + "/authority").json()["data"]["status"] == "EVIDENCE_CHANGED"
    other = make_project(repository)
    wrong = path.replace(project, other)
    assert client.get(wrong).status_code in (404, 409, 500)
    assert (
        client.post(
            internal + "/review:prepare",
            json={**payload, "approved": True},
            headers={"If-Match": f'"revision-{revision}"'},
        ).status_code
        == 422
    )
    unauthenticated = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url="http://127.0.0.1:43124",
        client=("127.0.0.1", 50101),
    )
    assert unauthenticated.post(internal + "/review:confirm", json=payload).status_code == 401


def test_g5_signed_report_requires_fresh_evidence_and_new_unexpired_challenge(tmp_path):
    from datetime import timedelta

    from test_review_repository import MutableClock

    repository, project, asset, _, saved = setup_visual(tmp_path)
    clock = MutableClock()
    repository._clock = clock
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sign, report = signed(repository, project, saved)
    clock.advance(timedelta(minutes=6))
    challenge = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload(), report
    )
    assert challenge.report.expires_at < clock.value < challenge.challenge.expires_at
    clock.advance(timedelta(minutes=6))
    with pytest.raises(ReviewInvalidError):
        consume_decision(repository, project, saved, sign.head, challenge)
    renewed = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload(), report
    )
    assert (
        consume_decision(repository, project, saved, sign.head, renewed).head.accepted_version_id
        == saved.version.id
    )


def test_saved_historical_visual_remains_readable_after_original_disappears(tmp_path):
    repository, project, asset, request, saved = setup_visual(tmp_path)
    version = asset.latest_version
    (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    ).unlink()
    assert (
        VisualBibleStore(repository).get_version(project, saved.version.id).version == saved.version
    )
    replay, replayed = VisualBibleStore(repository).write(
        project, request, idempotency_key="visual", actor_id=ACTOR.subject_id
    )
    assert replayed and replay.version == saved.version
    with pytest.raises(GateNotReadyError):
        prepare(repository, project, saved, 1, "submit", {})


def test_g5_blocking_finding_refuses_approval_without_consuming_nonce(tmp_path, monkeypatch):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sign, report = signed(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload(), report
    )
    # Existing finding-write protection stays enabled; inject only its read result.
    monkeypatch.setattr(
        repository,
        "_has_open_blocking_findings",
        lambda _c, sub: sub == sign.head.review_submission_id,
    )
    with pytest.raises(ReviewInvalidError, match="Blocking"):
        consume_decision(repository, project, saved, sign.head, challenge)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM gate_decisions").fetchone() == (0,)
        assert connection.execute(
            "SELECT consumed_at FROM confirmation_challenges WHERE challenge_id=?",
            (challenge.challenge.id,),
        ).fetchone() == (None,)


def test_damaged_g5_candidate_can_be_explicitly_rejected_but_never_approved(tmp_path):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sign, _ = signed(repository, project, saved)
    version = asset.latest_version
    (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    ).unlink()
    challenge = prepare(
        repository, project, saved, sign.head.revision, "decision", decision_payload("rejected")
    )
    assert challenge.report.report["ready"] is False
    rejected = consume_decision(repository, project, saved, sign.head, challenge, "rejected")
    assert rejected.decision.decision == "rejected"
    assert rejected.head.accepted_version_id is None
    assert (
        VisualBibleStore(repository).get_version(project, saved.version.id).version == saved.version
    )
