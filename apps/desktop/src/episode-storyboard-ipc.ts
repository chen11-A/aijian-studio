import {
  EPISODE_STORYBOARD_CHANNELS,
  isCreateEpisodeStoryboardVersionRequest,
  isEpisodeStoryboardEpisodeId,
  isEpisodeStoryboardIdempotencyKey,
  isEpisodeStoryboardProjectId,
  isEpisodeStoryboardVersionId,
  type EpisodeStoryboardGateway,
} from "./episode-storyboard-contract";

export function registerEpisodeStoryboardHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => EpisodeStoryboardGateway,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): EpisodeStoryboardGateway => {
    if (!isTopLevelFrame(event))
      throw new Error("Episode storyboard sender frame is not authorized");
    return clientFor(event);
  };
  const validScope = (args: unknown[]): args is [string, string, ...unknown[]] =>
    isEpisodeStoryboardProjectId(args[0]) && isEpisodeStoryboardEpisodeId(args[1]);
  handle(EPISODE_STORYBOARD_CHANNELS.latest, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !validScope(args))
      throw new Error("Episode storyboard latest requires canonical scope ids");
    return client.getEpisodeStoryboard(args[0], args[1]);
  });
  handle(EPISODE_STORYBOARD_CHANNELS.version, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !validScope(args) || !isEpisodeStoryboardVersionId(args[2]))
      throw new Error("Episode storyboard version requires canonical ids");
    return client.getEpisodeStoryboardVersion(args[0], args[1], args[2]);
  });
  handle(EPISODE_STORYBOARD_CHANNELS.create, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 4 ||
      !validScope(args) ||
      !isEpisodeStoryboardIdempotencyKey(args[2]) ||
      !isCreateEpisodeStoryboardVersionRequest(args[3], args[0], args[1])
    )
      throw new Error("Episode storyboard create requires canonical arguments");
    return client.createEpisodeStoryboardVersion(args[0], args[1], args[2], args[3]);
  });
}
