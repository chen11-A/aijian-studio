from copy import deepcopy
from typing import Any

import pytest
from aijian_api.story_bible import StoryBibleContentV1
from pydantic import ValidationError


def identifier(prefix: str, digit: str) -> str:
    return f"{prefix}_{digit * 32}"


def fact_base(fact_id: str, **overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "fact_id": fact_id,
        "importance": "core",
        "origin": "source_explicit_assertion",
        "canon_status": "confirmed",
        "extraction_confidence_bps": None,
        "canon_certainty": "certain",
        "viewpoint_entity_id": None,
        "source_reliability": "reliable",
        "decision_reason": None,
        "impact_scope": [],
        "supersedes_fact_ids": [],
        "derived_from_fact_ids": [],
    }
    value.update(overrides)
    return value


def valid_story_bible_payload() -> dict[str, Any]:
    character_id = identifier("ent", "1")
    location_id = identifier("ent", "2")
    prop_id = identifier("ent", "3")
    first_event_id = identifier("fact", "1")
    second_event_id = identifier("fact", "2")
    rejected_fact_id = identifier("fact", "3")
    return {
        "title": "雾城来信",
        "logline": "林岚循着无名信追查旧车站被掩埋的秘密。",
        "source_scope": {
            "source_manifest_version_id": identifier("ver", "1"),
            "scope_type": "full_work",
            "documents": [
                {
                    "source_document_id": identifier("src", "1"),
                    "raw_sha256": "a" * 64,
                    "source_block_ids": [identifier("srcb", "1")],
                    "chapter_indices": [1],
                }
            ],
            "exclusions": [],
        },
        "entities": [
            {
                "entity_id": character_id,
                "kind": "character",
                "name": "林岚",
                "aliases": ["阿岚"],
            },
            {
                "entity_id": location_id,
                "kind": "location",
                "name": "雾城旧站",
                "aliases": [],
            },
            {
                "entity_id": prop_id,
                "kind": "prop",
                "name": "无名信",
                "aliases": [],
            },
        ],
        "facts": [
            {
                **fact_base(first_event_id),
                "kind": "event_fact",
                "participants": [character_id],
                "location_id": location_id,
                "source_narrative_order": 1,
                "story_time_order": 1,
                "temporal_relations": [
                    {"relation": "before", "other_event_fact_id": second_event_id}
                ],
                "caused_by_fact_ids": [],
                "state_changes": [
                    {
                        "entity_id": prop_id,
                        "property_key": "holder",
                        "before": None,
                        "after": {"kind": "entity_ref", "entity_id": character_id},
                    }
                ],
            },
            {
                **fact_base(second_event_id),
                "kind": "event_fact",
                "participants": [character_id],
                "location_id": location_id,
                "source_narrative_order": 2,
                "story_time_order": 2,
                "temporal_relations": [],
                "caused_by_fact_ids": [first_event_id],
                "state_changes": [],
            },
            {
                **fact_base(
                    rejected_fact_id,
                    importance="detail",
                    canon_status="rejected",
                    canon_certainty="ambiguous",
                ),
                "kind": "character_fact",
                "character_id": character_id,
                "attribute": "误传职业",
                "value": "记者",
                "validity": None,
            },
        ],
        "questions": [],
        "conflicts": [],
    }


def test_story_bible_v1_validates_typed_graph_and_projects_effective_canon() -> None:
    content = StoryBibleContentV1.model_validate(valid_story_bible_payload())

    assert len(content.entities) == 3
    assert [fact.fact_id for fact in content.effective_canon] == [
        identifier("fact", "1"),
        identifier("fact", "2"),
    ]
    assert "display_summary" not in content.model_dump(mode="json")["entities"][0]


