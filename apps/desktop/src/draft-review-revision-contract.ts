import type { components } from "@aijian/contracts";
import { isRecord } from "./api-contract-guards";
import { isDraftExportOperationId, type DraftExportFailure } from "./draft-export-contract";
import { isAssemblyVersionId } from "./episode-media-assembly-contract";
import { isDraftReviewNoteId, type DraftReviewTarget } from "./draft-review-contract";

export type CreateDraftReviewRevisionPlanRequest =
  components["schemas"]["CreateDraftReviewRevisionPlanRequest"];
export type ApproveDraftReviewRevisionPlanRequest =
  components["schemas"]["ApproveDraftReviewRevisionPlanRequest"];
export type AttachDraftReviewRevisionCandidateRequest =
  components["schemas"]["AttachDraftReviewRevisionCandidateRequest"];
export type RecheckDraftReviewRevisionCandidateRequest =
  components["schemas"]["RecheckDraftReviewRevisionCandidateRequest"];
export type DraftReviewRevisionSegment = components["schemas"]["DraftReviewRevisionSegment"];
export type DraftReviewRevisionPlan = components["schemas"]["DraftReviewRevisionPlan"];
export type DraftReviewRevisionApproval = components["schemas"]["DraftReviewRevisionApproval"];
export type DraftReviewRevisionCandidate = components["schemas"]["DraftReviewRevisionCandidate"];
export type DraftReviewRevisionComparison = components["schemas"]["DraftReviewRevisionComparison"];
export type DraftReviewRevisionRecheck = components["schemas"]["DraftReviewRevisionRecheck"];
export type DraftReviewRevisionCandidateEntry =
  components["schemas"]["DraftReviewRevisionCandidateEntry"];
export type DraftReviewRevisionPlanEntry = components["schemas"]["DraftReviewRevisionPlanEntry"];
export type DraftReviewRevisionData = components["schemas"]["DraftReviewRevisionData"];
export type DraftReviewRevisionResponse = components["schemas"]["DraftReviewRevisionResponse"];
export type DraftReviewRevisionScopeResponse =
  components["schemas"]["DraftReviewRevisionScopeResponse"];
export type DraftReviewRevisionResult =
  { kind: "FOUND"; receipt: DraftReviewRevisionResponse } | DraftExportFailure;
export type DraftReviewRevisionScopeResult =
  { kind: "FOUND"; receipt: DraftReviewRevisionScopeResponse } | DraftExportFailure;
