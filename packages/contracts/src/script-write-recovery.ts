import { impactCanonical } from "./script-confirmation-impact.ts";

export type ScriptWriteOperation<V> = {
  operation_id: string;
  project_id: string;
  episode_id: string;
  idempotency_key_hash: string;
  request_hash: string;
  version: V;
};
export type ScriptWriteOperationResult<V> =
  | { kind: "FOUND"; receipt: { data: ScriptWriteOperation<V>; request_id: string } }
  | { kind: "REMOTE_UNKNOWN" };
export const SCRIPT_WRITE_OPERATION_CHANNEL = "episode-script:original-write";
export function scriptWriteMutationRejection(v: unknown): boolean {
  if (
    !record(v) ||
    Object.keys(v).length !== 4 ||
    !scriptWriteOperationId(v.request_id) ||
    typeof v.code !== "string"
  )
    return false;
  const statuses: Readonly<Record<string, number>> = {
    SIDECAR_AUTH_REQUIRED: 401,
    SIDECAR_REQUEST_REJECTED: 403,
    SCRIPT_CONFLICT: 409,
    SCRIPT_TOO_LARGE: 413,
    SCRIPT_INPUT_REJECTED: 422,
    VALIDATION_ERROR: 422,
    PRECONDITION_REQUIRED: 428,
  };
  return (
    v.kind === "DEFINITE_SERVER_ERROR" &&
    Object.hasOwn(statuses, v.code) &&
    v.status === statuses[v.code]
  );
}
export const scriptWriteOperationId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);

export function scriptWriteOperationShape<V>(
  v: unknown,
  projectId: string,
  episodeId: string,
  operationId: string,
  isVersion: (v: unknown) => v is V,
): v is ScriptWriteOperation<V> {
  return (
    record(v) &&
    Object.keys(v).length === 6 &&
    v.project_id === projectId &&
    v.episode_id === episodeId &&
    v.operation_id === operationId &&
    scriptWriteOperationId(operationId) &&
    hash(v.idempotency_key_hash) &&
    hash(v.request_hash) &&
    isVersion(v.version)
  );
}

// Match the existing Pydantic defaults, without inventing dialogue delivery.
// The original pending JSON and historical content bytes are never rewritten.
function normalizedContent(v: unknown): unknown {
  if (!record(v) || !Array.isArray(v.scenes)) throw new Error("Invalid script content");
  return {
    ...v,
    production_brief_version_id: v.production_brief_version_id ?? null,
    story_bible_version_id: v.story_bible_version_id ?? null,
    source_extraction_version_id: v.source_extraction_version_id ?? null,
    source_proposal_acceptance_id: v.source_proposal_acceptance_id ?? null,
    scenes: v.scenes.map((s: unknown) => {
      if (!record(s) || !Array.isArray(s.blocks)) throw new Error("Invalid script scene");
      return {
        ...s,
        blocks: s.blocks.map((b: unknown) => {
          if (!record(b)) throw new Error("Invalid script block");
          return { ...b, delivery: b.delivery ?? null };
        }),
      };
    }),
  };
}
export async function scriptWriteHash(v: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(impactCanonical(v)),
  );
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Full original identity/body attribution. Never derives a terminal from a GET error. */
export async function verifyScriptWriteOperation(
  operation: ScriptWriteOperation<{
    version_number: number;
    head_revision: number;
    parent_version_id: string | null;
    content: unknown;
    content_hash: string;
    author_actor_id: string;
    change_summary: string;
  }>,
  payload: {
    content: unknown;
    parent_version_id: string | null;
    expected_revision: number | null;
    change_summary: string;
  },
  digest: (v: unknown) => Promise<string> = scriptWriteHash,
): Promise<boolean> {
  try {
    const version = operation.version;
    const normalized = { ...payload, content: normalizedContent(payload.content) };
    const identity = {
      project_id: operation.project_id,
      episode_id: operation.episode_id,
      actor_id: version.author_actor_id,
      payload: normalized,
    };
    if (
      version.version_number !== (payload.expected_revision ?? 0) + 1 ||
      version.head_revision < version.version_number ||
      version.parent_version_id !== payload.parent_version_id ||
      version.change_summary !== payload.change_summary ||
      impactCanonical(normalizedContent(version.content)) !== impactCanonical(normalized.content) ||
      operation.idempotency_key_hash !== (await digest({ value: operation.operation_id })) ||
      version.content_hash !== (await digest(version.content))
    )
      return false;
    if (operation.request_hash === (await digest(identity))) return true;
    // Exact pre-delivery hash, only when the original input lacks all added fields.
    const content = payload.content;
    if (
      !record(content) ||
      !Array.isArray(content.scenes) ||
      [
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
      ].some((k) => Object.hasOwn(content, k)) ||
      content.scenes.some(
        (s: unknown) =>
          !record(s) ||
          !Array.isArray(s.blocks) ||
          s.blocks.some((b: unknown) => !record(b) || Object.hasOwn(b, "delivery")),
      )
    )
      return false;
    return operation.request_hash === (await digest({ ...identity, payload }));
  } catch {
    return false;
  }
}
