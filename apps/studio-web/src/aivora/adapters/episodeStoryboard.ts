import type { components } from "@aijian/contracts";

/** Manually authored episode storyboard drafts; no generated or placeholder media. */
export type StoryboardShot = components["schemas"]["EpisodeStoryboardShotV1"];
export type StoryboardContent = components["schemas"]["EpisodeStoryboardContentV1"];
export type StoryboardVersion = components["schemas"]["EpisodeStoryboardVersionData"];
export type StoryboardWriteCommand = {
  operation_id: string;
  payload: components["schemas"]["CreateEpisodeStoryboardVersionRequest"];
};
type DefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type StoryboardGateway = {
  getEpisodeStoryboard(
    projectId: string,
    episodeId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: { data: StoryboardVersion; request_id: string } }
    | { kind: "EMPTY" }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  getEpisodeStoryboardVersion(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: { data: StoryboardVersion; request_id: string } }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  createEpisodeStoryboardVersion(
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: StoryboardWriteCommand["payload"],
  ): Promise<
    | {
        kind: "CREATED";
        receipt: { data: { version: StoryboardVersion; replayed: boolean }; request_id: string };
      }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type StoryboardJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; command: StoryboardWriteCommand };
export type StoryboardRead =
  | { kind: "FOUND"; version: StoryboardVersion }
  | { kind: "EMPTY" }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" };
export type StoryboardWrite =
  | { kind: "SAVED"; version: StoryboardVersion }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" }
  | { kind: "BLOCKED"; message: string };
