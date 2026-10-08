import { hasRequestId, isRecord } from "./api-contract-guards";

export type MediaAssetVersion = {
  id: string;
  ordinal: number;
  filename: string;
  kind: "image" | "video" | "audio";
  mime_type: string;
  byte_size: number;
  sha256: string;
  rights_status: "PENDING_REVIEW" | "CLEARED" | "RESTRICTED";
  source_kind: "LOCAL_IMPORT";
  technical_metadata: Record<string, string | number>;
  created_at: string;
  availability: "PRESENT_UNVERIFIED" | "VERIFIED" | "MISSING" | "CORRUPT";
};

export type MediaAsset = {
  id: string;
  project_id: string;
  created_at: string;
  latest_version: MediaAssetVersion;
  versions: MediaAssetVersion[];
  episode_references: {
    episode_id: string;
    version_id: string;
    role: string;
    created_at: string;
  }[];
};

export type MediaAssetResponse = { data: MediaAsset; request_id: string };
export type MediaAssetListResponse = { data: MediaAsset[]; request_id: string };
export type AddMediaAssetReferenceCommand = {
  episode_id: string;
  version_id: string;
  role: string;
};
export type RemoveMediaAssetReferenceCommand = { episode_id: string; role: string };

export type MediaAssetDefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422;
  code: string;
  request_id: string;
};
export type MediaAssetListResult =
  | { kind: "LISTED"; receipt: MediaAssetListResponse }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type MediaAssetReadResult =
  | { kind: "FOUND"; receipt: MediaAssetResponse }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type MediaAssetImportResult =
  | { kind: "IMPORTED"; receipt: MediaAssetResponse }
  | { kind: "CANCELLED" }
  | { kind: "LOCAL_FILE_REJECTED"; code: "INVALID_FILE" | "FILE_TOO_LARGE" }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type MediaAssetReferenceResult =
  | { kind: "REFERENCED"; receipt: MediaAssetResponse }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type MediaAssetUnreferenceResult =
  | { kind: "UNREFERENCED"; receipt: MediaAssetResponse }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type MediaAssetDeleteResult =
  | { kind: "DELETED" }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };
export type MediaAssetPreviewResult =
  | { kind: "READY"; mime_type: string; sha256: string; bytes: Uint8Array }
  | MediaAssetDefiniteError | { kind: "REMOTE_UNKNOWN" };

