"""Pure EpisodeStory source-evidence content contracts without persistence authority."""

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

MAX_CLAIMS = 1_000
MAX_CLAIM_TEXT_CODE_POINTS = 20_000
MAX_EVIDENCE_REFS_PER_CLAIM = 100
MAX_STORY_BIBLE_FACT_REFS_PER_CLAIM = 100
MAX_EVIDENCE_EXPLANATION_CODE_POINTS = 1_000

ProjectId = Annotated[StrictStr, Field(pattern=r"^prj_[0-9a-f]{32}$")]
EpisodeId = Annotated[StrictStr, Field(pattern=r"^ep_(?:prj_)?[0-9a-f]{32}$")]
VersionId = Annotated[StrictStr, Field(pattern=r"^ver_[0-9a-f]{32}$")]
SourceDocumentId = Annotated[StrictStr, Field(pattern=r"^src_[0-9a-f]{32}$")]
SourceBlockId = Annotated[StrictStr, Field(pattern=r"^srcb_[0-9a-f]{32}$")]
FactId = Annotated[StrictStr, Field(pattern=r"^fact_[0-9a-f]{32}$")]
EpisodeStoryClaimId = Annotated[StrictStr, Field(pattern=r"^ecl_[0-9a-f]{32}$")]
PositiveOrdinal = Annotated[StrictInt, Field(ge=1, le=MAX_CLAIMS)]
NonNegativeByteOffset = Annotated[StrictInt, Field(ge=0)]

ClaimOrigin = Literal[
    "source_explicit_assertion",
    "source_interpretation",
    "user_decision",
    "ai_inference",
]
SourceSpanRole = Literal["supports", "contradicts", "context"]


class _StrictContract(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
        revalidate_instances="always",
        allow_inf_nan=False,
    )


class EpisodeStoryEvidenceRefV1(_StrictContract):
    """A structural source-span draft; persisted bytes and quote hashes are checked later."""

    claim_id: EpisodeStoryClaimId
    source_document_id: SourceDocumentId
    source_block_id: SourceBlockId
    start_byte: NonNegativeByteOffset
    end_byte: NonNegativeByteOffset
    role: SourceSpanRole
    claim: Annotated[
        StrictStr,
        Field(min_length=1, max_length=MAX_EVIDENCE_EXPLANATION_CODE_POINTS),
    ]

    @field_validator("claim")
    @classmethod
    def require_nonblank_explanation(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Source evidence claim explanation cannot be blank")
        return value

    @model_validator(mode="after")
    def require_nonempty_range(self) -> Self:
        if self.end_byte <= self.start_byte:
            raise ValueError("Source evidence end_byte must be greater than start_byte")
        return self


class EpisodeStoryClaimV1(_StrictContract):
    claim_id: EpisodeStoryClaimId
    ordinal: PositiveOrdinal
    text: Annotated[StrictStr, Field(min_length=1, max_length=MAX_CLAIM_TEXT_CODE_POINTS)]
    origin: ClaimOrigin
    evidence_refs: tuple[EpisodeStoryEvidenceRefV1, ...] = Field(
        default=(), max_length=MAX_EVIDENCE_REFS_PER_CLAIM
    )
    story_bible_fact_ids: tuple[FactId, ...] = Field(
        default=(), max_length=MAX_STORY_BIBLE_FACT_REFS_PER_CLAIM
    )

    @field_validator("evidence_refs", "story_bible_fact_ids", mode="before")
    @classmethod
    def accept_json_arrays_as_immutable_tuples(cls, value: object) -> object:
        if isinstance(value, list):
            return tuple(value)
        return value

    @field_validator("text")
    @classmethod
    def require_nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("EpisodeStory claim text cannot be blank")
        return value

    @model_validator(mode="after")
    def validate_claim_references(self) -> Self:
        if len(set(self.story_bible_fact_ids)) != len(self.story_bible_fact_ids):
            raise ValueError("StoryBible fact references must be unique within a claim")
        evidence_identity = {
            (
                reference.claim_id,
                reference.source_document_id,
                reference.source_block_id,
                reference.start_byte,
                reference.end_byte,
                reference.role,
            )
            for reference in self.evidence_refs
        }
        if len(evidence_identity) != len(self.evidence_refs):
            raise ValueError("Source evidence references must be unique within a claim")
        if any(reference.claim_id != self.claim_id for reference in self.evidence_refs):
            raise ValueError("Source evidence claim_id must match its parent claim")
        supports_evidence = any(reference.role == "supports" for reference in self.evidence_refs)
        if self.origin in {
            "source_explicit_assertion",
            "source_interpretation",
            "ai_inference",
        }:
            if not supports_evidence:
                raise ValueError("Source-derived and inference claims require supports evidence")
            if self.story_bible_fact_ids:
                raise ValueError("Only user-decision claims may reference StoryBible facts")
        else:
            if self.evidence_refs:
                raise ValueError("User-decision claims cannot carry source evidence")
            if not self.story_bible_fact_ids:
                raise ValueError("User-decision claims require a StoryBible fact reference")
        return self


class EpisodeStoryContentV1(_StrictContract):
    """A candidate EpisodeStory content payload; it does not assert external truth or approval."""

    schema_version: Literal["1.0.0"]
    project_id: ProjectId
    episode_id: EpisodeId
    source_manifest_version_id: VersionId
    story_bible_version_id: VersionId | None = None
    claims: tuple[EpisodeStoryClaimV1, ...] = Field(min_length=1, max_length=MAX_CLAIMS)

    @field_validator("claims", mode="before")
    @classmethod
    def accept_json_claim_arrays_as_immutable_tuples(cls, value: object) -> object:
        if isinstance(value, list):
            return tuple(value)
        return value

    @model_validator(mode="after")
    def validate_content_references(self) -> Self:
        claim_ids = [claim.claim_id for claim in self.claims]
        if len(set(claim_ids)) != len(claim_ids):
            raise ValueError("EpisodeStory claim IDs must be unique")
        if [claim.ordinal for claim in self.claims] != list(range(1, len(self.claims) + 1)):
            raise ValueError("EpisodeStory claim ordinals must be contiguous from 1")
        if self.story_bible_version_id is None and any(
            claim.origin == "user_decision" for claim in self.claims
        ):
            raise ValueError("User-decision claims require a StoryBible version reference")
        return self
