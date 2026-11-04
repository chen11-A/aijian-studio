import type { components } from "./generated.js";
import { LOCAL_MEDIA_OPERATION_SCHEMAS } from "./local-media-operations-schema.ts";
import { validateClosedModel } from "./closed-json-schema.ts";
import { impactCanonical, impactUuid } from "./script-confirmation-impact.ts";

export type ManualMediaCandidateInput = components["schemas"]["ManualMediaCandidateInputV1"];
export type ManualMediaCandidateVersion = components["schemas"]["ManualMediaCandidateVersionData"];
export type ManualMediaCandidatePage = components["schemas"]["ManualMediaCandidatePageData"];
export type ManualMediaCandidateWrite = {
  input: ManualMediaCandidateInput;
  parent_version_id: string | null;
  expected_revision: number | null;
};
export type ManualMediaCandidateCommand = {
  operation_id: string;
  payload: ManualMediaCandidateWrite;
};
export type ManualMediaCandidateOperation = {
  operation_id: string;
  payload: ManualMediaCandidateWrite;
  version: ManualMediaCandidateVersion;
};
export type MediaRead<T> =
  { kind: "FOUND"; receipt: { data: T; request_id: string } } | { kind: "REMOTE_UNKNOWN" };
export type ManualMediaCandidateRejection = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type ManualMediaCandidateGateway = {
  listManualMediaCandidates(
    projectId: string,
    episodeId: string,
    cursor?: string,
  ): Promise<MediaRead<ManualMediaCandidatePage>>;
  getManualMediaCandidate(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<MediaRead<ManualMediaCandidateVersion>>;
  saveManualMediaCandidate(
    projectId: string,
    episodeId: string,
    command: ManualMediaCandidateCommand,
  ): Promise<MediaRead<ManualMediaCandidateOperation> | ManualMediaCandidateRejection>;
  getManualMediaCandidateOperation(
    projectId: string,
    episodeId: string,
    command: ManualMediaCandidateCommand,
  ): Promise<MediaRead<ManualMediaCandidateOperation>>;
};
export const MANUAL_MEDIA_CANDIDATE_CHANNELS = Object.freeze({
  list: "manual-media-candidate:list",
  get: "manual-media-candidate:get",
  save: "manual-media-candidate:save",
  original: "manual-media-candidate:original",
});
export const candidateVersionId = (v: unknown): v is string =>
  typeof v === "string" && /^ver_[0-9a-f]{32}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
import { mediaNonblank, mediaHash, sameMediaInput, mediaScope } from "./media-preparation.ts";
const model = (v: unknown, name: string, max = 256 * 1024) =>
  validateClosedModel(v, name, LOCAL_MEDIA_OPERATION_SCHEMAS, max);
export function candidateInput(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is ManualMediaCandidateInput {
  if (!model(v, "ManualMediaCandidateInputV1") || !record(v)) return false;
  return (
    v.project_id === projectId &&
    v.episode_id === episodeId &&
    typeof v.association_note === "string" &&
    mediaNonblank(v.association_note)
  );
}
export function candidateWrite(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is ManualMediaCandidateWrite {
  if (
    !model(v, "CreateManualMediaCandidateRequest") ||
    !record(v) ||
    !candidateInput(v.input, projectId, episodeId)
  )
    return false;
  return (v.parent_version_id === null) === (v.expected_revision === null);
}
export function candidateCommand(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is ManualMediaCandidateCommand {
  return (
    record(v) &&
    Object.keys(v).length === 2 &&
    impactUuid(v.operation_id) &&
    candidateWrite(v.payload, projectId, episodeId)
  );
}
export function candidateVersion(
  v: unknown,
  projectId: string,
  episodeId: string,
): v is ManualMediaCandidateVersion {
  if (!model(v, "ManualMediaCandidateVersionData", 256 * 1024 + 4096) || !record(v)) return false;
  const version = v as ManualMediaCandidateVersion;
  if (!candidateInput(version.content.input, projectId, episodeId)) return false;
  return (
    version.version_id !== version.parent_version_id &&
    version.content.input.asset_sha256 === version.content.asset_snapshot.sha256 &&
    new TextEncoder().encode(impactCanonical(version.content)).byteLength <= 256 * 1024 &&
    new TextEncoder().encode(impactCanonical(version.content.asset_snapshot.technical_metadata))
      .byteLength <=
      32 * 1024
  );
}

export async function verifiedCandidateVersion(v: unknown, p: string, e: string): Promise<boolean> {
  return candidateVersion(v, p, e) && (await mediaHash(v.content)) === v.content_hash;
}
export async function candidateOperation(
  v: unknown,
  p: string,
  e: string,
  c: ManualMediaCandidateCommand,
): Promise<boolean> {
  if (!model(v, "ManualMediaCandidateOperationData", 512 * 1024) || !record(v)) return false;
  const op = v as ManualMediaCandidateOperation;
  return (
    op.operation_id === c.operation_id &&
    sameMediaInput(op.payload, c.payload) &&
    sameMediaInput(op.version.content.input, c.payload.input) &&
    op.version.parent_version_id === c.payload.parent_version_id &&
    (await verifiedCandidateVersion(op.version, p, e))
  );
}
export async function candidatePage(v: unknown, p: string, e: string): Promise<boolean> {
  if (!model(v, "ManualMediaCandidatePageData", 6 * 1024 * 1024) || !record(v)) return false;
  const page = v as ManualMediaCandidatePage;
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
  return (await Promise.all(page.items.map((i) => verifiedCandidateVersion(i, p, e)))).every(
    Boolean,
  );
}
export function candidateRejection(v: unknown): v is ManualMediaCandidateRejection {
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
    MANUAL_MEDIA_CANDIDATE_ACTOR_FORBIDDEN: 403,
    MANUAL_MEDIA_CANDIDATE_SCOPE_NOT_FOUND: 404,
    MANUAL_MEDIA_CANDIDATE_CONFLICT: 409,
    MANUAL_MEDIA_CANDIDATE_INPUT_REJECTED: 422,
    VALIDATION_ERROR: 422,
    PRECONDITION_REQUIRED: 428,
  };
  return Object.hasOwn(statuses, v.code) && statuses[v.code] === v.status;
}
export function candidateScope(p: unknown, e: unknown): boolean {
  return mediaScope(p, e);
}

export { mediaHash, sameMediaInput, mediaScope, mediaVersionId } from "./media-preparation.ts";
