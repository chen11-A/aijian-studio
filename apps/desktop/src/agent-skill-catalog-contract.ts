import type { components } from "@aijian/contracts";

import { hasOnlyKeys, hasRequestId, isRecord, isStringArray } from "./api-contract-guards";

export type AgentCatalogResponse = components["schemas"]["AgentCatalogResponse"];
export type SkillCatalogResponse = components["schemas"]["SkillCatalogResponse"];

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const DEFINITION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const ARTIFACT_TYPE_PATTERN = /^[A-Z][A-Za-z0-9]{1,79}$/;
const PROVIDER_CAPABILITY_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const INVALIDATION_EDGE_PATTERN = /^[A-Z][A-Za-z0-9]{1,79}->[A-Z][A-Za-z0-9]{1,79}$/;

function isBoundedStrings(value: unknown, min: number, max: number): value is string[] {
  return isStringArray(value) && value.length >= min && value.length <= max;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isRoleStatements(value: unknown): value is string[] {
  return (
    isBoundedStrings(value, 1, 32) &&
    value.every((item) => codePointLength(item) >= 1 && codePointLength(item) <= 1000)
  );
}

function isFixtureRefs(value: unknown): value is string[] {
  return (
    isBoundedStrings(value, 1, 64) &&
    value.every((item) => codePointLength(item) >= 1 && codePointLength(item) <= 240)
  );
}

function isDefinitionRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["definition_id", "version"]) &&
    typeof value.definition_id === "string" &&
    DEFINITION_ID_PATTERN.test(value.definition_id) &&
    typeof value.version === "string" &&
    SEMVER_PATTERN.test(value.version)
  );
}

function isCompatibility(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["minimum_schema_version", "maximum_schema_version"]) &&
    typeof value.minimum_schema_version === "string" &&
    SEMVER_PATTERN.test(value.minimum_schema_version) &&
    typeof value.maximum_schema_version === "string" &&
    SEMVER_PATTERN.test(value.maximum_schema_version)
  );
}

function isAgentDefinition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "schema_version",
      "agent_definition_id",
      "version",
      "display_name",
      "role",
      "layer",
      "responsibilities",
      "forbidden_actions",
      "skill_refs",
      "default_policy_version",
      "context_policy_version",
      "compatibility",
    ]) &&
    value.schema_version === "1.0.0" &&
    typeof value.agent_definition_id === "string" &&
    DEFINITION_ID_PATTERN.test(value.agent_definition_id) &&
    typeof value.version === "string" &&
    SEMVER_PATTERN.test(value.version) &&
    typeof value.display_name === "string" &&
    codePointLength(value.display_name) >= 1 &&
    codePointLength(value.display_name) <= 80 &&
    typeof value.role === "string" &&
    DEFINITION_ID_PATTERN.test(value.role) &&
    ["DECISION", "EXECUTION", "SUPERVISION"].includes(String(value.layer)) &&
    isRoleStatements(value.responsibilities) &&
    isRoleStatements(value.forbidden_actions) &&
    Array.isArray(value.skill_refs) &&
    value.skill_refs.length >= 1 &&
    value.skill_refs.length <= 64 &&
    value.skill_refs.every(isDefinitionRef) &&
    typeof value.default_policy_version === "string" &&
    codePointLength(value.default_policy_version) >= 1 &&
    codePointLength(value.default_policy_version) <= 120 &&
    typeof value.context_policy_version === "string" &&
    codePointLength(value.context_policy_version) >= 1 &&
    codePointLength(value.context_policy_version) <= 120 &&
    isCompatibility(value.compatibility)
  );
}

function isBudget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "currency",
      "soft_limit_micros",
      "hard_limit_micros",
      "retry_increment_limit_micros",
    ]) &&
    value.currency === "USD" &&
    Number.isSafeInteger(value.soft_limit_micros) &&
    Number(value.soft_limit_micros) >= 0 &&
    Number.isSafeInteger(value.hard_limit_micros) &&
    Number(value.hard_limit_micros) >= Number(value.soft_limit_micros) &&
    Number.isSafeInteger(value.retry_increment_limit_micros) &&
    Number(value.retry_increment_limit_micros) >= 0 &&
    Number(value.retry_increment_limit_micros) <= Number(value.hard_limit_micros)
  );
}

