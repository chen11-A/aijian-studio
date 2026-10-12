/** Full original-operation attribution; its revision never grants a current-head CAS. */
import type { components } from "./generated.js";
import { validateClosedModel } from "./closed-json-schema.js";
import { LOCAL_MEDIA_OPERATION_SCHEMAS } from "./local-media-operations-schema.js";
import { impactUuid } from "./script-confirmation-impact.js";
import { mediaHash, sameMediaInput, mediaScope, type MediaRead } from "./media-preparation.js";

export type AssemblyExactWrite = {
  content: components["schemas"]["EpisodeMediaAssemblyContentV1"];
  parent_version_id: string | null;
  expected_revision: number | null;
  change_summary: string;
};
export type AssemblyExactCommand = { operation_id: string; payload: AssemblyExactWrite };
export type AssemblyExactOperation = {
  operation_id: string;
  payload: AssemblyExactWrite;
  result_revision: number;
  version: components["schemas"]["EpisodeMediaAssemblyVersionData"];
};
export type AssemblyExactRejection = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type AssemblyExactGateway = {
  saveExact(
    projectId: string,
    episodeId: string,
    command: AssemblyExactCommand,
  ): Promise<MediaRead<AssemblyExactOperation> | AssemblyExactRejection>;
  getOriginal(
    projectId: string,
    episodeId: string,
    command: AssemblyExactCommand,
  ): Promise<MediaRead<AssemblyExactOperation>>;
};
export const ASSEMBLY_EXACT_CHANNELS = Object.freeze({
  save: "assembly-exact:save",
  original: "assembly-exact:original",
});
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function assemblyExactCommand(v: unknown, p: string, e: string): v is AssemblyExactCommand {
  if (
    !mediaScope(p, e) ||
    !record(v) ||
    Object.keys(v).length !== 2 ||
    !impactUuid(v.operation_id) ||
    !validateClosedModel(
      v.payload,
      "CreateEpisodeMediaAssemblyVersionRequest",
      LOCAL_MEDIA_OPERATION_SCHEMAS,
      2_000_000 + 4096,
    ) ||
    !record(v.payload)
  )
    return false;
  const write = v.payload as AssemblyExactWrite;
  if (
    Object.keys(write).length !== 4 ||
    write.content.project_id !== p ||
    write.content.episode_id !== e ||
    (write.parent_version_id === null) !== (write.expected_revision === null)
  )
    return false;
  let cursor = 0;
  const ids = new Set<string>();
  for (const segment of write.content.visual_segments) {
    if (
      segment.start_frame !== cursor ||
      segment.end_frame <= segment.start_frame ||
      (segment.media_kind === "image" &&
        (segment.source_in_frame !== 0 || segment.embedded_audio !== "MUTE")) ||
      (Object.hasOwn(segment, "manual_candidate_ref") &&
        (!assemblyManualCandidateRef(segment.manual_candidate_ref) || !segment.storyboard_ref))
    )
      return false;
    cursor = segment.end_frame;
  }
  if (cursor !== write.content.total_frames) return false;
  for (const segment of [
    ...write.content.visual_segments,
    ...write.content.audio_segments,
    ...write.content.subtitle_segments,
  ]) {
    if (
      segment.end_frame <= segment.start_frame ||
      segment.end_frame > write.content.total_frames ||
      ids.has(segment.segment_id)
    )
      return false;
    ids.add(segment.segment_id);
  }
  const rate = write.content.sequence_timebase.frame_rate;
  return (
    ["24000/1001", "24/1", "25/1", "30000/1001"].includes(`${rate.num}/${rate.den}`) &&
    (write.content.sequence_timebase.timecode_mode !== "DROP_FRAME" ||
      (rate.num === 30000 && rate.den === 1001))
  );
}
export async function assemblyExactOperation(
  v: unknown,
  p: string,
  e: string,
  c: AssemblyExactCommand,
): Promise<boolean> {
  if (
    !record(v) ||
    !validateClosedModel(v, "AssemblyExactOperationData", LOCAL_MEDIA_OPERATION_SCHEMAS, 4_500_000)
  )
    return false;
  const op = v as AssemblyExactOperation;
  return (
    op.operation_id === c.operation_id &&
    sameMediaInput(op.payload, c.payload) &&
    sameMediaInput(op.version.content, c.payload.content) &&
    op.version.parent_version_id === c.payload.parent_version_id &&
    op.result_revision === (c.payload.expected_revision ?? 0) + 1 &&
    op.version.head_revision >= op.result_revision &&
    (await mediaHash(op.version.content)) === op.version.content_hash
  );
}
export function assemblyExactRejection(v: unknown): v is AssemblyExactRejection {
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
    ASSEMBLY_ACTOR_FORBIDDEN: 403,
    EPISODE_NOT_FOUND: 404,
    ASSEMBLY_REVISION_CONFLICT: 409,
    ASSEMBLY_INPUT_REJECTED: 422,
    EPISODE_SCOPE_CONFLICT: 422,
    INVALID_ACTOR: 422,
    VALIDATION_ERROR: 422,
    PRECONDITION_REQUIRED: 428,
    MANUAL_CANDIDATE_SOURCE_INVALID: 409,
    RIGHTS_RESTRICTED: 409,
    MEDIA_IDENTITY_CONFLICT: 409,
    MEDIA_MISSING: 409,
    MEDIA_CORRUPT: 409,
    MEDIA_UNKNOWN_MEDIA_READ: 409,
    MEDIA_UNKNOWN_MEDIA_CHANGED: 409,
    SCRIPT_CONFIRMATION_SUPERSEDED: 409,
    G5_AUTHORITY_CHANGED: 409,
    STORYBOARD_REFERENCE_STALE: 409,
  };
  return Object.hasOwn(statuses, v.code) && statuses[v.code] === v.status;
}

export function assemblyManualCandidateRef(v: unknown): boolean {
  return (
    v !== null &&
    validateClosedModel(v, "AssemblyManualCandidateRefV1", LOCAL_MEDIA_OPERATION_SCHEMAS, 4096)
  );
}
