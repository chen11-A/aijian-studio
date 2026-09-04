import type { components } from "./generated.js";

export type InvalidationOperationResponse = components["schemas"]["InvalidationOperationResponse"];

export type InvalidationOperationPageQuery = Readonly<{
  limit?: number;
  cursor?: string | null;
}>;

export type InvalidationOperationPageItem =
  components["schemas"]["InvalidationOperationSummaryData"];
export type InvalidationOperationPageResponse =
  components["schemas"]["InvalidationOperationPageResponse"];

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
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

export function validateInvalidationOperationPageQuery(
  value: unknown,
): InvalidationOperationPageQuery {
  if (value === undefined) return {};
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["limit", "cursor"]) ||
    Reflect.ownKeys(value).some((key) => key !== "limit" && key !== "cursor")
  ) {
    throw new Error("Invalidation operation page query must be an exact plain object");
  }
  if (
    value.limit !== undefined &&
    (typeof value.limit !== "number" ||
      !Number.isSafeInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > 100)
  ) {
    throw new Error("Invalidation operation page query limit must be a safe integer from 1 to 100");
  }
  if (
    value.cursor !== undefined &&
    value.cursor !== null &&
    (typeof value.cursor !== "string" || !OPERATION_ID_PATTERN.test(value.cursor))
  ) {
    throw new Error("Invalidation operation page query cursor must be a canonical operation id");
  }
  return {
    ...(value.limit === undefined ? {} : { limit: value.limit }),
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  };
}

function isInvalidationOperationPageItem(value: unknown, expectedProjectId: string): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "operation_id",
      "project_id",
      "changed_artifact_id",
      "old_accepted_version_id",
      "new_accepted_version_id",
      "gate_decision_id",
      "assessment_hash",
      "created_at",
      "reason_path_count",
    ]) &&
    typeof value.operation_id === "string" &&
    OPERATION_ID_PATTERN.test(value.operation_id) &&
    value.project_id === expectedProjectId &&
    typeof value.changed_artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(value.changed_artifact_id) &&
    typeof value.old_accepted_version_id === "string" &&
    VERSION_ID_PATTERN.test(value.old_accepted_version_id) &&
    typeof value.new_accepted_version_id === "string" &&
    VERSION_ID_PATTERN.test(value.new_accepted_version_id) &&
    typeof value.gate_decision_id === "string" &&
    GATE_DECISION_ID_PATTERN.test(value.gate_decision_id) &&
    typeof value.assessment_hash === "string" &&
    ASSESSMENT_HASH_PATTERN.test(value.assessment_hash) &&
    isAwareDateTime(value.created_at) &&
    typeof value.reason_path_count === "number" &&
    Number.isSafeInteger(value.reason_path_count) &&
    value.reason_path_count >= 0
  );
}

type KeysetTimestamp = Readonly<{ seconds: number; fraction: string }>;

function parseKeysetTimestamp(value: string): KeysetTimestamp | null {
  const match = ISO_AWARE_DATETIME_PATTERN.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[7]!;
  const offsetSeconds =
    offset === "Z"
      ? 0
      : (offset[0] === "+" ? 1 : -1) *
        (Number(offset.slice(1, 3)) * 60 * 60 + Number(offset.slice(4, 6)) * 60);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const fractionStart = value.indexOf(".");
  const fraction =
    fractionStart === -1 ? "" : value.slice(fractionStart + 1, value.length - offset.length);
  return { seconds: date.getTime() / 1000 - offsetSeconds, fraction };
}

function compareFractions(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = left[index] ?? "0";
    const rightDigit = right[index] ?? "0";
    if (leftDigit !== rightDigit) return leftDigit > rightDigit ? 1 : -1;
  }
  return 0;
}

function isStrictlyDescendingInvalidationOperationPageItems(items: readonly unknown[]): boolean {
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1] as Record<string, unknown>;
    const current = items[index] as Record<string, unknown>;
    if (
      typeof previous.created_at !== "string" ||
      typeof current.created_at !== "string" ||
      typeof previous.operation_id !== "string" ||
      typeof current.operation_id !== "string"
    ) {
      return false;
    }
    const previousTimestamp = parseKeysetTimestamp(previous.created_at);
    const currentTimestamp = parseKeysetTimestamp(current.created_at);
    if (previousTimestamp === null || currentTimestamp === null) return false;
    if (previousTimestamp.seconds !== currentTimestamp.seconds) {
      if (previousTimestamp.seconds < currentTimestamp.seconds) return false;
      continue;
    }
    const fractionOrder = compareFractions(previousTimestamp.fraction, currentTimestamp.fraction);
    if (fractionOrder !== 0) {
      if (fractionOrder < 0) return false;
      continue;
    }
    if (previous.operation_id <= current.operation_id) return false;
  }
  return true;
}

export function isInvalidationOperationPageResponse(
  value: unknown,
  expectedProjectId: string,
  query: InvalidationOperationPageQuery = {},
): value is InvalidationOperationPageResponse {
  let normalizedQuery: InvalidationOperationPageQuery;
  try {
    normalizedQuery = validateInvalidationOperationPageQuery(query);
  } catch {
    return false;
  }
  const effectivePageLimit = normalizedQuery.limit ?? 20;
  if (
    !PROJECT_ID_PATTERN.test(expectedProjectId) ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["items", "next_cursor"]) ||
    !Array.isArray(value.data.items) ||
    value.data.items.length > effectivePageLimit ||
    value.data.items.length > 100 ||
    !value.data.items.every((item) => isInvalidationOperationPageItem(item, expectedProjectId)) ||
    !isStrictlyDescendingInvalidationOperationPageItems(value.data.items) ||
    new Set(value.data.items.map((item) => item.operation_id)).size !== value.data.items.length ||
    (value.data.next_cursor !== null &&
      (typeof value.data.next_cursor !== "string" ||
        !OPERATION_ID_PATTERN.test(value.data.next_cursor))) ||
    (value.data.next_cursor !== null && value.data.items.length !== effectivePageLimit) ||
    (value.data.next_cursor !== null &&
      (value.data.items.length === 0 ||
        value.data.next_cursor !== value.data.items.at(-1)?.operation_id)) ||
    (typeof normalizedQuery.cursor === "string" &&
      (value.data.next_cursor === normalizedQuery.cursor ||
        value.data.items.some((item) => item.operation_id === normalizedQuery.cursor))) ||
    typeof value.request_id !== "string" ||
    !UUID_PATTERN.test(value.request_id)
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
