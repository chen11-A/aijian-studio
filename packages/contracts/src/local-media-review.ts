/** Local human observations remain separate from formal approval and assembly CAS. */
import type { components } from "./generated.js";
import { validateClosedModel } from "./closed-json-schema.ts";
import { LOCAL_MEDIA_REVIEW_SCHEMAS } from "./local-media-review-schema.ts";
import { impactCanonical, impactUuid } from "./script-confirmation-impact.ts";
import {
  mediaHash,
  mediaNonblank,
  mediaScope,
  mediaVersionId,
  sameMediaInput,
  type MediaRead,
} from "./media-preparation.ts";

export type LocalMediaReviewTarget = components["schemas"]["LocalMediaReviewTargetData"];
export type LocalMediaReviewInput = components["schemas"]["LocalMediaReviewInputV1"];
export type LocalMediaReviewVersion = components["schemas"]["LocalMediaReviewVersionData"];
export type LocalMediaReviewPage = components["schemas"]["LocalMediaReviewPageData"];
export type LocalMediaReviewStatus = components["schemas"]["LocalMediaReviewStatusData"];
// Native-only routes are deliberately absent from the public OpenAPI types.
export type LocalMediaReviewWrite = {
  input: LocalMediaReviewInput;
  parent_version_id: string | null;
  expected_revision: number | null;
};
export type LocalMediaReviewOperation = {
  operation_id: string;
  payload: LocalMediaReviewWrite;
  version: LocalMediaReviewVersion;
  result_revision: number;
};
export type LocalMediaReviewCommand = { operation_id: string; payload: LocalMediaReviewWrite };
export type LocalMediaReviewTargetQuery = {
  assembly_version_id: string;
  assembly_content_hash: string;
  segment_kind: "AUDIO" | "LITERAL_SUBTITLE";
  segment_id: string;
};
export type LocalMediaReviewStatusQuery = { version_id: string; content_hash: string };
export type LocalMediaReviewRejection = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type LocalMediaReviewGateway = {
  getLocalMediaReviewTarget(
    p: string,
    e: string,
    query: LocalMediaReviewTargetQuery,
  ): Promise<MediaRead<LocalMediaReviewTarget>>;
  listLocalMediaReviews(
    p: string,
    e: string,
    cursor?: string,
  ): Promise<MediaRead<LocalMediaReviewPage>>;
  getLocalMediaReview(
    p: string,
    e: string,
    versionId: string,
  ): Promise<MediaRead<LocalMediaReviewVersion>>;
  getLocalMediaReviewStatus(
    p: string,
    e: string,
    query: LocalMediaReviewStatusQuery,
  ): Promise<MediaRead<LocalMediaReviewStatus>>;
  saveLocalMediaReview(
    p: string,
    e: string,
    command: LocalMediaReviewCommand,
  ): Promise<MediaRead<LocalMediaReviewOperation> | LocalMediaReviewRejection>;
  getLocalMediaReviewOperation(
    p: string,
    e: string,
    command: LocalMediaReviewCommand,
  ): Promise<MediaRead<LocalMediaReviewOperation>>;
};
export const LOCAL_MEDIA_REVIEW_CHANNELS = Object.freeze({
  target: "local-media-review:target",
  list: "local-media-review:list",
  get: "local-media-review:get",
  status: "local-media-review:status",
  save: "local-media-review:save",
  original: "local-media-review:original",
});
export const LOCAL_MEDIA_REVIEW_MAX_BYTES = 64 * 1024;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const model = (v: unknown, name: string, maxBytes = LOCAL_MEDIA_REVIEW_MAX_BYTES) =>
  validateClosedModel(v, name, LOCAL_MEDIA_REVIEW_SCHEMAS, maxBytes);
