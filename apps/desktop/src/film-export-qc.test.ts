import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  copyFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, delimiter, isAbsolute, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFilmExportQc, qcInput } from "./film-export-qc";
import { loadQcEngine, verifiedQcTools } from "./film-export-qc-runtime";
import type { FilmExportQcInput } from "@aijian/contracts/film-export-qc";
import type { FilmRecord } from "./film-library";
function tool(name: string) {
  const binary = process.platform === "win32" ? `${name}.exe` : name;
  const explicit = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(root, binary);
    if (existsSync(path)) return path;
  }
  throw new Error("Pinned test tool unavailable");
}
const ffmpeg = tool("ffmpeg");
const lock = resolve(
  "../../config",
  process.platform === "win32"
    ? "media-toolchain-lock.json"
    : "draft-media-toolchain-linux-dev-lock.json",
);
const run = promisify(execFile),
  roots: string[] = [];
const projectId = `film_${"a".repeat(16)}`,
  seriesId = `film_${"b".repeat(16)}`;
const input: FilmExportQcInput = {
  projectId,
  expectedSelection: [{ shotId: "shot-one", takeId: "take-one" }],
  settings: {
    aspects: ["16:9", "9:16"],
    quality: "720p",
    subtitles: "none",
    style: "white",
    aiMark: true,
  },
};
async function fixture(loud = false) {
  const root = await mkdtemp(join(tmpdir(), "film-qc-"));
  roots.push(root);
  const films = join(root, "films"),
    story = join(root, "story"),
    series = join(films, seriesId),
    output = join(root, "output");
  await Promise.all([mkdir(series, { recursive: true }), mkdir(story), mkdir(output)]);
  const episode = join(series, "episodes", projectId, "media");
  await mkdir(episode, { recursive: true });
  const source = join(episode, "source.mp4");
  await run(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=24:duration=0.6",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(loud ? ["-af", "volume=8"] : []),
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  let record: FilmRecord = {
    id: projectId,
    seriesId,
    title: "离线QC",
    episodeTitle: "第一集",
    shots: [
      {
        id: "shot-one",
        selectedTakeId: "take-one",
        line: "",
        takes: [{ id: "take-one", shotId: "shot-one", status: "done", videoPath: source }],
      },
    ],
  };
  const picker = vi.fn(async () => output),
    tools = vi.fn(() => verifiedQcTools(dirname(ffmpeg), lock));
  const host = {
    filmsRoot: films,
    storyFilmsRoot: story,
    temporaryRoot: join(root, "staging"),
    read: async () => record,
    tools,
    engine: () => loadQcEngine(resolve("../../packages/aivora-qc")),
    font: () => resolve("../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf"),
    pickDirectory: picker,
  };
  const qc = createFilmExportQc(host);
  return {
    root,
    source,
    output,
    picker,
    tools,
    qc,
    host,
    record: () => record,
    setRecord: (next: FilmRecord) => {
      record = next;
    },
  };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe("trusted checked export", () => {
  it("checks actual two-aspect staged video before publication and keeps original bytes", async () => {
    const f = await fixture(),
      original = await readFile(f.source);
    const ready = await f.qc.prepare("owner", input);
    expect(ready.kind).toBe("READY");
    if (ready.kind !== "READY") throw new Error("ready required");
    expect(f.picker).not.toHaveBeenCalled();
    expect(await readdir(f.output)).toEqual([]);
    expect(ready.outputs.map((o) => (o.report as { schemaVersion: number }).schemaVersion)).toEqual(
      [1, 1],
    );
    expect(
      ready.outputs.map((o) => (o.report as { media: { width: number; height: number } }).media),
    ).toEqual([
      expect.objectContaining({ width: 1280, height: 720 }),
      expect.objectContaining({ width: 720, height: 1280 }),
    ]);
    expect(ready.unverified.join()).toContain("未检查");
    expect(JSON.stringify(ready)).not.toContain(f.root);
    const published = await f.qc.publish("owner", { ...input, qcReceipt: ready.qcReceipt });
    expect(published.kind).toBe("PUBLISHED");
    if (published.kind !== "PUBLISHED") throw new Error("published required");
    expect(published.outputs).toHaveLength(2);
    expect(await readFile(f.source)).toEqual(original);
    expect(await f.qc.publish("owner", { ...input, qcReceipt: ready.qcReceipt })).toEqual({
      kind: "FAILED",
      code: "RECEIPT_STALE",
    });
  }, 30000);
  it("refuses project fallback, missing selection and foreign film paths before tool execution", async () => {
    const f = await fixture();
    const base = structuredClone(f.record());
    f.setRecord({ ...base, id: seriesId });
    expect(await f.qc.prepare("owner", input)).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    f.setRecord(base);
    expect(
      await f.qc.prepare("owner", {
        ...input,
        expectedSelection: [{ shotId: "shot-one", takeId: "other" }],
      }),
    ).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    const foreign = join(f.root, "foreign.mp4");
    await copyFile(f.source, foreign);
    const changed = structuredClone(base);
    (changed.shots![0] as { takes: { videoPath: string }[] }).takes[0]!.videoPath = foreign;
    f.setRecord(changed);
    expect((await f.qc.prepare("owner", input)).kind).toBe("FAILED");
    expect(f.tools).not.toHaveBeenCalled();
  }, 10000);
  it("rejects changed selected version, settings and owner without publishing", async () => {
    const f = await fixture();
    const ready = await f.qc.prepare("owner", {
      ...input,
      settings: { ...input.settings, aspects: ["16:9"] },
    });
    if (ready.kind !== "READY") throw new Error("ready required");
    const request = {
      ...input,
      settings: { ...input.settings, aspects: ["16:9"] as ("16:9" | "9:16")[] },
      qcReceipt: ready.qcReceipt,
    };
    expect(await f.qc.publish("other", request)).toEqual({ kind: "FAILED", code: "RECEIPT_STALE" });
    expect(
      await f.qc.publish("owner", {
        ...request,
        settings: { ...request.settings, quality: "1080p" },
      }),
    ).toEqual({ kind: "FAILED", code: "RECEIPT_STALE" });
    const record = structuredClone(f.record());
    (record.shots![0] as { selectedTakeId: string }).selectedTakeId = "replacement";
    f.setRecord(record);
    expect(await f.qc.publish("owner", request)).toEqual({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
    });
    expect(f.picker).not.toHaveBeenCalled();
    expect(await readdir(f.output)).toEqual([]);
  }, 30000);
  it("refuses renderer execution paths and unknown settings", () => {
    expect(() => qcInput({ ...input, path: "/tmp/arbitrary.mp4" })).toThrow("INVALID_INPUT");
    expect(() =>
      qcInput({ ...input, settings: { ...input.settings, ffmpegPath: "/bin/sh" } }),
    ).toThrow("INVALID_INPUT");
  });
});

describe("checked publication ownership and lifecycle", () => {
  it("blocks both outputs using original true-peak rules and rejects an aspect-only bypass", async () => {
    const f = await fixture(true);
    const ready = await f.qc.prepare("owner", input);
    if (ready.kind !== "READY") throw new Error(JSON.stringify(ready));
    expect(
      ready.outputs.some((output) =>
        (output.report as { issues: { severity: string }[] }).issues.some(
          (issue) => issue.severity === "block",
        ),
      ),
    ).toBe(true);
    expect(await f.qc.publish("owner", { ...input, qcReceipt: ready.qcReceipt })).toEqual({
      kind: "FAILED",
      code: "QC_BLOCKED",
    });
    expect(
      await f.qc.publish("owner", {
        ...input,
        settings: { ...input.settings, aspects: ["16:9"] },
        qcReceipt: ready.qcReceipt,
      }),
    ).toEqual({ kind: "FAILED", code: "RECEIPT_STALE" });
    expect(f.picker).not.toHaveBeenCalled();
  }, 30000);
  it("refuses shared legacy and foreign-episode video rather than guessing project ownership", async () => {
    const f = await fixture(),
      base = structuredClone(f.record());
    const take = (record: FilmRecord) =>
      (record.shots![0] as { takes: { videoPath: string }[] }).takes[0]!;
    for (const path of [
      join(f.host.filmsRoot, seriesId, "legacy.mp4"),
      join(f.host.storyFilmsRoot, "foreign.mp4"),
    ]) {
      await copyFile(f.source, path);
      const record = structuredClone(base);
      take(record).videoPath = path;
      f.setRecord(record);
      expect(await f.qc.prepare("owner", input)).toEqual({
        kind: "FAILED",
        code: "SOURCE_UNVERIFIED",
      });
    }
    expect(f.tools).not.toHaveBeenCalled();
  }, 10000);
  it.each([0, 1200])(
    "does not allow a duplicate prepare and cleans staged media after a changed record or disposal (engine startup %ims)",
    async (startupMs) => {
      const f = await fixture();
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const engine = await loadQcEngine(resolve("../../packages/aivora-qc"));
      let engineEntered = false;
      const gate = vi.fn(async () => {
        if (startupMs) await new Promise((resolve) => setTimeout(resolve, startupMs));
        engineEntered = true;
        entered();
        await wait;
        return engine;
      });
      const qc = createFilmExportQc({ ...f.host, engine: gate });
      const pending = qc.prepare("owner", input);
      try {
        // The existing 30s media-test deadline bounds real preparation. A default
        // 1s polling expectation is not an engine-start/ownership guarantee.
        await Promise.race([
          started,
          pending.then((result) => {
            if (engineEntered) return;
            const code = result.kind === "FAILED" ? result.code : result.kind;
            const safe = /^[A-Z_]+$/.test(code) ? code : "UNKNOWN";
            console.error(`::error title=QC fixture start::prepareEndedBeforeEngine=${safe}`);
            throw new Error(
              `PREPARE_ENDED_BEFORE_ENGINE:${result.kind === "FAILED" ? result.code : result.kind}`,
            );
          }),
        ]);
        expect(await qc.prepare("owner", input)).toEqual({ kind: "FAILED", code: "BUSY" });
        const changed = structuredClone(f.record());
        changed.title = "后来修改";
        f.setRecord(changed);
        release();
        expect(await pending).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
        const ready = await f.qc.prepare("owner", input);
        if (ready.kind !== "READY") throw new Error(JSON.stringify(ready));
        await f.qc.dispose("owner");
        expect(await f.qc.publish("owner", { ...input, qcReceipt: ready.qcReceipt })).toEqual({
          kind: "FAILED",
          code: "RECEIPT_STALE",
        });
        expect(await readdir(f.host.temporaryRoot)).toEqual([]);
      } finally {
        release();
        await pending.catch(() => undefined);
        await qc.dispose("owner");
      }
    },
    30000,
  );
  it("rejects tampered checked video and all checked sidecar bytes", async () => {
    const f = await fixture();
    const record = structuredClone(f.record());
    const take = (
      record.shots![0] as {
        line: string;
        takes: {
          cleanVideoPath?: string;
          subtitleCues?: { text: string; start: number; end: number }[];
        }[];
      }
    ).takes[0]!;
    take.cleanVideoPath = f.source;
    take.subtitleCues = [{ text: "测试字幕", start: 0, end: 0.3 }];
    f.setRecord(record);
    const request = {
      ...input,
      settings: {
        ...input.settings,
        subtitles: "srt" as const,
        aspects: ["16:9"] as ("16:9" | "9:16")[],
      },
    };
    for (const file of ["film-16x9.mp4", "film-16x9.srt", "film-16x9-封面.png"]) {
      const ready = await f.qc.prepare("owner", request);
      if (ready.kind !== "READY") throw new Error(JSON.stringify(ready));
      const directories = await readdir(f.host.temporaryRoot);
      const folder = join(f.host.temporaryRoot, directories[0]!, "16x9");
      await writeFile(join(folder, file), "tampered");
      expect(await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt })).toEqual({
        kind: "FAILED",
        code: "RECEIPT_STALE",
      });
      expect(await readdir(f.output)).toEqual([]);
    }
  }, 30000);
  it.each(["mp4", "srt", "cover"])(
    "publishes without overwriting a pre-existing %s file",
    async (kind) => {
      const f = await fixture();
      const record = structuredClone(f.record());
      const take = (
        record.shots![0] as {
          takes: {
            cleanVideoPath?: string;
            subtitleCues?: { text: string; start: number; end: number }[];
          }[];
        }
      ).takes[0]!;
      take.cleanVideoPath = f.source;
      take.subtitleCues = [{ text: "字幕", start: 0, end: 0.3 }];
      f.setRecord(record);
      const request = {
        ...input,
        settings: {
          ...input.settings,
          subtitles: "srt" as const,
          aspects: ["16:9"] as ("16:9" | "9:16")[],
        },
      };
      const ready = await f.qc.prepare("owner", request);
      if (ready.kind !== "READY") throw new Error(JSON.stringify(ready));
      const stem = `${ready.fileName.replace(/\.mp4$/i, "")}-${ready.qcReceipt.slice(0, 8)}-16x9`;
      const path = join(
        f.output,
        kind === "mp4" ? `${stem}.mp4` : kind === "srt" ? `${stem}.srt` : `${stem}-封面.png`,
      );
      await writeFile(path, "original user bytes");
      const result = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
      expect(result.kind).toBe(kind === "mp4" ? "FAILED" : "PARTIAL");
      expect(await readFile(path, "utf8")).toBe("original user bytes");
      if (result.kind === "PARTIAL")
        expect(result.outputs[0]).not.toHaveProperty(kind === "srt" ? "subtitlePath" : "coverPath");
    },
    30000,
  );
});

