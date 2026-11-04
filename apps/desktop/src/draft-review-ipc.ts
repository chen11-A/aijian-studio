import { isDraftExportOperationId, isDraftExportScope } from "./draft-export-contract";
import {
  DRAFT_REVIEW_CHANNELS,
  isCreateDraftReviewNoteRequest,
  isDraftReviewNoteId,
  isResolveDraftReviewNoteRequest,
  type DraftReviewGateway,
} from "./draft-review-contract";

/** A manual, exact-output note boundary: no path, gate, provider, or release capability. */
export function registerDraftReviewHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => DraftReviewGateway,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  function authorized(
    event: TEvent,
    args: unknown[],
    count: number,
  ): [DraftReviewGateway, string, string, string] {
    if (!isTopLevelFrame(event)) throw new Error("Draft review IPC sender frame is not authorized");
    if (
      args.length !== count ||
      !isDraftExportScope(args[0], args[1]) ||
      !isDraftExportOperationId(args[2])
    )
      throw new Error("Draft review IPC requires canonical scope and operation ids");
    return [clientFor(event), args[0] as string, args[1] as string, args[2]];
  }
  handle(DRAFT_REVIEW_CHANNELS.list, async (event, ...args) => {
    const [client, projectId, episodeId, operationId] = authorized(event, args, 3);
    return client.listDraftReviewNotes(projectId, episodeId, operationId);
  });
  handle(DRAFT_REVIEW_CHANNELS.create, async (event, ...args) => {
    const [client, projectId, episodeId, operationId] = authorized(event, args, 4);
    if (!isCreateDraftReviewNoteRequest(args[3]))
      throw new Error("Draft review IPC requires an exact path-free manual note");
    return client.createDraftReviewNote(projectId, episodeId, operationId, args[3]);
  });
  handle(DRAFT_REVIEW_CHANNELS.resolve, async (event, ...args) => {
    const [client, projectId, episodeId, operationId] = authorized(event, args, 5);
    if (!isDraftReviewNoteId(args[3]) || !isResolveDraftReviewNoteRequest(args[4]))
      throw new Error("Draft review IPC requires an exact manual note resolution");
    return client.resolveDraftReviewNote(projectId, episodeId, operationId, args[3], args[4]);
  });
}
