import type { components } from "@aijian/contracts";
import { hasRequestId, isRecord } from "./api-contract-guards";
import {
  isDraftExportOperationId,
  isDraftExportScope,
  type DraftExportFailure,
} from "./draft-export-contract";
import { isAssemblyVersionId } from "./episode-media-assembly-contract";

export type CreateDraftReviewNoteRequest = components["schemas"]["CreateDraftReviewNoteRequest"];
export type ResolveDraftReviewNoteRequest = components["schemas"]["ResolveDraftReviewNoteRequest"];
export type DraftReviewTarget = components["schemas"]["DraftReviewTarget"];
export type DraftReviewResolution = components["schemas"]["DraftReviewResolution"];
export type DraftReviewNote = components["schemas"]["DraftReviewNote"];
export type DraftReviewData = components["schemas"]["DraftReviewData"];
export type DraftReviewResponse = components["schemas"]["DraftReviewResponse"];
export type DraftReviewResult =
  { kind: "FOUND"; receipt: DraftReviewResponse } | DraftExportFailure;
export type DraftReviewGateway = {
  listDraftReviewNotes(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftReviewResult>;
  createDraftReviewNote(
    projectId: string,
    episodeId: string,
    operationId: string,
    command: CreateDraftReviewNoteRequest,
  ): Promise<DraftReviewResult>;
  resolveDraftReviewNote(
    projectId: string,
    episodeId: string,
    operationId: string,
    noteId: string,
    command: ResolveDraftReviewNoteRequest,
  ): Promise<DraftReviewResult>;
};
export const DRAFT_REVIEW_CHANNELS = Object.freeze({
  list: "draft-review:list",
  create: "draft-review:create-note",
  resolve: "draft-review:resolve-note",
} as const);

const IDENTITY_KEYS = [
  "assembly_version_id",
  "assembly_content_hash",
  "output_sha256",
  "output_bytes",
] as const;
const HASH = /^sha256:[0-9a-f]{64}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= maximum &&
    !value.includes("\0") &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function identity(value: Record<string, unknown>): boolean {
  return (
    isAssemblyVersionId(value.assembly_version_id) &&
    typeof value.assembly_content_hash === "string" &&
    HASH.test(value.assembly_content_hash) &&
    typeof value.output_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.output_sha256) &&
    integer(value.output_bytes, 1)
  );
}
export function isDraftReviewNoteId(value: unknown): value is string {
  return typeof value === "string" && /^drn_[0-9a-f]{32}$/.test(value);
}
export function isDraftReviewResolutionId(value: unknown): value is string {
  return typeof value === "string" && /^drr_[0-9a-f]{32}$/.test(value);
}
export function isCreateDraftReviewNoteRequest(
  value: unknown,
): value is CreateDraftReviewNoteRequest {
  return (
    isRecord(value) &&
    exact(value, [...IDENTITY_KEYS, "note_id", "frame_index", "text"]) &&
    identity(value) &&
    isDraftReviewNoteId(value.note_id) &&
    integer(value.frame_index, 0) &&
    value.frame_index < 1_000_000 &&
    text(value.text, 2000)
  );
}
export function isResolveDraftReviewNoteRequest(
  value: unknown,
): value is ResolveDraftReviewNoteRequest {
  return (
    isRecord(value) &&
    exact(value, [...IDENTITY_KEYS, "resolution_id", "expected_revision", "reason"]) &&
    identity(value) &&
    isDraftReviewResolutionId(value.resolution_id) &&
    value.expected_revision === 1 &&
    text(value.reason, 2000)
  );
}
export function matchesDraftReviewIdentity(
  target: DraftReviewTarget,
  command: CreateDraftReviewNoteRequest | ResolveDraftReviewNoteRequest,
): boolean {
  return IDENTITY_KEYS.every((key) => target[key] === command[key]);
}
function isTarget(
  value: unknown,
  projectId: string,
  episodeId: string,
  operationId: string,
): value is DraftReviewTarget {
  return (
    isRecord(value) &&
    exact(value, [
      ...IDENTITY_KEYS,
      "project_id",
      "episode_id",
      "operation_id",
      "assembly_version_number",
      "total_frames",
      "frame_rate_num",
      "frame_rate_den",
    ]) &&
    identity(value) &&
    isDraftExportScope(value.project_id, value.episode_id) &&
    value.project_id === projectId &&
    value.episode_id === episodeId &&
    isDraftExportOperationId(value.operation_id) &&
    value.operation_id === operationId &&
    integer(value.assembly_version_number, 1) &&
    integer(value.total_frames, 1) &&
    value.total_frames <= 1_000_000 &&
    integer(value.frame_rate_num, 1) &&
    integer(value.frame_rate_den, 1)
  );
}
function isResolution(value: unknown): value is DraftReviewResolution {
  return (
    isRecord(value) &&
    exact(value, ["resolution_id", "reason", "actor_id", "created_at"]) &&
    isDraftReviewResolutionId(value.resolution_id) &&
    text(value.reason, 2000) &&
    text(value.actor_id, 200) &&
    timestamp(value.created_at)
  );
}
function isNote(value: unknown, totalFrames: number): value is DraftReviewNote {
  if (
    !isRecord(value) ||
    !exact(value, [
      "note_id",
      "frame_index",
      "text",
      "actor_id",
      "created_at",
      "revision",
      "resolution",
    ]) ||
    !isDraftReviewNoteId(value.note_id) ||
    !integer(value.frame_index, 0) ||
    value.frame_index >= totalFrames ||
    !text(value.text, 2000) ||
    !text(value.actor_id, 200) ||
    !timestamp(value.created_at)
  )
    return false;
  return (
    (value.revision === 1 && value.resolution === null) ||
    (value.revision === 2 &&
      isResolution(value.resolution) &&
      Date.parse(value.resolution.created_at) >= Date.parse(value.created_at))
  );
}
export function isDraftReviewResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  operationId: string,
  requestId: string | null,
): value is DraftReviewResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data)
  )
    return false;
  const data = value.data;
  if (
    !exact(data, [
      "target",
      "output_verified",
      "current_assembly_version_id",
      "current_assembly_content_hash",
      "version_status",
      "notes",
      "manual_review_only",
    ]) ||
    !isTarget(data.target, projectId, episodeId, operationId) ||
    typeof data.output_verified !== "boolean" ||
    data.manual_review_only !== true ||
    !Array.isArray(data.notes) ||
    data.notes.length > 500
  )
    return false;
  if (data.version_status === "UNKNOWN") {
    if (data.current_assembly_version_id !== null || data.current_assembly_content_hash !== null)
      return false;
  } else {
    if (
      !isAssemblyVersionId(data.current_assembly_version_id) ||
      typeof data.current_assembly_content_hash !== "string" ||
      !HASH.test(data.current_assembly_content_hash)
    )
      return false;
    if (data.version_status === "CURRENT") {
      if (
        data.current_assembly_version_id !== data.target.assembly_version_id ||
        data.current_assembly_content_hash !== data.target.assembly_content_hash
      )
        return false;
    } else if (
      data.version_status !== "OLDER_VERSION" ||
      data.current_assembly_version_id === data.target.assembly_version_id
    )
      return false;
  }
  const noteIds = new Set<string>();
  const resolutionIds = new Set<string>();
  for (const note of data.notes) {
    if (!isNote(note, data.target.total_frames) || noteIds.has(note.note_id)) return false;
    noteIds.add(note.note_id);
    if (note.resolution !== null) {
      if (resolutionIds.has(note.resolution.resolution_id)) return false;
      resolutionIds.add(note.resolution.resolution_id);
    }
  }
  return true;
}
