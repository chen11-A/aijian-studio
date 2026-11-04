import type { components } from "@aijian/contracts";
import { hasRequestId, isRecord } from "./api-contract-guards";
import {
  isAssemblyEpisodeId,
  isAssemblyProjectId,
  isAssemblyVersionId,
} from "./episode-media-assembly-contract";

export type DraftExportCommand = Omit<
  components["schemas"]["CreateDraftExportRequest"],
  "output_path"
>;
export type DraftExportJob = components["schemas"]["DraftExportJob"];
export type DraftExportFailure =
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type DraftExportResult =
  | { kind: "FOUND"; receipt: { data: DraftExportJob; request_id: string } }
  | { kind: "NOT_FOUND"; request_id: string }
  | DraftExportFailure;
export type DraftExportListResult =
  | { kind: "LISTED"; receipt: { data: { items: DraftExportJob[] }; request_id: string } }
  | DraftExportFailure;
export type DraftExportSubmitResult =
  | DraftExportResult
  | { kind: "PICKER_CANCELLED" | "PICKER_BUSY" | "INVALID_DESTINATION" | "CACHE_UNAVAILABLE" };
export type DraftExportOutputIdentity = {
  project_id: string;
  episode_id: string;
  operation_id: string;
  output_sha256: string;
  output_bytes: number;
};
export type DraftExportOutputErrorCode =
  | "RECEIPT_MISMATCH"
  | "NOT_SUCCEEDED"
  | "UNSAFE_PATH"
  | "FILE_UNAVAILABLE"
  | "FILE_CHANGED"
  | "HASH_MISMATCH"
  | "INVALID_MP4"
  | "OUTPUT_TOO_LARGE"
  | "OUTPUT_BUSY"
  | "REVEAL_FAILED";
export type DraftExportOutputFailure =
  | DraftExportFailure
  | { kind: "NOT_FOUND"; request_id: string }
  | { kind: "OUTPUT_UNAVAILABLE"; code: DraftExportOutputErrorCode }
  | { kind: "PREVIEW_TOO_LARGE"; output_bytes: number; limit_bytes: number };
export type DraftExportPreviewResult =
  | {
      kind: "READY";
      mime_type: "video/mp4";
      bytes: Uint8Array;
      identity: DraftExportOutputIdentity;
    }
  | DraftExportOutputFailure;
export type DraftExportRevealResult =
  { kind: "REVEALED"; identity: DraftExportOutputIdentity } | DraftExportOutputFailure;
