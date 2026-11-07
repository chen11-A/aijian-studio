import { generationVideoRecovery } from "./generation-video-recovery";
import {
  generationFailurePolicy,
  parseGenerationFailureConfiguration,
} from "./generation-failure-policy";
import type { GenerationDispatchAccount } from "./generation-dispatch-account";
import { parseStoryFilmLocalScope, publicDialogueLimit } from "./film-dialogue-limit";
import type { StoryFilmLocalScope } from "@aijian/contracts/film-dialogue-split";
import type { StoryFilmCreateInput } from "./story-film-client";
import { styleDiagnostics, type StyleDiagnostics } from "./style-diagnostics";
import { realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { stripUnsafeFileChars } from "./film-library";
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
  const name = stripUnsafeFileChars(basename(path)).trim().slice(0, 80);
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
  mediaBearerFor: () => Promise<string | GenerationDispatchAccount | null>,
  fetcher: typeof fetch = globalThis.fetch,
  files?: StoryFilmFiles,
  logStyle?: (detail: StyleDiagnostics) => void,
  limitEvidence?: (
    event: TEvent,
    projectId: string,
    body: StoryFilmCreateInput,
    scope: StoryFilmLocalScope,
    result: unknown,
  ) => Promise<string | null>,
  evidenceCurrent?: (event: TEvent) => () => boolean,
): void {
  for (const [channel, mode] of [
    ["story-film:video-recovery-list", "list"],
    ["story-film:video-recover", "recover"],
    ["story-film:video-recovery-save", "save"],
  ] as const) {
    handle(channel, async (event, ...args) => {
      if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
      if (
        args.length !== (mode === "list" ? 1 : 2) ||
        typeof args[0] !== "string" ||
        (mode !== "list" && typeof args[1] !== "string")
      )
        throw new Error("Invalid video recovery arguments");
      return generationVideoRecovery(
        fetcher,
        sessionFor,
        mediaBearerFor,
        args[0],
        mode,
        args[1] as string | undefined,
        files?.chooseExport,
        evidenceCurrent?.(event) ?? (() => authorized(event)),
      );
    });
  }

  handle("story-film:failure-policy", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (args.length !== 1 || typeof args[0] !== "string")
      throw new Error("Invalid failure policy arguments");
    return generationFailurePolicy(fetcher, sessionFor(), args[0]);
  });
  handle("story-film:configure-failure-policy", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (args.length !== 2 || typeof args[0] !== "string")
      throw new Error("Invalid failure policy arguments");
    return generationFailurePolicy(
      fetcher,
      sessionFor(),
      args[0],
      parseGenerationFailureConfiguration(args[1]),
    );
  });

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
    if (args.length !== 2 && args.length !== 3) throw new Error("Unexpected story film arguments");
    const projectId = args[0];
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
      throw new Error("Invalid story film project");
    }
    const body = parseStoryFilmCreate(args[1]);
    const scope = args.length === 3 ? parseStoryFilmLocalScope(args[2]) : undefined;
    // Synchronous document epoch capture spans bearer/HTTP waits without moving dispatch gates.
    const sameDocument = scope ? evidenceCurrent?.(event) : undefined;
    const media = body.provider === "grok_subscription" ? await mediaBearerFor() : null;
    const account = media && typeof media === "object" ? media : undefined;
    const bearer = safeBearer(account?.bearer ?? (typeof media === "string" ? media : null));
    const workspace = files?.workspace();
    const mediaRoots = workspace
      ? [join(dirname(workspace), "films"), join(workspace, "story-films")]
      : [];
    const submitting: typeof fetch = (input, init) => {
      if (init?.method === "POST" && body.provider === "grok_subscription") {
        for (const shot of body.shots ?? []) logStyle?.(styleDiagnostics(shot.prompt));
      }
      return fetcher(input, init);
    };
    const result = await createStoryFilmClient(
      submitting,
      sessionFor(),
      undefined,
      mediaRoots,
    ).create(projectId, body, bearer, account);
    // Evidence-only read after the actual result; no new await before dispatch.
    const evidenceId =
      scope && (sameDocument?.() ?? true)
        ? await limitEvidence?.(event, projectId, body, scope, result).catch(() => null)
        : null;
    const data = { ...result.data };
    if ("dialogue_limit" in data) {
      const summary = publicDialogueLimit(data.dialogue_limit);
      if (summary) data.dialogue_limit = summary;
      else delete data.dialogue_limit;
    }
    if (evidenceId && (sameDocument?.() ?? true)) data.dialogue_limit_evidence_id = evidenceId;
    return { ...result, data };
  });

  // 4B-B12: only a film inside this workspace's story films, made again without subtitles.
  handle("story-film:clean-copy", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Story film IPC sender is not authorized");
    if (!files) throw new Error("Story film files are unavailable");
    if (args.length !== 2) throw new Error("Unexpected story film arguments");
    const projectId = args[0];
    if (typeof projectId !== "string" || !projectIdPattern.test(projectId)) {
      throw new Error("Invalid story film project");
    }
    const film = trustedStoryFilmPath(files.workspace(), args[1]);
    if (!film.toLowerCase().endsWith(".mp4")) throw new Error("Invalid story film path");
    return createStoryFilmClient(fetcher, sessionFor()).remakeCleanCopy(projectId, film);
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
