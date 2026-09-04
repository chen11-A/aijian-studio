"""Closed development-only contract for an eight-shot outline proposal."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.agent_skill_contracts import ArtifactProposalV1, ProposalClaimV1, canonical_sha256

type ClaimId = Annotated[str, Field(pattern=r"^clm_[0-9a-f]{32}$")]
type SpanId = Annotated[str, Field(pattern=r"^spn_[0-9a-f]{32}$")]


class ShotOutlineShotV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, revalidate_instances="always")

    shot_id: str = Field(pattern=r"^sht_[0-9a-f]{32}$")
    ordinal: int = Field(ge=1, le=8)
    duration_ms: int = Field(ge=1000, le=30000)
    visual_claim_ids: list[ClaimId] = Field(min_length=1, max_length=16)
    audio_claim_ids: list[ClaimId] = Field(max_length=8)
    camera_claim_ids: list[ClaimId] = Field(max_length=8)

    @model_validator(mode="after")
    def validate_references(self) -> "ShotOutlineShotV1":
        for values in (self.visual_claim_ids, self.audio_claim_ids, self.camera_claim_ids):
            if len(values) != len(set(values)):
                raise ValueError("shot claim references must be unique")
        return self


class ShotOutlineClaimV1(ProposalClaimV1):
    model_config = ConfigDict(extra="forbid", strict=True, revalidate_instances="always")
    source_span_ids: tuple[SpanId, ...] = Field(max_length=100)

    @field_validator("source_span_ids", mode="before")
    @classmethod
    def accept_json_span_array(cls, value: object) -> object:
        # Preserve the inherited tuple contract while accepting bounded JSON arrays.
        if isinstance(value, list):
            if len(value) > 100:
                raise ValueError("claim source spans exceed 100")
            return tuple(value)
        return value

    @model_validator(mode="after")
    def validate_text(self) -> "ShotOutlineClaimV1":
        if not self.text.strip():
            raise ValueError("claim text must not be blank")
        if len(self.source_span_ids) != len(set(self.source_span_ids)):
            raise ValueError("claim source spans must be unique")
        if not self.invented and not self.source_span_ids:
            raise ValueError("factual claim must reference SourceSpan evidence")
        return self


class ShotOutlinePayloadV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, revalidate_instances="always")

    schema_version: Literal["1.0.0"]
    purpose: Literal["DEVELOPMENT_FAKE_ONLY"]
    claims: list[ShotOutlineClaimV1] = Field(min_length=1, max_length=256)
    shots: list[ShotOutlineShotV1] = Field(min_length=8, max_length=8)

    @model_validator(mode="after")
    def validate_outline(self) -> "ShotOutlinePayloadV1":
        if [shot.ordinal for shot in self.shots] != list(range(1, 9)):
            raise ValueError("shots must be ordered from ordinal 1 through 8")
        if len({shot.shot_id for shot in self.shots}) != 8:
            raise ValueError("shot ids must be unique")
        claim_ids = [claim.claim_id for claim in self.claims]
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("payload claim ids must be unique")
        used = {
            claim_id
            for shot in self.shots
            for claim_id in shot.visual_claim_ids + shot.audio_claim_ids + shot.camera_claim_ids
        }
        if used != set(claim_ids):
            raise ValueError("shots must reference every and only payload claims")
        claims = {claim.claim_id: claim for claim in self.claims}
        if any(
            not claims[claim_id].invented
            for shot in self.shots
            for claim_id in shot.camera_claim_ids
        ):
            raise ValueError("camera claims must be invented")
        if any(
            not any(claims[claim_id].source_span_ids for claim_id in shot.visual_claim_ids)
            for shot in self.shots
        ):
            raise ValueError("each shot needs source-grounded visual evidence")
        if not any(not claim.invented for claim in self.claims):
            raise ValueError("outline must use at least one sourced factual claim")
        return self


def validate_shot_outline_proposal(proposal: ArtifactProposalV1) -> ShotOutlinePayloadV1:
    """Validate structure, not actual source bytes or human acceptance, without I/O."""

    raw = proposal.model_dump(mode="python", warnings=False)
    proposal = ArtifactProposalV1.model_validate(raw)
    if len({span.source_span_id for span in proposal.source_spans}) != len(proposal.source_spans):
        raise ValueError("duplicate proposal source span ids")
    if len({claim.claim_id for claim in proposal.claims}) != len(proposal.claims):
        raise ValueError("duplicate proposal claim ids")
    if proposal.target_artifact_type != "ShotOutline":
        raise ValueError("proposal target must be ShotOutline")
    if (
        len(proposal.dependencies) != 1
        or proposal.dependencies[0].artifact_type != "SourceManifest"
        or raw["dependencies"][0]["approval_required"] is not True
    ):
        raise ValueError("proposal requires one approved SourceManifest dependency")
    payload = ShotOutlinePayloadV1.model_validate(proposal.payload)
    if canonical_sha256(payload.model_dump(mode="json")) != proposal.payload_hash:
        raise ValueError("payload hash does not match strict shot outline payload")
    # Validate original fields, before the shared envelope could coerce a bool/text.
    envelope_claims = [ShotOutlineClaimV1.model_validate(claim) for claim in raw["claims"]]
    if canonical_sha256([claim.model_dump(mode="json") for claim in payload.claims]) != (
        canonical_sha256([claim.model_dump(mode="json") for claim in envelope_claims])
    ):
        raise ValueError("payload claims must exactly match proposal claims")
    return payload
