import { realpathSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { createStoryFilmClient, parseStoryFilmCreate } from "./story-film-client";

const mediaExtensions = new Set([".mp4", ".png", ".jpg", ".jpeg", ".webp", ".wav", ".mp3"]);
const maxMediaBytes = 80 * 1024 * 1024;

export type StoryFilmFiles = {
  workspace: () => string;
  byteLength: (path: string) => Promise<number>;
  read: (path: string) => Promise<Uint8Array>;
  reveal: (path: string) => void;
  chooseExport: (suggestedName: string) => Promise<string | null>;
  copy: (source: string, destination: string) => Promise<void>;
};

function trustedStoryFilmPath(workspace: string, raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) {
    throw new Error("Invalid story film path");
  }
  if (raw.includes("\0") || raw.split(/[/\\]/).includes("..")) {
    throw new Error("Invalid story film path");
  }
  let root: string;
  let target: string;
  try {
    root = realpathSync(resolve(workspace, "story-films"));
    target = realpathSync(resolve(raw));
  } catch {
    throw new Error("Invalid story film path");
  }
  if (!mediaExtensions.has(extname(target).toLowerCase())) {
    throw new Error("Invalid story film path");
  }
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(prefix)) throw new Error("Invalid story film path");
  return target;
}

function suggestedFilmName(path: string): string {
  const name = basename(path)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 80);
  if (!name || name === "." || name === "..") return "aivora-film.mp4";
  return name.toLowerCase().endsWith(".mp4") ? name : `${name}.mp4`;
}

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
  files?: StoryFilmFiles,
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

  handle("story-film:read", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (!files) throw new Error("Story film files are unavailable");
    if (args.length !== 1) throw new Error("Unexpected story film arguments");
    const source = trustedStoryFilmPath(files.workspace(), args[0]);
    const length = await files.byteLength(source);
    if (!Number.isSafeInteger(length) || length <= 0 || length > maxMediaBytes) {
      throw new Error("Story film media is too large");
    }
    const bytes = await files.read(source);
    if (bytes.byteLength !== length || bytes.byteLength > maxMediaBytes) {
      throw new Error("Story film media is too large");
    }
    return bytes;
  });

  handle("story-film:reveal", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (!files) throw new Error("Story film files are unavailable");
    if (args.length !== 1) throw new Error("Unexpected story film arguments");
    files.reveal(trustedStoryFilmPath(files.workspace(), args[0]));
    return { ok: true };
  });

  handle("story-film:export", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (!files) throw new Error("Story film files are unavailable");
    if (args.length !== 1) throw new Error("Unexpected story film arguments");
    const source = trustedStoryFilmPath(files.workspace(), args[0]);
    if (!source.toLowerCase().endsWith(".mp4")) throw new Error("Invalid story film path");
    const picked = await files.chooseExport(suggestedFilmName(source));
    if (picked === null) return { ok: false, cancelled: true };
    if (
      typeof picked !== "string" ||
      picked.length === 0 ||
      picked.length > 4096 ||
      picked.includes("\0")
    ) {
      throw new Error("Invalid story film export");
    }
    await files.copy(source, picked);
    return { ok: true };
  });
}
