from __future__ import annotations

from copy import deepcopy

import pytest
from aijian_api.episode_story_contracts import (
    MAX_CLAIM_TEXT_CODE_POINTS,
    MAX_EVIDENCE_REFS_PER_CLAIM,
    EpisodeStoryContentV1,
)
from pydantic import ValidationError


def identifier(prefix: str, suffix: str) -> str:
    return f"{prefix}_{suffix * 32}"[: len(prefix) + 33]


def source_evidence(claim_id: str) -> dict[str, object]:
    return {
        "claim_id": claim_id,
        "source_document_id": identifier("src", "a"),
        "source_block_id": identifier("srcb", "b"),
        "start_byte": 0,
        "end_byte": 12,
        "role": "supports",
        "claim": "Synthetic source explanation",
    }


def valid_payload() -> dict[str, object]:
    source_claim_id = identifier("ecl", "c")
    inference_claim_id = identifier("ecl", "d")
    decision_claim_id = identifier("ecl", "e")
    return {
        "schema_version": "1.0.0",
        "project_id": identifier("prj", "1"),
        "episode_id": f"ep_{identifier('prj', '1')}",
        "source_manifest_version_id": identifier("ver", "2"),
        "story_bible_version_id": identifier("ver", "3"),
        "claims": [
            {
                "claim_id": source_claim_id,
                "ordinal": 1,
                "text": "Synthetic source-based narrative claim",
                "origin": "source_explicit_assertion",
                "evidence_refs": [source_evidence(source_claim_id)],
                "story_bible_fact_ids": [],
            },
            {
                "claim_id": inference_claim_id,
                "ordinal": 2,
                "text": "Synthetic inference claim",
                "origin": "ai_inference",
                "evidence_refs": [source_evidence(inference_claim_id)],
                "story_bible_fact_ids": [],
            },
            {
                "claim_id": decision_claim_id,
                "ordinal": 3,
                "text": "Synthetic user-decision reference",
                "origin": "user_decision",
                "evidence_refs": [],
                "story_bible_fact_ids": [identifier("fact", "4")],
            },
        ],
    }


def test_accepts_mixed_provenance_and_json_round_trip() -> None:
    content = EpisodeStoryContentV1.model_validate(valid_payload())

    restored = EpisodeStoryContentV1.model_validate_json(content.model_dump_json())

    assert restored == content
    assert isinstance(content.claims, tuple)
    assert isinstance(content.claims[0].evidence_refs, tuple)
    assert content.episode_id == f"ep_{identifier('prj', '1')}"


def test_accepts_local_validation_bounds_and_overlapping_evidence() -> None:
    payload = valid_payload()
    source_claim = payload["claims"][0]
    assert isinstance(source_claim, dict)
    source_claim["text"] = "x" * MAX_CLAIM_TEXT_CODE_POINTS
    source_claim["evidence_refs"] = [
        source_evidence(str(source_claim["claim_id"])) for _ in range(MAX_EVIDENCE_REFS_PER_CLAIM)
    ]
    for index, evidence in enumerate(source_claim["evidence_refs"]):
        assert isinstance(evidence, dict)
        evidence["start_byte"] = index
        evidence["end_byte"] = index + 1

    content = EpisodeStoryContentV1.model_validate(payload)

    assert len(content.claims[0].evidence_refs) == MAX_EVIDENCE_REFS_PER_CLAIM


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda payload: payload["claims"][0].update({"evidence_refs": []}),
            "supports evidence",
        ),
        (
            lambda payload: payload["claims"][2].update({"story_bible_fact_ids": []}),
            "StoryBible fact",
        ),
        (
            lambda payload: payload.update({"story_bible_version_id": None}),
            "StoryBible version",
        ),
        (
            lambda payload: payload["claims"][0].update(
                {"story_bible_fact_ids": [identifier("fact", "5")]}
            ),
            "user-decision",
        ),
        (
            lambda payload: payload["claims"][0].update({"ordinal": 3}),
            "contiguous",
        ),
        (
            lambda payload: payload["claims"][0]["evidence_refs"][0].update({"end_byte": 0}),
            "end_byte",
        ),
        (
            lambda payload: payload["claims"][0]["evidence_refs"][0].update({"claim": "   "}),
            "claim explanation",
        ),
        (
            lambda payload: payload["claims"][0].update({"accepted": True}),
            "Extra inputs",
        ),
        (
            lambda payload: payload.update({"gate": "G4"}),
            "Extra inputs",
        ),
        (
            lambda payload: payload["claims"][0]["evidence_refs"][0].update({"author": "user"}),
            "Extra inputs",
        ),
    ],
)
def test_rejects_invalid_provenance_references_and_authority_declarations(
    mutation: object, message: str
) -> None:
    payload = valid_payload()
    assert callable(mutation)
    mutation(payload)

    with pytest.raises(ValidationError, match=message):
        EpisodeStoryContentV1.model_validate(payload)


