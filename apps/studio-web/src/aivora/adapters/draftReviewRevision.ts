import type { components } from "@aijian/contracts";
import type { DraftExportFailure, DraftExportGateway, DraftExportJob } from "./draftExport";
import type { DraftReviewTarget } from "./draftReview";

export type DraftReviewRevisionSource = DraftReviewTarget | DraftExportJob;
export type DraftReviewRevisionData = components["schemas"]["DraftReviewRevisionData"];
export type DraftReviewRevisionScopeData = components["schemas"]["DraftReviewRevisionScopeData"];
export type DraftReviewRevisionPlanEntry = components["schemas"]["DraftReviewRevisionPlanEntry"];
export type DraftReviewRevisionCandidateEntry =
  components["schemas"]["DraftReviewRevisionCandidateEntry"];
export type DraftReviewRevisionSegment = components["schemas"]["DraftReviewRevisionSegment"];
export type CreateDraftReviewRevisionPlanRequest =
  components["schemas"]["CreateDraftReviewRevisionPlanRequest"];
export type ApproveDraftReviewRevisionPlanRequest =
  components["schemas"]["ApproveDraftReviewRevisionPlanRequest"];
export type AttachDraftReviewRevisionCandidateRequest =
  components["schemas"]["AttachDraftReviewRevisionCandidateRequest"];
export type RecheckDraftReviewRevisionCandidateRequest =
  components["schemas"]["RecheckDraftReviewRevisionCandidateRequest"];
export type DraftReviewRevisionResult =
  | { kind: "FOUND"; receipt: components["schemas"]["DraftReviewRevisionResponse"] }
  | DraftExportFailure;
export type DraftReviewRevisionScopeResult =
  | { kind: "FOUND"; receipt: components["schemas"]["DraftReviewRevisionScopeResponse"] }
  | DraftExportFailure;
export type DraftReviewRevisionExportGateway = Pick<
  DraftExportGateway,
  "list" | "get" | "preview" | "reveal"
>;
export interface DraftReviewRevisionGateway {
  listDraftReviewRevisionPlans(
    project: string,
    episode: string,
    operation: string,
  ): Promise<DraftReviewRevisionResult>;
  getDraftReviewRevisionScope(
    project: string,
    episode: string,
    operation: string,
  ): Promise<DraftReviewRevisionScopeResult>;
  createDraftReviewRevisionPlan(
    project: string,
    episode: string,
    operation: string,
    command: CreateDraftReviewRevisionPlanRequest,
  ): Promise<DraftReviewRevisionResult>;
  approveDraftReviewRevisionPlan(
    project: string,
    episode: string,
    operation: string,
    planId: string,
    command: ApproveDraftReviewRevisionPlanRequest,
  ): Promise<DraftReviewRevisionResult>;
  attachDraftReviewRevisionCandidate(
    project: string,
    episode: string,
    operation: string,
    planId: string,
    command: AttachDraftReviewRevisionCandidateRequest,
  ): Promise<DraftReviewRevisionResult>;
  recheckDraftReviewRevisionCandidate(
    project: string,
    episode: string,
    operation: string,
    planId: string,
    candidateId: string,
    command: RecheckDraftReviewRevisionCandidateRequest,
  ): Promise<DraftReviewRevisionResult>;
}
export type PendingRevision =
  | { kind: "create"; command: CreateDraftReviewRevisionPlanRequest }
  | { kind: "approve"; planId: string; command: ApproveDraftReviewRevisionPlanRequest }
  | { kind: "attach"; planId: string; command: AttachDraftReviewRevisionCandidateRequest }
  | {
      kind: "recheck";
      planId: string;
      candidateId: string;
      command: RecheckDraftReviewRevisionCandidateRequest;
    };

export function revisionIdentity(
  target: DraftReviewTarget,
): Pick<
  DraftReviewTarget,
  "assembly_version_id" | "assembly_content_hash" | "output_sha256" | "output_bytes"
>;
export function revisionIdentity(
  target: DraftExportJob,
): Pick<
  DraftExportJob,
  "assembly_version_id" | "assembly_content_hash" | "output_sha256" | "output_bytes"
