import type { LocalApiClient } from "./api-client";
import {
  PRODUCTION_BRIEF_CHANNELS,
  isProductionBriefCreateCommand,
} from "./production-brief-contract";

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
type Client = Pick<
  LocalApiClient,
  "getProductionBrief" | "getProductionBriefVersion" | "createProductionBriefVersion"
>;

export function resolveProductionBriefTopFrameClient<TEvent, TFrame>(
  event: TEvent & { senderFrame?: TFrame },
  mainFrame: TFrame | undefined,
  clientFor: (event: TEvent) => Client,
): Client {
  if (mainFrame === undefined || event.senderFrame !== mainFrame) {
    throw new Error("ProductionBrief IPC must originate from the top-level frame");
  }
  return clientFor(event);
}

export function registerProductionBriefHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => Client,
): void {
  handle(PRODUCTION_BRIEF_CHANNELS.get, async (event, ...args) => {
    if (args.length !== 1) throw new Error("Invalid ProductionBrief project");
    const [projectId] = args;
    if (typeof projectId !== "string" || !PROJECT_ID.test(projectId))
      throw new Error("Invalid ProductionBrief project");
    return clientFor(event).getProductionBrief(projectId);
  });
  handle(PRODUCTION_BRIEF_CHANNELS.getVersion, async (event, ...args) => {
    if (args.length !== 2) throw new Error("Invalid ProductionBrief version request");
    const [projectId, versionId] = args;
    if (
      typeof projectId !== "string" ||
      !PROJECT_ID.test(projectId) ||
      typeof versionId !== "string" ||
      !VERSION_ID.test(versionId)
    )
      throw new Error("Invalid ProductionBrief version request");
    return clientFor(event).getProductionBriefVersion(projectId, versionId);
  });
  handle(PRODUCTION_BRIEF_CHANNELS.create, async (event, ...args) => {
    if (args.length !== 2) throw new Error("Invalid ProductionBrief create command");
    const [projectId, command] = args;
    if (
      typeof projectId !== "string" ||
      !PROJECT_ID.test(projectId) ||
      !isProductionBriefCreateCommand(command)
    )
      throw new Error("Invalid ProductionBrief create command");
    return clientFor(event).createProductionBriefVersion(projectId, command);
  });
}
