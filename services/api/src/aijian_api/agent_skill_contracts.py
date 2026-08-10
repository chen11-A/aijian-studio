"""Closed, versioned contracts for the provider-free Agent/Skill foundation."""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SEMVER_PATTERN = r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"
CONTENT_HASH_PATTERN = r"^sha256:[0-9a-f]{64}$"
PROJECT_ID_PATTERN = r"^prj_[0-9a-f]{32}$"
SOURCE_ID_PATTERN = r"^src_[0-9a-f]{32}$"
SOURCE_BLOCK_ID_PATTERN = r"^srcb_[0-9a-f]{32}$"
VERSION_ID_PATTERN = r"^ver_[0-9a-f]{32}$"
AGENT_RUN_ID_PATTERN = r"^agr_[0-9a-f]{32}$"
SKILL_RUN_ID_PATTERN = r"^skr_[0-9a-f]{32}$"
CONTEXT_ID_PATTERN = r"^ctx_[0-9a-f]{32}$"
PROPOSAL_ID_PATTERN = r"^prp_[0-9a-f]{32}$"
ATTEMPT_ID_PATTERN = r"^att_[0-9a-f]{32}$"
DEFINITION_ID_PATTERN = r"^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$"
ARTIFACT_TYPE_PATTERN = r"^[A-Z][A-Za-z0-9]{1,79}$"
PROVIDER_CAPABILITY_PATTERN = r"^[A-Z][A-Z0-9_]{1,79}$"
INVALIDATION_EDGE_PATTERN = r"^[A-Z][A-Za-z0-9]{1,79}->[A-Z][A-Za-z0-9]{1,79}$"

type DefinitionId = Annotated[str, Field(pattern=DEFINITION_ID_PATTERN)]
type ArtifactType = Annotated[str, Field(pattern=ARTIFACT_TYPE_PATTERN)]
type ProviderCapability = Annotated[str, Field(pattern=PROVIDER_CAPABILITY_PATTERN)]
type InvalidationEdge = Annotated[str, Field(pattern=INVALIDATION_EDGE_PATTERN)]


def canonical_sha256(value: object) -> str:
    """Hash JSON-compatible content with the repository's canonical encoding."""

    payload = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DefinitionRefV1(ClosedModel):
    definition_id: DefinitionId
    version: str = Field(pattern=SEMVER_PATTERN)


class ContractCompatibilityV1(ClosedModel):
    minimum_schema_version: str = Field(pattern=SEMVER_PATTERN)
    maximum_schema_version: str = Field(pattern=SEMVER_PATTERN)


class BudgetPolicyV1(ClosedModel):
    currency: Literal["USD"] = "USD"
    soft_limit_micros: int = Field(strict=True, ge=0)
    hard_limit_micros: int = Field(strict=True, ge=0)
    retry_increment_limit_micros: int = Field(strict=True, ge=0)

    @model_validator(mode="after")
    def validate_limits(self) -> BudgetPolicyV1:
        if self.soft_limit_micros > self.hard_limit_micros:
            raise ValueError("soft budget cannot exceed hard budget")
        if self.retry_increment_limit_micros > self.hard_limit_micros:
            raise ValueError("retry increment cannot exceed hard budget")
        return self


