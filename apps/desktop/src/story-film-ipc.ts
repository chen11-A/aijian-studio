import { createStoryFilmClient, parseStoryFilmCreate } from "./story-film-client";

const projectIdPattern = /^prj_[0-9a-f]{32}$/;

type Session = { origin: string; token: string };

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function safeBearer(value: string | null): string | undefined {
  if (!value) return undefined;
  if (value.length > 8192 || hasControlCharacter(value)) return undefined;
  return value;
}

export function registerStoryFilmHandlers<TEvent>(
  handle: (
    channel: string,
    callback: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  authorized: (event: TEvent) => boolean,
  sessionFor: () => Session,
  mediaBearerFor: () => Promise<string | null>,
  fetcher: typeof fetch = globalThis.fetch,
): void {
  handle("story-film:plan", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (args.length !== 1) throw new Error("Unexpected story film arguments");
    const projectId = args[0];
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
      throw new Error("Invalid story film project");
    }
    return createStoryFilmClient(fetcher, sessionFor()).plan(projectId);
  });

  handle("story-film:progress", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (args.length !== 1) throw new Error("Unexpected story film arguments");
    const projectId = args[0];
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
      throw new Error("Invalid story film project");
    }
    return createStoryFilmClient(fetcher, sessionFor()).progress(projectId);
  });

  handle("story-film:cancel", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (args.length !== 1) throw new Error("Unexpected story film arguments");
    const projectId = args[0];
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
      throw new Error("Invalid story film project");
    }
    return createStoryFilmClient(fetcher, sessionFor()).cancel(projectId);
  });

  handle("story-film:create", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (args.length !== 2) throw new Error("Unexpected story film arguments");
    const projectId = args[0];
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
      throw new Error("Invalid story film project");
    }
    const body = parseStoryFilmCreate(args[1]);
    const bearer =
      body.provider === "grok_subscription" ? safeBearer(await mediaBearerFor()) : undefined;
    return createStoryFilmClient(fetcher, sessionFor()).create(projectId, body, bearer);
  });
}
