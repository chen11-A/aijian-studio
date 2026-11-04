import { createHash } from "node:crypto";

import { hasRequestId, isRecord } from "./api-contract-guards";

export type ProductExportVersionRef = { version_id: string; content_hash: string };
export type ProductExportAssetRef = {
  asset_id: string;
  version_id: string;
  sha256: string;
};
export type ProductExportMediaRef = ProductExportVersionRef | ProductExportAssetRef;
export type ProductExportSpec = {
  container: "MP4";
  width: number;
  height: number;
  frame_rate_num: number;
  frame_rate_den: number;
  video_codec: "H264" | "H265";
  audio_codec: "AAC";
};
export type ProductExportPreflightRequest = {
  timeline: ProductExportVersionRef;
  expected_revision: number;
  picture_lock?: ProductExportVersionRef | null;
  media_manifest?: ProductExportVersionRef | null;
  video_master?: ProductExportMediaRef | null;
  dialogue_mix?: ProductExportMediaRef | null;
  bgm_mix?: ProductExportMediaRef | null;
  sfx_mix?: ProductExportMediaRef | null;
  subtitle_track?: ProductExportVersionRef | null;
  rights_clearance?: ProductExportVersionRef | null;
  spec: ProductExportSpec;
};
export type ProductExportPreflightIssue = {
  code: string;
  scope:
    | "PROJECT"
    | "EPISODE"
    | "TIMELINE"
    | "PICTURE_LOCK"
    | "MEDIA"
    | "VIDEO"
    | "DIALOGUE"
    | "BGM"
    | "SFX"
    | "SUBTITLE"
    | "RIGHTS"
    | "SPEC"
    | "OUTPUT"
    | "TOOLCHAIN"
    | "EXECUTION";
  message: string;
};
export type ProductExportPreflightResponse = {
  data: {
    status: "BLOCKED";
    request_effect: "NO_EXPORT_CLAIM";
    project_id: string;
    episode_id: string;
    timeline: ProductExportVersionRef;
    expected_revision: number;
    request_fingerprint: string;
    issues: ProductExportPreflightIssue[];
  };
  request_id: string;
};
export type ProductExportPreflightResult =
  | { kind: "BLOCKED"; receipt: ProductExportPreflightResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 401 | 403 | 422; code: string; request_id: string }
  | { kind: "PREFLIGHT_UNKNOWN" };

export const PRODUCT_EXPORT_PREFLIGHT_CHANNEL = "product-export:preflight";

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const ASSET = /^asset_[0-9a-f]{32}$/;
const ASSET_VERSION = /^asv_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const HEX_HASH = /^[0-9a-f]{64}$/;
const ISSUE_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
const SCOPES = new Set([
  "PROJECT",
  "EPISODE",
  "TIMELINE",
  "PICTURE_LOCK",
  "MEDIA",
  "VIDEO",
  "DIALOGUE",
  "BGM",
  "SFX",
  "SUBTITLE",
  "RIGHTS",
  "SPEC",
  "OUTPUT",
  "TOOLCHAIN",
  "EXECUTION",
]);
const OPTIONAL_REFS = [
  "picture_lock",
  "media_manifest",
  "video_master",
  "dialogue_mix",
  "bgm_mix",
  "sfx_mix",
  "subtitle_track",
  "rights_clearance",
] as const;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isProductExportProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT.test(value);
}
export function isProductExportEpisodeId(value: unknown): value is string {
  return typeof value === "string" && EPISODE.test(value);
}
export function isProductExportVersionRef(value: unknown): value is ProductExportVersionRef {
  return (
    isRecord(value) &&
    exact(value, ["version_id", "content_hash"]) &&
    typeof value.version_id === "string" &&
    VERSION.test(value.version_id) &&
    typeof value.content_hash === "string" &&
    HASH.test(value.content_hash)
  );
}
function isMediaRef(value: unknown): value is ProductExportMediaRef {
  return (
    isProductExportVersionRef(value) ||
    (isRecord(value) &&
      exact(value, ["asset_id", "version_id", "sha256"]) &&
      typeof value.asset_id === "string" &&
      ASSET.test(value.asset_id) &&
      typeof value.version_id === "string" &&
      ASSET_VERSION.test(value.version_id) &&
      typeof value.sha256 === "string" &&
      HEX_HASH.test(value.sha256))
  );
}
function isSpec(value: unknown): value is ProductExportSpec {
  return (
    isRecord(value) &&
    exact(value, [
      "container",
      "width",
      "height",
      "frame_rate_num",
      "frame_rate_den",
      "video_codec",
      "audio_codec",
    ]) &&
    value.container === "MP4" &&
    boundedInteger(value.width, 16, 7680) &&
    boundedInteger(value.height, 16, 7680) &&
    boundedInteger(value.frame_rate_num, 1, 240_000) &&
    boundedInteger(value.frame_rate_den, 1, 100_000) &&
    (value.video_codec === "H264" || value.video_codec === "H265") &&
    value.audio_codec === "AAC"
  );
}
export function isProductExportPreflightRequest(
  value: unknown,
): value is ProductExportPreflightRequest {
  if (
    !isRecord(value) ||
    !["timeline", "expected_revision", "spec"].every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    !Object.keys(value).every(
      (key) =>
        key === "timeline" ||
        key === "expected_revision" ||
        key === "spec" ||
        (OPTIONAL_REFS as readonly string[]).includes(key),
    ) ||
    !isProductExportVersionRef(value.timeline) ||
    !boundedInteger(value.expected_revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isSpec(value.spec)
  )
    return false;
  for (const key of OPTIONAL_REFS) {
    if (value[key] === undefined || value[key] === null) continue;
    if (
      key === "video_master" ||
      key === "dialogue_mix" ||
      key === "bgm_mix" ||
      key === "sfx_mix"
    ) {
      if (!isMediaRef(value[key])) return false;
    } else if (!isProductExportVersionRef(value[key])) return false;
  }
  return true;
}

function isIssue(value: unknown): value is ProductExportPreflightIssue {
  return (
    isRecord(value) &&
    exact(value, ["code", "scope", "message"]) &&
    typeof value.code === "string" &&
    ISSUE_CODE.test(value.code) &&
    typeof value.scope === "string" &&
    SCOPES.has(value.scope) &&
    typeof value.message === "string" &&
    value.message.length >= 1 &&
    [...value.message].length <= 240
  );
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedJson(value[key])]),
  );
}

