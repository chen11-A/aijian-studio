import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, link, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerFilmLibraryHandlers } from "./film-library-ipc";
import { exportFilmFile, filmExportOptions } from "./film-export";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "film-export-test-"));
  directories.push(directory);
  const source = join(directory, "source.mp4");
  await writeFile(source, "original video");
  return { directory, source };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("film aspect export", () => {
  it("copies original bytes by default and never replaces its source or hardlinks", async () => {
    const { source, directory } = await fixture();
    const run = vi.fn();
    const target = await exportFilmFile(source, directory, "copy.mp4", {}, run);
    expect(await readFile(target)).toEqual(await readFile(source));
    expect(run).not.toHaveBeenCalled();
    await expect(exportFilmFile(source, directory, "source.mp4", {}, run)).rejects.toThrow(
      "EXPORT_SOURCE_OVERWRITE",
    );
    await link(source, join(directory, "hard.mp4"));
    await expect(exportFilmFile(source, directory, "hard.mp4", {}, run)).rejects.toThrow(
      "EXPORT_SOURCE_OVERWRITE",
    );
  });
  it("rejects malformed ratios, request ids and unsupported options", () => {
    for (const options of [
      null,
      [],
      { aspectRatio: "1:1" },
      { requestId: "../x" },
      { arbitrary: true },
    ]) {
      expect(() => filmExportOptions(options)).toThrow("EXPORT_OPTIONS_INVALID");
    }
  });
  it.skipIf(process.platform === "win32")("rejects symlink targets", async () => {
    const { source, directory } = await fixture();
    await symlink(source, join(directory, "linked.mp4"));
    await expect(exportFilmFile(source, directory, "linked.mp4", {}, vi.fn())).rejects.toThrow(
      "EXPORT_SOURCE_OVERWRITE",
    );
  });
  it("cleans temporary output on cancellation and FFmpeg failure without replacing existing output", async () => {
    const { source, directory } = await fixture();
    const destination = join(directory, "result-9x16.mp4");
    await writeFile(destination, "existing");
    let cancelled = false;
    const run = async (args: string[]) => {
      await writeFile(args.at(-1)!, "partial");
      cancelled = true;
    };
    await expect(
      exportFilmFile(source, directory, "result", { aspectRatio: "9:16" }, run, () => cancelled),
    ).rejects.toThrow("EXPORT_CANCELLED");
    expect(await readFile(destination, "utf8")).toBe("existing");
    await expect(
      exportFilmFile(source, directory, "result", { aspectRatio: "9:16" }, async () => {
        throw new Error("ffmpeg failed");
      }),
    ).rejects.toThrow("ffmpeg failed");
    expect((await readdir(directory)).some((name) => name.startsWith(".aivora-export"))).toBe(
      false,
    );
    expect(await readFile(source, "utf8")).toBe("original video");
  });
});

const ffmpeg = process.env.AIVORA_FFMPEG || "/usr/bin/ffmpeg";
const ffprobe =
  process.env.AIVORA_FFPROBE ||
  join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
