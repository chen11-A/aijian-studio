"""Typed StoryBible write drafts with server-resolved local references."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.domain import ArtifactSourceSpanDraft
from aijian_api.story_bible import (
    BooleanStateValueV1,
    CanonCertainty,
    CanonStatus,
    EntityKind,
    FactImportance,
    FactOrigin,
    NumberStateValueV1,
    SourceReliability,
    StatePropertyKey,
    StoryBibleContentV1,
    StorySourceScopeV1,
    TextStateValueV1,
)

_PERMANENT_ID_PATTERN = r"^(ent|fact|qst|cfl|src)_[0-9a-f]{32}$"
_SOURCE_ID_PATTERN = r"^src_[0-9a-f]{32}$"
_SOURCE_BLOCK_ID_PATTERN = r"^srcb_[0-9a-f]{32}$"


class StoryBibleDraftInvalidError(ValueError):
    """Raised when resolved draft semantics are invalid."""


class _StrictDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class PermanentRefV1(_StrictDraft):
    ref_type: Literal["permanent_id"]
    permanent_id: str = Field(pattern=_PERMANENT_ID_PATTERN)


class ClientRefV1(_StrictDraft):
    ref_type: Literal["client_key"]
    client_key: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")


LocalRefV1 = Annotated[PermanentRefV1 | ClientRefV1, Field(discriminator="ref_type")]


class StoryEntityDraftV1(_StrictDraft):
    entity_id: LocalRefV1
    kind: EntityKind
    name: str = Field(min_length=1, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=50)


class EventValidityDraftV1(_StrictDraft):
    starts_after_event_fact_id: LocalRefV1 | None = None
    ends_after_event_fact_id: LocalRefV1 | None = None


class TemporalRelationDraftV1(_StrictDraft):
    relation: Literal["before", "after", "simultaneous"]
    other_event_fact_id: LocalRefV1


class EntityStateValueDraftV1(_StrictDraft):
    kind: Literal["entity_ref"]
    entity_id: LocalRefV1


StateValueDraftV1 = Annotated[
    TextStateValueV1 | EntityStateValueDraftV1 | BooleanStateValueV1 | NumberStateValueV1,
    Field(discriminator="kind"),
]


class StateChangeDraftV1(_StrictDraft):
    entity_id: LocalRefV1
    property_key: StatePropertyKey
    before: StateValueDraftV1 | None = None
    after: StateValueDraftV1 | None = None


class _FactDraftV1(_StrictDraft):
    fact_id: LocalRefV1
    importance: FactImportance
    origin: FactOrigin
    canon_status: CanonStatus
    extraction_confidence_bps: int | None = Field(default=None, ge=0, le=10000)
    canon_certainty: CanonCertainty
    viewpoint_entity_id: LocalRefV1 | None = None
    source_reliability: SourceReliability
    decision_reason: str | None = Field(default=None, max_length=1000)
    impact_scope: list[str] = Field(default_factory=list, max_length=100)
    supersedes_fact_ids: list[LocalRefV1] = Field(default_factory=list, max_length=100)
    derived_from_fact_ids: list[LocalRefV1] = Field(default_factory=list, max_length=100)


class CharacterFactDraftV1(_FactDraftV1):
    kind: Literal["character_fact"]
    character_id: LocalRefV1
    attribute: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=1000)
    validity: EventValidityDraftV1 | None = None


class LocationFactDraftV1(_FactDraftV1):
    kind: Literal["location_fact"]
    location_id: LocalRefV1
    attribute: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=1000)
    validity: EventValidityDraftV1 | None = None


class RelationshipFactDraftV1(_FactDraftV1):
    kind: Literal["relationship_fact"]
    subject_entity_id: LocalRefV1
    predicate: str = Field(min_length=1, max_length=120)
    object_entity_id: LocalRefV1
    validity: EventValidityDraftV1 | None = None


class EventFactDraftV1(_FactDraftV1):
    kind: Literal["event_fact"]
    participants: list[LocalRefV1] = Field(min_length=1, max_length=100)
    location_id: LocalRefV1 | None = None
    source_narrative_order: int = Field(ge=0)
    story_time_order: int = Field(ge=0)
    temporal_relations: list[TemporalRelationDraftV1] = Field(default_factory=list, max_length=100)
    caused_by_fact_ids: list[LocalRefV1] = Field(default_factory=list, max_length=100)
    state_changes: list[StateChangeDraftV1] = Field(default_factory=list, max_length=100)


class WorldRuleFactDraftV1(_FactDraftV1):
    kind: Literal["world_rule_fact"]
    rule_scope: str = Field(min_length=1, max_length=120)
    rule: str = Field(min_length=1, max_length=1000)
    exceptions: list[str] = Field(default_factory=list, max_length=100)


class OrganizationFactDraftV1(_FactDraftV1):
    kind: Literal["organization_fact"]
    organization_id: LocalRefV1
    attribute: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=1000)
    validity: EventValidityDraftV1 | None = None


class PropFactDraftV1(_FactDraftV1):
    kind: Literal["prop_fact"]
    prop_id: LocalRefV1
    property_key: Literal["holder", "location", "condition", "appearance"]
    value: StateValueDraftV1 | None
    validity: EventValidityDraftV1 | None = None


class CostumeFactDraftV1(_FactDraftV1):
    kind: Literal["costume_fact"]
    costume_id: LocalRefV1
    property_key: Literal["wearer", "location", "condition", "appearance"]
    value: StateValueDraftV1 | None
    validity: EventValidityDraftV1 | None = None


StoryFactDraftV1 = Annotated[
    CharacterFactDraftV1
    | LocationFactDraftV1
    | RelationshipFactDraftV1
    | EventFactDraftV1
    | WorldRuleFactDraftV1
    | OrganizationFactDraftV1
    | PropFactDraftV1
    | CostumeFactDraftV1,
    Field(discriminator="kind"),
]


class StoryQuestionDraftV1(_StrictDraft):
    question_id: LocalRefV1
    scope_type: Literal["artifact", "entity", "fact", "source_document"]
    scope_id: LocalRefV1 | None = None
    question: str = Field(min_length=1, max_length=1000)
    severity: Literal["blocking", "major", "minor", "note"]
    responsible_role: str = Field(min_length=1, max_length=80)
    blocking: bool
    status: Literal["open", "resolved"]
    resolution: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_scope(self) -> StoryQuestionDraftV1:
        if self.scope_type == "artifact" and self.scope_id is not None:
            raise ValueError("Artifact question cannot carry a scope ID")
        if self.scope_type != "artifact" and self.scope_id is None:
            raise ValueError("Scoped question requires a scope ID")
        if self.scope_type == "source_document" and not isinstance(self.scope_id, PermanentRefV1):
            raise ValueError("Source document question requires a permanent source ID")
        return self


class FactConflictDraftV1(_StrictDraft):
    conflict_id: LocalRefV1
    conflict_type: str = Field(min_length=1, max_length=120)
    fact_ids: list[LocalRefV1] = Field(min_length=2, max_length=100)
    severity: Literal["blocking", "major", "minor", "note"]
    responsible_role: str = Field(min_length=1, max_length=80)
    status: Literal["unresolved", "resolved_as_source_ambiguity", "resolved_by_user_decision"]
    resolution_reason: str | None = Field(default=None, max_length=1000)
    resolution_fact_id: LocalRefV1 | None = None


class StoryBibleContentDraftV1(_StrictDraft):
    title: str = Field(min_length=1, max_length=120)
    logline: str = Field(min_length=1, max_length=500)
    source_scope: StorySourceScopeV1
    entities: list[StoryEntityDraftV1] = Field(min_length=1, max_length=2000)
    facts: list[StoryFactDraftV1] = Field(min_length=1, max_length=20000)
    questions: list[StoryQuestionDraftV1] = Field(default_factory=list, max_length=2000)
    conflicts: list[FactConflictDraftV1] = Field(default_factory=list, max_length=2000)


class StorySourceSpanDraftV1(_StrictDraft):
    fact_id: LocalRefV1
    source_document_id: str = Field(pattern=_SOURCE_ID_PATTERN)
    source_block_id: str = Field(pattern=_SOURCE_BLOCK_ID_PATTERN)
    role: Literal["supports", "contradicts", "context"]
    start_byte: int = Field(ge=0)
    end_byte: int = Field(gt=0)
    claim: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def validate_offsets(self) -> StorySourceSpanDraftV1:
        if self.start_byte >= self.end_byte:
            raise ValueError("Source span start must be before end")
        return self


@dataclass(frozen=True, slots=True)
class ResolvedStoryBibleDraft:
    content: StoryBibleContentV1
    source_spans: tuple[ArtifactSourceSpanDraft, ...]
    id_map: dict[str, str]


def resolve_story_bible_draft(
    content: StoryBibleContentDraftV1,
    source_spans: tuple[StorySourceSpanDraftV1, ...],
    *,
    id_factory: Callable[[str], str],
    previous_content: StoryBibleContentV1 | None = None,
) -> ResolvedStoryBibleDraft:
    """Allocate every client key and produce canonical StoryBible content."""

    previous_ids = _previous_ids(previous_content)
    owned_refs: list[tuple[LocalRefV1, str]] = [
        *((entity.entity_id, "ent") for entity in content.entities),
        *((fact.fact_id, "fact") for fact in content.facts),
        *((question.question_id, "qst") for question in content.questions),
        *((conflict.conflict_id, "cfl") for conflict in content.conflicts),
    ]
    id_map: dict[str, str] = {}
    for reference, prefix in owned_refs:
        if isinstance(reference, PermanentRefV1):
            if reference.permanent_id not in previous_ids[prefix]:
                raise ValueError("Permanent draft item ID does not exist in its parent version")
            continue
        if reference.client_key in id_map:
            raise ValueError("Story draft client keys must be globally unique")
        id_map[reference.client_key] = id_factory(prefix)

    resolved_json = _resolve_node(content.model_dump(mode="json"), id_map)
    resolved_content = StoryBibleContentV1.model_validate(cast(dict[str, object], resolved_json))
    _validate_stable_kinds(resolved_content, previous_content)
    scoped_source_ids = {
        document.source_document_id for document in resolved_content.source_scope.documents
    }
    for question in resolved_content.questions:
        if question.scope_type == "source_document" and question.scope_id not in scoped_source_ids:
            raise ValueError("Question source scope is outside the StoryBible source scope")

    resolved_spans = tuple(
        ArtifactSourceSpanDraft(
            fact_id=_resolve_ref(span.fact_id, id_map),
            source_document_id=span.source_document_id,
            source_block_id=span.source_block_id,
            role=span.role,
            start_byte=span.start_byte,
            end_byte=span.end_byte,
            claim=span.claim,
        )
        for span in source_spans
    )
    return ResolvedStoryBibleDraft(
        content=resolved_content,
        source_spans=resolved_spans,
        id_map=id_map,
    )


def _resolve_node(value: object, id_map: dict[str, str]) -> object:
    if isinstance(value, list):
        return [_resolve_node(item, id_map) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get("ref_type") == "client_key":
        client_key = cast(str, value["client_key"])
        try:
            return id_map[client_key]
        except KeyError as error:
            raise ValueError("Story draft references an unknown client key") from error
    if value.get("ref_type") == "permanent_id":
        return cast(str, value["permanent_id"])
    return {key: _resolve_node(item, id_map) for key, item in value.items()}


def _resolve_ref(reference: LocalRefV1, id_map: dict[str, str]) -> str:
    if isinstance(reference, PermanentRefV1):
        return reference.permanent_id
    try:
        return id_map[reference.client_key]
    except KeyError as error:
        raise ValueError("Story draft references an unknown client key") from error


def _previous_ids(content: StoryBibleContentV1 | None) -> dict[str, set[str]]:
    if content is None:
        return {"ent": set(), "fact": set(), "qst": set(), "cfl": set()}
    return {
        "ent": {entity.entity_id for entity in content.entities},
        "fact": {fact.fact_id for fact in content.facts},
        "qst": {question.question_id for question in content.questions},
        "cfl": {conflict.conflict_id for conflict in content.conflicts},
    }


def _validate_stable_kinds(
    content: StoryBibleContentV1,
    previous: StoryBibleContentV1 | None,
) -> None:
    if previous is None:
        return
    previous_entity_kinds = {entity.entity_id: entity.kind for entity in previous.entities}
    previous_fact_kinds = {fact.fact_id: fact.kind for fact in previous.facts}
    if any(
        entity.entity_id in previous_entity_kinds
        and previous_entity_kinds[entity.entity_id] != entity.kind
        for entity in content.entities
    ) or any(
        fact.fact_id in previous_fact_kinds and previous_fact_kinds[fact.fact_id] != fact.kind
        for fact in content.facts
    ):
        raise ValueError("A stable StoryBible ID cannot change semantic kind")
