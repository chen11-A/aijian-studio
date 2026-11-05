import {
  exportFilmFile,
  filmExportOptions,
  type FilmExportExtras,
  type RunFfmpeg,
} from "./film-export";
import { styleDiagnostics, type StyleDiagnostics } from "./style-diagnostics";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extractFilmLastFrame } from "./film-last-frame";
import { dirname, join, resolve } from "node:path";
import {
  applyDialogue,
  assemblyPath,
  deleteProject,
  importMusicFile,
  joinClips,
  mediaUrlPath,
  mixMusic,
  prepareVoiceFile,
  prepareProject,
  listEpisodes,
  listSeries,
  readMedia,
  readProject,
  renameSeries,
  requestStill,
  stillPath,
  stillReferenceImage,
  trustedMediaPath,
  writeProject,
} from "./film-library";

const idPattern = /^film_[a-z0-9]{16,40}$/;

export type FilmLibraryHost = {
  filmsRoot: () => string;
  storyFilmsRoot: () => string;
  runFfmpeg: RunFfmpeg;
  probeDuration?: (path: string) => Promise<number>;
  /** 4B-B09: the shipped subtitle face, for burned subtitles and the cover's words. */
  subtitleFont?: () => string | undefined;
  mediaToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
  pickDirectory: () => Promise<string | null>;
  defaultDirectory?: () => Promise<string>;
  copyFile: (source: string, destination: string) => Promise<void>;
  reveal: (path: string) => void;
  open: (path: string) => Promise<string>;
  logStill?: (
    detail: StyleDiagnostics & {
      ok: boolean;
      detail: string;
      referenceImageCount: number;
      selectedReferenceImageCount: number;
      /** A transport attempt, not confirmation that the provider received or accepted it. */
      requestDispatched: boolean;
      imageLimit: number;
      videoReferenceLimit: number;
      durationMs: number;
      requestChars: number;
    },
  ) => void;
};

function oneId(args: unknown[]): string {
  if (args.length !== 1 || typeof args[0] !== "string" || !idPattern.test(args[0])) {
    throw new Error("Invalid film");
  }
  return args[0];
}

