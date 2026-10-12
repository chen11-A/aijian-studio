import {
  ASSEMBLY_READINESS_CHANNEL,
  readinessTarget,
  type AssemblyReadinessGateway,
} from "@aijian/contracts/assembly-readiness";
import { isAssemblyEpisodeId, isAssemblyProjectId } from "./episode-media-assembly-contract";

export function registerAssemblyReadinessHandler<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => AssemblyReadinessGateway,
  authorized: (event: TEvent) => boolean,
): void {
  handle(ASSEMBLY_READINESS_CHANNEL, async (event, ...args) => {
    if (!authorized(event)) throw new Error("Assembly readiness IPC sender is not authorized");
    if (
      args.length !== 3 ||
      !isAssemblyProjectId(args[0]) ||
      !isAssemblyEpisodeId(args[1]) ||
      !readinessTarget(args[2])
    )
      throw new Error("Assembly readiness IPC requires exact scoped target");
    return clientFor(event).getEpisodeAssemblyReadiness(args[0], args[1], args[2]);
  });
}
