import { isDraftExportOperationId, isDraftExportScope } from "./draft-export-contract";
import {
  DRAFT_REVIEW_REVISION_CHANNELS,
  isApproveDraftReviewRevisionPlanRequest,
  isAttachDraftReviewRevisionCandidateRequest,
  isCreateDraftReviewRevisionPlanRequest,
  isDraftReviewRevisionCandidateId,
  isDraftReviewRevisionPlanId,
  isRecheckDraftReviewRevisionCandidateRequest,
  type DraftReviewRevisionGateway,
} from "./draft-review-revision-contract";

/** Manual immutable evidence only; never providers, file paths, or formal release approval. */
export function registerDraftReviewRevisionHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => DraftReviewRevisionGateway,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  function authorized(event: TEvent, args: unknown[], count: number): [string, string, string] {
    if (!isTopLevelFrame(event))
      throw new Error("Draft review revision IPC sender frame is not authorized");
    if (
      args.length !== count ||
      !isDraftExportScope(args[0], args[1]) ||
      !isDraftExportOperationId(args[2])
    )
      throw new Error("Draft review revision IPC requires canonical scope and operation ids");
    return [args[0] as string, args[1] as string, args[2]];
  }
  handle(DRAFT_REVIEW_REVISION_CHANNELS.list, async (event, ...args) => {
    const scope = authorized(event, args, 3);
    return clientFor(event).listDraftReviewRevisionPlans(...scope);
  });
  handle(DRAFT_REVIEW_REVISION_CHANNELS.scope, async (event, ...args) => {
    const scope = authorized(event, args, 3);
    return clientFor(event).getDraftReviewRevisionScope(...scope);
  });
  handle(DRAFT_REVIEW_REVISION_CHANNELS.create, async (event, ...args) => {
    const scope = authorized(event, args, 4);
    if (!isCreateDraftReviewRevisionPlanRequest(args[3]))
      throw new Error("Draft review revision IPC requires an exact manual plan");
    return clientFor(event).createDraftReviewRevisionPlan(...scope, args[3]);
  });
  handle(DRAFT_REVIEW_REVISION_CHANNELS.approve, async (event, ...args) => {
    const scope = authorized(event, args, 5);
    if (!isDraftReviewRevisionPlanId(args[3]) || !isApproveDraftReviewRevisionPlanRequest(args[4]))
      throw new Error("Draft review revision IPC requires an exact manual plan approval");
    return clientFor(event).approveDraftReviewRevisionPlan(...scope, args[3], args[4]);
  });
  handle(DRAFT_REVIEW_REVISION_CHANNELS.attach, async (event, ...args) => {
    const scope = authorized(event, args, 5);
    if (
      !isDraftReviewRevisionPlanId(args[3]) ||
      !isAttachDraftReviewRevisionCandidateRequest(args[4])
    )
      throw new Error("Draft review revision IPC requires an exact saved candidate attachment");
    return clientFor(event).attachDraftReviewRevisionCandidate(...scope, args[3], args[4]);
  });
  handle(DRAFT_REVIEW_REVISION_CHANNELS.recheck, async (event, ...args) => {
    const scope = authorized(event, args, 6);
    if (
      !isDraftReviewRevisionPlanId(args[3]) ||
      !isDraftReviewRevisionCandidateId(args[4]) ||
      !isRecheckDraftReviewRevisionCandidateRequest(args[5])
    )
      throw new Error("Draft review revision IPC requires an exact candidate manual recheck");
    return clientFor(event).recheckDraftReviewRevisionCandidate(
      ...scope,
      args[3],
      args[4],
      args[5],
    );
  });
}