export function productExportPreflightFingerprint(
  projectId: string,
  episodeId: string,
  request: ProductExportPreflightRequest,
): string {
  if (
    !isProductExportProjectId(projectId) ||
    !isProductExportEpisodeId(episodeId) ||
    !isProductExportPreflightRequest(request)
  ) {
    throw new Error("Product export preflight fingerprint requires canonical arguments");
  }
  // Pydantic model_dump(mode="json") includes every nullable field as null.
  const normalizedRequest = {
    timeline: request.timeline,
    expected_revision: request.expected_revision,
    picture_lock: request.picture_lock ?? null,
    media_manifest: request.media_manifest ?? null,
    video_master: request.video_master ?? null,
    dialogue_mix: request.dialogue_mix ?? null,
    bgm_mix: request.bgm_mix ?? null,
    sfx_mix: request.sfx_mix ?? null,
    subtitle_track: request.subtitle_track ?? null,
    rights_clearance: request.rights_clearance ?? null,
    spec: request.spec,
  };
  const bytes = Buffer.from(
    JSON.stringify(
      sortedJson({
        project_id: projectId,
        episode_id: episodeId,
        request: normalizedRequest,
      }),
    ),
    "utf8",
  );
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function isProductExportPreflightResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  request: ProductExportPreflightRequest,
  requestId: string | null,
): value is ProductExportPreflightResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data) ||
    !exact(value.data, [
      "status",
      "request_effect",
      "project_id",
      "episode_id",
      "timeline",
      "expected_revision",
      "request_fingerprint",
      "issues",
    ])
  )
    return false;
  const data = value.data;
  return (
    data.status === "BLOCKED" &&
    data.request_effect === "NO_EXPORT_CLAIM" &&
    data.project_id === projectId &&
    data.episode_id === episodeId &&
    isProductExportVersionRef(data.timeline) &&
    data.timeline.version_id === request.timeline.version_id &&
    data.timeline.content_hash === request.timeline.content_hash &&
    data.expected_revision === request.expected_revision &&
    data.request_fingerprint === productExportPreflightFingerprint(projectId, episodeId, request) &&
    Array.isArray(data.issues) &&
    data.issues.length >= 1 &&
    data.issues.every(isIssue)
  );
}

export function productExportPreflightDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): Extract<ProductExportPreflightResult, { kind: "DEFINITE_SERVER_ERROR" }> | null {
  if (status !== 401 && status !== 403 && status !== 422) return null;
  if (
    !isRecord(value) ||
    !exact(value, ["error", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.error) ||
    !exact(value.error, ["code", "message", "details", "retryable"]) ||
    !isRecord(value.error.details) ||
    value.error.retryable !== false ||
    typeof value.error.message !== "string" ||
    value.error.code !==
      (status === 401
        ? "SIDECAR_AUTH_REQUIRED"
        : status === 403
          ? "SIDECAR_REQUEST_REJECTED"
          : "VALIDATION_ERROR")
  )
    return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status,
    code: value.error.code as string,
    request_id: value.request_id as string,
  };
}