class AgentDefinitionV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    agent_definition_id: DefinitionId
    version: str = Field(pattern=SEMVER_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    role: DefinitionId
    layer: Literal["DECISION", "EXECUTION", "SUPERVISION"]
    responsibilities: tuple[str, ...] = Field(min_length=1, max_length=32)
    forbidden_actions: tuple[str, ...] = Field(min_length=1, max_length=32)
    skill_refs: tuple[DefinitionRefV1, ...] = Field(min_length=1, max_length=64)
    default_policy_version: str = Field(min_length=1, max_length=120)
    context_policy_version: str = Field(min_length=1, max_length=120)
    compatibility: ContractCompatibilityV1


class SkillDefinitionV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    skill_definition_id: DefinitionId
    version: str = Field(pattern=SEMVER_PATTERN)
    display_name: str = Field(min_length=1, max_length=80)
    input_schema_ref: str = Field(min_length=1, max_length=240)
    output_schema_ref: str = Field(min_length=1, max_length=240)
    readable_artifact_types: tuple[ArtifactType, ...] = Field(max_length=64)
    allowed_tools: tuple[DefinitionId, ...] = Field(max_length=64)
    allowed_provider_capabilities: tuple[ProviderCapability, ...] = Field(max_length=32)
    budget: BudgetPolicyV1
    timeout_seconds: int = Field(strict=True, ge=1, le=86_400)
    max_attempts: int = Field(strict=True, ge=1, le=2)
    required_gate: str = Field(pattern=r"^G[0-8](?:[A-Z])?$")
    invalidation_edges: tuple[InvalidationEdge, ...] = Field(max_length=64)
    ui_renderer: DefinitionId
    fixture_refs: tuple[str, ...] = Field(min_length=1, max_length=64)
    compatibility: ContractCompatibilityV1


type ContextEntryKind = Literal[
    "ROLE_INVARIANTS",
    "SKILL_INSTRUCTIONS",
    "APPROVED_ARTIFACT",
    "SOURCE_SPAN",
    "TASK_OUTPUT_SCHEMA",
]
type ContextTrustLevel = Literal[
    "SYSTEM_INSTRUCTION",
    "APPROVED_ARTIFACT",
    "UNTRUSTED_CONTENT",
]

_CONTEXT_ORDER: dict[ContextEntryKind, int] = {
    "ROLE_INVARIANTS": 0,
    "SKILL_INSTRUCTIONS": 1,
    "APPROVED_ARTIFACT": 2,
    "SOURCE_SPAN": 3,
    "TASK_OUTPUT_SCHEMA": 4,
}
_CONTEXT_TRUST: dict[ContextEntryKind, ContextTrustLevel] = {
    "ROLE_INVARIANTS": "SYSTEM_INSTRUCTION",
    "SKILL_INSTRUCTIONS": "SYSTEM_INSTRUCTION",
    "APPROVED_ARTIFACT": "APPROVED_ARTIFACT",
    "SOURCE_SPAN": "UNTRUSTED_CONTENT",
    "TASK_OUTPUT_SCHEMA": "SYSTEM_INSTRUCTION",
}


class ContextManifestEntryV1(ClosedModel):
    kind: ContextEntryKind
    ref: str = Field(min_length=1, max_length=240)
    version: str = Field(min_length=1, max_length=120)
    content_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    trust_level: ContextTrustLevel
    byte_count: int = Field(strict=True, ge=0, le=16 * 1024 * 1024)
    truncation_reason: str | None = Field(default=None, min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_trust_level(self) -> ContextManifestEntryV1:
        expected = _CONTEXT_TRUST[self.kind]
        if self.trust_level != expected:
            raise ValueError(f"{self.kind} must use {expected}")
        return self


class ContextManifestV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    context_manifest_id: str = Field(pattern=CONTEXT_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    agent_definition: DefinitionRefV1
    skill_definition: DefinitionRefV1
    entries: tuple[ContextManifestEntryV1, ...] = Field(min_length=5, max_length=10_000)
    total_byte_count: int = Field(strict=True, ge=0, le=2 * 1024 * 1024)
    manifest_hash: str = Field(pattern=CONTENT_HASH_PATTERN)

    def hash_payload(self) -> dict[str, object]:
        return {
            "project_id": self.project_id,
            "agent_definition": self.agent_definition.model_dump(mode="json"),
            "skill_definition": self.skill_definition.model_dump(mode="json"),
            "entries": [entry.model_dump(mode="json") for entry in self.entries],
            "total_byte_count": self.total_byte_count,
        }

    @model_validator(mode="after")
    def validate_manifest(self) -> ContextManifestV1:
        kinds = [entry.kind for entry in self.entries]
        if set(kinds) != set(_CONTEXT_ORDER):
            raise ValueError("context manifest must contain all five progressive layers")
        if [_CONTEXT_ORDER[kind] for kind in kinds] != sorted(
            _CONTEXT_ORDER[kind] for kind in kinds
        ):
            raise ValueError("context entries must follow the fixed progressive order")
        if self.total_byte_count != sum(entry.byte_count for entry in self.entries):
            raise ValueError("total_byte_count does not match context entries")
        if any(
            entry.kind == "SOURCE_SPAN" and entry.byte_count > 64 * 1024 for entry in self.entries
        ):
            raise ValueError("SOURCE_SPAN entry exceeds the bounded scene context")
        expected_hash = canonical_sha256(self.hash_payload())
        if self.manifest_hash != expected_hash:
            raise ValueError("manifest_hash does not match entries")
        return self


class ProposalSourceSpanV1(ClosedModel):
    source_span_id: str = Field(pattern=r"^spn_[0-9a-f]{32}$")
    source_document_id: str = Field(pattern=SOURCE_ID_PATTERN)
    source_block_id: str = Field(pattern=SOURCE_BLOCK_ID_PATTERN)
    start_byte: int = Field(strict=True, ge=0)
    end_byte: int = Field(strict=True, gt=0)
    claim: str = Field(min_length=1, max_length=1000)
    quote_hash: str = Field(pattern=CONTENT_HASH_PATTERN)

    @model_validator(mode="after")
    def validate_range(self) -> ProposalSourceSpanV1:
        if self.end_byte <= self.start_byte:
            raise ValueError("source span end must be after start")
        return self


class ProposalClaimV1(ClosedModel):
    claim_id: str = Field(pattern=r"^clm_[0-9a-f]{32}$")
    text: str = Field(min_length=1, max_length=2000)
    invented: bool
    source_span_ids: tuple[str, ...] = Field(max_length=100)


class ProposalDependencyV1(ClosedModel):
    artifact_type: ArtifactType
    version_id: str = Field(pattern=VERSION_ID_PATTERN)
    approval_required: Literal[True] = True


class ProposalImpactV1(ClosedModel):
    artifact_type: ArtifactType
    artifact_id: str | None = Field(default=None, pattern=r"^art_[0-9a-f]{32}$")
    impact: Literal["CREATE", "STALE", "INVALIDATE"]


class ProposalCostV1(ClosedModel):
    currency: Literal["USD"] = "USD"
    estimated_micros: int = Field(strict=True, ge=0)
    actual_micros: int = Field(strict=True, ge=0)


class CapabilityLossV1(ClosedModel):
    code: DefinitionId
    description: str = Field(min_length=1, max_length=1000)


class ProposalQcV1(ClosedModel):
    check_id: DefinitionId
    status: Literal["PASS", "FAIL", "NOT_RUN"]
    details: str = Field(min_length=1, max_length=1000)


class JsonPatchOperationV1(ClosedModel):
    op: Literal["add", "remove", "replace"]
    path: str = Field(pattern=r"^/")
    value: object | None = None


class ArtifactProposalV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    proposal_id: str = Field(pattern=PROPOSAL_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    target_artifact_type: ArtifactType
    payload: dict[str, object]
    payload_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    source_spans: tuple[ProposalSourceSpanV1, ...] = Field(min_length=1, max_length=20_000)
    claims: tuple[ProposalClaimV1, ...] = Field(max_length=20_000)
    diff: tuple[JsonPatchOperationV1, ...] = Field(max_length=20_000)
    dependencies: tuple[ProposalDependencyV1, ...] = Field(max_length=10_000)
    impacts: tuple[ProposalImpactV1, ...] = Field(max_length=10_000)
    cost: ProposalCostV1
    confidence_basis_points: int = Field(strict=True, ge=0, le=10_000)
    capability_losses: tuple[CapabilityLossV1, ...] = Field(max_length=100)
    qc: tuple[ProposalQcV1, ...] = Field(min_length=1, max_length=100)
    producer_agent_run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    producer_skill_run_id: str = Field(pattern=SKILL_RUN_ID_PATTERN)

    @model_validator(mode="after")
    def validate_evidence_and_hash(self) -> ArtifactProposalV1:
        if self.payload_hash != canonical_sha256(self.payload):
            raise ValueError("payload_hash does not match payload")
        span_ids = {span.source_span_id for span in self.source_spans}
        for claim in self.claims:
            if not claim.invented and not claim.source_span_ids:
                raise ValueError("factual claim must reference SourceSpan evidence")
            if not set(claim.source_span_ids).issubset(span_ids):
                raise ValueError("claim references an unknown SourceSpan")
        return self


class AgentRunV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    agent_run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    agent_definition: DefinitionRefV1
    status: Literal["PENDING", "RUNNING", "NEEDS_REVIEW", "SUCCEEDED", "FAILED", "CANCELLED"]
    delegated_skill_run_ids: tuple[str, ...] = Field(max_length=10_000)


class SkillRunV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    skill_run_id: str = Field(pattern=SKILL_RUN_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    agent_run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    skill_definition: DefinitionRefV1
    context_manifest_id: str = Field(pattern=CONTEXT_ID_PATTERN)
    status: Literal[
        "PENDING",
        "RUNNING",
        "NEEDS_REVIEW",
        "SUCCEEDED",
        "FAILED",
        "CANCEL_REQUESTED",
        "CANCELLED",
        "REMOTE_UNKNOWN",
    ]
    proposal_id: str | None = Field(default=None, pattern=PROPOSAL_ID_PATTERN)


class AttemptSnapshotV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    agent_run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    skill_run_id: str = Field(pattern=SKILL_RUN_ID_PATTERN)
    output_artifact_type: ArtifactType
    agent_definition_id: DefinitionId
    agent_version: str = Field(pattern=SEMVER_PATTERN)
    skill_definition_id: DefinitionId
    skill_version: str = Field(pattern=SEMVER_PATTERN)
    prompt_version: str = Field(min_length=1, max_length=120)
    policy_version: str = Field(min_length=1, max_length=120)
    provider_connection_id: str = Field(min_length=1, max_length=120)
    model_id: str = Field(min_length=1, max_length=120)
    capability_snapshot_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    input_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    output_schema_version: str = Field(pattern=SEMVER_PATTERN)
    idempotency_key: str = Field(min_length=1, max_length=240)
    attempt_fingerprint: str = Field(pattern=CONTENT_HASH_PATTERN)

    def fingerprint_payload(self) -> dict[str, str]:
        fields = (
            "project_id",
            "agent_run_id",
            "skill_run_id",
            "output_artifact_type",
            "agent_definition_id",
            "agent_version",
            "skill_definition_id",
            "skill_version",
            "prompt_version",
            "policy_version",
            "provider_connection_id",
            "model_id",
            "capability_snapshot_hash",
            "input_hash",
            "output_schema_version",
            "idempotency_key",
        )
        return {field: str(getattr(self, field)) for field in fields}

    @model_validator(mode="after")
    def validate_fingerprint(self) -> AttemptSnapshotV1:
        if self.attempt_fingerprint != canonical_sha256(self.fingerprint_payload()):
            raise ValueError("attempt_fingerprint does not match the fixed execution snapshot")
        return self


class AgentSkillFixtureBundleV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    agent_definition: AgentDefinitionV1
    skill_definition: SkillDefinitionV1
    context_manifest: ContextManifestV1
    artifact_proposal: ArtifactProposalV1
    agent_run: AgentRunV1
    skill_run: SkillRunV1
    attempt: AttemptSnapshotV1

    @model_validator(mode="after")
    def validate_reference_chain(self) -> AgentSkillFixtureBundleV1:
        project_ids = {
            self.context_manifest.project_id,
            self.artifact_proposal.project_id,
            self.agent_run.project_id,
            self.skill_run.project_id,
            self.attempt.project_id,
        }
        if len(project_ids) != 1:
            raise ValueError("bundle project references are inconsistent")

        agent_ref = DefinitionRefV1(
            definition_id=self.agent_definition.agent_definition_id,
            version=self.agent_definition.version,
        )
        skill_ref = DefinitionRefV1(
            definition_id=self.skill_definition.skill_definition_id,
            version=self.skill_definition.version,
        )
        if (
            self.context_manifest.agent_definition != agent_ref
            or self.agent_run.agent_definition != agent_ref
        ):
            raise ValueError("bundle AgentDefinition references are inconsistent")
        if (
            self.context_manifest.skill_definition != skill_ref
            or self.skill_run.skill_definition != skill_ref
            or skill_ref not in self.agent_definition.skill_refs
        ):
            raise ValueError("bundle SkillDefinition references are inconsistent")
        if self.skill_run.agent_run_id != self.agent_run.agent_run_id:
            raise ValueError("SkillRun must belong to the bundled AgentRun")
        if self.skill_run.context_manifest_id != self.context_manifest.context_manifest_id:
            raise ValueError("SkillRun must reference the bundled ContextManifest")
        if self.skill_run.skill_run_id not in self.agent_run.delegated_skill_run_ids:
            raise ValueError("AgentRun must record the bundled SkillRun delegation")
        if (
            self.artifact_proposal.producer_agent_run_id != self.agent_run.agent_run_id
            or self.artifact_proposal.producer_skill_run_id != self.skill_run.skill_run_id
            or self.skill_run.proposal_id != self.artifact_proposal.proposal_id
        ):
            raise ValueError("ArtifactProposal producer references are inconsistent")
        if (
            self.attempt.agent_run_id != self.agent_run.agent_run_id
            or self.attempt.skill_run_id != self.skill_run.skill_run_id
            or self.attempt.agent_definition_id != agent_ref.definition_id
            or self.attempt.agent_version != agent_ref.version
            or self.attempt.skill_definition_id != skill_ref.definition_id
            or self.attempt.skill_version != skill_ref.version
            or self.attempt.output_artifact_type != self.artifact_proposal.target_artifact_type
        ):
            raise ValueError("Attempt snapshot references are inconsistent")
        return self
