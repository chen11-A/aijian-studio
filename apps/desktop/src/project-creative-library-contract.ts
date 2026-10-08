import { createHash } from "node:crypto";
import type { components } from "@aijian/contracts";
import { hasRequestId, isRecord } from "./api-contract-guards";
import { episodeScriptDefiniteError } from "./episode-script-contract";

export type CreateProjectCreativeLibraryVersionRequest =
  components["schemas"]["CreateProjectCreativeLibraryVersionRequest"];
export type ProjectCreativeLibraryContent =
  components["schemas"]["ProjectCreativeLibraryContentV1"];
export type ProjectCreativeLibraryVersion =
  components["schemas"]["ProjectCreativeLibraryVersionData"];
export type ProjectCreativeLibraryVersionResponse =
  components["schemas"]["ProjectCreativeLibraryVersionResponse"];
export type ProjectCreativeLibraryVersionCreatedResponse =
  components["schemas"]["ProjectCreativeLibraryVersionCreatedResponse"];
type DefiniteError = NonNullable<ReturnType<typeof episodeScriptDefiniteError>>;
export type ProjectCreativeLibraryLatestResult =
  | { kind: "FOUND"; receipt: ProjectCreativeLibraryVersionResponse }
  | { kind: "EMPTY" }
  | DefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type ProjectCreativeLibraryVersionResult =
  | { kind: "FOUND"; receipt: ProjectCreativeLibraryVersionResponse }
  | DefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type ProjectCreativeLibraryCreateResult =
  | { kind: "CREATED"; receipt: ProjectCreativeLibraryVersionCreatedResponse }
  | DefiniteError
  | { kind: "REMOTE_UNKNOWN" };
export type ProjectCreativeLibraryGateway = {
  getProjectCreativeLibrary(projectId: string): Promise<ProjectCreativeLibraryLatestResult>;
  getProjectCreativeLibraryVersion(
    projectId: string,
    versionId: string,
  ): Promise<ProjectCreativeLibraryVersionResult>;
  createProjectCreativeLibraryVersion(
    projectId: string,
    idempotencyKey: string,
    payload: CreateProjectCreativeLibraryVersionRequest,
  ): Promise<ProjectCreativeLibraryCreateResult>;
};
export const PROJECT_CREATIVE_LIBRARY_CHANNELS = Object.freeze({
  latest: "project-creative-library:latest",
  version: "project-creative-library:version",
  create: "project-creative-library:create-version",
} as const);
export const projectCreativeLibraryDefiniteError = episodeScriptDefiniteError;

const PROJECT = /^prj_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const CHARACTER = /^chr_[0-9a-f]{32}$/;
const SCENE = /^loc_[0-9a-f]{32}$/;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function text(value: unknown, max: number, required = false): value is string {
  return (
    typeof value === "string" &&
    [...value].length <= max &&
    (!required || value.trim().length > 0) &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
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
export function isCreativeProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT.test(value);
}
export function isCreativeVersionId(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}
export function isCreativeIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,240}$/.test(value);
}
export function isProjectCreativeLibraryContent(
  value: unknown,
  projectId: string,
): value is ProjectCreativeLibraryContent {
  if (
    !isRecord(value) ||
    !exact(value, [
      "schema_version",
      "project_id",
      "episode_id",
      "characters",
      "world",
      "scenes",
    ]) ||
    value.schema_version !== "1.0.0" ||
    value.project_id !== projectId ||
    value.episode_id !== null ||
    !Array.isArray(value.characters) ||
    value.characters.length > 500 ||
    !Array.isArray(value.scenes) ||
    value.scenes.length > 500 ||
    !isRecord(value.world)
  )
    return false;
  const world = value.world;
  if (
    !exact(world, ["premise", "rules", "era", "visual_style", "palette", "materials"]) ||
    !text(world.era, 240) ||
    ![world.premise, world.rules, world.visual_style, world.palette, world.materials].every(
      (item) => text(item, 20_000),
    )
  )
    return false;
  const seen = new Set<string>();
  const charactersValid = value.characters.every((item: unknown, index: number) => {
    if (
      !isRecord(item) ||
      !exact(item, [
        "character_id",
        "ordinal",
        "name",
        "role",
        "description",
        "appearance",
        "personality",
      ]) ||
      typeof item.character_id !== "string" ||
      !CHARACTER.test(item.character_id) ||
      seen.has(item.character_id) ||
      item.ordinal !== index + 1 ||
      !text(item.name, 120, true) ||
      !text(item.role, 240) ||
      ![item.description, item.appearance, item.personality].every((entry) => text(entry, 20_000))
    )
      return false;
    seen.add(item.character_id);
    return true;
  });
  const scenesValid = value.scenes.every((item: unknown, index: number) => {
    if (
      !isRecord(item) ||
      !exact(item, [
        "scene_id",
        "ordinal",
        "name",
        "description",
        "location",
        "time_of_day",
        "weather",
        "continuity",
      ]) ||
      typeof item.scene_id !== "string" ||
      !SCENE.test(item.scene_id) ||
      seen.has(item.scene_id) ||
      item.ordinal !== index + 1 ||
      !text(item.name, 120, true) ||
      ![item.location, item.time_of_day, item.weather].every((entry) => text(entry, 240)) ||
      ![item.description, item.continuity].every((entry) => text(entry, 20_000))
    )
      return false;
    seen.add(item.scene_id);
    return true;
  });
  return (
    charactersValid && scenesValid && Buffer.byteLength(JSON.stringify(value), "utf8") <= 2_000_000
  );
}
export function isCreateProjectCreativeLibraryVersionRequest(
  value: unknown,
  projectId: string,
): value is CreateProjectCreativeLibraryVersionRequest {
  return (
    isRecord(value) &&
    exact(value, ["content", "parent_version_id", "expected_revision", "change_summary"]) &&
    isProjectCreativeLibraryContent(value.content, projectId) &&
    (value.parent_version_id === null || isCreativeVersionId(value.parent_version_id)) &&
    (value.expected_revision === null || positive(value.expected_revision)) &&
    (value.parent_version_id === null) === (value.expected_revision === null) &&
    text(value.change_summary, 240, true)
  );
}
function isVersion(
  value: unknown,
  projectId: string,
  versionId?: string,
): value is ProjectCreativeLibraryVersion {
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
    !isCreativeVersionId(value.version_id) ||
    (versionId !== undefined && value.version_id !== versionId) ||
    value.project_id !== projectId ||
    value.episode_id !== null ||
    !positive(value.version_number) ||
    !positive(value.head_revision) ||
    value.head_revision < value.version_number ||
    !(value.parent_version_id === null || isCreativeVersionId(value.parent_version_id)) ||
    (value.parent_version_id === null) !== (value.version_number === 1) ||
    !isProjectCreativeLibraryContent(value.content, projectId) ||
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
export function isProjectCreativeLibraryVersionResponse(
  value: unknown,
  projectId: string,
  requestId: string | null,
  versionId?: string,
): value is ProjectCreativeLibraryVersionResponse {
  return (
    isRecord(value) &&
    exact(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    value.request_id === requestId &&
    isVersion(value.data, projectId, versionId)
  );
}
export function isProjectCreativeLibraryVersionCreatedResponse(
  value: unknown,
  projectId: string,
  requestId: string | null,
  payload: CreateProjectCreativeLibraryVersionRequest,
): value is ProjectCreativeLibraryVersionCreatedResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    value.request_id !== requestId ||
    !isRecord(value.data) ||
    !exact(value.data, ["version", "replayed"]) ||
    typeof value.data.replayed !== "boolean" ||
    !isVersion(value.data.version, projectId)
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
