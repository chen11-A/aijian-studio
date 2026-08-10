"""In-memory, version-exact registry for Agent and Skill definitions."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from aijian_api.agent_skill_contracts import (
    AgentDefinitionV1,
    ContractCompatibilityV1,
    DefinitionRefV1,
    SkillDefinitionV1,
)

_SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
_RESOLUTION_SEAL = object()


class DefinitionNotFoundError(LookupError):
    """The exact immutable definition version is not registered."""


class DefinitionDisabledError(PermissionError):
    """A definition exists but is explicitly disabled."""


class DefinitionIncompatibleError(ValueError):
    """A definition cannot consume the requested contract schema version."""


@dataclass(frozen=True, slots=True)
class AgentRegistration:
    definition: AgentDefinitionV1
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class SkillRegistration:
    definition: SkillDefinitionV1
    enabled: bool = True


@dataclass(frozen=True, slots=True, init=False)
class ResolvedDelegation:
    """A delegation that can only be minted after Registry policy checks."""

    agent_definition: AgentDefinitionV1
    skill_definition: SkillDefinitionV1
    _resolution_seal: object = field(repr=False)

    def __init__(
        self,
        agent_definition: AgentDefinitionV1,
        skill_definition: SkillDefinitionV1,
        *,
        _seal: object,
    ) -> None:
        if _seal is not _RESOLUTION_SEAL:
            raise TypeError("ResolvedDelegation must be created by AgentSkillRegistry")
        object.__setattr__(self, "agent_definition", agent_definition)
        object.__setattr__(self, "skill_definition", skill_definition)
        object.__setattr__(self, "_resolution_seal", _seal)

    def assert_registry_resolved(self) -> None:
        """Reject forged instances even if type checking was bypassed."""

        if self._resolution_seal is not _RESOLUTION_SEAL:
            raise TypeError("invalid Registry delegation token")


def _semver(value: str) -> tuple[int, int, int]:
    match = _SEMVER.fullmatch(value)
    if match is None:
        raise DefinitionIncompatibleError(f"invalid semantic version: {value}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def _require_compatible(compatibility: ContractCompatibilityV1, schema_version: str) -> None:
    requested = _semver(schema_version)
    minimum = _semver(compatibility.minimum_schema_version)
    maximum = _semver(compatibility.maximum_schema_version)
    if minimum > maximum:
        raise DefinitionIncompatibleError("definition compatibility range is inverted")
    if not minimum <= requested <= maximum:
        raise DefinitionIncompatibleError(
            f"contract schema {schema_version} is outside {minimum}..{maximum}"
        )


class AgentSkillRegistry:
    """Resolve exact definitions; never falls back to a nearby or latest version."""

    def __init__(
        self,
        *,
        agents: tuple[AgentRegistration, ...],
        skills: tuple[SkillRegistration, ...],
    ) -> None:
        self._agents: dict[tuple[str, str], AgentRegistration] = {}
        self._skills: dict[tuple[str, str], SkillRegistration] = {}
        for agent_registration in agents:
            key = (
                agent_registration.definition.agent_definition_id,
                agent_registration.definition.version,
            )
            if key in self._agents:
                raise ValueError(f"duplicate AgentDefinition: {key[0]}@{key[1]}")
            _require_compatible(
                agent_registration.definition.compatibility,
                agent_registration.definition.schema_version,
            )
            self._agents[key] = agent_registration
        for skill_registration in skills:
            key = (
                skill_registration.definition.skill_definition_id,
                skill_registration.definition.version,
            )
            if key in self._skills:
                raise ValueError(f"duplicate SkillDefinition: {key[0]}@{key[1]}")
            _require_compatible(
                skill_registration.definition.compatibility,
                skill_registration.definition.schema_version,
            )
            self._skills[key] = skill_registration

    def resolve_agent(
        self,
        definition_id: str,
        version: str,
        *,
        contract_schema_version: str,
    ) -> AgentDefinitionV1:
        registration = self._agents.get((definition_id, version))
        if registration is None:
            raise DefinitionNotFoundError(f"unknown AgentDefinition: {definition_id}@{version}")
        if not registration.enabled:
            raise DefinitionDisabledError(f"disabled AgentDefinition: {definition_id}@{version}")
        _require_compatible(registration.definition.compatibility, contract_schema_version)
        return registration.definition

    def resolve_skill(
        self,
        definition_id: str,
        version: str,
        *,
        contract_schema_version: str,
    ) -> SkillDefinitionV1:
        registration = self._skills.get((definition_id, version))
        if registration is None:
            raise DefinitionNotFoundError(f"unknown SkillDefinition: {definition_id}@{version}")
        if not registration.enabled:
            raise DefinitionDisabledError(f"disabled SkillDefinition: {definition_id}@{version}")
        _require_compatible(registration.definition.compatibility, contract_schema_version)
        return registration.definition

    def require_delegation(
        self,
        agent_ref: DefinitionRefV1,
        skill_ref: DefinitionRefV1,
        *,
        contract_schema_version: str = "1.0.0",
    ) -> tuple[AgentDefinitionV1, SkillDefinitionV1]:
        resolved = self.resolve_delegation(
            agent_ref,
            skill_ref,
            contract_schema_version=contract_schema_version,
        )
        return resolved.agent_definition, resolved.skill_definition

    def resolve_delegation(
        self,
        agent_ref: DefinitionRefV1,
        skill_ref: DefinitionRefV1,
        *,
        contract_schema_version: str = "1.0.0",
    ) -> ResolvedDelegation:
        agent = self.resolve_agent(
            agent_ref.definition_id,
            agent_ref.version,
            contract_schema_version=contract_schema_version,
        )
        skill = self.resolve_skill(
            skill_ref.definition_id,
            skill_ref.version,
            contract_schema_version=contract_schema_version,
        )
        if skill_ref not in agent.skill_refs:
            raise PermissionError(
                f"AgentDefinition {agent_ref.definition_id}@{agent_ref.version} "
                f"is not allowed to delegate {skill_ref.definition_id}@{skill_ref.version}"
            )
        return ResolvedDelegation(agent, skill, _seal=_RESOLUTION_SEAL)
