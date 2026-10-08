"""Aggregate StoryBible checks that require persisted source evidence."""

from collections import defaultdict
from typing import Protocol

from aijian_api.domain import SourceSpanRole
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.story_bible import StoryBibleContentV1


class StoryBibleAggregateInvalidError(ValueError):
    pass


class StorySourceEvidence(Protocol):
    @property
    def fact_id(self) -> str: ...

    @property
    def source_document_id(self) -> str: ...

    @property
    def source_block_id(self) -> str: ...

    @property
    def role(self) -> SourceSpanRole: ...


def validate_story_bible_aggregate(
    content: StoryBibleContentV1,
    *,
    source_manifest_version_id: str,
    source_manifest: SourceManifestContentV1,
    source_spans: tuple[StorySourceEvidence, ...],
) -> None:
    """Reject source scope or evidence that does not close over the accepted G1 input."""

    if content.source_scope.source_manifest_version_id != source_manifest_version_id:
        raise StoryBibleAggregateInvalidError("Story source scope does not bind this G1 version")
    manifest_documents = {
        document.source_document_id: document for document in source_manifest.documents
    }
    scope_documents = {
        document.source_document_id: document for document in content.source_scope.documents
    }
    for document_id, scoped_document in scope_documents.items():
        manifest_document = manifest_documents.get(document_id)
        if manifest_document is None or scoped_document.raw_sha256 != manifest_document.raw_sha256:
            raise StoryBibleAggregateInvalidError("Story source scope document hash is not in G1")
        manifest_block_ids = {block.source_block_id for block in manifest_document.blocks}
        if not set(scoped_document.source_block_ids) <= manifest_block_ids:
            raise StoryBibleAggregateInvalidError("Story source scope contains a block outside G1")
        manifest_chapters = {block.chapter_index for block in manifest_document.blocks}
        if not set(scoped_document.chapter_indices) <= manifest_chapters:
            raise StoryBibleAggregateInvalidError(
                "Story source scope contains a chapter outside G1"
            )
    if content.source_scope.scope_type == "full_work":
        if set(scope_documents) != set(manifest_documents):
            raise StoryBibleAggregateInvalidError("Full-work scope must include every G1 document")
        for document_id, manifest_document in manifest_documents.items():
            scoped_document = scope_documents[document_id]
            if set(scoped_document.source_block_ids) != {
                block.source_block_id for block in manifest_document.blocks
            } or set(scoped_document.chapter_indices) != {
                block.chapter_index for block in manifest_document.blocks
            }:
                raise StoryBibleAggregateInvalidError(
                    "Full-work scope must include every G1 block and chapter"
                )
    elif not content.source_scope.exclusions:
        raise StoryBibleAggregateInvalidError("Selected-range scope must explain excluded material")

    scoped_blocks = {
        (document.source_document_id, block_id)
        for document in content.source_scope.documents
        for block_id in document.source_block_ids
    }
    spans_by_fact: dict[str, list[StorySourceEvidence]] = defaultdict(list)
    fact_ids = {fact.fact_id for fact in content.facts}
    for span in source_spans:
        if span.fact_id not in fact_ids:
            raise StoryBibleAggregateInvalidError("Source evidence references a missing story fact")
        if (span.source_document_id, span.source_block_id) not in scoped_blocks:
            raise StoryBibleAggregateInvalidError(
                "Source evidence falls outside story source scope"
            )
        spans_by_fact[span.fact_id].append(span)
        if len(spans_by_fact[span.fact_id]) > 100:
            raise StoryBibleAggregateInvalidError(
                "A story fact cannot contain more than 100 source spans"
            )
    for fact in content.facts:
        if fact.origin in (
            "source_explicit_assertion",
            "source_interpretation",
            "ai_inference",
        ) and not any(span.role == "supports" for span in spans_by_fact[fact.fact_id]):
            raise StoryBibleAggregateInvalidError(
                "Source-derived story fact requires precise supports evidence"
            )
