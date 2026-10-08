/** Validate project media-library receipts before they reach the asset gallery. */

export type AssetKind = "image" | "video" | "audio";
export type AssetAvailability = "PRESENT_UNVERIFIED" | "VERIFIED" | "MISSING" | "CORRUPT";
export type AssetRightsStatus = "PENDING_REVIEW" | "CLEARED" | "RESTRICTED";

export interface AssetVersion {
  id: string;
  ordinal: number;
  filename: string;
  kind: AssetKind;
  mime_type: string;
  byte_size: number;
  sha256: string;
  rights_status: AssetRightsStatus;
  source_kind: "LOCAL_IMPORT";
  technical_metadata: Record<string, string | number>;
  created_at: string;
  availability: AssetAvailability;
}

export interface AssetEpisodeReference {
  episode_id: string;
  version_id: string;
  role: string;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  project_id: string;
  created_at: string;
  latest_version: AssetVersion;
  versions: AssetVersion[];
  episode_references: AssetEpisodeReference[];
}

export type AssetError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422;
  code: string;
  request_id: string;
};
type RemoteUnknown = { kind: "REMOTE_UNKNOWN" };
export type AssetReceipt = { data: MediaAsset; request_id: string };
export type AssetListReceipt = { data: MediaAsset[]; request_id: string };
export type AssetReferenceCommand = { episode_id: string; version_id: string; role: string };
export type AssetUnreferenceCommand = { episode_id: string; role: string };

export interface AssetLibraryGateway {
  listProjectMediaAssets(projectId: string): Promise<
    { kind: "LISTED"; receipt: AssetListReceipt } | AssetError | RemoteUnknown>;
  getProjectMediaAsset(projectId: string, assetId: string): Promise<
    { kind: "FOUND"; receipt: AssetReceipt } | AssetError | RemoteUnknown>;
  importProjectMediaAssetFromPicker(projectId: string): Promise<
    { kind: "IMPORTED"; receipt: AssetReceipt } | { kind: "CANCELLED" } |
    { kind: "LOCAL_FILE_REJECTED"; code: "INVALID_FILE" | "FILE_TOO_LARGE" } |
    AssetError | RemoteUnknown>;
  importProjectMediaAssetVersionFromPicker(projectId: string, assetId: string): Promise<
    { kind: "IMPORTED"; receipt: AssetReceipt } | { kind: "CANCELLED" } |
    { kind: "LOCAL_FILE_REJECTED"; code: "INVALID_FILE" | "FILE_TOO_LARGE" } |
    AssetError | RemoteUnknown>;
  readProjectMediaAssetPreview(projectId: string, assetId: string, versionId: string): Promise<
    { kind: "READY"; mime_type: string; sha256: string; bytes: Uint8Array } |
    AssetError | RemoteUnknown>;
  addProjectMediaAssetEpisodeReference(
    projectId: string, assetId: string, command: AssetReferenceCommand,
  ): Promise<{ kind: "REFERENCED"; receipt: AssetReceipt } | AssetError | RemoteUnknown>;
  removeProjectMediaAssetEpisodeReference(
    projectId: string, assetId: string, command: AssetUnreferenceCommand,
  ): Promise<{ kind: "UNREFERENCED"; receipt: AssetReceipt } | AssetError | RemoteUnknown>;
  deleteProjectMediaAsset(projectId: string, assetId: string): Promise<
    { kind: "DELETED" } | AssetError | RemoteUnknown>;
}

export type AssetLibraryListState =
  | { kind: "READY"; assets: MediaAsset[] }
  | { kind: "LOADING" | "UNAVAILABLE" | "REMOTE_UNKNOWN" | "INVALID_RESPONSE" }
  | AssetError;

export type AssetLibraryDetailState =
  | { kind: "READY"; asset: MediaAsset }
  | { kind: "UNAVAILABLE" | "REMOTE_UNKNOWN" | "INVALID_RESPONSE" }
  | AssetError;

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const ASSET_ID = /^asset_[0-9a-f]{32}$/;
const VERSION_ID = /^asv_[0-9a-f]{32}$/;
const EPISODE_ID = /^ep_[a-z0-9._-]{1,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && [...value].length > 0 && [...value].length <= max;
}

