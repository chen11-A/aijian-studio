import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createFilmAudioLibrary } from "./film-audio-library";
import { writeProject, readProject, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import {
  loadTrustedAudioLibrary,
  loadTrustedAudioPicker,
  type TrustedAudioLibrary,
} from "./film-audio-library-runtime";
import { compileShotAudioSuggestion, shotAudioContext } from "./film-shot-audio-suggestions";
import {
  loadQcRunner,
  verifiedQcTools,
  type QcTools,
  type QcRunner,
} from "./film-export-qc-runtime";
const execute = promisify(execFile),
  roots: string[] = [];
let bundle: string, tools: QcTools, run: QcRunner, library: TrustedAudioLibrary;
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function tool(name: string) {
  const configured = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (configured && existsSync(configured)) return configured;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(directory, name + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(path)) return path;
  }
  throw Error("Pinned tools unavailable");
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
  bundle = join(await mkdtemp(join(tmpdir(), "shot-audio-bundle-")), "audio-library");
  await execute(process.execPath, [
    resolve("../../scripts/build-audio-library-resources.mjs"),
    "--out-dir",
    bundle,
  ]);
  library = await loadTrustedAudioLibrary(bundle);
}, 30000);
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(dirname(bundle), { recursive: true, force: true });
});
async function fixture(
  options: {
    clean?: boolean;
    mood?: string;
    picture?: string;
    sfx?: unknown[];
    nodes?: unknown[];
    emptyScene?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "单镜 配声建议 "));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const id = "film_aaaaaaaaaaaaaaaa",
    seriesId = "film_bbbbbbbbbbbbbbbb";
  const episode = join(filmsRoot, seriesId, "episodes", id),
    media = join(episode, "media");
  await mkdir(media, { recursive: true });
  await mkdir(storyFilmsRoot);
  const native = join(media, "native.mp4"),
    clean = join(media, "clean.mp4");
  const generate = (path: string, seconds: number, blue = false) =>
    run(tools.ffmpegPath, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `${blue ? "color=c=blue:" : "testsrc2="}s=160x90:r=24:d=${seconds}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      path,
    ]);
  await generate(native, 2);
  if (options.clean) await generate(clean, 1);
  const record = await writeProject(filmsRoot, {
    id,
    seriesId,
    title: "当前镜头",
    scenes: [
      {
        id: "scene",
        title: options.emptyScene ? "" : "普通室内",
        where: options.emptyScene ? "" : "室内",
        ambience: "",
      },
    ],
    shots: [
      {
        id: "shot",
        sceneId: "scene",
        line: "",
        seconds: 99,
        picture: options.picture ?? "雨夜街道，手机震动",
        selectedTakeId: "take",
        sound: { musicMood: options.mood ?? "温暖", sfx: options.sfx ?? [], ambience: "" },
        actionPlan: { nodes: options.nodes ?? [] },
        takes: [
          {
            id: "take",
            shotId: "shot",
            status: "done",
            videoPath: native,
            ...(options.clean ? { cleanVideoPath: clean } : {}),
          },
        ],
      },
      { id: "unmade", takes: [], selectedTakeId: "" },
    ],
    audioClips: [{ id: "old-bad", lane: "score", path: "/must-not-read-old-audio.ogg", gainDb: 0 }],
  });
  let effect: ((path: string, count: number) => Promise<void>) | undefined;
  const counts = new Map<string, number>();
  const observed: QcRunner = vi.fn(async (binary, args, opts) => {
    const result = await run(binary, args, opts),
      path = args.at(-1)!;
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    await effect?.(path, count);
    return result;
  });
  const host = {
    filmsRoot,
    storyFilmsRoot,
    libraryRoot: vi.fn(() => bundle),
    tools: vi.fn(async () => tools),
    run: observed,
    videoOwner: vi.fn(async () => false),
    beforeCommit: vi.fn(),
  };
  const api = createFilmAudioLibrary(host);
  const input = {
    projectId: id,
    expectedProjectHash: filmHistoryRecordHash(record),
    shotId: "shot",
    takeId: "take",
  };
  const matches = async (path: string, expected: string) => {
    const [a, b] = await Promise.all([
      stat(path, { bigint: true }),
      stat(expected, { bigint: true }),
    ]);
    return a.dev === b.dev && a.ino === b.ino;
  };
  return {
    root,
    episode,
    media,
    native,
    clean,
    record,
    host,
    api,
    input,
    generate,
    matches,
    effect: (next: typeof effect) => {
      effect = next;
    },
    save: (next: FilmRecord) => writeProject(filmsRoot, next),
    read: () => readProject(filmsRoot, id),
  };
}
it("returns complete safe suggestions on the actual clean clock without writing, copying or consulting unmade shots/old audio", async () => {
  const f = await fixture({ clean: true, sfx: [{ atSeconds: 0, text: "手机震动" }] });
  const before = await readFile(join(f.episode, "project.json")),
    native = await readFile(f.native),
    clean = await readFile(f.clean);
  const result = await f.api.suggestBundledFilmShotAudio(f.input);
  expect(result.kind).toBe("SUGGESTED");
  if (result.kind !== "SUGGESTED") throw Error(result.code);
  expect(result.durationSeconds).toBe(1);
  expect(result.clips.some((clip) => clip.lane === "score" && clip.placement.gainDb === 0)).toBe(
    true,
  );
  expect(
    result.clips.some((clip) => clip.lane === "sfx" && clip.placement.startSeconds === 0),
  ).toBe(true);
  expect(result.limitations.map((note) => note.code)).not.toContain("DEVICE_TIME_UNCONFIRMED");
  expect(
    result.clips.every(
      (clip) => clip.placement.startSeconds + clip.placement.durationSeconds <= 1 + 1e-6,
    ),
  ).toBe(true);
  expect(result.clips.filter((clip) => clip.lane === "ambience")).toHaveLength(2);
  expect(result.catalogSha256).toBe(library.manifestSha256);
  expect(result.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const pin = JSON.parse(await readFile(join(bundle, "resource-index.json"), "utf8"));
  expect(result.pickerSha256).toBe(
    sha(
      Buffer.from(
        JSON.stringify(["audio-picker-runtime-v1", pin.pickerSha256, pin.synonymsSha256]),
      ),
    ),
  );
  const json = JSON.stringify(result);
  for (const forbidden of [
    bundle,
    f.native,
    f.clean,
    "must-not-read-old-audio",
    '"path":',
    '"file":',
  ])
    expect(json).not.toContain(forbidden);
  expect(await readFile(join(f.episode, "project.json"))).toEqual(before);
  expect(await readFile(f.native)).toEqual(native);
  expect(await readFile(f.clean)).toEqual(clean);
  expect((await readdir(f.media)).sort()).toEqual(["clean.mp4", "native.mp4"]);
  expect(f.host.beforeCommit).not.toHaveBeenCalled();
}, 30000);
it.each([
  ["克制", false, "MUSIC_QUIET"],
  ["克制但紧张", true, ""],
  ["不要配乐，紧张", false, "MUSIC_DISABLED"],
  ["", false, "MUSIC_MOOD_UNDECIDED"],
  ["没有匹配标签XYZ", false, "MUSIC_MATCH_MISSING"],
])(
  "delegates mood %s to the original picker without inventing silence/music",
  async (mood, hasMusic, code) => {
    const f = await fixture({ mood: String(mood), picture: "普通室内" });
    const result = await f.api.suggestBundledFilmShotAudio(f.input);
    expect(result.kind).toBe("SUGGESTED");
    if (result.kind !== "SUGGESTED") throw Error(result.code);
    expect(result.clips.some((clip) => clip.lane === "score")).toBe(hasMusic);
    if (code) expect(result.limitations.map((note) => note.code)).toContain(code);
  },
  30000,
);
it.each(["none", "sound-zero", "node-zero", "unknown", "out-of-range"])(
  "distinguishes explicit0 from unconfirmed device timing (%s)",
  async (kind) => {
    const f = await fixture({
      mood: "",
      picture: "手机震动",
      sfx:
        kind === "sound-zero"
          ? [{ atSeconds: 0, text: "手机震动" }]
          : kind === "out-of-range"
            ? [{ atSeconds: 2, text: "手机震动" }]
            : [],
      nodes:
        kind === "node-zero"
          ? [{ at: 0, move: "手机震动" }]
          : kind === "unknown"
            ? [{ at: null, move: "手机震动" }]
            : [],
    });
    const result = await f.api.suggestBundledFilmShotAudio(f.input);
    expect(result.kind).toBe("SUGGESTED");
    if (result.kind !== "SUGGESTED") throw Error(result.code);
    const explicit = kind === "sound-zero" || kind === "node-zero";
    expect(result.clips.some((clip) => clip.lane === "sfx")).toBe(explicit);
    expect(result.limitations.some((note) => note.code === "DEVICE_TIME_UNCONFIRMED")).toBe(
      !explicit,
    );
  },
  30000,
);
it.each(["project", "take", "bytes", "clean-bytes"])(
  "rejects late %s changes and retains the real record/media",
  async (kind) => {
    const f = await fixture({ clean: kind === "clean-bytes" });
    const source = kind === "clean-bytes" ? f.clean : f.native;
    const sourceBefore = sha(await readFile(source));
    const recordBefore = await readFile(join(f.episode, "project.json"));
    let injected = 0;
    f.effect(async (path, count) => {
      if (
        injected ||
        count !== (kind === "bytes" || kind === "clean-bytes" ? 2 : 1) ||
        !(await f.matches(path, source))
      )
        return;
      injected++;
      if (kind === "bytes" || kind === "clean-bytes") {
        await f.generate(source, kind === "clean-bytes" ? 1 : 2, true);
        expect(sha(await readFile(path))).not.toBe(sourceBefore);
      } else {
        const next = structuredClone(f.record);
        if (kind === "project") next.title = "later edit";
        else (next.shots![0] as Record<string, unknown>).selectedTakeId = "another";
        await f.save(next);
      }
    });
    expect(await f.api.suggestBundledFilmShotAudio(f.input)).toMatchObject({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
      unchanged: true,
    });
    expect(injected).toBe(1);
    if (kind === "bytes" || kind === "clean-bytes") {
      expect(sha(await readFile(source))).not.toBe(sourceBefore);
      expect(await readFile(join(f.episode, "project.json"))).toEqual(recordBefore);
    }
    expect(f.host.beforeCommit).not.toHaveBeenCalled();
  },
  30000,
);
it("shares active BUSY ownership with target/add and never releases another operation", async () => {
  const f = await fixture();
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      enter = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  let held = false;
  f.effect(async () => {
    if (!held) {
      held = true;
      enter();
      await wait;
    }
  });
  const pending = f.api.suggestBundledFilmShotAudio(f.input);
  try {
    await started;
    for (let i = 0; i < 2; i++) {
      expect(await f.api.suggestBundledFilmShotAudio(f.input)).toMatchObject({ code: "BUSY" });
      expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toMatchObject({ code: "BUSY" });
    }
    const asset = library.assets[0]!;
    expect(
      await f.api.addBundledFilmAudio({
        ...f.input,
        catalogSha256: library.manifestSha256,
        assetId: asset.id,
        expectedAssetSha256: asset.sha256,
        lane: "score",
        placement: {
          startSeconds: 0,
          durationSeconds: 0.1,
          offsetSeconds: 0,
          gainDb: 0,
          loop: false,
        },
      }),
    ).toMatchObject({ kind: "FAILED", code: "BUSY" });
  } finally {
    release();
  }
  expect((await pending).kind).toBe("SUGGESTED");
  expect((await f.api.inspectBundledFilmAudioTarget(f.input)).kind).toBe("TARGET");
}, 30000);
it.each([128, 129])(
  "keeps the original track bound without truncating %i real picker action segments",
  async (count) => {
    const f = await fixture({
      mood: "",
      picture: "手机震动",
      emptyScene: true,
      sfx: Array.from({ length: count }, (_, i) => ({ atSeconds: i / 1000, text: "手机震动" })),
    });
    const before = await readFile(join(f.episode, "project.json"));
    const result = await f.api.suggestBundledFilmShotAudio(f.input);
    if (count === 128) {
      expect(result.kind).toBe("SUGGESTED");
      if (result.kind === "SUGGESTED") expect(result.clips).toHaveLength(128);
    } else
      expect(result).toMatchObject({ kind: "FAILED", code: "PLAN_UNSUPPORTED", unchanged: true });
    expect(await readFile(join(f.episode, "project.json"))).toEqual(before);
  },
  30000,
);
it("rejects exact-shape/identity failures before tools or bundle access", async () => {
  const f = await fixture();
  for (const change of [
    { path: "/forged" },
    { projectId: f.record.seriesId },
    { takeId: "old" },
    { expectedProjectHash: "0".repeat(64) },
  ])
    expect((await f.api.suggestBundledFilmShotAudio({ ...f.input, ...change })).kind).toBe(
      "FAILED",
    );
  expect(f.host.tools).not.toHaveBeenCalled();
  expect(f.host.libraryRoot).not.toHaveBeenCalled();
  expect(f.host.run).not.toHaveBeenCalled();
}, 30000);
it("compiles original nonloop multi-resource segments/master once, preserving every fade and gain reference", async () => {
  const picker = await loadTrustedAudioPicker(bundle);
  const raw = picker.pickAudio(
    {
      duration: 130,
      emotions: ["温暖"],
      description: "温暖场景",
      shots: [{ duration: 130, hasDialogue: false, actions: [] }],
    },
    library.assets
      .filter((a) => a.type === "music" && !a.loopable)
      .map((a) => ({ ...a, path: a.file, duration: a.durationSeconds, loop: false })),
  );
  const result = compileShotAudioSuggestion(raw, library, 130, true, 128);
  const music = (raw as { music: { segments: unknown[] } }).music;
  expect(result.clips).toHaveLength(music.segments.length);
  expect(result.clips.length).toBeGreaterThan(1);
  expect(new Set(result.clips.map((c) => c.asset.id)).size).toBeGreaterThan(1);
  expect(
    result.clips[1]!.envelope!.fades!.some(
      (f) => f.direction === "in" && f.durationSeconds === 0.5,
    ),
  ).toBe(true);
  expect(result.clips.every((c) => c.placement.loop === false && c.placement.gainDb === 0)).toBe(
    true,
  );
  const context = shotAudioContext(
    { id: "p", seriesId: "s", shots: [{ id: "x", sound: { musicMood: "克制但紧张" } }] },
    "x",
    2,
  );
  expect(context.scene.emotions).toContain("紧张");
}, 30000);

it.each(["missing", "resolver-throws"])(
  "reports unavailable resource root as LIBRARY_UNAVAILABLE (%s) without writing",
  async (kind) => {
    const f = await fixture(),
      before = await readFile(join(f.episode, "project.json"));
    f.host.libraryRoot.mockImplementation(() => {
      if (kind === "resolver-throws") throw Error("/private/resolver");
      return join(f.root, "missing-bundle");
    });
    const result = await f.api.suggestBundledFilmShotAudio(f.input);
    expect(result).toEqual({ kind: "FAILED", code: "LIBRARY_UNAVAILABLE", unchanged: true });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(await readFile(join(f.episode, "project.json"))).toEqual(before);
    expect(f.host.beforeCommit).not.toHaveBeenCalled();
    expect(await readdir(f.media)).toEqual(["native.mp4"]);
  },
  30000,
);

it("preserves negative cropped fade origin, sourceStart and adjacent final-gain overrides without doubling the ambience view", () => {
  const asset = library.assets.find((a) => a.type === "sfx" && a.durationSeconds > 2)!;
  const master = {
    gainDb: -6,
    gainAutomation: [
      { start: 0, end: 0.5, gainDb: -12 },
      { start: 0.5, end: 1, gainDb: -6 },
    ],
    segments: [
      {
        assetId: asset.id,
        path: "/must-not-use-raw-picker-path",
        time: 0,
        end: 1,
        sourceStart: 1,
        fadeIn: 0.5,
        fadeInStart: -0.25,
        fadeOut: 0.2,
        fadeOutStart: 0.8,
      },
    ],
  };
  const compiled = compileShotAudioSuggestion(
    {
      ambience: [master],
      music: null,
      shots: [{ ambience: [master], effects: [] }],
      warnings: [],
      reason: "安静情绪保留留白",
    },
    library,
    1,
    true,
    128,
  );
  expect(compiled.clips).toHaveLength(1);
  const clip = compiled.clips[0]!;
  expect(clip.placement.offsetSeconds).toBe(1);
  expect(clip.envelope).toMatchObject({
    baseGainDb: -6,
    fades: [
      { direction: "in", startSeconds: -0.25, durationSeconds: 0.5 },
      { direction: "out", startSeconds: 0.8, durationSeconds: 0.2 },
    ],
    gainAutomation: [
      { startSeconds: 0, endSeconds: 0.5, gainDb: -12 },
      { startSeconds: 0.5, endSeconds: 1, gainDb: -6 },
    ],
  });
  expect(JSON.stringify(compiled)).not.toContain("must-not-use-raw");
});
it.each(["asset", "entry", "synonyms", "root"])(
  "rejects a late %s change instead of returning stale suggestions",
  async (kind) => {
    const f = await fixture();
    let injected = false;
    const path =
      kind === "asset"
        ? library.assets[0]!.file
        : join(bundle, kind === "entry" ? "audio-picker.mjs" : "audio-picker-synonyms.mjs");
    const original = kind === "root" ? null : await readFile(path);
    f.effect(async (file, count) => {
      if (injected || count !== 2 || !(await f.matches(file, f.native))) return;
      injected = true;
      if (kind === "root") f.host.libraryRoot.mockReturnValue(join(f.root, "missing-late-root"));
      else await writeFile(path, Buffer.concat([original!, Buffer.from("\n")]));
    });
    try {
      expect(await f.api.suggestBundledFilmShotAudio(f.input)).toMatchObject({
        kind: "FAILED",
        code: "ASSET_CHANGED",
        unchanged: true,
      });
      expect(injected).toBe(true);
      expect(f.host.beforeCommit).not.toHaveBeenCalled();
    } finally {
      if (original) await writeFile(path, original);
    }
  },
  30000,
);
it("covers both compiled modules and reloads their new pinned identity without using stale import-cache code", async () => {
  const root = await mkdtemp(join(tmpdir(), "picker-pin-version-"));
  roots.push(root);
  for (const name of ["resource-index.json", "audio-picker.mjs", "audio-picker-synonyms.mjs"])
    await writeFile(join(root, name), await readFile(join(bundle, name)));
  const first = await loadTrustedAudioPicker(root);
  const scene = {
    duration: 1,
    description: "",
    emotions: [],
    shots: [{ duration: 1, hasDialogue: false, actions: [] }],
  };
  expect(first.pickAudio(scene, [])).not.toHaveProperty("versionProbe");
  const syn = await readFile(join(root, "audio-picker-synonyms.mjs"));
  const newSyn = Buffer.concat([syn, Buffer.from("\n// pinned dependency version\n")]);
  const pin = JSON.parse(await readFile(join(root, "resource-index.json"), "utf8"));
  const previous = pin.synonymsSha256;
  pin.synonymsSha256 = sha(newSyn);
  await writeFile(join(root, "audio-picker-synonyms.mjs"), newSyn);
  const entry =
    (await readFile(join(root, "audio-picker.mjs"), "utf8")).replace(previous, pin.synonymsSha256) +
    "\nconst originalPick=pickAudio;pickAudio=(scene,assets)=>({...originalPick(scene,assets),versionProbe:'v2'});\n";
  pin.pickerSha256 = sha(Buffer.from(entry));
  await writeFile(join(root, "audio-picker.mjs"), entry);
  await writeFile(join(root, "resource-index.json"), JSON.stringify(pin));
  await expect(first.verify()).rejects.toThrow("ASSET_CHANGED");
  const second = await loadTrustedAudioPicker(root);
  expect(second.sha256).not.toBe(first.sha256);
  expect(second.pickAudio(scene, [])).toHaveProperty("versionProbe", "v2");
});

it("separates fresh raw CAS hashes from stable reviewed intent across savedAt-only writes", async () => {
  const f = await fixture();
  const suggest = async (record: FilmRecord) => {
    const result = await f.api.suggestBundledFilmShotAudio({
      ...f.input,
      expectedProjectHash: filmHistoryRecordHash(record),
    });
    if (result.kind !== "SUGGESTED") throw Error(result.code);
    return result;
  };
  const first = await suggest(f.record);
  // A real canonical save changes savedAt, without holding an API reservation for review.
  const stored = await f.save({ ...f.record, savedAt: "2000-01-01T00:00:00.000Z" });
  expect(filmHistoryRecordHash(stored)).not.toBe(first.projectHash);
  const saved = await suggest(stored);
  expect(saved.projectHash).toBe(filmHistoryRecordHash(stored));
  expect(saved.planFingerprint).toBe(first.planFingerprint);
  expect(await f.api.suggestBundledFilmShotAudio(f.input)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  const edited = structuredClone(stored);
  (edited.shots![0] as Record<string, unknown>).picture = "同一地点的新画面描述";
  const creative = await suggest(await f.save(edited));
  expect(creative.planFingerprint).not.toBe(saved.planFingerprint);
  const mixEdit = structuredClone(edited);
  mixEdit.audioMix = {
    schemaVersion: 1,
    autoAdjustVolume: false,
    lanes: Object.fromEntries(
      ["dialogue", "ambience", "score", "sfx"].map((lane) => [
        lane,
        { gainDb: lane === "score" ? -3 : 0, muted: false },
      ]),
    ),
  };
  expect((await suggest(await f.save(mixEdit))).planFingerprint).not.toBe(creative.planFingerprint);
});

it("binds reviewed intent to actual source bytes and clock even when the raw record is unchanged", async () => {
  const f = await fixture();
  const suggest = async () => {
    const result = await f.api.suggestBundledFilmShotAudio(f.input);
    if (result.kind !== "SUGGESTED") throw Error(result.code);
    return result;
  };
  const initial = await suggest(),
    before = sha(await readFile(f.native));
  await f.generate(f.native, 2, true);
  expect(sha(await readFile(f.native))).not.toBe(before);
  const bytes = await suggest();
  expect(bytes.projectHash).toBe(initial.projectHash);
  expect(bytes.durationSeconds).toBe(initial.durationSeconds);
  expect(bytes.planFingerprint).not.toBe(initial.planFingerprint);
  await f.generate(f.native, 1.5, true);
  const clock = await suggest();
  expect(clock.projectHash).toBe(initial.projectHash);
  expect(clock.durationSeconds).toBe(1.5);
  expect(clock.planFingerprint).not.toBe(bytes.planFingerprint);
});

it("keeps native and visual roles distinct when identical SHA sets exchange roles", async () => {
  const f = await fixture({ clean: true });
  // Make both clocks equal: role binding, not duration or asset choice, must invalidate review.
  await f.generate(f.clean, 2, true);
  const first = await f.api.suggestBundledFilmShotAudio(f.input);
  if (first.kind !== "SUGGESTED") throw Error(first.code);
  const changed = structuredClone(f.record);
  const take = (changed.shots![0] as { takes: { videoPath: string; cleanVideoPath?: string }[] })
    .takes[0]!;
  [take.videoPath, take.cleanVideoPath] = [take.cleanVideoPath!, take.videoPath];
  const stored = await f.save(changed);
  const second = await f.api.suggestBundledFilmShotAudio({
    ...f.input,
    expectedProjectHash: filmHistoryRecordHash(stored),
  });
  if (second.kind !== "SUGGESTED") throw Error(second.code);
  expect(second.durationSeconds).toBe(first.durationSeconds);
  expect(second.clips).toEqual(first.clips);
  expect(second.planFingerprint).not.toBe(first.planFingerprint);
});