export const DRAFT_EXPORT_CHANNELS = Object.freeze({
  list: "draft-exports:list",
  get: "draft-exports:get",
  create: "draft-exports:create-from-picker",
  createPreview: "draft-exports:create-composition-preview",
  cancel: "draft-exports:cancel",
  preview: "draft-exports:preview",
  reveal: "draft-exports:reveal-output",
});
const HASH = /^sha256:[0-9a-f]{64}$/;
const STATUSES = [
  "QUEUED",
  "RUNNING",
  "VERIFYING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
];
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
export function isDraftExportOperationId(value: unknown): value is string {
  return typeof value === "string" && /^dmp_[0-9a-f]{32}$/.test(value);
}
export function isDraftExportScope(projectId: unknown, episodeId: unknown): boolean {
  return isAssemblyProjectId(projectId) && isAssemblyEpisodeId(episodeId);
}
export function isDraftExportCommand(value: unknown): value is DraftExportCommand {
  return (
    isRecord(value) &&
    exact(value, [
      "operation_id",
      "assembly_version_id",
      "assembly_content_hash",
      "rights_declaration",
    ]) &&
    isDraftExportOperationId(value.operation_id) &&
    isAssemblyVersionId(value.assembly_version_id) &&
    typeof value.assembly_content_hash === "string" &&
    HASH.test(value.assembly_content_hash) &&
    value.rights_declaration === "OWNED_OR_SYNTHETIC"
  );
}
export function isDraftExportJob(
  value: unknown,
  projectId: string,
  episodeId: string,
  operationId?: string,
): value is DraftExportJob {
  if (
    !isRecord(value) ||
    !exact(value, [
      "operation_id",
      "project_id",
      "episode_id",
      "assembly_version_id",
      "assembly_content_hash",
      "status",
      "progress_frames",
      "total_frames",
      "output_filename",
      "output_path",
      "output_sha256",
      "output_bytes",
      "error_code",
      "error_message",
      "created_at",
      "updated_at",
      "toolchain_profile_id",
      "draft",
      "rights_declaration",
    ])
  )
    return false;
  if (
    !isDraftExportOperationId(value.operation_id) ||
    (operationId !== undefined && value.operation_id !== operationId) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !isAssemblyVersionId(value.assembly_version_id) ||
    typeof value.assembly_content_hash !== "string" ||
    !HASH.test(value.assembly_content_hash) ||
    !STATUSES.includes(String(value.status)) ||
    !integer(value.total_frames, 1) ||
    !integer(value.progress_frames, 0) ||
    value.progress_frames > value.total_frames ||
    typeof value.output_filename !== "string" ||
    value.output_filename.length < 5 ||
    value.output_filename.length > 255 ||
    /[/\\\0]/.test(value.output_filename) ||
    !value.output_filename.toLowerCase().endsWith(".mp4") ||
    typeof value.toolchain_profile_id !== "string" ||
    !value.toolchain_profile_id.length ||
    value.draft !== true ||
    value.rights_declaration !== "OWNED_OR_SYNTHETIC" ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.updated_at !== "string" ||
    !Number.isFinite(Date.parse(value.updated_at)) ||
    !(
      value.error_code === null ||
      (typeof value.error_code === "string" && /^[A-Z][A-Z0-9_]{2,100}$/.test(value.error_code))
    ) ||
    !(
      value.error_message === null ||
      (typeof value.error_message === "string" && value.error_message.length <= 2000)
    )
  )
    return false;
  if (value.status === "SUCCEEDED")
    return (
      typeof value.output_path === "string" &&
      value.output_path.length > 0 &&
      !value.output_path.includes("\0") &&
      typeof value.output_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(value.output_sha256) &&
      integer(value.output_bytes, 1) &&
      value.progress_frames === value.total_frames &&
      value.error_code === null &&
      value.error_message === null
    );
  return value.output_path === null && value.output_sha256 === null && value.output_bytes === null;
}
export function isDraftExportResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  operationId?: string,
): value is { data: DraftExportJob; request_id: string } {
  return (
    isRecord(value) &&
    exact(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    value.request_id === requestId &&
    isDraftExportJob(value.data, projectId, episodeId, operationId)
  );
}
export function isDraftExportListResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
): value is { data: { items: DraftExportJob[] }; request_id: string } {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data) ||
    !exact(value.data, ["items"]) ||
    !Array.isArray(value.data.items) ||
    value.data.items.length > 1000
  )
    return false;
  const ids = new Set<string>();
  for (const job of value.data.items) {
    if (!isDraftExportJob(job, projectId, episodeId) || ids.has(job.operation_id)) return false;
    ids.add(job.operation_id);
  }
  return true;
}

/** Only this CREATE failure is proven to occur before any durable export claim. */
export function draftExportPreclaimToolchainError(
  status: number,
  value: unknown,
  requestId: string | null,
): Extract<DraftExportFailure, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (
    status !== 503 ||
    !isRecord(value) ||
    !exact(value, ["error", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.error) ||
    !exact(value.error, ["code", "message", "details", "retryable"]) ||
    value.error.code !== "DRAFT_TOOLCHAIN_UNAVAILABLE" ||
    typeof value.error.message !== "string" ||
    !isRecord(value.error.details) ||
    value.error.retryable !== false
  )
    return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status: 503,
    code: "DRAFT_TOOLCHAIN_UNAVAILABLE",
    request_id: value.request_id as string,
  };
}
