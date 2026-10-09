import { hasRequestId, isRecord } from "./api-contract-guards";

export type EpisodeScriptBlock = {
  block_id: string;
  ordinal: number;
  kind: "ACTION" | "DIALOGUE";
  text: string;
  speaker: string | null;
  delivery?: "ON_SCREEN" | "OFF_SCREEN" | null;
};
export type EpisodeScriptScene = {
  scene_id: string;
  ordinal: number;
  heading: string;
  blocks: EpisodeScriptBlock[];
};
export type EpisodeScriptContent = {
  schema_version: "1.0.0";
  project_id: string;
  episode_id: string;
  production_brief_version_id?: string | null;
  story_bible_version_id?: string | null;
  source_extraction_version_id?: string | null;
  source_proposal_acceptance_id?: string | null;
  scenes: EpisodeScriptScene[];
};
export type CreateEpisodeScriptVersionRequest = {
  content: EpisodeScriptContent;
  parent_version_id: string | null;
  expected_revision: number | null;
  change_summary: string;
};
export type EpisodeScriptVersion = {
  version_id: string;
  project_id: string;
  episode_id: string;
  version_number: number;
  head_revision: number;
  parent_version_id: string | null;
  content: EpisodeScriptContent;
  content_hash: string;
  author_actor_id: string;
  change_summary: string;
  created_at: string;
};
export type EpisodeScriptVersionResponse = { data: EpisodeScriptVersion; request_id: string };
export type EpisodeScriptVersionCreatedResponse = {
  data: { version: EpisodeScriptVersion; replayed: boolean };
  request_id: string;
};
export type EpisodeScriptDefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: 401 | 403 | 404 | 409 | 413 | 422 | 428;
  code: string;
  request_id: string;
};
export type EpisodeScriptLatestResult =
  | { kind: "FOUND"; receipt: EpisodeScriptVersionResponse }
  | { kind: "EMPTY" }
  | EpisodeScriptDefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type EpisodeScriptVersionResult =
  | { kind: "FOUND"; receipt: EpisodeScriptVersionResponse }
  | EpisodeScriptDefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type EpisodeScriptCreateResult =
  | { kind: "CREATED"; receipt: EpisodeScriptVersionCreatedResponse }
  | EpisodeScriptDefiniteError
  | { kind: "REMOTE_UNKNOWN" };

