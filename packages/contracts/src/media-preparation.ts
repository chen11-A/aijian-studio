import type { components } from "./generated.js";
import { MEDIA_PREPARATION_SCHEMAS } from "./media-preparation-schema.ts";
import { validateClosedModel } from "./closed-json-schema.ts";
import {
  impactCanonical,
  impactEpisode,
  impactProject,
  impactUuid,
} from "./script-confirmation-impact.ts";

export type MediaPreparationInput = components["schemas"]["MediaPreparationInputV1"];
export type MediaPreparationVersion = components["schemas"]["MediaPreparationVersionData"];
export type MediaPreparationPage = components["schemas"]["MediaPreparationPageData"];
export type MediaPreparationWrite = {
  input: MediaPreparationInput;
  parent_version_id: string | null;
  expected_revision: number | null;
};
export type MediaPreparationCommand = { operation_id: string; payload: MediaPreparationWrite };
export type MediaPreparationOperation = {
  operation_id: string;
  payload: MediaPreparationWrite;
  version: MediaPreparationVersion;
};
export type MediaRead<T> =
  { kind: "FOUND"; receipt: { data: T; request_id: string } } | { kind: "REMOTE_UNKNOWN" };
export type MediaPreparationRejection = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type MediaPreparationGateway = {
  listMediaPreparations(
    projectId: string,
    episodeId: string,
    cursor?: string,
  ): Promise<MediaRead<MediaPreparationPage>>;
  getMediaPreparation(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<MediaRead<MediaPreparationVersion>>;
  saveMediaPreparation(
    projectId: string,
    episodeId: string,
    command: MediaPreparationCommand,
  ): Promise<MediaRead<MediaPreparationOperation> | MediaPreparationRejection>;
  getMediaPreparationOperation(
    projectId: string,
    episodeId: string,
    command: MediaPreparationCommand,
  ): Promise<MediaRead<MediaPreparationOperation>>;
};
export const MEDIA_PREPARATION_CHANNELS = Object.freeze({
  list: "media-preparation:list",
  get: "media-preparation:get",
  save: "media-preparation:save",
  original: "media-preparation:original",
});
export const mediaVersionId = (v: unknown): v is string =>
  typeof v === "string" && /^ver_[0-9a-f]{32}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
// Match Python str.strip used by these persisted Pydantic models exactly.
const PYTHON_BLANK_CODEPOINTS = new Set([
  0x9, 0xa, 0xb, 0xc, 0xd, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
  0x3000,
]);
export const mediaNonblank = (v: string): boolean =>
  [...v].some((c) => !PYTHON_BLANK_CODEPOINTS.has(c.charCodeAt(0)));
export const sameMediaInput = (a: unknown, b: unknown) => impactCanonical(a) === impactCanonical(b);
const model = (v: unknown, name: string, max = 256 * 1024) =>
  validateClosedModel(v, name, MEDIA_PREPARATION_SCHEMAS, max);
export function mediaInput(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is MediaPreparationInput {
  if (!model(v, "MediaPreparationInputV1") || !record(v)) return false;
  return (
    v.project_id === projectId &&
    v.episode_id === episodeId &&
    typeof v.prompt === "string" &&
    mediaNonblank(v.prompt) &&
    (v.capability_intent !== "IMAGE" || v.requested_frames === 1)
  );
}
export function mediaWrite(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is MediaPreparationWrite {
  if (
    !model(v, "CreateMediaPreparationRequest") ||
    !record(v) ||
    !mediaInput(v.input, projectId, episodeId)
  )
    return false;
  return (v.parent_version_id === null) === (v.expected_revision === null);
}
export function mediaCommand(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is MediaPreparationCommand {
  return (
    record(v) &&
    Object.keys(v).length === 2 &&
    impactUuid(v.operation_id) &&
    mediaWrite(v.payload, projectId, episodeId)
  );
}
export function mediaVersion(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is MediaPreparationVersion {
  if (!model(v, "MediaPreparationVersionData", 256 * 1024 + 4096) || !record(v)) return false;
  const version = v as MediaPreparationVersion;
  if (!mediaInput(version.content.input, projectId, episodeId)) return false;
  const { snapshot, input } = version.content;
  const fields = Object.keys(snapshot.shot);
  const kind = snapshot.storyboard_schema_version;
  if (new TextEncoder().encode(impactCanonical(version.content)).byteLength > 256 * 1024)
    return false;
  if (
    snapshot.shot.shot_id !== input.shot_id ||
    version.version_id === version.parent_version_id ||
    fields.includes("character_bindings") !== (kind !== "1.0.0") ||
    fields.includes("coverage_notes") !== ["1.3.0", "1.4.0", "1.5.0"].includes(kind) ||
    fields.includes("environment_binding") !== ["1.4.0", "1.5.0"].includes(kind)
  )
    return false;
  const shot = snapshot.shot;
  if (!mediaNonblank(shot.title) || new Set(shot.character_ids).size !== shot.character_ids.length)
    return false;
  if (shot.script_scene_id !== null && snapshot.script_version_id === null) return false;
  if (
    (shot.character_ids.length > 0 ||
      shot.location_id !== null ||
      snapshot.selected_references.length > 0 ||
      snapshot.visual_bible_version_id !== null) &&
    snapshot.creative_library_version_id === null
  )
    return false;
  if (["1.0.0", "1.1.0"].includes(kind) && snapshot.visual_bible_version_id !== null) return false;
  const refs = new Map(snapshot.selected_references.map((r) => [r.reference_id, r]));
  if (
    refs.size !== snapshot.selected_references.length ||
    snapshot.selected_references.some((r) => !mediaNonblank(r.label))
  )
    return false;
  const selected = new Set<string>();
  if ("character_bindings" in shot) {
    const owners = new Set<string>();
    for (const binding of shot.character_bindings) {
      if (owners.has(binding.character_id) || !shot.character_ids.includes(binding.character_id))
        return false;
      owners.add(binding.character_id);
      if (new Set(binding.reference_ids).size !== binding.reference_ids.length) return false;
      for (const id of binding.reference_ids) {
        const r = refs.get(id);
        if (
          !r ||
          !("character_id" in r) ||
          r.character_id !== binding.character_id ||
          (r.costume_id !== null && r.costume_id !== binding.costume_id)
        )
          return false;
        selected.add(id);
      }
    }
  }
  if ("environment_binding" in shot) {
    if (shot.environment_binding.variant_id !== null && shot.location_id === null) return false;
    if (
      new Set(shot.environment_binding.reference_ids).size !==
      shot.environment_binding.reference_ids.length
    )
      return false;
    for (const id of shot.environment_binding.reference_ids) {
      const r = refs.get(id);
      if (
        !r ||
        !("scene_id" in r) ||
        (r.scene_id !== null && r.scene_id !== shot.location_id) ||
        (r.variant_id !== null && r.variant_id !== shot.environment_binding.variant_id)
      )
        return false;
      selected.add(id);
    }
  }
  return selected.size === refs.size && [...selected].every((id) => refs.has(id));
}
export async function mediaHash(v: unknown): Promise<string | null> {
  try {
    const b = new TextEncoder().encode(impactCanonical(v));
    const h = await globalThis.crypto.subtle.digest("SHA-256", b);
    return `sha256:${[...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}
export async function verifiedMediaVersion(v: unknown, p: string, e: string): Promise<boolean> {
  return mediaVersion(v, p, e) && (await mediaHash(v.content)) === v.content_hash;
}
export async function mediaOperation(
  v: unknown,
  p: string,
  e: string,
  c: MediaPreparationCommand,
): Promise<boolean> {
  if (!model(v, "MediaPreparationOperationData", 512 * 1024) || !record(v)) return false;
  const op = v as MediaPreparationOperation;
  return (
    op.operation_id === c.operation_id &&
    sameMediaInput(op.payload, c.payload) &&
    sameMediaInput(op.version.content.input, c.payload.input) &&
    op.version.parent_version_id === c.payload.parent_version_id &&
    (await verifiedMediaVersion(op.version, p, e))
  );
}
export async function mediaPage(v: unknown, p: string, e: string): Promise<boolean> {
  if (!model(v, "MediaPreparationPageData", 6 * 1024 * 1024) || !record(v)) return false;
  const page = v as MediaPreparationPage;
  if (
    page.project_id !== p ||
    page.episode_id !== e ||
    (page.head_version_id === null) !== (page.head_revision === null) ||
    (page.head_version_id === null && page.items.length)
  )
    return false;
  if (
    new Set(page.items.map((i) => i.version_id)).size !== page.items.length ||
    page.items.some((i, n) => n > 0 && i.version_number >= page.items[n - 1]!.version_number) ||
    (page.next_cursor !== null && page.items.at(-1)?.version_id !== page.next_cursor)
  )
    return false;
  return (await Promise.all(page.items.map((i) => verifiedMediaVersion(i, p, e)))).every(Boolean);
}
export function mediaRejection(v: unknown): v is MediaPreparationRejection {
  if (
    !record(v) ||
    Object.keys(v).length !== 4 ||
    v.kind !== "DEFINITE_SERVER_ERROR" ||
    !impactUuid(v.request_id) ||
    typeof v.code !== "string"
  )
    return false;
  const statuses: Readonly<Record<string, number>> = {
    SIDECAR_AUTH_REQUIRED: 401,
    SIDECAR_REQUEST_REJECTED: 403,
    MEDIA_PREPARATION_SCOPE_NOT_FOUND: 404,
    MEDIA_PREPARATION_CONFLICT: 409,
    MEDIA_PREPARATION_INPUT_REJECTED: 422,
    VALIDATION_ERROR: 422,
    PRECONDITION_REQUIRED: 428,
  };
  return Object.hasOwn(statuses, v.code) && statuses[v.code] === v.status;
}
export function mediaScope(p: unknown, e: unknown): boolean {
  return impactProject(p) && impactEpisode(e);
}