@pytest.mark.parametrize(
    ("path", "invalid"),
    [
        (("claims", 0, "ordinal"), True),
        (("claims", 0, "ordinal"), 1.0),
        (("claims", 0, "evidence_refs", 0, "start_byte"), "0"),
        (("claims", 0, "evidence_refs", 0, "end_byte"), 1.0),
        (("claims", 0, "evidence_refs", 0, "claim_id"), identifier("fact", "9")),
    ],
)
def test_rejects_strict_type_and_cross_reference_bypasses(
    path: tuple[object, ...], invalid: object
) -> None:
    payload = valid_payload()
    target: object = payload
    for part in path[:-1]:
        target = target[part]  # type: ignore[index]
    target[path[-1]] = invalid  # type: ignore[index]

    with pytest.raises(ValidationError):
        EpisodeStoryContentV1.model_validate(payload)


def test_revalidates_forged_instance_instead_of_trusting_mutable_nested_data() -> None:
    content = EpisodeStoryContentV1.model_validate(valid_payload())
    object.__setattr__(content.claims[0], "ordinal", True)

    with pytest.raises(ValidationError):
        EpisodeStoryContentV1.model_validate(content)


def test_rejects_exact_bound_overflow_duplicates_and_unknown_nested_fields() -> None:
    overflow = valid_payload()
    source_claim = overflow["claims"][0]
    assert isinstance(source_claim, dict)
    source_claim["text"] = "x" * (MAX_CLAIM_TEXT_CODE_POINTS + 1)
    with pytest.raises(ValidationError):
        EpisodeStoryContentV1.model_validate(overflow)

    duplicate = valid_payload()
    duplicate_claim = deepcopy(duplicate["claims"][0])
    assert isinstance(duplicate_claim, dict)
    duplicate_claim["ordinal"] = 2
    duplicate["claims"].append(duplicate_claim)
    with pytest.raises(ValidationError, match="unique"):
        EpisodeStoryContentV1.model_validate(duplicate)

    nested_extra = valid_payload()
    nested_extra["claims"][0]["evidence_refs"][0]["runtime_id"] = "run_x"
    with pytest.raises(ValidationError, match="Extra inputs"):
        EpisodeStoryContentV1.model_validate(nested_extra)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda payload: payload["claims"][0].update({"text": "  "}),
            "claim text",
        ),
        (
            lambda payload: payload["claims"][2].update(
                {"story_bible_fact_ids": [identifier("fact", "4")] * 2}
            ),
            "unique",
        ),
        (
            lambda payload: payload["claims"][0].update(
                {"evidence_refs": [source_evidence(str(payload["claims"][0]["claim_id"]))] * 2}
            ),
            "unique",
        ),
        (
            lambda payload: payload["claims"][0]["evidence_refs"][0].update(
                {"claim_id": identifier("ecl", "f")}
            ),
            "parent claim",
        ),
        (
            lambda payload: payload["claims"][2].update(
                {"evidence_refs": [source_evidence(str(payload["claims"][2]["claim_id"]))]}
            ),
            "cannot carry",
        ),
    ],
)
def test_rejects_blank_and_internally_inconsistent_claim_references(
    mutation: object, message: str
) -> None:
    payload = valid_payload()
    assert callable(mutation)
    mutation(payload)

    with pytest.raises(ValidationError, match=message):
        EpisodeStoryContentV1.model_validate(payload)
