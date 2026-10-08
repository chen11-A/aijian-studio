import type { components } from "@aijian/contracts";

/** Project-shared, manually authored creative drafts. Media and approvals live elsewhere. */
export type CreativeCharacter = components["schemas"]["ProjectCharacterV1"];
export type CreativeWorld = components["schemas"]["ProjectWorldV1"];
export type CreativeScene = components["schemas"]["ProjectSceneV1"];
export type CreativeContent = components["schemas"]["ProjectCreativeLibraryContentV1"];
export type CreativeVersion = components["schemas"]["ProjectCreativeLibraryVersionData"];
export type CreativeWriteCommand = {
  operation_id: string;
  payload: components["schemas"]["CreateProjectCreativeLibraryVersionRequest"];
};
type DefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type CreativeGateway = {
  getProjectCreativeLibrary(
    projectId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: { data: CreativeVersion; request_id: string } }
    | { kind: "EMPTY" }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  getProjectCreativeLibraryVersion(
    projectId: string,
    versionId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: { data: CreativeVersion; request_id: string } }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  createProjectCreativeLibraryVersion(
    projectId: string,
    idempotencyKey: string,
    payload: CreativeWriteCommand["payload"],
  ): Promise<
    | {
        kind: "CREATED";
        receipt: { data: { version: CreativeVersion; replayed: boolean }; request_id: string };
      }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CreativeJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; command: CreativeWriteCommand };
export type CreativeRead =
  | { kind: "FOUND"; version: CreativeVersion }
  | { kind: "EMPTY" }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" };
export type CreativeWrite =
  | { kind: "SAVED"; version: CreativeVersion }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" }
  | { kind: "BLOCKED"; message: string };
