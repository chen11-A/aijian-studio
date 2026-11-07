import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { planFilmRange } from "./film-range-plan";
import { renderFilmRange, rangeMedia } from "./film-range-render";
import {
  loadQcEngine,
  loadQcRunner,
  verifiedQcTools,
  type QcRunner,
  type QcTools,
} from "./film-export-qc-runtime";
import { createFilmExportQc } from "./film-export-qc";
import { createFilmRanges } from "./film-range";
import { readProject, writeProject } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
function tool(name: string) {
  const explicit = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(root, `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(path)) return path;
  }
  throw new Error("Pinned tool missing");
}
const execute = promisify(execFile),
  roots: string[] = [];
const run: QcRunner = async (path, args, options) =>
  execute(path, args, { ...options, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
let tools: QcTools;
beforeAll(async () => {
  tools = await verifiedQcTools(
    dirname(tool("ffmpeg")),
    resolve(
      "../../config",
      process.platform === "win32"
        ? "media-toolchain-lock.json"
        : "draft-media-toolchain-linux-dev-lock.json",
    ),
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function clips() {
  const root = await mkdtemp(join(tmpdir(), "区间重做 "));
  roots.push(root);
  const source = join(root, "原片.mp4"),
    segment = join(root, "新段.mp4");
  for (const [path, color, duration, tone] of [
    [source, "red", 4, 440],
    [segment, "blue", 2, 880],
  ] as const)
    await run(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=320x180:r=24:d=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${tone}:duration=${duration}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ]);
  return { root, source, segment };
}
it("normalizes reversed seconds to actual frames and refuses whole/short/overcap/nonfinite ranges", () => {
  expect(planFilmRange(5, 3.11, 1.03, 25)).toMatchObject({
    requested: { start: 1.03, end: 3.11 },
    effective: { start: 1, end: 3.12 },
    generationSeconds: 3,
    frameRate: 25,
  });
  for (const range of [
    [4, 0, 4],
    [4, 1, 1.5],
    [20, 0, 10.1],
    [4, NaN, 2],
    [4, -2, 2],
    [4, 2, 5],
  ])
    expect(planFilmRange(...(range as [number, number, number]))).toBeNull();
});
it("really stitches the middle, preserves prefix/suffix, duration, audio packets and original bytes", async () => {
  const { root, source, segment } = await clips();
  const original = await readFile(source);
  const out = join(root, "结果.mp4");
  await renderFilmRange(source, segment, out, planFilmRange(4, 1, 3)!, tools, run);
  expect(await readFile(source)).toEqual(original);
  expect((await rangeMedia(out, tools, run)).duration).toBeCloseTo(4, 2);
  const sample = async (time: number) =>
    (
      await execute(
        tools.ffmpegPath,
        [
          "-v",
          "error",
          "-ss",
          String(time),
          "-i",
          out,
          "-frames:v",
          "1",
          "-vf",
          "scale=1:1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer" },
      )
    ).stdout;
  for (const time of [0.5, 3.5]) {
    const pixel = await sample(time);
    expect(pixel[0]).toBeGreaterThan(200);
    expect(pixel[2]).toBeLessThan(30);
  }
  const pixel = await sample(2);
  expect(pixel[2]).toBeGreaterThan(200);
  expect(pixel[0]).toBeLessThan(30);
  const audio = async (path: string) =>
    (
      await run(tools.ffmpegPath, [
        "-v",
        "error",
        "-i",
        path,
        "-map",
        "0:a",
        "-c:a",
        "copy",
        "-f",
        "hash",
        "-hash",
        "sha256",
        "pipe:1",
      ])
    ).stdout;
  expect(await audio(out)).toBe(await audio(source));
}, 30000);
async function readyFixture() {
  const { root, source, segment } = await clips();
  const filmsRoot = join(root, "films");
  const id = `film_${"a".repeat(16)}`,
    seriesId = `film_${"b".repeat(16)}`;
  const stored = await writeProject(filmsRoot, {
    id,
    seriesId,
    title: "测试",
    backendProjectId: `prj_${"d".repeat(32)}`,
    shots: [
      {
        id: "shot",
        selectedTakeId: "source",
        line: "原字幕布局。",
        takes: [
          {
            id: "source",
            shotId: "shot",
            status: "done",
            videoPath: source,
            cleanVideoPath: source,
            subtitleCues: [{ text: "原字幕布局。", start: 0, end: 4 }],
          },
        ],
      },
    ],
  });
  const provider = vi.fn<NonNullable<Parameters<typeof createFilmRanges>[0]["generate"]>>(
    async (_id, _body, canDispatch) => {
      if (!(await canDispatch())) throw new Error("not dispatched");
      return { data: { status: "SUCCEEDED", output_path: segment } };
    },
  );
  const host = createFilmRanges({
    filmsRoot,
    storyFilmsRoot: root,
    tools: async () => tools,
    run,
    storyOwner: async () => true,
    cleanOwner: async () => true,
    temporaryRoot: join(root, "temporary"),
    generate: provider,
  });
  const input = {
    projectId: id,
    shotId: "shot",
    takeId: "source",
    start: 1,
    end: 3,
    expectedHash: filmHistoryRecordHash(stored),
  };
  const ready = await host.prepareFilmRange(input);
  if (ready.kind !== "READY") throw new Error(ready.code);
  return { host, current: stored, ready, input, filmsRoot, root, source, segment, provider };
}
async function fixture() {
  const f = await readyFixture();
  const generated = await f.host.generateFilmRange({
    projectId: f.current.id,
    planId: f.ready.planId,
    expectedHash: filmHistoryRecordHash(f.current),
    confirmed: true,
    prompt: "雨后的画面",
  });
  if (generated.kind !== "GENERATED") throw new Error(generated.code);
  const current = await readProject(f.filmsRoot, f.current.id);
  if (!current) throw new Error("missing generated project");
  return { ...f, current, generated };
}

it("adds a selected composed version while retaining original/candidate and rejects replay", async () => {
  const f = await fixture();
  const bytes = await readFile(f.source);
  const input = {
    projectId: f.current.id,
    planId: f.ready.planId,
    segmentTakeId: f.generated.segmentTakeId,
    expectedHash: filmHistoryRecordHash(f.current),
  };
  expect(await f.host.finishFilmRange(input)).toMatchObject({ kind: "SPLICED" });
  const stored = await readProject(f.filmsRoot, f.current.id);
  const shot = (stored!.shots as Record<string, unknown>[])[0]!;
  expect(shot.selectedTakeId).not.toBe("source");
  expect(shot.takes).toHaveLength(3);
  expect(await readFile(f.source)).toEqual(bytes);
  expect(await f.host.finishFilmRange(input)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
});
it("rejects edits, changed selection, foreign project and mutated source without overwriting", async () => {
  for (const mode of ["edit", "selected", "project", "bytes"] as const) {
    const f = await fixture();
    const next =
      mode === "edit"
        ? { ...f.current, title: "新编辑" }
        : mode === "selected"
          ? {
              ...f.current,
              shots: [
                {
                  ...(f.current.shots as Record<string, unknown>[])[0],
                  selectedTakeId: f.generated.segmentTakeId,
                },
              ],
            }
          : f.current;
    const saved = await writeProject(f.filmsRoot, next);
    const file = join(f.filmsRoot, saved.seriesId, "episodes", saved.id, "project.json");
    const before = await readFile(file);
    if (mode === "bytes") await writeFile(f.source, "changed");
    const result = await f.host.finishFilmRange({
      projectId: mode === "project" ? `film_${"c".repeat(16)}` : saved.id,
      planId: f.ready.planId,
      segmentTakeId: f.generated.segmentTakeId,
      expectedHash: filmHistoryRecordHash(saved),
    });
    expect(result.kind).toBe("FAILED");
    expect(await readFile(file)).toEqual(before);
  }
}, 30000);
it("rejects real variable-frame timestamps and metadata whose average alone appears constant", async () => {
  const { root, source } = await clips();
  const vfr = join(root, "variable.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-i",
    source,
    "-an",
    "-vf",
    "select='not(eq(mod(n,3),1))'",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    vfr,
  ]);
  await expect(rangeMedia(vfr, tools, run)).rejects.toThrow("UNSUPPORTED_SOURCE");
  const metadata: QcRunner = async () => ({
    stdout: JSON.stringify({
      streams: [
        { width: 320, height: 180, r_frame_rate: "24/1", avg_frame_rate: "24/1", nb_frames: "3" },
      ],
      format: { duration: "0.125" },
      frames: [
        { best_effort_timestamp_time: 0 },
        { best_effort_timestamp_time: 0.06 },
        { best_effort_timestamp_time: 2 / 24 },
      ],
    }),
    stderr: "",
  });
  await expect(rangeMedia(source, tools, metadata)).rejects.toThrow("UNSUPPORTED_SOURCE");
});
it("passes actual cancellation to the managed FFmpeg process and waits for its exit", async () => {
  const managed = await loadQcRunner(resolve("../../packages/aivora-qc"));
  const f = await clips(),
    controller = new AbortController();
  let pid = 0,
    closed = false;
  const tracked: QcRunner = (binary, args, options) =>
    managed(binary, args, {
      ...options,
      onProcess: (id, done) => {
        if (args.includes("-filter_complex")) {
          pid = id;
          if (done) closed = true;
          else controller.abort();
        }
      },
    });
  const bytes = await readFile(f.source);
  await expect(
    renderFilmRange(
      f.source,
      f.segment,
      join(f.root, "cancelled.mp4"),
      planFilmRange(4, 1, 3)!,
      tools,
      tracked,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(pid).toBeGreaterThan(0);
  expect(closed).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
  expect(await readFile(f.source)).toEqual(bytes);
});
it("requires successful history capture and forbids a second paid dispatch for the same plan", async () => {
  const f = await fixture();
  expect(
    await f.host.generateFilmRange({
      projectId: f.current.id,
      planId: f.ready.planId,
      expectedHash: filmHistoryRecordHash(f.current),
      prompt: "another",
      confirmed: true,
    }),
  ).toMatchObject({ kind: "FAILED", requestMayHaveRun: false });
  const { readdir } = await import("node:fs/promises");
  const folder = join(f.filmsRoot, f.current.seriesId, "episodes", f.current.id, "history");
  const files = await readdir(folder);
  expect(files).toHaveLength(1);
  const snapshot = JSON.parse(await readFile(join(folder, files[0]!), "utf8"));
  expect(snapshot.entry.reason).toBe("before-batch-generation");
  expect(snapshot.snapshot.shots[0].takes).toHaveLength(1);
});
it("blocks payment on failed snapshot, changed input and discarded plan", async () => {
  for (const mode of ["backup", "edit", "discard"] as const) {
    const f = await readyFixture();
    if (mode === "backup")
      await writeFile(
        join(f.filmsRoot, f.current.seriesId, "episodes", f.current.id, "history"),
        "not a directory",
      );
    if (mode === "edit") await writeProject(f.filmsRoot, { ...f.current, title: "新编辑" });
    if (mode === "discard") await f.host.discardFilmRange(f.current.id, f.ready.planId);
    const result = await f.host.generateFilmRange({
      projectId: f.current.id,
      planId: f.ready.planId,
      expectedHash: filmHistoryRecordHash(f.current),
      confirmed: true,
      prompt: "画面",
    });
    expect(result).toMatchObject({ kind: "FAILED", requestMayHaveRun: false });
    expect(f.provider).not.toHaveBeenCalled();
  }
});
it("preserves a paid late candidate in the original project after cancellation and newer editing", async () => {
  const f = await readyFixture();
  const sourceBytes = await readFile(f.source),
    candidateBytes = await readFile(f.segment);
  let release!: () => void, admit!: () => void;
  const hold = new Promise<void>((yes) => {
    release = yes;
  });
  const admitted = new Promise<void>((yes) => {
    admit = yes;
  });
  const paidDispatch = vi.fn();
  f.provider.mockImplementationOnce(async (_id, _body, canDispatch) => {
    if (!(await canDispatch())) throw new Error("DISPATCH_NOT_ADMITTED");
    paidDispatch();
    admit();
    await hold;
    return { data: { status: "SUCCEEDED", output_path: f.segment } };
  });
  const work = f.host.generateFilmRange({
    projectId: f.current.id,
    planId: f.ready.planId,
    expectedHash: filmHistoryRecordHash(f.current),
    confirmed: true,
    prompt: "画面",
  });
  try {
    // Invocation precedes async canonical/source checks. Only this signal is past admission.
    await Promise.race([
      admitted,
      work.then(() => {
        throw Error("DISPATCH_NOT_ADMITTED");
      }),
    ]);
    expect(f.provider).toHaveBeenCalledOnce();
    expect(paidDispatch).toHaveBeenCalledOnce();
    await f.host.discardFilmRange(f.current.id, f.ready.planId);
    await writeProject(f.filmsRoot, { ...f.current, title: "后来编辑，不得覆盖" });
    release();
    const result = await work;
    expect(result.kind).toBe("GENERATED");
    const current = await readProject(f.filmsRoot, f.current.id);
    expect(current!.title).toBe("后来编辑，不得覆盖");
    const shot = (current!.shots as Record<string, unknown>[])[0]!;
    expect(shot.selectedTakeId).toBe("source");
    expect(shot.takes).toHaveLength(2);
    if (result.kind !== "GENERATED") throw new Error("CANDIDATE_NOT_SAVED");
    const candidate = (shot.takes as Record<string, unknown>[]).find(
      (take) => take.id === result.segmentTakeId,
    )!;
    expect(await readFile(String(candidate.videoPath))).toEqual(candidateBytes);
    expect(await readFile(f.source)).toEqual(sourceBytes);
    expect(
      await f.host.finishFilmRange({
        projectId: f.current.id,
        planId: f.ready.planId,
        segmentTakeId: result.segmentTakeId,
        expectedHash: filmHistoryRecordHash(current),
      }),
    ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED" });
  } finally {
    release();
    await work;
  }
});
it("does not dispatch payment when cancellation arrives after provider invocation but before admission", async () => {
  const f = await readyFixture();
  const sourceBytes = await readFile(f.source),
    candidateBytes = await readFile(f.segment);
  const projectFile = join(
    f.filmsRoot,
    f.current.seriesId,
    "episodes",
    f.current.id,
    "project.json",
  );
  const projectBytes = await readFile(projectFile);
  let release!: () => void, enter!: () => void;
  const hold = new Promise<void>((yes) => {
    release = yes;
  });
  const entered = new Promise<void>((yes) => {
    enter = yes;
  });
  const paidDispatch = vi.fn();
  let admission: boolean | undefined;
  f.provider.mockImplementationOnce(async (_id, _body, canDispatch) => {
    enter();
    await hold;
    admission = await canDispatch();
    if (!admission) throw new Error("DISPATCH_NOT_ADMITTED");
    paidDispatch();
    return { data: { status: "SUCCEEDED", output_path: f.segment } };
  });
  const work = f.host.generateFilmRange({
    projectId: f.current.id,
    planId: f.ready.planId,
    expectedHash: filmHistoryRecordHash(f.current),
    confirmed: true,
    prompt: "画面",
  });
  try {
    await Promise.race([
      entered,
      work.then(() => {
        throw Error("PROVIDER_NOT_ENTERED");
      }),
    ]);
    expect(f.provider).toHaveBeenCalledOnce();
    expect(admission).toBeUndefined();
    expect(paidDispatch).not.toHaveBeenCalled();
    await f.host.discardFilmRange(f.current.id, f.ready.planId);
    release();
    expect(await work).toMatchObject({ kind: "FAILED", requestMayHaveRun: false });
    expect(admission).toBe(false);
    expect(paidDispatch).not.toHaveBeenCalled();
    expect(await readFile(projectFile)).toEqual(projectBytes);
    expect(await readFile(f.source)).toEqual(sourceBytes);
    expect(await readFile(f.segment)).toEqual(candidateBytes);
    const current = await readProject(f.filmsRoot, f.current.id);
    expect((current!.shots as Record<string, unknown>[])[0]).toMatchObject({
      selectedTakeId: "source",
    });
    expect((current!.shots as Record<string, unknown>[])[0]!.takes).toHaveLength(1);
  } finally {
    release();
    await work;
  }
});
it("refuses negative/out-of-source endpoints, wrong owner and foreign series requests at zero provider calls", async () => {
  const f = await readyFixture();
  for (const [start, end] of [
    [-2, 2],
    [1, 5],
  ])
    expect(await f.host.prepareFilmRange({ ...f.input, start: start!, end: end! })).toMatchObject({
      kind: "FAILED",
      code: "INVALID_RANGE",
    });
  const toolsSpy = vi.fn(async () => tools);
  const denied = createFilmRanges({
    filmsRoot: f.filmsRoot,
    storyFilmsRoot: f.root,
    tools: toolsSpy,
    run,
    storyOwner: async () => false,
    cleanOwner: async () => false,
  });
  expect(await denied.prepareFilmRange(f.input)).toMatchObject({
    kind: "FAILED",
    code: "SOURCE_UNVERIFIED",
  });
  expect(toolsSpy).not.toHaveBeenCalled();
  expect(
    await f.host.prepareFilmRange({ ...f.input, projectId: f.current.seriesId }),
  ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect(f.provider).not.toHaveBeenCalled();
});
it("refuses real video-shorter-than-audio instead of planning over a nonexistent visual tail", async () => {
  const f = await clips();
  const path = join(f.root, "video-short-audio-long.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=320x180:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path,
  ]);
  const bytes = await readFile(path);
  await expect(rangeMedia(path, tools, run)).rejects.toThrow("UNSUPPORTED_SOURCE");
  expect(await readFile(path)).toEqual(bytes);
});
it("keeps clean provenance and original layout cues into the existing real two-aspect QC pipeline", async () => {
  const f = await fixture();
  const result = await f.host.finishFilmRange({
    projectId: f.current.id,
    planId: f.ready.planId,
    segmentTakeId: f.generated.segmentTakeId,
    expectedHash: filmHistoryRecordHash(f.current),
  });
  expect(result.kind).toBe("SPLICED");
  const current = await readProject(f.filmsRoot, f.current.id);
  const shot = (current!.shots as Record<string, unknown>[])[0]!;
  const selected = (shot.takes as Record<string, unknown>[]).find(
    (take) => take.id === shot.selectedTakeId,
  )!;
  expect(selected.cleanVideoPath).toBe(selected.videoPath);
  expect(selected.subtitleCues).toEqual([{ text: "原字幕布局。", start: 0, end: 4 }]);
  const qc = createFilmExportQc({
    filmsRoot: f.filmsRoot,
    storyFilmsRoot: f.root,
    temporaryRoot: join(f.root, "qc"),
    tools: async () => tools,
    engine: () => loadQcEngine(resolve("../../packages/aivora-qc")),
    font: () => resolve("../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf"),
    pickDirectory: async () => null,
  });
  const checked = await qc.prepare("test-owner", {
    projectId: current!.id,
    expectedSelection: [{ shotId: "shot", takeId: String(selected.id) }],
    settings: {
      aspects: ["16:9", "9:16"],
      quality: "720p",
      subtitles: "srt",
      style: "white",
      aiMark: false,
    },
  });
  expect(checked.kind).toBe("READY");
  if (checked.kind !== "READY") throw new Error(checked.code);
  expect(
    checked.outputs.map((output) => (output.report as { schemaVersion: number }).schemaVersion),
  ).toEqual([1, 1]);
  // Static color fixtures can trigger the original freeze rule. READY means checked and
  // reviewable, never a claim that original severities were weakened or publication allowed.
  expect(checked.unverified.some((text) => text.includes("对白"))).toBe(true);
  await qc.discard("test-owner", checked.qcReceipt);
});
it("rejects an owned but unproven clean source before tools or paid dispatch", async () => {
  const f = await readyFixture();
  const toolsSpy = vi.fn(async () => tools),
    provider = vi.fn();
  const blocked = createFilmRanges({
    filmsRoot: f.filmsRoot,
    storyFilmsRoot: f.root,
    tools: toolsSpy,
    run,
    storyOwner: async () => true,
    cleanOwner: async () => false,
    generate: provider,
    temporaryRoot: join(f.root, "temporary2"),
  });
  expect(await blocked.prepareFilmRange(f.input)).toMatchObject({
    kind: "FAILED",
    code: "CLEAN_SOURCE_REQUIRED",
  });
  expect(toolsSpy).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});
