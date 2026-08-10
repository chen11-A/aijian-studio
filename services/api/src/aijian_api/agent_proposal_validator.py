"""Fail-closed validation that turns an Agent proposal into an immutable DRAFT."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from aijian_api.agent_skill_contracts import (
    AgentRunV1,
    ArtifactProposalV1,
    DefinitionRefV1,
    SkillRunV1,
)
from aijian_api.agent_skill_registry import ResolvedDelegation
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactSourceSpanDraft,
    ArtifactVersionRecord,
)
from aijian_api.repository import (
    AcceptedArtifactDependencyRequirement,
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    SourceSpanInvalidError,
    StudioRepository,
)

_SCHEMA_RESOLUTION_SEAL = object()


class ProposalValidationError(ValueError):
    """A proposal failed before it could become an immutable DRAFT."""


class ProposalSchemaNotFoundError(LookupError):
    """The exact immutable proposal payload schema is not registered."""


@dataclass(frozen=True, slots=True)
class ProposalSchemaRegistration:
    schema_ref: str
    payload_model: type[BaseModel]


@dataclass(frozen=True, slots=True, init=False)
class ResolvedProposalSchema:
    """An exact payload schema token minted only by ProposalSchemaRegistry."""

    schema_ref: str
    payload_model: type[BaseModel]
    _resolution_seal: object = field(repr=False)

    def __init__(self, registration: ProposalSchemaRegistration, *, _seal: object) -> None:
        if _seal is not _SCHEMA_RESOLUTION_SEAL:
            raise TypeError("ResolvedProposalSchema must be created by ProposalSchemaRegistry")
        object.__setattr__(self, "schema_ref", registration.schema_ref)
        object.__setattr__(self, "payload_model", registration.payload_model)
        object.__setattr__(self, "_resolution_seal", _seal)

    def validate(self, *, expected_schema_ref: str, payload: dict[str, object]) -> None:
        if self._resolution_seal is not _SCHEMA_RESOLUTION_SEAL:
            raise TypeError("invalid proposal schema resolution token")
        if self.schema_ref != expected_schema_ref:
            raise ProposalValidationError(
                "resolved proposal schema does not match the Skill output"
            )
        try:
            validated = self.payload_model.model_validate(payload)
        except ValidationError as error:
            raise ProposalValidationError("proposal payload failed its output schema") from error
        if validated.model_dump(mode="json", by_alias=True) != payload:
            raise ProposalValidationError(
                "proposal payload differs from its strictly validated output schema"
            )


class ProposalSchemaRegistry:
    """Resolve exact, trusted Pydantic payload models without caller-supplied callables."""

    def __init__(self, registrations: tuple[ProposalSchemaRegistration, ...]) -> None:
        self._registrations: dict[str, ProposalSchemaRegistration] = {}
        for registration in registrations:
            if registration.schema_ref in self._registrations:
                raise ValueError(f"duplicate proposal schema: {registration.schema_ref}")
            if (
                registration.payload_model.model_config.get("extra") != "forbid"
                or registration.payload_model.model_config.get("strict") is not True
            ):
                raise ValueError("proposal payload models must use extra='forbid' and strict=True")
            self._registrations[registration.schema_ref] = registration

    def resolve(self, schema_ref: str) -> ResolvedProposalSchema:
        registration = self._registrations.get(schema_ref)
        if registration is None:
            raise ProposalSchemaNotFoundError(f"unknown proposal schema: {schema_ref}")
        return ResolvedProposalSchema(registration, _seal=_SCHEMA_RESOLUTION_SEAL)


def _storage_artifact_type(artifact_type: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", artifact_type).lower()


def _validate_run_chain(
    proposal: ArtifactProposalV1,
    agent_run: AgentRunV1,
    skill_run: SkillRunV1,
    delegation: ResolvedDelegation,
) -> None:
    delegation.assert_registry_resolved()
    agent = delegation.agent_definition
    skill = delegation.skill_definition
    agent_ref = DefinitionRefV1(
        definition_id=agent.agent_definition_id,
        version=agent.version,
    )
    skill_ref = DefinitionRefV1(
        definition_id=skill.skill_definition_id,
        version=skill.version,
    )
    if (
        proposal.project_id != agent_run.project_id
        or proposal.project_id != skill_run.project_id
        or proposal.producer_agent_run_id != agent_run.agent_run_id
        or proposal.producer_skill_run_id != skill_run.skill_run_id
        or skill_run.agent_run_id != agent_run.agent_run_id
        or skill_run.skill_run_id not in agent_run.delegated_skill_run_ids
        or skill_run.proposal_id != proposal.proposal_id
        or agent_run.agent_definition != agent_ref
        or skill_run.skill_definition != skill_ref
        or agent_run.status != "NEEDS_REVIEW"
        or skill_run.status != "NEEDS_REVIEW"
    ):
        raise ProposalValidationError("proposal run chain is inconsistent or not reviewable")


def _output_schema_version(proposal: ArtifactProposalV1, delegation: ResolvedDelegation) -> str:
    schema_parts = delegation.skill_definition.output_schema_ref.rstrip("/").split("/")
    expected_schema_name = f"{proposal.target_artifact_type}Proposal"
    if len(schema_parts) < 2 or schema_parts[-2] != expected_schema_name:
        raise ProposalValidationError("proposal target does not match the Skill output schema")
    return schema_parts[-1]


def _validate_policy(proposal: ArtifactProposalV1, delegation: ResolvedDelegation) -> None:
    skill = delegation.skill_definition
    if (
        proposal.cost.estimated_micros > skill.budget.hard_limit_micros
        or proposal.cost.actual_micros > skill.budget.hard_limit_micros
    ):
        raise ProposalValidationError("proposal exceeds the Skill hard budget")
    if any(check.status != "PASS" for check in proposal.qc):
        raise ProposalValidationError("proposal QC must pass before creating a DRAFT")
    if not any(
        impact.artifact_type == proposal.target_artifact_type for impact in proposal.impacts
    ):
        raise ProposalValidationError("proposal impact does not include its target Artifact")
    span_ids = [span.source_span_id for span in proposal.source_spans]
    if len(span_ids) != len(set(span_ids)):
        raise ProposalValidationError("proposal SourceSpan identifiers must be unique")
    dependency_ids = [dependency.version_id for dependency in proposal.dependencies]
    if len(dependency_ids) != len(set(dependency_ids)):
        raise ProposalValidationError("proposal dependency versions must be unique")


def _resolve_dependencies(
    repository: StudioRepository,
    proposal: ArtifactProposalV1,
    delegation: ResolvedDelegation,
) -> tuple[ArtifactDependencyDraft, ...]:
    resolved: list[ArtifactDependencyDraft] = []
    readable_types = delegation.skill_definition.readable_artifact_types
    for dependency in proposal.dependencies:
        if dependency.artifact_type not in readable_types:
            raise ProposalValidationError(
                f"SkillDefinition cannot read Artifact type {dependency.artifact_type}"
            )
        storage_type = _storage_artifact_type(dependency.artifact_type)
        try:
            record = repository.get_artifact_version(
                proposal.project_id,
                storage_type,
                dependency.version_id,
            )
        except (ArtifactConflictError, LookupError) as error:
            raise ProposalValidationError(
                "proposal dependency does not belong to the project"
            ) from error
        if record.head.accepted_version_id != dependency.version_id:
            raise ProposalValidationError("proposal dependency is not the accepted ArtifactVersion")
        resolved.append(
            ArtifactDependencyDraft(
                upstream_version_id=dependency.version_id,
                relationship="derived_from",
                impact="blocking",
            )
        )
    return tuple(resolved)


def _source_span_drafts(proposal: ArtifactProposalV1) -> tuple[ArtifactSourceSpanDraft, ...]:
    return tuple(
        ArtifactSourceSpanDraft(
            fact_id=span.source_span_id,
            source_document_id=span.source_document_id,
            source_block_id=span.source_block_id,
            role="supports",
            start_byte=span.start_byte,
            end_byte=span.end_byte,
            claim=span.claim,
        )
        for span in proposal.source_spans
    )


def _quote_hash_validator(
    proposal: ArtifactProposalV1,
) -> Callable[[ArtifactVersionRecord], None]:
    expected = {span.source_span_id: span.quote_hash for span in proposal.source_spans}

    def validate(record: ArtifactVersionRecord) -> None:
        actual = {span.fact_id: span.quote_hash for span in record.source_spans}
        if actual != expected:
            raise ProposalValidationError("proposal SourceSpan quote hash does not match source")

    return validate


def accept_proposal_as_draft(
    *,
    repository: StudioRepository,
    proposal: ArtifactProposalV1,
    agent_run: AgentRunV1,
    skill_run: SkillRunV1,
    delegation: ResolvedDelegation,
    proposal_schema: ResolvedProposalSchema,
    parent_version_id: str | None = None,
    expected_revision: int | None = None,
) -> ArtifactVersionRecord:
    """Validate one proposal and append a DRAFT without advancing any Gate head."""

    proposal = ArtifactProposalV1.model_validate(proposal.model_dump(mode="json"))
    agent_run = AgentRunV1.model_validate(agent_run.model_dump(mode="json"))
    skill_run = SkillRunV1.model_validate(skill_run.model_dump(mode="json"))
    _validate_run_chain(proposal, agent_run, skill_run, delegation)
    schema_version = _output_schema_version(proposal, delegation)
    _validate_policy(proposal, delegation)
    if (parent_version_id is None) != (expected_revision is None):
        raise ProposalValidationError(
            "parent version and expected revision must be provided together"
        )
    proposal_schema.validate(
        expected_schema_ref=delegation.skill_definition.output_schema_ref,
        payload=proposal.payload,
    )
    dependencies = _resolve_dependencies(repository, proposal, delegation)
    required_source_version = next(
        (
            dependency.version_id
            for dependency in proposal.dependencies
            if dependency.artifact_type == "SourceManifest"
        ),
        None,
    )
    try:
        return repository.create_artifact_version(
            project_id=proposal.project_id,
            artifact_type=_storage_artifact_type(proposal.target_artifact_type),
            schema_version=schema_version,
            content=proposal.payload,
            author_actor_type="agent",
            author_actor_id=proposal.producer_skill_run_id,
            change_summary=f"Agent proposal {proposal.proposal_id} accepted as DRAFT",
            parent_version_id=parent_version_id,
            expected_revision=expected_revision,
            source_spans=_source_span_drafts(proposal),
            dependencies=dependencies,
            accepted_dependency_requirements=tuple(
                AcceptedArtifactDependencyRequirement(
                    artifact_type=_storage_artifact_type(dependency.artifact_type),
                    version_id=dependency.version_id,
                )
                for dependency in proposal.dependencies
            ),
            required_accepted_upstream_version_id=(
                required_source_version
                if _storage_artifact_type(proposal.target_artifact_type) == "story_bible"
                else None
            ),
            record_validator=_quote_hash_validator(proposal),
        )
    except SourceSpanInvalidError as error:
        raise ProposalValidationError("proposal SourceSpan is invalid for the project") from error
    except ArtifactDependencyInvalidError as error:
        raise ProposalValidationError("proposal dependency is no longer accepted") from error