export const CREATIVE_PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const CHARACTER = /^chr_[0-9a-f]{32}$/;
const SCENE = /^loc_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max = 20_000): value is string =>
  typeof value === "string" && [...value].length <= max;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function emptyCreativeWorld(): CreativeWorld {
  return { premise: "", rules: "", era: "", visual_style: "", palette: "", materials: "" };
}
export function emptyCreativeContent(projectId: string): CreativeContent {
  return {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: null,
    characters: [],
    world: emptyCreativeWorld(),
    scenes: [],
  };
}
export const cloneCreativeContent = (value: CreativeContent): CreativeContent => ({
  ...value,
  characters: value.characters.map((item) => ({ ...item })),
  world: { ...value.world },
  scenes: value.scenes.map((item) => ({ ...item })),
});
export function sameCreativeJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((item, i) => sameCreativeJson(item, right[i]))
    );
  if (!record(left) || !record(right)) return false;
  const fields = Object.keys(left);
  return (
    fields.length === Object.keys(right).length &&
    fields.every(
      (field) => Object.hasOwn(right, field) && sameCreativeJson(left[field], right[field]),
    )
  );
}
export function validCreativeContent(value: unknown, projectId: string): value is CreativeContent {
  if (
    !CREATIVE_PROJECT_ID.test(projectId) ||
    !record(value) ||
    !exactKeys(value, [
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
    !record(value.world)
  )
    return false;
  const world = value.world;
  if (
    !exactKeys(world, ["premise", "rules", "era", "visual_style", "palette", "materials"]) ||
    !Object.entries(world).every(([key, field]) => text(field, key === "era" ? 240 : 20_000))
  )
    return false;
  const ids = new Set<string>();
  const characters = value.characters.every((item, index) => {
    if (
      !record(item) ||
      !exactKeys(item, [
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
      ids.has(item.character_id) ||
      item.ordinal !== index + 1 ||
      !text(item.name, 120) ||
      !item.name.trim() ||
      item.name !== item.name.trim() ||
      !text(item.role, 240) ||
      !text(item.description) ||
      !text(item.appearance) ||
      !text(item.personality)
    )
      return false;
    ids.add(item.character_id);
    return true;
  });
  return (
    characters &&
    value.scenes.every((item, index) => {
      if (
        !record(item) ||
        !exactKeys(item, [
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
        ids.has(item.scene_id) ||
        item.ordinal !== index + 1 ||
        !text(item.name, 120) ||
        !item.name.trim() ||
        item.name !== item.name.trim() ||
        !text(item.description) ||
        !text(item.location, 240) ||
        !text(item.time_of_day, 240) ||
        !text(item.weather, 240) ||
        !text(item.continuity)
      )
        return false;
      ids.add(item.scene_id);
      return true;
    })
  );
}
export function validCreativeVersion(value: unknown, projectId: string): value is CreativeVersion {
  return (
    record(value) &&
    typeof value.version_id === "string" &&
    VERSION.test(value.version_id) &&
    value.project_id === projectId &&
    value.episode_id === null &&
    positive(value.version_number) &&
    positive(value.head_revision) &&
    (value.parent_version_id === null ||
      (typeof value.parent_version_id === "string" && VERSION.test(value.parent_version_id))) &&
    typeof value.content_hash === "string" &&
    HASH.test(value.content_hash) &&
    typeof value.author_actor_id === "string" &&
    !!value.author_actor_id &&
    text(value.change_summary, 4000) &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at)) &&
    validCreativeContent(value.content, projectId)
  );
}
export async function readCreativeLibrary(
  gateway: CreativeGateway,
  projectId: string,
): Promise<CreativeRead> {
  if (!CREATIVE_PROJECT_ID.test(projectId)) return { kind: "UNKNOWN" };
  try {
    const result = await gateway.getProjectCreativeLibrary(projectId);
    if (result.kind === "EMPTY") return { kind: "EMPTY" };
    if (result.kind === "DEFINITE_SERVER_ERROR")
      return { kind: "REJECTED", status: result.status, code: result.code };
    if (result.kind === "FOUND" && validCreativeVersion(result.receipt.data, projectId))
      return { kind: "FOUND", version: result.receipt.data };
  } catch {
    /* Unknown is not an empty project. */
  }
  return { kind: "UNKNOWN" };
}
const journalKey = (projectId: string) => `aivora.creative-library.pending.v1.${projectId}`;
function validCommand(value: unknown, projectId: string): value is CreativeWriteCommand {
  if (
    !record(value) ||
    typeof value.operation_id !== "string" ||
    !UUID.test(value.operation_id) ||
    !record(value.payload)
  )
    return false;
  const payload = value.payload;
  return (
    validCreativeContent(payload.content, projectId) &&
    text(payload.change_summary, 4000) &&
    !!payload.change_summary.trim() &&
    (payload.parent_version_id === null ||
      (typeof payload.parent_version_id === "string" && VERSION.test(payload.parent_version_id))) &&
    (payload.expected_revision === null || positive(payload.expected_revision)) &&
    (payload.parent_version_id === null) === (payload.expected_revision === null)
  );
}
export function readCreativeJournal(storage: StoragePort, projectId: string): CreativeJournal {
  if (!CREATIVE_PROJECT_ID.test(projectId)) return { kind: "BLOCKED" };
  try {
    const raw = storage.getItem(journalKey(projectId));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > 2_500_000) return { kind: "BLOCKED" };
    const command: unknown = JSON.parse(raw);
    return validCommand(command, projectId) ? { kind: "PENDING", command } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
function persistCommand(
  storage: StoragePort,
  projectId: string,
  command: CreativeWriteCommand,
): boolean {
  try {
    const raw = JSON.stringify(command);
    if (raw.length > 2_500_000) return false;
    storage.setItem(journalKey(projectId), raw);
    const journal = readCreativeJournal(storage, projectId);
    return journal.kind === "PENDING" && sameCreativeJson(journal.command, command);
  } catch {
    return false;
  }
}
function closeCommand(
  storage: StoragePort,
  projectId: string,
  command: CreativeWriteCommand,
): boolean {
  const journal = readCreativeJournal(storage, projectId);
  if (journal.kind !== "PENDING" || !sameCreativeJson(journal.command, command)) return false;
  try {
    storage.removeItem(journalKey(projectId));
    return readCreativeJournal(storage, projectId).kind === "EMPTY";
  } catch {
    return false;
  }
}
/** Recovery sends the persisted operation ID and original payload only; never a new write. */
export async function saveCreativeLibrary(
  gateway: CreativeGateway,
  storage: StoragePort,
  projectId: string,
  command: CreativeWriteCommand,
  recover = false,
): Promise<CreativeWrite> {
  if (
    !validCommand(command, projectId) ||
    new TextEncoder().encode(JSON.stringify(command.payload.content)).length > 2_000_000
  )
    return {
      kind: "BLOCKED",
      message: "设定字段或保存身份无效；名称需为 1 至 120 字，内容总量不超过 2 MB。",
    };
  const journal = readCreativeJournal(storage, projectId);
  if (
    recover
      ? journal.kind !== "PENDING" || !sameCreativeJson(journal.command, command)
      : journal.kind !== "EMPTY"
  )
    return { kind: "BLOCKED", message: "已有待核对的提交；请先核对原提交，未创建重复版本。" };
  if (!recover && !persistCommand(storage, projectId, command))
    return { kind: "BLOCKED", message: "无法保存恢复记录，本次未发送。请检查本地存储是否可用。" };
  try {
    const result = await gateway.createProjectCreativeLibraryVersion(
      projectId,
      command.operation_id,
      command.payload,
    );
    if (result.kind === "DEFINITE_SERVER_ERROR") {
      if (
        [401, 403, 409, 413, 422, 428].includes(result.status) &&
        closeCommand(storage, projectId, command)
      )
        return { kind: "REJECTED", status: result.status, code: result.code };
      return { kind: "UNKNOWN" };
    }
    if (result.kind !== "CREATED" || !validCreativeVersion(result.receipt.data.version, projectId))
      return { kind: "UNKNOWN" };
    const version = result.receipt.data.version;
    if (
      !sameCreativeJson(version.content, command.payload.content) ||
      version.parent_version_id !== command.payload.parent_version_id ||
      version.head_revision < (command.payload.expected_revision ?? 0) + 1
    )
      return { kind: "UNKNOWN" };
    const exact = await gateway.getProjectCreativeLibraryVersion(projectId, version.version_id);
    if (
      exact.kind !== "FOUND" ||
      !validCreativeVersion(exact.receipt.data, projectId) ||
      !sameCreativeJson({ ...exact.receipt.data, head_revision: version.head_revision }, version) ||
      exact.receipt.data.head_revision < version.head_revision
    )
      return { kind: "UNKNOWN" };
    if (!closeCommand(storage, projectId, command)) return { kind: "UNKNOWN" };
    return { kind: "SAVED", version: exact.receipt.data };
  } catch {
    return { kind: "UNKNOWN" };
  }
}
export function newCreativeId(prefix: "chr" | "loc"): string | null {
  try {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  } catch {
    return null;
  }
}
