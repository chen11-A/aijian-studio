"""Deterministic five-layer context assembly behind sealed trust boundaries."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Protocol

from aijian_api.agent_skill_contracts import (
    ContextEntryKind,
    ContextManifestEntryV1,
    ContextManifestV1,
    ContextTrustLevel,
    DefinitionRefV1,
    canonical_sha256,
)
from aijian_api.agent_skill_registry import ResolvedDelegation

_APPROVED_ARTIFACT_REF = re.compile(r"^artifact:[A-Z][A-Za-z0-9]{1,79}/ver_[0-9a-f]{32}$")
_SOURCE_SPAN_REF = re.compile(r"^source:spn_[0-9a-f]{32}$")
_SOURCE_VERSION = re.compile(r"^source-v[1-9][0-9]*$")
_SCHEMA_VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
_TRUSTED_INPUT_SEAL = object()


@dataclass(frozen=True, slots=True)
class ContextFragment:
    """Ephemeral content; only its reference, hash and byte count are persisted."""

    ref: str
    version: str
    content: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.ref.strip() or not self.version.strip():
            raise ValueError("context fragment ref and version are required")
        if not self.content:
            raise ValueError("context fragment content is required")


@dataclass(frozen=True, slots=True, init=False)
class ResolvedContextInputs:
    """Trusted layers resolved by a controlled loader, not supplied by UI/model input."""

    project_id: str
    agent_ref: DefinitionRefV1
    skill_ref: DefinitionRefV1
    role_invariants: ContextFragment
    skill_instructions: ContextFragment
    approved_artifacts: tuple[ContextFragment, ...]
    source_spans: tuple[ContextFragment, ...]
    task_output_schema: ContextFragment
    _trusted_input_seal: object = field(repr=False)

    def __init__(
        self,
        *,
        project_id: str,
        agent_ref: DefinitionRefV1,
        skill_ref: DefinitionRefV1,
        role_invariants: ContextFragment,
        skill_instructions: ContextFragment,
        approved_artifacts: tuple[ContextFragment, ...],
        source_spans: tuple[ContextFragment, ...],
        task_output_schema: ContextFragment,
        _seal: object,
    ) -> None:
        if _seal is not _TRUSTED_INPUT_SEAL:
            raise TypeError("ResolvedContextInputs must be created by a controlled loader")
        object.__setattr__(self, "project_id", project_id)
        object.__setattr__(self, "agent_ref", agent_ref)
        object.__setattr__(self, "skill_ref", skill_ref)
        object.__setattr__(self, "role_invariants", role_invariants)
        object.__setattr__(self, "skill_instructions", skill_instructions)
        object.__setattr__(self, "approved_artifacts", approved_artifacts)
        object.__setattr__(self, "source_spans", source_spans)
        object.__setattr__(self, "task_output_schema", task_output_schema)
        object.__setattr__(self, "_trusted_input_seal", _seal)

    def assert_loader_resolved(self) -> None:
        if self._trusted_input_seal is not _TRUSTED_INPUT_SEAL:
            raise TypeError("invalid controlled-loader context token")


class ContextLoader(Protocol):
    """Production-facing loader boundary; implementations own repository authorization."""

    def resolve(
        self,
        *,
        project_id: str,
        delegation: ResolvedDelegation,
        approved_artifact_refs: tuple[str, ...],
        source_span_refs: tuple[str, ...],
    ) -> ResolvedContextInputs: ...


def _mint_resolved_context_inputs(
    *,
    project_id: str,
    delegation: ResolvedDelegation,
    role_invariants: ContextFragment,
    skill_instructions: ContextFragment,
    approved_artifacts: tuple[ContextFragment, ...],
    source_spans: tuple[ContextFragment, ...],
    task_output_schema: ContextFragment,
) -> ResolvedContextInputs:
    """Internal minting hook for an authorized loader implementation."""

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
    if role_invariants.ref != f"agent:{agent_ref.definition_id}" or (
        role_invariants.version != agent_ref.version
    ):
        raise ValueError("role invariants do not match AgentDefinition")
    if skill_instructions.ref != f"skill:{skill_ref.definition_id}" or (
        skill_instructions.version != skill_ref.version
    ):
        raise ValueError("skill instructions do not match SkillDefinition")
    schema_parts = skill.output_schema_ref.rstrip("/").split("/")
    if len(schema_parts) < 2 or (
        task_output_schema.ref != f"schema:{schema_parts[-2]}"
        or task_output_schema.version != schema_parts[-1]
    ):
        raise ValueError("output schema does not match SkillDefinition")
    if not approved_artifacts:
        raise ValueError("at least one approved ArtifactVersion is required")
    for artifact in approved_artifacts:
        match = _APPROVED_ARTIFACT_REF.fullmatch(artifact.ref)
        if match is None or _SCHEMA_VERSION.fullmatch(artifact.version) is None:
            raise ValueError("approved Artifact context requires immutable ref and schema version")
        artifact_type = artifact.ref.removeprefix("artifact:").split("/", 1)[0]
        if artifact_type not in skill.readable_artifact_types:
            raise PermissionError(f"SkillDefinition cannot read Artifact type {artifact_type}")
    if not source_spans:
        raise ValueError("at least one scene SourceSpan is required")
    if any(
        _SOURCE_SPAN_REF.fullmatch(fragment.ref) is None
        or _SOURCE_VERSION.fullmatch(fragment.version) is None
        for fragment in source_spans
    ):
        raise ValueError("source context requires exact SourceSpan ref and controlled version")
    return ResolvedContextInputs(
        project_id=project_id,
        agent_ref=agent_ref,
        skill_ref=skill_ref,
        role_invariants=role_invariants,
        skill_instructions=skill_instructions,
        approved_artifacts=approved_artifacts,
        source_spans=source_spans,
        task_output_schema=task_output_schema,
        _seal=_TRUSTED_INPUT_SEAL,
    )


@dataclass(frozen=True, slots=True)
class BuiltContextLayer:
    kind: ContextEntryKind
    trust_level: ContextTrustLevel
    fragment: ContextFragment


@dataclass(frozen=True, slots=True)
class BuiltContext:
    """Ephemeral assembled content plus its safe-to-persist manifest."""

    layers: tuple[BuiltContextLayer, ...]
    manifest: ContextManifestV1


def _content_hash(content: str) -> str:
    return f"sha256:{hashlib.sha256(content.encode('utf-8')).hexdigest()}"


def _entry(layer: BuiltContextLayer) -> ContextManifestEntryV1:
    fragment = layer.fragment
    return ContextManifestEntryV1(
        kind=layer.kind,
        ref=fragment.ref,
        version=fragment.version,
        content_hash=_content_hash(fragment.content),
        trust_level=layer.trust_level,
        byte_count=len(fragment.content.encode("utf-8")),
        truncation_reason=None,
    )


def build_context(
    *,
    delegation: ResolvedDelegation,
    trusted_inputs: ResolvedContextInputs,
) -> BuiltContext:
    """Build fixed trust layers from sealed Registry and loader resolutions."""

    delegation.assert_registry_resolved()
    trusted_inputs.assert_loader_resolved()
    agent = delegation.agent_definition
    skill = delegation.skill_definition
    expected_agent_ref = DefinitionRefV1(
        definition_id=agent.agent_definition_id,
        version=agent.version,
    )
    expected_skill_ref = DefinitionRefV1(
        definition_id=skill.skill_definition_id,
        version=skill.version,
    )
    if (
        trusted_inputs.agent_ref != expected_agent_ref
        or trusted_inputs.skill_ref != expected_skill_ref
    ):
        raise PermissionError("trusted context does not belong to the resolved delegation")
    layers = (
        BuiltContextLayer("ROLE_INVARIANTS", "SYSTEM_INSTRUCTION", trusted_inputs.role_invariants),
        BuiltContextLayer(
            "SKILL_INSTRUCTIONS", "SYSTEM_INSTRUCTION", trusted_inputs.skill_instructions
        ),
        *(
            BuiltContextLayer("APPROVED_ARTIFACT", "APPROVED_ARTIFACT", fragment)
            for fragment in trusted_inputs.approved_artifacts
        ),
        *(
            BuiltContextLayer("SOURCE_SPAN", "UNTRUSTED_CONTENT", fragment)
            for fragment in trusted_inputs.source_spans
        ),
        BuiltContextLayer(
            "TASK_OUTPUT_SCHEMA", "SYSTEM_INSTRUCTION", trusted_inputs.task_output_schema
        ),
    )
    entries = tuple(_entry(layer) for layer in layers)
    total_byte_count = sum(entry.byte_count for entry in entries)
    hash_payload = {
        "project_id": trusted_inputs.project_id,
        "agent_definition": expected_agent_ref.model_dump(mode="json"),
        "skill_definition": expected_skill_ref.model_dump(mode="json"),
        "entries": [entry.model_dump(mode="json") for entry in entries],
        "total_byte_count": total_byte_count,
    }
    manifest_hash = canonical_sha256(hash_payload)
    manifest = ContextManifestV1(
        context_manifest_id=f"ctx_{manifest_hash.removeprefix('sha256:')[:32]}",
        project_id=trusted_inputs.project_id,
        agent_definition=expected_agent_ref,
        skill_definition=expected_skill_ref,
        entries=entries,
        total_byte_count=total_byte_count,
        manifest_hash=manifest_hash,
    )
    return BuiltContext(layers=layers, manifest=manifest)


def build_context_manifest(
    *,
    delegation: ResolvedDelegation,
    trusted_inputs: ResolvedContextInputs,
) -> ContextManifestV1:
    """Return only the safe-to-persist portion of the assembled context."""

    return build_context(
        delegation=delegation,
        trusted_inputs=trusted_inputs,
    ).manifest
