import {
  PROJECT_CREATIVE_LIBRARY_CHANNELS,
  isCreateProjectCreativeLibraryVersionRequest,
  isCreativeIdempotencyKey,
  isCreativeProjectId,
  isCreativeVersionId,
  type ProjectCreativeLibraryGateway,
} from "./project-creative-library-contract";

export function registerProjectCreativeLibraryHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ProjectCreativeLibraryGateway,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): ProjectCreativeLibraryGateway => {
    if (!isTopLevelFrame(event)) throw new Error("Creative library sender frame is not authorized");
    return clientFor(event);
  };
  handle(PROJECT_CREATIVE_LIBRARY_CHANNELS.latest, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 1 || !isCreativeProjectId(args[0]))
      throw new Error("Creative library latest requires canonical project id");
    return client.getProjectCreativeLibrary(args[0]);
  });
  handle(PROJECT_CREATIVE_LIBRARY_CHANNELS.version, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !isCreativeProjectId(args[0]) || !isCreativeVersionId(args[1]))
      throw new Error("Creative library version requires canonical ids");
    return client.getProjectCreativeLibraryVersion(args[0], args[1]);
  });
  handle(PROJECT_CREATIVE_LIBRARY_CHANNELS.create, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 3 ||
      !isCreativeProjectId(args[0]) ||
      !isCreativeIdempotencyKey(args[1]) ||
      !isCreateProjectCreativeLibraryVersionRequest(args[2], args[0])
    )
      throw new Error("Creative library create requires canonical arguments");
    return client.createProjectCreativeLibraryVersion(args[0], args[1], args[2]);
  });
}
