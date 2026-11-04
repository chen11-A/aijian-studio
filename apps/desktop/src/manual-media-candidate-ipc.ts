import {
  MANUAL_MEDIA_CANDIDATE_CHANNELS,
  candidateCommand,
  mediaScope,
  mediaVersionId,
  type ManualMediaCandidateGateway,
} from "@aijian/contracts/manual-media-candidate";

export function registerManualMediaCandidateHandlers<T>(
  handle: (c: string, f: (e: T, ...a: unknown[]) => Promise<unknown>) => void,
  clientFor: (e: T) => ManualMediaCandidateGateway,
  top: (e: T) => boolean,
): void {
  for (const [kind, channel] of Object.entries(MANUAL_MEDIA_CANDIDATE_CHANNELS))
    handle(channel, async (event, ...args) => {
      const client = clientFor(event);
      if (!top(event)) throw new Error("Unauthorized preparation frame");
      if (args.length !== 3 || !mediaScope(args[0], args[1]))
        throw new Error("Invalid preparation scope");
      const [p, e, value] = args as [string, string, unknown];
      if (kind === "list") {
        if (value !== undefined && !mediaVersionId(value))
          throw new Error("Invalid preparation cursor");
        return client.listManualMediaCandidates(p, e, value as string | undefined);
      }
      if (kind === "get") {
        if (!mediaVersionId(value)) throw new Error("Invalid preparation version");
        return client.getManualMediaCandidate(p, e, value);
      }
      if (!candidateCommand(value, p, e)) throw new Error("Invalid original preparation command");
      return kind === "save"
        ? client.saveManualMediaCandidate(p, e, value)
        : client.getManualMediaCandidateOperation(p, e, value);
    });
}