export function registerFilmLibraryHandlers<TEvent>(
  handle: (
    channel: string,
    callback: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  authorized: (event: TEvent) => boolean,
  host: FilmLibraryHost,
): void {
  const exported = new Set<string>();
  const exportsInProgress = new Map<string, { cancelled: boolean }>();
  const guard = (event: TEvent) => {
    if (!authorized(event)) throw new Error("Film IPC sender is not authorized");
  };
  const allowedMedia = (raw: string) => {
    try {
      return trustedMediaPath([host.filmsRoot(), host.storyFilmsRoot()], raw);
    } catch (error) {
      if (raw.length === 0 || raw.length > 4096 || raw.includes("\0")) throw error;
      try {
        const target = realpathSync(resolve(raw));
        if (exported.has(target)) return target;
      } catch {
        throw error;
      }
      throw error;
    }
  };

  handle("film:list-series", async (event) => {
    guard(event);
    return listSeries(host.filmsRoot());
  });

  handle("film:list-episodes", async (event, ...args) => {
    guard(event);
    return listEpisodes(host.filmsRoot(), oneId(args));
  });

  handle("film:read", async (event, ...args) => {
    guard(event);
    return readProject(host.filmsRoot(), oneId(args));
  });

  handle("film:prepare", async (event, ...args) => {
    guard(event);
    if (args.length !== 1) throw new Error("Invalid film");
    return prepareProject(host.filmsRoot(), args[0]);
  });

  handle("film:write", async (event, ...args) => {
    guard(event);
    if (args.length !== 1) throw new Error("Invalid film");
    return writeProject(host.filmsRoot(), args[0]);
  });

  handle("film:delete", async (event, ...args) => {
    guard(event);
    await deleteProject(host.filmsRoot(), oneId(args));
    return { ok: true };
  });

  handle("film:rename", async (event, ...args) => {
    guard(event);
    if (args.length !== 2 || typeof args[0] !== "string" || typeof args[1] !== "string") {
      throw new Error("Invalid film");
    }
    if (!idPattern.test(args[0])) throw new Error("Invalid film");
    await renameSeries(host.filmsRoot(), args[0], args[1]);
    return { ok: true };
  });

  handle("film:read-media", async (event, ...args) => {
    guard(event);
    if (args.length !== 1 || typeof args[0] !== "string") throw new Error("Invalid film path");
    return readMedia([host.filmsRoot(), host.storyFilmsRoot()], args[0]);
  });

  handle("film:last-frame", async (event, ...args) => {
    guard(event);
    const failed = (code: string, text: string) => ({ path: "", sourceVideoPath: "", code, text });
    if (
      args.length !== 2 ||
      typeof args[0] !== "string" ||
      !idPattern.test(args[0]) ||
      typeof args[1] !== "string" ||
      !args[1] ||
      args[1].length > 4096 ||
      args[1].includes("\0")
    )
      return failed("CONTINUITY_REQUEST_INVALID", "末帧提取参数不完整。");
    if (!host.probeDuration)
      return failed("CONTINUITY_PROBE_UNAVAILABLE", "当前无法读取视频时长。");
    try {
      return await extractFilmLastFrame(args[0], args[1], {
        roots: [host.filmsRoot(), host.storyFilmsRoot()],
        filmsRoot: host.filmsRoot(),
        runFfmpeg: host.runFfmpeg,
        probeDuration: host.probeDuration,
        current: () => authorized(event),
      });
    } catch (error) {
      const messages: Record<string, string> = {
        CONTINUITY_VIDEO_INVALID: "请使用作品内可读取的本地视频。",
        CONTINUITY_PROBE_FAILED: "视频时长没有读到。",
        CONTINUITY_DURATION_INVALID: "视频时长不适合提取末帧。",
        CONTINUITY_DESTINATION_INVALID: "末帧保存位置不可用。",
        CONTINUITY_FRAME_INVALID: "提取的末帧无效。",
        CONTINUITY_REQUEST_STALE: "本次末帧提取已停止。",
        CONTINUITY_EXTRACTION_FAILED: "末帧没有提取成功。",
      };
      const received = error instanceof Error && "code" in error ? error.code : undefined;
      const code =
        typeof received === "string" && Object.hasOwn(messages, received)
          ? received
          : "CONTINUITY_EXTRACTION_FAILED";
      return failed(code, messages[code]!);
    }
  });

  handle("film:assemble", async (event, ...args) => {
    guard(event);
    if (
      (args.length !== 2 && args.length !== 4 && args.length !== 5) ||
      typeof args[0] !== "string" ||
      !Array.isArray(args[1])
    ) {
      throw new Error("Invalid film");
    }
    if (!idPattern.test(args[0])) throw new Error("Invalid film");
    const roots = [host.filmsRoot(), host.storyFilmsRoot()];
    const sources = args[1].map((item) => {
      if (typeof item !== "string") throw new Error("Invalid film path");
      return trustedMediaPath(roots, item);
    });
    if (sources.some((source) => !source.toLowerCase().endsWith(".mp4"))) {
      throw new Error("Invalid film path");
    }
    const destination = assemblyPath(host.filmsRoot(), args[0]);
    const dialogue = Array.isArray(args[4]) ? args[4] : [];
    const voiced: string[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]!;
      const mark = typeof dialogue[index] === "string" ? dialogue[index] : "";
      if (!mark) {
        voiced.push(source);
        continue;
      }
      let voice = "mute";
      if (mark !== "mute") {
        const decoded = mediaUrlPath(mark);
        const stored = decoded.startsWith("data:")
          ? await prepareVoiceFile(dirname(destination), decoded)
          : decoded;
        voice = trustedMediaPath(roots, stored);
      }
      voiced.push(
        await applyDialogue(
          source,
          voice,
          join(dirname(destination), `dub-${index}.mp4`),
          host.runFfmpeg,
          host.probeDuration,
        ),
      );
    }
    // 4B-B09: how long each shot lasts in the joined film, to place its subtitles.
    const durations = host.probeDuration
      ? await Promise.all(voiced.map((path) => host.probeDuration!(path)))
      : [];
    const timed = <T extends object>(result: T) =>
      durations.length === voiced.length && durations.every((value) => value > 0)
        ? { ...result, durations }
        : result;
    const joined = await joinClips(voiced, destination, host.runFfmpeg);
    const music = typeof args[2] === "string" ? args[2] : "";
    if (!music) return timed(joined);
    const track = trustedMediaPath(roots, music);
    try {
      return timed(
        await mixMusic(
          joined.path,
          track,
          host.runFfmpeg,
          typeof args[3] === "number" && Number.isFinite(args[3]) ? args[3] : -14,
          host.probeDuration,
        ),
      );
    } catch {
      return timed({ path: joined.path, reason: "视频已接上。配乐没有混进去。" });
    }
  });

  handle("film:import-music", async (event, ...args) => {
    guard(event);
    if (args.length !== 2 || typeof args[0] !== "string" || typeof args[1] !== "string") {
      throw new Error("Invalid film");
    }
    if (!idPattern.test(args[0])) throw new Error("Invalid film");
    return { path: await importMusicFile(host.filmsRoot(), args[0], args[1]) };
  });

  handle("film:still", async (event, ...args) => {
    guard(event);
    if (
      args.length < 2 ||
      args.length > 4 ||
      typeof args[0] !== "string" ||
      typeof args[1] !== "string" ||
      !idPattern.test(args[0]) ||
      (args[2] !== undefined && args[2] !== "9:16" && args[2] !== "16:9") ||
      (args[3] !== undefined &&
        (!Array.isArray(args[3]) ||
          args[3].length > 13 ||
          args[3].some((item: unknown) => typeof item !== "string")))
    ) {
      throw new Error("Invalid film");
    }
    const references: string[] = [];
    if (Array.isArray(args[3])) {
      try {
        for (const source of args[3] as string[]) {
          references.push(
            await stillReferenceImage([host.filmsRoot(), host.storyFilmsRoot()], source),
          );
        }
      } catch {
        return { path: "", reason: "参考图无法读取，请重新选择。" };
      }
    }
    const token = await host.mediaToken();
    const started = Date.now();
    const selectedReferenceImageCount = new Set(references).size;
    let requestDispatched = false;
    const made = await requestStill({
      references,
      prompt: args[1],
      token,
      fetcher: (input, init) => {
        // Validation and sign-in failures never reach this transport boundary.
        // A failed network attempt still does not prove provider acceptance.
        if (init?.method === "POST") requestDispatched = true;
        return (host.fetcher ?? globalThis.fetch)(input, init);
      },
      destination: stillPath(host.filmsRoot(), args[0]),
      ...(args[2] === "9:16" || args[2] === "16:9" ? { aspectRatio: args[2] } : {}),
    });
    host.logStill?.({
      ...styleDiagnostics(args[1]),
      referenceImageCount: requestDispatched ? selectedReferenceImageCount : 0,
      selectedReferenceImageCount,
      requestDispatched,
      imageLimit: 5,
      videoReferenceLimit: 13,
      durationMs: Date.now() - started,
      requestChars: args[1].length,
      ok: Boolean(made.path),
      detail: made.path ? "定妆或起始画面已保存。" : made.reason || "出图没有成功。",
    });
    return made;
  });

  handle("film:pick-folder", async (event) => {
    guard(event);
    return host.pickDirectory();
  });

  handle("film:default-folder", async (event) => {
    guard(event);
    if (!host.defaultDirectory) return "";
    return host.defaultDirectory();
  });

  handle("film:export", async (event, ...args) => {
    guard(event);
    if (
      args.length < 2 ||
      args.length > 4 ||
      typeof args[0] !== "string" ||
      typeof args[1] !== "string"
    ) {
      throw new Error("Invalid film path");
    }
    const source = trustedMediaPath([host.filmsRoot(), host.storyFilmsRoot()], args[0]);
    if (!source.toLowerCase().endsWith(".mp4")) throw new Error("Invalid film path");
    const options = filmExportOptions(args[3]);
    // The cover's picture must be one of the work's own saved stills, or a picture the
    // renderer still holds as a data URL (saved to a temporary folder for this export only).
    let coverStill: string | undefined;
    let coverFolder = "";
    if (options.cover?.still) {
      const raw = options.cover.still;
      try {
        if (/^data:image\//i.test(raw)) {
          coverFolder = await mkdtemp(join(tmpdir(), "aivora-cover-"));
          const saved = await prepareVoiceFile(coverFolder, raw);
          coverStill = saved && saved !== raw ? saved : undefined;
        } else {
          coverStill = trustedMediaPath(
            [host.filmsRoot(), host.storyFilmsRoot()],
            mediaUrlPath(raw),
          );
        }
      } catch {
        coverStill = undefined;
      }
    }
    const state = { cancelled: false };
    if (options.requestId && exportsInProgress.has(options.requestId))
      throw new Error("EXPORT_ALREADY_RUNNING");
    if (options.requestId) exportsInProgress.set(options.requestId, state);
    let destination: string;
    let extras: FilmExportExtras = {};
    try {
      destination = await exportFilmFile(
        source,
        args[1],
        typeof args[2] === "string" ? args[2] : undefined,
        options,
        host.runFfmpeg,
        () => state.cancelled,
        { fontFile: host.subtitleFont?.(), ...(coverStill ? { coverStill } : {}) },
        (value) => {
          extras = value;
        },
      );
    } finally {
      if (options.requestId) exportsInProgress.delete(options.requestId);
      if (coverFolder) await rm(coverFolder, { recursive: true, force: true });
    }
    exported.add(realpathSync(destination));
    return { ok: true, path: destination, ...extras };
  });

  handle("film:cancel-export", async (event, ...args) => {
    guard(event);
    const options = filmExportOptions({ requestId: args[0] });
    if (args.length !== 1 || !options.requestId) throw new Error("EXPORT_OPTIONS_INVALID");
    const state = exportsInProgress.get(options.requestId);
    if (state) state.cancelled = true;
    return { ok: true };
  });

  handle("film:reveal", async (event, ...args) => {
    guard(event);
    if (args.length !== 1 || typeof args[0] !== "string") throw new Error("Invalid film path");
    host.reveal(allowedMedia(args[0]));
    return { ok: true };
  });

  handle("film:open", async (event, ...args) => {
    guard(event);
    if (args.length !== 1 || typeof args[0] !== "string") throw new Error("Invalid film path");
    const path = allowedMedia(args[0]);
    return { ok: true, error: await host.open(path) };
  });
}
