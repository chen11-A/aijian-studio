"""Direct contract tests for immutable Phase-G0 production briefs."""

from copy import deepcopy

import pytest
from aijian_api.artifacts import canonical_content_bytes, canonical_content_hash
from aijian_api.production_brief import (
    DeliveryIntentV1,
    PositiveRationalData,
    ProductionBriefContentV1,
)
from pydantic import ValidationError


def original_payload() -> dict[str, object]:
    return {
        "creative_entry": {
            "kind": "original_idea",
            "origin_statement": "城市记住每一首歌。",
        },
        "creative": {
            "premise": "记忆有代价。",
            "intent": "一部充满希望的动画短片。",
        },
        "delivery": {
            "language": "zh-CN",
            "display_aspect_ratio": {"num": 16, "den": 9},
            "width_px": 1920,
            "height_px": 1080,
            "frame_rate": {"num": 24, "den": 1},
        },
        "duration_intent": {
            "work_seconds": None,
            "episode_mode": "unspecified",
            "episode_seconds": None,
        },
        "budget_intent": {"state": "unknown", "currency": None, "amount_micros": None},
        "rights_declaration": {"state": "unknown", "statement": None},
    }


def adaptation_payload() -> dict[str, object]:
    payload = original_payload()
    payload["creative_entry"] = {
        "kind": "source_adaptation",
        "adaptation_statement": "改编提交的章节。",
        "source_document_id": "src_0123456789abcdef0123456789abcdef",
        "source_manifest_version_id": "ver_0123456789abcdef0123456789abcdef",
        "source_block_ids": ["srcb_0123456789abcdef0123456789abcdef"],
    }
    payload["delivery"] = {
        "language": "zh-CN",
        "display_aspect_ratio": {"num": 16, "den": 9},
        "width_px": 1920,
        "height_px": 1080,
        "frame_rate": {"num": 48, "den": 1},
    }
    payload["duration_intent"] = {
        "work_seconds": 900,
        "episode_mode": "per_episode",
        "episode_seconds": 1800,
    }
    payload["budget_intent"] = {"state": "declared", "currency": "USD", "amount_micros": 0}
    payload["rights_declaration"] = {
        "state": "user_declared",
        "statement": "用户声明创作贡献。",
    }
    return payload


def test_valid_payloads_emit_all_defaults_and_canonical_content() -> None:
    brief = ProductionBriefContentV1.model_validate(original_payload())
    dumped = brief.model_dump(mode="json")

    assert dumped["schema_version"] == "1.0.0"
    assert dumped["creative"]["audience"] is None
    assert dumped["creative"]["constraints"] == []
    assert dumped["creative_entry"]["references"] == []
    restored = ProductionBriefContentV1.model_validate_json(brief.model_dump_json())
    assert canonical_content_bytes(dumped) == canonical_content_bytes(
        restored.model_dump(mode="json")
    )
    assert canonical_content_hash(dumped) == canonical_content_hash(
        restored.model_dump(mode="json")
    )


def test_valid_adaptation_ids_are_structural_only_and_arrays_become_tuples() -> None:
    brief = ProductionBriefContentV1.model_validate(adaptation_payload())

    assert brief.creative_entry.source_document_id.startswith("src_")
    assert brief.creative_entry.source_manifest_version_id.startswith("ver_")
    assert isinstance(brief.creative_entry.source_block_ids, tuple)
    assert brief.delivery.frame_rate == PositiveRationalData(num=48, den=1)
    assert brief.budget_intent.amount_micros == 0


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("delivery",), None),
        (("delivery", "language"), None),
        (("duration_intent", "work_seconds"), "missing"),
        (("duration_intent", "episode_seconds"), "missing"),
        (("budget_intent", "currency"), "missing"),
        (("budget_intent", "amount_micros"), "missing"),
        (("rights_declaration", "statement"), "missing"),
    ],
)
def test_delivery_and_nullable_without_defaults_are_required(
    path: tuple[str, ...],
    value: object,
) -> None:
    payload = deepcopy(original_payload())
    target: dict[str, object] = payload
    for key in path[:-1]:
        target = target[key]  # type: ignore[assignment,index]
    if value == "missing":
        target.pop(path[-1])
    else:
        target.pop(path[-1])
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(payload)


@pytest.mark.parametrize(
    ("delivery_update", "root_update"),
    [
        ({"width_px": 0}, None),
        ({"width_px": True}, None),
        ({"width_px": 1920.0}, None),
        ({"width_px": float("nan")}, None),
        ({"frame_rate": {"num": 48, "den": 2}}, None),
        ({"frame_rate": {"num": 0, "den": 1}}, None),
        ({"height_px": 1920}, None),
        ({}, {"unverified": True}),
    ],
)
def test_strict_numbers_rationals_dimensions_and_unknown_fields_reject(
    delivery_update: dict[str, object], root_update: dict[str, object] | None
) -> None:
    payload = original_payload()
    delivery = payload["delivery"]
    assert isinstance(delivery, dict)
    delivery.update(delivery_update)
    if root_update is not None:
        payload.update(root_update)
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(payload)


@pytest.mark.parametrize(
    ("section", "update"),
    [
        ("duration_intent", {"work_seconds": 0}),
        ("duration_intent", {"episode_mode": "per_episode"}),
        ("budget_intent", {"state": "declared"}),
        ("rights_declaration", {"state": "user_declared"}),
        ("creative", {"premise": "   "}),
    ],
)
def test_cross_field_unknown_and_declared_relations_reject(
    section: str, update: dict[str, object]
) -> None:
    payload = original_payload()
    target = payload[section]
    assert isinstance(target, dict)
    target.update(update)
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(payload)


