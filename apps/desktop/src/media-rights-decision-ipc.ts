import {
  isHumanRightsDecisionCommand,
  isRightsAssetId,
  isRightsDecisionId,
  isRightsDecisionLatestExpectation,
  isRightsOperationId,
  isRightsProjectId,
  isRightsVersionId,
  MEDIA_RIGHTS_DECISION_CHANNELS,
  type HumanRightsDecisionCommand,
  type RightsDecisionLatestResult,
  type RightsDecisionLatestExpectation,
  type RightsDecisionAuditResult,
  type RightsDecisionHistoryResult,
  type RightsDecisionOperationResult,
  type RightsDecisionWriteResult,
} from "./media-rights-decision-contract";

type MediaRightsDecisionClient = {
  recordMediaAssetRightsDecision(
    projectId: string, assetId: string, versionId: string,
    command: HumanRightsDecisionCommand,
  ): Promise<RightsDecisionWriteResult>;
  getMediaAssetRightsOperation(
    projectId: string, assetId: string, versionId: string, operationId: string,
  ): Promise<RightsDecisionOperationResult>;
  readLatestMediaAssetRightsDecision(
    projectId: string, assetId: string, versionId: string,
    expectation: RightsDecisionLatestExpectation,
  ): Promise<RightsDecisionLatestResult>;
  listMediaAssetRightsDecisionHistory(
    projectId: string, assetId: string, versionId: string,
  ): Promise<RightsDecisionHistoryResult>;
  getMediaAssetRightsDecisionAudit(
    projectId: string, assetId: string, versionId: string, decisionId: string,
  ): Promise<RightsDecisionAuditResult>;
};

export function registerMediaRightsDecisionHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => MediaRightsDecisionClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): MediaRightsDecisionClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Media rights IPC sender frame is not authorized");
    }
    return client;
  };
  const canonicalVersion = (args: unknown[]): args is [string, string, string, ...unknown[]] =>
    isRightsProjectId(args[0]) && isRightsAssetId(args[1]) &&
    isRightsVersionId(args[2]);

  handle(MEDIA_RIGHTS_DECISION_CHANNELS.record, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 4 || !canonicalVersion(args) ||
        !isHumanRightsDecisionCommand(args[3])) {
      throw new Error("Media rights write IPC requires canonical arguments");
    }
    // Actor identity is resolved in the trusted main/sidecar boundary, never from IPC input.
    return client.recordMediaAssetRightsDecision(args[0], args[1], args[2], args[3]);
  });
  handle(MEDIA_RIGHTS_DECISION_CHANNELS.operation, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 4 || !canonicalVersion(args) ||
        !isRightsOperationId(args[3])) {
      throw new Error("Media rights operation IPC requires canonical ids");
    }
    return client.getMediaAssetRightsOperation(args[0], args[1], args[2], args[3]);
  });
  handle(MEDIA_RIGHTS_DECISION_CHANNELS.latest, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 4 || !canonicalVersion(args) ||
        !isRightsDecisionLatestExpectation(args[3])) {
      throw new Error("Media rights latest IPC requires canonical arguments");
    }
    return client.readLatestMediaAssetRightsDecision(args[0], args[1], args[2], args[3]);
  });
  handle(MEDIA_RIGHTS_DECISION_CHANNELS.history, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !canonicalVersion(args)) {
      throw new Error("Media rights history IPC requires canonical ids");
    }
    return client.listMediaAssetRightsDecisionHistory(args[0], args[1], args[2]);
  });
  handle(MEDIA_RIGHTS_DECISION_CHANNELS.audit, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 4 || !canonicalVersion(args) ||
        !isRightsDecisionId(args[3])) {
      throw new Error("Media rights audit IPC requires canonical ids");
    }
    return client.getMediaAssetRightsDecisionAudit(args[0], args[1], args[2], args[3]);
  });
}
