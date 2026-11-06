import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  createProjectArchives,
  portableProject,
  registerProjectArchives,
} from "./film-project-archive";
import { loadProjectArchiveEngine } from "./film-project-archive-runtime";
import { readProject, writeProject, listSeries, type FilmRecord } from "./film-library";
import { filmHistoryRecordText } from "./film-history";
import { exportFileHash } from "./film-export-io";
const folders: string[] = [],
  projectId = "film_aaaaaaaaaaaaaaaa",
  seriesId = "film_bbbbbbbbbbbbbbbb";
const hash = (v: unknown) => createHash("sha256").update(filmHistoryRecordText(v)).digest("hex");
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "project-archive-"));
  folders.push(root);
  const films = join(root, "films"),
    media = join(films, seriesId, "episodes", projectId, "media");
  await mkdir(media, { recursive: true });
  await copyFile(resolve("fixtures/shot-a.mp4"), join(media, "a.mp4"));
  await copyFile(resolve("fixtures/shot-b.mp4"), join(media, "b.mp4"));
  const image = join(media, "portrait.png"),
    audio = join(media, "voice.wav");
  await writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const wav = Buffer.alloc(44 + 1600);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(1600, 40);
  await writeFile(audio, wav);
  const film: FilmRecord = {
    schemaVersion: 1,
    id: projectId,
    seriesId,
    title: "工程包 合成作品",
    seriesTitle: "工程包 合成作品",
    episodeNo: 3,
    episodeTitle: "第三集",
    aspectRatio: "16:9",
    sourceText: "原始剧本文字",
    styleZh: "原画风",
    backendProjectId: `prj_${"a".repeat(32)}`,
    jobs: [{ id: "old-task", status: "running" }],
    pipeline: { receipt: "not-portable" },
    characters: [
      {
        id: "person",
        name: "小林",
        identity: "外貌",
        portraits: [{ view: "正面", url: image }],
        voiceId: "account-voice",
        secrets: { apiKey: "must-not-export" },
      },
    ],
    scenes: [{ id: "scene1", text: "合成剧本" }],
    shots: [
      {
        id: "shot1",
        sceneId: "scene1",
        no: 1,
        seconds: 2,
        poster: image,
        selectedTakeId: "take2",
        stills: [{ id: "still1", url: image }],
        takes: [
          {
            id: "take1",
            shotId: "shot1",
            index: 1,
            status: "done",
            videoPath: join(media, "a.mp4"),
            videoUrl: "blob:session",
            stillUrl: image,
            prompt: "版本1",
          },
          {
            id: "take2",
            shotId: "shot1",
            index: 2,
            status: "done",
            videoPath: join(media, "b.mp4"),
            cleanVideoPath: join(media, "a.mp4"),
            videoUrl: "",
            stillUrl: image,
            prompt: "版本2",
          },
        ],
      },
    ],
    audioClips: [
      {
        id: "audio1",
        lane: "dialogue",
        shotId: "shot1",
        takeId: "take2",
        path: audio,
        offsetSeconds: 0.2,
        durationSeconds: 1,
        gainDb: -3,
        waveform: { sourceKey: "cached" },
      },
    ],
  };
  await writeProject(films, film);
  const output = join(root, "工程包.aivora.zip"),
    engine = await loadProjectArchiveEngine(resolve("../../packages/aivora-media"));
  const host = {
    filmsRoot: films,
    storyFilmsRoot: join(root, "story"),
    temporaryRoot: join(root, "cache"),
    engine: async () => engine,
    pickExport: vi.fn(async () => output),
    pickImport: vi.fn(async () => output),
  };
  const archive = createProjectArchives(host);
  const input = async () => ({
    projectId,
    expectedHash: hash(await readProject(films, projectId)),
  });
  return { root, films, media, film, output, engine, host, archive, input };
}
afterEach(async () => {
  for (const f of folders.splice(0)) await rm(f, { recursive: true, force: true });
});
describe("real project package and isolated library restore", () => {
  it("roundtrips metadata/all retained takes/media SHA into a new work without runtime authorization", async () => {
    const env = await setup(),
      before = await readProject(env.films, projectId),
      original = await readFile(join(env.films, seriesId, "episodes", projectId, "project.json"));
    expect(await env.archive.export(await env.input())).toEqual({
      kind: "EXPORTED",
      mediaCount: 4,
    });
    const imported = await env.archive.import();
    expect(imported.kind).toBe("IMPORTED");
    if (imported.kind !== "IMPORTED") throw Error();
    const restored = await readProject(env.films, imported.projectId);
    expect(restored!.id).not.toBe(projectId);
    expect(restored!.seriesId).not.toBe(seriesId);
    expect(restored!.episodeTitle).toBe("第三集");
    expect(restored!.sourceText).toBe("原始剧本文字");
    expect(restored!.backendProjectId).toBe("");
    expect(restored!.jobs).toEqual([]);
    expect(restored!.pipeline).toBeUndefined();
    const oldShot = (before!.shots as Record<string, unknown>[])[0]!,
      shot = (restored!.shots as Record<string, unknown>[])[0]!;
    expect(shot.selectedTakeId).toBe("take2");
    expect((shot.takes as unknown[]).length).toBe(2);
    for (const [i, take] of (shot.takes as Record<string, unknown>[]).entries()) {
      const old = (oldShot.takes as Record<string, unknown>[])[i]!;
      expect(take.prompt).toBe(old.prompt);
      expect(await exportFileHash(String(take.videoPath))).toBe(
        await exportFileHash(String(old.videoPath)),
      );
      expect(take.videoUrl).toBe("");
      expect(String(take.videoPath)).toContain(imported.projectId);
    }
    const people = restored!.characters as Record<string, unknown>[];
    expect(people[0]!.voiceId).toBeUndefined();
    expect(JSON.stringify(restored)).not.toContain("must-not-export");
    expect((restored!.audioClips as Record<string, unknown>[])[0]!.waveform).toBeUndefined();
    expect(
      await readFile(join(env.films, seriesId, "episodes", projectId, "project.json")),
    ).toEqual(original);
    expect((await listSeries(env.films)).length).toBe(2);
  });
  it("refuses missing sources, stale identity and renderer-provided paths without overwriting output", async () => {
    const env = await setup();
    expect(await env.archive.export({ ...(await env.input()), output: env.output })).toEqual({
      kind: "FAILED",
      code: "INVALID_INPUT",
    });
    expect(await env.archive.export({ projectId, expectedHash: "0".repeat(64) })).toEqual({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
    });
    expect(env.host.pickExport).not.toHaveBeenCalled();
    await writeFile(env.output, "existing-user-file");
    expect(await env.archive.export(await env.input())).toEqual({
      kind: "FAILED",
      code: "OUTPUT_EXISTS",
    });
    expect(await readFile(env.output, "utf8")).toBe("existing-user-file");
    await rm(env.output);
    await rm(join(env.media, "a.mp4"));
    expect(await env.archive.export(await env.input())).toEqual({
      kind: "FAILED",
      code: "SOURCE_MISSING",
    });
    await expect(readFile(env.output)).rejects.toThrow();
  });
  it("returns cancellation and safely retains existing work on corrupted zip or metadata SHA", async () => {
    const env = await setup();
    env.host.pickExport.mockResolvedValueOnce(null as unknown as string);
    expect(await env.archive.export(await env.input())).toEqual({ kind: "CANCELLED" });
    env.host.pickImport.mockResolvedValueOnce(null as unknown as string);
    expect(await env.archive.import()).toEqual({ kind: "CANCELLED" });
    await writeFile(env.output, "not-a-zip");
    expect(await env.archive.import()).toEqual({ kind: "FAILED", code: "ARCHIVE_INVALID" });
    await rm(env.output);
    expect((await env.archive.export(await env.input())).kind).toBe("EXPORTED");
    const unpacked = join(env.root, "tampered");
    await env.engine.restoreProject({ archive: env.output, destination: unpacked });
    await writeFile(join(unpacked, "project.json"), "{}");
    await rm(env.output);
    await env.engine.archiveProject({ projectDir: unpacked, output: env.output });
    expect(await env.archive.import()).toEqual({ kind: "FAILED", code: "ARCHIVE_INVALID" });
    expect((await listSeries(env.films)).length).toBe(1);
  });
  it("does not delete or replace an existing series on an identity collision", async () => {
    const env = await setup();
    expect((await env.archive.export(await env.input())).kind).toBe("EXPORTED");
    const before = await readFile(join(env.films, seriesId, "episodes", projectId, "project.json"));
    const importer = createProjectArchives({
      ...env.host,
      allocateIdentity: () => ({ projectId: "film_cccccccccccccccc", seriesId }),
    });
    expect((await importer.import()).kind).toBe("FAILED");
    expect(
      await readFile(join(env.films, seriesId, "episodes", projectId, "project.json")),
    ).toEqual(before);
  });
  it("rolls back only its owned new reservation when saving fails, not existing library/media", async () => {
    const env = await setup();
    expect((await env.archive.export(await env.input())).kind).toBe("EXPORTED");
    const before = await readdir(env.films);
    const importer = createProjectArchives({
      ...env.host,
      write: async () => {
        throw Error("private error /path token");
      },
    });
    expect(await importer.import()).toEqual({ kind: "FAILED", code: "WRITE_FAILED" });
    expect(await readdir(env.films)).toEqual(before);
  });
  it("rejects unowned story media but accepts only its verified project/hash ownership", async () => {
    const env = await setup(),
      story = env.host.storyFilmsRoot;
    await mkdir(story);
    const path = join(story, "owned.mp4");
    await copyFile(join(env.media, "a.mp4"), path);
    const current = await readProject(env.films, projectId);
    (
      (current!.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[]
    )[0]!.videoPath = path;
    await writeProject(env.films, current);
    expect(await env.archive.export(await env.input())).toEqual({
      kind: "FAILED",
      code: "SOURCE_UNVERIFIED",
    });
    const owner = vi.fn(
      async (project: string, file: string, sha: string) =>
        project === `prj_${"a".repeat(32)}` &&
        file === realpathSync.native(path) &&
        sha === (await exportFileHash(path)),
    );
    expect(
      (await createProjectArchives({ ...env.host, storyOwner: owner }).export(await env.input()))
        .kind,
    ).toBe("EXPORTED");
    expect(owner).toHaveBeenCalled();
  });
  it("keeps a concurrently-created destination and rejects a late changed canonical project", async () => {
    const env = await setup();
    const race = createProjectArchives({
      ...env.host,
      engine: async () => ({
        ...env.engine,
        archiveProject: async (input) => {
          const file = await env.engine.archiveProject(input);
          await writeFile(env.output, "new-user-file");
          return file;
        },
      }),
    });
    expect(await race.export(await env.input())).toEqual({ kind: "FAILED", code: "OUTPUT_EXISTS" });
    expect(await readFile(env.output, "utf8")).toBe("new-user-file");
    await rm(env.output);
    const changed = createProjectArchives({
      ...env.host,
      engine: async () => ({
        ...env.engine,
        archiveProject: async (input) => {
          const file = await env.engine.archiveProject(input);
          const live = await readProject(env.films, projectId);
          live!.title = "后来保存的标题";
          await writeProject(env.films, live);
          return file;
        },
      }),
    });
    expect(await changed.export(await env.input())).toEqual({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
    });
    await expect(readFile(env.output)).rejects.toThrow();
    expect((await readProject(env.films, projectId))!.title).toBe("后来保存的标题");
  });
  it("refuses publication when source bytes change during packing and leaves the new source untouched", async () => {
    const env = await setup();
    const before = await readProject(env.films, projectId);
    const changed = createProjectArchives({
      ...env.host,
      engine: async () => ({
        ...env.engine,
        archiveProject: async (input) => {
          const file = await env.engine.archiveProject(input);
          await writeFile(join(env.media, "a.mp4"), "later-source-bytes");
          return file;
        },
      }),
    });
    expect(await changed.export(await env.input())).toEqual({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
    });
    await expect(readFile(env.output)).rejects.toThrow();
    expect(await readFile(join(env.media, "a.mp4"), "utf8")).toBe("later-source-bytes");
    expect(await readProject(env.films, projectId)).toEqual(before);
  });
  it("rejects extra executable entries and changed asset bytes after valid ZIP/CRC extraction", async () => {
    const env = await setup();
    expect((await env.archive.export(await env.input())).kind).toBe("EXPORTED");
    const unpacked = join(env.root, "extra-file");
    await env.engine.restoreProject({ archive: env.output, destination: unpacked });
    await writeFile(join(unpacked, "evil.mjs"), 'throw Error("MUST_NOT_RUN")');
    await rm(env.output);
    await env.engine.archiveProject({ projectDir: unpacked, output: env.output });
    expect(await env.archive.import()).toEqual({ kind: "FAILED", code: "ARCHIVE_INVALID" });
    await rm(join(unpacked, "evil.mjs"));
    const assets = await readdir(join(unpacked, "media"));
    await writeFile(join(unpacked, "media", assets[0]!), "different bytes");
    await rm(env.output);
    await env.engine.archiveProject({ projectDir: unpacked, output: env.output });
    expect(await env.archive.import()).toEqual({ kind: "FAILED", code: "ARCHIVE_INVALID" });
    expect((await listSeries(env.films)).length).toBe(1);
  });
  it("preserves canonical data-cover bytes and retained pending-take metadata without resuming it", async () => {
    const env = await setup(),
      current = await readProject(env.films, projectId);
    const png = await readFile(join(env.media, "portrait.png"));
    current!.cover = {
      backgroundUrl: `data:image/png;base64,${png.toString("base64")}`,
      headline: "封面标题",
    };
    ((current!.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[]).push({
      id: "pending-take",
      shotId: "shot1",
      index: 3,
      status: "running",
      videoPath: "",
      stillUrl: "",
      prompt: "保留未完成版本的说明",
      lipSync: { lipSync: "pending" },
    });
    await writeProject(env.films, current);
    expect((await env.archive.export(await env.input())).kind).toBe("EXPORTED");
    const result = await env.archive.import();
    if (result.kind !== "IMPORTED") throw Error();
    const restored = await readProject(env.films, result.projectId);
    const cover = restored!.cover as Record<string, unknown>;
    expect(await readFile(String(cover.backgroundUrl))).toEqual(png);
    expect(cover.headline).toBe("封面标题");
    const pending = (
      (restored!.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[]
    )[2]!;
    expect(pending.status).toBe("failed");
    expect(pending.prompt).toBe("保留未完成版本的说明");
    expect((pending.lipSync as Record<string, unknown>).lipSync).toBe("failed");
    expect(restored!.jobs).toEqual([]);
  });
  it("guards IPC sender/arity and strips machine auth/queued jobs from a project snapshot", async () => {
    const env = await setup();
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerProjectArchives<boolean>(
      (name, fn) => handlers.set(name, fn),
      (event) => event,
      env.host,
    );
    expect(await handlers.get("film:project-archive-import")!(false)).toEqual({
      kind: "FAILED",
      code: "INVALID_INPUT",
    });
    expect(
      await handlers.get("film:project-archive-import")!(true, "/renderer/archive.zip"),
    ).toEqual({ kind: "FAILED", code: "INVALID_INPUT" });
    expect(portableProject(env.film).jobs).toEqual([]);
    expect(portableProject(env.film).backendProjectId).toBe("");
  });
});
