from dataclasses import replace
from datetime import UTC, datetime

import pytest
from aijian_api.domain import ArtifactSourceSpan
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.story_bible import StoryBibleContentV1
from aijian_api.story_bible_validation import (
    StoryBibleAggregateInvalidError,
    validate_story_bible_aggregate,
)
from test_story_bible import identifier, valid_story_bible_payload


def source_manifest_payload(*, include_second_block: bool = False) -> dict[str, object]:
    blocks = [
        {
            "source_block_id": identifier("srcb", "1"),
            "ordinal": 0,
            "kind": "paragraph",
            "chapter_index": 1,
            "start_byte": 0,
            "end_byte": 30,
            "content_sha256": "b" * 64,
        }
    ]
    if include_second_block:
        blocks.append(
            {
                "source_block_id": identifier("srcb", "2"),
                "ordinal": 1,
                "kind": "paragraph",
                "chapter_index": 2,
                "start_byte": 31,
                "end_byte": 60,
                "content_sha256": "c" * 64,
            }
        )
    return {
        "scope_type": "full_work",
        "documents": [
            {
                "source_document_id": identifier("src", "1"),
                "import_order": 1,
                "filename": "雾城来信.txt",
                "media_type": "text/plain",
                "encoding": "utf-8",
                "byte_size": 60,
                "raw_sha256": "a" * 64,
                "normalized_sha256": "d" * 64,
                "chapter_count": 2 if include_second_block else 1,
                "blocks": blocks,
            }
        ],
        "exclusions": [],
    }


def evidence_span(fact_id: str, *, role: str = "supports") -> ArtifactSourceSpan:
    return ArtifactSourceSpan(
        id=f"span_{fact_id[-8:]}",
        artifact_id=identifier("art", "1"),
        version_id=identifier("ver", "2"),
        fact_id=fact_id,
        project_id=identifier("prj", "1"),
        source_document_id=identifier("src", "1"),
        source_block_id=identifier("srcb", "1"),
        role=role,  # type: ignore[arg-type]
        start_byte=0,
        end_byte=9,
        claim="精确来源依据",
        quote_hash=f"sha256:{'e' * 64}",
        created_at=datetime(2026, 8, 3, tzinfo=UTC),
    )


def valid_aggregate() -> tuple[
    StoryBibleContentV1, SourceManifestContentV1, tuple[ArtifactSourceSpan, ...]
]:
    content = StoryBibleContentV1.model_validate(valid_story_bible_payload())
    manifest = SourceManifestContentV1.model_validate(source_manifest_payload())
    spans = tuple(evidence_span(fact.fact_id) for fact in content.facts)
    return content, manifest, spans


def test_story_bible_aggregate_accepts_complete_g1_scope_and_supports_evidence() -> None:
    content, manifest, spans = valid_aggregate()

    validate_story_bible_aggregate(
        content,
        source_manifest_version_id=identifier("ver", "1"),
        source_manifest=manifest,
        source_spans=spans,
    )


@pytest.mark.parametrize("failure", ["missing_block", "fake_hash", "external_block"])
def test_story_bible_aggregate_rejects_incomplete_or_forged_full_work_scope(
    failure: str,
) -> None:
    payload = valid_story_bible_payload()
    manifest_payload = source_manifest_payload(include_second_block=failure == "missing_block")
    if failure == "fake_hash":
        payload["source_scope"]["documents"][0]["raw_sha256"] = "f" * 64
    elif failure == "external_block":
        payload["source_scope"]["documents"][0]["source_block_ids"] = [identifier("srcb", "9")]
    content = StoryBibleContentV1.model_validate(payload)
    manifest = SourceManifestContentV1.model_validate(manifest_payload)
    spans = tuple(evidence_span(fact.fact_id) for fact in content.facts)

    with pytest.raises(StoryBibleAggregateInvalidError):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=manifest,
            source_spans=spans,
        )