def test_story_bible_rejects_canon_bearing_fields_hidden_on_entities() -> None:
    payload = valid_story_bible_payload()
    payload["entities"][0]["goals"] = ["找到真相"]

    with pytest.raises(ValidationError, match="Extra inputs"):
        StoryBibleContentV1.model_validate(payload)

    payload = valid_story_bible_payload()
    payload["entities"][0]["display_summary"] = "凶手是站长"
    payload["facts"][0]["editor_note"] = "把未证实身份当作真相"
    with pytest.raises(ValidationError, match="Extra inputs"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_type_incompatible_and_missing_references() -> None:
    payload = valid_story_bible_payload()
    character_fact = payload["facts"][2]
    character_fact["canon_status"] = "confirmed"
    character_fact["character_id"] = identifier("ent", "2")

    with pytest.raises(ValidationError, match="type-incompatible"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_event_time_or_cause_cycles() -> None:
    payload = valid_story_bible_payload()
    payload["facts"][1]["temporal_relations"] = [
        {"relation": "before", "other_event_fact_id": identifier("fact", "1")}
    ]

    with pytest.raises(ValidationError, match="contradicts|cycle"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_conflicting_state_at_same_story_time() -> None:
    payload = valid_story_bible_payload()
    second_character_id = identifier("ent", "4")
    payload["entities"].append(
        {
            "entity_id": second_character_id,
            "kind": "character",
            "name": "Second holder",
            "aliases": [],
        }
    )
    payload["facts"][0]["temporal_relations"] = []
    payload["facts"][1]["story_time_order"] = 1
    payload["facts"][1]["caused_by_fact_ids"] = []
    payload["facts"][1]["state_changes"] = [
        {
            "entity_id": identifier("ent", "3"),
            "property_key": "holder",
            "before": None,
            "after": {"kind": "entity_ref", "entity_id": second_character_id},
        }
    ]

    with pytest.raises(ValidationError, match="conflicting state"):
        StoryBibleContentV1.model_validate(payload)


def test_effective_canon_excludes_unreliable_claims_and_requires_closed_event_refs() -> None:
    payload = valid_story_bible_payload()
    payload["facts"][2]["canon_status"] = "confirmed"
    payload["facts"][2]["source_reliability"] = "unreliable"
    content = StoryBibleContentV1.model_validate(payload)

    assert len(content.confirmed_claims) == 3
    assert len(content.effective_canon) == 2

    payload = valid_story_bible_payload()
    payload["facts"][1]["canon_status"] = "rejected"
    with pytest.raises(ValidationError, match="non-canon event"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_temporal_order_validity_and_state_replay_mismatches() -> None:
    simultaneous = valid_story_bible_payload()
    simultaneous["facts"][0]["temporal_relations"] = [
        {"relation": "simultaneous", "other_event_fact_id": identifier("fact", "2")}
    ]
    with pytest.raises(ValidationError, match="Simultaneous"):
        StoryBibleContentV1.model_validate(simultaneous)

    reversed_validity = valid_story_bible_payload()
    reversed_validity["facts"][2]["validity"] = {
        "starts_after_event_fact_id": identifier("fact", "2"),
        "ends_after_event_fact_id": identifier("fact", "1"),
    }
    with pytest.raises(ValidationError, match="starts after it ends"):
        StoryBibleContentV1.model_validate(reversed_validity)

    discontinuous_state = valid_story_bible_payload()
    second_character_id = identifier("ent", "4")
    discontinuous_state["entities"].append(
        {
            "entity_id": second_character_id,
            "kind": "character",
            "name": "Second holder",
            "aliases": [],
        }
    )
    discontinuous_state["facts"][1]["state_changes"] = [
        {
            "entity_id": identifier("ent", "3"),
            "property_key": "holder",
            "before": None,
            "after": {"kind": "entity_ref", "entity_id": second_character_id},
        }
    ]
    with pytest.raises(ValidationError, match="continue from prior state"):
        StoryBibleContentV1.model_validate(discontinuous_state)


def test_story_bible_requires_confirmed_user_decision_for_conflict_resolution() -> None:
    payload = valid_story_bible_payload()
    payload["conflicts"] = [
        {
            "conflict_id": identifier("cfl", "1"),
            "conflict_type": "identity",
            "fact_ids": [identifier("fact", "1"), identifier("fact", "2")],
            "severity": "major",
            "responsible_role": "writer",
            "status": "resolved_by_user_decision",
            "resolution_reason": "采用第二种解释",
            "resolution_fact_id": identifier("fact", "3"),
        }
    ]

    with pytest.raises(ValidationError, match="confirmed user decision"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_user_resolution_must_cover_conflict_and_retire_losing_candidates() -> None:
    payload = valid_story_bible_payload()
    resolution = payload["facts"][2]
    resolution.update(
        origin="user_decision",
        canon_status="confirmed",
        source_reliability="not_applicable",
        decision_reason="采用制作决定",
        impact_scope=["continuity"],
        supersedes_fact_ids=[identifier("fact", "1"), identifier("fact", "2")],
    )
    payload["conflicts"] = [
        {
            "conflict_id": identifier("cfl", "1"),
            "conflict_type": "event-outcome",
            "fact_ids": [identifier("fact", "1"), identifier("fact", "2")],
            "severity": "major",
            "responsible_role": "writer",
            "status": "resolved_by_user_decision",
            "resolution_reason": "采用制作决定",
            "resolution_fact_id": identifier("fact", "3"),
        }
    ]

    with pytest.raises(ValidationError, match="multiple confirmed"):
        StoryBibleContentV1.model_validate(payload)

    payload["facts"][1]["canon_status"] = "rejected"
    payload["facts"][0]["temporal_relations"] = []
    payload["facts"][1]["caused_by_fact_ids"] = []
    payload["facts"][2]["supersedes_fact_ids"] = [identifier("fact", "1")]
    with pytest.raises(ValidationError, match="lineage must cover"):
        StoryBibleContentV1.model_validate(payload)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda payload: payload["source_scope"].update(exclusions=["第二章"]),
            "full-work",
        ),
        (
            lambda payload: payload["facts"][0].update(
                origin="source_interpretation",
                viewpoint_entity_id=None,
            ),
            "viewpoint",
        ),
        (
            lambda payload: payload["entities"].append(deepcopy(payload["entities"][0])),
            "IDs must be unique",
        ),
    ],
)
def test_story_bible_rejects_invalid_scope_provenance_and_duplicate_ids(
    mutate,
    message: str,
) -> None:
    payload = valid_story_bible_payload()
    mutate(payload)

    with pytest.raises(ValidationError, match=message):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_future_event_as_cause() -> None:
    payload = valid_story_bible_payload()
    payload["facts"][0]["caused_by_fact_ids"] = [identifier("fact", "2")]

    with pytest.raises(ValidationError, match="cause must occur before"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_enforces_state_subject_and_value_contracts() -> None:
    wrong_target = valid_story_bible_payload()
    wrong_target["facts"][0]["state_changes"][0]["after"] = {
        "kind": "entity_ref",
        "entity_id": identifier("ent", "2"),
    }
    with pytest.raises(ValidationError, match="state|State"):
        StoryBibleContentV1.model_validate(wrong_target)

    wrong_value_kind = valid_story_bible_payload()
    wrong_value_kind["facts"][0]["state_changes"][0]["after"] = {
        "kind": "text",
        "value": "nobody",
    }
    with pytest.raises(ValidationError, match="value kind"):
        StoryBibleContentV1.model_validate(wrong_value_kind)


def test_story_bible_rejects_prop_fact_and_event_state_conflict() -> None:
    payload = valid_story_bible_payload()
    second_character_id = identifier("ent", "4")
    payload["entities"].append(
        {
            "entity_id": second_character_id,
            "kind": "character",
            "name": "Second holder",
            "aliases": [],
        }
    )
    payload["facts"].append(
        {
            **fact_base(identifier("fact", "4")),
            "kind": "prop_fact",
            "prop_id": identifier("ent", "3"),
            "property_key": "holder",
            "value": {"kind": "entity_ref", "entity_id": second_character_id},
            "validity": None,
        }
    )

    with pytest.raises(ValidationError, match="contradicts an effective state fact"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_wrong_before_state_under_unbounded_baseline() -> None:
    payload = valid_story_bible_payload()
    second_character_id = identifier("ent", "4")
    payload["entities"].append(
        {
            "entity_id": second_character_id,
            "kind": "character",
            "name": "Second holder",
            "aliases": [],
        }
    )
    payload["facts"][0]["state_changes"][0].update(
        before={"kind": "entity_ref", "entity_id": second_character_id},
        after={"kind": "entity_ref", "entity_id": identifier("ent", "1")},
    )
    payload["facts"].append(
        {
            **fact_base(identifier("fact", "4")),
            "kind": "prop_fact",
            "prop_id": identifier("ent", "3"),
            "property_key": "holder",
            "value": {"kind": "entity_ref", "entity_id": identifier("ent", "1")},
            "validity": None,
        }
    )

    with pytest.raises(ValidationError, match="contradicts an effective state fact"):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_state_change_inside_bounded_baseline() -> None:
    payload = valid_story_bible_payload()
    second_character_id = identifier("ent", "4")
    payload["entities"].append(
        {
            "entity_id": second_character_id,
            "kind": "character",
            "name": "Second holder",
            "aliases": [],
        }
    )
    third_event_id = identifier("fact", "4")
    payload["facts"].append(
        {
            **fact_base(third_event_id),
            "kind": "event_fact",
            "participants": [identifier("ent", "1")],
            "location_id": identifier("ent", "2"),
            "source_narrative_order": 3,
            "story_time_order": 3,
            "temporal_relations": [],
            "caused_by_fact_ids": [identifier("fact", "2")],
            "state_changes": [],
        }
    )
    payload["facts"][0]["state_changes"] = []
    payload["facts"][1]["state_changes"] = [
        {
            "entity_id": identifier("ent", "3"),
            "property_key": "holder",
            "before": {"kind": "entity_ref", "entity_id": identifier("ent", "1")},
            "after": {"kind": "entity_ref", "entity_id": second_character_id},
        }
    ]
    payload["facts"].append(
        {
            **fact_base(identifier("fact", "5")),
            "kind": "prop_fact",
            "prop_id": identifier("ent", "3"),
            "property_key": "holder",
            "value": {"kind": "entity_ref", "entity_id": identifier("ent", "1")},
            "validity": {
                "starts_after_event_fact_id": identifier("fact", "1"),
                "ends_after_event_fact_id": third_event_id,
            },
        }
    )

    with pytest.raises(ValidationError, match="contradicts an effective state fact"):
        StoryBibleContentV1.model_validate(payload)


def test_source_ambiguity_claims_are_auditable_but_not_effective_canon() -> None:
    payload = valid_story_bible_payload()
    payload["conflicts"] = [
        {
            "conflict_id": identifier("cfl", "1"),
            "conflict_type": "source-chronology",
            "fact_ids": [identifier("fact", "1"), identifier("fact", "2")],
            "severity": "major",
            "responsible_role": "continuity_reviewer",
            "status": "resolved_as_source_ambiguity",
            "resolution_reason": "The source intentionally preserves both accounts.",
            "resolution_fact_id": None,
        }
    ]

    content = StoryBibleContentV1.model_validate(payload)

    assert {fact.fact_id for fact in content.confirmed_claims} == {
        identifier("fact", "1"),
        identifier("fact", "2"),
    }
    assert content.effective_canon == ()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("source_block_ids", [identifier("srcb", "1")] * 2, "block IDs must be unique"),
        ("source_block_ids", ["srcb_not-hex"], "invalid block ID"),
        ("chapter_indices", [2, 1], "sorted unique positive"),
    ],
)
def test_story_bible_rejects_malformed_source_scope_members(
    field: str, value: object, message: str
) -> None:
    payload = valid_story_bible_payload()
    payload["source_scope"]["documents"][0][field] = value

    with pytest.raises(ValidationError, match=message):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_duplicate_scope_documents_and_entity_names() -> None:
    duplicate_scope = valid_story_bible_payload()
    duplicate_scope["source_scope"]["documents"].append(
        deepcopy(duplicate_scope["source_scope"]["documents"][0])
    )
    with pytest.raises(ValidationError, match="document IDs must be unique"):
        StoryBibleContentV1.model_validate(duplicate_scope)

    duplicate_name = valid_story_bible_payload()
    duplicate_name["entities"].append(
        {
            "entity_id": identifier("ent", "4"),
            "kind": "character",
            "name": duplicate_name["entities"][0]["name"],
            "aliases": [],
        }
    )
    with pytest.raises(ValidationError, match="obvious duplicate"):
        StoryBibleContentV1.model_validate(duplicate_name)


@pytest.mark.parametrize(
    ("name", "aliases", "message"),
    [
        (" ", [], "name cannot be blank"),
        ("Valid", [" "], "aliases cannot be blank"),
        ("Valid", ["Same", " same "], "aliases must be unique"),
        ("Valid", [" valid "], "alias cannot duplicate"),
    ],
)
def test_story_bible_rejects_ambiguous_entity_display_keys(
    name: str, aliases: list[str], message: str
) -> None:
    payload = valid_story_bible_payload()
    payload["entities"][0]["name"] = name
    payload["entities"][0]["aliases"] = aliases

    with pytest.raises(ValidationError, match=message):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_empty_titles_and_noop_state_changes() -> None:
    empty_title = valid_story_bible_payload()
    empty_title["title"] = " "
    with pytest.raises(ValidationError, match="title and logline"):
        StoryBibleContentV1.model_validate(empty_title)

    noop = valid_story_bible_payload()
    state = noop["facts"][0]["state_changes"][0]["after"]
    noop["facts"][0]["state_changes"][0]["before"] = deepcopy(state)
    with pytest.raises(ValidationError, match="before and after"):
        StoryBibleContentV1.model_validate(noop)


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        (
            {"origin": "user_decision", "source_reliability": "not_applicable"},
            "reason and impact",
        ),
        (
            {
                "origin": "user_decision",
                "source_reliability": "not_applicable",
                "decision_reason": "Director decision",
                "impact_scope": ["continuity"],
                "extraction_confidence_bps": 5000,
            },
            "cannot carry extraction",
        ),
        ({"derived_from_fact_ids": [identifier("fact", "1")]}, "cannot derive"),
    ],
)
def test_story_bible_rejects_invalid_fact_provenance(
    updates: dict[str, object], message: str
) -> None:
    payload = valid_story_bible_payload()
    payload["facts"][0].update(updates)

    with pytest.raises(ValidationError, match=message):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_validates_question_resolution_and_scopes() -> None:
    unresolved_with_answer = valid_story_bible_payload()
    unresolved_with_answer["questions"] = [
        {
            "question_id": identifier("qst", "1"),
            "scope_type": "artifact",
            "scope_id": None,
            "question": "Which ending?",
            "severity": "major",
            "responsible_role": "writer",
            "blocking": True,
            "status": "open",
            "resolution": "Use ending A",
        }
    ]
    with pytest.raises(ValidationError, match="resolution must match"):
        StoryBibleContentV1.model_validate(unresolved_with_answer)

    missing_scope = valid_story_bible_payload()
    missing_scope["questions"] = [
        {
            "question_id": identifier("qst", "1"),
            "scope_type": "entity",
            "scope_id": identifier("ent", "9"),
            "question": "Who is this?",
            "severity": "major",
            "responsible_role": "writer",
            "blocking": True,
            "status": "open",
            "resolution": None,
        }
    ]
    with pytest.raises(ValidationError, match="missing entity scope"):
        StoryBibleContentV1.model_validate(missing_scope)

    duplicate = deepcopy(missing_scope)
    duplicate["questions"][0]["scope_type"] = "artifact"
    duplicate["questions"][0]["scope_id"] = None
    duplicate["questions"].append(deepcopy(duplicate["questions"][0]))
    with pytest.raises(ValidationError, match="question IDs must be unique"):
        StoryBibleContentV1.model_validate(duplicate)


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"fact_ids": [identifier("fact", "1")] * 2}, "fact IDs must be unique"),
        ({"status": "unresolved", "resolution_reason": "already fixed"}, "cannot contain"),
        (
            {"status": "resolved_as_source_ambiguity", "resolution_reason": None},
            "requires a reason",
        ),
        (
            {
                "status": "resolved_as_source_ambiguity",
                "resolution_reason": "Ambiguous source",
                "resolution_fact_id": identifier("fact", "3"),
            },
            "cannot select",
        ),
        (
            {"status": "resolved_by_user_decision", "resolution_reason": "Director choice"},
            "requires a resolution fact",
        ),
    ],
)
def test_story_bible_rejects_malformed_conflict_resolution(
    updates: dict[str, object], message: str
) -> None:
    payload = valid_story_bible_payload()
    conflict = {
        "conflict_id": identifier("cfl", "1"),
        "conflict_type": "identity",
        "fact_ids": [identifier("fact", "1"), identifier("fact", "2")],
        "severity": "major",
        "responsible_role": "writer",
        "status": "unresolved",
        "resolution_reason": None,
        "resolution_fact_id": None,
    }
    conflict.update(updates)
    payload["conflicts"] = [conflict]

    with pytest.raises(ValidationError, match=message):
        StoryBibleContentV1.model_validate(payload)


