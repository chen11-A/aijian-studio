import {
  isSub2APIConnectionId,
  isSub2APIModelId,
  SUB2API_CONFIGURED_READINESS_CHANNEL,
  type Sub2APIConfiguredReadinessResult,
} from "./sub2api-configured-readiness-contract";

type Sub2APIReadinessClient = {
  readSub2APIConfiguredReadiness(
    connectionId: string, modelId: string,
  ): Promise<Sub2APIConfiguredReadinessResult>;
};

export function registerSub2APIConfiguredReadinessHandler<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => Sub2APIReadinessClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  handle(SUB2API_CONFIGURED_READINESS_CHANNEL, async (event, ...args) => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Sub2API readiness IPC sender frame is not authorized");
    }
    if (args.length !== 2 || !isSub2APIConnectionId(args[0]) ||
        !isSub2APIModelId(args[1])) {
      throw new Error("Sub2API readiness IPC requires canonical ids");
    }
    return client.readSub2APIConfiguredReadiness(args[0], args[1]);
  });
}
