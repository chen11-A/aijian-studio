import type { components } from "./generated.js";

export type InvalidationOperationResponse = components["schemas"]["InvalidationOperationResponse"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^ivo_[0-9a-f]{32}$/;
const PATH_ID_PATTERN = /^ivp_[0-9a-f]{32}$/;
const ARTIFACT_ID_PATTERN = /^art_[0-9a-f]{32}$/;
const VERSION_ID_PATTERN = /^ver_[0-9a-f]{32}$/;
const GATE_DECISION_ID_PATTERN = /^dec_[0-9a-f]{32}$/;
const DEPENDENCY_ID_PATTERN = /^dep_[0-9a-f]{32}$/;
const ASSESSMENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ISO_AWARE_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_DATA_UTF8_BYTES = 4 * 1024 * 1024;
const IMPACTS = new Set(["blocking", "advisory", "render_only"]);
const CLASSIFICATIONS = new Set(["STALE", "INVALIDATE"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isAwareDateTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = ISO_AWARE_DATETIME_PATTERN.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[7]!;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthLengths[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (offset === "Z") return true;

  const offsetHour = Number(offset.slice(1, 3));
  const offsetMinute = Number(offset.slice(4, 6));
  return offsetHour <= 23 && offsetMinute <= 59;
}

function isWithinDataByteLimit(data: Record<string, unknown>): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(data)).byteLength <= MAX_DATA_UTF8_BYTES;
  } catch {
    return false;
  }
}

function isImpact(value: unknown): boolean {
  return typeof value === "string" && IMPACTS.has(value);
}

function isReasonPath(
  value: unknown,
  expectedProjectId: string,
  expectedOperationId: string,
  ordinal: number,
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "path_id",
      "operation_id",
      "project_id",
      "affected_artifact_id",
      "affected_version_id",
      "classification",
      "aggregate_impact",
      "dependency_ids",
      "relationships",
      "edge_impacts",
      "effective_impact",
      "ordinal",
      "created_at",
    ]) ||
    typeof value.path_id !== "string" ||
    !PATH_ID_PATTERN.test(value.path_id) ||
    value.operation_id !== expectedOperationId ||
    value.project_id !== expectedProjectId ||
    typeof value.affected_artifact_id !== "string" ||
    !ARTIFACT_ID_PATTERN.test(value.affected_artifact_id) ||
    typeof value.affected_version_id !== "string" ||
    !VERSION_ID_PATTERN.test(value.affected_version_id) ||
    typeof value.classification !== "string" ||
    !CLASSIFICATIONS.has(value.classification) ||
    !isImpact(value.aggregate_impact) ||
    !Array.isArray(value.dependency_ids) ||
    !Array.isArray(value.relationships) ||
    !Array.isArray(value.edge_impacts) ||
    value.dependency_ids.length === 0 ||
    value.dependency_ids.length !== value.relationships.length ||
    value.dependency_ids.length !== value.edge_impacts.length ||
    !value.dependency_ids.every(
      (dependencyId) =>
        typeof dependencyId === "string" && DEPENDENCY_ID_PATTERN.test(dependencyId),
    ) ||
    !value.relationships.every(
      (relationship) => typeof relationship === "string" && relationship.length > 0,
    ) ||
    !value.edge_impacts.every(isImpact) ||
    !isImpact(value.effective_impact) ||
    typeof value.ordinal !== "number" ||
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 0 ||
    value.ordinal !== ordinal ||
    !isAwareDateTime(value.created_at)
  ) {
    return false;
  }
  return true;
}

export function isInvalidationOperationResponse(
  value: unknown,
  expectedProjectId: string,
  expectedOperationId: string,
): value is InvalidationOperationResponse {
  if (
    !PROJECT_ID_PATTERN.test(expectedProjectId) ||
    !OPERATION_ID_PATTERN.test(expectedOperationId) ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "operation_id",
      "project_id",
      "changed_artifact_id",
      "old_accepted_version_id",
      "new_accepted_version_id",
      "gate_decision_id",
      "assessment_hash",
      "created_at",
      "paths",
    ]) ||
    value.data.operation_id !== expectedOperationId ||
    value.data.project_id !== expectedProjectId ||
    typeof value.data.changed_artifact_id !== "string" ||
    !ARTIFACT_ID_PATTERN.test(value.data.changed_artifact_id) ||
    typeof value.data.old_accepted_version_id !== "string" ||
    !VERSION_ID_PATTERN.test(value.data.old_accepted_version_id) ||
    typeof value.data.new_accepted_version_id !== "string" ||
    !VERSION_ID_PATTERN.test(value.data.new_accepted_version_id) ||
    typeof value.data.gate_decision_id !== "string" ||
    !GATE_DECISION_ID_PATTERN.test(value.data.gate_decision_id) ||
    typeof value.data.assessment_hash !== "string" ||
    !ASSESSMENT_HASH_PATTERN.test(value.data.assessment_hash) ||
    !isAwareDateTime(value.data.created_at) ||
    !Array.isArray(value.data.paths) ||
    value.data.paths.length > 10_000 ||
    !value.data.paths.every((path, ordinal) =>
      isReasonPath(path, expectedProjectId, expectedOperationId, ordinal),
    ) ||
    !isWithinDataByteLimit(value.data) ||
    typeof value.request_id !== "string" ||
    !UUID_PATTERN.test(value.request_id)
  ) {
    return false;
  }
  return true;
}
