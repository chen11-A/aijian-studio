import {
  EPISODE_MEDIA_ASSEMBLY_CHANNELS,
  isAssemblyEpisodeId,
  isAssemblyProjectId,
  isAssemblyVersionId,
  isCreateEpisodeMediaAssemblyVersionRequest,
  type CreateEpisodeMediaAssemblyVersionRequest,
  type EpisodeMediaAssemblyResult,
  type EpisodeMediaAssemblyWriteResult,
} from "./episode-media-assembly-contract";

export type EpisodeMediaAssemblyClient = {
  readLatestEpisodeMediaAssembly(
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeMediaAssemblyResult>;
  getEpisodeMediaAssemblyVersion(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<EpisodeMediaAssemblyResult>;
  createEpisodeMediaAssemblyVersion(
    projectId: string,
    episodeId: string,
    payload: CreateEpisodeMediaAssemblyVersionRequest,
  ): Promise<EpisodeMediaAssemblyWriteResult>;
};
export function registerEpisodeMediaAssemblyHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => EpisodeMediaAssemblyClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): EpisodeMediaAssemblyClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Episode media assembly IPC sender frame is not authorized");
    }
    return client;
  };
  const scope = (args: unknown[]): args is [string, string, ...unknown[]] =>
    isAssemblyProjectId(args[0]) && isAssemblyEpisodeId(args[1]);
  handle(EPISODE_MEDIA_ASSEMBLY_CHANNELS.latest, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !scope(args)) {
      throw new Error("Episode media assembly read IPC requires canonical ids");
    }
    return client.readLatestEpisodeMediaAssembly(args[0], args[1]);
  });
  handle(EPISODE_MEDIA_ASSEMBLY_CHANNELS.version, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args) || !isAssemblyVersionId(args[2])) {
      throw new Error("Episode media assembly version IPC requires canonical ids");
    }
    return client.getEpisodeMediaAssemblyVersion(args[0], args[1], args[2]);
  });
  handle(EPISODE_MEDIA_ASSEMBLY_CHANNELS.create, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 3 ||
      !scope(args) ||
      !isCreateEpisodeMediaAssemblyVersionRequest(args[2], args[0], args[1])
    ) {
      throw new Error("Episode media assembly write IPC requires canonical arguments");
    }
    return client.createEpisodeMediaAssemblyVersion(args[0], args[1], args[2]);
  });
}
