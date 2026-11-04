import {
  LOCAL_MEDIA_REVIEW_CHANNELS,
  localReviewCommand,
  localReviewStatusQuery,
  localReviewTargetQuery,
  type LocalMediaReviewGateway,
} from "@aijian/contracts/local-media-review";
import { mediaScope, mediaVersionId } from "@aijian/contracts/media-preparation";

export function registerLocalMediaReviewHandlers<T>(
  handle: (channel: string, listener: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  clientFor: (event: T) => LocalMediaReviewGateway,
  authorized: (event: T) => boolean,
): void {
  for (const [kind, channel] of Object.entries(LOCAL_MEDIA_REVIEW_CHANNELS)) {
    handle(channel, async (event, ...args) => {
      if (!authorized(event)) throw new Error("Local media review IPC sender is not authorized");
      if (args.length !== 3 || !mediaScope(args[0], args[1]))
        throw new Error("Invalid local media review IPC scope");
      const [p, e, value] = args as [string, string, unknown];
      if (kind === "target") {
        if (!localReviewTargetQuery(value))
          throw new Error("Invalid local media review IPC target");
        return clientFor(event).getLocalMediaReviewTarget(p, e, value);
      }
      if (kind === "list") {
        if (value !== undefined && !mediaVersionId(value))
          throw new Error("Invalid local media review IPC cursor");
        return clientFor(event).listLocalMediaReviews(p, e, value);
      }
      if (kind === "get") {
        if (!mediaVersionId(value)) throw new Error("Invalid local media review IPC version");
        return clientFor(event).getLocalMediaReview(p, e, value);
      }
      if (kind === "status") {
        if (!localReviewStatusQuery(value))
          throw new Error("Invalid local media review IPC status");
        return clientFor(event).getLocalMediaReviewStatus(p, e, value);
      }
      if (!localReviewCommand(value, p, e))
        throw new Error("Invalid original local media review IPC command");
      return kind === "save"
        ? clientFor(event).saveLocalMediaReview(p, e, value)
        : clientFor(event).getLocalMediaReviewOperation(p, e, value);
    });
  }
}
