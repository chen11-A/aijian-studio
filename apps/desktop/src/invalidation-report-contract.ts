import type { components } from "@aijian/contracts";

import { hasOnlyKeys, hasRequestId, isIdArray, isRecord } from "./api-contract-guards";

export type InvalidationOperationListResponse =
  components["schemas"]["InvalidationOperationListResponse"];
export type InvalidationOperationDetailResponse =
  components["schemas"]["InvalidationOperationDetailResponse"];

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const ARTIFACT_ID_PATTERN = /^art_[0-9a-f]{32}$/;
const VERSION_ID_PATTERN = /^ver_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^invop_[0-9a-f]{32}$/;
const DECISION_ID_PATTERN = /^dec_[0-9a-f]{32}$/;
const IMPACT_ID_PATTERN = /^invimp_[0-9a-f]{32}$/;
const DEPENDENCY_ID_PATTERN = /^dep_[0-9a-f]{32}$/;

const IMPACT_VALUES = ["blocking", "render_only", "advisory"] as const;

export function isProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

export function isOperationId(value: string): boolean {
  return OPERATION_ID_PATTERN.test(value);
}

function isImpactValue(value: unknown): value is (typeof IMPACT_VALUES)[number] {
  return typeof value === "string" && (IMPACT_VALUES as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isImpactCounts(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["blocking", "render_only", "advisory"]) &&
    isNonNegativeInteger(value.blocking) &&
    isNonNegativeInteger(value.render_only) &&
    isNonNegativeInteger(value.advisory)
  );
}

function isOperationSummary(
  value: unknown,
  expectedProjectId: string,
  expectedOperationId?: string,
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "operation_id",
      "project_id",
      "changed_artifact_id",
      "old_accepted_version_id",
      "new_accepted_version_id",
      "gate_decision_id",
      "created_at",
      "affected_version_count",
      "independent_path_count",
      "impact_counts",
      "strongest_effective_impact",
    ])
  ) {
    return false;
  }
  if (
    typeof value.operation_id !== "string" ||
    !OPERATION_ID_PATTERN.test(value.operation_id) ||
    (expectedOperationId !== undefined && value.operation_id !== expectedOperationId) ||
    value.project_id !== expectedProjectId ||
    typeof value.changed_artifact_id !== "string" ||
    !ARTIFACT_ID_PATTERN.test(value.changed_artifact_id) ||
    typeof value.old_accepted_version_id !== "string" ||
    !VERSION_ID_PATTERN.test(value.old_accepted_version_id) ||
    typeof value.new_accepted_version_id !== "string" ||
    !VERSION_ID_PATTERN.test(value.new_accepted_version_id) ||
    typeof value.gate_decision_id !== "string" ||
    !DECISION_ID_PATTERN.test(value.gate_decision_id) ||
    typeof value.created_at !== "string" ||
    value.created_at.length === 0 ||
    !isNonNegativeInteger(value.affected_version_count) ||
    !isNonNegativeInteger(value.independent_path_count) ||
    !isImpactCounts(value.impact_counts)
  ) {
    return false;
  }
  const counts = value.impact_counts as {
    blocking: number;
    render_only: number;
    advisory: number;
  };
  if (counts.blocking + counts.render_only + counts.advisory !== value.independent_path_count) {
    return false;
  }
  if (value.strongest_effective_impact === null) {
    return value.independent_path_count === 0 && value.affected_version_count === 0;
  }
  return isImpactValue(value.strongest_effective_impact) && value.independent_path_count > 0;
}

function isPathImpact(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "impact_id",
      "path_ordinal",
      "dependency_path",
      "path_relationships",
      "path_impacts",
      "effective_impact",
    ]) ||
    typeof value.impact_id !== "string" ||
    !IMPACT_ID_PATTERN.test(value.impact_id) ||
    !isNonNegativeInteger(value.path_ordinal) ||
    !isIdArray(value.dependency_path, DEPENDENCY_ID_PATTERN) ||
    value.dependency_path.length < 1 ||
    !Array.isArray(value.path_relationships) ||
    value.path_relationships.length < 1 ||
    !value.path_relationships.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 128,
    ) ||
    !Array.isArray(value.path_impacts) ||
    value.path_impacts.length < 1 ||
    !value.path_impacts.every(isImpactValue) ||
    !isImpactValue(value.effective_impact)
  ) {
    return false;
  }
  return (
    value.dependency_path.length === value.path_relationships.length &&
    value.dependency_path.length === value.path_impacts.length
  );
}

function isAffectedVersion(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "affected_artifact_id",
      "affected_version_id",
      "strongest_effective_impact",
      "general_stale",
      "general_blocked",
      "render_blocked",
      "paths",
    ]) ||
    typeof value.affected_artifact_id !== "string" ||
    !ARTIFACT_ID_PATTERN.test(value.affected_artifact_id) ||
    typeof value.affected_version_id !== "string" ||
    !VERSION_ID_PATTERN.test(value.affected_version_id) ||
    !isImpactValue(value.strongest_effective_impact) ||
    typeof value.general_stale !== "boolean" ||
    typeof value.general_blocked !== "boolean" ||
    typeof value.render_blocked !== "boolean" ||
    !Array.isArray(value.paths) ||
    value.paths.length < 1 ||
    !value.paths.every(isPathImpact)
  ) {
    return false;
  }
  const ordinals = value.paths.map((path) => (path as { path_ordinal: number }).path_ordinal);
  for (let index = 1; index < ordinals.length; index += 1) {
    if (ordinals[index]! <= ordinals[index - 1]!) return false;
  }
  return true;
}

export function isInvalidationOperationListResponse(
  value: unknown,
  expectedProjectId: string,
): value is InvalidationOperationListResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["project_id", "operations"]) ||
    value.data.project_id !== expectedProjectId ||
    !Array.isArray(value.data.operations)
  ) {
    return false;
  }
  return value.data.operations.every((operation) =>
    isOperationSummary(operation, expectedProjectId),
  );
}

export function isInvalidationOperationDetailResponse(
  value: unknown,
  expectedProjectId: string,
  expectedOperationId: string,
): value is InvalidationOperationDetailResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["operation", "affected_versions"]) ||
    !isOperationSummary(value.data.operation, expectedProjectId, expectedOperationId) ||
    !Array.isArray(value.data.affected_versions)
  ) {
    return false;
  }
  const operation = value.data.operation as {
    affected_version_count: number;
    independent_path_count: number;
  };
  if (!value.data.affected_versions.every(isAffectedVersion)) return false;
  if (value.data.affected_versions.length !== operation.affected_version_count) return false;
  const pathCount = value.data.affected_versions.reduce(
    (total, group) => total + (group as { paths: unknown[] }).paths.length,
    0,
  );
  return pathCount === operation.independent_path_count;
}
