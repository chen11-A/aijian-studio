export type DevelopmentExportCreateInput = {
  operation_id: string;
  timeline_version_id: string;
  expected_revision: number;
  purpose: "DEVELOPMENT_EVIDENCE";
};

export type DevelopmentExportOutput = {
  workspace_scope: "SIDECAR_WORKSPACE";
  relative_path: string;
  mime_type: "video/mp4";
  sha256: string;
  byte_length: number;
  width: 1080;
  height: 1920;
  frame_rate_num: number;
  frame_rate_den: number;
  duration_frames: number;
  duration_seconds: number;
  has_audio: boolean;
};

type DevelopmentExportIdentity = {
  project_id: string;
  export_id: string;
  operation_id: string;
  timeline_version_id: string;
  timeline_content_hash: string;
  timeline_revision: number;
  purpose: "DEVELOPMENT_EVIDENCE";
};

export type DevelopmentExportResponse = {
  data:
    | (DevelopmentExportIdentity & { status: "SUCCEEDED"; output: DevelopmentExportOutput })
    | (DevelopmentExportIdentity & {
        status: "UNKNOWN";
        error_code: "REMOTE_UNKNOWN";
        message: string;
      });
  request_id: string;
};

export type DevelopmentExportRemoteUnknown = {
  kind: "REMOTE_UNKNOWN";
  project_id: string;
  operation_id: string;
};

export type DevelopmentExportDefiniteRejection = {
  kind: "DEFINITE_REJECTION";
  project_id: string;
  operation_id: string;
  timeline_version_id: string;
  expected_revision: number;
  status: number;
  code: string;
  request_id: string;
  disposition: "REVIEW_INPUT" | "RECONCILE_OPERATION" | "RESTORE_AUTH";
  request_effect?: "NO_EXPORT_CLAIM";
};

export type DevelopmentExportCreateResult =
  | DevelopmentExportResponse
  | DevelopmentExportRemoteUnknown
  | DevelopmentExportDefiniteRejection;

export type DevelopmentExportOpenResult =
  | { kind: "OPENED"; export_id: string }
  | { kind: "REMOTE_UNKNOWN"; operation_id: string }
  | { kind: "UNAVAILABLE"; operation_id: string };

export type DevelopmentExportSaveResult =
  | { kind: "SAVED"; export_id: string }
  | { kind: "CANCELLED"; operation_id: string }
  | { kind: "REMOTE_UNKNOWN"; operation_id: string }
  | { kind: "UNAVAILABLE"; operation_id: string };

export type DevelopmentExportPreviewResult =
  | { kind: "READY"; export_id: string; sha256: string; mime_type: "video/mp4"; bytes: ArrayBuffer }
  | { kind: "REMOTE_UNKNOWN" | "UNAVAILABLE" | "PREVIEW_TOO_LARGE"; operation_id: string };

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const EXPORT_ID = /^dex_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,256}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isDevelopmentExportSha256(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

export function isDevelopmentExportIdentity(
  projectId: unknown,
  operationId: unknown,
  timelineVersionId: unknown,
  expectedRevision: unknown,
): projectId is string {
  return typeof projectId === "string" && PROJECT_ID.test(projectId) &&
    typeof operationId === "string" && UUID.test(operationId) &&
    typeof timelineVersionId === "string" && VERSION_ID.test(timelineVersionId) &&
    positiveInteger(expectedRevision);
}

export function isDevelopmentExportCreateInput(value: unknown): value is DevelopmentExportCreateInput {
  return exact(value, ["operation_id", "timeline_version_id", "expected_revision", "purpose"]) &&
    typeof value.operation_id === "string" && UUID_V4.test(value.operation_id) &&
    typeof value.timeline_version_id === "string" && VERSION_ID.test(value.timeline_version_id) &&
    positiveInteger(value.expected_revision) && value.purpose === "DEVELOPMENT_EVIDENCE";
}

export function isDevelopmentExportNoClaimDetails(
  value: unknown,
  projectId: string,
  input: DevelopmentExportCreateInput,
): boolean {
  return exact(value, ["project_id", "operation_id", "timeline_version_id",
    "expected_revision", "request_effect"]) &&
    value.project_id === projectId && value.operation_id === input.operation_id &&
    value.timeline_version_id === input.timeline_version_id &&
    value.expected_revision === String(input.expected_revision) &&
    value.request_effect === "NO_EXPORT_CLAIM";
}

export function isCanonicalWorkspaceRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    !value.includes("\\") && !value.startsWith("/") &&
    value.split("/").every((segment) =>
      segment.length > 0 && segment !== "." && segment !== ".." &&
      [...segment].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127 && character !== ":";
      }));
}

function isOutput(value: unknown, projectId: string, exportId: string): value is DevelopmentExportOutput {
  return exact(value, ["workspace_scope", "relative_path", "mime_type", "sha256",
    "byte_length", "width", "height", "frame_rate_num", "frame_rate_den",
    "duration_frames", "duration_seconds", "has_audio"]) &&
    value.workspace_scope === "SIDECAR_WORKSPACE" &&
    isCanonicalWorkspaceRelativePath(value.relative_path) &&
    value.relative_path === `exports/development-timeline/${projectId}/${exportId}.mp4` &&
    value.mime_type === "video/mp4" && typeof value.sha256 === "string" &&
    HASH.test(value.sha256) && positiveInteger(value.byte_length) &&
    value.width === 1080 && value.height === 1920 &&
    positiveInteger(value.frame_rate_num) && positiveInteger(value.frame_rate_den) &&
    positiveInteger(value.duration_frames) &&
    typeof value.duration_seconds === "number" && Number.isFinite(value.duration_seconds) &&
    value.duration_seconds > 0 && typeof value.has_audio === "boolean";
}

export function isDevelopmentExportResponse(
  value: unknown,
  projectId: string,
  operationId: string,
  timelineVersionId: string,
  expectedRevision: number,
): value is DevelopmentExportResponse {
  if (!exact(value, ["data", "request_id"]) || typeof value.request_id !== "string" ||
      !REQUEST_ID.test(value.request_id) || !record(value.data)) return false;
  const data = value.data;
  const common = data.project_id === projectId && PROJECT_ID.test(projectId) &&
    typeof data.export_id === "string" && EXPORT_ID.test(data.export_id) &&
    data.operation_id === operationId && UUID.test(operationId) &&
    data.timeline_version_id === timelineVersionId && VERSION_ID.test(timelineVersionId) &&
    typeof data.timeline_content_hash === "string" && HASH.test(data.timeline_content_hash) &&
    data.timeline_revision === expectedRevision && positiveInteger(expectedRevision) &&
    data.purpose === "DEVELOPMENT_EVIDENCE";
  if (!common) return false;
  if (data.status === "SUCCEEDED") {
    return exact(data, ["status", "project_id", "export_id", "operation_id",
      "timeline_version_id", "timeline_content_hash", "timeline_revision", "purpose", "output"]) &&
      isOutput(data.output, projectId, data.export_id as string);
  }
  return data.status === "UNKNOWN" &&
    exact(data, ["status", "project_id", "export_id", "operation_id",
      "timeline_version_id", "timeline_content_hash", "timeline_revision", "purpose",
      "error_code", "message"]) && data.error_code === "REMOTE_UNKNOWN" &&
    typeof data.message === "string" && data.message.length > 0 && data.message.length <= 500;
}