function isSkillDefinition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "schema_version",
      "skill_definition_id",
      "version",
      "display_name",
      "input_schema_ref",
      "output_schema_ref",
      "readable_artifact_types",
      "allowed_tools",
      "allowed_provider_capabilities",
      "budget",
      "timeout_seconds",
      "max_attempts",
      "required_gate",
      "invalidation_edges",
      "ui_renderer",
      "fixture_refs",
      "compatibility",
    ]) &&
    value.schema_version === "1.0.0" &&
    typeof value.skill_definition_id === "string" &&
    DEFINITION_ID_PATTERN.test(value.skill_definition_id) &&
    typeof value.version === "string" &&
    SEMVER_PATTERN.test(value.version) &&
    typeof value.display_name === "string" &&
    codePointLength(value.display_name) >= 1 &&
    codePointLength(value.display_name) <= 80 &&
    typeof value.input_schema_ref === "string" &&
    codePointLength(value.input_schema_ref) >= 1 &&
    codePointLength(value.input_schema_ref) <= 240 &&
    typeof value.output_schema_ref === "string" &&
    codePointLength(value.output_schema_ref) >= 1 &&
    codePointLength(value.output_schema_ref) <= 240 &&
    isBoundedStrings(value.readable_artifact_types, 0, 64) &&
    value.readable_artifact_types.every((item) => ARTIFACT_TYPE_PATTERN.test(item)) &&
    isBoundedStrings(value.allowed_tools, 0, 64) &&
    value.allowed_tools.every((item) => DEFINITION_ID_PATTERN.test(item)) &&
    isBoundedStrings(value.allowed_provider_capabilities, 0, 32) &&
    value.allowed_provider_capabilities.every((item) => PROVIDER_CAPABILITY_PATTERN.test(item)) &&
    isBudget(value.budget) &&
    Number.isInteger(value.timeout_seconds) &&
    Number(value.timeout_seconds) >= 1 &&
    Number(value.timeout_seconds) <= 86_400 &&
    Number.isInteger(value.max_attempts) &&
    Number(value.max_attempts) >= 1 &&
    Number(value.max_attempts) <= 2 &&
    typeof value.required_gate === "string" &&
    /^G[0-8](?:[A-Z])?$/.test(value.required_gate) &&
    isBoundedStrings(value.invalidation_edges, 0, 64) &&
    value.invalidation_edges.every((item) => INVALIDATION_EDGE_PATTERN.test(item)) &&
    typeof value.ui_renderer === "string" &&
    DEFINITION_ID_PATTERN.test(value.ui_renderer) &&
    isFixtureRefs(value.fixture_refs) &&
    isCompatibility(value.compatibility)
  );
}

export function isAgentCatalogResponse(
  value: unknown,
  projectId: string,
): value is AgentCatalogResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["data", "request_id"]) || !hasRequestId(value)) {
    return false;
  }
  const data = value.data;
  return (
    isRecord(data) &&
    hasOnlyKeys(data, ["project_id", "agents"]) &&
    data.project_id === projectId &&
    PROJECT_ID_PATTERN.test(projectId) &&
    Array.isArray(data.agents) &&
    data.agents.every(isAgentDefinition)
  );
}

export function isSkillCatalogResponse(
  value: unknown,
  projectId: string,
): value is SkillCatalogResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["data", "request_id"]) || !hasRequestId(value)) {
    return false;
  }
  const data = value.data;
  return (
    isRecord(data) &&
    hasOnlyKeys(data, ["project_id", "skills"]) &&
    data.project_id === projectId &&
    PROJECT_ID_PATTERN.test(projectId) &&
    Array.isArray(data.skills) &&
    data.skills.every(isSkillDefinition)
  );
}
