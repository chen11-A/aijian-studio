import {
  isVersionedSourceExtractionProposalId,
  isSub2APIApprovalCommand,
  isSub2APIProjectId,
  isSub2APIQueueCommand,
  SUB2API_CHANNELS,
  VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL,
  type Sub2APIApprovalCommand,
  type Sub2APIApprovalReadResult,
  type Sub2APIApprovalResult,
  type Sub2APIOperationReadResult,
  type Sub2APIQueueCommand,
  type Sub2APIQueueResult,
  type VersionedSourceExtractionProposalReadResult,
} from "./remote-source-extract-v2-contract";

type VersionedProposalReader = {
  readVersionedSourceExtractionProposal(
    projectId: string,
    proposalId: string,
  ): Promise<VersionedSourceExtractionProposalReadResult>;
};

export function registerVersionedSourceExtractionProposalHandler<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => VersionedProposalReader,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  handle(VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL, async (event, ...args) => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Versioned SourceExtraction proposal IPC sender frame is not authorized");
    }
    const [projectId, proposalId] = args;
    if (args.length !== 2 || typeof projectId !== "string" ||
        typeof proposalId !== "string" ||
        !isVersionedSourceExtractionProposalId(projectId, proposalId)) {
      throw new Error("Versioned SourceExtraction proposal IPC requires canonical arguments");
    }
    return client.readVersionedSourceExtractionProposal(projectId, proposalId);
  });
}

type Sub2APIClient = {
  createSub2APISourceExtractRun(
    projectId: string, command: Sub2APIQueueCommand,
  ): Promise<Sub2APIQueueResult>;
  readOriginalSub2APISourceExtractOperation(
    projectId: string, originalCommand: Sub2APIQueueCommand,
  ): Promise<Sub2APIOperationReadResult>;
  approveSub2APISourceExtractCall(
    projectId: string, originalCommand: Sub2APIQueueCommand,
    approvalCommand: Sub2APIApprovalCommand,
  ): Promise<Sub2APIApprovalResult>;
  getSub2APISourceExtractApproval(
    projectId: string, originalCommand: Sub2APIQueueCommand,
  ): Promise<Sub2APIApprovalReadResult>;
};

export function registerSub2APISourceExtractHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => Sub2APIClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): Sub2APIClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Sub2API SourceExtraction IPC sender frame is not authorized");
    }
    return client;
  };
  handle(SUB2API_CHANNELS.queue, async (event, ...args) => {
    const client = authorized(event);
    const [projectId, command] = args;
    if (args.length !== 2 || !isSub2APIProjectId(projectId) ||
        !isSub2APIQueueCommand(command)) {
      throw new Error("Sub2API queue IPC requires canonical arguments");
    }
    return client.createSub2APISourceExtractRun(projectId, command);
  });
  handle(SUB2API_CHANNELS.operation, async (event, ...args) => {
    const client = authorized(event);
    const [projectId, command] = args;
    if (args.length !== 2 || !isSub2APIProjectId(projectId) ||
        !isSub2APIQueueCommand(command)) {
      throw new Error("Sub2API operation IPC requires canonical arguments");
    }
    return client.readOriginalSub2APISourceExtractOperation(projectId, command);
  });
  handle(SUB2API_CHANNELS.approve, async (event, ...args) => {
    const client = authorized(event);
    const [projectId, command, approval] = args;
    if (args.length !== 3 || !isSub2APIProjectId(projectId) ||
        !isSub2APIQueueCommand(command) || !isSub2APIApprovalCommand(approval)) {
      throw new Error("Sub2API approval IPC requires canonical arguments");
    }
    return client.approveSub2APISourceExtractCall(projectId, command, approval);
  });
  handle(SUB2API_CHANNELS.approval, async (event, ...args) => {
    const client = authorized(event);
    const [projectId, command] = args;
    if (args.length !== 2 || !isSub2APIProjectId(projectId) ||
        !isSub2APIQueueCommand(command)) {
      throw new Error("Sub2API approval read IPC requires canonical arguments");
    }
    return client.getSub2APISourceExtractApproval(projectId, command);
  });
}
