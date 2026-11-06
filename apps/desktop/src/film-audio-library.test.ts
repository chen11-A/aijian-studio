import type * as FilmLibraryModule from "./film-library";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
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
const fault = vi.hoisted(() => ({ mode: "" }));
vi.mock("./film-library", async (original) => {
  const actual = await original<typeof FilmLibraryModule>();
  return {
    ...actual,
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
          if (fault.mode === "before") throw Error("write failure");
          const stored = await write(next);
          if (fault.mode === "after") throw Error("index update failure");
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
