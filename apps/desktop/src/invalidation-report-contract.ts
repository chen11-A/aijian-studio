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
type ImpactValue = (typeof IMPACT_VALUES)[number];

/** T04 path algebra rank: advisory < render_only < blocking. */
const IMPACT_RANK: Record<ImpactValue, number> = {
  advisory: 1,
  render_only: 2,
  blocking: 3,
};

/** ISO-8601 event time with explicit timezone (Z or numeric offset). */
const ISO_EVENT_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

export function isOperationId(value: string): boolean {
  return OPERATION_ID_PATTERN.test(value);
}

function isImpactValue(value: unknown): value is ImpactValue {
  return typeof value === "string" && (IMPACT_VALUES as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isEventTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const match = ISO_EVENT_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  // Reject invalid calendar dates (e.g. 2026-02-30) by round-tripping UTC components.
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(utcMillis)) return false;
  const probe = new Date(utcMillis);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return false;
  }

  // Offset form must also parse as a real instant; timezone-less already failed the regex.
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function impactMin(left: ImpactValue, right: ImpactValue): ImpactValue {
  return IMPACT_RANK[left] <= IMPACT_RANK[right] ? left : right;
}

function effectivePathImpact(pathImpacts: readonly ImpactValue[]): ImpactValue | null {
  if (pathImpacts.length === 0) return null;
  let effective = pathImpacts[0]!;
  for (let index = 1; index < pathImpacts.length; index += 1) {
    effective = impactMin(effective, pathImpacts[index]!);
  }
  return effective;
}

function strongestImpact(impacts: readonly ImpactValue[]): ImpactValue | null {
  if (impacts.length === 0) return null;
  let strongest = impacts[0]!;
  for (let index = 1; index < impacts.length; index += 1) {
    const candidate = impacts[index]!;
    if (IMPACT_RANK[candidate] > IMPACT_RANK[strongest]) {
      strongest = candidate;
    }
  }
  return strongest;
}

function strongestFromCounts(counts: {
  blocking: number;
  render_only: number;
  advisory: number;
}): ImpactValue | null {
  if (counts.blocking > 0) return "blocking";
  if (counts.render_only > 0) return "render_only";
  if (counts.advisory > 0) return "advisory";
  return null;
}

function isImpactCounts(value: unknown): value is {
  blocking: number;
  render_only: number;
  advisory: number;
} {
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
    !isEventTimestamp(value.created_at) ||
    !isNonNegativeInteger(value.affected_version_count) ||
    !isNonNegativeInteger(value.independent_path_count) ||
    !isImpactCounts(value.impact_counts)
  ) {
    return false;
  }

  const counts = value.impact_counts;
  const pathTotal = counts.blocking + counts.render_only + counts.advisory;
  if (pathTotal !== value.independent_path_count) return false;

  // Zero and nonzero summaries must be internally coherent.
  if (value.strongest_effective_impact === null) {
    return (
      value.independent_path_count === 0 &&
      value.affected_version_count === 0 &&
      pathTotal === 0
    );
  }
  if (!isImpactValue(value.strongest_effective_impact)) return false;
  if (value.independent_path_count === 0 || value.affected_version_count === 0) return false;
  if (value.independent_path_count < value.affected_version_count) return false;
  return strongestFromCounts(counts) === value.strongest_effective_impact;
}

type PathImpactRecord = {
  impact_id: string;
  path_ordinal: number;
  dependency_path: string[];
  path_relationships: string[];
  path_impacts: ImpactValue[];
  effective_impact: ImpactValue;
};

function isPathImpact(value: unknown): value is PathImpactRecord {
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
  if (
    value.dependency_path.length !== value.path_relationships.length ||
    value.dependency_path.length !== value.path_impacts.length
  ) {
    return false;
  }
  // Prove effective_impact equals T04 least-restrictive edge algebra.
  const recomputed = effectivePathImpact(value.path_impacts);
  return recomputed === value.effective_impact;
}

type AffectedVersionRecord = {
  affected_artifact_id: string;
  affected_version_id: string;
  strongest_effective_impact: ImpactValue;
  general_stale: boolean;
  general_blocked: boolean;
  render_blocked: boolean;
  paths: PathImpactRecord[];
};