export function localReviewUtc(v: unknown): v is string {
  return (
    typeof v === "string" &&
    !v.startsWith("0000") &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)
  );
}
export function localReviewTargetQuery(v: unknown): v is LocalMediaReviewTargetQuery {
  return (
    record(v) &&
    exact(v, ["assembly_version_id", "assembly_content_hash", "segment_kind", "segment_id"]) &&
    mediaVersionId(v.assembly_version_id) &&
    hash(v.assembly_content_hash) &&
    (v.segment_kind === "AUDIO" || v.segment_kind === "LITERAL_SUBTITLE") &&
    typeof v.segment_id === "string" &&
    /^seg_[a-z0-9._-]{1,80}$/.test(v.segment_id)
  );
}
export function localReviewStatusQuery(v: unknown): v is LocalMediaReviewStatusQuery {
  return (
    record(v) &&
    exact(v, ["version_id", "content_hash"]) &&
    mediaVersionId(v.version_id) &&
    hash(v.content_hash)
  );
}
export function localReviewCommand(v: unknown, p: string, e: string): v is LocalMediaReviewCommand {
  if (
    !mediaScope(p, e) ||
    !record(v) ||
    !exact(v, ["operation_id", "payload"]) ||
    !impactUuid(v.operation_id) ||
    !model(v.payload, "CreateLocalMediaReviewRequest") ||
    !record(v.payload) ||
    !record(v.payload.input)
  )
    return false;
  const c = v as LocalMediaReviewCommand;
  return (
    c.payload.input.project_id === p &&
    c.payload.input.episode_id === e &&
    mediaNonblank(c.payload.input.observation) &&
    (c.payload.parent_version_id === null) === (c.payload.expected_revision === null)
  );
}
async function snapshotValid(
  s: LocalMediaReviewTarget["snapshot"],
  p: string,
  e: string,
): Promise<boolean> {
  if (s.project_id !== p || s.episode_id !== e) return false;
  const a = s.audio_segment;
  const t = s.subtitle_segment;
  const original = s.media_original;
  if (
    s.segment_kind === "AUDIO"
      ? !a || !original || t !== null
      : !t || a !== null || original !== null
  )
    return false;
  const segment = s.segment_kind === "AUDIO" ? a! : t!;
  if (
    segment.segment_id !== s.segment_id ||
    segment.start_frame >= segment.end_frame ||
    segment.end_frame > s.total_frames ||
    (await mediaHash(segment)) !== s.segment_content_hash
  )
    return false;
  const rate = s.sequence_timebase.frame_rate;
  if (
    !["24000/1001", "24/1", "25/1", "30000/1001"].includes(`${rate.num}/${rate.den}`) ||
    (s.sequence_timebase.timecode_mode === "DROP_FRAME" &&
      (rate.num !== 30000 || rate.den !== 1001))
  )
    return false;
  if (
    a &&
    !sameMediaInput(a.media, {
      asset_id: original!.asset_id,
      asset_version_id: original!.asset_version_id,
      sha256: original!.sha256,
    })
  )
    return false;
  if (a) {
    const dialogue = [a.script_version_id, a.script_block_id, a.speaker_id, a.delivery];
    if (
      a.track_kind === "DIALOGUE"
        ? dialogue.some((v) => v == null)
        : dialogue.some((v) => v != null)
    )
      return false;
  }
  if (t) {
    const lines = t.text.split("\n");
    if (
      lines.length > 2 ||
      lines.some((line) => !mediaNonblank(line) || [...line].length > 28) ||
      [...t.text].some((c) => {
        const n = c.codePointAt(0)!;
        return !(
          (n >= 0x20 && n <= 0x7e) ||
          (n >= 0x4e00 && n <= 0x9fff) ||
          (n >= 0x3000 && n <= 0x3029) ||
          (n >= 0x3030 && n <= 0x303f) ||
          (n >= 0xff01 && n <= 0xff5e) ||
          "\n‘’“”—…".includes(c)
        );
      }) ||
      (t.script_ref && s.script_provenance === null)
    )
      return false;
  }
  const sourceId = a ? (a.script_version_id ?? null) : (t!.script_ref?.script_version_id ?? null);
  const blockId = a ? (a.script_block_id ?? null) : (t!.script_ref?.script_block_id ?? null);
  const source = s.script_source;
  if (
    source &&
    s.script_provenance?.mode === "CONFIRMED" &&
    (source.script_version_id !== s.script_provenance.script_version_id ||
      source.script_content_hash !== s.script_provenance.script_content_hash)
  )
    return false;
  return (
    (sourceId === null) === (source === null) &&
    (source === null ||
      (source.script_version_id === sourceId &&
        source.script_block_id === blockId &&
        (!t?.script_ref || t.script_ref.script_content_hash === source.script_content_hash)))
  );
}
export async function localReviewTarget(
  v: unknown,
  p: string,
  e: string,
  q: LocalMediaReviewTargetQuery,
): Promise<boolean> {
  if (
    !mediaScope(p, e) ||
    !localReviewTargetQuery(q) ||
    !model(v, "LocalMediaReviewTargetData") ||
    !record(v)
  )
    return false;
  const target = v as LocalMediaReviewTarget;
  return (
    target.snapshot.assembly_version_id === q.assembly_version_id &&
    target.snapshot.assembly_content_hash === q.assembly_content_hash &&
    target.snapshot.segment_kind === q.segment_kind &&
    target.snapshot.segment_id === q.segment_id &&
    (await snapshotValid(target.snapshot, p, e)) &&
    (await mediaHash(target.snapshot)) === target.snapshot_hash
  );
}
export async function localReviewVersion(
  v: unknown,
  p: string,
  e: string,
  versionId?: string,
): Promise<boolean> {
  if (
    !mediaScope(p, e) ||
    !model(v, "LocalMediaReviewVersionData", LOCAL_MEDIA_REVIEW_MAX_BYTES + 4096) ||
    !record(v)
  )
    return false;
  const version = v as LocalMediaReviewVersion;
  const content = version.content;
  const i = content.input;
  const s = content.target_snapshot;
  return (
    (!versionId || version.version_id === versionId) &&
    version.version_id !== version.parent_version_id &&
    new TextEncoder().encode(impactCanonical(content)).byteLength <= LOCAL_MEDIA_REVIEW_MAX_BYTES &&
    (version.parent_version_id === null) === (version.version_number === 1) &&
    localReviewUtc(version.created_at) &&
    mediaNonblank(i.observation) &&
    [
      "project_id",
      "episode_id",
      "assembly_version_id",
      "assembly_content_hash",
      "assembly_head_revision",
      "segment_kind",
      "segment_id",
      "segment_content_hash",
    ].every((key) => i[key as keyof typeof i] === s[key as keyof typeof s]) &&
    content.observation_method ===
      (i.segment_kind === "AUDIO"
        ? "ORIGINAL_AUDIO_LISTENING"
        : "LITERAL_SUBTITLE_TEXT_AND_RANGE") &&
    (await snapshotValid(s, p, e)) &&
    (await mediaHash(s)) === i.target_snapshot_hash &&
    (await mediaHash(content)) === version.content_hash
  );
}
export async function localReviewOperation(
  v: unknown,
  p: string,
  e: string,
  c: LocalMediaReviewCommand,
): Promise<boolean> {
  if (
    !localReviewCommand(c, p, e) ||
    !model(v, "LocalMediaReviewOperationData", 2 * LOCAL_MEDIA_REVIEW_MAX_BYTES + 4096) ||
    !record(v)
  )
    return false;
  const op = v as LocalMediaReviewOperation;
  return (
    op.operation_id === c.operation_id &&
    sameMediaInput(op.payload, c.payload) &&
    sameMediaInput(op.version.content.input, c.payload.input) &&
    op.version.parent_version_id === c.payload.parent_version_id &&
    op.version.version_number === op.result_revision &&
    op.result_revision === (c.payload.expected_revision ?? 0) + 1 &&
    (await localReviewVersion(op.version, p, e))
  );
}
export async function localReviewPage(
  v: unknown,
  p: string,
  e: string,
  cursor?: string,
): Promise<boolean> {
  if (
    !mediaScope(p, e) ||
    (cursor !== undefined && !mediaVersionId(cursor)) ||
    !model(v, "LocalMediaReviewPageData", 20 * (LOCAL_MEDIA_REVIEW_MAX_BYTES + 4096) + 4096) ||
    !record(v)
  )
    return false;
  const page = v as LocalMediaReviewPage;
  if (
    page.project_id !== p ||
    page.episode_id !== e ||
    (page.head_version_id === null) !== (page.head_revision === null) ||
    (page.head_version_id === null && (page.items.length > 0 || page.next_cursor !== null)) ||
    (!cursor && page.head_version_id !== null && page.items.length === 0) ||
    (page.next_cursor !== null && page.items.length !== 20) ||
    (page.next_cursor !== null && page.items.at(-1)?.version_id !== page.next_cursor) ||
    page.next_cursor === cursor ||
    new Set(page.items.map((i) => i.version_id)).size !== page.items.length ||
    page.items.some(
      (i, n) =>
        i.version_id === cursor ||
        i.version_number > (page.head_revision ?? 0) ||
        (n > 0 && i.version_number >= page.items[n - 1]!.version_number),
    ) ||
    (!cursor &&
      page.items.length > 0 &&
      (page.head_version_id !== page.items[0]!.version_id ||
        page.head_revision !== page.items[0]!.version_number))
  )
    return false;
  return (await Promise.all(page.items.map((i) => localReviewVersion(i, p, e)))).every(Boolean);
}
export function localReviewStatus(
  v: unknown,
  q: LocalMediaReviewStatusQuery,
): v is LocalMediaReviewStatus {
  if (!localReviewStatusQuery(q) || !model(v, "LocalMediaReviewStatusData") || !record(v))
    return false;
  const status = v as LocalMediaReviewStatus;
  return (
    status.review_version_id === q.version_id &&
    status.review_content_hash === q.content_hash &&
    localReviewUtc(status.checked_at) &&
    (status.applicability === "CURRENT"
      ? status.current_assembly !== null && status.reasons.length === 0
      : status.reasons.length > 0)
  );
}
export function localReviewRejection(v: unknown): v is LocalMediaReviewRejection {
  if (
    !record(v) ||
    !exact(v, ["kind", "status", "code", "request_id"]) ||
    v.kind !== "DEFINITE_SERVER_ERROR" ||
    !impactUuid(v.request_id) ||
    typeof v.code !== "string"
  )
    return false;
  const statuses: Readonly<Record<string, number>> = {
    SIDECAR_AUTH_REQUIRED: 401,
    SIDECAR_REQUEST_REJECTED: 403,
    LOCAL_MEDIA_REVIEW_ACTOR_FORBIDDEN: 403,
    LOCAL_MEDIA_REVIEW_SCOPE_NOT_FOUND: 404,
    LOCAL_MEDIA_REVIEW_CONFLICT: 409,
    LOCAL_MEDIA_REVIEW_INPUT_REJECTED: 422,
    VALIDATION_ERROR: 422,
    PRECONDITION_REQUIRED: 428,
  };
  return Object.hasOwn(statuses, v.code) && statuses[v.code] === v.status;
}
