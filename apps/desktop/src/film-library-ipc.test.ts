import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    for (const channel of ["film:prepare", "film:write"]) {
      await expect(handlers.get(channel)?.(false, {})).rejects.toThrow("not authorized");
    }
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
    await expect(handlers.get("film:prepare")?.(true)).rejects.toThrow("Invalid film");
    const prepared = await handlers.get("film:prepare")?.(true, {
      id: episode,
      seriesId: series,
      poster: "data:image/png;base64,YWJj",
    });
    expect(prepared).toMatchObject({ poster: expect.stringContaining("media") });
    expect(await handlers.get("film:read")?.(true, episode)).toBeNull();
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

const lastFrameRoots: string[] = [];
afterEach(() => {
  for (const root of lastFrameRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function lastFrameHost() {
  const root = mkdtempSync(join(tmpdir(), "aivora-last-frame-ipc-"));
  lastFrameRoots.push(root);
  const films = join(root, "films");
  const story = join(root, "story");
  mkdirSync(films);
  mkdirSync(story);
  const source = join(story, "shot.mp4");
  writeFileSync(source, "fixture video; decoder is injected in IPC test");
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(2, 16);
  png.writeUInt32BE(2, 20);
  const runFfmpeg = vi.fn<FilmLibraryHost["runFfmpeg"]>(async (args) => {
    writeFileSync(args.at(-1)!, png);
  });
  const probeDuration = vi.fn(async () => 3);
  const host: FilmLibraryHost = {
    filmsRoot: () => films,
    storyFilmsRoot: () => story,
    runFfmpeg,
    probeDuration,
    mediaToken: vi.fn(async () => "unused"),
    fetcher: vi.fn(),
    pickDirectory: async () => null,
    copyFile: async () => undefined,
    reveal: vi.fn(),
    open: async () => "",
  };
  return {
    root,
    films,
    story,
    source,
    host,
    runFfmpeg,
    probeDuration,
    invoke: handlersFor(host).get("film:last-frame")!,
  };
}

it("last-frame IPC rejects unauthorized callers before accessing media or providers", async () => {
  const env = lastFrameHost();
  await expect(env.invoke(false, series, env.source)).rejects.toThrow("not authorized");
  expect(env.probeDuration).not.toHaveBeenCalled();
  expect(env.runFfmpeg).not.toHaveBeenCalled();
  expect(env.host.mediaToken).not.toHaveBeenCalled();
  expect(env.host.fetcher).not.toHaveBeenCalled();
});

it("last-frame IPC accepts a trusted media URL and returns a saved PNG without provider access", async () => {
  const env = lastFrameHost();
  const result = (await env.invoke(
    true,
    series,
    `aivora-media://local/?path=${encodeURIComponent(env.source)}`,
  )) as { path: string; sourceVideoPath: string };
  expect(result.sourceVideoPath).toBe(realpathSync.native(env.source));
  const actualSource = statSync(result.sourceVideoPath, { bigint: true });
  const originalSource = statSync(env.source, { bigint: true });
  expect([actualSource.dev, actualSource.ino]).toEqual([originalSource.dev, originalSource.ino]);
  expect(readFileSync(result.sourceVideoPath)).toEqual(readFileSync(env.source));
  expect(result.path.startsWith(env.films)).toBe(true);
  expect(readFileSync(result.path).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(env.probeDuration).toHaveBeenCalledWith(realpathSync.native(env.source));
  expect(env.runFfmpeg).toHaveBeenCalledOnce();
  expect(env.host.mediaToken).not.toHaveBeenCalled();
  expect(env.host.fetcher).not.toHaveBeenCalled();
});

it("last-frame IPC refuses external, remote, and symlink-escaped sources without leaking paths", async () => {
  const env = lastFrameHost();
  const outside = join(env.root, "private.mp4");
  writeFileSync(outside, "outside");
  const escaped = join(env.story, "escaped.mp4");
  symlinkSync(outside, escaped);
  for (const path of [
    outside,
    escaped,
    "https://example.com/private.mp4",
    join(env.story, "missing.mp4"),
  ]) {
    const result = await env.invoke(true, series, path);
    expect(result).toEqual({
      path: "",
      sourceVideoPath: "",
      code: "CONTINUITY_VIDEO_INVALID",
      text: "请使用作品内可读取的本地视频。",
    });
    expect(JSON.stringify(result)).not.toContain(env.root);
  }
  expect(env.probeDuration).not.toHaveBeenCalled();
  expect(env.runFfmpeg).not.toHaveBeenCalled();
});

it("last-frame IPC validates arguments and returns fixed capability/decoder failures", async () => {
  const env = lastFrameHost();
  for (const args of [
    [],
    ["../escape", env.source],
    [series, 42],
    [series, env.source, "extra"],
    [series, "bad\0path"],
  ])
    expect(await env.invoke(true, ...args)).toMatchObject({
      code: "CONTINUITY_REQUEST_INVALID",
      path: "",
    });
  delete env.host.probeDuration;
  expect(await env.invoke(true, series, env.source)).toMatchObject({
    code: "CONTINUITY_PROBE_UNAVAILABLE",
  });
  env.host.probeDuration = env.probeDuration;
  env.runFfmpeg.mockRejectedValueOnce(new Error(`decoder secret at ${env.source}`));
  const result = await env.invoke(true, series, env.source);
  expect(result).toEqual({
    path: "",
    sourceVideoPath: "",
    code: "CONTINUITY_EXTRACTION_FAILED",
    text: "末帧没有提取成功。",
  });
  expect(JSON.stringify(result)).not.toContain(env.root);
});
