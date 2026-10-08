import type { LocalApiClient } from "./api-client";
import {
  isEpisodeId,
  isEpisodeProjectId,
  normalizeEpisodeCreateInput,
  validateEpisodeListQuery,
} from "./episode-contract";

export const EPISODE_CHANNELS = Object.freeze({
  list: "episodes:list",
  get: "episodes:get",
  create: "episodes:create",
} as const);

type EpisodeClient = Pick<LocalApiClient, "listEpisodes" | "getEpisode" | "createEpisode">;

export function createTopLevelEpisodeClientFor<TEvent>(
  clientFor: (event: TEvent) => EpisodeClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): (event: TEvent) => EpisodeClient {
  return (event) => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) throw new Error("Episode IPC sender frame is not authorized");
    return client;
  };
}

export function registerEpisodeHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => EpisodeClient,
): void {
  handle(EPISODE_CHANNELS.list, async (event, ...args) => {
    const client = clientFor(event);
    if (
      args.length !== 2 ||
      typeof args[0] !== "string" ||
      !isEpisodeProjectId(args[0]) ||
      args[1] === undefined
    ) {
      throw new Error("Episode IPC requires exact canonical arguments");
    }
    const query = validateEpisodeListQuery(args[1]);
    if (query === null) throw new Error("Episode IPC requires exact canonical arguments");
    return client.listEpisodes(args[0], query);
  });
  handle(EPISODE_CHANNELS.get, async (event, ...args) => {
    const client = clientFor(event);
    if (
      args.length !== 2 ||
      typeof args[0] !== "string" ||
      !isEpisodeProjectId(args[0]) ||
      typeof args[1] !== "string" ||
      !isEpisodeId(args[1])
    ) {
      throw new Error("Episode IPC requires exact canonical arguments");
    }
    return client.getEpisode(args[0], args[1]);
  });
  handle(EPISODE_CHANNELS.create, async (event, ...args) => {
    const client = clientFor(event);
    if (args.length !== 2 || typeof args[0] !== "string" || !isEpisodeProjectId(args[0])) {
      throw new Error("Episode IPC requires exact canonical arguments");
    }
    const input = normalizeEpisodeCreateInput(args[1]);
    if (input === null) throw new Error("Episode IPC requires exact canonical arguments");
    return client.createEpisode(args[0], input);
  });
}
