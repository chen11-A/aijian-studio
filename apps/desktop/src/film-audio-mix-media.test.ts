import { afterEach, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildAudioMixPlan, audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import type { MixClip } from "@aijian/contracts/film-audio-mix";
import { renderAudioMix, probeMixSource } from "./film-audio-mix";
import {
  loadQcRunner,
  verifiedQcTools,
  type QcTools,
  type QcRunner,
} from "./film-export-qc-runtime";
const execute = promisify(execFile),
  roots: string[] = [];
const run: QcRunner = (binary, args, options) =>
  execute(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, signal: options?.signal });
let tools: QcTools;
function tool(name: string) {
  const explicit = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const file = resolve(root, `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(file)) return file;
  }
  throw new Error("Pinned tool missing");
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
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "四轨 混音 "));
  roots.push(root);
  const video = join(root, "native.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    video,
  ]);
  const paths: Record<string, string> = { native: video };
  for (const [key, frequency] of [
    ["voice", 880],
    ["ambience", 660],
    ["sfx", 1320],
    ["score", 220],
  ] as const) {
    paths[key] = join(root, `${key}.wav`);
    const filters =
      key === "voice"
        ? [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=990:sample_rate=48000:duration=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:sample_rate=48000:duration=2.5",
            "-filter_complex",
            "[0:a][1:a]concat=n=2:v=0:a=1[a]",
            "-map",
            "[a]",
          ]
        : ["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=4`];
    await run(tools.ffmpegPath, ["-v", "error", ...filters, "-c:a", "pcm_s16le", paths[key]!]);
  }
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([key, path]) => [
        key,
        await probeMixSource(path, tools, run),
      ]),
    ),
  );
  const clip = (id: string, extra: Partial<MixClip> = {}): MixClip => ({
    id,
    sourceKey: id,
    lane: id as MixClip["lane"],
    shotId: "",
    takeId: "",
    label: "",
    startSeconds: 0,
    durationSeconds: 4,
    offsetSeconds: 0,
    gainDb: 0,
    ...extra,
  });
  const input = {
    projectId: "test",
    durationSeconds: 4,
    shots: [
      {
        shotId: "shot",
        takeId: "version",
        nativeSourceKey: "native",
        startSeconds: 0,
        durationSeconds: 4,
        hasDialogue: false,
      },
    ],
    sources,
    clips: [
      clip("voice", {
        lane: "dialogue",
        label: "配音",
        shotId: "shot",
        takeId: "version",
        startSeconds: 1,
        durationSeconds: 1.5,
        offsetSeconds: 0.5,
      }),
      clip("ambience", { lane: "ambience", startSeconds: 2.8, durationSeconds: 0.8, gainDb: -6 }),
      clip("sfx", { lane: "sfx", startSeconds: 3.2, durationSeconds: 0.2, gainDb: -3 }),
      clip("score", { lane: "score", gainDb: -6 }),
    ],
  };
  return { root, video, paths, input };
}
async function amplitude(path: string, start: number, seconds: number, frequency: number) {
  const { stdout } = await execute(
    tools.ffmpegPath,
    [
      "-v",
      "error",
      "-ss",
      String(start),
      "-i",
      path,
      "-t",
      String(seconds),
      "-map",
      "0:a:0",
      "-af",
      "pan=mono|c0=c0",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
  );
  let real = 0,
    imaginary = 0;
  const count = stdout.length / 4;
  if (!count) throw new Error(`NO_SAMPLES at ${start} for ${seconds}`);
  for (let i = 0; i < count; i++)
    if (!Number.isFinite(stdout.readFloatLE(i * 4))) throw new Error(`NONFINITE_SAMPLE at ${i}`);
  for (let index = 0; index < count; index++) {
    const value = stdout.readFloatLE(index * 4),
      phase = (2 * Math.PI * frequency * index) / 48000;
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return (2 * Math.hypot(real, imaginary)) / count;
}
it("really mixes four frequency-separated lanes on their time/offset/gain, ducks music and excludes duplicate native speech", async () => {
  const f = await fixture(),
    original = await readFile(f.video),
    out = join(f.root, "mixed.mp4");
  f.input.clips.push({
    ...f.input.clips[0]!,
    id: "retained-inactive-dub",
    sourceKey: "sfx",
    startSeconds: 0,
    durationSeconds: 4,
    offsetSeconds: 0,
    enabled: false,
  });
  const plan = buildAudioMixPlan(f.input);
  expect(plan.tracks.some((track) => track.key === "retained-inactive-dub")).toBe(false);
  await renderAudioMix(f.video, out, plan, f.paths, tools, run);
  expect(await readFile(f.video)).toEqual(original);
  expect(await amplitude(out, 1.2, 0.2, 880)).toBeGreaterThan(0.1);
  expect(await amplitude(out, 1.2, 0.2, 990)).toBeLessThan(0.002);
  expect(await amplitude(out, 1.2, 0.2, 440)).toBeLessThan(0.002);
  expect(await amplitude(out, 1.2, 0.2, 1320)).toBeLessThan(0.002);
  expect(await amplitude(out, 0.2, 0.2, 880)).toBeLessThan(0.002);
  const score = await amplitude(out, 0.2, 0.2, 220),
    ducked = await amplitude(out, 1.2, 0.2, 220);
  expect(ducked / score).toBeCloseTo(0.25, 1);
  expect(await amplitude(out, 3.0, 0.1, 660)).toBeCloseTo(0.125 * 10 ** (-6 / 20), 2);
  expect(await amplitude(out, 3.25, 0.1, 1320)).toBeGreaterThan(0.07);
  expect(await amplitude(out, 3.6, 0.1, 1320)).toBeLessThan(0.002);
}, 30000);
it("preserves non-dialogue native at zero dB without duck and represents all-lane mute as no audio", async () => {
  const f = await fixture();
  f.input.clips = [f.input.clips[3]!];
  const out = join(f.root, "native-score.mp4");
  await renderAudioMix(f.video, out, buildAudioMixPlan(f.input), f.paths, tools, run);
  expect(await amplitude(out, 1, 0.2, 440)).toBeGreaterThan(0.1);
  expect(await amplitude(out, 1, 0.2, 220)).toBeGreaterThan(0.05);
  const settings = audioMixSettings(undefined);
  for (const lane of Object.values(settings.lanes)) lane.muted = true;
  const muted = join(f.root, "muted.mp4");
  await renderAudioMix(
    f.video,
    muted,
    buildAudioMixPlan({ ...f.input, controls: { lanes: settings.lanes } }),
    f.paths,
    tools,
    run,
  );
  expect((await probeMixSource(muted, tools, run)).hasAudio).toBe(false);
}, 30000);
it("uses the original shared two-pass normalization only when explicitly requested and leaves silence not applicable", async () => {
  const { loadAudioNormalizer, normalizeMixedAudio } = await import("./film-audio-normalize.js");
  const runtime = await loadAudioNormalizer(resolve("../../packages/aivora-media"));
  const f = await fixture(),
    settings = audioMixSettings(undefined);
  settings.lanes.dialogue.muted = true;
  f.input.clips = [{ ...f.input.clips[3]!, gainDb: -20 }];
  const raw = join(f.root, "not-normalized.mp4"),
    normalized = join(f.root, "normalized.mp4");
  await renderAudioMix(
    f.video,
    raw,
    buildAudioMixPlan({ ...f.input, controls: { lanes: settings.lanes } }),
    f.paths,
    tools,
    run,
  );
  const before = await runtime.measureAudioLoudness(raw, tools.ffmpegPath, run);
  expect(Number(before.input_i)).toBeLessThan(-30);
  const original = await readFile(raw);
  await normalizeMixedAudio(raw, normalized, runtime, tools, run);
  const final = await runtime.measureAudioLoudness(normalized, tools.ffmpegPath, run);
  expect(Math.abs(Number(final.input_i) + 16)).toBeLessThanOrEqual(1);
  expect(Number(final.input_tp)).toBeLessThanOrEqual(-1);
  expect(runtime.assertNormalizedAudio(final)).toEqual({ applicable: true });
  expect(await readFile(raw)).toEqual(original);
  expect(runtime.assertNormalizedAudio({ input_i: "-inf", input_tp: "-inf" })).toEqual({
    applicable: false,
  });
}, 30000);
it("executes a shared curve with 100 separated speech windows without deep expression parsing", async () => {
  const f = await fixture(),
    original = await readFile(f.video);
  f.input.clips = Array.from({ length: 100 }, (_, index) => ({
    id: `voice-${index}`,
    sourceKey: "voice",
    lane: "dialogue" as const,
    shotId: "",
    takeId: "",
    label: "旁白",
    startSeconds: index * 0.04,
    durationSeconds: 0.02,
    offsetSeconds: 0.5,
    gainDb: 0,
  }));
  f.input.clips.push({
    id: "score",
    sourceKey: "score",
    lane: "score",
    shotId: "",
    takeId: "",
    label: "",
    startSeconds: 0,
    durationSeconds: 4,
    offsetSeconds: 0,
    gainDb: -6,
  });
  const plan = buildAudioMixPlan(f.input);
  expect(plan.duck.length).toBeGreaterThan(100);
  const output = join(f.root, "many-intervals.mp4");
  await renderAudioMix(f.video, output, plan, f.paths, tools, run);
  expect((await probeMixSource(output, tools, run)).videoDurationSeconds).toBeCloseTo(4, 2);
  expect(await amplitude(output, 1, 0.2, 220)).toBeGreaterThan(0.005);
  expect(await readFile(f.video)).toEqual(original);
  const { readdir } = await import("node:fs/promises");
  expect((await readdir(f.root)).some((name) => name.endsWith("audio-filter.txt"))).toBe(false);
}, 30000);
it("rejects a long complete Windows command before spawning, without dropping any track or retaining script files", async () => {
  const { audioMixCommandLength } = await import("./film-audio-mix.js");
  const f = await fixture();
  f.input.clips = Array.from({ length: 40 }, (_, index) => ({
    ...f.input.clips[0]!,
    id: `v${index}`,
    sourceKey: `v${index}`,
  }));
  const sources = { ...f.input.sources },
    paths = { ...f.paths };
  for (let index = 0; index < 40; index++) {
    sources[`v${index}`] = sources.voice!;
    paths[`v${index}`] = `C:\\long folder\\${"subdirectory ".repeat(80)}${index}.wav`;
  }
  const plan = buildAudioMixPlan({ ...f.input, sources });
  const called: unknown[] = [];
  const never: QcRunner = async (...args) => {
    called.push(args);
    throw new Error("must not spawn");
  };
  await expect(
    renderAudioMix(f.video, join(f.root, "too-long.mp4"), plan, paths, tools, never),
  ).rejects.toThrow("AUDIO_MIX_LIMIT");
  expect(called).toHaveLength(0);
  expect(plan.tracks).toHaveLength(40);
  const { readdir } = await import("node:fs/promises");
  expect((await readdir(f.root)).some((name) => name.endsWith("audio-filter.txt"))).toBe(false);
  expect(audioMixCommandLength("f", ["a b", "x\\"])).toBe(11);
});
it("runs the unchanged real two-aspect QC with explicit normalize on/off and rechecks the actual final audio", async () => {
  const { copyFile, mkdir } = await import("node:fs/promises"),
    { createFilmExportQc } = await import("./film-export-qc.js"),
    { writeProject } = await import("./film-library.js"),
    { loadQcEngine } = await import("./film-export-qc-runtime.js"),
    { loadAudioNormalizer } = await import("./film-audio-normalize.js");
  const f = await fixture(),
    filmsRoot = join(f.root, "films"),
    projectId = `film_${"c".repeat(16)}`,
    seriesId = `film_${"d".repeat(16)}`,
    media = join(filmsRoot, seriesId, "episodes", projectId, "media");
  await mkdir(media, { recursive: true });
  const video = join(media, "selected.mp4"),
    score = join(media, "score.wav");
  await copyFile(f.video, video);
  await copyFile(f.paths.score!, score);
  const before = await readFile(video);
  const settings = audioMixSettings(undefined);
  settings.lanes.dialogue.muted = true;
  const base = {
    id: projectId,
    seriesId,
    title: "四轨响度",
    audioMix: settings,
    shots: [
      {
        id: "shot",
        seconds: 4,
        line: "",
        selectedTakeId: "take",
        takes: [{ id: "take", shotId: "shot", status: "done", videoPath: video }],
      },
    ],
    audioClips: [
      {
        id: "score",
        lane: "score",
        shotId: "",
        takeId: "",
        label: "",
        startSeconds: 0,
        durationSeconds: 4,
        offsetSeconds: 0,
        gainDb: -20,
        path: score,
      },
    ],
  };
  await writeProject(filmsRoot, base);
  const qc = createFilmExportQc({
    filmsRoot,
    storyFilmsRoot: join(f.root, "story"),
    temporaryRoot: join(f.root, "qc"),
    tools: async () => tools,
    engine: () => loadQcEngine(resolve("../../packages/aivora-qc")),
    normalizer: () => loadAudioNormalizer(resolve("../../packages/aivora-media")),
    font: () => resolve("../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf"),
    pickDirectory: async () => null,
  });
  const input = {
    projectId,
    expectedSelection: [{ shotId: "shot", takeId: "take" }],
    settings: {
      aspects: ["16:9", "9:16"] as ("16:9" | "9:16")[],
      quality: "720p" as const,
      subtitles: "none" as const,
      style: "white" as const,
      aiMark: false,
    },
  };
  const raw = await qc.prepare("owner", input);
  expect(raw.kind).toBe("READY");
  if (raw.kind !== "READY") throw new Error(raw.code);
  for (const output of raw.outputs)
    expect(
      (output.report as { audio: { integratedLufs: number } }).audio.integratedLufs,
    ).toBeLessThan(-30);
  expect(raw.unverified.join()).toContain("自动调整音量已关闭");
  await qc.discard("owner", raw.qcReceipt);
  settings.autoAdjustVolume = true;
  await writeProject(filmsRoot, { ...base, audioMix: settings });
  expect(await qc.prepare("owner", input)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  const normalized = await qc.prepare("owner", {
    ...input,
    settings: { ...input.settings, autoAdjustVolume: true },
  });
  expect(normalized.kind).toBe("READY");
  if (normalized.kind !== "READY") throw new Error(normalized.code);
  for (const output of normalized.outputs) {
    const report = output.report as {
      schemaVersion: number;
      audio: { integratedLufs: number; truePeakDbtp: number };
    };
    expect(report.schemaVersion).toBe(1);
    expect(Math.abs(report.audio.integratedLufs + 16)).toBeLessThanOrEqual(1);
    expect(report.audio.truePeakDbtp).toBeLessThanOrEqual(-1);
  }
  expect(await readFile(video)).toEqual(before);
  await qc.discard("owner", normalized.qcReceipt);
}, 30000);

it("repeats short global score after offset across the full film and leaves explicit nonloop silent at the tail", async () => {
  const { root, video, paths, input } = await fixture();
  const short = join(root, "short.wav");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=48000:duration=1",
    short,
  ]);
  const before = await readFile(short);
  paths.score = short;
  input.sources.score = await probeMixSource(short, tools, run);
  input.clips = [{ ...input.clips[3]!, offsetSeconds: 0.2, durationSeconds: 0, gainDb: 0 }];
  input.shots[0]!.hasDialogue = false;
  const settings = audioMixSettings(undefined);
  settings.lanes.dialogue.muted = true;
  const plan = buildAudioMixPlan({ ...input, controls: { lanes: settings.lanes } });
  expect(plan.tracks[0]!.loopSeconds).toBeCloseTo(0.8);
  const repeated = join(root, "repeated.mp4");
  await renderAudioMix(video, repeated, plan, paths, tools, run);
  const head = await amplitude(repeated, 0.2, 0.2, 220),
    tail = await amplitude(repeated, 3.4, 0.2, 220);
  expect(tail).toBeGreaterThan(head * 0.85);
  const stopped = join(root, "stopped.mp4");
  input.clips[0]!.loop = false;
  await renderAudioMix(
    video,
    stopped,
    buildAudioMixPlan({ ...input, controls: { lanes: settings.lanes } }),
    paths,
    tools,
    run,
  );
  expect(await amplitude(stopped, 3.4, 0.2, 220)).toBeLessThan(head * 0.01);
  expect(await readFile(short)).toEqual(before);
});

it("cancels an actual managed mix child, waits for close and removes its private filter script without touching sources", async () => {
  const { root, video, paths, input } = await fixture();
  const before = await readFile(video);
  const controller = new AbortController();
  const managed = await loadQcRunner(resolve("../../packages/aivora-qc"));
  let pid = 0,
    closed = false;
  const running: QcRunner = (binary, args, options) => {
    const paced = [...args],
      first = paced.indexOf("-i");
    paced.splice(first, 0, "-re");
    return managed(binary, paced, {
      ...options,
      onProcess: (value, done) => {
        pid = value;
        if (done) closed = true;
        else setTimeout(() => controller.abort(), 80);
      },
    });
  };
  await expect(
    renderAudioMix(
      video,
      join(root, "cancelled.mp4"),
      buildAudioMixPlan(input),
      paths,
      tools,
      running,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(pid).toBeGreaterThan(0);
  expect(closed).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
  expect((await readdir(root)).filter((name) => name.endsWith(".audio-filter.txt"))).toEqual([]);
  expect(await readFile(video)).toEqual(before);
});

it("executes cropped and master fades multiplied with absolute automation gain on a real looping source", async () => {
  const f = await fixture(),
    original = await readFile(f.video);
  const short = join(f.root, "short-loop.wav");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=0.4",
    "-c:a",
    "pcm_s16le",
    short,
  ]);
  f.paths.ambience = short;
  f.input.sources.ambience = await probeMixSource(short, tools, run);
  const source = await readFile(short);
  const settings = audioMixSettings(undefined);
  settings.lanes.dialogue.muted = true;
  settings.lanes.ambience.gainDb = -2;
  f.input.clips = [
    {
      ...f.input.clips[1]!,
      startSeconds: 0,
      durationSeconds: 4,
      offsetSeconds: 0,
      gainDb: -3,
      loop: true,
      envelope: {
        schemaVersion: 1,
        baseGainDb: -6,
        fades: [
          { direction: "in", startSeconds: -0.25, durationSeconds: 0.5 },
          { direction: "in", startSeconds: 0, durationSeconds: 2 },
          { direction: "out", startSeconds: 3, durationSeconds: 1 },
        ],
        gainAutomation: [
          { startSeconds: 1, endSeconds: 2, gainDb: -12 },
          { startSeconds: 2, endSeconds: 3, gainDb: -9 },
        ],
      },
    },
  ];
  // A short loop boundary occurs well inside both fades/automation; only source time loops.
  const plan = buildAudioMixPlan({ ...f.input, controls: { lanes: settings.lanes } }),
    output = join(f.root, "envelopes.mp4");
  await renderAudioMix(f.video, output, plan, f.paths, tools, run);
  const { evaluateAudioMix } = await import("@aijian/contracts/film-audio-mix-plan");
  for (const at of [0.2, 0.6, 1.25, 2.4, 3.45]) {
    const expected = 0.125 * evaluateAudioMix(plan, at + 0.05)[0]!.gain;
    const measured = await amplitude(output, at, 0.1, 660);
    expect(Math.abs(measured - expected)).toBeLessThan(Math.max(0.001, expected * 0.08));
  }
  expect(await readFile(f.video)).toEqual(original);
  expect(await readFile(f.paths.ambience!)).toEqual(source);
}, 30000);

it("really evaluates all 64 automation ranges through balanced numeric script without a parser-depth bypass", async () => {
  const f = await fixture(),
    settings = audioMixSettings(undefined);
  settings.lanes.dialogue.muted = true;
  f.input.clips = [
    {
      ...f.input.clips[1]!,
      startSeconds: 0,
      durationSeconds: 4,
      gainDb: 0,
      envelope: {
        schemaVersion: 1,
        baseGainDb: 0,
        gainAutomation: Array.from({ length: 64 }, (_, index) => ({
          startSeconds: index * 0.05,
          endSeconds: (index + 1) * 0.05,
          gainDb: index % 2 ? -18 : -6,
        })),
      },
    },
  ];
  const output = join(f.root, "many-envelopes.mp4");
  await renderAudioMix(
    f.video,
    output,
    buildAudioMixPlan({ ...f.input, controls: { lanes: settings.lanes } }),
    f.paths,
    tools,
    run,
  );
  for (const index of [0, 1, 30, 31, 62, 63]) {
    const expected = 0.125 * 10 ** ((index % 2 ? -18 : -6) / 20);
    expect(await amplitude(output, index * 0.05 + 0.015, 0.025, 660)).toBeCloseTo(expected, 2);
  }
}, 30000);
