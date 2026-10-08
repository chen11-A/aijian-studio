import type { components } from "@aijian/contracts";

import { hasControlCharacter, hasOnlyKeys, hasRequestId, isRecord } from "./api-contract-guards";

export type CreateEpisodeInput = components["schemas"]["CreateEpisodeRequest"];
export type EpisodeData = components["schemas"]["EpisodeData"];
export type EpisodeListResponse = components["schemas"]["EpisodeListResponse"];
export type EpisodeResponse = components["schemas"]["EpisodeResponse"];
export type EpisodeListQuery = { limit?: number; offset?: string };
export type EpisodeCreateErrorCode =
  | "SIDECAR_AUTH_REQUIRED"
  | "SIDECAR_REQUEST_REJECTED"
  | "PROJECT_NOT_FOUND"
  | "EPISODE_NOT_FOUND"
  | "EPISODE_CREATE_CONFLICT"
  | "VALIDATION_ERROR";

export type EpisodeCreateResult =
  | { kind: "SUCCEEDED"; receipt: EpisodeResponse }
  | {
      kind: "DEFINITE_SERVER_ERROR";
      status: 401 | 403 | 404 | 409 | 422;
      code: EpisodeCreateErrorCode;
      request_id: string;
    }
  | { kind: "REMOTE_UNKNOWN" };

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const EPISODE_ID_PATTERN = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const INT64_MAX = "9223372036854775807";
const PYTHON_STRIP_CODE_POINTS = new Set([
  9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const EPISODE_ERROR_CODES = new Set<EpisodeCreateErrorCode>([
  "SIDECAR_AUTH_REQUIRED",
  "SIDECAR_REQUEST_REJECTED",
  "PROJECT_NOT_FOUND",
  "EPISODE_NOT_FOUND",
  "EPISODE_CREATE_CONFLICT",
  "VALIDATION_ERROR",
]);

function isCanonicalDecimal(value: unknown, minimum: "0" | "1"): value is string {
  if (typeof value !== "string") return false;
  const pattern = minimum === "0" ? /^(?:0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (!pattern.test(value)) return false;
  return (
    value.length < INT64_MAX.length || (value.length === INT64_MAX.length && value <= INT64_MAX)
  );
}

function compareCanonicalDecimals(left: string, right: string): number {
  return left.length === right.length ? left.localeCompare(right) : left.length - right.length;
}

function pythonStrip(value: string): string {
  const codePoints = Array.from(value);
  let start = 0;
  let end = codePoints.length;
  while (start < end && PYTHON_STRIP_CODE_POINTS.has(codePoints[start]!.codePointAt(0)!))
    start += 1;
  while (end > start && PYTHON_STRIP_CODE_POINTS.has(codePoints[end - 1]!.codePointAt(0)!))
    end -= 1;
  return codePoints.slice(start, end).join("");
}

function isTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return (
    month! >= 1 &&
    month! <= 12 &&
    day! >= 1 &&
    day! <= new Date(Date.UTC(year!, month!, 0)).getUTCDate() &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number(value.slice(17, 19)) < 60
  );
}

export function isEpisodeProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

export function isEpisodeId(value: unknown): value is string {
  return typeof value === "string" && EPISODE_ID_PATTERN.test(value);
}

export function normalizeEpisodeCreateInput(value: unknown): CreateEpisodeInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["title", "target_duration_seconds"])) return null;
  if (typeof value.title !== "string") return null;
  const title = pythonStrip(value.title);
  if (title.length === 0 || Array.from(title).length > 80 || hasControlCharacter(title))
    return null;
  if (!Object.hasOwn(value, "target_duration_seconds")) return { title };
  if (
    value.target_duration_seconds !== null &&
    !isCanonicalDecimal(value.target_duration_seconds, "1")
  ) {
    return null;
  }
  return { title, target_duration_seconds: value.target_duration_seconds };
}