def test_story_bible_rejects_missing_lineage_relationship_and_event_references() -> None:
    missing_lineage = valid_story_bible_payload()
    missing_lineage["facts"][0]["derived_from_fact_ids"] = [identifier("fact", "9")]
    with pytest.raises(ValidationError, match="lineage contains a missing"):
        StoryBibleContentV1.model_validate(missing_lineage)

    relationship = valid_story_bible_payload()
    relationship["facts"].append(
        {
            **fact_base(identifier("fact", "4")),
            "kind": "relationship_fact",
            "subject_entity_id": identifier("ent", "1"),
            "predicate": "trusts",
            "object_entity_id": identifier("ent", "1"),
            "validity": None,
        }
    )
    with pytest.raises(ValidationError, match="endpoints must differ"):
        StoryBibleContentV1.model_validate(relationship)

    duplicate_participant = valid_story_bible_payload()
    duplicate_participant["facts"][0]["participants"] = [identifier("ent", "1")] * 2
    with pytest.raises(ValidationError, match="participants must be unique"):
        StoryBibleContentV1.model_validate(duplicate_participant)


def test_story_bible_rejects_missing_event_graph_and_validity_references() -> None:
    missing_cause = valid_story_bible_payload()
    missing_cause["facts"][0]["caused_by_fact_ids"] = [identifier("fact", "9")]
    with pytest.raises(ValidationError, match="cause must reference"):
        StoryBibleContentV1.model_validate(missing_cause)

    missing_relation = valid_story_bible_payload()
    missing_relation["facts"][0]["temporal_relations"] = [
        {"relation": "before", "other_event_fact_id": identifier("fact", "9")}
    ]
    with pytest.raises(ValidationError, match="Temporal relation"):
        StoryBibleContentV1.model_validate(missing_relation)

    non_event_validity = valid_story_bible_payload()
    non_event_validity["facts"][2]["validity"] = {
        "starts_after_event_fact_id": identifier("fact", "3"),
        "ends_after_event_fact_id": None,
    }
    with pytest.raises(ValidationError, match="validity must reference"):
        StoryBibleContentV1.model_validate(non_event_validity)


