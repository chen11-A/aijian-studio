import {
  IMPACT_CHANNELS,
  impactEpisode,
  impactId,
  impactInput,
  impactProject,
  impactUuid,
  type ScriptImpactGateway,
} from "@aijian/contracts/script-confirmation-impact";

export function registerScriptConfirmationImpactHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ScriptImpactGateway,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent) => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event))
      throw new Error("Script impact sender is not the authorized top frame");
    return client;
  };
  handle(IMPACT_CHANNELS.list, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 2 ||
      !impactProject(args[0]) ||
      (args[1] !== undefined && !impactId(args[1]))
    )
      throw new Error("Invalid script impact list arguments");
    return client.listScriptConfirmationImpacts(args[0], args[1] as string | undefined);
  });
  handle(IMPACT_CHANNELS.detail, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !impactProject(args[0]) || !impactId(args[1]))
      throw new Error("Invalid script impact detail arguments");
    return client.getScriptConfirmationImpact(args[0], args[1]);
  });
  handle(IMPACT_CHANNELS.operation, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 4 ||
      !impactProject(args[0]) ||
      !impactEpisode(args[1]) ||
      !impactUuid(args[2]) ||
      !impactInput(args[3])
    )
      throw new Error("Invalid original script confirmation operation arguments");
    return client.getEpisodeScriptConfirmationOperation(args[0], args[1], args[2], args[3]);
  });
}
