import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { extractFilmLastFrame, type LastFrameHost } from "./film-last-frame";
const series = "film_abcdefghijklmnop";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aZasAAAAASUVORK5CYII=",
  "base64",
);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "last-frame-"));
  const source = join(root, "clip.mp4");
  await writeFile(source, "fixture");
  const host: LastFrameHost = {
    roots: [root],
    filmsRoot: root,
    probeDuration: vi.fn(async () => 1),
    runFfmpeg: vi.fn(async (args) => {
      await writeFile(args.at(-1)!, png);
    }),
  };
  return { root, source, host };
}
describe("local film last-frame extraction", () => {
  it("uses a trusted path, maps only video and leaves a durable PNG", async () => {
    const { root, source, host } = await fixture();
    const result = await extractFilmLastFrame(
      series,
      `aivora-media://local/?path=${encodeURIComponent(source)}`,
      host,
    );
    expect(result.sourceVideoPath).toBe(source);
    expect(result.path.startsWith(join(root, series, "stills"))).toBe(true);
    expect(await readFile(result.path)).toEqual(png);
    expect(vi.mocked(host.runFfmpeg).mock.calls[0]![0]).toContain("-update");
    expect(await readdir(dirname(result.path))).toHaveLength(1);
  });
  it("rejects remote/outside/nonvideo paths and invalid duration before decoding", async () => {
    const { source, host } = await fixture();
    for (const bad of [
      "https://example.test/clip.mp4",
      "/etc/passwd",
      source.replace("clip.mp4", "missing.mp4"),
    ])
      await expect(extractFilmLastFrame(series, bad, host)).rejects.toMatchObject({
        code: "CONTINUITY_VIDEO_INVALID",
      });
    for (const duration of [0, NaN, 61]) {
      host.probeDuration = vi.fn(async () => duration);
      await expect(extractFilmLastFrame(series, source, host)).rejects.toMatchObject({
        code: "CONTINUITY_DURATION_INVALID",
      });
    }
    expect(host.runFfmpeg).not.toHaveBeenCalled();
  });
  it("removes partial output when decoding fails or the owning project becomes stale", async () => {
    const { root, source, host } = await fixture();
    host.runFfmpeg = vi.fn(async (args) => {
      await writeFile(args.at(-1)!, png);
      throw new Error("decoder failure");
    });
    await expect(extractFilmLastFrame(series, source, host)).rejects.toMatchObject({
      code: "CONTINUITY_EXTRACTION_FAILED",
    });
    expect(await readdir(join(root, series, "stills"))).toEqual([]);
    let valid = true;
    host.current = () => valid;
    host.runFfmpeg = vi.fn(async (args) => {
      await writeFile(args.at(-1)!, png);
      valid = false;
    });
    await expect(extractFilmLastFrame(series, source, host)).rejects.toMatchObject({
      code: "CONTINUITY_REQUEST_STALE",
    });
    expect(await readdir(join(root, series, "stills"))).toEqual([]);
  });
  it("rejects a symlink escape for the output directory", async () => {
    const { root, source, host } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "last-frame-outside-"));
    await mkdir(join(root, series));
    await symlink(outside, join(root, series, "stills"), "junction");
    await expect(extractFilmLastFrame(series, source, host)).rejects.toMatchObject({
      code: "CONTINUITY_DESTINATION_INVALID",
    });
    expect(host.runFfmpeg).not.toHaveBeenCalled();
  });
  it("rejects an escaping series junction before creating any external stills directory", async () => {
    const { root, source, host } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "last-frame-series-outside-"));
    // Directory junctions work on Windows without the file-symlink developer privilege.
    await symlink(outside, join(root, series), "junction");
    expect(await readdir(outside)).toEqual([]);
    await expect(extractFilmLastFrame(series, source, host)).rejects.toMatchObject({
      code: "CONTINUITY_DESTINATION_INVALID",
    });
    expect(await readdir(outside)).toEqual([]);
    expect(existsSync(join(outside, "stills"))).toBe(false);
    expect(host.runFfmpeg).not.toHaveBeenCalled();
  });
  const ffmpeg = process.env.AIVORA_FFMPEG || "/usr/bin/ffmpeg";
  it.skipIf(!existsSync(ffmpeg))(
    "matches the final decoded pixel frame of an actual short video",
    async () => {
      const { source, host } = await fixture();
      execFileSync(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=32x32:rate=5:duration=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        source,
      ]);
      host.runFfmpeg = async (args) => {
        execFileSync(ffmpeg, args);
      };
      const result = await extractFilmLastFrame(series, source, host);
      const raw = execFileSync(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      const extracted = execFileSync(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        result.path,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      expect(extracted).toEqual(raw.subarray(raw.length - 32 * 32 * 3));
      expect(extracted).not.toEqual(raw.subarray(0, 32 * 32 * 3));
    },
  );
});