export const STORYBOARD_PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
export const STORYBOARD_EPISODE_ID = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const SHOT = /^shp_[0-9a-f]{32}$/;
const SCRIPT_SCENE = /^scn_[0-9a-f]{32}$/;
const CHARACTER = /^chr_[0-9a-f]{32}$/;
const SCENE = /^loc_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max = 20_000): value is string =>
  typeof value === "string" &&
  [...value].length <= max &&
  new TextDecoder().decode(new TextEncoder().encode(value)) === value;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function emptyStoryboardContent(projectId: string, episodeId: string): StoryboardContent {
  return {
    schema_version: "1.0.0",
    project_id: projectId,
    episode_id: episodeId,
    fps: 24,
    script_version_id: null,
    creative_library_version_id: null,
    shots: [],
  };
}
export const cloneStoryboardContent = (value: StoryboardContent): StoryboardContent => ({
  ...value,
  shots: value.shots.map((shot) => ({ ...shot, character_ids: [...shot.character_ids] })),
});
export function sameStoryboardJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((item, i) => sameStoryboardJson(item, right[i]))
    );
  if (!record(left) || !record(right)) return false;
  const fields = Object.keys(left);
  return (
    fields.length === Object.keys(right).length &&
    fields.every(
      (field) => Object.hasOwn(right, field) && sameStoryboardJson(left[field], right[field]),
    )
  );
}
export function validStoryboardContent(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is StoryboardContent {
  if (
    !STORYBOARD_PROJECT_ID.test(projectId) ||
    !STORYBOARD_EPISODE_ID.test(episodeId) ||
    !record(value) ||
    !exactKeys(value, [
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
    !positive(value.fps) ||
    value.fps > 120 ||
    !(
      value.script_version_id === null ||
      (typeof value.script_version_id === "string" && VERSION.test(value.script_version_id))
    ) ||
    !(
      value.creative_library_version_id === null ||
      (typeof value.creative_library_version_id === "string" &&
        VERSION.test(value.creative_library_version_id))
    ) ||
    !Array.isArray(value.shots) ||
    value.shots.length > 1000
  )
    return false;
  const ids = new Set<string>();
  return value.shots.every((shot, i) => {
    if (
      !record(shot) ||
      !exactKeys(shot, [
        "shot_id",
        "ordinal",
        "duration_frames",
        "title",
        "description",
        "camera",
        "action",
        "dialogue",
        "script_scene_id",
        "character_ids",
        "location_id",
      ]) ||
      typeof shot.shot_id !== "string" ||
      !SHOT.test(shot.shot_id) ||
      ids.has(shot.shot_id) ||
      shot.ordinal !== i + 1 ||
      !positive(shot.duration_frames) ||
      shot.duration_frames > 864000 ||
      !text(shot.title, 240) ||
      !shot.title.trim() ||
      !text(shot.description) ||
      !text(shot.camera, 240) ||
      !text(shot.action) ||
      !text(shot.dialogue) ||
      !(
        shot.script_scene_id === null ||
        (typeof shot.script_scene_id === "string" &&
          SCRIPT_SCENE.test(shot.script_scene_id) &&
          value.script_version_id !== null)
      ) ||
      !(
        shot.location_id === null ||
        (typeof shot.location_id === "string" &&
          SCENE.test(shot.location_id) &&
          value.creative_library_version_id !== null)
      ) ||
      !Array.isArray(shot.character_ids) ||
      shot.character_ids.length > 500 ||
      new Set(shot.character_ids).size !== shot.character_ids.length ||
      !shot.character_ids.every(
        (id) =>
          typeof id === "string" &&
          CHARACTER.test(id) &&
          value.creative_library_version_id !== null,
      )
    )
      return false;
    ids.add(shot.shot_id);
    return true;
  });
}
export function validStoryboardVersion(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is StoryboardVersion {
  return (
    record(value) &&
    typeof value.version_id === "string" &&
    VERSION.test(value.version_id) &&
    value.project_id === projectId &&
    value.episode_id === episodeId &&
    positive(value.version_number) &&
    positive(value.head_revision) &&
    value.head_revision >= value.version_number &&
    (value.parent_version_id === null ||
      (typeof value.parent_version_id === "string" && VERSION.test(value.parent_version_id))) &&
    typeof value.content_hash === "string" &&
    HASH.test(value.content_hash) &&
    typeof value.author_actor_id === "string" &&
    !!value.author_actor_id &&
    text(value.change_summary, 240) &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at)) &&
    validStoryboardContent(value.content, projectId, episodeId)
  );
}
export async function readStoryboard(
  gateway: StoryboardGateway,
  projectId: string,
  episodeId: string,
): Promise<StoryboardRead> {
  if (!STORYBOARD_PROJECT_ID.test(projectId) || !STORYBOARD_EPISODE_ID.test(episodeId))
    return { kind: "UNKNOWN" };
  try {
    const result = await gateway.getEpisodeStoryboard(projectId, episodeId);
    if (result.kind === "EMPTY") return { kind: "EMPTY" };
    if (result.kind === "DEFINITE_SERVER_ERROR")
      return { kind: "REJECTED", status: result.status, code: result.code };
    if (
      result.kind === "FOUND" &&
      validStoryboardVersion(result.receipt.data, projectId, episodeId)
    )
      return { kind: "FOUND", version: result.receipt.data };
  } catch {
    /* Unknown is not an empty project. */
  }
  return { kind: "UNKNOWN" };
}
const journalKey = (projectId: string, episodeId: string) =>
  `aivora.episode-storyboard.pending.v1.${projectId}.${episodeId}`;
function validCommand(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is StoryboardWriteCommand {
  if (
    !record(value) ||
    typeof value.operation_id !== "string" ||
    !UUID.test(value.operation_id) ||
    !record(value.payload) ||
    !exactKeys(value, ["operation_id", "payload"]) ||
    !exactKeys(value.payload, [
      "content",
      "parent_version_id",
      "expected_revision",
      "change_summary",
    ])
  )
    return false;
  const payload = value.payload;
  return (
    validStoryboardContent(payload.content, projectId, episodeId) &&
    text(payload.change_summary, 240) &&
    !!payload.change_summary.trim() &&
    (payload.parent_version_id === null ||
      (typeof payload.parent_version_id === "string" && VERSION.test(payload.parent_version_id))) &&
    (payload.expected_revision === null || positive(payload.expected_revision)) &&
    (payload.parent_version_id === null) === (payload.expected_revision === null)
  );
}
export function readStoryboardJournal(
  storage: StoragePort,
  projectId: string,
  episodeId: string,
): StoryboardJournal {
  if (!STORYBOARD_PROJECT_ID.test(projectId) || !STORYBOARD_EPISODE_ID.test(episodeId))
    return { kind: "BLOCKED" };
  try {
    const raw = storage.getItem(journalKey(projectId, episodeId));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > 2_500_000) return { kind: "BLOCKED" };
    const command: unknown = JSON.parse(raw);
    return validCommand(command, projectId, episodeId)
      ? { kind: "PENDING", command }
      : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
function persistCommand(
  storage: StoragePort,
  projectId: string,
  episodeId: string,
  command: StoryboardWriteCommand,
): boolean {
  try {
    const raw = JSON.stringify(command);
    if (raw.length > 2_500_000) return false;
    storage.setItem(journalKey(projectId, episodeId), raw);
    const journal = readStoryboardJournal(storage, projectId, episodeId);
    return journal.kind === "PENDING" && sameStoryboardJson(journal.command, command);
  } catch {
    return false;
  }
}
function closeCommand(
  storage: StoragePort,
  projectId: string,
  episodeId: string,
  command: StoryboardWriteCommand,
): boolean {
  const journal = readStoryboardJournal(storage, projectId, episodeId);
  if (journal.kind !== "PENDING" || !sameStoryboardJson(journal.command, command)) return false;
  try {
    storage.removeItem(journalKey(projectId, episodeId));
    return readStoryboardJournal(storage, projectId, episodeId).kind === "EMPTY";
  } catch {
    return false;
  }
}
/** Recovery sends the persisted operation ID and original payload only; never a new write. */
export async function saveStoryboard(
  gateway: StoryboardGateway,
  storage: StoragePort,
  projectId: string,
  episodeId: string,
  command: StoryboardWriteCommand,
  recover = false,
): Promise<StoryboardWrite> {
  if (
    !validCommand(command, projectId, episodeId) ||
    new TextEncoder().encode(JSON.stringify(command.payload.content)).length > 2_000_000
  )
    return {
      kind: "BLOCKED",
      message:
        "分镜字段或保存身份无效；标题需为 1 至 240 字、时长为正整数帧，内容总量不超过 2 MB。",
    };
  const journal = readStoryboardJournal(storage, projectId, episodeId);
  if (
    recover
      ? journal.kind !== "PENDING" || !sameStoryboardJson(journal.command, command)
      : journal.kind !== "EMPTY"
  )
    return { kind: "BLOCKED", message: "已有待核对的提交；请先核对原提交，未创建重复版本。" };
  if (!recover && !persistCommand(storage, projectId, episodeId, command))
    return { kind: "BLOCKED", message: "无法保存恢复记录，本次未发送。请检查本地存储是否可用。" };
  try {
    const result = await gateway.createEpisodeStoryboardVersion(
      projectId,
      episodeId,
      command.operation_id,
      command.payload,
    );
    if (result.kind === "DEFINITE_SERVER_ERROR") {
      if (
        [401, 403, 409, 413, 422, 428].includes(result.status) &&
        closeCommand(storage, projectId, episodeId, command)
      )
        return { kind: "REJECTED", status: result.status, code: result.code };
      return { kind: "UNKNOWN" };
    }
    if (
      result.kind !== "CREATED" ||
      !validStoryboardVersion(result.receipt.data.version, projectId, episodeId)
    )
      return { kind: "UNKNOWN" };
    const version = result.receipt.data.version;
    if (
      !sameStoryboardJson(version.content, command.payload.content) ||
      version.parent_version_id !== command.payload.parent_version_id ||
      version.head_revision < (command.payload.expected_revision ?? 0) + 1
    )
      return { kind: "UNKNOWN" };
    const exact = await gateway.getEpisodeStoryboardVersion(
      projectId,
      episodeId,
      version.version_id,
    );
    if (
      exact.kind !== "FOUND" ||
      !validStoryboardVersion(exact.receipt.data, projectId, episodeId) ||
      !sameStoryboardJson(
        { ...exact.receipt.data, head_revision: version.head_revision },
        version,
      ) ||
      exact.receipt.data.head_revision < version.head_revision
    )
      return { kind: "UNKNOWN" };
    if (!closeCommand(storage, projectId, episodeId, command)) return { kind: "UNKNOWN" };
    return { kind: "SAVED", version: exact.receipt.data };
  } catch {
    return { kind: "UNKNOWN" };
  }
}
export function newStoryboardShot(ordinal: number, fps: number): StoryboardShot | null {
  try {
    return {
      shot_id: `shp_${crypto.randomUUID().replaceAll("-", "")}`,
      ordinal,
      duration_frames: fps * 3,
      title: "新镜头",
      description: "",
      camera: "",
      action: "",
      dialogue: "",
      script_scene_id: null,
      character_ids: [],
      location_id: null,
    };
  } catch {
    return null;
  }
}
export function reorderStoryboardShots(
  shots: StoryboardShot[],
  index: number,
  offset: number,
): StoryboardShot[] {
  if (index < 0 || index + offset < 0 || index + offset >= shots.length) return shots;
  const next = [...shots];
  const [shot] = next.splice(index, 1);
  if (shot) next.splice(index + offset, 0, shot);
  return next.map((item, ordinal) => ({ ...item, ordinal: ordinal + 1 }));
}
export function storyboardShotAtFrame(
  content: StoryboardContent,
  frame: number,
): StoryboardShot | null {
  let end = 0;
  for (const shot of content.shots) {
    end += shot.duration_frames;
    if (frame < end) return shot;
  }
  return content.shots.at(-1) ?? null;
}
