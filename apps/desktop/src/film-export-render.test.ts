import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerFilmLibraryHandlers, type FilmLibraryHost } from "./film-library-ipc";
import { bundledSubtitleFont } from "./film-library";
import { exportFilmFile, filmExportOptions, type FilmExportExtras } from "./film-export";
import {
  coverAss,
  exportCanvas,
  subtitleAss,
  subtitleLineLimit,
  subtitleSrt,
  wrapSubtitle,
} from "./film-subtitles";

const fontFile = resolve(
  __dirname,
  "../../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf",
);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("4B-B09 export subtitles and cover text", () => {
  it("sizes the frame by quality and aspect", () => {
    expect(exportCanvas("9:16", "1080p")).toEqual({ width: 1080, height: 1920 });
    expect(exportCanvas("9:16", "720p")).toEqual({ width: 720, height: 1280 });
    expect(exportCanvas("16:9", "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(exportCanvas("16:9", "720p")).toEqual({ width: 1280, height: 720 });
  });

  it("wraps portrait lines at 12 characters after punctuation, as the preview does", () => {
    const tall = exportCanvas("9:16", "1080p");
    expect(subtitleLineLimit("white", tall)).toBe(12);
    expect(wrapSubtitle("你来晚了。这家店，下个月就没了。", 12)).toEqual([
      "你来晚了。这家店，",
      "下个月就没了。",
    ]);
    for (const line of wrapSubtitle("这一句没有标点但是很长很长很长很长很长很长", 12))
      expect([...line].length).toBeLessThanOrEqual(12);
  });

  it("writes each look with the preview's margins and keeps user text literal", () => {
    const tall = exportCanvas("9:16", "1080p");
    const cues = [{ text: "别动{\\i1}这里", start: 1, end: 2.5 }];
    const white = subtitleAss(cues, "white", tall);
    expect(white).toContain("PlayResX: 1080");
    expect(white).toContain("PlayResY: 1920");
    // Portrait: 24% from the bottom, above the platforms' buttons.
    expect(white).toMatch(/Style: Sub,Noto Sans CJK SC,65,&H00ECE9E7,.*,2,76,76,461,1/);
    expect(white).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Sub,,0,0,0,,别动｛＼i1｝这里");
    expect(subtitleAss(cues, "bar", tall)).toMatch(/,3,\d+,0,2,/);
    expect(subtitleAss(cues, "yellow", tall)).toContain("&H003DA3E8");
    const wide = subtitleAss(cues, "film", exportCanvas("16:9", "720p"));
    // Landscape: 9% from the bottom, a smaller face for 电影字幕.
    expect(wide).toMatch(/Style: Sub,Noto Sans CJK SC,31,.*,2,90,90,65,1/);
  });

  it("writes a numbered .srt with millisecond times", () => {
    const srt = subtitleSrt(
      [
        { text: "打烊了。", start: 0, end: 1.25 },
        { text: "我找林国栋。", start: 61.5, end: 63 },
      ],
      "white",
      exportCanvas("9:16", "1080p"),
    );
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,250\n打烊了。\n\n2\n00:01:01,500 --> 00:01:03,000\n我找林国栋。\n",
    );
  });

  it("puts the title, the episode and the AI mark on the cover only when asked", () => {
    const frame = exportCanvas("9:16", "1080p");
    const on = coverAss({ title: "晚照书店", subtitle: "第 1 集", aiMark: true }, frame);
    expect(on).toContain("Title,,0,0,0,,晚照书店");
    expect(on).toContain("Sub,,0,0,0,,第 1 集");
    expect(on).toContain("Mark,,0,0,0,,AI 生成");
    expect(coverAss({ title: "晚照书店", subtitle: "", aiMark: false }, frame)).not.toContain(
      "AI 生成",
    );
  });

  it("validates renderer input", () => {
    expect(
      filmExportOptions({
        canvas: "9:16",
        quality: "720p",
        subtitles: { mode: "burn", style: "bar", cues: [{ text: "好", start: 0, end: 1 }] },
        cover: { title: "片名", subtitle: "", aiMark: true },
      }),
    ).toMatchObject({ canvas: "9:16", quality: "720p" });
    for (const bad of [
      { quality: "4k" },
      { canvas: "1:1" },
      { subtitles: { mode: "burn", style: "pink", cues: [] } },
      { subtitles: { mode: "burn", style: "white", cues: [{ text: "a\nb", start: 0, end: 1 }] } },
      { subtitles: { mode: "burn", style: "white", cues: [{ text: "好", start: 2, end: 1 }] } },
      { cover: { title: "x", subtitle: "", aiMark: "yes" } },
      { cover: { title: "x", subtitle: "", aiMark: true, extra: 1 } },
    ])
      expect(() => filmExportOptions(bad)).toThrow("EXPORT_OPTIONS_INVALID");
  });
});

const ffmpeg = process.env.AIVORA_FFMPEG || "/usr/bin/ffmpeg";
const ffprobe =
  process.env.AIVORA_FFPROBE ||
  join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
let available = existsSync(fontFile);
try {
  execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
  execFileSync(ffprobe, ["-version"], { stdio: "ignore" });
} catch {
  available = false;
}

describe.skipIf(!available)("4B-B09 real FFmpeg export rendering", () => {
  const run = async (args: string[], options?: { cwd?: string; env?: Record<string, string> }) => {
    execFileSync(ffmpeg, args, {
      stdio: "pipe",
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      env: { ...process.env, ...(options?.env ?? {}) },
    });
  };
  async function source(width: number, height: number) {
    const directory = await mkdtemp(join(tmpdir(), "film-render-test-"));
    directories.push(directory);
    const path = join(directory, "source.mp4");
    await run([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x204060:s=${width}x${height}:r=24:d=2`,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ]);
    return { directory, path };
  }
  const probe = (path: string) =>
    JSON.parse(
      execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], {
        encoding: "utf8",
      }),
    ) as {
      streams: {
        codec_type: string;
        width?: number;
        height?: number;
        disposition?: Record<string, number>;
      }[];
      format: { tags?: Record<string, string> };
    };
  const frameAt = (path: string, seconds: number) =>
    execFileSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-ss",
        String(seconds),
        "-i",
        path,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
  const bright = (pixels: Buffer) => pixels.filter((value) => value > 200).length;

  it("scales to 720p, burns the subtitle in its look, embeds the cover and tags AI media", async () => {
    const { directory, path } = await source(360, 640);
    const target = join(directory, "out");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(target));
    let extras: FilmExportExtras = {};
    const exported = await exportFilmFile(
      path,
      target,
      "晚照书店-第1集",
      filmExportOptions({
        canvas: "9:16",
        quality: "720p",
        subtitles: {
          mode: "burn",
          style: "bar",
          cues: [{ text: "你来晚了。", start: 0.5, end: 1.5 }],
        },
        cover: { title: "晚照书店", subtitle: "第 1 集", aiMark: true },
      }),
      run,
      () => false,
      { fontFile },
      (value) => {
        extras = value;
      },
    );
    const info = probe(exported);
    const video = info.streams.filter((stream) => stream.codec_type === "video");
    expect(video[0]).toMatchObject({ width: 720, height: 1280 });
    expect(video[1]?.disposition?.attached_pic).toBe(1);
    expect(info.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(info.format.tags?.comment).toBe("AI-generated");
    // White subtitle pixels while the cue is on, none after it.
    expect(bright(frameAt(exported, 1))).toBeGreaterThan(200);
    expect(bright(frameAt(exported, 1.8))).toBe(0);
    expect(extras.coverPath).toBe(exported.replace(/\.mp4$/, "-封面.png"));
    const cover = probe(extras.coverPath!).streams[0]!;
    expect(cover).toMatchObject({ width: 720, height: 1280 });
    expect(extras.subtitlePath).toBeUndefined();
    expect((await readdir(target)).sort()).toEqual([
      "晚照书店-第1集-封面.png",
      "晚照书店-第1集.mp4",
    ]);
  });

  it("leaves the picture clean and writes the .srt beside the film", async () => {
    const { directory, path } = await source(640, 360);
    let extras: FilmExportExtras = {};
    const exported = await exportFilmFile(
      path,
      directory,
      "film",
      filmExportOptions({
        canvas: "16:9",
        quality: "1080p",
        subtitles: {
          mode: "srt",
          style: "white",
          cues: [{ text: "我不买书。", start: 0.2, end: 1.6 }],
        },
      }),
      run,
      () => false,
      { fontFile },
      (value) => {
        extras = value;
      },
    );
    expect(probe(exported).streams.find((stream) => stream.codec_type === "video")).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(bright(frameAt(exported, 1))).toBe(0);
    expect(await readFile(extras.subtitlePath!, "utf8")).toContain("我不买书。");
  });
});

describe("4B-B09 IPC: export extras, cover picture and shot durations", () => {
  function host(extra: Partial<FilmLibraryHost> = {}) {
    const root = mkdtempSync(join(tmpdir(), "film-render-ipc-"));
    directories.push(root);
    const films = join(root, "films");
    const story = join(root, "story");
    mkdirSync(films);
    mkdirSync(story);
    const calls: string[][] = [];
    const runFfmpeg = vi.fn<FilmLibraryHost["runFfmpeg"]>(async (args, options) => {
      calls.push(args);
      const out = args.at(-1)!;
      writeFileSync(
        options?.cwd && !out.startsWith("/") && !/^[A-Za-z]:/.test(out)
          ? join(options.cwd, out)
          : out,
        "media",
      );
    });
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerFilmLibraryHandlers(
      (name, callback) => handlers.set(name, callback),
      (event: boolean) => event,
      {
        filmsRoot: () => films,
        storyFilmsRoot: () => story,
        runFfmpeg,
        subtitleFont: () => fontFile,
        mediaToken: async () => null,
        pickDirectory: async () => root,
        copyFile: vi.fn(),
        reveal: vi.fn(),
        open: async () => "",
        ...extra,
      },
    );
    return { root, films, story, calls, handlers };
  }

  it("uses only a work's own still for the cover and reports the files written beside the film", async () => {
    const { root, story, calls, handlers } = host();
    const source = join(story, "take.mp4");
    writeFileSync(source, "video");
    const still = join(story, "still.png");
    writeFileSync(still, "png");
    const outside = join(root, "elsewhere.png");
    writeFileSync(outside, "png");
    const run = (picture: string, name: string) =>
      handlers.get("film:export")!(true, source, root, name, {
        canvas: "9:16",
        quality: "1080p",
        subtitles: { mode: "srt", style: "white", cues: [{ text: "好", start: 0, end: 1 }] },
        cover: { title: "晚照书店", subtitle: "第 1 集", aiMark: true, still: picture },
      }) as Promise<{ path: string; coverPath?: string; subtitlePath?: string }>;
    const inside = await run(`aivora-media://local/?path=${encodeURIComponent(still)}`, "a");
    const canonicalStill = realpathSync.native(still);
    expect(calls[0]).toContain(canonicalStill);
    const passedStill = calls[0]![calls[0]!.indexOf(canonicalStill)]!;
    const actualStill = statSync(passedStill, { bigint: true });
    const originalStill = statSync(still, { bigint: true });
    expect([actualStill.dev, actualStill.ino]).toEqual([originalStill.dev, originalStill.ino]);
    expect(await readFile(passedStill)).toEqual(await readFile(still));
    expect(inside.coverPath).toBe(
      join(await import("node:fs/promises").then((fs) => fs.realpath(root)), "a-封面.png"),
    );
    expect(inside.subtitlePath).toMatch(/a\.srt$/);
    calls.length = 0;
    await run(outside, "b");
    expect(calls[0]).not.toContain(outside);
    expect(calls[0]!.join(" ")).toContain("color=c=0x0e1014");
  });

  it("uses a still held as a data URL for this export only", async () => {
    const { root, story, calls, handlers } = host();
    const source = join(story, "take.mp4");
    writeFileSync(source, "video");
    const png = `data:image/png;base64,${Buffer.from("\x89PNG\r\n\x1a\nfake").toString("base64")}`;
    await handlers.get("film:export")!(true, source, root, "c", {
      canvas: "16:9",
      quality: "720p",
      cover: { title: "晚照书店", subtitle: "", aiMark: false, still: png },
    });
    const picture = calls[0]![calls[0]!.indexOf("-i") + 1]!;
    expect(picture).toMatch(/aivora-cover-.*\.png$/);
    // The temporary copy is gone after the export.
    expect(existsSync(picture)).toBe(false);
  });

  it("returns how long each shot lasts in the joined film", async () => {
    const { films, story, handlers } = host({
      probeDuration: async (path) => (path.endsWith("a.mp4") ? 2.5 : 3),
    });
    const series = "film_series000000000001";
    mkdirSync(join(films, series), { recursive: true });
    for (const name of ["a.mp4", "b.mp4"]) writeFileSync(join(story, name), "clip");
    const joined = (await handlers.get("film:assemble")!(true, series, [
      join(story, "a.mp4"),
      join(story, "b.mp4"),
    ])) as { durations?: number[] };
    expect(joined.durations).toEqual([2.5, 3]);
  });

  it("finds the shipped face in a package or in the repository", () => {
    expect(bundledSubtitleFont("", { repositoryRoot: resolve(__dirname, "../../..") })).toBe(
      fontFile,
    );
    expect(bundledSubtitleFont("/nowhere", { execPath: "/nowhere/bin/app" })).toBeUndefined();
  });
});
