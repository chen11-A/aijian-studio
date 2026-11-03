import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  applyDialogue,
  assemblyPath,
  deleteProject,
  importMusicFile,
  joinClips,
  mediaUrlPath,
  mixMusic,
  prepareVoiceFile,
  listEpisodes,
  listSeries,
  readMedia,
  readProject,
  renameSeries,
  requestStill,
  safeExportName,
  stillPath,
  trustedMediaPath,
  writeProject,
} from "./film-library";

const idPattern = /^film_[a-z0-9]{16,40}$/;

export type FilmLibraryHost = {
  filmsRoot: () => string;
  storyFilmsRoot: () => string;
  runFfmpeg: (args: string[]) => Promise<void>;
  probeDuration?: (path: string) => Promise<number>;
  mediaToken: () => Promise<string | null>;
  fetcher?: typeof fetch;
  pickDirectory: () => Promise<string | null>;
  defaultDirectory?: () => Promise<string>;
  copyFile: (source: string, destination: string) => Promise<void>;
  reveal: (path: string) => void;
  open: (path: string) => Promise<string>;
  logStill?: (detail: { ok: boolean; detail: string }) => void;
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
    const joined = await joinClips(voiced, destination, host.runFfmpeg);
    const music = typeof args[2] === "string" ? args[2] : "";
    if (!music) return joined;
    const track = trustedMediaPath(roots, music);
    try {
      return await mixMusic(
        joined.path,
        track,
        host.runFfmpeg,
        typeof args[3] === "number" && Number.isFinite(args[3]) ? args[3] : -14,
        host.probeDuration,
      );
    } catch {
      return { path: joined.path, reason: "视频已接上。配乐没有混进去。" };
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
      (args.length !== 2 && args.length !== 3) ||
      typeof args[0] !== "string" ||
      typeof args[1] !== "string" ||
      !idPattern.test(args[0]) ||
      (args.length === 3 && args[2] !== "9:16" && args[2] !== "16:9")
    ) {
      throw new Error("Invalid film");
    }
    const token = await host.mediaToken();
    const made = await requestStill({
      prompt: args[1],
      token,
      fetcher: host.fetcher ?? globalThis.fetch,
      destination: stillPath(host.filmsRoot(), args[0]),
      ...(args[2] === "9:16" || args[2] === "16:9" ? { aspectRatio: args[2] } : {}),
    });
    host.logStill?.({
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
      (args.length !== 2 && args.length !== 3) ||
      typeof args[0] !== "string" ||
      typeof args[1] !== "string"
    ) {
      throw new Error("Invalid film path");
    }
    const source = trustedMediaPath([host.filmsRoot(), host.storyFilmsRoot()], args[0]);
    if (!source.toLowerCase().endsWith(".mp4")) throw new Error("Invalid film path");
    if (args[1].length === 0 || args[1].length > 4096 || args[1].includes("\0")) {
      throw new Error("Invalid film path");
    }
    const suggested = typeof args[2] === "string" ? args[2] : basename(source);
    const destination = join(args[1], safeExportName(suggested));
    await host.copyFile(source, destination);
    exported.add(realpathSync(destination));
    return { ok: true, path: destination };
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
