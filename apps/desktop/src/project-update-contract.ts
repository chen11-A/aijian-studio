import type { components } from "@aijian/contracts";
import { hasControlCharacter, hasRequestId, isRecord } from "./api-contract-guards";

export type ProjectResponse = components["schemas"]["ProjectResponse"];
export type ProjectUpdateCommand = {
  expectedRevision: number;
  name?: string;
  status?: "active" | "archived";
};
export type ProjectUpdateResult =
  | { kind: "SUCCEEDED"; receipt: ProjectResponse }
  | { kind: "INVALID_INPUT" }
  | {
      kind: "DEFINITE_SERVER_ERROR";
      status: 401 | 403 | 404 | 409 | 412 | 422 | 428;
      code: string;
      request_id: string;
    }
  | { kind: "REMOTE_UNKNOWN" };

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const PROJECT_DATA_KEYS = [
  "id", "name", "aspect_ratio", "target_duration_seconds", "source_language",
  "status", "revision", "created_at", "updated_at",
];
const ERROR_CODES = new Map<number, string>([
  [401, "SIDECAR_AUTH_REQUIRED"],
  [403, "SIDECAR_REQUEST_REJECTED"],
  [404, "PROJECT_NOT_FOUND"],
  [409, "PROJECT_CONFLICT"],
  [412, "PROJECT_PRECONDITION_FAILED"],
  [422, "VALIDATION_ERROR"],
  [428, "PROJECT_PRECONDITION_REQUIRED"],
]);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isProjectUpdateId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

export function normalizeProjectUpdateCommand(value: unknown): ProjectUpdateCommand | null {
  if (!isRecord(value) || !Object.keys(value).every((key) =>
    key === "expectedRevision" || key === "name" || key === "status")) return null;
  const revision = value.expectedRevision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 ||
      revision >= Number.MAX_SAFE_INTEGER) return null;
  const hasName = Object.prototype.hasOwnProperty.call(value, "name");
  const hasStatus = Object.prototype.hasOwnProperty.call(value, "status");
  if (!hasName && !hasStatus) return null;
  let name: string | undefined;
  if (hasName) {
    if (typeof value.name !== "string") return null;
    name = value.name.trim();
    if (name.length === 0 || [...name].length > 80 || hasControlCharacter(name)) return null;
  }
  if (hasStatus && value.status !== "active" && value.status !== "archived") return null;
  return {
    expectedRevision: revision,
    ...(hasName ? { name } : {}),
    ...(hasStatus ? { status: value.status as "active" | "archived" } : {}),
  };
}

export function isProjectUpdateReceipt(
  value: unknown,
  projectId: string,
  command: ProjectUpdateCommand,
  etag: string | null,
  requestId: string | null,
): value is ProjectResponse {
  if (!isRecord(value) || !hasExactKeys(value, ["data", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId || !isRecord(value.data)) return false;
  const data = value.data;
  return hasExactKeys(data, PROJECT_DATA_KEYS) &&
    data.id === projectId &&
    typeof data.name === "string" &&
    data.aspect_ratio === "9:16" &&
    typeof data.target_duration_seconds === "number" &&
    Number.isSafeInteger(data.target_duration_seconds) &&
    data.source_language === "zh-CN" &&
    (data.status === "active" || data.status === "archived") &&
    typeof data.revision === "number" &&
    Number.isSafeInteger(data.revision) &&
    (data.revision === command.expectedRevision ||
      data.revision === command.expectedRevision + 1) &&
    typeof data.created_at === "string" &&
    typeof data.updated_at === "string" &&
    (command.name === undefined || data.name === command.name) &&
    (command.status === undefined || data.status === command.status) &&
    etag === `"revision-${data.revision}"`;
}

export function projectUpdateDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): Extract<ProjectUpdateResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (!isRecord(value) || !hasExactKeys(value, ["error", "request_id"]) ||
      !hasRequestId(value) || value.request_id !== requestId || !isRecord(value.error) ||
      !hasExactKeys(value.error, ["code", "message", "retryable", "details"])) return null;
  const error = value.error;
  if (typeof error.code !== "string" || error.code !== ERROR_CODES.get(status) ||
      typeof error.message !== "string" ||
      error.retryable !== false || !isRecord(error.details) ||
      Object.values(error.details).some((detail) => typeof detail !== "string")) return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status: status as Extract<ProjectUpdateResult, { kind: "DEFINITE_SERVER_ERROR" }>["status"],
    code: error.code,
    request_id: value.request_id as string,
  };
}