def test_nested_constructed_or_copied_rationals_are_revalidated() -> None:
    invalid_ratio = PositiveRationalData.model_construct(num=16, den=8)
    delivery = DeliveryIntentV1.model_construct(
        language="zh-CN",
        display_aspect_ratio=invalid_ratio,
        width_px=1920,
        height_px=1080,
        frame_rate=PositiveRationalData(num=24, den=1),
    )
    payload = original_payload()
    payload["delivery"] = delivery

    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(payload)


@pytest.mark.parametrize("factory", ["construct", "copy"])
@pytest.mark.parametrize("delivery_field", ["display_aspect_ratio", "frame_rate"])
@pytest.mark.parametrize("rational_field", ["num", "den"])
def test_root_revalidation_rejects_boolean_rational_members_before_json_normalization(
    factory: str, delivery_field: str, rational_field: str
) -> None:
    payload = original_payload()
    delivery_data = payload["delivery"]
    assert isinstance(delivery_data, dict)
    delivery = DeliveryIntentV1.model_validate(delivery_data)
    if rational_field == "num":
        invalid = PositiveRationalData.model_construct(num=True, den=1)
        if delivery_field == "display_aspect_ratio":
            delivery = delivery.model_copy(update={"width_px": 1080, "height_px": 1080})
    else:
        invalid = PositiveRationalData.model_construct(num=1, den=True)
        if delivery_field == "display_aspect_ratio":
            delivery = delivery.model_copy(update={"width_px": 1080, "height_px": 1080})
    if factory == "copy":
        invalid = PositiveRationalData(num=1, den=1).model_copy(update={rational_field: True})
    payload["delivery"] = delivery.model_copy(update={delivery_field: invalid})

    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(payload)


def test_copied_nested_rational_and_duplicate_or_malformed_source_reject() -> None:
    invalid_copy = PositiveRationalData(num=24, den=1).model_copy(update={"num": 48, "den": 2})
    delivery = DeliveryIntentV1.model_validate(original_payload()["delivery"])
    payload = original_payload()
    payload["delivery"] = delivery.model_copy(update={"frame_rate": invalid_copy})
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(payload)

    adaptation = adaptation_payload()
    entry = adaptation["creative_entry"]
    assert isinstance(entry, dict)
    entry["source_block_ids"] = ["srcb_bad"]
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(adaptation)

    missing_manifest = adaptation_payload()
    missing_entry = missing_manifest["creative_entry"]
    assert isinstance(missing_entry, dict)
    missing_entry.pop("source_manifest_version_id")
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(missing_manifest)

    original = original_payload()
    original_entry = original["creative_entry"]
    assert isinstance(original_entry, dict)
    original_entry["references"] = [
        {"reference_kind": "research", "description": "same"},
        {"reference_kind": "research", "description": "same"},
    ]
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(original)


@pytest.mark.parametrize("field", ["origin_statement", "premise", "intent"])
def test_unicode_text_preserves_exact_value_and_has_bounded_length(field: str) -> None:
    text = "  \u521b\u4f5c\u8bf4\u660e\n" + "\u5b57" * 3_990
    payload = original_payload()
    if field == "origin_statement":
        entry = payload["creative_entry"]
        assert isinstance(entry, dict)
        entry[field] = text
    else:
        creative = payload["creative"]
        assert isinstance(creative, dict)
        creative[field] = text
    brief = ProductionBriefContentV1.model_validate(payload)
    dumped = brief.model_dump()
    if field == "origin_statement":
        assert dumped["creative_entry"][field] == text
    else:
        assert dumped["creative"][field] == text

    too_long = deepcopy(payload)
    if field == "origin_statement":
        entry = too_long["creative_entry"]
        assert isinstance(entry, dict)
        entry[field] = "x" * 4_001
    else:
        creative = too_long["creative"]
        assert isinstance(creative, dict)
        creative[field] = "x" * 4_001
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(too_long)


def test_collection_limits_and_nondefault_delivery_are_explicit() -> None:
    payload = adaptation_payload()
    entry = payload["creative_entry"]
    assert isinstance(entry, dict)
    entry["source_block_ids"] = [f"srcb_{index:032x}" for index in range(100)]
    creative = payload["creative"]
    assert isinstance(creative, dict)
    creative["constraints"] = [f"constraint {index}" for index in range(32)]
    delivery = payload["delivery"]
    assert isinstance(delivery, dict)
    delivery.update(
        language="en-US",
        display_aspect_ratio={"num": 4, "den": 3},
        width_px=1440,
        height_px=1080,
        frame_rate={"num": 24000, "den": 1001},
    )
    brief = ProductionBriefContentV1.model_validate(payload)
    assert brief.delivery.model_dump(mode="json") == {
        "language": "en-US",
        "display_aspect_ratio": {"num": 4, "den": 3},
        "width_px": 1440,
        "height_px": 1080,
        "frame_rate": {"num": 24000, "den": 1001},
    }

    too_many = deepcopy(payload)
    too_many_entry = too_many["creative_entry"]
    assert isinstance(too_many_entry, dict)
    too_many_entry["source_block_ids"] = [f"srcb_{index:032x}" for index in range(101)]
    with pytest.raises(ValidationError):
        ProductionBriefContentV1.model_validate(too_many)
