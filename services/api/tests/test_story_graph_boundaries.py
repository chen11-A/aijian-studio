"""Story graph invariants for canon, conflict lineage, and interval state continuity."""

from copy import deepcopy

import pytest
from aijian_api.story_bible import StoryBibleContentV1
from pydantic import ValidationError
from test_story_bible import fact_base, identifier, valid_story_bible_payload


def graph():
    data = valid_story_bible_payload()
    event = data["facts"][0]
    data["facts"] = []
    for index in range(1, 4):
        current = deepcopy(event)
        current.update(
            fact_id=identifier("fact", str(index)),
            story_time_order=index,
            source_narrative_order=index,
            state_changes=[],
            temporal_relations=[],
            caused_by_fact_ids=[],
        )
        data["facts"].append(current)
    return data


def baseline(*, start=None, end=None, value="sealed", digit="4"):
    return {
        **fact_base(identifier("fact", digit)),
        "kind": "prop_fact",
        "prop_id": identifier("ent", "3"),
        "property_key": "condition",
        "value": {"kind": "text", "value": value},
        "validity": {
            "starts_after_event_fact_id": identifier("fact", str(start)) if start else None,
            "ends_after_event_fact_id": identifier("fact", str(end)) if end else None,
        },
    }


def change(before, after, property_key="condition"):
    return {
        "entity_id": identifier("ent", "3"),
        "property_key": property_key,
        "before": {"kind": "text", "value": before},
        "after": {"kind": "text", "value": after},
    }


@pytest.mark.parametrize(
    "event_index,start,end,before,after",
    [
        (0, 1, 2, "open", "sealed"),
        (1, 1, 2, "sealed", "open"),
        (0, 2, 3, "open", "broken"),
        (2, 1, 2, "open", "broken"),
    ],
)
def test_state_transitions_match_interval_edges_or_fall_outside_interval(
    event_index, start, end, before, after
):
    data = graph()
    data["facts"].append(baseline(start=start, end=end))
    data["facts"][event_index]["state_changes"] = [change(before, after)]
    result = StoryBibleContentV1.model_validate(data)
    assert len(result.effective_canon) == 4


@pytest.mark.parametrize(
    "event_index,before,after",
    [
        (0, "open", "broken"),
        (2, "open", "broken"),
        (1, "sealed", "broken"),
    ],
)
def test_contradictory_interval_start_end_or_interior_is_rejected(event_index, before, after):
    data = graph()
    data["facts"].append(baseline(start=1, end=3))
    data["facts"][event_index]["state_changes"] = [change(before, after)]
    with pytest.raises(ValidationError, match="contradicts an effective state fact"):
        StoryBibleContentV1.model_validate(data)


def test_unrelated_property_and_disjoint_baselines_do_not_conflict():
    data = graph()
    data["facts"] += [baseline(start=1, end=2), baseline(start=2, end=3, value="open", digit="5")]
    data["facts"][0]["state_changes"] = [change("plain", "marked", "appearance")]
    result = StoryBibleContentV1.model_validate(data)
    assert len(result.effective_canon) == 5


def test_event_validity_cannot_run_backwards():
    data = graph()
    data["facts"].append(baseline(start=3, end=1))
    with pytest.raises(ValidationError, match="starts after it ends"):
        StoryBibleContentV1.model_validate(data)


@pytest.mark.parametrize("kind", ["validity", "cause", "time"])
def test_effective_canon_cannot_operationally_depend_on_proposed_events(kind):
    data = graph()
    data["facts"][0]["canon_status"] = "proposed"
    if kind == "validity":
        data["facts"].append(baseline(start=1))
    elif kind == "cause":
        data["facts"][1]["caused_by_fact_ids"] = [identifier("fact", "1")]
    else:
        data["facts"][1]["temporal_relations"] = [
            {"relation": "after", "other_event_fact_id": identifier("fact", "1")},
        ]
    with pytest.raises(ValidationError, match="non-canon event"):
        StoryBibleContentV1.model_validate(data)