function isAffectedVersion(value: unknown): value is AffectedVersionRecord {
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

  const paths = value.paths;
  // Paths must be ascending by path_ordinal within the group.
  for (let index = 1; index < paths.length; index += 1) {
    if (paths[index]!.path_ordinal <= paths[index - 1]!.path_ordinal) return false;
  }

  const pathEffectives = paths.map((path) => path.effective_impact);
  const strongest = strongestImpact(pathEffectives);
  if (strongest === null || strongest !== value.strongest_effective_impact) return false;

  const hasBlocking = pathEffectives.some((impact) => impact === "blocking");
  if (value.general_stale !== hasBlocking) return false;
  if (value.general_blocked !== hasBlocking) return false;
  if (value.render_blocked !== (strongest === "blocking" || strongest === "render_only")) {
    return false;
  }
  return true;
}

function isStrictlyAscendingOperationOrder(
  operations: ReadonlyArray<{ created_at: string; operation_id: string }>,
): boolean {
  const seenIds = new Set<string>();
  for (let index = 0; index < operations.length; index += 1) {
    const current = operations[index]!;
    if (seenIds.has(current.operation_id)) return false;
    seenIds.add(current.operation_id);
    if (index === 0) continue;
    const previous = operations[index - 1]!;
    if (previous.created_at < current.created_at) continue;
    if (previous.created_at === current.created_at && previous.operation_id < current.operation_id) {
      continue;
    }
    return false;
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
  if (!value.data.operations.every((operation) => isOperationSummary(operation, expectedProjectId))) {
    return false;
  }
  return isStrictlyAscendingOperationOrder(
    value.data.operations as Array<{ created_at: string; operation_id: string }>,
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
    impact_counts: { blocking: number; render_only: number; advisory: number };
    strongest_effective_impact: ImpactValue | null;
  };
  const groups = value.data.affected_versions;
  if (!groups.every(isAffectedVersion)) return false;
  if (groups.length !== operation.affected_version_count) return false;

  // Groups must be sorted by (affected_artifact_id, affected_version_id) with no duplicates.
  const seenGroupKeys = new Set<string>();
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] as AffectedVersionRecord;
    const key = `${group.affected_artifact_id}\0${group.affected_version_id}`;
    if (seenGroupKeys.has(key)) return false;
    seenGroupKeys.add(key);
    if (index === 0) continue;
    const previous = groups[index - 1] as AffectedVersionRecord;
    if (previous.affected_artifact_id < group.affected_artifact_id) continue;
    if (
      previous.affected_artifact_id === group.affected_artifact_id &&
      previous.affected_version_id < group.affected_version_id
    ) {
      continue;
    }
    return false;
  }

  // Flatten paths: unique impact IDs and global ordinals exactly 0..N-1.
  const allPaths: PathImpactRecord[] = [];
  const seenImpactIds = new Set<string>();
  for (const group of groups as AffectedVersionRecord[]) {
    for (const path of group.paths) {
      if (seenImpactIds.has(path.impact_id)) return false;
      seenImpactIds.add(path.impact_id);
      allPaths.push(path);
    }
  }
  if (allPaths.length !== operation.independent_path_count) return false;

  const ordinals = allPaths.map((path) => path.path_ordinal).sort((left, right) => left - right);
  if (ordinals.length !== allPaths.length) return false;
  for (let index = 0; index < ordinals.length; index += 1) {
    if (ordinals[index] !== index) return false;
  }

  // Operation counts and strongest must agree with nested path effective impacts.
  let blocking = 0;
  let renderOnly = 0;
  let advisory = 0;
  const effectives: ImpactValue[] = [];
  for (const path of allPaths) {
    effectives.push(path.effective_impact);
    if (path.effective_impact === "blocking") blocking += 1;
    else if (path.effective_impact === "render_only") renderOnly += 1;
    else advisory += 1;
  }
  if (
    operation.impact_counts.blocking !== blocking ||
    operation.impact_counts.render_only !== renderOnly ||
    operation.impact_counts.advisory !== advisory
  ) {
    return false;
  }
  return strongestImpact(effectives) === operation.strongest_effective_impact;
}
