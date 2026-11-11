import type { writeDeliveryManifest } from "./film-delivery-manifest";
import { createHash } from "node:crypto";
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
import { basename, dirname, delimiter, isAbsolute, join, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFilmExportQc, qcInput } from "./film-export-qc";
import { readStoredAudioDecision } from "./film-export-record";
import { loadQcEngine, verifiedQcTools } from "./film-export-qc-runtime";
import type { FilmExportQcInput } from "@aijian/contracts/film-export-qc";
import type { FilmRecord } from "./film-library";
const evidenceFault = vi.hoisted(() => ({
  mode: "none" as "none" | "collision" | "changed" | "cleanup",
}));
const linkFault = vi.hoisted(() => ({ eexist: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { rm: typeof rm }>();
  const linkFile = actual.link as (from: string, to: string) => Promise<void>;
  return {
    ...actual,
    rm: async (...args: Parameters<typeof rm>) => {
      if (evidenceFault.mode === "cleanup" && String(args[0]).includes(".aivora-delivery-"))
        throw new Error("controlled cleanup denial");
      return actual.rm(...args);
    },
    link: async (from: string, to: string) => {
      if (linkFault.eexist > 0) {
        linkFault.eexist -= 1;
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      return linkFile(from, to);
    },
  };
});
vi.mock("./film-delivery-manifest", async (importOriginal) => {
  const actual = await importOriginal<{ writeDeliveryManifest: typeof writeDeliveryManifest }>();
  return {
    ...actual,
    writeDeliveryManifest: (input: Parameters<typeof writeDeliveryManifest>[0]) =>
      evidenceFault.mode === "none"
        ? actual.writeDeliveryManifest(input)
        : actual.writeDeliveryManifest(input, () => {
            if (evidenceFault.mode === "changed")
              writeFileSync(input.published[0]!.path, "changed exported video bytes");
            return "11111111-1111-4111-8111-111111111111";
          }),
  };
});
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
  evidenceFault.mode = "none";
  linkFault.eexist = 0;
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
    expect(published.deliveryEvidence?.kind).toBe("WRITTEN");
    if (published.deliveryEvidence?.kind !== "WRITTEN")
      throw new Error("written evidence required");
    const delivered = published.deliveryEvidence;
    const document = await readFile(join(f.output, delivered.fileName));
    expect(createHash("sha256").update(document).digest("hex")).toBe(delivered.manifestSha256);
    expect(JSON.parse(document.toString())).toEqual(delivered.manifest);
    const expectedNames = published.outputs.flatMap((item) =>
      [item.path, item.subtitlePath, item.coverPath]
        .filter((path): path is string => !!path)
        .map((path) => basename(path)),
    );
    expect(delivered.manifest.files.map((item) => item.fileName)).toEqual(expectedNames);
    expect(
      delivered.manifest.files
        .filter((item) => item.role === "video")
        .map((item) => item.technical?.video),
    ).toEqual([
      expect.objectContaining({ width: 1280, height: 720, averageFrameRate: 24 }),
      expect.objectContaining({ width: 720, height: 1280, averageFrameRate: 24 }),
    ]);
    for (const item of delivered.manifest.files) {
      const bytes = await readFile(join(f.output, item.fileName));
      expect(bytes.length).toBe(item.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
    }
    expect(JSON.stringify(delivered)).not.toContain(f.root);
    expect(JSON.stringify(delivered)).not.toContain(ready.qcReceipt);
    expect(delivered.manifest.unverified.join()).toContain("未检查");

    expect(delivered.manifest.audioDecision).toBeUndefined();
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
      const stem = ready.fileName.replace(/\.mp4$/i, "");
      const path = join(
        f.output,
        kind === "mp4" ? `${stem}.mp4` : kind === "srt" ? `${stem}.srt` : `${stem}-封面.png`,
      );
      await writeFile(path, "original user bytes");
      const result = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
      expect(result.kind).toBe("PUBLISHED");
      if (result.kind !== "PUBLISHED") throw new Error("numbered publish required");
      expect(await readFile(path, "utf8")).toBe("original user bytes");
      expect(basename(result.outputs[0]!.path)).toBe(`${stem}-2.mp4`);
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

it.each(["collision", "changed"] as const)(
  "retains actual outputs but never reports complete delivery when evidence %s fails",
  async (mode) => {
    const f = await fixture(),
      source = await readFile(f.source);
    const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
    const ready = await f.qc.prepare("owner", request);
    if (ready.kind !== "READY") throw new Error("ready required");
    const name = "aivora-delivery-11111111-1111-4111-8111-111111111111.json";
    if (mode === "collision") await writeFile(join(f.output, name), "original user evidence");
    evidenceFault.mode = mode;
    const result = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
    expect(result.kind).toBe("PARTIAL");
    if (result.kind !== "PARTIAL") throw new Error("partial result required");
    expect(result.outputs).toHaveLength(1);
    expect(result.deliveryEvidence).toMatchObject({
      kind: "FAILED",
      code: mode === "collision" ? "EVIDENCE_WRITE_FAILED" : "EVIDENCE_UNAVAILABLE",
    });
    if (result.deliveryEvidence?.kind !== "FAILED") throw new Error("failed evidence required");
    expect(result.deliveryEvidence.files.some((item) => item.role === "video")).toBe(true);
    expect(JSON.stringify(result.deliveryEvidence)).not.toContain(f.root);
    if (mode === "collision")
      expect(await readFile(join(f.output, name), "utf8")).toBe("original user evidence");
    else expect((await readdir(f.output)).filter((name) => name.endsWith(".json"))).toEqual([]);
    expect(await readFile(f.source)).toEqual(source);
    expect(await readdir(f.host.temporaryRoot)).toEqual([]);
    expect(await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt })).toEqual({
      kind: "FAILED",
      code: "RECEIPT_STALE",
    });
  },
  30000,
);

it("preserves a hash-verified public manifest while reporting cleanup as a partial result", async () => {
  const f = await fixture(),
    original = await readFile(f.source);
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error("ready required");
  evidenceFault.mode = "cleanup";
  const result = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  expect(result.kind).toBe("PARTIAL");
  if (result.kind !== "PARTIAL" || result.deliveryEvidence?.kind !== "WRITTEN")
    throw new Error("written partial fact required");
  const evidence = result.deliveryEvidence;
  expect(evidence.cleanupUnconfirmed).toBe(true);
  expect(evidence.manifest.status).toBe("complete");
  const bytes = await readFile(join(f.output, evidence.fileName));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(evidence.manifestSha256);
  expect(JSON.parse(bytes.toString())).toEqual(evidence.manifest);
  expect(
    (await readdir(f.output)).filter((name) => name.startsWith(".aivora-delivery-")),
  ).toHaveLength(1);
  expect(await readFile(f.source)).toEqual(original);
  expect(await readdir(f.host.temporaryRoot)).toEqual([]);
}, 30000);

type ProbeStream = {
  codec_type: string;
  codec_name: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
};
async function streamsOf(path: string) {
  const probe = JSON.parse(
    (
      await run(tool("ffprobe"), [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,duration,sample_rate,channels",
        "-of",
        "json",
        path,
      ])
    ).stdout,
  ) as { streams: ProbeStream[] };
  return probe.streams;
}
async function assertSilentAac(path: string) {
  const streams = await streamsOf(path);
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  const picture = streams.find((stream) => stream.codec_type === "video");
  expect(audio).toHaveLength(1);
  expect(audio[0]).toMatchObject({ codec_name: "aac", sample_rate: "48000", channels: 2 });
  expect(picture?.duration).toBeTruthy();
  expect(Number(audio[0]!.duration)).toBeCloseTo(Number(picture!.duration), 1);
  const detected = await run(ffmpeg, [
    "-v",
    "info",
    "-i",
    path,
    "-map",
    "0:a:0",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const mean = Number(detected.stderr.match(/mean_volume:\s+(-?\d+(?:\.\d+)?) dB/)?.[1]);
  const peak = Number(detected.stderr.match(/max_volume:\s+(-?\d+(?:\.\d+)?) dB/)?.[1]);
  expect(peak).toBeLessThanOrEqual(-90);
  expect(mean).toBe(peak);
}

it("writes one silent AAC track for an explicit silent film and keeps the decision on the record", async () => {
  const f = await fixture();
  f.setRecord({ ...f.record(), audioDecision: "SILENT_BY_USER" });
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw new Error("ready required");
  const published = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  expect(published.kind).toBe("PUBLISHED");
  if (published.kind !== "PUBLISHED" || published.deliveryEvidence?.kind !== "WRITTEN")
    throw new Error("published required");
  expect(published.deliveryEvidence.manifest.audioDecision).toBe("SILENT_BY_USER");
  expect(published.deliveryEvidence.manifest).not.toHaveProperty("durationToleranceSeconds");
  await assertSilentAac(published.outputs[0]!.path);
  const shown = published.deliveryEvidence.manifest.files.find((file) => file.role === "video");
  expect(shown?.technical?.durationSeconds).toBeGreaterThan(0);
}, 30000);

it("writes a silent AAC track for both aspects in one export", async () => {
  const f = await fixture();
  f.setRecord({ ...f.record(), audioDecision: "SILENT_BY_USER" });
  const ready = await f.qc.prepare("owner", input);
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw new Error("ready required");
  expect(ready.outputs.map((output) => output.aspectRatio)).toEqual(["16:9", "9:16"]);
  const published = await f.qc.publish("owner", { ...input, qcReceipt: ready.qcReceipt });
  if (published.kind !== "PUBLISHED") throw new Error("published required");
  expect(published.outputs.map((output) => output.aspectRatio)).toEqual(["16:9", "9:16"]);
  for (const output of published.outputs) await assertSilentAac(output.path);
}, 30000);

it("replaces a source with more than two channels instead of rejecting the silent export", async () => {
  const f = await fixture();
  await run(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=24:duration=0.4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.4",
    "-filter_complex",
    "[1:a]pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0[a]",
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    f.source,
  ]);
  f.setRecord({ ...f.record(), audioDecision: "WITH_AUDIO" });
  expect(
    await f.qc.prepare("owner", {
      ...input,
      settings: { ...input.settings, aspects: ["16:9"] },
    }),
  ).toEqual({ kind: "FAILED", code: "UNSUPPORTED_AUDIO_CHANNELS" });
  f.setRecord({ ...f.record(), audioDecision: "SILENT_BY_USER" });
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw new Error("ready required");
  const published = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  if (published.kind !== "PUBLISHED") throw new Error("published required");
  await assertSilentAac(published.outputs[0]!.path);
}, 30000);

it("keeps the existing mixed track when the user chose audio", async () => {
  const f = await fixture();
  f.setRecord({ ...f.record(), audioDecision: "WITH_AUDIO" });
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error("ready required");
  const published = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  if (published.kind !== "PUBLISHED" || published.deliveryEvidence?.kind !== "WRITTEN")
    throw new Error("published required");
  expect(published.deliveryEvidence.manifest.audioDecision).toBe("WITH_AUDIO");
  const streams = await streamsOf(published.outputs[0]!.path);
  expect(streams.filter((stream) => stream.codec_type === "audio")).toHaveLength(1);
  expect(streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe("aac");
  const detected = await run(ffmpeg, [
    "-v",
    "info",
    "-i",
    published.outputs[0]!.path,
    "-map",
    "0:a:0",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  expect(detected.stderr).not.toMatch(/max_volume:\s+-inf dB/);
}, 30000);

it("blocks export of a stale clip and has no confirm-and-export field", async () => {
  const f = await fixture();
  f.setRecord({
    ...f.record(),
    audioClips: [
      {
        id: "old-clip",
        lane: "voice",
        shotId: "shot-one",
        takeId: "previous",
        label: "旧配音",
        startSeconds: 0,
        durationSeconds: 0.2,
        offsetSeconds: 0,
        gainDb: 0,
        path: "media/old.wav",
      },
    ],
  });
  expect(await f.qc.prepare("owner", input)).toEqual({ kind: "FAILED", code: "MATERIALS_STALE" });
  const scene = await fixture();
  scene.setRecord({
    ...scene.record(),
    audioDecision: "SILENT_BY_USER",
    audioClips: [
      {
        id: "scene-clip",
        lane: "ambience",
        shotId: "shot-one",
        takeId: "take-one",
        label: "环境",
        startSeconds: 0,
        durationSeconds: 0.2,
        offsetSeconds: 0,
        gainDb: -6,
        path: "media/rain.wav",
        sceneAudioBinding: { schemaVersion: 1 },
      },
    ] as FilmRecord["audioClips"],
  });
  expect(await scene.qc.prepare("owner", input)).toEqual({
    kind: "FAILED",
    code: "MATERIALS_STALE",
  });
  const broken = await fixture();
  broken.setRecord({ ...broken.record(), audioDecision: "QUIET" as "SILENT_BY_USER" });
  expect(await broken.qc.prepare("owner", input)).toEqual({
    kind: "FAILED",
    code: "AUDIO_DECISION_INVALID",
  });
  expect(await readdir(f.output)).toEqual([]);
  expect(() => qcInput({ ...input, confirmStaleExport: true } as FilmExportQcInput)).toThrow(
    "INVALID_INPUT",
  );
  expect(readStoredAudioDecision({})).toBeUndefined();
  expect(readStoredAudioDecision({ audioDecision: "SILENT_BY_USER" })).toBe("SILENT_BY_USER");
  expect(() => readStoredAudioDecision({ audioDecision: "QUIET" })).toThrow(
    "INVALID_AUDIO_DECISION",
  );
});

it("echoes the cleaned requested file name on the check and the published path", async () => {
  const f = await fixture();
  const named = { ...input, requestedFileName: "雨夜:重逢?.mp4" };
  const ready = await f.qc.prepare("owner", named);
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw new Error(JSON.stringify(ready));
  expect(ready.fileName).toBe("雨夜重逢.mp4");
  const published = await f.qc.publish("owner", { ...named, qcReceipt: ready.qcReceipt });
  if (published.kind !== "PUBLISHED") throw new Error(JSON.stringify(published));
  expect(published.outputs.map((output) => basename(output.path)).sort()).toEqual([
    "雨夜重逢-16x9.mp4",
    "雨夜重逢-9x16.mp4",
  ]);
  const again = await f.qc.prepare("owner", { ...input, requestedFileName: "???" });
  expect(again).toEqual({ kind: "FAILED", code: "EXPORT_NAME_INVALID" });
  const fallback = await f.qc.prepare("owner", {
    ...input,
    settings: { ...input.settings, aspects: ["16:9" as const] },
  });
  if (fallback.kind !== "READY") throw new Error("fallback required");
  expect(fallback.fileName).toBe("离线QC-第一集.mp4");
  expect(() => qcInput({ ...input, requestedFileName: 1 })).toThrow("INVALID_INPUT");
}, 30000);

it("numbers the second and third default export without touching the first file", async () => {
  const f = await fixture();
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const publish = async () => {
    const ready = await f.qc.prepare("owner", request);
    if (ready.kind !== "READY") throw new Error("check required");
    const result = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
    if (result.kind !== "PUBLISHED") throw new Error(JSON.stringify(result));
    return result;
  };
  const first = await publish();
  const original = await readFile(first.outputs[0]!.path);
  const second = await publish();
  const third = await publish();
  expect(basename(first.outputs[0]!.path)).toBe("离线QC-第一集.mp4");
  expect(basename(second.outputs[0]!.path)).toBe("离线QC-第一集-2.mp4");
  expect(basename(third.outputs[0]!.path)).toBe("离线QC-第一集-3.mp4");
  expect(await readFile(first.outputs[0]!.path)).toEqual(original);
}, 30000);

it("uses one sequence number for both aspects when the default name is taken", async () => {
  const f = await fixture();
  const ready = await f.qc.prepare("owner", input);
  if (ready.kind !== "READY") throw new Error("ready required");
  const stem = ready.fileName.replace(/\.mp4$/i, "");
  await writeFile(join(f.output, `${stem}-9x16.mp4`), "already there");
  const published = await f.qc.publish("owner", { ...input, qcReceipt: ready.qcReceipt });
  expect(published.kind).toBe("PUBLISHED");
  if (published.kind !== "PUBLISHED") throw new Error(JSON.stringify(published));
  expect(published.outputs.map((output) => basename(output.path)).sort()).toEqual([
    `${stem}-2-16x9.mp4`,
    `${stem}-2-9x16.mp4`,
  ]);
  expect(await readFile(join(f.output, `${stem}-9x16.mp4`), "utf8")).toBe("already there");
  expect((await readdir(f.output)).includes(`${stem}-16x9.mp4`)).toBe(false);
}, 30000);

it("treats a different-cased default name as taken and writes the next number", async () => {
  const f = await fixture();
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error("ready required");
  await writeFile(join(f.output, ready.fileName.toLowerCase()), "lower case original");
  const published = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  expect(published.kind).toBe("PUBLISHED");
  if (published.kind !== "PUBLISHED") throw new Error(JSON.stringify(published));
  expect(basename(published.outputs[0]!.path)).toBe(
    `${ready.fileName.replace(/\.mp4$/i, "")}-2.mp4`,
  );
  expect(await readFile(join(f.output, ready.fileName.toLowerCase()), "utf8")).toBe(
    "lower case original",
  );
}, 30000);

it("rejects an edited name that is already taken and keeps the receipt", async () => {
  const f = await fixture();
  const request = {
    ...input,
    requestedFileName: "成片终稿",
    settings: { ...input.settings, aspects: ["16:9" as const] },
  };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error("ready required");
  expect(ready.fileName).toBe("成片终稿.mp4");
  await writeFile(join(f.output, "成片终稿.mp4"), "keep me");
  expect(await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt })).toEqual({
    kind: "FAILED",
    code: "EXPORT_NAME_TAKEN",
  });
  expect(await readFile(join(f.output, "成片终稿.mp4"), "utf8")).toBe("keep me");
  const elsewhere = join(f.root, "elsewhere");
  await mkdir(elsewhere);
  f.picker.mockResolvedValue(elsewhere);
  const moved = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  expect(moved.kind).toBe("PUBLISHED");
  if (moved.kind !== "PUBLISHED") throw new Error("republish required");
  expect(basename(moved.outputs[0]!.path)).toBe("成片终稿.mp4");
}, 30000);

it("takes the next default-name number when linking races with EEXIST", async () => {
  const f = await fixture();
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error("ready required");
  linkFault.eexist = 1;
  const published = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  expect(published.kind).toBe("PUBLISHED");
  if (published.kind !== "PUBLISHED") throw new Error(JSON.stringify(published));
  expect(basename(published.outputs[0]!.path)).toBe("离线QC-第一集-2.mp4");
  expect((await readdir(f.output)).includes("离线QC-第一集.mp4")).toBe(false);
}, 30000);

it("stops with a clear error when every default-name number races", async () => {
  const f = await fixture();
  const request = { ...input, settings: { ...input.settings, aspects: ["16:9" as const] } };
  const ready = await f.qc.prepare("owner", request);
  if (ready.kind !== "READY") throw new Error("ready required");
  linkFault.eexist = 200;
  expect(await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt })).toEqual({
    kind: "FAILED",
    code: "EXPORT_NAME_EXHAUSTED",
  });
  expect(await readdir(f.output)).toEqual([]);
  linkFault.eexist = 0;
  const published = await f.qc.publish("owner", { ...request, qcReceipt: ready.qcReceipt });
  expect(published.kind).toBe("PUBLISHED");
}, 30000);
