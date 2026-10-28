import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  deleteProject,
  bundledFfmpeg,
  importMusicFile,
  joinClips,
  mixMusic,
  musicMixArgs,
  listEpisodes,
  listSeries,
  readProject,
  renameSeries,
  requestStill,
  safeExportName,
  trustedMediaPath,
  writeProject,
} from "./film-library";

const series = "film_series0000000001";
const first = "film_episode000000001";
const second = "film_episode000000002";
const otherSeries = "film_series0000000002";
const otherEpisode = "film_episode000000003";

function film(id: string, seriesId: string, no: number) {
  return {
    id,
    seriesId,
    title: "雨夜",
    seriesTitle: "雨夜",
    episodeNo: no,
    episodeTitle: `第 ${no} 集`,
    shots: [{ id: "s", takes: [{ status: no === 1 ? "done" : "queued", videoUrl: "blob:local" }] }],
    assemblyUrl: "blob:cut",
  };
}

describe("film library", () => {
  it("keeps two episodes on disk, then deletes one and the series", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    await writeProject(root, film(first, series, 1));
    await writeProject(root, film(second, series, 2));
    await writeProject(root, film(otherEpisode, otherSeries, 1));
    expect(await listSeries(root)).toHaveLength(2);
    expect((await listEpisodes(root, series)).map((item) => item.no)).toEqual([1, 2]);
    const stored = await readProject(root, first);
    expect(stored?.directory).toBe(join(root, series));
    expect(JSON.stringify(stored)).not.toContain("blob:");
    await deleteProject(root, second);
    expect(await listEpisodes(root, series)).toHaveLength(1);
    await deleteProject(root, series);
    expect(await listSeries(root)).toHaveLength(1);
    expect(await readProject(root, first)).toBeNull();
  });

  it("renames a series and ignores an empty name", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    await writeProject(root, film(first, series, 1));
    await renameSeries(root, series, "  新名字  ");
    expect((await listSeries(root))[0]?.title).toBe("新名字");
    expect((await readProject(root, first))?.seriesTitle).toBe("新名字");
    await renameSeries(root, series, "   ");
    expect((await listSeries(root))[0]?.title).toBe("新名字");
  });

  it("refuses to export the first shot when ffmpeg cannot join them", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    const a = join(root, "a.mp4");
    const b = join(root, "b.mp4");
    writeFileSync(a, Buffer.from("first-clip"));
    writeFileSync(b, Buffer.from("second-clip"));
    const destination = join(root, "out", "rough-cut.mp4");
    const run = vi.fn(async () => {
      throw new Error("ffmpeg failed");
    });
    await expect(joinClips([a, b], destination, run)).rejects.toThrow("没有导出");
  });

  it("joins every chosen shot and ducks imported music under dialogue", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    const a = join(root, "a.mp4");
    const b = join(root, "b.mp4");
    const music = join(root, "bed.mp3");
    writeFileSync(a, Buffer.from("shot-a"));
    writeFileSync(b, Buffer.from("shot-b"));
    writeFileSync(music, Buffer.from("music"));
    const destination = join(root, "out", "rough-cut.mp4");
    const seen: string[][] = [];
    let listBody = "";
    const run = vi.fn(async (args: string[]) => {
      seen.push(args);
      const list = args.find((item) => item.endsWith(".txt"));
      if (list) listBody = readFileSync(list, "utf8");
      if (args.includes(destination)) writeFileSync(destination, Buffer.from("joined"));
      const mixed = args.at(-1);
      if (mixed && mixed.endsWith(".mix.mp4")) writeFileSync(mixed, Buffer.from("mixed-audio"));
    });
    const joined = await joinClips([a, b], destination, run);
    expect(await readFile(joined.path, "utf8")).toBe("joined");
    expect(listBody).toContain(a);
    expect(listBody).toContain(b);
    expect(seen[0]?.join(" ")).toContain("concat");
    const mix = musicMixArgs(destination, music, `${destination}.mix.mp4`).join(" ");
    expect(mix).toContain("sidechaincompress");
    expect(mix).toContain("normalize=0");
    expect(mix).toContain(music);
    const mixed = await mixMusic(destination, music, run, true);
    expect(mixed.path).toBe(destination);
    expect(await readFile(destination, "utf8")).toBe("mixed-audio");
    expect(listBody).toContain(b);
  });

  it("keeps a project that used to embed pictures", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    const huge = `data:image/png;base64,${"a".repeat(50_000)}`;
    const stored = await writeProject(root, {
      ...film(first, series, 1),
      shots: [{ id: "shot-1", poster: huge, takes: [] }],
    });
    const raw = await readFile(join(root, series, "episodes", first, "project.json"), "utf8");
    expect(raw.includes("data:image")).toBe(false);
    expect(stored.id).toBe(first);
  });

  it("refuses a still when there is no login and never invents one", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    const destination = join(root, "still.png");
    const fetcher = vi.fn();
    const missed = await requestStill({
      prompt: "巷口",
      token: null,
      fetcher,
      destination,
    });
    expect(missed).toEqual({ path: "", reason: "需要重新登录后再出图。" });
    expect(fetcher).not.toHaveBeenCalled();
    const fetcherOk = vi.fn(async () =>
      Response.json({ data: [{ b64_json: Buffer.from("png-bytes-ok").toString("base64") }] }),
    );
    const made = await requestStill({
      prompt: "巷口",
      token: "token",
      fetcher: fetcherOk,
      destination,
    });
    expect(made.path).toBe(destination);
    expect(made.reason).toBe("");
    expect(await readFile(destination, "utf8")).toBe("png-bytes-ok");
    const outside = join(root, "secret.mp4");
    writeFileSync(outside, Buffer.from("nope"));
    const films = join(root, "films");
    await mkdir(films);
    symlinkSync(outside, join(films, "escape.mp4"));
    expect(() => trustedMediaPath([films], join(films, "escape.mp4"))).toThrow("Invalid film path");
  });

  it("keeps Chinese in an export name and strips characters a folder cannot hold", () => {
    expect(safeExportName("雨夜重逢-第 1 集.mp4")).toBe("雨夜重逢-第1集.mp4");
    expect(safeExportName("巷口重逢-第1集.mp4")).toBe("巷口重逢-第1集.mp4");
    expect(safeExportName("巷口重逢-第1集")).toBe("巷口重逢-第1集.mp4");
    expect(safeExportName("巷口重逢:第1集?.mp4")).toBe("巷口重逢第1集.mp4");
    expect(safeExportName(`巷口${String.fromCharCode(0)}重逢.mp4`)).toBe("巷口重逢.mp4");
    expect(safeExportName("")).toBe("aivora-film.mp4");
  });

  it("copies an imported song into the series and only uses the bundled ffmpeg", async () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-films-"));
    const source = join(root, "song.mp3");
    writeFileSync(source, Buffer.from("song"));
    const copied = await importMusicFile(root, series, source);
    expect(await readFile(copied, "utf8")).toBe("song");
    const resources = mkdtempSync(join(tmpdir(), "aivora-resources-"));
    expect(() => bundledFfmpeg(resources, "win32")).toThrow("没有找到安装包里的 ffmpeg");
    const bin = join(resources, "media");
    await mkdir(bin, { recursive: true });
    writeFileSync(join(bin, "ffmpeg.exe"), Buffer.from("ffmpeg"));
    expect(bundledFfmpeg(resources, "win32")).toBe(join(bin, "ffmpeg.exe"));
    const packaged = mkdtempSync(join(tmpdir(), "aivora-linux-"));
    const linuxBin = join(packaged, "runtime", "electron");
    mkdirSync(join(packaged, "runtime", "ffmpeg", "bin"), { recursive: true });
    mkdirSync(linuxBin, { recursive: true });
    writeFileSync(join(packaged, "runtime", "ffmpeg", "bin", "ffmpeg"), Buffer.from("linux"));
    writeFileSync(join(linuxBin, "electron"), Buffer.from("app"));
    expect(bundledFfmpeg("", "linux", { execPath: join(linuxBin, "electron") })).toBe(
      join(packaged, "runtime", "ffmpeg", "bin", "ffmpeg"),
    );
  });
});
