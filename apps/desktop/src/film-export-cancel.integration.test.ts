import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { registerFilmExportQc } from "./film-export-qc-ipc";
import { loadQcEngine, loadQcRunner, verifiedQcTools } from "./film-export-qc-runtime";
import type { FilmQcHost } from "./film-export-qc";
import type {
  FilmExportProgressEvent,
  FilmExportQcInput,
  FilmExportQcPrepared,
  FilmExportQcPublishResult,
} from "@aijian/contracts/film-export-qc";
function tool(name: string) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(dir, name + suffix);
    if (existsSync(path)) return path;
  }
  throw new Error("Pinned test media tools unavailable");
}
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(stopQc = false) {
  const root = await mkdtemp(join(tmpdir(), "qc-signal-"));
  roots.push(root);
  const films = join(root, "films"),
    story = join(root, "story"),
    output = join(root, "output"),
    projectId = `film_${"a".repeat(16)}`,
    seriesId = `film_${"b".repeat(16)}`;
  const episode = join(films, seriesId, "episodes", projectId);
  await Promise.all([mkdir(episode, { recursive: true }), mkdir(story), mkdir(output)]);
  const packageRoot = resolve("../../packages/aivora-qc"),
    runner = await loadQcRunner(packageRoot),
    engine = await loadQcEngine(packageRoot);
  const ffmpeg = tool("ffmpeg"),
    source = join(episode, "source.mp4");
  await runner(ffmpeg, [
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
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const input: FilmExportQcInput = {
    projectId,
    expectedSelection: [{ shotId: "shot-one", takeId: "take-one" }],
    settings: {
      aspects: stopQc ? ["16:9"] : ["16:9", "9:16"],
      quality: "720p",
      subtitles: "none",
      style: "white",
      aiMark: true,
    },
  };
  const record = {
    id: projectId,
    seriesId,
    title: "signal fixture",
    shots: [
      {
        id: "shot-one",
        line: "",
        selectedTakeId: "take-one",
        takes: [{ id: "take-one", shotId: "shot-one", status: "done", videoPath: source }],
      },
    ],
  };
  const handlers = new Map<
      string,
      (event: { id: string }, ...args: unknown[]) => Promise<unknown>
    >(),
    event = { id: "owner" },
    events: FilmExportProgressEvent[] = [],
    live = new Set<number>(),
    spawned: number[] = [];
  const observe = (pid: number, closed: boolean) => {
    if (closed) live.delete(pid);
    else {
      live.add(pid);
      spawned.push(pid);
    }
  };
  let qcSignal: AbortSignal | undefined,
    qcProcesses = 0;
  const cancellation: Promise<unknown>[] = [];
  let onEvent: (event: FilmExportProgressEvent) => void = () => undefined;
  const picker = vi.fn(async () => output);
  const host: FilmQcHost = {
    filmsRoot: films,
    storyFilmsRoot: story,
    temporaryRoot: join(root, "staging"),
    read: async () => record,
    font: () => resolve("../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf"),
    pickDirectory: picker,
    runner: async () => async (binary, args, options) =>
      runner(binary, args, { ...options, onProcess: observe }),
    tools: (signal) =>
      verifiedQcTools(
        dirname(ffmpeg),
        resolve(
          "../../config",
          process.platform === "win32"
            ? "media-toolchain-lock.json"
            : "draft-media-toolchain-linux-dev-lock.json",
        ),
        process.platform,
        async (binary) =>
          (await runner(binary, ["-version"], { signal, timeoutMs: 10000, onProcess: observe }))
            .stdout,
        signal,
      ),
    engine: async () => async (path, options) => {
      qcSignal = options.signal;
      return engine(path, {
        ...options,
        onProcess: (pid, closed) => {
          observe(pid, closed);
          if (!closed && ++qcProcesses === 2 && stopQc)
            cancellation.push(handlers.get("film:qc-cancel")!(event, "prepare-op"));
        },
      });
    },
  };
  registerFilmExportQc<{ id: string }>(
    (name, handler) => handlers.set(name, handler),
    (value) => value.id === "owner",
    (value) => value.id,
    host,
    undefined,
    (_owner, snapshot) => {
      events.push(snapshot);
      onEvent(snapshot);
    },
  );
  return {
    input,
    event,
    events,
    host,
    handlers,
    source,
    output,
    picker,
    live,
    spawned,
    cancellation,
    qcSignal: () => qcSignal,
    onEvent: (callback: typeof onEvent) => {
      onEvent = callback;
    },
  };
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
it("passes signal into the original QC engine, kills actual FFmpeg and confirms stop only after cleanup", async () => {
  const f = await fixture(true),
    before = digest(await readFile(f.source));
  const result = await f.handlers.get("film:qc-prepare")!(f.event, f.input, "prepare-op");
  expect(result).toEqual({ kind: "FAILED", code: "OPERATION_STOPPED" });
  expect((await Promise.all(f.cancellation))[0]).toMatchObject({ kind: "REQUESTED" });
  expect(f.qcSignal()?.aborted).toBe(true);
  expect(f.live.size).toBe(0);
  for (const pid of f.spawned) expect(() => process.kill(pid, 0)).toThrow();
  expect(await readdir(f.host.temporaryRoot)).toEqual([]);
  expect(f.events.at(-1)).toMatchObject({ phase: "failed", cancelState: "stopped", published: [] });
  expect(digest(await readFile(f.source))).toBe(before);
  expect(f.events.some((snapshot) => snapshot.cancelState === "requested")).toBe(true);
  expect(JSON.stringify(f.events)).not.toContain(f.host.temporaryRoot);
}, 30000);
it("keeps picker unavailable, later stops the next aspect and retains only the actual published output", async () => {
  const f = await fixture(),
    before = digest(await readFile(f.source));
  const ready = (await f.handlers.get("film:qc-prepare")!(
    f.event,
    f.input,
    "prepare-op",
  )) as FilmExportQcPrepared;
  expect(ready.kind).toBe("READY");
  let release!: (value: string) => void;
  f.picker.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  let stop: Promise<unknown> | undefined;
  f.onEvent((snapshot) => {
    if (
      snapshot.operationId === "publish-op" &&
      snapshot.published.length === 1 &&
      snapshot.cancelState === "available" &&
      !stop
    )
      stop = f.handlers.get("film:qc-cancel")!(f.event, "publish-op");
  });
  const request = { ...f.input, qcReceipt: ready.qcReceipt };
  const publishing = f.handlers.get("film:qc-publish")!(f.event, request, "publish-op");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(await f.handlers.get("film:qc-cancel")!(f.event, "publish-op")).toMatchObject({
    kind: "UNAVAILABLE",
    snapshot: { cancelState: "unavailable" },
  });
  release(f.output);
  const result = (await publishing) as FilmExportQcPublishResult;
  expect(result.kind).toBe("PARTIAL");
  if (result.kind !== "PARTIAL") throw new Error("partial required");
  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0]!.aspectRatio).toBe("16:9");
  expect(result.deliveryEvidence).toMatchObject({ kind: "FAILED", code: "EVIDENCE_UNAVAILABLE" });
  if (result.deliveryEvidence?.kind !== "FAILED")
    throw new Error("stopped evidence must be unavailable");
  expect(result.deliveryEvidence.files.every((file) => file.aspectRatio === "16:9")).toBe(true);
  expect(result.deliveryEvidence.files.some((file) => file.role === "video")).toBe(true);
  expect((await readdir(f.output)).filter((name) => name.endsWith(".json"))).toEqual([]);

  expect((await stat(result.outputs[0]!.path)).size).toBeGreaterThan(0);
  expect(await stop).toMatchObject({ kind: "REQUESTED" });
  expect(f.events.at(-1)).toMatchObject({
    phase: "partial",
    cancelState: "stopped",
    published: [{ aspectRatio: "16:9" }],
  });
  expect(f.live.size).toBe(0);
  expect(await readdir(f.host.temporaryRoot)).toEqual([]);
  expect(digest(await readFile(f.source))).toBe(before);
  expect(await f.handlers.get("film:qc-publish")!(f.event, request, "replay-op")).toEqual({
    kind: "FAILED",
    code: "RECEIPT_STALE",
  });
}, 30000);

it("returns the actual written evidence through authorized export IPC after managed work settles", async () => {
  const f = await fixture(),
    original = digest(await readFile(f.source));
  const ready = (await f.handlers.get("film:qc-prepare")!(
    f.event,
    f.input,
    "evidence-prepare",
  )) as FilmExportQcPrepared;
  if (ready.kind !== "READY") throw new Error("ready required");
  const published = (await f.handlers.get("film:qc-publish")!(
    f.event,
    { ...f.input, qcReceipt: ready.qcReceipt },
    "evidence-publish",
  )) as FilmExportQcPublishResult;
  expect(published.kind).toBe("PUBLISHED");
  if (published.kind !== "PUBLISHED" || published.deliveryEvidence?.kind !== "WRITTEN")
    throw new Error("written evidence required");
  const evidence = published.deliveryEvidence;
  const bytes = await readFile(join(f.output, evidence.fileName));
  expect(digest(bytes)).toBe(evidence.manifestSha256);
  expect(JSON.parse(bytes.toString())).toEqual(evidence.manifest);
  expect(evidence.manifest.files.filter((file) => file.role === "video")).toHaveLength(2);
  expect(f.events.at(-1)).toMatchObject({ phase: "completed", cancelState: "unavailable" });
  expect(f.live.size).toBe(0);
  expect(await readdir(f.host.temporaryRoot)).toEqual([]);
  expect(digest(await readFile(f.source))).toBe(original);
  expect(JSON.stringify(evidence)).not.toContain(f.host.temporaryRoot);
}, 30000);
