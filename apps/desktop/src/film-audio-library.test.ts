import {
  audioSuggestionGroupInputs,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import type {
  ApplyBundledFilmShotAudioInput,
  AudioSuggestionReceipt,
} from "@aijian/contracts/film-audio-library";
import type * as FilmLibraryModule from "./film-library";
import { afterAll, afterEach, beforeAll, expect, it, onTestFailed, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  readdir,
  rename,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, dirname, basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createFilmAudioLibrary } from "./film-audio-library";
import { loadTrustedAudioLibrary, publicAudioCatalog } from "./film-audio-library-runtime";
import { readMedia, readProject, writeProject, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import {
  verifiedQcTools,
  loadQcRunner,
  type QcTools,
  type QcRunner,
} from "./film-export-qc-runtime";
import { createProjectArchives } from "./film-project-archive";
import { loadProjectArchiveEngine } from "./film-project-archive-runtime";
import { resolveAudioMix } from "./film-audio-mix-sources";
import { renderAudioMix, probeMixSource } from "./film-audio-mix";
import type { AddBundledFilmAudioInput } from "@aijian/contracts/film-audio-library";
const fault = vi.hoisted(() => ({
  mode: "",
  observe: null as null | ((stage: "write" | "write-ack" | "readback") => void),
  applied: false,
  hold: null as Promise<void> | null,
  entered: null as (() => void) | null,
}));
vi.mock("./film-library", async (original) => {
  const actual = await original<typeof FilmLibraryModule>();
  return {
    ...actual,
    readProject: async (...args: Parameters<typeof actual.readProject>) => {
      if (fault.mode && fault.applied) fault.observe?.("readback");
      if (["unreadable", "readback-empty"].includes(fault.mode) && fault.applied) return null;
      const record = await actual.readProject(...args);
      if (fault.mode === "readback-wrong" && fault.applied && record)
        return { ...record, id: "film_cccccccccccccccc" };
      return fault.mode === "readback-stale" && fault.applied && record
        ? { ...record, audioClips: [] }
        : record;
    },
    transactFilmProject: (
      root: string,
      id: string,
      action: (
        current: FilmRecord | null,
        write: (next: FilmRecord) => Promise<FilmRecord>,
      ) => Promise<unknown>,
    ) =>
      actual.transactFilmProject(root, id, (current, write) =>
        action(current, async (next) => {
          fault.observe?.("write");
          if (fault.mode === "before") throw Error("write failure");
          const stored = await write(next);
          fault.observe?.("write-ack");
          fault.applied = true;
          if (fault.mode === "pending") {
            fault.entered?.();
            await fault.hold;
          }
          if (fault.mode === "after" || fault.mode === "unreadable")
            throw Error("index update failure");
          return stored;
        }),
      ),
  };
});
const execute = promisify(execFile),
  roots: string[] = [];
let tools: QcTools,
  run: QcRunner,
  bundle = "",
  bundleParent = "";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function tool(name: string) {
  const explicit = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const file = resolve(root, name + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(file)) return file;
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
  bundleParent = await mkdtemp(join(tmpdir(), "bundled-audio-resource-"));
  bundle = join(bundleParent, "resources");
  await execute(process.execPath, [
    resolve("../../scripts/build-audio-library-resources.mjs"),
    "--out-dir",
    bundle,
  ]);
});
afterAll(async () => {
  if (bundleParent) await rm(bundleParent, { recursive: true, force: true });
});
afterEach(async () => {
  fault.mode = "";
  fault.observe = null;
  fault.applied = false;
  fault.hold = null;
  fault.entered = null;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "音效库 CAS "));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const id = "film_aaaaaaaaaaaaaaaa",
    seriesId = "film_bbbbbbbbbbbbbbbb";
  const episode = join(filmsRoot, seriesId, "episodes", id),
    media = join(episode, "media");
  await mkdir(media, { recursive: true });
  await mkdir(storyFilmsRoot);
  const video = join(media, "native.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=24:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const record = await writeProject(filmsRoot, {
    id,
    seriesId,
    schemaVersion: 1,
    title: "本地音效",
    characters: [],
    sourceText: "台词",
    scenes: [{ id: "scene", no: 1, text: "台词" }],
    shots: [
      {
        id: "shot",
        sceneId: "scene",
        no: 1,
        line: "",
        selectedTakeId: "take",
        takes: [{ id: "take", shotId: "shot", status: "done", videoPath: video }],
      },
    ],
    audioClips: [],
  });
  const counted = vi.fn(run),
    pinned = vi.fn(async () => tools);
  const host = {
    filmsRoot,
    storyFilmsRoot,
    libraryRoot: () => bundle,
    tools: pinned,
    run: counted,
    videoOwner: vi.fn(async () => false),
    beforeCommit: undefined as undefined | (() => Promise<void>),
  };
  const library = createFilmAudioLibrary(host);
  const catalog = await library.listBundledFilmAudio();
  if (catalog.kind !== "CATALOG") throw Error(catalog.code);
  const asset = catalog.assets.find((row) => row.id === "gap-knife-slash-1")!;
  const request: AddBundledFilmAudioInput = {
    projectId: id,
    expectedProjectHash: filmHistoryRecordHash(record),
    catalogSha256: catalog.manifestSha256,
    assetId: asset.id,
    expectedAssetSha256: asset.sha256,
    shotId: "shot",
    takeId: "take",
    lane: "sfx",
    placement: {
      startSeconds: 0.2,
      durationSeconds: 0.3,
      offsetSeconds: 0.02,
      gainDb: 0,
      loop: false,
    },
  };
  return {
    root,
    filmsRoot,
    storyFilmsRoot,
    episode,
    media,
    video,
    record,
    library,
    host,
    request,
    asset,
  };
}
it("loads the actually built existing loader and verifies every current bundled byte without exposing paths", async () => {
  const library = await loadTrustedAudioLibrary(bundle),
    catalog = publicAudioCatalog(library);
  expect(catalog.assets).toHaveLength(206);
  expect(catalog.assets.filter((asset) => asset.type === "sfx")).toHaveLength(175);
  expect(catalog.assets.filter((asset) => asset.type === "music")).toHaveLength(31);
  expect(catalog.manifestSha256).toBe(
    sha(await readFile(resolve("../../assets/audio-library/manifest.json"))),
  );
  expect(
    catalog.assets.every(
      (asset) => asset.source.startsWith("https:") && asset.author && asset.license,
    ),
  ).toBe(true);
  expect(JSON.stringify(catalog)).not.toContain(bundle);
  expect(Object.keys(catalog.assets[0]!)).not.toContain("path");
});
it("copies real Ogg, preserves attribution through normalization/read IPC/portable ZIP, then uses the shared mix to render real audio", async () => {
  const f = await fixture(),
    original = await readFile(f.video);
  const trusted = (await loadTrustedAudioLibrary(bundle)).assets.find(
    (row) => row.id === f.asset.id,
  )!;
  const sourceBytes = await readFile(trusted.file),
    manifestBytes = await readFile(join(bundle, "manifest.json"));
  const result = await f.library.addBundledFilmAudio(f.request);
  expect(result.kind).toBe("ADDED");
  if (result.kind !== "ADDED") throw Error(result.code);
  const clips = result.project.audioClips as Record<string, unknown>[];
  expect(clips[0]).toMatchObject({
    gainDb: 0,
    loop: false,
    takeId: "take",
    libraryAsset: {
      assetId: f.asset.id,
      source: f.asset.source,
      author: f.asset.author,
      license: f.asset.license,
      sha256: f.asset.sha256,
      processingGainDb: 20.68,
    },
  });
  const normalizePath = pathToFileURL(resolve("../studio-web/src/aivora/film/audio.ts")).href;
  const { normalizeAudioClips } = (await import(normalizePath)) as {
    normalizeAudioClips: (value: unknown) => Record<string, unknown>[];
  };
  clips[0]!.envelope = {
    schemaVersion: 1,
    baseGainDb: 0,
    fades: [
      { direction: "in", startSeconds: -0.05, durationSeconds: 0.1 },
      { direction: "out", startSeconds: 0.25, durationSeconds: 0.05 },
    ],
    gainAutomation: [{ startSeconds: 0, endSeconds: 0.15, gainDb: -3 }],
  };
  const normalized = normalizeAudioClips(clips);
  expect(normalized[0]!.libraryAsset).toEqual(clips[0]!.libraryAsset);
  expect(normalized[0]!.envelope).toEqual(clips[0]!.envelope);
  const saved = await writeProject(f.filmsRoot, { ...result.project, audioClips: normalized });
  expect(
    await readMedia([f.filmsRoot], String(normalized[0]!.path), {
      maxBytes: 16 * 1024 * 1024,
      expectedSha256: f.asset.sha256,
    }),
  ).toEqual(new Uint8Array(sourceBytes));
  const zip = join(f.root, "素材工程.aivora.zip");
  const archive = createProjectArchives({
    filmsRoot: f.filmsRoot,
    storyFilmsRoot: f.storyFilmsRoot,
    temporaryRoot: join(f.root, "archives"),
    engine: () => loadProjectArchiveEngine(resolve("../../packages/aivora-media")),
    pickExport: async () => zip,
    pickImport: async () => zip,
  });
  expect(
    await archive.export({
      projectId: f.record.id,
      expectedHash: filmHistoryRecordHash(saved),
    }),
  ).toMatchObject({ kind: "EXPORTED" });
  const imported = await archive.import();
  expect(imported.kind).toBe("IMPORTED");
  if (imported.kind !== "IMPORTED") throw Error();
  const restored = (await readProject(f.filmsRoot, imported.projectId))!;
  const recoveredClips = restored.audioClips as Record<string, unknown>[];
  expect(recoveredClips[0]!.libraryAsset).toEqual(clips[0]!.libraryAsset);
  expect(recoveredClips[0]!.envelope).toEqual(clips[0]!.envelope);
  expect(sha(await readFile(String(recoveredClips[0]!.path)))).toBe(f.asset.sha256);
  const shot = restored.shots![0] as Record<string, unknown>,
    take = (shot.takes as Record<string, unknown>[])[0]!;
  const actual = await resolveAudioMix(
    restored,
    [{ shotId: String(shot.id), takeId: String(take.id), videoPath: String(take.videoPath) }],
    { filmsRoot: f.filmsRoot, storyFilmsRoot: f.storyFilmsRoot, tools, run },
  );
  expect(actual.plan.tracks).toHaveLength(1);
  expect(actual.plan.tracks[0]!.envelope).toEqual(clips[0]!.envelope);
  expect(actual.plan.tracks[0]!.gainDb).toBe(0);
  const output = join(f.root, "mixed.mp4");
  await renderAudioMix(String(take.videoPath), output, actual.plan, actual.paths, tools, run);
  const outputInfo = await probeMixSource(output, tools, run);
  expect(outputInfo.hasAudio).toBe(true);
  expect(outputInfo.durationSeconds).toBeCloseTo(2, 2);
  const measured = await run(tools.ffmpegPath, [
    "-v",
    "info",
    "-i",
    output,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  expect(measured.stderr).toMatch(/mean_volume: -?\d+(?:\.\d+)? dB/);
  const forged = structuredClone(restored);
  const outside = join(f.root, "unowned.ogg");
  await writeFile(outside, sourceBytes);
  (forged.audioClips as Record<string, unknown>[])[0]!.path = outside;
  await expect(
    resolveAudioMix(
      forged,
      [{ shotId: String(shot.id), takeId: String(take.id), videoPath: String(take.videoPath) }],
      { filmsRoot: f.filmsRoot, storyFilmsRoot: f.storyFilmsRoot, tools, run },
    ),
  ).rejects.toThrow();
  const invalidEnvelope = structuredClone(restored);
  (invalidEnvelope.audioClips as Record<string, unknown>[])[0]!.envelope = {
    schemaVersion: 1,
    baseGainDb: 0,
    gainAutomation: [null, {}],
  };
  const inspectedRun = vi.fn(run);
  await expect(
    resolveAudioMix(
      invalidEnvelope,
      [{ shotId: String(shot.id), takeId: String(take.id), videoPath: String(take.videoPath) }],
      { filmsRoot: f.filmsRoot, storyFilmsRoot: f.storyFilmsRoot, tools, run: inspectedRun },
    ),
  ).rejects.toThrow("INVALID_AUDIO_ENVELOPE");
  expect(inspectedRun.mock.calls.some(([binary]) => binary === tools.ffmpegPath)).toBe(false);
  expect(await readFile(trusted.file)).toEqual(sourceBytes);
  expect(await readFile(join(bundle, "manifest.json"))).toEqual(manifestBytes);
  expect(await readFile(f.video)).toEqual(original);
}, 30000);
it("rejects wrong project/hash/take, unknown asset, forged paths or invalid placement without creating a clip", async () => {
  const f = await fixture(),
    before = await readFile(join(f.episode, "project.json"));
  for (const change of [
    { projectId: f.record.seriesId },
    { expectedProjectHash: "0".repeat(64) },
    { takeId: "other" },
    { assetId: "unknown" },
    { expectedAssetSha256: "0".repeat(64) },
    { catalogSha256: "0".repeat(64) },
    { path: "/outside.ogg" },
    { placement: { ...f.request.placement, startSeconds: -1 } },
    { placement: { ...f.request.placement, durationSeconds: 3 } },
    { placement: { ...f.request.placement, loop: true } },
  ]) {
    const result = await f.library.addBundledFilmAudio({ ...f.request, ...change });
    expect(result.kind).toBe("FAILED");
  }
  expect(await readFile(join(f.episode, "project.json"))).toEqual(before);
  expect(await readdir(f.media)).toEqual(["native.mp4"]);
});
it.each(["edit", "take"])(
  "does not overwrite a %s changed during private copy and removes only its own copy",
  async (kind) => {
    const f = await fixture();
    f.host.beforeCommit = async () => {
      const next = structuredClone(f.record);
      if (kind === "edit") next.title = "later edit";
      else {
        const shot = next.shots![0] as { selectedTakeId: string; takes: Record<string, unknown>[] };
        shot.takes.push({ ...shot.takes[0], id: "new-take" });
        shot.selectedTakeId = "new-take";
      }
      await writeProject(f.filmsRoot, next);
    };
    expect(await f.library.addBundledFilmAudio(f.request)).toMatchObject({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
      unchanged: true,
    });
    const current = (await readProject(f.filmsRoot, f.record.id))!;
    if (kind === "edit") expect(current.title).toBe("later edit");
    else expect((current.shots![0] as { selectedTakeId: string }).selectedTakeId).toBe("new-take");
    expect(await readdir(f.media)).toEqual(["native.mp4"]);
  },
);

it("keeps the first in-flight import busy even after multiple duplicate calls are rejected", async () => {
  const f = await fixture();
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.host.beforeCommit = async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const first = f.library.addBundledFilmAudio(f.request);
  await ready;
  for (let count = 0; count < 2; count++)
    expect(await f.library.addBundledFilmAudio(f.request)).toMatchObject({
      kind: "FAILED",
      code: "BUSY",
    });
  const target = {
    projectId: f.request.projectId,
    expectedProjectHash: f.request.expectedProjectHash,
    shotId: f.request.shotId,
    takeId: f.request.takeId,
  };
  for (let count = 0; count < 2; count++)
    expect(await f.library.inspectBundledFilmAudioTarget(target)).toMatchObject({
      kind: "FAILED",
      code: "BUSY",
    });
  release();
  expect((await first).kind).toBe("ADDED");
  expect(await f.library.inspectBundledFilmAudioTarget(target)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  const stored = (await readProject(f.filmsRoot, target.projectId))!;
  expect(
    await f.library.inspectBundledFilmAudioTarget({
      ...target,
      expectedProjectHash: filmHistoryRecordHash(stored),
    }),
  ).toMatchObject({ kind: "TARGET", durationSeconds: 2 });
});
it("rejects a series symlink alias and pinned tool mismatch without modifying source bytes", async () => {
  const f = await fixture();
  f.host.tools.mockRejectedValueOnce(Error("fixed mismatch"));
  expect(await f.library.addBundledFilmAudio(f.request)).toMatchObject({
    kind: "FAILED",
    code: "TOOLS_UNAVAILABLE",
  });
  expect(f.host.run).not.toHaveBeenCalled();
  const originalSeries = join(f.filmsRoot, f.record.seriesId),
    outside = join(f.root, "external-series");
  await rename(originalSeries, outside);
  await symlink(outside, originalSeries, process.platform === "win32" ? "junction" : "dir");
  expect(await f.library.addBundledFilmAudio(f.request)).toMatchObject({
    kind: "FAILED",
    code: "SOURCE_UNVERIFIED",
  });
  expect(await readdir(join(outside, "episodes", f.record.id, "media"))).toEqual(["native.mp4"]);
});

it("accepts the existing selected series/media source but rejects another episode without probing it", async () => {
  const f = await fixture(),
    shared = join(f.filmsRoot, f.record.seriesId, "media");
  await mkdir(shared);
  const video = join(shared, "shared.mp4");
  await copyFile(f.video, video);
  const edit = structuredClone(f.record);
  (edit.shots![0] as { takes: { videoPath: string }[] }).takes[0]!.videoPath = video;
  const stored = await writeProject(f.filmsRoot, edit);
  expect(
    (
      await f.library.addBundledFilmAudio({
        ...f.request,
        expectedProjectHash: filmHistoryRecordHash(stored),
      })
    ).kind,
  ).toBe("ADDED");
  const foreign = join(
    f.filmsRoot,
    f.record.seriesId,
    "episodes",
    "film_cccccccccccccccc",
    "media",
  );
  await mkdir(foreign, { recursive: true });
  const other = join(foreign, "other.mp4");
  await copyFile(f.video, other);
  (edit.shots![0] as { takes: { videoPath: string }[] }).takes[0]!.videoPath = other;
  const foreignRecord = await writeProject(f.filmsRoot, edit);
  f.host.run.mockClear();
  expect(
    await f.library.addBundledFilmAudio({
      ...f.request,
      expectedProjectHash: filmHistoryRecordHash(foreignRecord),
    }),
  ).toMatchObject({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
  expect(f.host.run).not.toHaveBeenCalled();
});
it("uses the same actual clean visual duration as final mixing and rejects out-of-picture placement", async () => {
  const f = await fixture(),
    clean = join(f.media, "clean.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=24:d=0.6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clean,
  ]);
  const next = structuredClone(f.record);
  (next.shots![0] as { takes: Record<string, unknown>[] }).takes[0]!.cleanVideoPath = clean;
  const stored = await writeProject(f.filmsRoot, next),
    request = { ...f.request, expectedProjectHash: filmHistoryRecordHash(stored) };
  expect(
    await f.library.addBundledFilmAudio({
      ...request,
      placement: { ...request.placement, startSeconds: 0.5 },
    }),
  ).toMatchObject({ kind: "FAILED", code: "PLACEMENT_UNSUPPORTED" });
  expect((await f.library.addBundledFilmAudio(request)).kind).toBe("ADDED");
});
it.each(["before", "after"])(
  "keeps actual saved file references accurate when persistence fails %s the project write",
  async (mode) => {
    const f = await fixture(),
      before = await readFile(join(f.episode, "project.json")),
      native = await readFile(f.video);
    fault.mode = mode;
    const result = await f.library.addBundledFilmAudio(f.request);
    expect(result).toMatchObject({
      kind: "FAILED",
      code: mode === "before" ? "WRITE_FAILED" : "WRITE_UNCONFIRMED",
      unchanged: mode === "before",
    });
    const record = (await readProject(f.filmsRoot, f.record.id))!;
    if (mode === "before") {
      expect(await readFile(join(f.episode, "project.json"))).toEqual(before);
      expect(await readdir(f.media)).toEqual(["native.mp4"]);
    } else {
      const clip = (record.audioClips as Record<string, unknown>[])[0]!;
      expect(sha(await readFile(String(clip.path)))).toBe(f.asset.sha256);
    }
    expect(await readFile(f.video)).toEqual(native);
  },
);
it("refuses mutated bundled bytes or an outward source symlink while keeping the original bundle unchanged", async () => {
  const f = await fixture(),
    root = join(f.root, "altered-bundle");
  await mkdir(root);
  const entries = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >[];
  const row = entries.find((row) => row.id === f.asset.id)!;
  const manifest = Buffer.from(JSON.stringify([row]));
  const source = join(root, String(row.path));
  await mkdir(dirname(source), { recursive: true });
  const bytes = await readFile(join(bundle, String(row.path)));
  await writeFile(source, bytes);
  await writeFile(join(root, "manifest.json"), manifest);
  const loader = await readFile(join(bundle, "audio-library.mjs"));
  await writeFile(join(root, "audio-library.mjs"), loader);
  await writeFile(
    join(root, "resource-index.json"),
    JSON.stringify({
      schemaVersion: 1,
      manifestSha256: sha(manifest),
      loaderSha256: sha(loader),
      assetCount: 1,
    }),
  );
  await writeFile(source, "changed");
  f.host.libraryRoot = () => root;
  expect(
    await f.library.addBundledFilmAudio({ ...f.request, catalogSha256: sha(manifest) }),
  ).toMatchObject({ kind: "FAILED", code: "ASSET_CHANGED" });
  await rm(dirname(source), { recursive: true });
  const outsideFolder = join(f.root, "outside-source");
  await mkdir(outsideFolder);
  const outside = join(outsideFolder, basename(source));
  await writeFile(outside, bytes);
  await symlink(outsideFolder, dirname(source), process.platform === "win32" ? "junction" : "dir");
  expect(await f.library.listBundledFilmAudio()).toMatchObject({
    kind: "FAILED",
    code: "LIBRARY_UNAVAILABLE",
  });
  expect(await readFile(outside)).toEqual(bytes);
  expect(await readFile(join(bundle, String(row.path)))).toEqual(bytes);
  expect(await readdir(f.media)).toEqual(["native.mp4"]);
});

it("rejects a changed clean visual file after preparation even when the saved record is unchanged", async () => {
  const f = await fixture(),
    clean = join(f.media, "clean.mp4");
  const generate = (duration: number) =>
    run(tools.ffmpegPath, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=160x90:r=24:d=${duration}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      clean,
    ]);
  await generate(0.6);
  const next = structuredClone(f.record);
  (next.shots![0] as { takes: Record<string, unknown>[] }).takes[0]!.cleanVideoPath = clean;
  const stored = await writeProject(f.filmsRoot, next),
    original = await readFile(f.video);
  f.host.beforeCommit = async () => {
    await generate(0.9);
  };
  expect(
    await f.library.addBundledFilmAudio({
      ...f.request,
      expectedProjectHash: filmHistoryRecordHash(stored),
    }),
  ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect(await readFile(f.video)).toEqual(original);
  expect((await readdir(f.media)).sort()).toEqual(["clean.mp4", "native.mp4"]);
});

async function suggested(f: Awaited<ReturnType<typeof fixture>>) {
  const record = structuredClone(f.record);
  Object.assign(record.shots![0] as Record<string, unknown>, {
    picture: "雨夜街道，手机震动",
    sound: {
      musicMood: "温暖",
      sfx: [
        { atSeconds: 0, text: "手机震动" },
        { atSeconds: 0.5, text: "手机震动" },
        { atSeconds: 1, text: "手机震动" },
        { atSeconds: 1.5, text: "手机震动" },
      ],
      ambience: "",
    },
  });
  const stored = await writeProject(f.filmsRoot, record);
  const input = {
    projectId: stored.id,
    expectedProjectHash: filmHistoryRecordHash(stored),
    shotId: "shot",
    takeId: "take",
  };
  const proposal = await f.library.suggestBundledFilmShotAudio(input);
  if (proposal.kind !== "SUGGESTED") throw Error(proposal.code);
  const request: ApplyBundledFilmShotAudioInput = {
    ...input,
    catalogSha256: proposal.catalogSha256,
    pickerSha256: proposal.pickerSha256,
    planFingerprint: proposal.planFingerprint,
    lanes: ["ambience", "sfx", "score"],
  };
  return { stored, proposal, request };
}
function completeGroup(clips: unknown, receipt: AudioSuggestionReceipt) {
  const inputs = audioSuggestionGroupInputs(clips, receipt.groupId);
  if (!inputs) return false;
  const members = inputs.members.map(({ creativeInput, ...member }) => ({
    ...member,
    creativeSha256: sha(Buffer.from(creativeInput)),
  }));
  return (
    inputs.group.memberCount === receipt.memberCount &&
    inputs.group.memberSetSha256 === receipt.memberSetSha256 &&
    sha(Buffer.from(audioSuggestionMemberSetInput(members))) === receipt.memberSetSha256
  );
}
it("applies whole lane segments atomically with one copy per asset, complete receipt and real portable/FFmpeg roundtrip", async () => {
  const f = await fixture(),
    { request, proposal } = await suggested(f),
    source = await readFile(f.video);
  // A normal save between review and apply changes raw CAS, not reviewed intent.
  const refreshed = await writeProject(f.filmsRoot, (await readProject(f.filmsRoot, f.record.id))!);
  expect(filmHistoryRecordHash(refreshed)).not.toBe(request.expectedProjectHash);
  request.expectedProjectHash = filmHistoryRecordHash(refreshed);
  const result = await f.library.applyBundledFilmShotAudio(request);
  expect(result.kind).toBe("ADDED");
  if (result.kind !== "ADDED") throw Error(result.code);
  const clips = result.project.audioClips as Record<string, unknown>[];
  expect(clips).toHaveLength(proposal.clips.length);
  expect(completeGroup(clips, result.receipt)).toBe(true);
  for (const planned of proposal.clips) {
    const member = result.receipt.members.find((member) => member.key === planned.key)!;
    const actual = clips.find((clip) => clip.id === member.clipId)!;
    expect(actual).toMatchObject({
      ...planned.placement,
      lane: planned.lane,
      shotId: "shot",
      takeId: "take",
      label: planned.asset.name,
      libraryAsset: { assetId: planned.asset.id, sha256: planned.asset.sha256 },
    });
    expect(actual.envelope).toEqual(planned.envelope);
    expect(sha(await readFile(String(actual.path)))).toBe(planned.asset.sha256);
  }
  expect(new Set(clips.map((clip) => clip.path)).size).toBe(
    new Set(proposal.clips.map((clip) => clip.asset.id)).size,
  );
  const sfx = clips.filter((clip) => clip.lane === "sfx");
  expect(sfx).toHaveLength(4);
  expect(new Set(sfx.map((clip) => clip.path)).size).toBeLessThan(sfx.length);
  const normalizeUrl = pathToFileURL(resolve("../studio-web/src/aivora/film/audio.ts")).href;
  const { normalizeAudioClips: normalize } = (await import(normalizeUrl)) as {
    normalizeAudioClips: (value: unknown) => Record<string, unknown>[];
  };
  const normalized = normalize(clips);
  expect(completeGroup(normalized, result.receipt)).toBe(true);
  const stored = await writeProject(f.filmsRoot, { ...result.project, audioClips: normalized });
  const zip = join(f.root, "suggestions.aivora.zip"),
    archive = createProjectArchives({
      filmsRoot: f.filmsRoot,
      storyFilmsRoot: f.storyFilmsRoot,
      temporaryRoot: join(f.root, "archives"),
      engine: () => loadProjectArchiveEngine(resolve("../../packages/aivora-media")),
      pickExport: async () => zip,
      pickImport: async () => zip,
    });
  expect(
    await archive.export({ projectId: stored.id, expectedHash: filmHistoryRecordHash(stored) }),
  ).toMatchObject({ kind: "EXPORTED" });
  const imported = await archive.import();
  if (imported.kind !== "IMPORTED") throw Error("ARCHIVE_NOT_IMPORTED");
  const restored = (await readProject(f.filmsRoot, imported.projectId))!;
  expect(completeGroup(restored.audioClips, result.receipt)).toBe(true);
  const shot = restored.shots![0] as { id: string; takes: { id: string; videoPath: string }[] },
    take = shot.takes[0]!;
  const resolved = await resolveAudioMix(
    restored,
    [{ shotId: shot.id, takeId: take.id, videoPath: take.videoPath }],
    { filmsRoot: f.filmsRoot, storyFilmsRoot: f.storyFilmsRoot, tools, run },
  );
  expect(new Set(resolved.plan.tracks.map((track) => track.sourceKey)).size).toBe(
    new Set(clips.map((clip) => clip.path)).size,
  );
  const output = join(f.root, "group.mp4");
  await renderAudioMix(take.videoPath, output, resolved.plan, resolved.paths, tools, run);
  expect((await probeMixSource(output, tools, run)).hasAudio).toBe(true);
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
  expect(await readFile(f.video)).toEqual(source);
  expect(await f.library.applyBundledFilmShotAudio(request)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
    unchanged: true,
  });
  expect((await readProject(f.filmsRoot, f.record.id))!.audioClips).toHaveLength(clips.length);
}, 30000);
it("selects a complete lane subset while preserving existing clips, and rejects modified or incomplete creative groups", async () => {
  const f = await fixture(),
    { request, proposal } = await suggested(f);
  const previous = {
    id: "old-disabled",
    lane: "score",
    shotId: "shot",
    takeId: "old-version",
    label: "旧版保留",
    path: "/unresolved-old.ogg",
    startSeconds: 0,
    durationSeconds: 1,
    offsetSeconds: 0,
    gainDb: -5,
    enabled: false,
  };
  const oldRecord = await readProject(f.filmsRoot, f.record.id);
  const fresh = await writeProject(f.filmsRoot, { ...oldRecord!, audioClips: [previous] });
  const result = await f.library.applyBundledFilmShotAudio({
    ...request,
    expectedProjectHash: filmHistoryRecordHash(fresh),
    lanes: ["sfx"],
  });
  if (result.kind !== "ADDED") throw Error(result.code);
  expect(
    (result.project.audioClips as Record<string, unknown>[]).find(
      (clip) => clip.id === previous.id,
    ),
  ).toEqual(previous);
  const clips = (result.project.audioClips as Record<string, unknown>[]).filter(
    (clip) => clip.id !== previous.id,
  );
  expect(clips).toHaveLength(proposal.clips.filter((clip) => clip.lane === "sfx").length);
  expect(clips.every((clip) => clip.lane === "sfx")).toBe(true);
  expect(completeGroup(clips, result.receipt)).toBe(true);
  expect(completeGroup(clips.slice(1), result.receipt)).toBe(false);
  expect(completeGroup([...clips, clips[0]], result.receipt)).toBe(false);
  expect(
    completeGroup([...clips, { ...clips[0], suggestionGroup: undefined }], result.receipt),
  ).toBe(false);
  const changed = structuredClone(clips);
  changed[0]!.gainDb = -3;
  expect(completeGroup(changed, result.receipt)).toBe(false);
  changed[0]!.gainDb = 0;
  changed[0]!.envelope = {
    schemaVersion: 1,
    baseGainDb: 0,
    fades: [{ direction: "in", startSeconds: 0, durationSeconds: 0.2 }],
  };
  expect(completeGroup(changed, result.receipt)).toBe(false);
  const wrongKey = structuredClone(clips);
  (wrongKey[0]!.suggestionGroup as Record<string, unknown>).key = (
    wrongKey[1]!.suggestionGroup as Record<string, unknown>
  ).key;
  expect(completeGroup(wrongKey, result.receipt)).toBe(false);
});
it.each(["project", "take", "source", "clean", "library", "picker", "synonyms"] as const)(
  "rejects late %s mutation before the sole CAS and removes only private unreferenced copies",
  async (mode) => {
    const f = await fixture();
    const clean = join(f.media, "actual-clean.mp4");
    if (mode === "clean") {
      await copyFile(f.video, clean);
      (f.record.shots![0] as { takes: Record<string, unknown>[] }).takes[0]!.cleanVideoPath = clean;
    }
    const { request } = await suggested(f);
    // Each test owns its modified bundle; do not mutate the shared module fixture.
    const own = join(f.root, "bundle");
    await (await import("node:fs/promises")).cp(bundle, own, { recursive: true });
    f.host.libraryRoot = () => own;
    const before = await readFile(f.video);
    let called = false;
    f.host.beforeCommit = async () => {
      called = true;
      if (mode === "project" || mode === "take") {
        const current = (await readProject(f.filmsRoot, f.record.id))!;
        if (mode === "project") current.title = "new edit";
        else {
          const shot = current.shots![0] as {
            takes: Record<string, unknown>[];
            selectedTakeId: string;
          };
          shot.takes.push({ id: "other", shotId: "shot", status: "done", videoPath: f.video });
          shot.selectedTakeId = "other";
        }
        await writeProject(f.filmsRoot, current);
      } else if (mode === "source") await writeFile(f.video, "new bytes");
      else if (mode === "clean") {
        const oldSha = sha(await readFile(clean));
        await run(tools.ffmpegPath, [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=160x90:r=24:d=2",
          "-c:v",
          "libx264",
          "-an",
          clean,
        ]);
        expect(sha(await readFile(clean))).not.toBe(oldSha);
      } else if (mode === "library") await writeFile(join(own, "manifest.json"), "{}");
      else
        await writeFile(
          join(own, mode === "picker" ? "audio-picker.mjs" : "audio-picker-synonyms.mjs"),
          "export const changed=true;",
        );
    };
    const result = await f.library.applyBundledFilmShotAudio(request);
    expect(called).toBe(true);
    expect(result.kind).toBe("FAILED");
    expect(result).toMatchObject({ unchanged: true });
    expect((await readProject(f.filmsRoot, f.record.id))!.audioClips).toEqual([]);
    expect(
      (await readdir(f.media)).filter((name) => name.startsWith(".audio-suggestion-")),
    ).toEqual([]);
    if (mode !== "source") expect(await readFile(f.video)).toEqual(before);
  },
);
it.each([
  "before",
  "after",
  "unreadable",
  "readback-stale",
  "readback-empty",
  "readback-wrong",
] as const)(
  "reports %s write failure accurately and preserves possibly referenced group copies",
  async (mode) => {
    const begin = performance.now();
    let stage = "fixture",
      stageAt = begin,
      probes = () => 0;
    const completed: { stage: string; elapsedMs: number }[] = [];
    const snapshot = () => ({
      v: 1,
      mode,
      stage,
      elapsedMs: Math.round(performance.now() - begin),
      completed: [...completed],
      probes: probes(),
    });
    let gateObservation: ReturnType<typeof snapshot> | undefined;
    // Observation only: no cancellation, retry, deadline or change to the original 5s gate.
    const observer = setTimeout(() => {
      gateObservation = snapshot();
    }, 4900);
    observer.unref();
    const advance = (next: string) => {
      const now = performance.now();
      if (completed.length < 16) completed.push({ stage, elapsedMs: Math.round(now - stageAt) });
      stage = next;
      stageAt = now;
    };
    onTestFailed(() => {
      process.stderr.write(
        `CI_LIBRARY_WRITE_PHASE ${JSON.stringify(gateObservation ?? snapshot())}\n`,
      );
    });
    try {
      const f = await fixture();
      probes = () => f.host.run.mock.calls.length;
      advance("suggest");
      const { request } = await suggested(f);
      advance("apply");
      fault.observe = advance;
      f.host.beforeCommit = async () => {
        advance("commit");
      };
      fault.mode = mode;
      expect(await f.library.applyBundledFilmShotAudio(request)).toMatchObject({
        kind: "FAILED",
        code: mode === "before" ? "WRITE_FAILED" : "WRITE_UNCONFIRMED",
        unchanged: mode === "before",
      });
      fault.mode = "";
      fault.observe = null;
      advance("actual-read");
      const actual = (await readProject(f.filmsRoot, f.record.id))!;
      advance("inspect");
      expect(
        await f.library.inspectBundledFilmAudioTarget({
          projectId: actual.id,
          expectedProjectHash: filmHistoryRecordHash(actual),
          shotId: "shot",
          takeId: "take",
        }),
      ).toMatchObject({ kind: "TARGET" });
      advance("hash-check");
      if (mode === "before") {
        expect(actual.audioClips).toEqual([]);
        expect(
          (await readdir(f.media)).filter((name) => name.startsWith(".audio-suggestion-")),
        ).toEqual([]);
      } else {
        const clips = actual.audioClips as Record<string, unknown>[];
        expect(clips.length).toBeGreaterThan(1);
        for (const clip of clips)
          expect(sha(await readFile(String(clip.path)))).toBe(
            (clip.libraryAsset as { sha256: string }).sha256,
          );
      }
      advance("done");
    } finally {
      clearTimeout(observer);
      if (process.env.AIVORA_TEST_SAFE_PHASES === "1")
        process.stderr.write(`CI_LIBRARY_WRITE_PHASE ${JSON.stringify(snapshot())}\n`);
    }
  },
);
it("shares BUSY until apply settles and releases its reservation only after completion", async () => {
  const f = await fixture(),
    { request } = await suggested(f);
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((yes) => (release = yes)),
    started = new Promise<void>((yes) => (entered = yes));
  f.host.beforeCommit = async () => {
    entered();
    await hold;
  };
  const pending = f.library.applyBundledFilmShotAudio(request);
  try {
    await Promise.race([
      started,
      pending.then(() => {
        throw Error("COMMIT_NOT_STARTED");
      }),
    ]);
    expect(await f.library.applyBundledFilmShotAudio(request)).toMatchObject({ code: "BUSY" });
    expect(
      await f.library.inspectBundledFilmAudioTarget({
        projectId: request.projectId,
        expectedProjectHash: request.expectedProjectHash,
        shotId: request.shotId,
        takeId: request.takeId,
      }),
    ).toMatchObject({ code: "BUSY" });
  } finally {
    release();
    await pending;
  }
  expect(
    await f.library.inspectBundledFilmAudioTarget({
      projectId: request.projectId,
      expectedProjectHash: request.expectedProjectHash,
      shotId: request.shotId,
      takeId: request.takeId,
    }),
  ).toMatchObject({ code: "PROJECT_CHANGED" });
});
it("rejects unsafe exact apply inputs at zero copy/write independently of a pending apply", async () => {
  const g = await fixture(),
    prepared = await suggested(g),
    before = await readdir(g.media);
  for (const patch of [
    { lanes: [] },
    { lanes: ["sfx", "sfx"] },
    { lanes: ["dialogue"] },
    { path: "/forged" },
    { planFingerprint: "0".repeat(64) },
    { catalogSha256: "0".repeat(64) },
  ]) {
    expect(
      await g.library.applyBundledFilmShotAudio({
        ...prepared.request,
        ...patch,
      } as ApplyBundledFilmShotAudioInput),
    ).toMatchObject({ kind: "FAILED", unchanged: true });
  }
  expect(await readdir(g.media)).toEqual(before);
  expect((await readProject(g.filmsRoot, g.record.id))!.audioClips).toEqual([]);
});

it("rejects an over-128 combined plan without writing or silently dropping existing/new segments", async () => {
  const f = await fixture(),
    { request } = await suggested(f);
  const sound = join(f.media, "existing.ogg");
  await copyFile(
    (await loadTrustedAudioLibrary(bundle)).assets.find((asset) => asset.id === f.asset.id)!.file,
    sound,
  );
  const existing = Array.from({ length: 128 }, (_, index) => ({
    id: `existing-${index}`,
    lane: "sfx",
    shotId: "shot",
    takeId: "take",
    label: "旧音效",
    path: sound,
    startSeconds: 0,
    durationSeconds: 0.1,
    offsetSeconds: 0,
    gainDb: 0,
    loop: false,
    enabled: true,
  }));
  const old = (await readProject(f.filmsRoot, f.record.id))!;
  const stored = await writeProject(f.filmsRoot, { ...old, audioClips: existing });
  const before = await readFile(join(f.episode, "project.json")),
    bytes = await readFile(sound);
  expect(
    await f.library.applyBundledFilmShotAudio({
      ...request,
      expectedProjectHash: filmHistoryRecordHash(stored),
      lanes: ["sfx"],
    }),
  ).toMatchObject({ kind: "FAILED", code: "PLAN_UNSUPPORTED", unchanged: true });
  expect(await readFile(join(f.episode, "project.json"))).toEqual(before);
  expect(await readFile(sound)).toEqual(bytes);
  expect((await readdir(f.media)).filter((name) => name.startsWith(".audio-suggestion-"))).toEqual(
    [],
  );
});

it("keeps the same-factory barrier until the actual queued write settles, even when bytes already landed", async () => {
  const f = await fixture(),
    { request } = await suggested(f);
  let release!: () => void, entered!: () => void;
  fault.hold = new Promise<void>((yes) => (release = yes));
  const started = new Promise<void>((yes) => (entered = yes));
  fault.entered = entered;
  fault.mode = "pending";
  const work = f.library.applyBundledFilmShotAudio(request);
  let settled = false;
  void work.then(() => {
    settled = true;
  });
  try {
    await Promise.race([
      started,
      work.then(() => {
        throw Error("WRITE_NOT_STARTED");
      }),
    ]);
    const actual = (await readProject(f.filmsRoot, f.record.id))!;
    expect((actual.audioClips as unknown[]).length).toBeGreaterThan(1);
    expect(settled).toBe(false);
    expect(
      await f.library.inspectBundledFilmAudioTarget({
        projectId: actual.id,
        expectedProjectHash: filmHistoryRecordHash(actual),
        shotId: "shot",
        takeId: "take",
      }),
    ).toMatchObject({ code: "BUSY" });
    release();
    expect(await work).toMatchObject({ kind: "ADDED" });
    expect(
      await f.library.inspectBundledFilmAudioTarget({
        projectId: actual.id,
        expectedProjectHash: filmHistoryRecordHash(actual),
        shotId: "shot",
        takeId: "take",
      }),
    ).toMatchObject({ kind: "TARGET" });
  } finally {
    release();
    await work;
  }
});

it.each(["before", "after", "readback-wrong"] as const)(
  "keeps scene group %s write certainty and shared BUSY lifecycle without retrying or losing copies",
  async (mode) => {
    const f = await fixture();
    const { stored } = await suggested(f);
    const input = {
      projectId: stored.id,
      expectedProjectHash: filmHistoryRecordHash(stored),
      sceneId: "scene",
      expectedSelection: [{ shotId: "shot", takeId: "take" }],
    };
    const proposal = await f.library.suggestBundledFilmSceneAudio(input);
    if (proposal.kind !== "SCENE_SUGGESTED") throw Error("SCENE_NOT_READY");
    fault.mode = mode;
    const result = await f.library.applyBundledFilmSceneAudio({
      ...input,
      catalogSha256: proposal.catalogSha256,
      pickerSha256: proposal.pickerSha256,
      planFingerprint: proposal.planFingerprint,
      lanes: ["ambience", "sfx", "score"],
    });
    expect(result).toMatchObject({
      kind: "FAILED",
      code: mode === "before" ? "WRITE_FAILED" : "WRITE_UNCONFIRMED",
      unchanged: mode === "before",
    });
    fault.mode = "";
    const actual = (await readProject(f.filmsRoot, stored.id))!;
    if (mode === "before") {
      expect(actual.audioClips).toEqual([]);
      expect(
        (await readdir(f.media)).filter((name) => name.startsWith(".audio-suggestion-")),
      ).toEqual([]);
    } else {
      const clips = actual.audioClips as Record<string, unknown>[];
      expect(clips).toHaveLength(proposal.clips.length);
      for (const clip of clips)
        expect(sha(await readFile(String(clip.path)))).toBe(
          (clip.libraryAsset as { sha256: string }).sha256,
        );
    }
    expect(
      await f.library.inspectBundledFilmAudioTarget({
        projectId: actual.id,
        expectedProjectHash: filmHistoryRecordHash(actual),
        shotId: "shot",
        takeId: "take",
      }),
    ).toMatchObject({ kind: "TARGET" });
  },
  30000,
);
it("keeps the same scene reservation until an acknowledged write actually settles", async () => {
  const f = await fixture();
  const { stored } = await suggested(f);
  const input = {
    projectId: stored.id,
    expectedProjectHash: filmHistoryRecordHash(stored),
    sceneId: "scene",
    expectedSelection: [{ shotId: "shot", takeId: "take" }],
  };
  const proposal = await f.library.suggestBundledFilmSceneAudio(input);
  if (proposal.kind !== "SCENE_SUGGESTED") throw Error("SCENE_NOT_READY");
  let release!: () => void, entered!: () => void;
  fault.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  fault.entered = entered;
  fault.mode = "pending";
  const pending = f.library.applyBundledFilmSceneAudio({
    ...input,
    catalogSha256: proposal.catalogSha256,
    pickerSha256: proposal.pickerSha256,
    planFingerprint: proposal.planFingerprint,
    lanes: ["sfx"],
  });
  try {
    await started;
    expect(await f.library.suggestBundledFilmSceneAudio(input)).toMatchObject({
      kind: "FAILED",
      code: "BUSY",
    });
    expect(
      await f.library.inspectBundledFilmAudioTarget({
        projectId: input.projectId,
        expectedProjectHash: input.expectedProjectHash,
        shotId: "shot",
        takeId: "take",
      }),
    ).toMatchObject({ kind: "FAILED", code: "BUSY" });
  } finally {
    release();
    await pending;
    fault.mode = "";
    fault.hold = null;
    fault.entered = null;
  }
  const actual = (await readProject(f.filmsRoot, stored.id))!;
  expect(
    await f.library.inspectBundledFilmAudioTarget({
      projectId: actual.id,
      expectedProjectHash: filmHistoryRecordHash(actual),
      shotId: "shot",
      takeId: "take",
    }),
  ).toMatchObject({ kind: "TARGET" });
}, 30000);