let available = true;
try {
  execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
  execFileSync(ffprobe, ["-version"], { stdio: "ignore" });
} catch {
  available = false;
}
it("requires explicitly configured FFmpeg to be runnable", () => {
  if (process.env.AIVORA_FFMPEG) expect(available).toBe(true);
});
describe.skipIf(!available)("real FFmpeg center crop with audio", () => {
  it.each(["16:9", "9:16"] as const)(
    "exports %s with central pixels, audio and unchanged source",
    async (aspectRatio) => {
      const { source, directory } = await fixture();
      const portrait = aspectRatio === "16:9";
      const run = async (args: string[]) => {
        execFileSync(ffmpeg, args, { stdio: "pipe" });
      };
      await run([
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=red:s=${portrait ? "180x320" : "320x180"}:r=10:d=1`,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-vf",
        portrait
          ? "drawbox=x=0:y=110:w=180:h=100:color=lime:t=fill"
          : "drawbox=x=110:y=0:w=100:h=180:color=lime:t=fill",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        source,
      ]);
      const before = await readFile(source);
      const target = await exportFilmFile(source, directory, "film", { aspectRatio }, run);
      expect(target).toContain(aspectRatio.replace(":", "x"));
      const streams = JSON.parse(
        execFileSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", target], {
          encoding: "utf8",
        }),
      ).streams;
      const video = streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
      const [width, height] = aspectRatio === "16:9" ? ([16, 9] as const) : ([9, 16] as const);
      expect(video.width * height).toBe(video.height * width);
      expect(streams.some((stream: { codec_type: string }) => stream.codec_type === "audio")).toBe(
        true,
      );
      const pixels = execFileSync(ffmpeg, [
        "-v",
        "error",
        "-i",
        target,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      for (let i = 0; i < pixels.length; i += 3)
        expect(pixels[i + 1]).toBeGreaterThan(pixels[i]! + 100);
      const audio = (path: string) =>
        execFileSync(ffmpeg, [
          "-v",
          "error",
          "-i",
          path,
          "-map",
          "0:a:0",
          "-c",
          "copy",
          "-f",
          "adts",
          "pipe:1",
        ]);
      expect(audio(target)).toEqual(audio(source));
      expect(await readFile(source)).toEqual(before);
    },
  );
});

it("IPC authorizes cancellation and aborts a pending ratio export before publication", async () => {
  const { source, directory } = await fixture();
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  let release!: () => void;
  const started = new Promise<void>((done) => {
    registerFilmLibraryHandlers(
      (name, callback) => handlers.set(name, callback),
      (event: boolean) => event,
      {
        filmsRoot: () => directory,
        storyFilmsRoot: () => directory,
        runFfmpeg: async (args) => {
          await writeFile(args.at(-1)!, "output");
          done();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
        mediaToken: async () => null,
        pickDirectory: async () => directory,
        copyFile: vi.fn(),
        reveal: vi.fn(),
        open: async () => "",
      },
    );
  });
  const pending = handlers.get("film:export")!(true, source, directory, "output", {
    aspectRatio: "16:9",
    requestId: "request-1",
  });
  const rejected = expect(pending).rejects.toThrow("EXPORT_CANCELLED");
  await started;
  await expect(handlers.get("film:cancel-export")!(false, "request-1")).rejects.toThrow(
    "not authorized",
  );
  await handlers.get("film:cancel-export")!(true, "request-1");
  release();
  await rejected;
  expect(await readdir(directory)).toEqual(["source.mp4"]);
});

describe("export validation boundaries", () => {
  it("accepts omitted options and rejects non-string request identifiers", () => {
    expect(filmExportOptions(undefined)).toEqual({});
    expect(filmExportOptions({ aspectRatio: "16:9", requestId: "job:123" })).toEqual({
      aspectRatio: "16:9",
      requestId: "job:123",
    });
    expect(() => filmExportOptions({ requestId: 1 })).toThrow("EXPORT_OPTIONS_INVALID");
  });
  it("rejects invalid or non-directory destinations and pre-cancelled requests before copying", async () => {
    const { source, directory } = await fixture();
    const run = vi.fn();
    for (const path of ["", "relative", "x".repeat(4097), `${directory}\0`, source]) {
      await expect(exportFilmFile(source, path, "out", {}, run)).rejects.toThrow(
        "EXPORT_DIRECTORY_INVALID",
      );
    }
    await expect(
      exportFilmFile(source, directory, "out", {}, run, () => true),
    ).rejects.toMatchObject({ code: "EXPORT_CANCELLED" });
    expect(run).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual(["source.mp4"]);
  });
  it("preserves the source basename for a default export into another directory", async () => {
    const { source } = await fixture();
    const { directory } = await fixture();
    const output = await exportFilmFile(source, directory, undefined, {}, vi.fn());
    expect(output).toBe(join(directory, "source.mp4"));
    expect(await readFile(output)).toEqual(await readFile(source));
  });
  it.each(["empty", "directory"])(
    "rejects a successful process with %s output and cleans its staging folder",
    async (kind) => {
      const { source, directory } = await fixture();
      await expect(
        exportFilmFile(source, directory, "out", { aspectRatio: "16:9" }, async (args) => {
          if (kind === "empty") await writeFile(args.at(-1)!, "");
          else await mkdir(args.at(-1)!);
        }),
      ).rejects.toThrow("EXPORT_OUTPUT_INVALID");
      expect(await readdir(directory)).toEqual(["source.mp4"]);
    },
  );
  it("revalidates source identity when a target hardlink appears during encoding", async () => {
    const { source, directory } = await fixture();
    const destination = join(directory, "out-16x9.mp4");
    await expect(
      exportFilmFile(source, directory, "out", { aspectRatio: "16:9" }, async (args) => {
        await writeFile(args.at(-1)!, "encoded");
        await link(source, destination);
      }),
    ).rejects.toThrow("EXPORT_SOURCE_OVERWRITE");
    expect(await readFile(source, "utf8")).toBe("original video");
    expect(await readFile(destination)).toEqual(await readFile(source));
    expect((await readdir(directory)).some((name) => name.startsWith(".aivora-export"))).toBe(
      false,
    );
  });
});
