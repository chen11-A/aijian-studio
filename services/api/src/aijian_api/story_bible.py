"""Strict StoryBible v1 persisted content and domain invariants."""

from __future__ import annotations

from collections import defaultdict
from typing import Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, model_validator

type EntityKind = Literal["character", "location", "organization", "prop", "costume"]
type FactImportance = Literal["core", "supporting", "detail"]
type FactOrigin = Literal[
    "source_explicit_assertion",
    "source_interpretation",
    "user_decision",
    "ai_inference",
]
type CanonStatus = Literal["proposed", "confirmed", "contested", "rejected"]
type CanonCertainty = Literal["certain", "likely", "ambiguous", "intentionally_unreliable"]
type SourceReliability = Literal["reliable", "uncertain", "unreliable", "not_applicable"]
type StatePropertyKey = Literal[
    "holder",
    "wearer",
    "location",
    "condition",
    "possession",
    "relationship_status",
    "alive",
    "appearance",
]

_ENTITY_ID_PATTERN = r"^ent_[0-9a-f]{32}$"
_FACT_ID_PATTERN = r"^fact_[0-9a-f]{32}$"
_QUESTION_ID_PATTERN = r"^qst_[0-9a-f]{32}$"
_CONFLICT_ID_PATTERN = r"^cfl_[0-9a-f]{32}$"
_VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
_SOURCE_ID_PATTERN = r"^src_[0-9a-f]{32}$"
_SOURCE_BLOCK_ID_PATTERN = r"^srcb_[0-9a-f]{32}$"


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class SourceScopeDocumentV1(_StrictModel):
    source_document_id: str = Field(pattern=_SOURCE_ID_PATTERN)
    raw_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_block_ids: list[str] = Field(min_length=1)
    chapter_indices: list[int] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_scope_members(self) -> SourceScopeDocumentV1:
        if len(set(self.source_block_ids)) != len(self.source_block_ids):
            raise ValueError("Source scope block IDs must be unique")
        if any(not _matches_id(block_id, "srcb_") for block_id in self.source_block_ids):
            raise ValueError("Source scope contains an invalid block ID")
        if sorted(set(self.chapter_indices)) != self.chapter_indices or any(
            index < 1 for index in self.chapter_indices
        ):
            raise ValueError("Source scope chapters must be sorted unique positive integers")
        return self


class StorySourceScopeV1(_StrictModel):
    source_manifest_version_id: str = Field(pattern=_VERSION_ID_PATTERN)
    scope_type: Literal["full_work", "selected_range"]
    documents: list[SourceScopeDocumentV1] = Field(min_length=1)
    exclusions: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_documents(self) -> StorySourceScopeV1:
        document_ids = [document.source_document_id for document in self.documents]
        if len(set(document_ids)) != len(document_ids):
            raise ValueError("Source scope document IDs must be unique")
        if self.scope_type == "full_work" and self.exclusions:
            raise ValueError("A full-work source scope cannot contain exclusions")
        return self


class _EntityV1(_StrictModel):
    entity_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_names(self) -> _EntityV1:
        normalized_name = self.name.strip().casefold()
        if not normalized_name:
            raise ValueError("Entity name cannot be blank")
        normalized_aliases = [alias.strip().casefold() for alias in self.aliases]
        if any(not alias for alias in normalized_aliases):
            raise ValueError("Entity aliases cannot be blank")
        if len(set(normalized_aliases)) != len(normalized_aliases):
            raise ValueError("Entity aliases must be unique")
        if normalized_name in normalized_aliases:
            raise ValueError("Entity alias cannot duplicate its name")
        return self


class CharacterEntityV1(_EntityV1):
    kind: Literal["character"]


class LocationEntityV1(_EntityV1):
    kind: Literal["location"]


class OrganizationEntityV1(_EntityV1):
    kind: Literal["organization"]


class PropEntityV1(_EntityV1):
    kind: Literal["prop"]


class CostumeEntityV1(_EntityV1):
    kind: Literal["costume"]


StoryEntityV1 = Annotated[
    CharacterEntityV1 | LocationEntityV1 | OrganizationEntityV1 | PropEntityV1 | CostumeEntityV1,
    Field(discriminator="kind"),
]


class EventValidityV1(_StrictModel):
    starts_after_event_fact_id: str | None = Field(default=None, pattern=_FACT_ID_PATTERN)
    ends_after_event_fact_id: str | None = Field(default=None, pattern=_FACT_ID_PATTERN)


