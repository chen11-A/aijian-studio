"""Pure visual review DTO checks; validation cannot grant human approval."""

from copy import deepcopy
from datetime import UTC, datetime

import pytest
from aijian_api import visual_bible_contracts as visual
from pydantic import ValidationError


def content():
    return {
        "schema_version": "1.0.0",
        "project_id": "prj_" + "a" * 32,
        "creative_library_version_id": "ver_" + "a" * 32,
        "creative_library_content_hash": "sha256:" + "b" * 64,
        "character_reference_ids": [],
        "scenes": [],
        "props": [],
        "safe_area": {
            "canvas_width": 90,
            "canvas_height": 160,
            "x": 0,
            "y": 0,
            "width": 90,
            "height": 160,
        },
        "effective_scope": "PROJECT",
        "change_reason": "Human-selected candidate",
    }


@pytest.mark.parametrize("fault", ["reason", "characters", "scenes", "props", "order", "assets"])
def test_shared_visual_identity_rejects_ambiguous_or_unordered_content(fault):
    value = content()
    prop = {
        "prop_id": "prop_" + "c" * 32,
        "ordinal": 1,
        "name": "Lamp",
        "description": "Continuity reference",
        "assets": [],
    }
    if fault == "reason":
        value["change_reason"] = " "
    elif fault == "characters":
        value["character_reference_ids"] = ["crf_" + "c" * 32] * 2
    elif fault == "scenes":
        value["scenes"] = [{"scene_id": "loc_" + "c" * 32, "assets": []}] * 2
    elif fault == "props":
        value["props"] = [prop, deepcopy(prop)]
    elif fault == "order":
        prop["ordinal"] = 2
        value["props"] = [prop]
    else:
        prop["assets"] = [
            {
                "asset_id": "asset_" + "d" * 32,
                "asset_version_id": "asv_" + "e" * 32,
                "sha256": "f" * 64,
            }
        ] * 2
        value["props"] = [prop]
    with pytest.raises(ValidationError):
        visual.VisualBibleContentV1.model_validate(value)


def test_safe_area_requires_portrait_ratio_and_containment():
    value = content()["safe_area"]
    assert visual.VisualSafeAreaV1.model_validate(value).width == 90
    for changes in ({"canvas_height": 159}, {"x": 1}, {"y": 1}):
        with pytest.raises(ValidationError):
            visual.VisualSafeAreaV1.model_validate({**value, **changes})


def test_prop_names_and_asset_arrays_remain_explicit():
    value = {
        "prop_id": "prop_" + "c" * 32,
        "ordinal": 1,
        "name": "Lamp",
        "description": "Continuity reference",
        "assets": [],
    }
    assert visual.VisualPropV1.model_validate(value).assets == ()
    value["assets"] = ()
    assert visual.VisualPropV1.model_validate(value).name == "Lamp"
    value["name"] = " "
    with pytest.raises(ValidationError, match="readable"):
        visual.VisualPropV1.model_validate(value)


@pytest.mark.parametrize("fault", ["parent", "revision", "summary"])
def test_visual_save_requires_paired_parent_revision_and_readable_summary(fault):
    value = {
        "content": content(),
        "parent_version_id": None,
        "expected_revision": None,
        "change_summary": "Human revision",
    }
    if fault == "parent":
        value["parent_version_id"] = "ver_" + "f" * 32
    elif fault == "revision":
        value["expected_revision"] = 1
    else:
        value["change_summary"] = " "
    with pytest.raises(ValidationError):
        visual.CreateVisualBibleVersionRequest.model_validate(value)


@pytest.mark.parametrize("confirm", [False, True])
@pytest.mark.parametrize("reason", ["Reason", " Reason", "Reason ", " "])
def test_human_decision_reason_is_explicit_and_trimmed(confirm, reason):
    value = {"decision": "rejected", "rationale": reason}
    if confirm:
        model = visual.VisualBibleDecisionConfirmInput
        value.update(challenge_id="chg_" + "a" * 32, confirmation_token="controlled-" * 3)
    else:
        model = visual.VisualBibleDecisionInput
        value["readiness_report_id"] = None
    if reason == "Reason":
        assert model.model_validate(value).rationale == reason
    else:
        with pytest.raises(ValidationError):
            model.model_validate(value)


@pytest.mark.parametrize(
    "value",
    [
        {"action": "submit", "roles": ["producer"]},
        {"action": "submit", "decision": "approved"},
        {"action": "signoff", "roles": []},
        {"action": "signoff", "roles": ["producer", "producer"]},
        {"action": "signoff", "roles": ["producer"], "rationale": "not a decision"},
        {"action": "decision", "decision": "approved"},
        {"action": "decision", "decision": "approved", "rationale": " "},
    ],
)
def test_review_actions_cannot_mix_or_imply_human_intent(value):
    with pytest.raises(ValidationError):
        visual.VisualReviewActionInput.model_validate(value)


def history_page():
    stamp = datetime(2026, 1, 1, tzinfo=UTC)
    artifact = "art_" + "a" * 32
    entry = {
        "id": "ver_" + "1" * 32,
        "artifact_id": artifact,
        "version_number": 2,
        "content_hash": "sha256:" + "b" * 64,
        "parent_version_id": None,
        "creative_library_version_id": "ver_" + "b" * 32,
        "creative_library_content_hash": "sha256:" + "c" * 64,
        "author_actor_id": "local-user",
        "change_summary": "Candidate",
        "change_reason": "Human reason",
        "created_at": stamp,
    }
    return {
        "project_id": "prj_" + "a" * 32,
        "head": {
            "artifact_id": artifact,
            "latest_version_id": entry["id"],
            "revision": 2,
            "review_submission_id": None,
            "review_evidence_revision": 0,
            "updated_at": stamp,
        },
        "cursor": None,
        "limit": 2,
        "items": [entry],
        "next_cursor": None,
    }


@pytest.mark.parametrize(
    "fault", ["limit", "scope", "cursor", "duplicate", "order", "empty", "head", "next"]
)
def test_history_page_requires_exact_scope_order_and_continuation(fault):
    value = history_page()
    assert visual.VisualBibleHistoryPage.model_validate(value).next_cursor is None
    entry = value["items"][0]
    if fault == "limit":
        value["limit"] = 1
        value["items"].append({**entry, "id": "ver_" + "2" * 32, "version_number": 1})
    elif fault == "scope":
        entry["artifact_id"] = "art_" + "b" * 32
    elif fault == "cursor":
        value["cursor"] = entry["id"]
    elif fault == "duplicate":
        value["items"].append(deepcopy(entry))
    elif fault == "order":
        value["items"].append({**entry, "id": "ver_" + "2" * 32})
    elif fault == "empty":
        value["items"] = []
    elif fault == "head":
        value["head"]["latest_version_id"] = "ver_" + "3" * 32
    else:
        value["next_cursor"] = entry["id"]
    with pytest.raises(ValidationError):
        visual.VisualBibleHistoryPage.model_validate(value)
