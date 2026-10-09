import {
  isSourceProposalAcceptanceProjectId,
  isSourceProposalAcceptanceVersionId,
  SOURCE_PROPOSAL_ACCEPTANCE_CHANNEL,
  type SourceProposalAcceptanceResult,
} from "./source-proposal-acceptance-contract";

type SourceProposalAcceptanceClient = {
  getSourceProposalAcceptanceForVersion(
    projectId: string,
    versionId: string,
  ): Promise<SourceProposalAcceptanceResult>;
};

export function registerSourceProposalAcceptanceHandler<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => SourceProposalAcceptanceClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  handle(SOURCE_PROPOSAL_ACCEPTANCE_CHANNEL, async (event, ...args) => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Source proposal acceptance IPC sender frame is not authorized");
    }
    if (
      args.length !== 2 ||
      !isSourceProposalAcceptanceProjectId(args[0]) ||
      !isSourceProposalAcceptanceVersionId(args[1])
    ) {
      throw new Error("Source proposal acceptance IPC requires canonical ids");
    }
    return client.getSourceProposalAcceptanceForVersion(args[0], args[1]);
  });
}