class TemporalRelationV1(_StrictModel):
    relation: Literal["before", "after", "simultaneous"]
    other_event_fact_id: str = Field(pattern=_FACT_ID_PATTERN)


class TextStateValueV1(_StrictModel):
    kind: Literal["text"]
    value: str = Field(min_length=1, max_length=500)


class EntityStateValueV1(_StrictModel):
    kind: Literal["entity_ref"]
    entity_id: str = Field(pattern=_ENTITY_ID_PATTERN)


class BooleanStateValueV1(_StrictModel):
    kind: Literal["boolean"]
    value: bool


class NumberStateValueV1(_StrictModel):
    kind: Literal["number"]
    value: float


StateValueV1 = Annotated[
    TextStateValueV1 | EntityStateValueV1 | BooleanStateValueV1 | NumberStateValueV1,
    Field(discriminator="kind"),
]


class StateChangeV1(_StrictModel):
    entity_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    property_key: StatePropertyKey
    before: StateValueV1 | None = None
    after: StateValueV1 | None = None

    @model_validator(mode="after")
    def validate_change(self) -> StateChangeV1:
        if self.before == self.after:
            raise ValueError("State change before and after values must differ")
        return self


class _FactV1(_StrictModel):
    fact_id: str = Field(pattern=_FACT_ID_PATTERN)
    importance: FactImportance
    origin: FactOrigin
    canon_status: CanonStatus
    extraction_confidence_bps: int | None = Field(default=None, ge=0, le=10000)
    canon_certainty: CanonCertainty
    viewpoint_entity_id: str | None = Field(default=None, pattern=_ENTITY_ID_PATTERN)
    source_reliability: SourceReliability
    decision_reason: str | None = Field(default=None, max_length=1000)
    impact_scope: list[str] = Field(default_factory=list, max_length=100)
    supersedes_fact_ids: list[str] = Field(default_factory=list, max_length=100)
    derived_from_fact_ids: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_provenance(self) -> _FactV1:
        if self.origin == "source_interpretation" and (
            self.viewpoint_entity_id is None or self.source_reliability == "not_applicable"
        ):
            raise ValueError("Source interpretations require viewpoint and reliability")
        if self.origin == "user_decision" and (
            not self.decision_reason or not self.decision_reason.strip() or not self.impact_scope
        ):
            raise ValueError("User decisions require a reason and impact scope")
        if self.origin == "user_decision" and self.extraction_confidence_bps is not None:
            raise ValueError("User decisions cannot carry extraction confidence")
        if self.fact_id in self.supersedes_fact_ids or self.fact_id in self.derived_from_fact_ids:
            raise ValueError("A fact cannot derive from or supersede itself")
        return self


class CharacterFactV1(_FactV1):
    kind: Literal["character_fact"]
    character_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    attribute: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=1000)
    validity: EventValidityV1 | None = None


class LocationFactV1(_FactV1):
    kind: Literal["location_fact"]
    location_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    attribute: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=1000)
    validity: EventValidityV1 | None = None


class RelationshipFactV1(_FactV1):
    kind: Literal["relationship_fact"]
    subject_entity_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    predicate: str = Field(min_length=1, max_length=120)
    object_entity_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    validity: EventValidityV1 | None = None


class EventFactV1(_FactV1):
    kind: Literal["event_fact"]
    participants: list[str] = Field(min_length=1, max_length=100)
    location_id: str | None = Field(default=None, pattern=_ENTITY_ID_PATTERN)
    source_narrative_order: int = Field(ge=0)
    story_time_order: int = Field(ge=0)
    temporal_relations: list[TemporalRelationV1] = Field(default_factory=list, max_length=100)
    caused_by_fact_ids: list[str] = Field(default_factory=list, max_length=100)
    state_changes: list[StateChangeV1] = Field(default_factory=list, max_length=100)


class WorldRuleFactV1(_FactV1):
    kind: Literal["world_rule_fact"]
    rule_scope: str = Field(min_length=1, max_length=120)
    rule: str = Field(min_length=1, max_length=1000)
    exceptions: list[str] = Field(default_factory=list, max_length=100)


class OrganizationFactV1(_FactV1):
    kind: Literal["organization_fact"]
    organization_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    attribute: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=1000)
    validity: EventValidityV1 | None = None


class PropFactV1(_FactV1):
    kind: Literal["prop_fact"]
    prop_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    property_key: Literal["holder", "location", "condition", "appearance"]
    value: StateValueV1 | None
    validity: EventValidityV1 | None = None


