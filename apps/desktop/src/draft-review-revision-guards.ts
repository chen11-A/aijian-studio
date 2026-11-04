import { createHash } from "node:crypto";
import { hasRequestId, isRecord } from "./api-contract-guards";
import { isDraftExportOperationId, isDraftExportScope } from "./draft-export-contract";
import { isAssemblyVersionId } from "./episode-media-assembly-contract";
import { isDraftReviewNoteId, type DraftReviewTarget } from "./draft-review-contract";
import {
  DRAFT_REVIEW_REVISION_IDENTITY_KEYS,
  exactRevisionKeys as exact,
  isDraftReviewRevisionApprovalId,
  isDraftReviewRevisionCandidateId,
  isDraftReviewRevisionHash as hash,
  isDraftReviewRevisionPlanId,
  isDraftReviewRevisionRecheckId,
  isDraftReviewRevisionSegmentId,
  revisionIdentity,
  revisionIds,
  revisionInteger as integer,
  revisionText as text,
  type DraftReviewRevisionComparison,
  type DraftReviewRevisionPlan,
  type DraftReviewRevisionPlanEntry,
  type DraftReviewRevisionResponse,
  type DraftReviewRevisionScopeResponse,
  type DraftReviewRevisionSegment,
} from "./draft-review-revision-contract";

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function actor(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { actor_id: string; created_at: string } {
  return text(value.actor_id, 200) && timestamp(value.created_at);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Revision evidence must contain JSON values");
  return encoded;
}
export function sameDraftReviewRevisionValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
function boundHash(value: Record<string, unknown>, key: string): boolean {
  const content = Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
  return (
    value[key] === `sha256:${createHash("sha256").update(canonical(content), "utf8").digest("hex")}`
  );
}
function target(
  value: unknown,
  project: string,
  episode: string,
  operation?: string,
): value is DraftReviewTarget {
  return (
    isRecord(value) &&
    exact(value, [
      ...DRAFT_REVIEW_REVISION_IDENTITY_KEYS,
      "project_id",
      "episode_id",
      "operation_id",
      "assembly_version_number",
      "total_frames",
      "frame_rate_num",
      "frame_rate_den",
    ]) &&
    revisionIdentity(value) &&
    isDraftExportScope(value.project_id, value.episode_id) &&
    value.project_id === project &&
    value.episode_id === episode &&
    isDraftExportOperationId(value.operation_id) &&
    (operation === undefined || value.operation_id === operation) &&
    integer(value.assembly_version_number, 1) &&
    integer(value.total_frames, 1, 1_000_000) &&
    integer(value.frame_rate_num, 1) &&
    integer(value.frame_rate_den, 1)
  );
}
function media(value: unknown): boolean {
  return (
    isRecord(value) &&
    exact(value, ["asset_id", "asset_version_id", "sha256"]) &&
    typeof value.asset_id === "string" &&
    /^asset_[0-9a-f]{32}$/.test(value.asset_id) &&
    typeof value.asset_version_id === "string" &&
    /^asv_[0-9a-f]{32}$/.test(value.asset_version_id) &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256)
  );
}
function storyboard(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      exact(value, ["storyboard_version_id", "shot_id"]) &&
      isAssemblyVersionId(value.storyboard_version_id) &&
      typeof value.shot_id === "string" &&
      /^shp_[0-9a-f]{32}$/.test(value.shot_id))
  );
}
function segment(value: unknown, totalFrames: number): value is DraftReviewRevisionSegment {
  if (
    !isRecord(value) ||
    !exact(value, [
      "segment_id",
      "track_kind",
      "start_frame",
      "end_frame",
      "segment_hash",
      "media",
      "storyboard_ref",
    ]) ||
    !isDraftReviewRevisionSegmentId(value.segment_id) ||
    !integer(value.start_frame, 0, totalFrames - 1) ||
    !integer(value.end_frame, 1, totalFrames) ||
    value.end_frame <= value.start_frame ||
    !hash(value.segment_hash) ||
    !storyboard(value.storyboard_ref)
  )
    return false;
  if (value.track_kind === "SUBTITLE") return value.media === null && value.storyboard_ref === null;
  if (
    typeof value.track_kind !== "string" ||
    !["VISUAL", "DIALOGUE", "BGM", "SFX"].includes(value.track_kind) ||
    !media(value.media)
  )
    return false;
  return value.track_kind === "VISUAL" || value.storyboard_ref === null;
}
function segments(
  value: unknown,
  totalFrames: number,
  maximum: number,
  minimum = 0,
): value is DraftReviewRevisionSegment[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((item) => segment(item, totalFrames)) &&
    new Set(value.map((item) => item.segment_id)).size === value.length
  );
}
function plan(value: unknown, source: DraftReviewTarget): value is DraftReviewRevisionPlan {
  if (
    !isRecord(value) ||
    !exact(value, [
      "plan_id",
      "source",
      "notes",
      "affected_segments",
      "instruction",
      "actor_id",
      "created_at",
      "plan_hash",
    ]) ||
    !isDraftReviewRevisionPlanId(value.plan_id) ||
    !target(value.source, source.project_id, source.episode_id, source.operation_id) ||
    !sameDraftReviewRevisionValue(value.source, source) ||
    !Array.isArray(value.notes) ||
    value.notes.length < 1 ||
    value.notes.length > 50 ||
    !segments(value.affected_segments, source.total_frames, 100, 1) ||
    !text(value.instruction) ||
    !actor(value) ||
    !hash(value.plan_hash)
  )
    return false;
  const ids = new Set<string>();
  for (const note of value.notes) {
    if (
      !isRecord(note) ||
      !exact(note, ["note_id", "frame_index", "text", "actor_id", "created_at"]) ||
      !isDraftReviewNoteId(note.note_id) ||
      ids.has(note.note_id) ||
      !integer(note.frame_index, 0, source.total_frames - 1) ||
      !text(note.text) ||
      !actor(note) ||
      Date.parse(note.created_at) > Date.parse(value.created_at)
    )
      return false;
    const frameIndex = note.frame_index;
    if (
      !value.affected_segments.some(
        (item) => item.start_frame <= frameIndex && frameIndex < item.end_frame,
      )
    )
      return false;
    ids.add(note.note_id);
  }
  return boundHash(value, "plan_hash");
}
function comparison(
  value: unknown,
  candidateSegments: DraftReviewRevisionSegment[],
  sourcePlan: DraftReviewRevisionPlan,
): value is DraftReviewRevisionComparison {
  const keys = [
    "unchanged_segment_ids",
    "changed_segment_ids",
    "removed_segment_ids",
    "added_segment_ids",
    "out_of_scope_segment_ids",
  ] as const;
  if (
    !isRecord(value) ||
    !exact(value, [...keys, "sequence_settings_changed"]) ||
    !keys.every((key) => revisionIds(value[key], isDraftReviewRevisionSegmentId, 3000)) ||
    typeof value.sequence_settings_changed !== "boolean"
  )
    return false;
  const unchanged = value.unchanged_segment_ids as string[];
  const changed = value.changed_segment_ids as string[];
  const removed = value.removed_segment_ids as string[];
  const added = value.added_segment_ids as string[];
  const classified = [...unchanged, ...changed, ...removed, ...added];
  if (new Set(classified).size !== classified.length) return false;
  const candidateIds = candidateSegments.map((item) => item.segment_id).sort();
  if (!sameDraftReviewRevisionValue([...unchanged, ...changed, ...added].sort(), candidateIds))
    return false;
  const affected = new Set(sourcePlan.affected_segments.map((item) => item.segment_id));
  const outOfScope = [...changed, ...removed, ...added].filter((id) => !affected.has(id)).sort();
  if (
    !sameDraftReviewRevisionValue(
      [...(value.out_of_scope_segment_ids as string[])].sort(),
      outOfScope,
    )
  )
    return false;
  for (const original of sourcePlan.affected_segments) {
    const current = candidateSegments.find((item) => item.segment_id === original.segment_id);
    const expected =
      current === undefined
        ? removed
        : current.segment_hash === original.segment_hash
          ? unchanged
          : changed;
    if (!expected.includes(original.segment_id)) return false;
  }
  return true;
}
function entry(value: unknown, source: DraftReviewTarget): value is DraftReviewRevisionPlanEntry {
  if (
    !isRecord(value) ||
    !exact(value, ["plan", "approval", "candidates"]) ||
    !plan(value.plan, source) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 50
  )
    return false;
  const sourcePlan = value.plan;
  if (value.approval !== null) {
    const approval = value.approval;
    if (
      !isRecord(approval) ||
      !exact(approval, [
        "approval_id",
        "plan_id",
        "plan_hash",
        "assembly_version_number_at_approval",
        "actor_id",
        "created_at",
      ]) ||
      !isDraftReviewRevisionApprovalId(approval.approval_id) ||
      approval.plan_id !== sourcePlan.plan_id ||
      approval.plan_hash !== sourcePlan.plan_hash ||
      !integer(approval.assembly_version_number_at_approval, source.assembly_version_number) ||
      !actor(approval) ||
      Date.parse(approval.created_at) < Date.parse(sourcePlan.created_at)
    )
      return false;
  }
  if (value.candidates.length > 0 && value.approval === null) return false;
  for (const candidateEntry of value.candidates) {
    if (
      !isRecord(candidateEntry) ||
      !exact(candidateEntry, ["candidate", "output_verified", "recheck"]) ||
      typeof candidateEntry.output_verified !== "boolean" ||
      !isRecord(candidateEntry.candidate)
    )
      return false;
    const candidate = candidateEntry.candidate;
    if (
      !exact(candidate, [
        "candidate_id",
        "plan_id",
        "plan_hash",
        "approval_id",
        "target",
        "segments",
        "comparison",
        "change_summary",
        "actor_id",
        "created_at",
        "candidate_hash",
      ]) ||
      !isDraftReviewRevisionCandidateId(candidate.candidate_id) ||
      candidate.plan_id !== sourcePlan.plan_id ||
      candidate.plan_hash !== sourcePlan.plan_hash ||
      !isRecord(value.approval) ||
      candidate.approval_id !== value.approval.approval_id ||
      !target(candidate.target, source.project_id, source.episode_id) ||
      candidate.target.operation_id === source.operation_id ||
      candidate.target.assembly_version_id === source.assembly_version_id ||
      !integer(
        value.approval.assembly_version_number_at_approval,
        source.assembly_version_number,
      ) ||
      candidate.target.assembly_version_number <=
        value.approval.assembly_version_number_at_approval ||
      !segments(candidate.segments, candidate.target.total_frames, 3000) ||
      !text(candidate.change_summary) ||
      !actor(candidate) ||
      !actor(value.approval) ||
      Date.parse(candidate.created_at) < Date.parse(value.approval.created_at) ||
      !hash(candidate.candidate_hash) ||
      !comparison(candidate.comparison, candidate.segments, sourcePlan) ||
      !boundHash(candidate, "candidate_hash")
    )
      return false;
    if (
      (candidate.target.total_frames !== source.total_frames ||
        candidate.target.frame_rate_num !== source.frame_rate_num ||
        candidate.target.frame_rate_den !== source.frame_rate_den) &&
      candidate.comparison.sequence_settings_changed !== true
    )
      return false;
    const recheck = candidateEntry.recheck;
    if (
      recheck !== null &&
      (!isRecord(recheck) ||
        !exact(recheck, [
          "recheck_id",
          "candidate_id",
          "candidate_hash",
          "outcome",
          "reason",
          "actor_id",
          "created_at",
        ]) ||
        !isDraftReviewRevisionRecheckId(recheck.recheck_id) ||
        recheck.candidate_id !== candidate.candidate_id ||
        recheck.candidate_hash !== candidate.candidate_hash ||
        (recheck.outcome !== "NEEDS_MORE_WORK" && recheck.outcome !== "MANUALLY_CHECKED") ||
        !text(recheck.reason) ||
        !actor(recheck) ||
        Date.parse(recheck.created_at) < Date.parse(candidate.created_at))
    )
      return false;
  }
  return true;
}
function envelope(
  value: unknown,
  requestId: string | null,
): value is Record<string, unknown> & { data: Record<string, unknown> } {
  return (
    isRecord(value) &&
    exact(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    value.request_id === requestId &&
    isRecord(value.data)
  );
}
export function isDraftReviewRevisionScopeResponse(
  value: unknown,
  project: string,
  episode: string,
  operation: string,
  requestId: string | null,
): value is DraftReviewRevisionScopeResponse {
  return (
    envelope(value, requestId) &&
    exact(value.data, ["source", "output_verified", "segments", "manual_review_only"]) &&
    target(value.data.source, project, episode, operation) &&
    typeof value.data.output_verified === "boolean" &&
    segments(value.data.segments, value.data.source.total_frames, 3000) &&
    value.data.manual_review_only === true
  );
}
export function isDraftReviewRevisionResponse(
  value: unknown,
  project: string,
  episode: string,
  operation: string,
  requestId: string | null,
): value is DraftReviewRevisionResponse {
  if (
    !envelope(value, requestId) ||
    !exact(value.data, ["source", "output_verified", "plans", "manual_review_only"]) ||
    !target(value.data.source, project, episode, operation) ||
    typeof value.data.output_verified !== "boolean" ||
    value.data.manual_review_only !== true ||
    !Array.isArray(value.data.plans) ||
    value.data.plans.length > 100
  )
    return false;
  const ids = new Set<string>();
  let candidateCount = 0;
  for (const item of value.data.plans) {
    if (!isRecord(item) || !Array.isArray(item.candidates)) return false;
    candidateCount += item.candidates.length;
    if (candidateCount > 20) return false;
    if (!entry(item, value.data.source)) return false;
    const immutableIds = [
      item.plan.plan_id,
      ...(item.approval ? [item.approval.approval_id] : []),
      ...item.candidates.flatMap((candidate) => [
        candidate.candidate.candidate_id,
        ...(candidate.recheck ? [candidate.recheck.recheck_id] : []),
      ]),
    ];
    for (const id of immutableIds) {
      if (ids.has(id)) return false;
      ids.add(id);
    }
  }
  return true;
}
