import { createHash } from "node:crypto";
import type { components } from "@aijian/contracts";
import { hasRequestId, isRecord } from "./api-contract-guards";
import { episodeScriptDefiniteError } from "./episode-script-contract";

export type EpisodeStoryboardShot = components["schemas"]["EpisodeStoryboardShotV1"];
export type EpisodeStoryboardContent = components["schemas"]["EpisodeStoryboardContentV1"];
export type CreateEpisodeStoryboardVersionRequest =
  components["schemas"]["CreateEpisodeStoryboardVersionRequest"];
export type EpisodeStoryboardVersion = components["schemas"]["EpisodeStoryboardVersionData"];
export type EpisodeStoryboardVersionResponse =
  components["schemas"]["EpisodeStoryboardVersionResponse"];
export type EpisodeStoryboardVersionCreatedResponse =
  components["schemas"]["EpisodeStoryboardVersionCreatedResponse"];
type DefiniteError = NonNullable<ReturnType<typeof episodeScriptDefiniteError>>;
export type EpisodeStoryboardLatestResult =
  | { kind: "FOUND"; receipt: EpisodeStoryboardVersionResponse }
  | { kind: "EMPTY" }
  | DefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type EpisodeStoryboardVersionResult =
  | { kind: "FOUND"; receipt: EpisodeStoryboardVersionResponse }
  | DefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type EpisodeStoryboardCreateResult =
  | { kind: "CREATED"; receipt: EpisodeStoryboardVersionCreatedResponse }
  | DefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type EpisodeStoryboardGateway = {
  getEpisodeStoryboard(
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeStoryboardLatestResult>;
  getEpisodeStoryboardVersion(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<EpisodeStoryboardVersionResult>;
  createEpisodeStoryboardVersion(
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: CreateEpisodeStoryboardVersionRequest,
  ): Promise<EpisodeStoryboardCreateResult>;
};
export const EPISODE_STORYBOARD_CHANNELS = Object.freeze({
  latest: "episode-storyboard:latest",
  version: "episode-storyboard:version",
  create: "episode-storyboard:create-version",
} as const);
// Storage failures and unreadable responses remain unknown; never infer that a write did not commit.
export const episodeStoryboardDefiniteError = episodeScriptDefiniteError;

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const SHOT = /^shp_[0-9a-f]{32}$/;
const SCRIPT_SCENE = /^scn_[0-9a-f]{32}$/;
const CHARACTER = /^chr_[0-9a-f]{32}$/;
const LOCATION = /^loc_[0-9a-f]{32}$/;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function optionalId(value: unknown, pattern: RegExp): value is string | null {
  return value === null || id(value, pattern);
}
function text(value: unknown, max: number, required = false): value is string {
  return (
    typeof value === "string" &&
    [...value].length <= max &&
    (!required || value.trim().length > 0) &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
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
export function isEpisodeStoryboardProjectId(value: unknown): value is string {
  return id(value, PROJECT);
}
export function isEpisodeStoryboardEpisodeId(value: unknown): value is string {
  return id(value, EPISODE);
}
export function isEpisodeStoryboardVersionId(value: unknown): value is string {
  return id(value, VERSION);
}
export function isEpisodeStoryboardIdempotencyKey(value: unknown): value is string {
  return id(value, /^[\x21-\x7e]{1,240}$/);
}
export function isEpisodeStoryboardContent(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is EpisodeStoryboardContent {
  if (
    !isEpisodeStoryboardProjectId(projectId) ||
    !isEpisodeStoryboardEpisodeId(episodeId) ||
    !isRecord(value) ||
    !exact(value, [
      "schema_version",
      "project_id",
      "episode_id",
      "fps",
      "script_version_id",
      "creative_library_version_id",
      "shots",
    ]) ||
    value.schema_version !== "1.0.0" ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !positive(value.fps, 120) ||
    !optionalId(value.script_version_id, VERSION) ||
    !optionalId(value.creative_library_version_id, VERSION) ||
    !Array.isArray(value.shots) ||
    value.shots.length > 1_000
  )
    return false;
  const seen = new Set<string>();
  for (const [index, shot] of value.shots.entries()) {
    if (
      !isRecord(shot) ||
      !exact(shot, [
        "shot_id",
        "ordinal",
        "duration_frames",
        "title",
        "description",
        "action",
        "dialogue",
        "camera",
        "script_scene_id",
        "character_ids",
        "location_id",
      ]) ||
      !id(shot.shot_id, SHOT) ||
      seen.has(shot.shot_id) ||
      shot.ordinal !== index + 1 ||
      !positive(shot.duration_frames, 864_000) ||
      !text(shot.title, 240, true) ||
      ![shot.description, shot.action, shot.dialogue].every((entry) => text(entry, 20_000)) ||
      !text(shot.camera, 240) ||
      !optionalId(shot.script_scene_id, SCRIPT_SCENE) ||
      !optionalId(shot.location_id, LOCATION) ||
      !Array.isArray(shot.character_ids) ||
      shot.character_ids.length > 500 ||
      !Array.from(shot.character_ids).every((entry) => id(entry, CHARACTER)) ||
      new Set(shot.character_ids).size !== shot.character_ids.length ||
      (shot.script_scene_id !== null && value.script_version_id === null) ||
      ((shot.character_ids.length > 0 || shot.location_id !== null) &&
        value.creative_library_version_id === null)
    )
      return false;
    seen.add(shot.shot_id);
  }
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= 2_000_000;
}
export function isCreateEpisodeStoryboardVersionRequest(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is CreateEpisodeStoryboardVersionRequest {
  return (
    isRecord(value) &&
    exact(value, ["content", "parent_version_id", "expected_revision", "change_summary"]) &&
    isEpisodeStoryboardContent(value.content, projectId, episodeId) &&
    optionalId(value.parent_version_id, VERSION) &&
    (value.expected_revision === null || positive(value.expected_revision)) &&
    (value.parent_version_id === null) === (value.expected_revision === null) &&
    text(value.change_summary, 240, true)
  );
}
function isVersion(
  value: unknown,
  projectId: string,
  episodeId: string,
  versionId?: string,
): value is EpisodeStoryboardVersion {
  if (
    !isRecord(value) ||
    !exact(value, [
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
    ]) ||
    !isEpisodeStoryboardVersionId(value.version_id) ||
    (versionId !== undefined && value.version_id !== versionId) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !positive(value.version_number) ||
    !positive(value.head_revision) ||
    value.head_revision < value.version_number ||
    !optionalId(value.parent_version_id, VERSION) ||
    (value.parent_version_id === null) !== (value.version_number === 1) ||
    !isEpisodeStoryboardContent(value.content, projectId, episodeId) ||
    !text(value.author_actor_id, 240, true) ||
    !text(value.change_summary, 240, true) ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at))
  )
    return false;
  return (
    value.content_hash ===
    `sha256:${createHash("sha256")
      .update(JSON.stringify(sortedJson(value.content)), "utf8")
      .digest("hex")}`
  );
}
export function isEpisodeStoryboardVersionResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  versionId?: string,
): value is EpisodeStoryboardVersionResponse {
  return (
    isRecord(value) &&
    exact(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    value.request_id === requestId &&
    isVersion(value.data, projectId, episodeId, versionId)
  );
}
export function isEpisodeStoryboardVersionCreatedResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  payload: CreateEpisodeStoryboardVersionRequest,
): value is EpisodeStoryboardVersionCreatedResponse {
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
  const revision = (payload.expected_revision ?? 0) + 1;
  return (
    version.parent_version_id === payload.parent_version_id &&
    (value.data.replayed
      ? version.head_revision >= revision
      : version.head_revision === revision) &&
    JSON.stringify(sortedJson(version.content)) === JSON.stringify(sortedJson(payload.content)) &&
    version.change_summary === payload.change_summary
  );
}