>;
export function revisionIdentity(target: DraftReviewTarget | DraftExportJob) {
  return {
    assembly_version_id: target.assembly_version_id,
    assembly_content_hash: target.assembly_content_hash,
    output_sha256: target.output_sha256,
    output_bytes: target.output_bytes,
  };
}
export function revisionSourceMatches(
  source: DraftReviewTarget,
  job: DraftReviewRevisionSource,
): boolean {
  return (
    !!source &&
    source.project_id === job.project_id &&
    source.episode_id === job.episode_id &&
    source.operation_id === job.operation_id &&
    source.assembly_version_id === job.assembly_version_id &&
    source.assembly_content_hash === job.assembly_content_hash &&
    source.total_frames === job.total_frames &&
    source.output_sha256 === job.output_sha256 &&
    source.output_bytes === job.output_bytes
  );
}
function sameSource(a: DraftReviewTarget, b: DraftReviewTarget): boolean {
  return (
    !!a &&
    !!b &&
    Object.keys(b).every(
      (key) => a[key as keyof DraftReviewTarget] === b[key as keyof DraftReviewTarget],
    )
  );
}
/** Desktop guards validate fields; the renderer also pins every nested event to its source. */
export function revisionMatches(
  data: DraftReviewRevisionData,
  job: DraftReviewRevisionSource,
): boolean {
  if (
    !data ||
    data.manual_review_only !== true ||
    typeof data.output_verified !== "boolean" ||
    !revisionSourceMatches(data.source, job) ||
    !Array.isArray(data.plans)
  )
    return false;
  const planIds = new Set<string>();
  const candidateIds = new Set<string>();
  return data.plans.every((entry) => {
    if (
      !entry?.plan ||
      !sameSource(entry.plan.source, data.source) ||
      planIds.has(entry.plan.plan_id) ||
      !Array.isArray(entry.candidates)
    )
      return false;
    planIds.add(entry.plan.plan_id);
    const approval = entry.approval;
    if (
      approval &&
      (approval.plan_id !== entry.plan.plan_id || approval.plan_hash !== entry.plan.plan_hash)
    )
      return false;
    return entry.candidates.every((item) => {
      const candidate = item?.candidate;
      if (
        !candidate ||
        !approval ||
        candidateIds.has(candidate.candidate_id) ||
        candidate.plan_id !== entry.plan.plan_id ||
        candidate.plan_hash !== entry.plan.plan_hash ||
        candidate.approval_id !== approval.approval_id ||
        candidate.target?.project_id !== job.project_id ||
        candidate.target?.episode_id !== job.episode_id ||
        candidate.target.operation_id === job.operation_id ||
        candidate.target.assembly_version_id === job.assembly_version_id
      )
        return false;
      candidateIds.add(candidate.candidate_id);
      return (
        !item.recheck ||
        (item.recheck.candidate_id === candidate.candidate_id &&
          item.recheck.candidate_hash === candidate.candidate_hash)
      );
    });
  });
}
export function sameRevisionValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameRevisionValue(value, b[index]))
    );
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameRevisionValue(left[key], right[key]))
  );
}
/** Events append; verified availability can change, immutable evidence cannot disappear. */
export function revisionPreservesHistory(
  before: DraftReviewRevisionData,
  after: DraftReviewRevisionData,
): boolean {
  if (!sameRevisionValue(before.source, after.source)) return false;
  return before.plans.every((oldEntry) => {
    const next = after.plans.find((entry) => entry.plan.plan_id === oldEntry.plan.plan_id);
    if (
      !next ||
      !sameRevisionValue(oldEntry.plan, next.plan) ||
      (oldEntry.approval !== null && !sameRevisionValue(oldEntry.approval, next.approval))
    )
      return false;
    return oldEntry.candidates.every((oldCandidate) => {
      const item = next.candidates.find(
        (candidate) => candidate.candidate.candidate_id === oldCandidate.candidate.candidate_id,
      );
      return (
        !!item &&
        sameRevisionValue(oldCandidate.candidate, item.candidate) &&
        (oldCandidate.recheck === null || sameRevisionValue(oldCandidate.recheck, item.recheck))
      );
    });
  });
}
export function revisionScopeMatches(
  data: DraftReviewRevisionScopeData,
  job: DraftReviewRevisionSource,
): boolean {
  return (
    !!data &&
    data.manual_review_only === true &&
    typeof data.output_verified === "boolean" &&
    revisionSourceMatches(data.source, job) &&
    Array.isArray(data.segments) &&
    new Set(data.segments.map((segment) => segment.segment_id)).size === data.segments.length &&
    data.segments.every(
      (segment) =>
        Number.isSafeInteger(segment.start_frame) &&
        Number.isSafeInteger(segment.end_frame) &&
        segment.start_frame >= 0 &&
        segment.end_frame > segment.start_frame &&
        segment.end_frame <= data.source.total_frames,
    )
  );
}
export function sameRevisionSelectionOrder(a: string[], b: string[]): boolean {
  return (
    a.length === b.length && new Set(a).size === a.length && a.every((id, index) => id === b[index])
  );
}
function sameIdentity(
  target: DraftReviewTarget,
  command: CreateDraftReviewRevisionPlanRequest | AttachDraftReviewRevisionCandidateRequest,
): boolean {
  return Object.entries(revisionIdentity(target)).every(
    ([key, value]) => command[key as keyof typeof command] === value,
  );
}
/** A successful transport is insufficient: the exact immutable event must be read back. */
export function pendingRevisionMatches(
  data: DraftReviewRevisionData,
  pending: PendingRevision,
): boolean {
  if (pending.kind === "create") {
    const plan = data.plans.find((entry) => entry.plan.plan_id === pending.command.plan_id)?.plan;
    return (
      !!plan &&
      sameIdentity(plan.source, pending.command) &&
      plan.instruction === pending.command.instruction &&
      sameRevisionSelectionOrder(
        plan.notes.map((note) => note.note_id),
        pending.command.note_ids,
      ) &&
      sameRevisionSelectionOrder(
        plan.affected_segments.map((segment) => segment.segment_id),
        pending.command.affected_segment_ids,
      )
    );
  }
  const entry = data.plans.find((item) => item.plan.plan_id === pending.planId);
  if (!entry) return false;
  if (pending.kind === "approve")
    return (
      entry.plan.plan_hash === pending.command.expected_plan_hash &&
      entry.approval?.approval_id === pending.command.approval_id &&
      entry.approval.plan_hash === pending.command.expected_plan_hash
    );
  if (pending.kind === "attach") {
    const candidate = entry.candidates.find(
      (item) => item.candidate.candidate_id === pending.command.candidate_id,
    )?.candidate;
    return (
      !!candidate &&
      entry.plan.plan_hash === pending.command.expected_plan_hash &&
      candidate.plan_hash === pending.command.expected_plan_hash &&
      candidate.approval_id === pending.command.approval_id &&
      candidate.target.operation_id === pending.command.candidate_operation_id &&
      sameIdentity(candidate.target, pending.command) &&
      candidate.change_summary === pending.command.change_summary
    );
  }
  const item = entry.candidates.find((item) => item.candidate.candidate_id === pending.candidateId);
  return (
    !!item &&
    item.candidate.candidate_hash === pending.command.expected_candidate_hash &&
    item.recheck?.recheck_id === pending.command.recheck_id &&
    item.recheck.candidate_hash === pending.command.expected_candidate_hash &&
    item.recheck.outcome === pending.command.outcome &&
    item.recheck.reason === pending.command.reason
  );
}
export function eligibleRevisionCandidate(
  job: DraftExportJob,
  source: DraftReviewTarget,
  entry: DraftReviewRevisionPlanEntry,
): boolean {
  const approval = entry.approval;
  return (
    !!approval &&
    job.status === "SUCCEEDED" &&
    job.project_id === source.project_id &&
    job.episode_id === source.episode_id &&
    job.operation_id !== source.operation_id &&
    job.assembly_version_id !== source.assembly_version_id &&
    typeof job.output_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(job.output_sha256) &&
    typeof job.output_bytes === "number" &&
    Number.isSafeInteger(job.output_bytes) &&
    job.output_bytes > 0 &&
    Number.isFinite(Date.parse(job.created_at)) &&
    Number.isFinite(Date.parse(approval.created_at)) &&
    Date.parse(job.created_at) > Date.parse(approval.created_at) &&
    !entry.candidates.some((item) => item.candidate.target.operation_id === job.operation_id)
  );
}
export function revisionText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= 2000 &&
    !value.includes("\0") &&
    new TextDecoder().decode(new TextEncoder().encode(value)) === value
  );
}
export function revisionFailure(
  result?: DraftReviewRevisionResult | DraftReviewRevisionScopeResult,
): string {
  return result?.kind === "DEFINITE_SERVER_ERROR"
    ? `手工修改请求返回 ${result.code}。尚不能确认原提交未保存，输入与恢复标识仍保留，请只读核对。`
    : "手工修改提交尚未可靠读回。新提交已暂停，请核对原提交，不会自动重发。";
}