@pytest.mark.parametrize("role", [None, "context", "contradicts"])
def test_story_bible_aggregate_requires_supports_evidence_for_every_source_fact(
    role: str | None,
) -> None:
    content, manifest, spans = valid_aggregate()
    first_fact_id = content.facts[0].fact_id
    replacement = () if role is None else (evidence_span(first_fact_id, role=role),)
    remaining = tuple(span for span in spans if span.fact_id != first_fact_id)

    with pytest.raises(StoryBibleAggregateInvalidError, match="supports evidence"):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=manifest,
            source_spans=remaining + replacement,
        )


def test_story_bible_aggregate_rejects_wrong_g1_version() -> None:
    content, manifest, spans = valid_aggregate()

    with pytest.raises(StoryBibleAggregateInvalidError, match="does not bind"):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "9"),
            source_manifest=manifest,
            source_spans=spans,
        )


def test_story_bible_aggregate_rejects_external_chapter_and_missing_document() -> None:
    chapter_payload = valid_story_bible_payload()
    chapter_payload["source_scope"]["documents"][0]["chapter_indices"] = [2]
    chapter_content = StoryBibleContentV1.model_validate(chapter_payload)
    manifest = SourceManifestContentV1.model_validate(source_manifest_payload())
    spans = tuple(evidence_span(fact.fact_id) for fact in chapter_content.facts)
    with pytest.raises(StoryBibleAggregateInvalidError, match="chapter outside"):
        validate_story_bible_aggregate(
            chapter_content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=manifest,
            source_spans=spans,
        )

    manifest_payload = source_manifest_payload()
    second_document = dict(manifest_payload["documents"][0])
    second_document.update(
        source_document_id=identifier("src", "2"),
        import_order=2,
        filename="appendix.txt",
        raw_sha256="f" * 64,
        normalized_sha256="1" * 64,
        blocks=[
            {
                "source_block_id": identifier("srcb", "2"),
                "ordinal": 0,
                "kind": "paragraph",
                "chapter_index": 1,
                "start_byte": 0,
                "end_byte": 20,
                "content_sha256": "2" * 64,
            }
        ],
    )
    manifest_payload["documents"].append(second_document)
    expanded_manifest = SourceManifestContentV1.model_validate(manifest_payload)
    content = StoryBibleContentV1.model_validate(valid_story_bible_payload())
    spans = tuple(evidence_span(fact.fact_id) for fact in content.facts)
    with pytest.raises(StoryBibleAggregateInvalidError, match="every G1 document"):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=expanded_manifest,
            source_spans=spans,
        )


def test_story_bible_aggregate_requires_selected_range_explanation() -> None:
    payload = valid_story_bible_payload()
    payload["source_scope"]["scope_type"] = "selected_range"
    content = StoryBibleContentV1.model_validate(payload)
    manifest = SourceManifestContentV1.model_validate(source_manifest_payload())
    spans = tuple(evidence_span(fact.fact_id) for fact in content.facts)

    with pytest.raises(StoryBibleAggregateInvalidError, match="explain excluded"):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=manifest,
            source_spans=spans,
        )


@pytest.mark.parametrize("failure", ["missing_fact", "outside_scope"])
def test_story_bible_aggregate_rejects_forged_span_links(failure: str) -> None:
    content, manifest, spans = valid_aggregate()
    if failure == "missing_fact":
        forged_span = evidence_span(identifier("fact", "9"))
        message = "missing story fact"
    else:
        forged_span = replace(
            evidence_span(content.facts[0].fact_id),
            source_block_id=identifier("srcb", "9"),
        )
        message = "outside story source scope"

    with pytest.raises(StoryBibleAggregateInvalidError, match=message):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=manifest,
            source_spans=spans + (forged_span,),
        )


def test_story_bible_aggregate_limits_evidence_per_fact() -> None:
    content, manifest, spans = valid_aggregate()
    first_fact_span = evidence_span(content.facts[0].fact_id)

    with pytest.raises(StoryBibleAggregateInvalidError, match="more than 100"):
        validate_story_bible_aggregate(
            content,
            source_manifest_version_id=identifier("ver", "1"),
            source_manifest=manifest,
            source_spans=spans + (first_fact_span,) * 100,
        )
