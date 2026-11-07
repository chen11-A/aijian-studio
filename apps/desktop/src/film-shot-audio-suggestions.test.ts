import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  audioSuggestionGroupInputs,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import { resolveAudioMix } from "./film-audio-mix-sources";
import { renderAudioMix } from "./film-audio-mix";
import { createProjectArchives } from "./film-project-archive";
import { loadProjectArchiveEngine } from "./film-project-archive-runtime";
import { pathToFileURL } from "node:url";
import { createFilmAudioLibrary } from "./film-audio-library";
import { writeProject, readProject, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import {
  loadTrustedAudioLibrary,
  loadTrustedAudioPicker,
  type TrustedAudioLibrary,
} from "./film-audio-library-runtime";
import {
  compileShotAudioSuggestion,
  shotAudioContext,
  compileSceneAudioSuggestion,
  sceneAudioContext,
} from "./film-shot-audio-suggestions";
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

it("crops the scene master once across actual shot clocks without resetting source offsets or fading twice", () => {
  const asset = library.assets.find((asset) => asset.type === "sfx" && asset.durationSeconds > 5)!;
  const master = {
    gainDb: -6,
    gainAutomation: [
      { start: 0, end: 2, gainDb: -12 },
      { start: 2, end: 4, gainDb: -6 },
    ],
    segments: [
      {
        assetId: asset.id,
        time: 0,
        end: 4,
        sourceStart: 1,
        fadeIn: 3,
        fadeInStart: -0.2,
        fadeOut: 1,
        fadeOutStart: 3,
      },
    ],
  };
  const result = compileSceneAudioSuggestion(
    {
      ambience: [master],
      music: null,
      shots: [
        { ambience: [master], effects: [] },
        { ambience: [master], effects: [] },
      ],
      warnings: [],
    },
    library,
    [
      { shotId: "a", takeId: "a1", startSeconds: 0, durationSeconds: 2 },
      { shotId: "b", takeId: "b1", startSeconds: 2, durationSeconds: 2 },
    ],
    false,
    128,
  );
  expect(result.clips).toHaveLength(2);
  expect(
    result.clips.map((clip) => [
      clip.shotId,
      clip.placement.startSeconds,
      clip.placement.durationSeconds,
      clip.placement.offsetSeconds,
    ]),
  ).toEqual([
    ["a", 0, 2, 1],
    ["b", 0, 2, 3],
  ]);
  expect(result.clips[1]!.envelope).toMatchObject({
    baseGainDb: -6,
    fades: [
      { direction: "in", startSeconds: -2.2, durationSeconds: 3 },
      { direction: "out", startSeconds: 1, durationSeconds: 1 },
    ],
    gainAutomation: [{ startSeconds: 0, endSeconds: 2, gainDb: -6 }],
  });
  expect(() =>
    compileSceneAudioSuggestion(
      { ambience: [master], music: null, shots: [{ effects: [] }, { effects: [] }], warnings: [] },
      library,
      [
        { shotId: "a", takeId: "a1", startSeconds: 0, durationSeconds: 2 },
        { shotId: "b", takeId: "b1", startSeconds: 2, durationSeconds: 2 },
      ],
      false,
      1,
    ),
  ).toThrow("PLAN_UNSUPPORTED");
});
it("suggests and atomically adds a complete scene with a verified full-film prefix and exact selected versions", async () => {
  const f = await fixture({ mood: "温暖", picture: "雨夜街道" });
  const original = f.record.shots![0] as Record<string, unknown>;
  const shot = (id: string, sceneId: string) => ({
    ...original,
    id,
    sceneId,
    selectedTakeId: `take-${id}`,
    takes: [{ ...(original.takes as Record<string, unknown>[])[0], id: `take-${id}`, shotId: id }],
  });
  const stored = await f.save({
    ...f.record,
    scenes: [
      ...(Array.isArray(f.record.scenes) ? f.record.scenes : []),
      { id: "prefix", title: "前场" },
    ],
    shots: [shot("prefix", "prefix"), shot("a", "scene"), shot("b", "scene")],
    audioClips: [],
  });
  const input = {
    projectId: stored.id,
    expectedProjectHash: filmHistoryRecordHash(stored),
    sceneId: "scene",
    expectedSelection: [
      { shotId: "prefix", takeId: "take-prefix" },
      { shotId: "a", takeId: "take-a" },
      { shotId: "b", takeId: "take-b" },
    ],
  };
  const bytes = await readFile(join(f.episode, "project.json")),
    native = await readFile(f.native);
  const result = await f.api.suggestBundledFilmSceneAudio(input);
  expect(result.kind).toBe("SCENE_SUGGESTED");
  if (result.kind !== "SCENE_SUGGESTED") return;
  expect(result.clock.durationSeconds).toBe(6);
  expect(result.sceneStartSeconds).toBe(2);
  expect(result.sceneDurationSeconds).toBe(4);
  expect(result.clips.length).toBeGreaterThan(0);
  expect(result.clips.every((clip) => ["a", "b"].includes(clip.shotId))).toBe(true);
  expect(await readFile(join(f.episode, "project.json"))).toEqual(bytes);
  expect(JSON.stringify(result)).not.toContain(f.root);
  const applied = await f.api.applyBundledFilmSceneAudio({
    ...input,
    catalogSha256: result.catalogSha256,
    pickerSha256: result.pickerSha256,
    planFingerprint: result.planFingerprint,
    lanes: ["ambience", "score", "sfx"],
  });
  expect(applied.kind).toBe("ADDED");
  if (applied.kind !== "ADDED") return;
  const clips = applied.project.audioClips as Record<string, unknown>[];
  expect(clips).toHaveLength(result.clips.length);
  expect(
    clips.every(
      (clip) => JSON.stringify(clip.sceneAudioBinding) === JSON.stringify(result.sceneAudioBinding),
    ),
  ).toBe(true);
  expect(applied.receipt.memberCount).toBe(result.clips.length);
  expect(await readFile(f.native)).toEqual(native);
}, 30000);
it("respects scene mood conflicts and refuses a scene whose actual selected clock is interleaved", async () => {
  const f = await fixture();
  const a = f.record.shots![0] as Record<string, unknown>;
  const b = { ...a, id: "other", sound: { musicMood: "无配乐" } };
  const context = sceneAudioContext({ ...f.record, shots: [a, b] }, [
    { shotId: "shot", takeId: "take", startSeconds: 0, durationSeconds: 2 },
    { shotId: "other", takeId: "other-take", startSeconds: 2, durationSeconds: 2 },
  ]);
  expect(context.allowMusic).toBe(false);
  expect(context.limitations).toContainEqual({
    code: "SCENE_MUSIC_MOOD_CONFLICT",
    message: "本场配乐情绪尚未统一，暂不建议配乐。",
  });
  const clone = (id: string, sceneId: string) => ({
    ...a,
    id,
    sceneId,
    selectedTakeId: id,
    takes: [{ id, shotId: id, status: "done", videoPath: f.native }],
  });
  const stored = await f.save({
    ...f.record,
    scenes: [...(Array.isArray(f.record.scenes) ? f.record.scenes : []), { id: "between" }],
    shots: [clone("a", "scene"), clone("between", "between"), clone("b", "scene")],
    audioClips: [],
  });
  expect(
    await f.api.suggestBundledFilmSceneAudio({
      projectId: stored.id,
      expectedProjectHash: filmHistoryRecordHash(stored),
      sceneId: "scene",
      expectedSelection: [
        { shotId: "a", takeId: "a" },
        { shotId: "between", takeId: "between" },
        { shotId: "b", takeId: "b" },
      ],
    }),
  ).toMatchObject({ kind: "FAILED", code: "PLAN_UNSUPPORTED", unchanged: true });
});

async function sceneFixture() {
  const f = await fixture({
    mood: "温暖",
    picture: "雨夜街道",
    sfx: [{ atSeconds: 0, text: "脚步声" }],
  });
  const original = f.record.shots![0] as Record<string, unknown>;
  const makeShot = (id: string) => ({
    ...original,
    id,
    selectedTakeId: `take-${id}`,
    takes: [{ ...(original.takes as Record<string, unknown>[])[0], id: `take-${id}`, shotId: id }],
  });
  const record = await f.save({
    ...f.record,
    characters: [],
    shots: [makeShot("a"), makeShot("b")],
    audioClips: [],
  });
  const input = {
    projectId: record.id,
    expectedProjectHash: filmHistoryRecordHash(record),
    sceneId: "scene",
    expectedSelection: [
      { shotId: "a", takeId: "take-a" },
      { shotId: "b", takeId: "take-b" },
    ],
  };
  const proposal = await f.api.suggestBundledFilmSceneAudio(input);
  if (proposal.kind !== "SCENE_SUGGESTED") throw Error("SCENE_NOT_READY");
  const apply = {
    ...input,
    catalogSha256: proposal.catalogSha256,
    pickerSha256: proposal.pickerSha256,
    planFingerprint: proposal.planFingerprint,
    lanes: ["ambience", "score", "sfx"] as ("ambience" | "score" | "sfx")[],
  };
  return { ...f, record, input, proposal, apply };
}
it("preserves complete scene groups through normalization and a real portable ZIP, mixes continuous source windows, and stops the whole group on selection-clock change", async () => {
  const f = await sceneFixture();
  const source = await readFile(f.native);
  // A metadata save changes the fresh CAS while leaving the reviewed semantic plan intact.
  const refreshed = await f.save(f.record);
  expect(filmHistoryRecordHash(refreshed)).not.toBe(f.apply.expectedProjectHash);
  f.apply.expectedProjectHash = filmHistoryRecordHash(refreshed);
  const result = await f.api.applyBundledFilmSceneAudio(f.apply);
  if (result.kind !== "ADDED") throw Error("SCENE_NOT_ADDED");
  const { normalizeAudioClips } = (await import(
    pathToFileURL(resolve("../studio-web/src/aivora/film/audio.ts")).href
  )) as { normalizeAudioClips: (v: unknown) => Record<string, unknown>[] };
  const clips = normalizeAudioClips(result.project.audioClips);
  expect(
    clips.every(
      (clip) =>
        JSON.stringify(clip.sceneAudioBinding) === JSON.stringify(f.proposal.sceneAudioBinding),
    ),
  ).toBe(true);
  const complete = (value: unknown) => {
    const group = audioSuggestionGroupInputs(value, result.receipt.groupId);
    if (!group) return false;
    const members = group.members.map((row) => ({
      key: row.key,
      clipId: row.clipId,
      creativeSha256: sha(Buffer.from(row.creativeInput)),
    }));
    return (
      sha(Buffer.from(audioSuggestionMemberSetInput(members))) === result.receipt.memberSetSha256
    );
  };
  expect(complete(clips)).toBe(true);
  expect(
    complete(
      clips.map((clip, index) =>
        index === 0 ? { ...clip, gainDb: Number(clip.gainDb) + 1 } : clip,
      ),
    ),
  ).toBe(false);
  const stored = await f.save({ ...(await f.read())!, audioClips: clips });
  const zip = join(f.root, "scene.aivora.zip");
  const archive = createProjectArchives({
    filmsRoot: f.host.filmsRoot,
    storyFilmsRoot: f.host.storyFilmsRoot,
    temporaryRoot: join(f.root, "archives"),
    engine: () => loadProjectArchiveEngine(resolve("../../packages/aivora-media")),
    pickExport: async () => zip,
    pickImport: async () => zip,
  });
  expect(
    await archive.export({ projectId: stored.id, expectedHash: filmHistoryRecordHash(stored) }),
  ).toMatchObject({ kind: "EXPORTED" });
  const imported = await archive.import();
  if (imported.kind !== "IMPORTED") throw Error("SCENE_NOT_IMPORTED");
  const record = (await readProject(f.host.filmsRoot, imported.projectId))!;
  expect(record.id).not.toBe(stored.id);
  expect(complete(record.audioClips)).toBe(true);
  const choices = record.shots!.map((raw) => {
    const shot = raw as Record<string, unknown>;
    const take = (shot.takes as Record<string, unknown>[])[0]!;
    return { shotId: String(shot.id), takeId: String(take.id), videoPath: String(take.videoPath) };
  });
  const host = { filmsRoot: f.host.filmsRoot, storyFilmsRoot: f.host.storyFilmsRoot, tools, run };
  const actual = await resolveAudioMix(record, choices, host);
  expect(actual.plan.tracks).toHaveLength(clips.length);
  expect(new Set(actual.plan.tracks.map((track) => track.sourceKey)).size).toBe(
    new Set(clips.map((clip) => clip.path)).size,
  );
  // Both shots use the same original video fixture; repeat it as visual canvas for this audio evidence.
  const joined = join(f.root, "canvas.mp4"),
    output = join(f.root, "scene-mixed.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-stream_loop",
    "1",
    "-i",
    choices[0]!.videoPath,
    "-t",
    "4",
    "-c",
    "copy",
    joined,
  ]);
  await renderAudioMix(joined, output, actual.plan, actual.paths, tools, run);
  const measured = await run(tools.ffmpegPath, [
    "-v",
    "info",
    "-i",
    output,
    "-af",
    "astats=metadata=0:reset=0",
    "-f",
    "null",
    "-",
  ]);
  expect(measured.stderr).toMatch(/Number of samples: [1-9]\d*/);
  const missing = await resolveAudioMix(
    { ...record, audioClips: (record.audioClips as unknown[]).slice(1) },
    choices,
    host,
  );
  expect(missing.plan.tracks).toHaveLength(0);
  expect(missing.plan.limitations).toContain("SCENE_AUDIO_BINDING_STALE");
  // Provenance is not authorization: real roots/owner are still checked, and a changed
  // copied asset must silence the full reviewed group rather than just one segment.
  const importedClip = (record.audioClips as Record<string, unknown>[])[0]!;
  const clipPath = String(importedClip.path),
    oldAsset = await readFile(clipPath);
  const otherAsset = library.assets.find(
    (asset) => asset.type === "sfx" && asset.sha256 !== sha(oldAsset),
  )!;
  try {
    await writeFile(clipPath, await readFile(otherAsset.file));
    const changed = await resolveAudioMix(record, choices, host);
    expect(changed.plan.tracks).toHaveLength(0);
    expect(changed.plan.limitations).toContain("SCENE_AUDIO_BINDING_STALE");
  } finally {
    await writeFile(clipPath, oldAsset);
  }
  // A different real visual clock in a prefix invalidates the full scene group, not just its first clip.
  const shorter = join(f.media, "short.mp4");
  await f.generate(shorter, 1);
  const changedShots = record.shots!.map((raw, index) => {
    const shot = raw as Record<string, unknown>;
    return index
      ? shot
      : {
          ...shot,
          takes: [{ ...(shot.takes as Record<string, unknown>[])[0], videoPath: shorter }],
        };
  });
  // Use a same-owner imported episode path, not the original project path.
  const importedShort = join(dirname(choices[0]!.videoPath), "short.mp4");
  await writeFile(importedShort, await readFile(shorter));
  (changedShots[0]!.takes as Record<string, unknown>[])[0]!.videoPath = importedShort;
  const stale = await resolveAudioMix(
    { ...record, shots: changedShots },
    [{ ...choices[0]!, videoPath: importedShort }, choices[1]!],
    host,
  );
  expect(stale.plan.tracks).toHaveLength(0);
  expect(stale.plan.limitations).toContain("SCENE_AUDIO_BINDING_STALE");
  expect(await readFile(f.native)).toEqual(source);
}, 30000);
it.each(["project", "take", "source"])(
  "rejects late scene %s changes before its one CAS and cleans only unreferenced copies",
  async (kind) => {
    const f = await sceneFixture();
    let triggered = false;
    f.host.beforeCommit.mockImplementationOnce(async () => {
      triggered = true;
      if (kind === "source") await f.generate(f.native, 1, true);
      else
        await f.save({
          ...f.record,
          ...(kind === "project"
            ? { title: "new edit" }
            : {
                shots: f.record.shots!.map((raw, index) =>
                  index
                    ? raw
                    : { ...(raw as Record<string, unknown>), selectedTakeId: "different" },
                ),
              }),
        });
    });
    const result = await f.api.applyBundledFilmSceneAudio(f.apply);
    expect(triggered).toBe(true);
    expect(result).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true });
    expect((await f.read())!.audioClips).toEqual([]);
    expect(
      (await readdir(f.media)).filter((name) => name.startsWith(".audio-suggestion-")),
    ).toEqual([]);
  },
  30000,
);
