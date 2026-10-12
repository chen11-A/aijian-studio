import type { components } from "./generated.js";
import { isProjectAspectRatio } from "./project-aspect.js";
import { visualJson } from "./visual-bible.js";

export type ProjectSettings = components["schemas"]["ProjectSettingsDataV1"];
export type SettingsCommand = components["schemas"]["UpdateProjectSettingsRequestV1"];
export type SettingsResponse = components["schemas"]["ProjectSettingsResponseV1"];
export type SettingsReceipt = components["schemas"]["ProjectSettingsReceiptResponseV1"];
export type SettingsResult<T> =
  | { kind: "FOUND"; receipt: T }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" };
export type ProjectSettingsGateway = {
  getProjectSettings(projectId: string): Promise<SettingsResult<SettingsResponse>>;
  getProjectSettingsReceipt(
    projectId: string,
    operationId: string,
  ): Promise<SettingsResult<SettingsReceipt>>;
  updateProjectSettings(
    projectId: string,
    command: SettingsCommand,
  ): Promise<SettingsResult<SettingsReceipt>>;
};
export const SETTINGS_CHANNELS = {
  read: "aivora:project-settings:read",
  receipt: "aivora:project-settings:receipt",
  write: "aivora:project-settings:write",
} as const;
export const settingsProjectId = (v: unknown): v is string =>
  typeof v === "string" && /^prj_[0-9a-f]{32}$/.test(v);
export const settingsOperationId = (v: unknown): v is string =>
  typeof v === "string" && /^pso_[0-9a-f]{32}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const revision = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const text = (v: unknown, limit: number, multiline = false): v is string =>
  typeof v === "string" &&
  [...v].length <= limit &&
  ![...v].some((c) => /\p{C}/u.test(c) && !(multiline && c === "\n"));
