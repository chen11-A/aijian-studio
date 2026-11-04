import { isDraftExportOperationId, isDraftExportScope } from "./draft-export-contract";
import type { DraftExportFailure } from "./draft-export-contract";
import { episodeMediaAssemblyDefiniteError } from "./episode-media-assembly-contract";
import {
  isApproveDraftReviewRevisionPlanRequest,
  isAttachDraftReviewRevisionCandidateRequest,
  isCreateDraftReviewRevisionPlanRequest,
  isDraftReviewRevisionCandidateId,
  isDraftReviewRevisionPlanId,
  isDraftReviewRevisionResponse,
  isDraftReviewRevisionScopeResponse,
  isRecheckDraftReviewRevisionCandidateRequest,
  matchesDraftReviewRevisionIdentity,
  type ApproveDraftReviewRevisionPlanRequest,
  type AttachDraftReviewRevisionCandidateRequest,
  type CreateDraftReviewRevisionPlanRequest,
  type DraftReviewRevisionData,
  type DraftReviewRevisionGateway,
  type DraftReviewRevisionResponse,
  type DraftReviewRevisionResult,
  type RecheckDraftReviewRevisionCandidateRequest,
} from "./draft-review-revision-contract";
import { sameDraftReviewRevisionValue as same } from "./draft-review-revision-guards";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;
type Command =
  | CreateDraftReviewRevisionPlanRequest
  | ApproveDraftReviewRevisionPlanRequest
  | AttachDraftReviewRevisionCandidateRequest
  | RecheckDraftReviewRevisionCandidateRequest;
const PRECOMMIT_REJECTION_CODES = new Set([
  "SIDECAR_AUTH_REQUIRED",
  "SIDECAR_REQUEST_REJECTED",
  "VALIDATION_ERROR",
  "DRAFT_REVIEW_NOT_FOUND",
  "DRAFT_REVIEW_TARGET_MISMATCH",
  "DRAFT_REVISION_NO_VERIFIED_OUTPUT",
  "DRAFT_REVISION_ID_REUSED",
  "DRAFT_REVISION_OUTPUT_UNAVAILABLE",
  "DRAFT_REVISION_SELECTION_NOT_FOUND",
  "DRAFT_REVISION_NOTE_OUTSIDE_SEGMENTS",
  "DRAFT_REVISION_PLAN_LIMIT",
  "DRAFT_REVISION_HISTORY_LIMIT",
  "DRAFT_REVISION_PLAN_NOT_FOUND",
  "DRAFT_REVISION_PLAN_HASH_MISMATCH",
  "DRAFT_REVISION_ALREADY_APPROVED",
  "DRAFT_REVISION_EXPLICIT_APPROVAL_REQUIRED",
  "DRAFT_REVISION_CANDIDATE_LIMIT",
  "DRAFT_REVISION_CANDIDATE_ALREADY_ATTACHED",
  "DRAFT_REVISION_CANDIDATE_NOT_LATER",
  "DRAFT_REVISION_CANDIDATE_NOT_FOUND",
  "DRAFT_REVISION_CANDIDATE_HASH_MISMATCH",
  "DRAFT_REVISION_ALREADY_RECHECKED",
]);

