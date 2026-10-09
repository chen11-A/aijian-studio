import {
  EPISODE_SCRIPT_CONFIRMATION_CHANNELS,
  isCreateEpisodeScriptConfirmationRequest,
  isEpisodeScriptConfirmationId,
  type CreateEpisodeScriptConfirmationRequest,
  type EpisodeScriptConfirmationCreateResult,
  type EpisodeScriptConfirmationReadResult,
} from "./episode-script-confirmation-contract";
import {
  isEpisodeScriptEpisodeId,
  isEpisodeScriptIdempotencyKey,
  isEpisodeScriptProjectId,
} from "./episode-script-contract";

type EpisodeScriptConfirmationClient = {
  getEpisodeScriptConfirmation(
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeScriptConfirmationReadResult>;
  createEpisodeScriptConfirmation(
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: CreateEpisodeScriptConfirmationRequest,
  ): Promise<EpisodeScriptConfirmationCreateResult>;
  getEpisodeScriptConfirmationReceipt(
    projectId: string,
    episodeId: string,
    confirmationId: string,
  ): Promise<EpisodeScriptConfirmationReadResult>;
};

export function registerEpisodeScriptConfirmationHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => EpisodeScriptConfirmationClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): EpisodeScriptConfirmationClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("Episode script confirmation IPC sender frame is not authorized");
    }
    return client;
  };
  const validScope = (args: unknown[]): args is [string, string, ...unknown[]] =>
    isEpisodeScriptProjectId(args[0]) && isEpisodeScriptEpisodeId(args[1]);
  handle(EPISODE_SCRIPT_CONFIRMATION_CHANNELS.current, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !validScope(args)) {
      throw new Error("Episode script confirmation read IPC requires canonical ids");
    }
    return client.getEpisodeScriptConfirmation(args[0], args[1]);
  });
  handle(EPISODE_SCRIPT_CONFIRMATION_CHANNELS.create, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 4 ||
      !validScope(args) ||
      !isEpisodeScriptIdempotencyKey(args[2]) ||
      !isCreateEpisodeScriptConfirmationRequest(args[3])
    ) {
      throw new Error("Episode script confirmation write IPC requires canonical arguments");
    }
    return client.createEpisodeScriptConfirmation(args[0], args[1], args[2], args[3]);
  });
  handle(EPISODE_SCRIPT_CONFIRMATION_CHANNELS.receipt, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !validScope(args) || !isEpisodeScriptConfirmationId(args[2])) {
      throw new Error("Episode script confirmation receipt IPC requires canonical ids");
    }
    return client.getEpisodeScriptConfirmationReceipt(args[0], args[1], args[2]);
  });
}
