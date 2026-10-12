"""Exact G5 settlement uses immutable receipts, never fresh original-file checks."""

import pytest
from aijian_api import visual_bible_routes as routes
from aijian_api.domain import TrustedReviewActor
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.repository import ReviewInvalidError
from aijian_api.visual_review_contracts import VisualGateDecisionData, VisualRoleSignoffData
from test_visual_bible_g5 import (
    ACTOR,
    ROLES,
    clear_rights,
    consume_decision,
    decision_payload,
    inspect_fixture,
    prepare,
    setup_visual,
    signed,
    submitted,
)


@pytest.mark.parametrize("fault", ["decision", "rationale", "signoff-role"])
def test_receipt_projection_rejects_corrupted_outcome_without_ending_unknown(
    tmp_path, monkeypatch, fault
):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    if fault == "signoff-role":
        sub = submitted(repository, project, saved)
        challenge = prepare(
            repository, project, saved, sub.head.revision, "signoff", {"roles": list(ROLES)}
        )
        repository.signoff_artifact_review(
            project_id=project,
            artifact_type="visual_bible",
            version_id=saved.version.id,
            roles=ROLES,
            expected_revision=sub.head.revision,
            challenge_id=challenge.challenge.id,
            confirmation_token=challenge.confirmation_token,
            actor=ACTOR,
        )
    else:
        sign, report = signed(repository, project, saved)
        challenge = prepare(
            repository, project, saved, sign.head.revision, "decision", decision_payload(), report
        )
        consume_decision(repository, project, saved, sign.head, challenge)
    original = routes.operation_data(
        repository, project, saved.version.id, challenge.challenge.id, ACTOR
    )
    assert original.state == "COMPLETED"
    read_row = routes.from_row

    def damaged_projection(model, row, column):
        value = read_row(model, row, column)
        if model is VisualGateDecisionData:
            return value.model_copy(
                update={"decision": "rejected"}
                if fault == "decision"
                else {"rationale": "corrupted receipt"}
            )
        if model is VisualRoleSignoffData:
            return value.model_copy(update={"role": "producer"})
        return value

    # Inject a faulty projection only. Immutable SQLite security triggers remain intact.
    with monkeypatch.context() as injected:
        injected.setattr(routes, "from_row", damaged_projection)
        with pytest.raises(ReviewInvalidError):
            routes.operation_data(
                repository, project, saved.version.id, challenge.challenge.id, ACTOR
            )
    version = asset.latest_version
    blob = (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    )
    blob.unlink()
    monkeypatch.setattr(
        MediaAssetStore,
        "get_asset",
        lambda *a, **k: pytest.fail("Settlement must not read originals"),
    )
    assert (
        routes.operation_data(repository, project, saved.version.id, challenge.challenge.id, ACTOR)
        == original
    )


@pytest.mark.parametrize("roles", [("producer",), ("producer", "continuity_reviewer")])
def test_signoff_receipt_preserves_the_original_role_order_hash(tmp_path, roles):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sub = submitted(repository, project, saved)
    challenge = prepare(
        repository, project, saved, sub.head.revision, "signoff", {"roles": list(roles)}
    )
    repository.signoff_artifact_review(
        project_id=project,
        artifact_type="visual_bible",
        version_id=saved.version.id,
        roles=roles,
        expected_revision=sub.head.revision,
        challenge_id=challenge.challenge.id,
        confirmation_token=challenge.confirmation_token,
        actor=ACTOR,
    )
    receipt = routes.operation_data(
        repository, project, saved.version.id, challenge.challenge.id, ACTOR
    )
    assert receipt.state == "COMPLETED"
    assert set(s.role for s in receipt.signoffs) == set(roles)


@pytest.mark.parametrize(
    "actor",
    [
        TrustedReviewActor("different-user", ACTOR.roles),
        TrustedReviewActor("local-user", ("writer",)),
        TrustedReviewActor("local-user", tuple(reversed(ACTOR.roles))),
    ],
)
def test_settlement_rejects_a_different_trusted_subject_or_role_vector(tmp_path, actor):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    sub = submitted(repository, project, saved)
    # Read the original consumed submission challenge; actor changes cannot settle it.
    with repository._connection() as connection:
        challenge = connection.execute(
            "SELECT challenge_id FROM confirmation_challenges WHERE action='submit'"
        ).fetchone()[0]
    with pytest.raises(ReviewInvalidError, match="scope differs"):
        routes.operation_data(repository, project, saved.version.id, challenge, actor)
    assert (
        routes.operation_data(repository, project, saved.version.id, challenge, ACTOR).submission.id
        == sub.submission.id
    )
