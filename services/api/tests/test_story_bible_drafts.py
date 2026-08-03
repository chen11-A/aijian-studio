from collections import defaultdict
from copy import deepcopy
from typing import Any

import pytest
from aijian_api.story_bible import StoryBibleContentV1
from aijian_api.story_bible_drafts import (
    StoryBibleContentDraftV1,
    StorySourceSpanDraftV1,
    resolve_story_bible_draft,
)
from test_story_bible import valid_story_bible_payload


def deterministic_id_factory():
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def draft_payload(*, permanent: bool = False) -> tuple[dict[str, Any], dict[str, str]]:
    payload = deepcopy(valid_story_bible_payload())
    permanent_ids = {
        value
        for collection in (payload["entities"], payload["facts"])
        for item in collection
        for value in item.values()
        if isinstance(value, str) and value.startswith(("ent_", "fact_"))
    }
    permanent_ids.update(
        value
        for item in payload["entities"] + payload["facts"]
        for value in _nested_strings(item)
        if value.startswith(("ent_", "fact_"))
    )
    keys = {value: f"key_{index}" for index, value in enumerate(sorted(permanent_ids), start=1)}

    def replace_refs(value: object) -> object:
        if isinstance(value, list):
            return [replace_refs(item) for item in value]
        if isinstance(value, dict):
            return {key: replace_refs(item) for key, item in value.items()}
        if isinstance(value, str) and value in keys:
            if permanent:
                return {"ref_type": "permanent_id", "permanent_id": value}
            return {"ref_type": "client_key", "client_key": keys[value]}
        return value

    return replace_refs(payload), keys  # type: ignore[return-value]


def _nested_strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [text for item in value for text in _nested_strings(item)]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _nested_strings(item)]
    return []


def test_story_bible_draft_allocates_server_ids_and_resolves_all_local_references() -> None:
    payload, keys = draft_payload()
    draft = StoryBibleContentDraftV1.model_validate(payload)
    first_fact_key = keys[valid_story_bible_payload()["facts"][0]["fact_id"]]
    span = StorySourceSpanDraftV1.model_validate(
        {
            "fact_id": {"ref_type": "client_key", "client_key": first_fact_key},
            "source_document_id": draft.source_scope.documents[0].source_document_id,
            "source_block_id": draft.source_scope.documents[0].source_block_ids[0],
            "role": "supports",
            "start_byte": 0,
            "end_byte": 3,
            "claim": "来源证据",
        }
    )

    resolved = resolve_story_bible_draft(
        draft,
        (span,),
        id_factory=deterministic_id_factory(),
    )

    assert len(resolved.id_map) == len(draft.entities) + len(draft.facts)
    assert all(value.startswith(("ent_", "fact_")) for value in resolved.id_map.values())
    assert resolved.source_spans[0].fact_id == resolved.id_map[first_fact_key]
    assert resolved.content.facts[0].fact_id == resolved.id_map[first_fact_key]
    assert resolved.content.model_dump(mode="json")["facts"][0]["participants"][0].startswith(
        "ent_"
    )


def test_story_bible_draft_rejects_unknown_duplicate_or_client_owned_permanent_ids() -> None:
    unknown_payload, _ = draft_payload()
    unknown_payload["facts"][0]["participants"][0] = {
        "ref_type": "client_key",
        "client_key": "missing_character",
    }
    unknown = StoryBibleContentDraftV1.model_validate(unknown_payload)
    with pytest.raises(ValueError, match="unknown client key"):
        resolve_story_bible_draft(unknown, (), id_factory=deterministic_id_factory())

    duplicate_payload, _ = draft_payload()
    duplicate_payload["entities"][1]["entity_id"] = duplicate_payload["entities"][0]["entity_id"]
    duplicate = StoryBibleContentDraftV1.model_validate(duplicate_payload)
    with pytest.raises(ValueError, match="globally unique"):
        resolve_story_bible_draft(duplicate, (), id_factory=deterministic_id_factory())

    permanent_payload, _ = draft_payload(permanent=True)
    permanent = StoryBibleContentDraftV1.model_validate(permanent_payload)
    with pytest.raises(ValueError, match="does not exist in its parent"):
        resolve_story_bible_draft(permanent, (), id_factory=deterministic_id_factory())


def test_story_bible_revision_preserves_permanent_ids_and_rejects_semantic_kind_changes() -> None:
    previous = StoryBibleContentV1.model_validate(valid_story_bible_payload())
    payload, _ = draft_payload(permanent=True)
    draft = StoryBibleContentDraftV1.model_validate(payload)

    resolved = resolve_story_bible_draft(
        draft,
        (),
        id_factory=deterministic_id_factory(),
        previous_content=previous,
    )

    assert resolved.id_map == {}
    assert [entity.entity_id for entity in resolved.content.entities] == [
        entity.entity_id for entity in previous.entities
    ]

    changed_payload = deepcopy(payload)
    changed_payload["facts"][2] = {
        **changed_payload["facts"][2],
        "kind": "location_fact",
        "location_id": changed_payload["entities"][1]["entity_id"],
        "attribute": "false-history",
        "value": "closed",
    }
    changed_payload["facts"][2].pop("character_id")
    changed = StoryBibleContentDraftV1.model_validate(changed_payload)
    with pytest.raises(ValueError, match="cannot change semantic kind"):
        resolve_story_bible_draft(
            changed,
            (),
            id_factory=deterministic_id_factory(),
            previous_content=previous,
        )


def test_story_bible_draft_rejects_source_question_outside_bound_scope() -> None:
    payload, _ = draft_payload()
    payload["questions"] = [
        {
            "question_id": {"ref_type": "client_key", "client_key": "question_source"},
            "scope_type": "source_document",
            "scope_id": {
                "ref_type": "permanent_id",
                "permanent_id": "src_" + "9" * 32,
            },
            "question": "Does the appendix apply?",
            "severity": "major",
            "responsible_role": "writer",
            "blocking": True,
            "status": "open",
            "resolution": None,
        }
    ]
    draft = StoryBibleContentDraftV1.model_validate(payload)

    with pytest.raises(ValueError, match="outside the StoryBible source scope"):
        resolve_story_bible_draft(draft, (), id_factory=deterministic_id_factory())
