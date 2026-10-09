import {
  EPISODE_SCRIPT_CHANNELS,
  isCreateEpisodeScriptVersionRequest,
  isEpisodeScriptEpisodeId,
  isEpisodeScriptIdempotencyKey,
  isEpisodeScriptProjectId,
  isEpisodeScriptVersionId,
  type CreateEpisodeScriptVersionRequest,
  type EpisodeScriptCreateResult,
  type EpisodeScriptLatestResult,
  type EpisodeScriptVersionResult,
} from "./episode-script-contract";

type EpisodeScriptClient = {
  getEpisodeScript(projectId: string, episodeId: string): Promise<EpisodeScriptLatestResult>;
  getEpisodeScriptVersion(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<EpisodeScriptVersionResult>;
  createEpisodeScriptVersion(
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: CreateEpisodeScriptVersionRequest,
  ): Promise<EpisodeScriptCreateResult>;
};

export function registerEpisodeScriptHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => EpisodeScriptClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): EpisodeScriptClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Episode script IPC sender frame is not authorized");
    }
    return client;
  };
  const validScope = (args: unknown[]): args is [string, string, ...unknown[]] =>
    isEpisodeScriptProjectId(args[0]) && isEpisodeScriptEpisodeId(args[1]);
  handle(EPISODE_SCRIPT_CHANNELS.latest, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !validScope(args)) {
      throw new Error("Episode script latest IPC requires canonical ids");
    }
    return client.getEpisodeScript(args[0], args[1]);
  });
  handle(EPISODE_SCRIPT_CHANNELS.version, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !validScope(args) || !isEpisodeScriptVersionId(args[2])) {
      throw new Error("Episode script version IPC requires canonical ids");
    }
    return client.getEpisodeScriptVersion(args[0], args[1], args[2]);
  });
  handle(EPISODE_SCRIPT_CHANNELS.create, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 4 ||
      !validScope(args) ||
      !isEpisodeScriptIdempotencyKey(args[2]) ||
      !isCreateEpisodeScriptVersionRequest(args[3], args[0], args[1])
    ) {
      throw new Error("Episode script create IPC requires canonical arguments");
    }
    return client.createEpisodeScriptVersion(args[0], args[1], args[2], args[3]);
  });
}