export function validateEpisodeListQuery(value: unknown = {}): EpisodeListQuery | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["limit", "offset"])) return null;
  if (
    (value.limit !== undefined &&
      (typeof value.limit !== "number" ||
        !Number.isInteger(value.limit) ||
        value.limit < 1 ||
        value.limit > 100)) ||
    (value.offset !== undefined && !isCanonicalDecimal(value.offset, "0"))
  ) {
    return null;
  }
  const query: EpisodeListQuery = {};
  if (value.limit !== undefined) query.limit = value.limit;
  if (value.offset !== undefined) query.offset = value.offset;
  return query;
}

function isEpisodeData(
  value: unknown,
  projectId: string,
  episodeId?: string,
): value is EpisodeData {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "id",
      "project_id",
      "position",
      "title",
      "is_default",
      "target_duration_seconds",
      "revision",
      "created_at",
      "updated_at",
    ]) &&
    isEpisodeId(value.id) &&
    value.project_id === projectId &&
    (episodeId === undefined || value.id === episodeId) &&
    isCanonicalDecimal(value.position, "1") &&
    typeof value.title === "string" &&
    typeof value.is_default === "boolean" &&
    (value.target_duration_seconds === null ||
      isCanonicalDecimal(value.target_duration_seconds, "1")) &&
    isCanonicalDecimal(value.revision, "1") &&
    isTimestamp(value.created_at) &&
    isTimestamp(value.updated_at)
  );
}

export function isEpisodeResponse(
  value: unknown,
  projectId: string,
  episodeId?: string,
): value is EpisodeResponse {
  return (
    isEpisodeProjectId(projectId) &&
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    isEpisodeData(value.data, projectId, episodeId)
  );
}

export function isEpisodeListResponse(
  value: unknown,
  projectId: string,
  expectedLimit: number,
): value is EpisodeListResponse {
  if (
    !isEpisodeProjectId(projectId) ||
    !Number.isInteger(expectedLimit) ||
    expectedLimit < 1 ||
    expectedLimit > 100 ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !Array.isArray(value.data) ||
    value.data.length > expectedLimit ||
    !value.data.every((entry) => isEpisodeData(entry, projectId))
  ) {
    return false;
  }
  const ids = new Set<string>();
  let previousPosition: string | undefined;
  for (const entry of value.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.position !== "string")
      return false;
    if (
      ids.has(entry.id) ||
      (previousPosition && compareCanonicalDecimals(previousPosition, entry.position) >= 0)
    ) {
      return false;
    }
    ids.add(entry.id);
    previousPosition = entry.position;
  }
  return true;
}

export function isEpisodeCreateErrorResponse(
  value: unknown,
  status: number,
): value is { error: { code: EpisodeCreateErrorCode }; request_id: string } {
  return (
    [401, 403, 404, 409, 422].includes(status) &&
    isRecord(value) &&
    hasOnlyKeys(value, ["error", "request_id"]) &&
    hasRequestId(value) &&
    isRecord(value.error) &&
    hasOnlyKeys(value.error, ["code", "message", "retryable", "details"]) &&
    typeof value.error.code === "string" &&
    EPISODE_ERROR_CODES.has(value.error.code as EpisodeCreateErrorCode) &&
    ((status === 401 && value.error.code === "SIDECAR_AUTH_REQUIRED") ||
      (status === 403 && value.error.code === "SIDECAR_REQUEST_REJECTED") ||
      (status === 404 &&
        (value.error.code === "PROJECT_NOT_FOUND" || value.error.code === "EPISODE_NOT_FOUND")) ||
      (status === 409 && value.error.code === "EPISODE_CREATE_CONFLICT") ||
      (status === 422 && value.error.code === "VALIDATION_ERROR")) &&
    typeof value.error.message === "string" &&
    typeof value.error.retryable === "boolean" &&
    isRecord(value.error.details) &&
    Object.values(value.error.details).every((detail) => typeof detail === "string")
  );
}
