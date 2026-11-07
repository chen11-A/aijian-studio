import type { FilmExportProgressEvent } from "@aijian/contracts/film-export-qc";
import { afterEach, beforeAll, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { registerFilmAssemblies } from "./film-assembly-ipc";
import { createFilmAssemblies, type FilmAssemblyHost } from "./film-assembly";
import { filmHistoryRecordHash } from "./film-history";
import { readProject, writeProject, type FilmRecord } from "./film-library";
import {
  loadQcRunner,
  verifiedQcTools,
  type QcTools,
  type QcRunner,
} from "./film-export-qc-runtime";
import type { FilmAssemblyInput } from "@aijian/contracts/film-assembly";
const execute = promisify(execFile),
  roots: string[] = [];
let tools: QcTools, run: QcRunner;
function tool(name: string) {
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(root, name + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(path)) return path;
  }
  throw Error("Pinned media tools unavailable");
}
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
  run = await loadQcRunner(resolve("../../packages/aivora-qc"));
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "assembly actual ")));
  roots.push(root);
  const films = join(root, "films"),
    story = join(root, "story"),
    temporary = join(root, "temporary"),
    id = "film_aaaaaaaaaaaaaaaa",
    series = "film_bbbbbbbbbbbbbbbb",
    episode = join(films, series, "episodes", id),
    media = join(episode, "media");
  await mkdir(media, { recursive: true });
  await mkdir(story);
  await mkdir(temporary);
  const a = join(media, "red.mp4"),
    b = join(media, "blue.mp4");
  for (const [path, color, frequency] of [
    [a, "red", 440],
    [b, "blue", 880],
  ] as const)
    await run(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=160x90:r=24:d=2`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000:duration=2`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ]);
  const audio: Record<string, string> = {};
  for (const [name, frequency] of [
    ["voice", 990],
    ["ambience", 660],
    ["sfx", 1320],
    ["score", 220],
  ] as const) {
    audio[name] = join(media, `${name}.wav`);
    await run(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000:duration=4`,
      "-c:a",
      "pcm_s16le",
      audio[name]!,
    ]);
  }
  const clip = (name: string, extra: Record<string, unknown>) => ({
    id: name,
    lane: name === "voice" ? "dialogue" : name,
    path: audio[name],
    shotId: "",
    takeId: "",
    label: "",
    startSeconds: 0,
    durationSeconds: 4,
    offsetSeconds: 0,
    gainDb: 0,
    ...extra,
  });
  const record = await writeProject(films, {
    id,
    seriesId: series,
    title: "粗剪",
    draft: false,
    scenes: [{ id: "scene", no: 1 }],
    shots: [
      {
        id: "a",
        sceneId: "scene",
        no: 1,
        line: "你好",
        characters: [],
        sound: { source: "dub" },
        selectedTakeId: "ta",
        takes: [{ id: "ta", shotId: "a", status: "done", videoPath: a }],
      },
      {
        id: "b",
        sceneId: "scene",
        no: 2,
        line: "",
        characters: [],
        sound: { source: "native" },
        selectedTakeId: "tb",
        takes: [{ id: "tb", shotId: "b", status: "done", videoPath: b }],
      },
    ],
    audioClips: [
      clip("voice", { shotId: "a", takeId: "ta", label: "配音", durationSeconds: 2 }),
      clip("ambience", {
        durationSeconds: 1.5,
        gainDb: -6,
        envelope: {
          schemaVersion: 1,
          baseGainDb: -6,
          fades: [{ direction: "in", startSeconds: 0, durationSeconds: 0.5 }],
        },
      }),
      clip("sfx", { shotId: "b", takeId: "tb", startSeconds: 0.5, durationSeconds: 0.5 }),
      clip("score", { gainDb: -12 }),
    ],
    jobs: [],
  });
  const old = join(media, "old-assembly.mp4");
  await writeFile(old, "previous-assembly-bytes");
  const input: FilmAssemblyInput = {
    projectId: id,
    expectedHash: filmHistoryRecordHash(record),
    expectedSelection: [
      { shotId: "a", takeId: "ta" },
      { shotId: "b", takeId: "tb" },
    ],
  };
  const host: FilmAssemblyHost = {
    filmsRoot: films,
    storyFilmsRoot: story,
    temporaryRoot: temporary,
    tools: async () => tools,
    runner: async () => run,
    font: () => resolve("../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf"),
  };
  const originals = new Map(
    await Promise.all(
      [a, b, ...Object.values(audio), old].map(
        async (path) => [path, await readFile(path)] as const,
      ),
    ),
  );
  return {
    root,
    films,
    story,
    temporary,
    id,
    episode,
    media,
    a,
    b,
    audio,
    record,
    input,
    host,
    old,
    originals,
  };
}
async function decoded(path: string) {
  const { stdout } = await execute(
    tools.ffmpegPath,
    [
      "-v",
      "error",
      "-i",
      path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "pcm_f32le",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
  );
  const samples = new Float32Array(stdout.length / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = stdout.readFloatLE(i * 4);
  return samples;
}
function amplitude(samples: Float32Array, hz: number, start: number, end: number) {
  let real = 0,
    imag = 0,
    count = 0;
  for (
    let i = Math.round(start * 48000);
    i < Math.min(samples.length, Math.round(end * 48000));
    i++
  ) {
    const angle = (2 * Math.PI * hz * i) / 48000;
    real += samples[i]! * Math.cos(angle);
    imag += samples[i]! * Math.sin(angle);
    count++;
  }
  return (2 * Math.hypot(real, imag)) / count;
}
it("creates a private real four-track rough cut on actual selected clocks, including envelope/duck, without duplicate dub or changes to the record and original files", async () => {
  const f = await fixture(),
    before = await readProject(f.films, f.id),
    result = await createFilmAssemblies(f.host).assemble(f.input);
  expect(result.kind).toBe("ASSEMBLED");
  if (result.kind !== "ASSEMBLED")
    throw Error(result.kind === "FAILED" ? result.code : (result.incomplete ?? "PARTIAL"));
  expect(result.durationSeconds).toBeCloseTo(4, 3);
  expect(
    result.shots.map((shot) => [shot.shotId, shot.startSeconds, shot.durationSeconds]),
  ).toEqual([
    ["a", 0, 2],
    ["b", 2, 2],
  ]);
  expect(result.path).toMatch(/assembly-[A-Za-z0-9_-]+[\\/]film\.mp4$/);
  expect(result.path.startsWith(f.media)).toBe(true);
  const samples = await decoded(result.path);
  expect(samples.length).toBeGreaterThan(190000);
  expect(amplitude(samples, 990, 0.6, 1.0)).toBeGreaterThan(0.08);
  expect(amplitude(samples, 440, 0.6, 1.0)).toBeLessThan(0.004);
  expect(amplitude(samples, 880, 3.2, 3.6)).toBeGreaterThan(0.08);
  expect(amplitude(samples, 660, 0.05, 0.15)).toBeLessThan(amplitude(samples, 660, 0.8, 1.2) * 0.5);
  expect(amplitude(samples, 660, 2.1, 2.4)).toBeLessThan(0.004);
  expect(amplitude(samples, 1320, 2.6, 2.9)).toBeGreaterThan(0.08);
  expect(amplitude(samples, 1320, 2.1, 2.4)).toBeLessThan(0.004);
  expect(amplitude(samples, 220, 0.8, 1.2)).toBeLessThan(amplitude(samples, 220, 3.2, 3.6) * 0.5);
  expect(await readProject(f.films, f.id)).toEqual(before);
  for (const [path, bytes] of f.originals) expect(await readFile(path)).toEqual(bytes);
  expect(await readdir(f.temporary)).toEqual([]);
}, 30_000);
it("pins verified canonical native/visual roles and rejects an alias retarget even to identical bytes in another episode", async () => {
  const f = await fixture(),
    { symlink, copyFile } = await import("node:fs/promises");
  const alias = join(f.episode, "selected-alias"),
    foreign = join(f.films, "film_bbbbbbbbbbbbbbbb", "episodes", "film_cccccccccccccccc", "media");
  await mkdir(foreign, { recursive: true });
  await copyFile(f.a, join(foreign, "red.mp4"));
  await symlink(f.media, alias, process.platform === "win32" ? "junction" : "dir");
  const record = structuredClone(f.record);
  (
    (record.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[]
  )[0]!.videoPath = join(alias, "red.mp4");
  const stored = await writeProject(f.films, record),
    before = await readProject(f.films, f.id);
  let injected = false,
    joinedPinned = false;
  const result = await createFilmAssemblies({
    ...f.host,
    afterResolve: async () => {
      injected = true;
      await rm(alias, { recursive: true, force: true });
      await symlink(foreign, alias, process.platform === "win32" ? "junction" : "dir");
    },
    runner: async () => async (binary, args, options) => {
      if (args.includes("concat")) {
        const list = await readFile(args[args.indexOf("-i") + 1]!, "utf8");
        joinedPinned = list.includes(f.a);
        expect(list).not.toContain(foreign);
        expect(list).not.toContain(alias);
      }
      return run(binary, args, options);
    },
  }).assemble({ ...f.input, expectedHash: filmHistoryRecordHash(stored) });
  expect(injected).toBe(true);
  expect(joinedPinned).toBe(true);
  expect(result).toEqual({ kind: "FAILED", code: "SOURCE_CHANGED" });
  expect(await readProject(f.films, f.id)).toEqual(before);
  for (const [path, bytes] of f.originals) expect(await readFile(path)).toEqual(bytes);
  expect(await readdir(f.temporary)).toEqual([]);
}, 30_000);
it.each(["project", "selection", "source"])(
  "rejects a late %s change after real rendering without replacing old artifacts or the new draft",
  async (change) => {
    const f = await fixture();
    let updated: FilmRecord | undefined;
    const result = await createFilmAssemblies({
      ...f.host,
      beforeCommit: async () => {
        if (change === "source") {
          await writeFile(f.audio.score!, "externally changed source");
          return;
        }
        const next = structuredClone(f.record);
        if (change === "project") next.title = "new user draft";
        else (next.shots as Record<string, unknown>[])[0]!.selectedTakeId = "changed";
        await writeProject(f.films, next);
        updated = (await readProject(f.films, f.id))!;
      },
    }).assemble(f.input);
    expect(result).toEqual({
      kind: "FAILED",
      code: change === "source" ? "SOURCE_CHANGED" : "PROJECT_CHANGED",
    });
    if (updated) expect(await readProject(f.films, f.id)).toEqual(updated);
    expect(await readFile(f.old, "utf8")).toBe("previous-assembly-bytes");
    expect(await readdir(f.temporary)).toEqual([]);
    expect((await readdir(f.media)).filter((name) => name.startsWith("assembly-"))).toEqual([]);
  },
  30_000,
);
it("uses the real subset clock instead of unfinished shot estimates and rejects caller paths/duplicates/reordering before media execution", async () => {
  const f = await fixture();
  const record = structuredClone(f.record);
  (record.shots as unknown[]).push({
    id: "unfinished",
    sceneId: "scene",
    no: 3,
    line: "还没有画面",
    seconds: 99,
    takes: [],
    selectedTakeId: "",
  });
  const stored = await writeProject(f.films, record),
    input = { ...f.input, expectedHash: filmHistoryRecordHash(stored) };
  let executions = 0;
  const core = createFilmAssemblies({
    ...f.host,
    tools: async () => {
      executions++;
      return tools;
    },
  });
  for (const invalid of [
    { ...input, path: f.a },
    { ...input, expectedSelection: [input.expectedSelection[0], input.expectedSelection[0]] },
    { ...input, expectedSelection: [...input.expectedSelection].reverse() },
    { ...input, expectedHash: "a".repeat(64) },
    { ...input, projectId: "film_cccccccccccccccc" },
  ]) {
    expect((await core.assemble(invalid)).kind).toBe("FAILED");
  }
  expect(executions).toBe(0);
  const result = await core.assemble(input);
  expect(result).toMatchObject({ kind: "ASSEMBLED", durationSeconds: 4 });
  expect(executions).toBe(1);
  expect(await readdir(f.temporary)).toEqual([]);
}, 30_000);
it("does not silently use a different native/clean clock without reliable subtitle layout", async () => {
  const f = await fixture(),
    clean = join(f.media, "short-clean.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=160x90:r=24:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clean,
  ]);
  const record = structuredClone(f.record);
  (
    (record.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[]
  )[0]!.cleanVideoPath = clean;
  const stored = await writeProject(f.films, record);
  const result = await createFilmAssemblies(f.host).assemble({
    ...f.input,
    expectedHash: filmHistoryRecordHash(stored),
  });
  expect(result).toEqual({ kind: "FAILED", code: "SOURCE_TIME_MISMATCH" });
  expect(await readdir(f.temporary)).toEqual([]);
  for (const [path, bytes] of f.originals) expect(await readFile(path)).toEqual(bytes);
}, 30_000);
it("renders only reliable clean-source layout cues on the selected real clock and preserves original/cue bytes", async () => {
  const f = await fixture(),
    clean = join(f.media, "short-clean.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=160x90:r=24:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clean,
  ]);
  const record = structuredClone(f.record),
    take = ((record.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[])[0]!;
  take.cleanVideoPath = clean;
  take.subtitleCues = [{ text: "你好", start: 0.2, end: 0.8 }];
  const stored = await writeProject(f.films, record),
    cleanBytes = await readFile(clean);
  const result = await createFilmAssemblies(f.host).assemble({
    ...f.input,
    expectedHash: filmHistoryRecordHash(stored),
  });
  expect(result).toMatchObject({ kind: "ASSEMBLED", durationSeconds: 3 });
  if (result.kind !== "ASSEMBLED")
    throw Error(result.kind === "FAILED" ? result.code : (result.incomplete ?? "PARTIAL"));
  const pixels = async (seconds: string) =>
    (
      await execute(
        tools.ffmpegPath,
        [
          "-v",
          "error",
          "-ss",
          seconds,
          "-i",
          result.path,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 1024 * 1024 },
      )
    ).stdout;
  expect((await pixels("0.4")).equals(await pixels("0.05"))).toBe(false);
  expect(await readFile(clean)).toEqual(cleanBytes);
  expect(await readProject(f.films, f.id)).toMatchObject({
    shots: [{ takes: [{ subtitleCues: [{ text: "你好", start: 0.2, end: 0.8 }] }] }, {}],
  });
  expect(await readdir(f.temporary)).toEqual([]);
}, 30_000);
it("retains only a verified post-join partial after audio failure, and never a stale partial", async () => {
  const f = await fixture();
  let mixes = 0;
  const host = {
    ...f.host,
    runner:
      async () => async (binary: string, args: string[], options: Parameters<QcRunner>[2]) => {
        if (args.includes("-filter_complex_script")) {
          mixes++;
          throw Error("private audio failure");
        }
        return run(binary, args, options);
      },
  };
  const result = await createFilmAssemblies(host).assemble(f.input);
  expect(mixes).toBe(1);
  expect(result).toMatchObject({ kind: "PARTIAL", incomplete: "audio", durationSeconds: 4 });
  if (result.kind !== "PARTIAL") throw Error("EXPECTED_PARTIAL");
  expect((await decoded(result.path)).length).toBeGreaterThan(190000);
  expect(result.limitations.join()).toContain("后续音量和字幕步骤未执行");
  expect(await readProject(f.films, f.id)).toEqual(f.record);
  const stale = await createFilmAssemblies({
    ...host,
    beforeCommit: async () => {
      await writeProject(f.films, { ...f.record, title: "new draft" });
    },
  }).assemble(f.input);
  expect(stale).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect((await readdir(f.media)).filter((name) => name.startsWith("assembly-"))).toHaveLength(1);
  expect(await readdir(f.temporary)).toEqual([]);
  for (const [path, bytes] of f.originals) expect(await readFile(path)).toEqual(bytes);
}, 30_000);
it("owns cancellation through a real managed child exit and cleanup, with no partial receipt or orphan and no foreign-owner cancellation", async () => {
  const f = await fixture();
  const handlers = new Map<string, (event: string, ...args: unknown[]) => Promise<unknown>>();
  const events: FilmExportProgressEvent[] = [];
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let pid = 0,
    closed = false,
    mixCalls = 0;
  registerFilmAssemblies<string>(
    (name, handler) => handlers.set(name, handler),
    (event) => event !== "unauthorized",
    (event) => event,
    {
      ...f.host,
      runner: async () => async (binary, args, options) => {
        if (args.includes("-filter_complex_script")) {
          mixCalls++;
          return run(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
            ...options,
            onProcess: (value, isClosed) => {
              pid = value;
              closed = isClosed;
              if (!isClosed) started();
            },
          });
        }
        return run(binary, args, options);
      },
    },
    undefined,
    (_event, view) => events.push(view),
  );
  await expect(
    handlers.get("film:assembly-prepare")!("unauthorized", f.input, "bad-owner"),
  ).rejects.toThrow();
  const pending = handlers.get("film:assembly-prepare")!("owner", f.input, "actual-child");
  try {
    await ready;
    expect(await handlers.get("film:assembly-prepare")!("owner", f.input, "duplicate")).toEqual({
      kind: "FAILED",
      code: "BUSY",
    });
    expect(await handlers.get("film:assembly-cancel")!("foreign", "actual-child")).toEqual({
      kind: "NOT_FOUND",
    });
    const ack = await handlers.get("film:assembly-cancel")!("owner", "actual-child");
    expect(ack).toMatchObject({ kind: "REQUESTED", snapshot: { cancelState: "requested" } });
    expect(events.at(-1)?.cancelState).not.toBe("stopped");
    expect(await pending).toEqual({ kind: "FAILED", code: "OPERATION_STOPPED" });
    expect(mixCalls).toBe(1);
    expect(pid).toBeGreaterThan(0);
    expect(closed).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(events.at(-1)).toMatchObject({ phase: "failed", cancelState: "stopped" });
    expect(await readdir(f.temporary)).toEqual([]);
    expect((await readdir(f.media)).filter((name) => name.startsWith("assembly-"))).toEqual([]);
    for (const [path, bytes] of f.originals) expect(await readFile(path)).toEqual(bytes);
  } finally {
    await handlers.get("film:assembly-cancel")!("owner", "actual-child");
    await pending;
  }
}, 30_000);
it.each(["loudness", "subtitles"] as const)(
  "preserves the last completed private output with an accurate %s incomplete stage",
  async (stage) => {
    const f = await fixture(),
      record = structuredClone(f.record);
    if (stage === "loudness")
      record.audioMix = {
        schemaVersion: 1,
        autoAdjustVolume: true,
        lanes: {
          dialogue: { gainDb: 0, muted: false },
          ambience: { gainDb: 0, muted: false },
          sfx: { gainDb: 0, muted: false },
          score: { gainDb: 0, muted: false },
        },
      };
    else {
      const { copyFile } = await import("node:fs/promises"),
        clean = join(f.media, "layout-clean.mp4");
      await copyFile(f.a, clean);
      const take = (
        (record.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[]
      )[0]!;
      take.cleanVideoPath = clean;
      take.subtitleCues = [{ text: "你好", start: 0.2, end: 0.8 }];
    }
    const stored = await writeProject(f.films, record);
    const result = await createFilmAssemblies({
      ...f.host,
      normalizer: async () => {
        throw Error("private normalizer path");
      },
      font: () => {
        throw Error("private font path");
      },
    }).assemble({ ...f.input, expectedHash: filmHistoryRecordHash(stored) });
    expect(result).toMatchObject({ kind: "PARTIAL", incomplete: stage, durationSeconds: 4 });
    if (result.kind !== "PARTIAL") throw Error("EXPECTED_PARTIAL");
    expect((await decoded(result.path)).length).toBeGreaterThan(190000);
    expect(amplitude(await decoded(result.path), 990, 0.6, 1)).toBeGreaterThan(0.08);
    expect(JSON.stringify(result)).not.toContain("private normalizer");
    expect(JSON.stringify(result)).not.toContain("private font");
    expect(await readProject(f.films, f.id)).toEqual(stored);
    expect(await readdir(f.temporary)).toEqual([]);
    for (const [path, bytes] of f.originals) expect(await readFile(path)).toEqual(bytes);
  },
  30_000,
);
