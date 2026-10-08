import type { LocalApiClient } from "./api-client";
import {
  REMOTE_SOURCE_EXTRACT_CHANNELS,
  isRemoteSourceExtractCreateCommand,
  isRemoteSourceExtractProjectId,
  isSourceExtractionVersionId,
} from "./remote-source-extract-contract";

type Client = Pick<LocalApiClient,
  "createRemoteSourceExtractRun" | "readOriginalRemoteSourceExtractRun" |
  "getSourceExtraction" | "getSourceExtractionVersion">;

export function resolveRemoteSourceExtractTopFrameClient<TEvent, TFrame>(
  event: TEvent & { senderFrame?: TFrame },
  mainFrame: TFrame | undefined,
  clientFor: (event: TEvent) => Client,
): Client {
  if (mainFrame === undefined || event.senderFrame !== mainFrame) {
    throw new Error("Remote source extract IPC must originate from the top-level frame");
  }
  return clientFor(event);
}

export function registerRemoteSourceExtractHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => Client,
): void {
  handle(REMOTE_SOURCE_EXTRACT_CHANNELS.create, (event, ...args) => {
    if (args.length !== 2) throw new Error("Invalid remote source extract command");
    const [projectId, command] = args;
    if (!isRemoteSourceExtractProjectId(projectId) ||
        !isRemoteSourceExtractCreateCommand(command)) {
      throw new Error("Invalid remote source extract command");
    }
    return clientFor(event).createRemoteSourceExtractRun(projectId, command);
  });
  handle(REMOTE_SOURCE_EXTRACT_CHANNELS.readOriginalRun, (event, ...args) => {
    if (args.length !== 2) throw new Error("Invalid remote source extract run identity");
    const [projectId, originalCommand] = args;
    if (!isRemoteSourceExtractProjectId(projectId) ||
        !isRemoteSourceExtractCreateCommand(originalCommand)) {
      throw new Error("Invalid remote source extract run identity");
    }
    return clientFor(event).readOriginalRemoteSourceExtractRun(projectId, originalCommand);
  });
  handle(REMOTE_SOURCE_EXTRACT_CHANNELS.getSourceExtraction, (event, ...args) => {
    if (args.length !== 1 || !isRemoteSourceExtractProjectId(args[0])) {
      throw new Error("Invalid SourceExtraction project identity");
    }
    return clientFor(event).getSourceExtraction(args[0]);
  });
  handle(REMOTE_SOURCE_EXTRACT_CHANNELS.getSourceExtractionVersion, (event, ...args) => {
    if (args.length !== 2 || !isRemoteSourceExtractProjectId(args[0]) ||
        !isSourceExtractionVersionId(args[1])) {
      throw new Error("Invalid SourceExtraction version identity");
    }
    return clientFor(event).getSourceExtractionVersion(args[0], args[1]);
  });
}
