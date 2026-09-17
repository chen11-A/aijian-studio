"""Immutable, structural content contract for a proposed production brief."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

from aijian_api.media_contracts import JSON_SAFE_INTEGER_MAX, PositiveRationalData

StrictText = Annotated[StrictStr, Field(min_length=1, max_length=4_000)]
ShortText = Annotated[StrictStr, Field(min_length=1, max_length=240)]
NonNegativeSafeInt = Annotated[StrictInt, Field(ge=0, le=JSON_SAFE_INTEGER_MAX)]
SourceDocumentId = Annotated[StrictStr, Field(pattern=r"^src_[0-9a-f]{32}$")]
SourceBlockId = Annotated[StrictStr, Field(pattern=r"^srcb_[0-9a-f]{32}$")]
SourceManifestVersionId = Annotated[StrictStr, Field(pattern=r"^ver_[0-9a-f]{32}$")]
CurrencyCode = Annotated[StrictStr, Field(pattern=r"^[A-Z]{3}$")]


class _StrictContract(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        revalidate_instances="always",
        allow_inf_nan=False,
    )


def _as_tuple(value: object) -> object:
    return tuple(value) if isinstance(value, list) else value


class ReferenceDeclarationV1(_StrictContract):
    reference_kind: Literal["inspiration", "research", "other"]
    description: StrictText

    @field_validator("description")
    @classmethod
    def require_nonblank_description(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reference description cannot be blank")
        return value


class OriginalIdeaEntryV1(_StrictContract):
    kind: Literal["original_idea"]
    origin_statement: StrictText
    references: tuple[ReferenceDeclarationV1, ...] = Field(default=(), max_length=32)

    @field_validator("references", mode="before")
    @classmethod
    def accept_json_references_as_tuples(cls, value: object) -> object:
        return _as_tuple(value)

    @field_validator("origin_statement")
    @classmethod
    def require_nonblank_origin_statement(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("origin statement cannot be blank")
        return value

    @model_validator(mode="after")
    def require_unique_reference_pairs(self) -> Self:
        identities = {
            (reference.reference_kind, reference.description) for reference in self.references
        }
        if len(identities) != len(self.references):
            raise ValueError("reference kind and description pairs must be unique")
        return self


class SourceAdaptationEntryV1(_StrictContract):
    kind: Literal["source_adaptation"]
    adaptation_statement: StrictText
    source_document_id: SourceDocumentId
    source_manifest_version_id: SourceManifestVersionId
    source_block_ids: tuple[SourceBlockId, ...] = Field(min_length=1, max_length=100)

    @field_validator("source_block_ids", mode="before")
    @classmethod
    def accept_json_source_blocks_as_tuples(cls, value: object) -> object:
        return _as_tuple(value)

    @field_validator("adaptation_statement")
    @classmethod
    def require_nonblank_adaptation_statement(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("adaptation statement cannot be blank")
        return value

    @model_validator(mode="after")
    def require_unique_source_blocks(self) -> Self:
        if len(set(self.source_block_ids)) != len(self.source_block_ids):
            raise ValueError("source block IDs must be unique")
        return self


CreativeEntryV1 = Annotated[
    OriginalIdeaEntryV1 | SourceAdaptationEntryV1,
    Field(discriminator="kind"),
]


class CreativeDirectionV1(_StrictContract):
    premise: StrictText
    intent: StrictText
    audience: ShortText | None = None
    genre: ShortText | None = None
    style: ShortText | None = None
    constraints: tuple[ShortText, ...] = Field(default=(), max_length=32)

    @field_validator("constraints", mode="before")
    @classmethod
    def accept_json_constraints_as_tuples(cls, value: object) -> object:
        return _as_tuple(value)

    @field_validator("premise", "intent", "audience", "genre", "style")
    @classmethod
    def require_nonblank_text_when_present(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("creative text cannot be blank")
        return value

    @model_validator(mode="after")
    def require_unique_constraints(self) -> Self:
        if len(set(self.constraints)) != len(self.constraints):
            raise ValueError("constraints must be unique by exact text")
        if any(not constraint.strip() for constraint in self.constraints):
            raise ValueError("constraints cannot be blank")
        return self


class DeliveryIntentV1(_StrictContract):
    language: StrictText
    display_aspect_ratio: PositiveRationalData
    width_px: NonNegativeSafeInt
    height_px: NonNegativeSafeInt
    frame_rate: PositiveRationalData

    @field_validator("language")
    @classmethod
    def require_nonblank_language(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("delivery language cannot be blank")
        return value

    @model_validator(mode="after")
    def require_consistent_dimensions_and_rationals(self) -> Self:
        aspect = PositiveRationalData.model_validate(
            self.display_aspect_ratio.model_dump(mode="python")
        )
        frame_rate = PositiveRationalData.model_validate(self.frame_rate.model_dump(mode="python"))
        object.__setattr__(self, "display_aspect_ratio", aspect)
        object.__setattr__(self, "frame_rate", frame_rate)
        if self.width_px <= 0 or self.height_px <= 0:
            raise ValueError("delivery dimensions must be positive")
        if self.width_px * aspect.den != self.height_px * aspect.num:
            raise ValueError("delivery dimensions must match the declared aspect ratio")
        return self


class DurationIntentV1(_StrictContract):
    work_seconds: NonNegativeSafeInt | None
    episode_mode: Literal["unspecified", "per_episode"]
    episode_seconds: NonNegativeSafeInt | None

    @model_validator(mode="after")
    def require_duration_relation(self) -> Self:
        if self.work_seconds == 0:
            raise ValueError("a supplied work duration must be positive")
        if self.episode_mode == "unspecified" and self.episode_seconds is not None:
            raise ValueError("unspecified episode mode requires a null episode duration")
        if self.episode_mode == "per_episode" and not self.episode_seconds:
            raise ValueError("per-episode mode requires a positive episode duration")
        return self


class BudgetIntentV1(_StrictContract):
    state: Literal["unknown", "declared"]
    currency: CurrencyCode | None
    amount_micros: NonNegativeSafeInt | None

    @model_validator(mode="after")
    def require_budget_relation(self) -> Self:
        has_declaration = self.currency is not None and self.amount_micros is not None
        if self.state == "unknown" and has_declaration:
            raise ValueError("unknown budget requires null declaration values")
        if self.state == "unknown" and (
            self.currency is not None or self.amount_micros is not None
        ):
            raise ValueError("unknown budget requires null declaration values")
        if self.state == "declared" and not has_declaration:
            raise ValueError("declared budget requires currency and amount")
        return self


class RightsDeclarationV1(_StrictContract):
    state: Literal["unknown", "user_declared"]
    statement: StrictText | None

    @field_validator("statement")
    @classmethod
    def require_nonblank_statement_when_present(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("rights statement cannot be blank")
        return value

    @model_validator(mode="after")
    def require_rights_relation(self) -> Self:
        if (self.state == "user_declared") != (self.statement is not None):
            raise ValueError("rights declaration state must match its statement")
        return self


class ProductionBriefContentV1(_StrictContract):
    """Structural user input that confers no approval, ownership, or spending authority."""

    schema_version: Literal["1.0.0"] = "1.0.0"
    creative_entry: CreativeEntryV1
    creative: CreativeDirectionV1
    delivery: DeliveryIntentV1
    duration_intent: DurationIntentV1
    budget_intent: BudgetIntentV1
    rights_declaration: RightsDeclarationV1