export const MEDIA_ASSET_CHANNELS = Object.freeze({
  list: "media-assets:list",
  get: "media-assets:get",
  import: "media-assets:import-from-picker",
  importVersion: "media-assets:import-version-from-picker",
  preview: "media-assets:preview",
  reference: "media-assets:add-episode-reference",
  unreference: "media-assets:remove-episode-reference",
  delete: "media-assets:delete",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const VERSION = /^asv_[0-9a-f]{32}$/;
const EPISODE = /^ep_[a-z0-9._-]{1,80}$/;
const HASH = /^[0-9a-f]{64}$/;
const ERROR_STATUS = new Set([400, 401, 403, 404, 409, 413, 415, 422]);

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isMediaProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT.test(value);
}
export function isMediaAssetId(value: unknown): value is string {
  return typeof value === "string" && ASSET.test(value);
}
export function isMediaAssetVersionId(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

export function isAddMediaAssetReferenceCommand(
  value: unknown,
): value is AddMediaAssetReferenceCommand {
  return isRecord(value) && exact(value, ["episode_id", "version_id", "role"]) &&
    typeof value.episode_id === "string" && EPISODE.test(value.episode_id) &&
    isMediaAssetVersionId(value.version_id) && typeof value.role === "string" &&
    [...value.role].length >= 1 && [...value.role].length <= 80 &&
    ![...value.role].some((char) => (char.codePointAt(0) ?? 0) < 32);
}

export function isRemoveMediaAssetReferenceCommand(
  value: unknown,
): value is RemoveMediaAssetReferenceCommand {
  return isRecord(value) && exact(value, ["episode_id", "role"]) &&
    typeof value.episode_id === "string" && EPISODE.test(value.episode_id) &&
    typeof value.role === "string" && [...value.role].length >= 1 &&
    [...value.role].length <= 80 &&
    ![...value.role].some((char) => (char.codePointAt(0) ?? 0) < 32);
}

function isVersion(value: unknown): value is MediaAssetVersion {
  if (!isRecord(value) || !exact(value, [
    "id", "ordinal", "filename", "kind", "mime_type", "byte_size", "sha256",
    "rights_status", "source_kind", "technical_metadata", "created_at", "availability",
  ])) return false;
  return isMediaAssetVersionId(value.id) && typeof value.ordinal === "number" &&
    Number.isSafeInteger(value.ordinal) && value.ordinal >= 1 &&
    typeof value.filename === "string" && value.filename.length >= 1 &&
    [...value.filename].length <= 255 &&
    (value.kind === "image" || value.kind === "video" || value.kind === "audio") &&
    ((value.kind === "image" &&
      (value.mime_type === "image/png" || value.mime_type === "image/jpeg" ||
        value.mime_type === "image/webp")) ||
      (value.kind === "video" &&
        (value.mime_type === "video/mp4" || value.mime_type === "video/webm")) ||
      (value.kind === "audio" &&
        (value.mime_type === "audio/wav" || value.mime_type === "audio/mpeg"))) &&
    typeof value.byte_size === "number" && Number.isSafeInteger(value.byte_size) &&
    value.byte_size > 0 && typeof value.sha256 === "string" && HASH.test(value.sha256) &&
    (value.rights_status === "PENDING_REVIEW" || value.rights_status === "CLEARED" ||
      value.rights_status === "RESTRICTED") && value.source_kind === "LOCAL_IMPORT" &&
    isRecord(value.technical_metadata) && Object.values(value.technical_metadata).every(
      (item) => typeof item === "string" ||
        (typeof item === "number" && Number.isSafeInteger(item)),
    ) && typeof value.created_at === "string" &&
    (value.availability === "PRESENT_UNVERIFIED" || value.availability === "VERIFIED" ||
      value.availability === "MISSING" || value.availability === "CORRUPT");
}

function isAsset(value: unknown, projectId: string): value is MediaAsset {
  if (!isRecord(value) || !exact(value, [
    "id", "project_id", "created_at", "latest_version", "versions", "episode_references",
  ]) || !isMediaAssetId(value.id) || value.project_id !== projectId ||
      typeof value.created_at !== "string" || !isVersion(value.latest_version) ||
      !Array.isArray(value.versions) || value.versions.length < 1 ||
      !value.versions.every(isVersion) ||
      value.versions[0]?.id !== value.latest_version.id ||
      !Array.isArray(value.episode_references)) return false;
  const versionIds = new Set(value.versions.map((version: MediaAssetVersion) => version.id));
  return value.episode_references.every((reference: unknown) =>
    isRecord(reference) && exact(reference, ["episode_id", "version_id", "role", "created_at"]) &&
    typeof reference.episode_id === "string" && EPISODE.test(reference.episode_id) &&
    typeof reference.version_id === "string" && versionIds.has(reference.version_id) &&
    typeof reference.role === "string" && reference.role.length >= 1 &&
    [...reference.role].length <= 80 && typeof reference.created_at === "string",
  );
}

export function isMediaAssetResponse(
  value: unknown,
  projectId: string,
  requestId: string | null,
  assetId?: string,
): value is MediaAssetResponse {
  return isRecord(value) && exact(value, ["data", "request_id"]) &&
    hasRequestId(value) && value.request_id === requestId &&
    isAsset(value.data, projectId) && (assetId === undefined || value.data.id === assetId);
}

export function isMediaAssetListResponse(
  value: unknown,
  projectId: string,
  requestId: string | null,
): value is MediaAssetListResponse {
  return isRecord(value) && exact(value, ["data", "request_id"]) &&
    hasRequestId(value) && value.request_id === requestId && Array.isArray(value.data) &&
    value.data.every((item) => isAsset(item, projectId));
}

export function mediaAssetDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): MediaAssetDefiniteError | null {
  if (!ERROR_STATUS.has(status) || !isRecord(value) ||
      !exact(value, ["error", "request_id"]) || !hasRequestId(value) ||
      value.request_id !== requestId || !isRecord(value.error) ||
      !exact(value.error, ["code", "message", "details", "retryable"]) ||
      typeof value.error.code !== "string" || typeof value.error.message !== "string" ||
      value.error.retryable !== false || !isRecord(value.error.details)) return null;
  return {
    kind: "DEFINITE_SERVER_ERROR", status: status as MediaAssetDefiniteError["status"],
    code: value.error.code, request_id: value.request_id as string,
  };
}