export type DraftReviewRevisionGateway = {
  listDraftReviewRevisionPlans(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftReviewRevisionResult>;
  getDraftReviewRevisionScope(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftReviewRevisionScopeResult>;
  createDraftReviewRevisionPlan(
    projectId: string,
    episodeId: string,
    operationId: string,
    command: CreateDraftReviewRevisionPlanRequest,
  ): Promise<DraftReviewRevisionResult>;
  approveDraftReviewRevisionPlan(
    projectId: string,
    episodeId: string,
    operationId: string,
    planId: string,
    command: ApproveDraftReviewRevisionPlanRequest,
  ): Promise<DraftReviewRevisionResult>;
  attachDraftReviewRevisionCandidate(
    projectId: string,
    episodeId: string,
    operationId: string,
    planId: string,
    command: AttachDraftReviewRevisionCandidateRequest,
  ): Promise<DraftReviewRevisionResult>;
  recheckDraftReviewRevisionCandidate(
    projectId: string,
    episodeId: string,
    operationId: string,
    planId: string,
    candidateId: string,
    command: RecheckDraftReviewRevisionCandidateRequest,
  ): Promise<DraftReviewRevisionResult>;
};

export const DRAFT_REVIEW_REVISION_CHANNELS = Object.freeze({
  list: "draft-review-revision:list",
  scope: "draft-review-revision:scope",
  create: "draft-review-revision:create-plan",
  approve: "draft-review-revision:approve-plan",
  attach: "draft-review-revision:attach-candidate",
  recheck: "draft-review-revision:recheck-candidate",
} as const);

export const DRAFT_REVIEW_REVISION_IDENTITY_KEYS = [
  "assembly_version_id",
  "assembly_content_hash",
  "output_sha256",
  "output_bytes",
] as const;
export function exactRevisionKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
export function revisionInteger(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function revisionText(value: unknown, maximum = 2000): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= maximum &&
    !value.includes("\0") &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
export function isDraftReviewRevisionHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
export function isDraftReviewRevisionPlanId(value: unknown): value is string {
  return typeof value === "string" && /^drp_[0-9a-f]{32}$/.test(value);
}
export function isDraftReviewRevisionApprovalId(value: unknown): value is string {
  return typeof value === "string" && /^dra_[0-9a-f]{32}$/.test(value);
}
export function isDraftReviewRevisionCandidateId(value: unknown): value is string {
  return typeof value === "string" && /^drc_[0-9a-f]{32}$/.test(value);
}
export function isDraftReviewRevisionRecheckId(value: unknown): value is string {
  return typeof value === "string" && /^drk_[0-9a-f]{32}$/.test(value);
}
export function isDraftReviewRevisionSegmentId(value: unknown): value is string {
  return typeof value === "string" && /^seg_[a-z0-9._-]{1,80}$/.test(value);
}
export function revisionIds(
  value: unknown,
  guard: (value: unknown) => value is string,
  max: number,
  min = 0,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every(guard) &&
    new Set(value).size === value.length
  );
}
export function revisionIdentity(value: Record<string, unknown>): boolean {
  return (
    isAssemblyVersionId(value.assembly_version_id) &&
    isDraftReviewRevisionHash(value.assembly_content_hash) &&
    typeof value.output_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.output_sha256) &&
    revisionInteger(value.output_bytes, 1)
  );
}
export function matchesDraftReviewRevisionIdentity(
  target: DraftReviewTarget,
  command: CreateDraftReviewRevisionPlanRequest | AttachDraftReviewRevisionCandidateRequest,
): boolean {
  return DRAFT_REVIEW_REVISION_IDENTITY_KEYS.every((key) => target[key] === command[key]);
}
export function isCreateDraftReviewRevisionPlanRequest(
  value: unknown,
): value is CreateDraftReviewRevisionPlanRequest {
  return (
    isRecord(value) &&
    exactRevisionKeys(value, [
      ...DRAFT_REVIEW_REVISION_IDENTITY_KEYS,
      "plan_id",
      "note_ids",
      "affected_segment_ids",
      "instruction",
    ]) &&
    revisionIdentity(value) &&
    isDraftReviewRevisionPlanId(value.plan_id) &&
    revisionIds(value.note_ids, isDraftReviewNoteId, 50, 1) &&
    revisionIds(value.affected_segment_ids, isDraftReviewRevisionSegmentId, 100, 1) &&
    revisionText(value.instruction)
  );
}
export function isApproveDraftReviewRevisionPlanRequest(
  value: unknown,
): value is ApproveDraftReviewRevisionPlanRequest {
  return (
    isRecord(value) &&
    exactRevisionKeys(value, ["approval_id", "expected_plan_hash"]) &&
    isDraftReviewRevisionApprovalId(value.approval_id) &&
    isDraftReviewRevisionHash(value.expected_plan_hash)
  );
}
export function isAttachDraftReviewRevisionCandidateRequest(
  value: unknown,
): value is AttachDraftReviewRevisionCandidateRequest {
  return (
    isRecord(value) &&
    exactRevisionKeys(value, [
      ...DRAFT_REVIEW_REVISION_IDENTITY_KEYS,
      "candidate_id",
      "expected_plan_hash",
      "approval_id",
      "candidate_operation_id",
      "change_summary",
    ]) &&
    revisionIdentity(value) &&
    isDraftReviewRevisionCandidateId(value.candidate_id) &&
    isDraftReviewRevisionHash(value.expected_plan_hash) &&
    isDraftReviewRevisionApprovalId(value.approval_id) &&
    isDraftExportOperationId(value.candidate_operation_id) &&
    revisionText(value.change_summary)
  );
}
export function isRecheckDraftReviewRevisionCandidateRequest(
  value: unknown,
): value is RecheckDraftReviewRevisionCandidateRequest {
  return (
    isRecord(value) &&
    exactRevisionKeys(value, ["recheck_id", "expected_candidate_hash", "outcome", "reason"]) &&
    isDraftReviewRevisionRecheckId(value.recheck_id) &&
    isDraftReviewRevisionHash(value.expected_candidate_hash) &&
    (value.outcome === "NEEDS_MORE_WORK" || value.outcome === "MANUALLY_CHECKED") &&
    revisionText(value.reason)
  );
}

export {
  isDraftReviewRevisionResponse,
  isDraftReviewRevisionScopeResponse,
} from "./draft-review-revision-guards";