export const EPISODE_SCRIPT_CHANNELS = Object.freeze({
  latest: "episode-script:latest",
  version: "episode-script:version",
  create: "episode-script:create-version",
} as const);

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const ACCEPTANCE = /^pda_[0-9a-f]{32}$/;
const SCENE = /^scn_[0-9a-f]{32}$/;
const BLOCK = /^sblk_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const IDENTITY = /^[\x21-\x7e]{1,240}$/;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function knownKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    [...value].length >= 1 &&
    [...value].length <= max &&
    value.trim().length > 0
  );
}
function optionalId(value: unknown, pattern: RegExp): value is string | null {
  return value === null || id(value, pattern);
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

export function isEpisodeScriptProjectId(value: unknown): value is string {
  return id(value, PROJECT);
}
export function isEpisodeScriptEpisodeId(value: unknown): value is string {
  return id(value, EPISODE);
}
export function isEpisodeScriptVersionId(value: unknown): value is string {
  return id(value, VERSION);
}
export function isEpisodeScriptIdempotencyKey(value: unknown): value is string {
  return id(value, IDENTITY);
}

function isBlock(
  value: unknown,
  ordinal: number,
  seen: Set<string>,
  requireDelivery: boolean,
): value is EpisodeScriptBlock {
  if (
    !isRecord(value) ||
    !knownKeys(value, ["block_id", "ordinal", "kind", "text", "speaker"], ["delivery"]) ||
    (requireDelivery && !Object.prototype.hasOwnProperty.call(value, "delivery")) ||
    !id(value.block_id, BLOCK) ||
    seen.has(value.block_id) ||
    value.ordinal !== ordinal ||
    !text(value.text, 20_000)
  )
    return false;
  if (value.kind === "ACTION") {
    if (value.speaker !== null || value.delivery != null) return false;
  } else if (value.kind === "DIALOGUE") {
    if (
      !text(value.speaker, 120) ||
      (value.delivery !== "ON_SCREEN" &&
        value.delivery !== "OFF_SCREEN" &&
        (requireDelivery || value.delivery != null))
    )
      return false;
  } else return false;
  seen.add(value.block_id);
  return true;
}
export function isEpisodeScriptContent(
  value: unknown,
  projectId: string,
  episodeId: string,
  requireDelivery = false,
): value is EpisodeScriptContent {
  if (
    !isRecord(value) ||
    !knownKeys(
      value,
      ["schema_version", "project_id", "episode_id", "scenes"],
      [
        "production_brief_version_id",
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
      ],
    ) ||
    (requireDelivery &&
      !exact(value, [
        "schema_version",
        "project_id",
        "episode_id",
        "production_brief_version_id",
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
        "scenes",
      ])) ||
    value.schema_version !== "1.0.0" ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !(
      value.production_brief_version_id === undefined ||
      optionalId(value.production_brief_version_id, VERSION)
    ) ||
    !(
      value.story_bible_version_id === undefined ||
      optionalId(value.story_bible_version_id, VERSION)
    ) ||
    !(
      value.source_extraction_version_id === undefined ||
      optionalId(value.source_extraction_version_id, VERSION)
    ) ||
    !(
      value.source_proposal_acceptance_id === undefined ||
      optionalId(value.source_proposal_acceptance_id, ACCEPTANCE)
    ) ||
    ((value.source_extraction_version_id ?? null) === null) !==
      ((value.source_proposal_acceptance_id ?? null) === null) ||
    !Array.isArray(value.scenes) ||
    value.scenes.length > 1_000
  )
    return false;
  const seen = new Set<string>();
  return value.scenes.every((scene: unknown, index: number) => {
    if (
      !isRecord(scene) ||
      !exact(scene, ["scene_id", "ordinal", "heading", "blocks"]) ||
      !id(scene.scene_id, SCENE) ||
      seen.has(scene.scene_id) ||
      scene.ordinal !== index + 1 ||
      !text(scene.heading, 240) ||
      !Array.isArray(scene.blocks) ||
      scene.blocks.length > 500
    )
      return false;
    seen.add(scene.scene_id);
    return scene.blocks.every((block: unknown, blockIndex: number) =>
      isBlock(block, blockIndex + 1, seen, requireDelivery),
    );
  });
}
export function isCreateEpisodeScriptVersionRequest(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is CreateEpisodeScriptVersionRequest {
  if (
    !isRecord(value) ||
    !exact(value, ["content", "parent_version_id", "expected_revision", "change_summary"]) ||
    !isEpisodeScriptContent(value.content, projectId, episodeId, true) ||
    !optionalId(value.parent_version_id, VERSION) ||
    !(value.expected_revision === null || positive(value.expected_revision)) ||
    !text(value.change_summary, 240) ||
    (value.parent_version_id === null) !== (value.expected_revision === null)
  )
    return false;
  try {
    return Buffer.byteLength(JSON.stringify(value.content), "utf8") <= 2_000_000;
  } catch {
    return false;
  }
}

function isVersion(
  value: unknown,
  projectId: string,
  episodeId: string,
  versionId?: string,
): value is EpisodeScriptVersion {
  return (
    isRecord(value) &&
    exact(value, [
      "version_id",
      "project_id",
      "episode_id",
      "version_number",
      "head_revision",
      "parent_version_id",
      "content",
      "content_hash",
      "author_actor_id",
      "change_summary",
      "created_at",
    ]) &&
    id(value.version_id, VERSION) &&
    (versionId === undefined || value.version_id === versionId) &&
    value.project_id === projectId &&
    value.episode_id === episodeId &&
    positive(value.version_number) &&
    positive(value.head_revision) &&
    optionalId(value.parent_version_id, VERSION) &&
    isEpisodeScriptContent(value.content, projectId, episodeId) &&
    id(value.content_hash, HASH) &&
    text(value.author_actor_id, 240) &&
    text(value.change_summary, 240) &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

export function isEpisodeScriptVersionResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  versionId?: string,
): value is EpisodeScriptVersionResponse {
  return (
    isRecord(value) &&
    exact(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    value.request_id === requestId &&
    isVersion(value.data, projectId, episodeId, versionId)
  );
}
export function isEpisodeScriptVersionCreatedResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  payload: CreateEpisodeScriptVersionRequest,
): value is EpisodeScriptVersionCreatedResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data) ||
    !exact(value.data, ["version", "replayed"]) ||
    typeof value.data.replayed !== "boolean" ||
    !isVersion(value.data.version, projectId, episodeId)
  )
    return false;
  const version = value.data.version;
  return (
    version.parent_version_id === payload.parent_version_id &&
    version.head_revision === (payload.expected_revision ?? 0) + 1 &&
    JSON.stringify(sortedJson(version.content)) === JSON.stringify(sortedJson(payload.content)) &&
    version.change_summary === payload.change_summary
  );
}

export function episodeScriptDefiniteError(
  status: number,
  value: unknown,
  requestId: string | null,
): EpisodeScriptDefiniteError | null {
  if (
    status !== 401 &&
    status !== 403 &&
    status !== 404 &&
    status !== 409 &&
    status !== 413 &&
    status !== 422 &&
    status !== 428
  )
    return null;
  if (
    !isRecord(value) ||
    !exact(value, ["error", "request_id"]) ||
    typeof value.request_id !== "string" ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.error) ||
    !exact(value.error, ["code", "message", "details", "retryable"]) ||
    typeof value.error.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{2,79}$/.test(value.error.code) ||
    typeof value.error.message !== "string" ||
    !isRecord(value.error.details) ||
    value.error.retryable !== false
  )
    return null;
  return {
    kind: "DEFINITE_SERVER_ERROR",
    status,
    code: value.error.code,
    request_id: value.request_id,
  };
}