def resolved_conflict():
    data = graph()
    ids = [identifier("fact", "1"), identifier("fact", "2")]
    data["facts"][0]["canon_status"] = "rejected"
    data["facts"][1]["canon_status"] = "rejected"
    decision = {
        **fact_base(
            identifier("fact", "4"),
            origin="user_decision",
            decision_reason="Synthetic continuity decision",
            impact_scope=["story"],
            supersedes_fact_ids=ids,
        ),
        "kind": "character_fact",
        "character_id": identifier("ent", "1"),
        "attribute": "role",
        "value": "observer",
    }
    data["facts"].append(decision)
    data["conflicts"] = [
        {
            "conflict_id": identifier("cfl", "1"),
            "conflict_type": "synthetic dispute",
            "fact_ids": ids,
            "severity": "major",
            "responsible_role": "author",
            "status": "resolved_by_user_decision",
            "resolution_reason": "Author chose continuity",
            "resolution_fact_id": decision["fact_id"],
        }
    ]
    return data


def test_user_resolution_covers_conflicting_lineage_and_retains_only_confirmed_canon():
    result = StoryBibleContentV1.model_validate(resolved_conflict())
    assert {fact.fact_id for fact in result.effective_canon} == {
        identifier("fact", "3"),
        identifier("fact", "4"),
    }


@pytest.mark.parametrize(
    "mode,message",
    [
        ("missing", "confirmed user decision"),
        ("origin", "confirmed user decision"),
        ("proposed", "confirmed user decision"),
        ("lineage", "cover every conflicting fact"),
        ("candidates", "multiple confirmed candidates"),
        ("duplicate", "conflict IDs must be unique"),
    ],
)
def test_conflict_resolution_must_be_unique_authoritative_and_cover_lineage(mode, message):
    data = resolved_conflict()
    decision = data["facts"][-1]
    if mode == "missing":
        data["conflicts"][0]["resolution_fact_id"] = identifier("fact", "9")
    elif mode == "origin":
        decision["origin"] = "ai_inference"
    elif mode == "proposed":
        decision["canon_status"] = "proposed"
    elif mode == "lineage":
        decision["supersedes_fact_ids"] = [identifier("fact", "1")]
    elif mode == "candidates":
        data["facts"][0]["canon_status"] = "confirmed"
        data["facts"][1]["canon_status"] = "confirmed"
    else:
        data["conflicts"].append(deepcopy(data["conflicts"][0]))
    with pytest.raises(ValidationError, match=message):
        StoryBibleContentV1.model_validate(data)


def test_relationship_cannot_point_from_entity_to_itself():
    data = graph()
    data["facts"].append(
        {
            **fact_base(identifier("fact", "4")),
            "kind": "relationship_fact",
            "subject_entity_id": identifier("ent", "1"),
            "object_entity_id": identifier("ent", "1"),
            "predicate": "knows",
        }
    )
    with pytest.raises(ValidationError, match="endpoints must differ"):
        StoryBibleContentV1.model_validate(data)


@pytest.mark.parametrize(
    "relation,order,accepts",
    [
        ("after", 2, True),
        ("after", 1, False),
        ("simultaneous", 1, True),
        ("simultaneous", 2, False),
    ],
)
def test_after_and_simultaneous_relations_agree_with_story_time(relation, order, accepts):
    data = graph()
    data["facts"][1]["story_time_order"] = order
    data["facts"][1]["temporal_relations"] = [
        {
            "relation": relation,
            "other_event_fact_id": identifier("fact", "1"),
        }
    ]
    if accepts:
        assert len(StoryBibleContentV1.model_validate(data).effective_canon) == 3
    else:
        with pytest.raises(ValidationError, match="contradicts|share story time"):
            StoryBibleContentV1.model_validate(data)


def test_state_baselines_of_different_properties_can_coexist():
    data = graph()
    first = baseline(start=1, end=2)
    second = baseline(start=1, end=2, digit="5", value="marked")
    second["property_key"] = "appearance"
    data["facts"] += [first, second]
    assert len(StoryBibleContentV1.model_validate(data).effective_canon) == 5