class CostumeFactV1(_FactV1):
    kind: Literal["costume_fact"]
    costume_id: str = Field(pattern=_ENTITY_ID_PATTERN)
    property_key: Literal["wearer", "location", "condition", "appearance"]
    value: StateValueV1 | None
    validity: EventValidityV1 | None = None


StoryFactV1 = Annotated[
    CharacterFactV1
    | LocationFactV1
    | RelationshipFactV1
    | EventFactV1
    | WorldRuleFactV1
    | OrganizationFactV1
    | PropFactV1
    | CostumeFactV1,
    Field(discriminator="kind"),
]


class StoryQuestionV1(_StrictModel):
    question_id: str = Field(pattern=_QUESTION_ID_PATTERN)
    scope_type: Literal["artifact", "entity", "fact", "source_document"]
    scope_id: str | None = None
    question: str = Field(min_length=1, max_length=1000)
    severity: Literal["blocking", "major", "minor", "note"]
    responsible_role: str = Field(min_length=1, max_length=80)
    blocking: bool
    status: Literal["open", "resolved"]
    resolution: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_resolution(self) -> StoryQuestionV1:
        if (self.status == "resolved") != bool(self.resolution and self.resolution.strip()):
            raise ValueError("Question resolution must match its status")
        return self


class FactConflictV1(_StrictModel):
    conflict_id: str = Field(pattern=_CONFLICT_ID_PATTERN)
    conflict_type: str = Field(min_length=1, max_length=120)
    fact_ids: list[str] = Field(min_length=2, max_length=100)
    severity: Literal["blocking", "major", "minor", "note"]
    responsible_role: str = Field(min_length=1, max_length=80)
    status: Literal["unresolved", "resolved_as_source_ambiguity", "resolved_by_user_decision"]
    resolution_reason: str | None = Field(default=None, max_length=1000)
    resolution_fact_id: str | None = Field(default=None, pattern=_FACT_ID_PATTERN)

    @model_validator(mode="after")
    def validate_resolution(self) -> FactConflictV1:
        if len(set(self.fact_ids)) != len(self.fact_ids):
            raise ValueError("Conflict fact IDs must be unique")
        if self.status == "unresolved" and (
            self.resolution_reason is not None or self.resolution_fact_id is not None
        ):
            raise ValueError("Unresolved conflict cannot contain a resolution")
        if self.status != "unresolved" and not (
            self.resolution_reason and self.resolution_reason.strip()
        ):
            raise ValueError("Resolved conflict requires a reason")
        if self.status == "resolved_as_source_ambiguity" and self.resolution_fact_id is not None:
            raise ValueError("Source ambiguity cannot select a resolution fact")
        if self.status == "resolved_by_user_decision" and self.resolution_fact_id is None:
            raise ValueError("User-resolved conflict requires a resolution fact")
        return self