function preservesHistory(
  before: DraftReviewRevisionData,
  after: DraftReviewRevisionData,
): boolean {
  if (!same(before.source, after.source)) return false;
  return before.plans.every((oldEntry) => {
    const newEntry = after.plans.find((item) => item.plan.plan_id === oldEntry.plan.plan_id);
    if (
      !newEntry ||
      !same(oldEntry.plan, newEntry.plan) ||
      (oldEntry.approval !== null && !same(oldEntry.approval, newEntry.approval))
    )
      return false;
    return oldEntry.candidates.every((oldCandidate) => {
      const newCandidate = newEntry.candidates.find(
        (item) => item.candidate.candidate_id === oldCandidate.candidate.candidate_id,
      );
      return (
        newCandidate !== undefined &&
        same(oldCandidate.candidate, newCandidate.candidate) &&
        (oldCandidate.recheck === null || same(oldCandidate.recheck, newCandidate.recheck))
      );
    });
  });
}
function hasPlan(
  data: DraftReviewRevisionData,
  input: CreateDraftReviewRevisionPlanRequest,
): boolean {
  const item = data.plans.find((entry) => entry.plan.plan_id === input.plan_id);
  return (
    item !== undefined &&
    matchesDraftReviewRevisionIdentity(item.plan.source, input) &&
    item.plan.instruction === input.instruction &&
    same(
      item.plan.notes.map((note) => note.note_id),
      input.note_ids,
    ) &&
    same(
      item.plan.affected_segments.map((segment) => segment.segment_id),
      input.affected_segment_ids,
    )
  );
}
function hasApproval(
  data: DraftReviewRevisionData,
  planId: string,
  input: ApproveDraftReviewRevisionPlanRequest,
): boolean {
  const item = data.plans.find((entry) => entry.plan.plan_id === planId);
  return (
    item !== undefined &&
    item.plan.plan_hash === input.expected_plan_hash &&
    item.approval?.approval_id === input.approval_id &&
    item.approval.plan_hash === input.expected_plan_hash
  );
}
function hasCandidate(
  data: DraftReviewRevisionData,
  planId: string,
  input: AttachDraftReviewRevisionCandidateRequest,
): boolean {
  const item = data.plans.find((entry) => entry.plan.plan_id === planId);
  const candidate = item?.candidates.find(
    (entry) => entry.candidate.candidate_id === input.candidate_id,
  )?.candidate;
  return (
    item !== undefined &&
    item.plan.plan_hash === input.expected_plan_hash &&
    item.approval?.approval_id === input.approval_id &&
    candidate !== undefined &&
    candidate.approval_id === input.approval_id &&
    candidate.plan_hash === input.expected_plan_hash &&
    candidate.target.operation_id === input.candidate_operation_id &&
    matchesDraftReviewRevisionIdentity(candidate.target, input) &&
    candidate.change_summary === input.change_summary
  );
}
function hasRecheck(
  data: DraftReviewRevisionData,
  planId: string,
  candidateId: string,
  input: RecheckDraftReviewRevisionCandidateRequest,
): boolean {
  const item = data.plans
    .find((entry) => entry.plan.plan_id === planId)
    ?.candidates.find((entry) => entry.candidate.candidate_id === candidateId);
  return (
    item !== undefined &&
    item.candidate.candidate_hash === input.expected_candidate_hash &&
    item.recheck?.recheck_id === input.recheck_id &&
    item.recheck.candidate_hash === input.expected_candidate_hash &&
    item.recheck.outcome === input.outcome &&
    item.recheck.reason === input.reason
  );
}
function hasCommandEvent(data: DraftReviewRevisionData, command: Command): boolean {
  if ("plan_id" in command) return data.plans.some((item) => item.plan.plan_id === command.plan_id);
  if ("candidate_id" in command)
    return data.plans.some((item) =>
      item.candidates.some((entry) => entry.candidate.candidate_id === command.candidate_id),
    );
  if ("approval_id" in command)
    return data.plans.some((item) => item.approval?.approval_id === command.approval_id);
  return data.plans.some((item) =>
    item.candidates.some((entry) => entry.recheck?.recheck_id === command.recheck_id),
  );
}