def test_story_bible_rejects_overlapping_or_zero_length_state_facts() -> None:
    overlapping = valid_story_bible_payload()
    second_character_id = identifier("ent", "4")
    overlapping["entities"].append(
        {
            "entity_id": second_character_id,
            "kind": "character",
            "name": "Second holder",
            "aliases": [],
        }
    )
    for digit, holder_id in (("4", identifier("ent", "1")), ("5", second_character_id)):
        overlapping["facts"].append(
            {
                **fact_base(identifier("fact", digit)),
                "kind": "prop_fact",
                "prop_id": identifier("ent", "3"),
                "property_key": "holder",
                "value": {"kind": "entity_ref", "entity_id": holder_id},
                "validity": None,
            }
        )
    with pytest.raises(ValidationError, match="overlapping contradictory"):
        StoryBibleContentV1.model_validate(overlapping)

    zero_length = valid_story_bible_payload()
    zero_length["facts"].append(
        {
            **fact_base(identifier("fact", "4")),
            "kind": "prop_fact",
            "prop_id": identifier("ent", "3"),
            "property_key": "holder",
            "value": {"kind": "entity_ref", "entity_id": identifier("ent", "1")},
            "validity": {
                "starts_after_event_fact_id": identifier("fact", "1"),
                "ends_after_event_fact_id": identifier("fact", "1"),
            },
        }
    )
    with pytest.raises(ValidationError, match="positive story-time interval"):
        StoryBibleContentV1.model_validate(zero_length)