const date = (v: unknown) =>
  typeof v === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export function settingsTimebase(
  v: unknown,
): v is NonNullable<ProjectSettings["sequence_timebase"]> {
  return (
    exact(v, ["frame_rate", "timecode_mode"]) &&
    exact(v.frame_rate, ["num", "den"]) &&
    ["24000/1001", "24/1", "25/1", "30000/1001"].includes(
      `${v.frame_rate.num}/${v.frame_rate.den}`,
    ) &&
    typeof v.frame_rate.num === "number" &&
    typeof v.frame_rate.den === "number" &&
    (v.timecode_mode === "NON_DROP_FRAME" ||
      (v.timecode_mode === "DROP_FRAME" && v.frame_rate.num === 30000 && v.frame_rate.den === 1001))
  );
}
export function settingsCommand(v: unknown): v is SettingsCommand {
  if (
    !exact(v, ["operation_id", "expected_project_revision", "changes"]) ||
    !settingsOperationId(v.operation_id) ||
    !revision(v.expected_project_revision) ||
    v.expected_project_revision >= Number.MAX_SAFE_INTEGER ||
    !record(v.changes)
  )
    return false;
  const c = v.changes;
  return (
    Object.keys(c).length > 0 &&
    Object.keys(c).every((k) =>
      ["name", "status", "description", "sequence_timebase"].includes(k),
    ) &&
    (!Object.hasOwn(c, "name") ||
      (text(c.name, 80) && c.name.length > 0 && c.name === c.name.trim())) &&
    (!Object.hasOwn(c, "status") || c.status === "active" || c.status === "archived") &&
    (!Object.hasOwn(c, "description") || text(c.description, 4000, true)) &&
    (!Object.hasOwn(c, "sequence_timebase") ||
      c.sequence_timebase === null ||
      settingsTimebase(c.sequence_timebase))
  );
}
export function settingsData(v: unknown, projectId: string): v is ProjectSettings {
  return (
    exact(v, [
      "schema_version",
      "project_id",
      "name",
      "status",
      "description",
      "sequence_timebase",
      "aspect_ratio",
      "target_duration_seconds",
      "source_language",
      "revision",
      "created_at",
      "updated_at",
    ]) &&
    v.schema_version === 1 &&
    settingsProjectId(projectId) &&
    v.project_id === projectId &&
    text(v.name, 80) &&
    v.name.length > 0 &&
    (v.status === "active" || v.status === "archived") &&
    text(v.description, 4000, true) &&
    (v.sequence_timebase === null || settingsTimebase(v.sequence_timebase)) &&
    isProjectAspectRatio(v.aspect_ratio) &&
    revision(v.target_duration_seconds) &&
    v.source_language === "zh-CN" &&
    revision(v.revision) &&
    date(v.created_at) &&
    date(v.updated_at)
  );
}
const BOUNDARY = {
  settings_scope: "PROJECT_METADATA_ONLY",
  existing_artifact_versions_modified: false,
  sequence_timebase_effect: "DECLARED_DEFAULT_REQUIRES_EXPLICIT_ADOPTION",
  aspect_duration_language: "READ_ONLY_PENDING_CONSUMER_CAPABILITIES",
  episode_settings: "SEPARATE_EPISODE_CAS",
  production_intent: "SEPARATE_PRODUCTION_BRIEF_VERSION",
  generation_remote_version_policies: "NO_EDITABLE_PROJECT_POLICY_CONTRACT",
} as const;
function envelope(v: unknown, requestId?: string | null): v is Record<string, unknown> {
  return (
    exact(v, ["data", "boundary", "request_id"]) &&
    uuid(v.request_id) &&
    (requestId === undefined || v.request_id === requestId) &&
    visualJson(v.boundary) === visualJson(BOUNDARY)
  );
}
export function settingsResponse(
  v: unknown,
  projectId: string,
  requestId?: string | null,
): v is SettingsResponse {
  return envelope(v, requestId) && settingsData(v.data, projectId);
}
export function settingsReceipt(
  v: unknown,
  projectId: string,
  operationId: string,
  requestId?: string | null,
): v is SettingsReceipt {
  if (
    !envelope(v, requestId) ||
    !exact(v.data, [
      "operation_id",
      "project_id",
      "request_hash",
      "base_revision",
      "result_revision",
      "result",
      "created_at",
    ])
  )
    return false;
  const r = v.data;
  return (
    settingsOperationId(operationId) &&
    r.operation_id === operationId &&
    r.project_id === projectId &&
    typeof r.request_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(r.request_hash) &&
    revision(r.base_revision) &&
    revision(r.result_revision) &&
    [r.base_revision, r.base_revision + 1].includes(r.result_revision) &&
    settingsData(r.result, projectId) &&
    r.result.revision === r.result_revision &&
    date(r.created_at)
  );
}
export function settingsIdentity(projectId: string, command: SettingsCommand) {
  return visualJson({ project_id: projectId, ...command });
}
export function settingsReceiptMatches(
  receipt: SettingsReceipt,
  command: SettingsCommand,
  requestHash: string,
): boolean {
  return (
    receipt.data.request_hash === requestHash &&
    receipt.data.base_revision === command.expected_project_revision &&
    receipt.data.operation_id === command.operation_id &&
    Object.entries(command.changes).every(
      ([key, value]) =>
        visualJson(value) === visualJson(receipt.data.result[key as keyof ProjectSettings]),
    )
  );
}
export function settingsError(
  status: number,
  v: unknown,
  requestId: string | null,
): { kind: "REJECTED"; status: number; code: string } | null {
  const allowed: Record<number, string[]> = {
    401: ["SIDECAR_AUTH_REQUIRED"],
    403: ["SIDECAR_REQUEST_REJECTED"],
    404: ["PROJECT_NOT_FOUND", "PROJECT_SETTINGS_RECEIPT_NOT_FOUND"],
    409: ["PROJECT_SETTINGS_CONFLICT"],
    422: ["VALIDATION_ERROR"],
  };
  return exact(v, ["error", "request_id"]) &&
    uuid(v.request_id) &&
    v.request_id === requestId &&
    exact(v.error, ["code", "message", "details", "retryable"]) &&
    typeof v.error.code === "string" &&
    allowed[status]?.includes(v.error.code) &&
    typeof v.error.message === "string" &&
    record(v.error.details) &&
    v.error.retryable === false
    ? { kind: "REJECTED", status, code: v.error.code }
    : null;
}

export function settingsWriteRejection(
  v: unknown,
): v is { kind: "REJECTED"; status: number; code: string } {
  const allowed: Record<number, string[]> = {
    401: ["SIDECAR_AUTH_REQUIRED"],
    403: ["SIDECAR_REQUEST_REJECTED"],
    404: ["PROJECT_NOT_FOUND"],
    409: ["PROJECT_SETTINGS_CONFLICT"],
    422: ["VALIDATION_ERROR"],
  };
  return (
    exact(v, ["kind", "status", "code"]) &&
    v.kind === "REJECTED" &&
    typeof v.status === "number" &&
    typeof v.code === "string" &&
    !!allowed[v.status]?.includes(v.code)
  );
}