export function createDraftReviewRevisionClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): DraftReviewRevisionGateway {
  const pathFor = (project: string, episode: string, operation: string) => {
    if (!isDraftExportScope(project, episode) || !isDraftExportOperationId(operation))
      throw new Error("Draft review revision requires canonical scope and operation ids");
    return `/api/v1/projects/${project}/episodes/${episode}/draft-exports/${operation}/revision-plans`;
  };
  const request: ReadHttp = async (path, init) => {
    try {
      return await readHttp(path, init);
    } catch {
      return null;
    }
  };
  const list: DraftReviewRevisionGateway["listDraftReviewRevisionPlans"] = async (
    project,
    episode,
    operation,
  ) => {
    const result = await request(pathFor(project, episode, operation), { headers });
    if (result === null) return { kind: "REMOTE_UNKNOWN" };
    if (result.status === 200)
      return isDraftReviewRevisionResponse(
        result.payload,
        project,
        episode,
        operation,
        result.requestId,
      )
        ? { kind: "FOUND", receipt: result.payload }
        : { kind: "REMOTE_UNKNOWN" };
    return (
      episodeMediaAssemblyDefiniteError(result.status, result.payload, result.requestId) ?? {
        kind: "REMOTE_UNKNOWN",
      }
    );
  };
  async function write(
    project: string,
    episode: string,
    operation: string,
    suffix: string,
    command: Command,
    original: DraftReviewRevisionResponse,
    matches: (data: DraftReviewRevisionData) => boolean,
  ): Promise<DraftReviewRevisionResult> {
    const result = await request(`${pathFor(project, episode, operation)}${suffix}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    let postReceipt: DraftReviewRevisionResponse | undefined;
    let postError: Extract<DraftExportFailure, { kind: "DEFINITE_SERVER_ERROR" }> | undefined;
    if (result !== null) {
      if (![200, 201].includes(result.status)) {
        const error = episodeMediaAssemblyDefiniteError(
          result.status,
          result.payload,
          result.requestId,
        );
        if (error !== null) postError = error;
      } else if (
        isDraftReviewRevisionResponse(result.payload, project, episode, operation, result.requestId)
      ) {
        postReceipt = result.payload;
      }
    }
    // One exact readback is required even after a success receipt. A lost write never
    // triggers automatic replay or replacement IDs; callers retain their explicit IDs.
    const readback = await list(project, episode, operation);
    if (readback.kind !== "FOUND" || !preservesHistory(original.data, readback.receipt.data))
      return { kind: "REMOTE_UNKNOWN" };
    if (!matches(readback.receipt.data)) {
      // Server writes commit before their response read. Even a validated 4xx may be
      // a post-commit integrity/read failure. Only valid, immutable history proving
      // this exact event ID absent permits a definite rejection to clear a pending ID.
      return postError &&
        PRECOMMIT_REJECTION_CODES.has(postError.code) &&
        !hasCommandEvent(readback.receipt.data, command)
        ? postError
        : { kind: "REMOTE_UNKNOWN" };
    }
    if (
      postReceipt &&
      (!preservesHistory(original.data, postReceipt.data) ||
        !matches(postReceipt.data) ||
        !preservesHistory(postReceipt.data, readback.receipt.data))
    )
      return { kind: "REMOTE_UNKNOWN" };
    return readback;
  }
  function planId(value: string): void {
    if (!isDraftReviewRevisionPlanId(value))
      throw new Error("Draft review revision requires a canonical plan id");
  }
  return {
    listDraftReviewRevisionPlans: list,
    async getDraftReviewRevisionScope(project, episode, operation) {
      const result = await request(`${pathFor(project, episode, operation)}/scope`, { headers });
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      if (result.status === 200)
        return isDraftReviewRevisionScopeResponse(
          result.payload,
          project,
          episode,
          operation,
          result.requestId,
        )
          ? { kind: "FOUND", receipt: result.payload }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        episodeMediaAssemblyDefiniteError(result.status, result.payload, result.requestId) ?? {
          kind: "REMOTE_UNKNOWN",
        }
      );
    },
    async createDraftReviewRevisionPlan(project, episode, operation, input) {
      pathFor(project, episode, operation);
      if (!isCreateDraftReviewRevisionPlanRequest(input))
        throw new Error("Draft review revision requires an exact manual plan");
      const command = {
        ...input,
        note_ids: [...input.note_ids],
        affected_segment_ids: [...input.affected_segment_ids],
      };
      const original = await list(project, episode, operation);
      if (original.kind !== "FOUND") return { kind: "REMOTE_UNKNOWN" };
      if (!matchesDraftReviewRevisionIdentity(original.receipt.data.source, command))
        return { kind: "REMOTE_UNKNOWN" };
      return write(project, episode, operation, "", command, original.receipt, (data) =>
        hasPlan(data, command),
      );
    },
    async approveDraftReviewRevisionPlan(project, episode, operation, id, input) {
      pathFor(project, episode, operation);
      planId(id);
      if (!isApproveDraftReviewRevisionPlanRequest(input))
        throw new Error("Draft review revision requires an exact manual plan approval");
      const command = { ...input };
      const original = await list(project, episode, operation);
      if (original.kind !== "FOUND") return { kind: "REMOTE_UNKNOWN" };
      if (
        !original.receipt.data.plans.some(
          (entry) =>
            entry.plan.plan_id === id && entry.plan.plan_hash === command.expected_plan_hash,
        )
      )
        return { kind: "REMOTE_UNKNOWN" };
      return write(
        project,
        episode,
        operation,
        `/${id}/approvals`,
        command,
        original.receipt,
        (data) => hasApproval(data, id, command),
      );
    },
    async attachDraftReviewRevisionCandidate(project, episode, operation, id, input) {
      pathFor(project, episode, operation);
      planId(id);
      if (!isAttachDraftReviewRevisionCandidateRequest(input))
        throw new Error("Draft review revision requires an exact saved candidate attachment");
      const command = { ...input };
      const original = await list(project, episode, operation);
      if (original.kind !== "FOUND") return { kind: "REMOTE_UNKNOWN" };
      if (
        !original.receipt.data.plans.some(
          (entry) =>
            entry.plan.plan_id === id &&
            entry.plan.plan_hash === command.expected_plan_hash &&
            entry.approval?.approval_id === command.approval_id,
        )
      )
        return { kind: "REMOTE_UNKNOWN" };
      return write(
        project,
        episode,
        operation,
        `/${id}/candidates`,
        command,
        original.receipt,
        (data) => hasCandidate(data, id, command),
      );
    },
    async recheckDraftReviewRevisionCandidate(project, episode, operation, id, candidateId, input) {
      pathFor(project, episode, operation);
      planId(id);
      if (
        !isDraftReviewRevisionCandidateId(candidateId) ||
        !isRecheckDraftReviewRevisionCandidateRequest(input)
      )
        throw new Error("Draft review revision requires an exact candidate manual recheck");
      const command = { ...input };
      const original = await list(project, episode, operation);
      if (original.kind !== "FOUND") return { kind: "REMOTE_UNKNOWN" };
      if (
        !original.receipt.data.plans.some(
          (entry) =>
            entry.plan.plan_id === id &&
            entry.candidates.some(
              (candidate) =>
                candidate.candidate.candidate_id === candidateId &&
                candidate.candidate.candidate_hash === command.expected_candidate_hash,
            ),
        )
      )
        return { kind: "REMOTE_UNKNOWN" };
      return write(
        project,
        episode,
        operation,
        `/${id}/candidates/${candidateId}/rechecks`,
        command,
        original.receipt,
        (data) => hasRecheck(data, id, candidateId, command),
      );
    },
  };
}