it("rejects same-series episode aliases and series junction escape against the canonical library root", async () => {
  const f = await fixture(),
    base = structuredClone(f.record());
  const shot = (record: FilmRecord) =>
    (record.shots![0] as { takes: { videoPath: string }[] }).takes[0]!;
  const other = join(f.host.filmsRoot, seriesId, "episodes", `film_${"c".repeat(16)}`);
  await mkdir(other, { recursive: true });
  const foreign = join(other, "foreign.mp4");
  await copyFile(f.source, foreign);
  const alias = join(f.host.filmsRoot, seriesId, "episodes", projectId, "linked");
  await symlink(other, alias, process.platform === "win32" ? "junction" : "dir");
  let changed = structuredClone(base);
  shot(changed).videoPath = join(alias, "foreign.mp4");
  f.setRecord(changed);
  expect(await f.qc.prepare("owner", input)).toEqual({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
  const foreignSeries = join(f.root, "external-series");
  await mkdir(join(foreignSeries, "episodes", projectId), { recursive: true });
  const otherSource = join(foreignSeries, "episodes", projectId, "source.mp4");
  await copyFile(f.source, otherSource);
  const aliasedId = `film_${"d".repeat(16)}`;
  await symlink(
    foreignSeries,
    join(f.host.filmsRoot, aliasedId),
    process.platform === "win32" ? "junction" : "dir",
  );
  changed = structuredClone(base);
  changed.seriesId = aliasedId;
  shot(changed).videoPath = otherSource;
  f.setRecord(changed);
  expect(await f.qc.prepare("owner", input)).toEqual({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
  expect(f.tools).not.toHaveBeenCalled();
}, 10000);

it("invalidates a publishing receipt when its sender closes during the native folder picker", async () => {
  const f = await fixture();
  const request = {
    ...input,
    settings: { ...input.settings, aspects: ["16:9"] as ("16:9" | "9:16")[] },
  };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error(JSON.stringify(ready));
  let release!: (value: string) => void;
  f.picker.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const publishing = f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await f.qc.dispose("owner");
  release(f.output);
  expect(await publishing).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect(await readdir(f.output)).toEqual([]);
  expect(await readdir(f.host.temporaryRoot)).toEqual([]);
}, 30000);
