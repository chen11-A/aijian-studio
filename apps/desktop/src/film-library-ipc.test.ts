import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerFilmLibraryHandlers, type FilmLibraryHost } from "./film-library-ipc";

const series = "film_series0000000001";
const episode = "film_episode000000001";

function handlersFor(host: FilmLibraryHost) {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerFilmLibraryHandlers(
    (channel, callback) => handlers.set(channel, callback),
    (event: boolean) => event,
    host,
  );
  return handlers;
}

describe("film library IPC", () => {
  it("rejects an unauthorized sender and does not ask for a token", async () => {
    const token = vi.fn(async () => "secret");
    const host: FilmLibraryHost = {
      filmsRoot: () => mkdtempSync(join(tmpdir(), "aivora-films-")),
      storyFilmsRoot: () => mkdtempSync(join(tmpdir(), "aivora-story-")),
      runFfmpeg: vi.fn(async () => undefined),
      mediaToken: token,
      pickDirectory: async () => null,
      copyFile: vi.fn(async () => undefined),
      reveal: vi.fn(),
      open: vi.fn(async () => ""),
    };
    const handlers = handlersFor(host);
    await expect(handlers.get("film:still")?.(false, series, "巷口")).rejects.toThrow(
      "not authorized",
    );
    expect(token).not.toHaveBeenCalled();
  });

  it("stores a film and refuses a still without a token", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    const fetcher = vi.fn();
    const host: FilmLibraryHost = {
      filmsRoot: () => root,
      storyFilmsRoot: () => root,
      runFfmpeg: vi.fn(async () => undefined),
      mediaToken: async () => null,
      fetcher,
      pickDirectory: async () => null,
      copyFile: vi.fn(async () => undefined),
      reveal: vi.fn(),
      open: vi.fn(async () => ""),
    };
    const handlers = handlersFor(host);
    await handlers.get("film:write")?.(true, {
      id: episode,
      seriesId: series,
      title: "雨夜",
      seriesTitle: "雨夜",
      episodeNo: 1,
      shots: [],
    });
    const read = await handlers.get("film:read")?.(true, episode);
    expect(read).toMatchObject({ id: episode, seriesId: series });
    const still = await handlers.get("film:still")?.(true, series, "巷口");
    expect(still).toEqual({ path: "", reason: "需要重新登录后再出图。" });
    expect(fetcher).not.toHaveBeenCalled();
    const clip = join(root, "clip.mp4");
    mkdirSync(join(root, series), { recursive: true });
    writeFileSync(clip, Buffer.from("clip"));
    const assembled = await handlers.get("film:assemble")?.(true, series, [clip]);
    expect(assembled).toMatchObject({ reason: "" });
  });
});