function isVersion(value: unknown): value is AssetVersion {
  if (!record(value) || !record(value.technical_metadata)) return false;
  const metadata = Object.values(value.technical_metadata);
  return typeof value.id === "string" && VERSION_ID.test(value.id) &&
    Number.isSafeInteger(value.ordinal) && Number(value.ordinal) > 0 &&
    text(value.filename, 255) &&
    typeof value.kind === "string" &&
    ["image", "video", "audio"].includes(value.kind) &&
    text(value.mime_type, 128) &&
    Number.isSafeInteger(value.byte_size) && Number(value.byte_size) > 0 &&
    typeof value.sha256 === "string" && SHA256.test(value.sha256) &&
    typeof value.rights_status === "string" &&
    ["PENDING_REVIEW", "CLEARED", "RESTRICTED"].includes(value.rights_status) &&
    value.source_kind === "LOCAL_IMPORT" &&
    metadata.every((item) => typeof item === "string" ||
      (typeof item === "number" && Number.isSafeInteger(item))) &&
    text(value.created_at, 80) &&
    typeof value.availability === "string" &&
    ["PRESENT_UNVERIFIED", "VERIFIED", "MISSING", "CORRUPT"]
      .includes(value.availability);
}

function isReference(value: unknown): value is AssetEpisodeReference {
  return record(value) && typeof value.episode_id === "string" &&
    EPISODE_ID.test(value.episode_id) &&
    typeof value.version_id === "string" && VERSION_ID.test(value.version_id) &&
    text(value.role, 80) && text(value.created_at, 80);
}

function isAsset(value: unknown, projectId: string): value is MediaAsset {
  if (!record(value) || !Array.isArray(value.versions) ||
      !Array.isArray(value.episode_references) || !isVersion(value.latest_version)) return false;
  if (typeof value.id !== "string" || !ASSET_ID.test(value.id) ||
      value.project_id !== projectId || !text(value.created_at, 80) ||
      !value.versions.length || !value.versions.every(isVersion) ||
      !value.episode_references.every(isReference)) return false;
  const versions = value.versions as AssetVersion[];
  const ids = versions.map((version) => version.id);
  const ordinals = versions.map((version) => version.ordinal);
  const latest = value.latest_version as AssetVersion;
  return new Set(ids).size === ids.length && new Set(ordinals).size === ordinals.length &&
    ordinals.every((ordinal) => ordinal <= latest.ordinal) &&
    versions.some((version) => version.id === latest.id &&
      version.ordinal === latest.ordinal && version.filename === latest.filename &&
      version.kind === latest.kind && version.mime_type === latest.mime_type &&
      version.byte_size === latest.byte_size && version.sha256 === latest.sha256 &&
      version.rights_status === latest.rights_status &&
      version.availability === latest.availability) &&
    value.episode_references.every((reference: AssetEpisodeReference) =>
      ids.includes(reference.version_id));
}

/** A mismatched project or malformed receipt stays unknown; it is never shown as an empty library. */
export function parseAssetListReceipt(payload: unknown, projectId: string): MediaAsset[] | null {
  if (!PROJECT_ID.test(projectId) || !record(payload) || !text(payload.request_id, 80) ||
      !Array.isArray(payload.data) ||
      !payload.data.every((item) => isAsset(item, projectId))) return null;
  const assets = payload.data as MediaAsset[];
  return new Set(assets.map((asset) => asset.id)).size === assets.length ? assets : null;
}

export function parseAssetReceipt(
  payload: unknown, projectId: string, assetId: string,
): MediaAsset | null {
  if (!PROJECT_ID.test(projectId) || !ASSET_ID.test(assetId) || !record(payload) ||
      !text(payload.request_id, 80) ||
      !isAsset(payload.data, projectId) || payload.data.id !== assetId) return null;
  return payload.data;
}

export async function readAssetLibrary(
  gateway: AssetLibraryGateway | undefined, projectId: string,
): Promise<AssetLibraryListState> {
  if (!gateway || !PROJECT_ID.test(projectId)) return { kind: "UNAVAILABLE" };
  try {
    const result = await gateway.listProjectMediaAssets(projectId);
    if (result.kind === "DEFINITE_SERVER_ERROR") return result;
    if (result.kind === "REMOTE_UNKNOWN") return result;
    const assets = parseAssetListReceipt(result.receipt, projectId);
    return assets ? { kind: "READY", assets } : { kind: "INVALID_RESPONSE" };
  } catch {
    return { kind: "REMOTE_UNKNOWN" };
  }
}

export async function readAssetDetail(
  gateway: AssetLibraryGateway | undefined, projectId: string, assetId: string,
): Promise<AssetLibraryDetailState> {
  if (!gateway || !PROJECT_ID.test(projectId) || !ASSET_ID.test(assetId))
    return { kind: "UNAVAILABLE" };
  try {
    const result = await gateway.getProjectMediaAsset(projectId, assetId);
    if (result.kind === "DEFINITE_SERVER_ERROR") return result;
    if (result.kind === "REMOTE_UNKNOWN") return result;
    const asset = parseAssetReceipt(result.receipt, projectId, assetId);
    return asset ? { kind: "READY", asset } : { kind: "INVALID_RESPONSE" };
  } catch {
    return { kind: "REMOTE_UNKNOWN" };
  }
}