class StoryBibleContentV1(_StrictModel):
    title: str = Field(min_length=1, max_length=120)
    logline: str = Field(min_length=1, max_length=500)
    source_scope: StorySourceScopeV1
    entities: list[StoryEntityV1] = Field(min_length=1, max_length=2000)
    facts: list[StoryFactV1] = Field(min_length=1, max_length=20000)
    questions: list[StoryQuestionV1] = Field(default_factory=list, max_length=2000)
    conflicts: list[FactConflictV1] = Field(default_factory=list, max_length=2000)

    @model_validator(mode="after")
    def validate_story_graph(self) -> StoryBibleContentV1:
        if not self.title.strip() or not self.logline.strip():
            raise ValueError("Story title and logline cannot be blank")
        entities = {entity.entity_id: entity for entity in self.entities}
        facts = {fact.fact_id: fact for fact in self.facts}
        if len(entities) != len(self.entities) or len(facts) != len(self.facts):
            raise ValueError("Story entity and fact IDs must be unique")
        display_keys = [(entity.kind, entity.name.strip().casefold()) for entity in self.entities]
        if len(set(display_keys)) != len(display_keys):
            raise ValueError("Story entities contain an obvious duplicate")
        self._validate_fact_references(entities, facts)
        self._validate_questions_and_conflicts(entities, facts)
        self._validate_event_graph(facts)
        self._validate_effective_canon(facts)
        return self

    @property
    def confirmed_claims(self) -> tuple[StoryFactV1, ...]:
        return tuple(fact for fact in self.facts if fact.canon_status == "confirmed")

    @property
    def effective_canon(self) -> tuple[StoryFactV1, ...]:
        ambiguous_fact_ids = {
            fact_id
            for conflict in self.conflicts
            if conflict.status == "resolved_as_source_ambiguity"
            for fact_id in conflict.fact_ids
        }
        return tuple(
            fact
            for fact in self.confirmed_claims
            if fact.canon_certainty != "intentionally_unreliable"
            and fact.source_reliability != "unreliable"
            and fact.fact_id not in ambiguous_fact_ids
        )

    def _validate_fact_references(
        self,
        entities: dict[str, StoryEntityV1],
        facts: dict[str, StoryFactV1],
    ) -> None:
        entity_kinds = {entity_id: entity.kind for entity_id, entity in entities.items()}

        def require_entity(entity_id: str, expected_kind: EntityKind | None = None) -> None:
            actual_kind = entity_kinds.get(entity_id)
            if actual_kind is None or (expected_kind is not None and actual_kind != expected_kind):
                raise ValueError("Fact contains a missing or type-incompatible entity reference")

        def require_state_value(
            value: StateValueV1 | None,
            expected_entity_kinds: tuple[EntityKind, ...] = (),
        ) -> None:
            if isinstance(value, EntityStateValueV1):
                actual_kind = entity_kinds.get(value.entity_id)
                if actual_kind is None or (
                    expected_entity_kinds and actual_kind not in expected_entity_kinds
                ):
                    raise ValueError(
                        "State value contains a missing or type-incompatible entity reference"
                    )

        def require_state_contract(
            entity_id: str,
            property_key: StatePropertyKey,
            *values: StateValueV1 | None,
        ) -> None:
            subject_kinds: dict[StatePropertyKey, tuple[EntityKind, ...]] = {
                "holder": ("prop",),
                "wearer": ("costume",),
                "location": ("character", "prop", "costume"),
                "condition": ("character", "prop", "costume"),
                "possession": ("character",),
                "relationship_status": ("character",),
                "alive": ("character",),
                "appearance": ("character", "location", "prop", "costume"),
            }
            value_types: dict[StatePropertyKey, type[_StrictModel]] = {
                "holder": EntityStateValueV1,
                "wearer": EntityStateValueV1,
                "location": EntityStateValueV1,
                "condition": TextStateValueV1,
                "possession": EntityStateValueV1,
                "relationship_status": TextStateValueV1,
                "alive": BooleanStateValueV1,
                "appearance": TextStateValueV1,
            }
            target_kinds: dict[StatePropertyKey, tuple[EntityKind, ...]] = {
                "holder": ("character",),
                "wearer": ("character",),
                "location": ("location",),
                "condition": (),
                "possession": ("prop", "costume"),
                "relationship_status": (),
                "alive": (),
                "appearance": (),
            }
            actual_subject_kind = entity_kinds.get(entity_id)
            if actual_subject_kind not in subject_kinds[property_key]:
                raise ValueError("State property is incompatible with its subject entity")
            for value in values:
                if value is None:
                    continue
                if not isinstance(value, value_types[property_key]):
                    raise ValueError("State property contains an incompatible value kind")
                require_state_value(value, target_kinds[property_key])

        for fact in self.facts:
            if fact.viewpoint_entity_id is not None:
                require_entity(fact.viewpoint_entity_id, "character")
            for referenced_fact_id in fact.supersedes_fact_ids + fact.derived_from_fact_ids:
                if referenced_fact_id not in facts:
                    raise ValueError("Fact lineage contains a missing fact reference")
            if isinstance(fact, CharacterFactV1):
                require_entity(fact.character_id, "character")
            elif isinstance(fact, LocationFactV1):
                require_entity(fact.location_id, "location")
            elif isinstance(fact, RelationshipFactV1):
                require_entity(fact.subject_entity_id)
                require_entity(fact.object_entity_id)
                if fact.subject_entity_id == fact.object_entity_id:
                    raise ValueError("Relationship endpoints must differ")
            elif isinstance(fact, EventFactV1):
                for participant_id in fact.participants:
                    require_entity(participant_id)
                if len(set(fact.participants)) != len(fact.participants):
                    raise ValueError("Event participants must be unique")
                if fact.location_id is not None:
                    require_entity(fact.location_id, "location")
                for change in fact.state_changes:
                    require_state_contract(
                        change.entity_id,
                        change.property_key,
                        change.before,
                        change.after,
                    )
            elif isinstance(fact, OrganizationFactV1):
                require_entity(fact.organization_id, "organization")
            elif isinstance(fact, PropFactV1):
                require_entity(fact.prop_id, "prop")
                require_state_contract(fact.prop_id, fact.property_key, fact.value)
            elif isinstance(fact, CostumeFactV1):
                require_entity(fact.costume_id, "costume")
                require_state_contract(fact.costume_id, fact.property_key, fact.value)
            validity = getattr(fact, "validity", None)
            if isinstance(validity, EventValidityV1):
                validity_events: list[EventFactV1] = []
                for event_id in (
                    validity.starts_after_event_fact_id,
                    validity.ends_after_event_fact_id,
                ):
                    if event_id is not None and not isinstance(facts.get(event_id), EventFactV1):
                        raise ValueError("Fact validity must reference an event fact")
                    if event_id is not None:
                        validity_events.append(cast(EventFactV1, facts[event_id]))
                if (
                    len(validity_events) == 2
                    and validity_events[0].story_time_order > validity_events[1].story_time_order
                ):
                    raise ValueError("Fact validity starts after it ends")

    def _validate_questions_and_conflicts(
        self,
        entities: dict[str, StoryEntityV1],
        facts: dict[str, StoryFactV1],
    ) -> None:
        if len({question.question_id for question in self.questions}) != len(self.questions):
            raise ValueError("Story question IDs must be unique")
        if len({conflict.conflict_id for conflict in self.conflicts}) != len(self.conflicts):
            raise ValueError("Story conflict IDs must be unique")
        for question in self.questions:
            if question.scope_type == "entity" and question.scope_id not in entities:
                raise ValueError("Question contains a missing entity scope")
            if question.scope_type == "fact" and question.scope_id not in facts:
                raise ValueError("Question contains a missing fact scope")
        for conflict in self.conflicts:
            if any(fact_id not in facts for fact_id in conflict.fact_ids):
                raise ValueError("Conflict contains a missing fact reference")
            if conflict.resolution_fact_id is not None:
                resolution = facts.get(conflict.resolution_fact_id)
                if (
                    resolution is None
                    or resolution.origin != "user_decision"
                    or resolution.canon_status != "confirmed"
                ):
                    raise ValueError("Conflict resolution must be a confirmed user decision")
                covered_fact_ids = set(
                    resolution.supersedes_fact_ids + resolution.derived_from_fact_ids
                )
                if not set(conflict.fact_ids) <= covered_fact_ids:
                    raise ValueError(
                        "Conflict resolution lineage must cover every conflicting fact"
                    )
                confirmed_candidates = sum(
                    facts[fact_id].canon_status == "confirmed" for fact_id in conflict.fact_ids
                )
                if confirmed_candidates > 1:
                    raise ValueError(
                        "Resolved conflict cannot retain multiple confirmed candidates"
                    )

    def _validate_event_graph(self, facts: dict[str, StoryFactV1]) -> None:
        event_ids = {fact_id for fact_id, fact in facts.items() if isinstance(fact, EventFactV1)}
        edges: dict[str, set[str]] = defaultdict(set)
        state_at_time: dict[tuple[int, str, str], set[str]] = defaultdict(set)
        for event_id in event_ids:
            event = facts[event_id]
            if not isinstance(event, EventFactV1):  # pragma: no cover - narrowed above
                continue
            for cause_id in event.caused_by_fact_ids:
                if cause_id not in event_ids:
                    raise ValueError("Event cause must reference an event fact")
                cause = facts[cause_id]
                if not isinstance(cause, EventFactV1):  # pragma: no cover - checked above
                    continue
                if cause.story_time_order >= event.story_time_order:
                    raise ValueError("Event cause must occur before its effect")
                edges[cause_id].add(event_id)
            for relation in event.temporal_relations:
                if relation.other_event_fact_id not in event_ids:
                    raise ValueError("Temporal relation must reference an event fact")
                other_event = facts[relation.other_event_fact_id]
                if not isinstance(other_event, EventFactV1):  # pragma: no cover - checked above
                    continue
                if relation.relation == "before":
                    if event.story_time_order >= other_event.story_time_order:
                        raise ValueError("Event before relation contradicts story time order")
                    edges[event_id].add(relation.other_event_fact_id)
                elif relation.relation == "after":
                    if event.story_time_order <= other_event.story_time_order:
                        raise ValueError("Event after relation contradicts story time order")
                    edges[relation.other_event_fact_id].add(event_id)
                elif event.story_time_order != other_event.story_time_order:
                    raise ValueError("Simultaneous events must share story time order")
            for change in event.state_changes:
                state_at_time[(event.story_time_order, change.entity_id, change.property_key)].add(
                    repr(change.after.model_dump(mode="json") if change.after else None)
                )
        if any(len(values) > 1 for values in state_at_time.values()):
            raise ValueError("Story events contain conflicting state at the same story time")
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(event_id: str) -> None:
            if event_id in visiting:
                raise ValueError("Story event cause or time graph contains a cycle")
            if event_id in visited:
                return
            visiting.add(event_id)
            for downstream_id in edges[event_id]:
                visit(downstream_id)
            visiting.remove(event_id)
            visited.add(event_id)

        for event_id in event_ids:
            visit(event_id)

        effective_event_ids = {
            fact.fact_id for fact in self.effective_canon if isinstance(fact, EventFactV1)
        }
        baseline_states: list[
            tuple[str, StatePropertyKey, StateValueV1 | None, int | None, int | None]
        ] = []
        for fact in self.effective_canon:
            if not isinstance(fact, PropFactV1 | CostumeFactV1):
                continue
            entity_id = fact.prop_id if isinstance(fact, PropFactV1) else fact.costume_id
            validity = fact.validity
            start = (
                cast(EventFactV1, facts[validity.starts_after_event_fact_id]).story_time_order
                if validity is not None and validity.starts_after_event_fact_id is not None
                else None
            )
            end = (
                cast(EventFactV1, facts[validity.ends_after_event_fact_id]).story_time_order
                if validity is not None and validity.ends_after_event_fact_id is not None
                else None
            )
            if start is not None and end is not None and start == end:
                raise ValueError("State fact validity must cover a positive story-time interval")
            baseline_states.append((entity_id, fact.property_key, fact.value, start, end))

        for index, baseline in enumerate(baseline_states):
            entity_id, property_key, value, start, end = baseline
            for other in baseline_states[index + 1 :]:
                other_entity_id, other_property_key, other_value, other_start, other_end = other
                if (entity_id, property_key) != (other_entity_id, other_property_key):
                    continue
                latest_start = max(
                    start if start is not None else float("-inf"),
                    other_start if other_start is not None else float("-inf"),
                )
                earliest_end = min(
                    end if end is not None else float("inf"),
                    other_end if other_end is not None else float("inf"),
                )
                if latest_start < earliest_end and value != other_value:
                    raise ValueError(
                        "Effective state facts contain overlapping contradictory values"
                    )

        previous_state: dict[tuple[str, str], StateValueV1 | None] = {}
        effective_events = sorted(
            (cast(EventFactV1, facts[event_id]) for event_id in effective_event_ids),
            key=lambda event: (event.story_time_order, event.source_narrative_order, event.fact_id),
        )
        for event in effective_events:
            for change in event.state_changes:
                key = (change.entity_id, change.property_key)
                if key in previous_state and change.before != previous_state[key]:
                    raise ValueError("Story state change does not continue from prior state")
                for entity_id, property_key, value, start, end in baseline_states:
                    if key != (entity_id, property_key):
                        continue
                    if start is not None and event.story_time_order < start:
                        continue
                    if end is not None and event.story_time_order > end:
                        continue
                    at_start = start is not None and event.story_time_order == start
                    at_end = end is not None and event.story_time_order == end
                    if at_start:
                        contradicts_baseline = change.after != value
                    elif at_end:
                        contradicts_baseline = change.before != value
                    else:
                        contradicts_baseline = change.before != value or change.after != value
                    if contradicts_baseline:
                        raise ValueError("Event state change contradicts an effective state fact")
                previous_state[key] = change.after

    def _validate_effective_canon(self, facts: dict[str, StoryFactV1]) -> None:
        effective_ids = {fact.fact_id for fact in self.effective_canon}
        for fact in self.effective_canon:
            validity = getattr(fact, "validity", None)
            if isinstance(validity, EventValidityV1):
                for event_id in (
                    validity.starts_after_event_fact_id,
                    validity.ends_after_event_fact_id,
                ):
                    if event_id is not None and event_id not in effective_ids:
                        raise ValueError("Effective canon validity references a non-canon event")
            if isinstance(fact, EventFactV1):
                operational_ids = [
                    *fact.caused_by_fact_ids,
                    *(relation.other_event_fact_id for relation in fact.temporal_relations),
                ]
                if any(event_id not in effective_ids for event_id in operational_ids):
                    raise ValueError("Effective canon event references a non-canon event")


def _matches_id(value: str, prefix: str) -> bool:
    return (
        value.startswith(prefix)
        and len(value) == len(prefix) + 32
        and all(character in "0123456789abcdef" for character in value[len(prefix) :])
    )
