import { createProjectArchives } from "./film-project-archive";
import { loadProjectArchiveEngine } from "./film-project-archive-runtime";
import { resolve } from "node:path";
import type * as FilmLibrary from "./film-library";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectDialogueSplitRecord } from "@aijian/contracts/film-dialogue-split-plan";
import { randomUUID } from "node:crypto";
import { createFilmDialogueSplits } from "./film-dialogue-split";
import { createFilmHistory, filmHistoryRecordHash } from "./film-history";
import { writeProject, readProject, type FilmRecord } from "./film-library";
import type { FilmDialogueSplitReady } from "@aijian/contracts/film-dialogue-split";
const fault = vi.hoisted(() => ({
  mode: "",
  applied: false,
  hold: null as Promise<void> | null,
  entered: null as (() => void) | null,
}));
vi.mock("./film-library", async (original) => {
  const actual = await original<typeof FilmLibrary>();
  return {
    ...actual,
    readProject: async (...args: Parameters<typeof actual.readProject>) => {
      const found = await actual.readProject(...args);
      if (fault.applied && fault.mode === "empty") return null;
      if (fault.applied && fault.mode === "wrong" && found)
        return { ...found, id: "film_cccccccccccccccc" };
      if (fault.applied && fault.mode === "stale" && found) return { ...found, shots: [] };
      return found;
    },
    transactFilmProject: <T>(
      root: string,
      id: string,
      action: Parameters<typeof actual.transactFilmProject<T>>[2],
    ) =>
      actual.transactFilmProject(root, id, (current, write) =>
        action(current, async (next) => {
          if (fault.mode === "before") throw Error("WRITE_FAILED");
          const stored = await write(next);
          fault.applied = true;
          if (fault.mode === "pending") {
            fault.entered?.();
            await fault.hold;
          }
          if (fault.mode === "after") throw Error("WRITE_FAILED");
          return stored;
        }),
      ),
  };
});
const roots: string[] = [];
afterEach(async () => {
  fault.mode = "";
  fault.applied = false;
  fault.hold = null;
  fault.entered = null;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dialogue-split-"));
  roots.push(root);
  const films = join(root, "films"),
    id = "film_aaaaaaaaaaaaaaaa",
    seriesId = "film_bbbbbbbbbbbbbbbb",
    episode = join(films, seriesId, "episodes", id),
    media = join(episode, "media");
  await mkdir(media, { recursive: true });
  const video = join(media, "old.mp4"),
    audio = join(media, "voice.wav");
  await writeFile(video, "original-video-bytes");
  await writeFile(audio, "original-audio-bytes");
  const source = {
    id: "source",
    sceneId: "scene",
    no: 1,
    line: ("长".repeat(35) + "。 ").repeat(3),
    speaker: "甲",
    lines: undefined,
    picture: "原画面",
    action: "原动作",
    performance: "原表演",
    characters: ["甲"],
    seconds: 15,
    userFields: ["picture", "action", "promptZh", "reviewedVideoPrompt"],
    promptZh: "旧画面说明",
    promptEn: "old prompt",
    directorPlan: { approved: true },
    directorVideoPrompt: "旧分段",
    performancePlan: { approved: true },
    source: "user",
    selectedTakeId: "take",
    takes: [
      {
        id: "take",
        shotId: "source",
        status: "done",
        videoPath: video,
        cleanVideoPath: video,
        sourceProof: { marker: "old-proof" },
      },
    ],
    stills: [{ id: "still", url: "" }],
    poster: "",
    sound: {
      source: "dub",
      ambience: "雨",
      musicMood: "温暖",
      sfx: [{ atSeconds: 2, text: "旧时点" }],
    },
    actionPlan: { nodes: [{ at: 2, move: "旧动作" }] },
    reviewedVideoPrompt: { approved: true },
  };
  const following = {
    ...source,
    id: "following",
    no: 2,
    line: "后镜",
    takes: [],
    stills: [],
    selectedTakeId: "",
    actionPlan: undefined,
  };
  const other = { ...following, id: "other", sceneId: "another", no: 1 };
  const record = await writeProject(films, {
    id,
    seriesId,
    schemaVersion: 1,
    characters: [],
    title: "原工程",
    draft: false,
    sourceText: "完整原文",
    scenes: [
      { id: "scene", no: 1, title: "第一场", coverage: { marker: "old" }, shotBudget: 1 },
      { id: "another", no: 2, title: "第二场" },
    ],
    shots: [source, following, other],
    audioClips: [
      {
        id: "old-voice",
        lane: "dialogue",
        shotId: "source",
        takeId: "take",
        label: "配音",
        path: audio,
        gainDb: 0,
        startSeconds: 0,
        durationSeconds: 15,
        offsetSeconds: 0,
      },
    ],
    jobs: [],
    productionPipeline: { status: "done", steps: [], inputFingerprint: "old-input" },
    productionInputFingerprint: "old-input",
    pipeline: { status: "done" },
    assemblyPath: video,
    assemblyUrl: "",
    exportPath: video,
  });
  const history = createFilmHistory({ filmsRoot: films });
  const host = {
    filmsRoot: films,
    history,
    beforeCommit: undefined as undefined | (() => Promise<void>),
  };
  const api = createFilmDialogueSplits(host);
  const input = {
    projectId: id,
    expectedHash: filmHistoryRecordHash(record),
    shotId: "source",
    versions: 2,
  };
  const file = join(episode, "project.json");
  return { root, films, id, episode, media, video, audio, record, input, file, history, host, api };
}
async function prepared(f: Awaited<ReturnType<typeof fixture>>): Promise<FilmDialogueSplitReady> {
  const result = await f.api.prepare(f.input);
  expect(result.kind).toBe("READY");
  if (result.kind !== "READY") throw Error(result.code);
  return result;
}
it("reviews canonical main plan without writes, then atomically backs up the full original and applies only new IDs", async () => {
  const f = await fixture(),
    before = await readFile(f.file),
    ready = await prepared(f);
  expect(await readFile(f.file)).toEqual(before);
  expect(await readdir(f.episode)).not.toContain("history");
  const result = await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  expect(result.kind).toBe("APPLIED");
  if (result.kind !== "APPLIED") throw Error(result.code);
  expect(result.childIds).toHaveLength(3);
  expect(new Set(result.childIds).size).toBe(3);
  expect(result.childIds).not.toContain("source");
  const shots = result.project.shots as Record<string, unknown>[];
  expect(
    shots
      .slice(0, 3)
      .map((shot) => shot.line)
      .join(""),
  ).toBe((f.record.shots![0] as { line: string }).line);
  expect(shots.map((shot) => shot.id)).toEqual([...result.childIds, "following", "other"]);
  expect(shots.map((shot) => shot.no)).toEqual([1, 2, 3, 4, 1]);
  for (const shot of shots.slice(0, 3)) {
    expect(shot.takes).toEqual([]);
    expect(shot.stills).toEqual([]);
    expect(shot.selectedTakeId).toBe("");
    expect(shot.actionPlan).toBeUndefined();
    expect(shot.reviewedVideoPrompt).toBeUndefined();
    expect(shot.promptZh).toBeUndefined();
    expect(shot.promptEn).toBeUndefined();
    expect(shot.directorPlan).toBeUndefined();
    expect(shot.performancePlan).toBeUndefined();
    expect(shot.directorVideoPrompt).toBeUndefined();
    expect(shot.userFields).toEqual(["picture", "action", "line", "seconds"]);
    expect((shot.sound as { sfx: unknown[] }).sfx).toEqual([]);
    expect(shot.splitSource).toMatchObject({
      historyId: result.backup.id,
      sourceShotId: "source",
      reviewFingerprint: ready.reviewFingerprint,
    });
  }
  expect(result.project.audioClips).toEqual(f.record.audioClips);
  expect(result.project.sourceText).toBe(f.record.sourceText);
  expect(result.project.assemblyPath).toBe("");
  expect(result.project.productionPipeline).toBeUndefined();
  expect(result.project.productionInputFingerprint).toBeUndefined();
  expect(result.project.pipeline).toBeUndefined();
  const snapshot = JSON.parse(
    await readFile(join(f.episode, "history", `${result.backup.id}.json`), "utf8"),
  );
  expect(snapshot.snapshot).toEqual(f.record);
  expect(snapshot.entry.reason).toBe("before-dialogue-split");
  const { checksum, ...body } = snapshot;
  expect(checksum).toBe(filmHistoryRecordHash(body));
  expect(await readFile(f.video, "utf8")).toBe("original-video-bytes");
  expect(await readFile(f.audio, "utf8")).toBe("original-audio-bytes");
  const listed = await createFilmHistory({ filmsRoot: f.films }).list(f.id);
  expect(listed).toMatchObject({
    kind: "LIST",
    entries: [{ id: result.backup.id, reason: "before-dialogue-split" }],
  });
  expect(
    await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint }),
  ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true });
  const restored = await f.history.restore({
    projectId: f.id,
    historyId: result.backup.id,
    expectedHash: filmHistoryRecordHash(result.project),
  });
  expect(restored.kind).toBe("RESTORED");
  if (restored.kind === "RESTORED")
    expect((restored.project as FilmRecord).shots).toEqual(f.record.shots);
});
it.each(["null-shot", "bad-shot", "null-scene", "duplicate-scene"])(
  "rejects unrelated %s without dropping records or making a backup",
  async (mode) => {
    const f = await fixture();
    const next = structuredClone(f.record);
    if (mode === "null-shot") next.shots!.push(null);
    if (mode === "bad-shot") next.shots!.push({ id: "unknown", weird: true });
    if (mode === "null-scene") (next.scenes as unknown[]).push(null);
    if (mode === "duplicate-scene") (next.scenes as unknown[]).push((next.scenes as unknown[])[0]);
    const stored = await writeProject(f.films, next),
      before = await readFile(f.file),
      input = { ...f.input, expectedHash: filmHistoryRecordHash(stored) };
    expect(await f.api.prepare(input)).toMatchObject({ kind: "FAILED", unchanged: true });
    expect(await f.api.apply({ ...input, reviewFingerprint: "a".repeat(64) })).toMatchObject({
      kind: "FAILED",
      unchanged: true,
    });
    expect(await readFile(f.file)).toEqual(before);
    expect(await readdir(f.episode)).not.toContain("history");
  },
);
it.each(["edit", "take", "project", "continuity", "busy"])(
  "rejects stale or unsafe %s on main's actual queue at zero structure writes",
  async (mode) => {
    const f = await fixture(),
      ready = await prepared(f);
    const next = structuredClone(f.record);
    if (mode === "edit") (next.shots![0] as Record<string, unknown>).line = "new edit";
    if (mode === "take") (next.shots![0] as Record<string, unknown>).selectedTakeId = "other";
    if (mode === "continuity")
      (next.shots![1] as Record<string, unknown>).continuityFromShotId = "source";
    if (mode === "busy") next.jobs = [{ status: "running" }];
    const stored = await writeProject(f.films, next),
      before = await readFile(f.file);
    const input = {
      ...f.input,
      projectId: mode === "project" ? "film_cccccccccccccccc" : f.id,
      expectedHash: filmHistoryRecordHash(stored),
      reviewFingerprint: ready.reviewFingerprint,
    };
    expect(await f.api.apply(input)).toMatchObject({ kind: "FAILED", unchanged: true });
    expect(await readFile(f.file)).toEqual(before);
    expect(await readdir(f.episode)).not.toContain("history");
  },
);
it("failed mandatory backup never changes structure, while a post-backup external edit remains intact", async () => {
  const f = await fixture(),
    ready = await prepared(f),
    before = await readFile(f.file);
  const bad = createFilmDialogueSplits({
    filmsRoot: f.films,
    history: createFilmHistory({
      filmsRoot: f.films,
      beforeSnapshotWrite: async () => {
        throw Error("backup failed");
      },
    }),
  });
  expect(await bad.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint })).toMatchObject(
    { code: "BACKUP_FAILED", unchanged: true },
  );
  expect(await readFile(f.file)).toEqual(before);
  const next = { ...f.record, title: "external newer edit" };
  const raced = createFilmDialogueSplits({
    filmsRoot: f.films,
    history: createFilmHistory({
      filmsRoot: f.films,
      beforeSnapshotWrite: async () => {
        await writeFile(f.file, JSON.stringify(next));
      },
    }),
  });
  expect(
    await raced.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint }),
  ).toMatchObject({ code: "PROJECT_CHANGED", unchanged: true });
  expect(await readProject(f.films, f.id)).toEqual(next);
});
it.each(["before", "after", "empty", "wrong", "stale"])(
  "reports %s write/readback failure without deleting local backups or original media",
  async (mode) => {
    const f = await fixture(),
      ready = await prepared(f);
    fault.mode = mode;
    const result = await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
    expect(result).toMatchObject({
      kind: "FAILED",
      code: mode === "before" ? "WRITE_FAILED" : "WRITE_UNCONFIRMED",
      unchanged: mode === "before",
    });
    fault.mode = "";
    const actual = (await readProject(f.films, f.id))!;
    expect(actual.shots).toHaveLength(mode === "before" ? 3 : 5);
    expect((await readdir(join(f.episode, "history"))).length).toBe(1);
    expect(await readFile(f.video, "utf8")).toBe("original-video-bytes");
  },
);
it("keeps its barrier while the real queued write is pending and releases only on settlement", async () => {
  const f = await fixture(),
    ready = await prepared(f);
  let release!: () => void, enter!: () => void;
  fault.hold = new Promise<void>((yes) => (release = yes));
  const started = new Promise<void>((yes) => (enter = yes));
  fault.entered = enter;
  fault.mode = "pending";
  const pending = f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  try {
    await Promise.race([
      started,
      pending.then(() => {
        throw Error("WRITE_NOT_ENTERED");
      }),
    ]);
    const actual = (await readProject(f.films, f.id))!;
    expect(actual.shots).toHaveLength(5);
    expect(
      await f.api.prepare({ ...f.input, expectedHash: filmHistoryRecordHash(actual) }),
    ).toMatchObject({ code: "BUSY" });
    release();
    expect(await pending).toMatchObject({ kind: "APPLIED" });
    expect(await f.api.prepare(f.input)).toMatchObject({ code: "PROJECT_CHANGED" });
  } finally {
    release();
    await pending;
  }
});

it("keeps source linkage through current-only portable ZIP without fabricating an imported local history", async () => {
  const f = await fixture(),
    ready = await prepared(f),
    result = await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  if (result.kind !== "APPLIED") throw Error(result.code);
  const zip = join(f.root, "current-only.zip"),
    archive = createProjectArchives({
      filmsRoot: f.films,
      storyFilmsRoot: f.root,
      temporaryRoot: join(f.root, "archive-tmp"),
      engine: () => loadProjectArchiveEngine(resolve("../../packages/aivora-media")),
      pickExport: async () => zip,
      pickImport: async () => zip,
    });
  expect(
    await archive.export({ projectId: f.id, expectedHash: filmHistoryRecordHash(result.project) }),
  ).toMatchObject({ kind: "EXPORTED" });
  const imported = await archive.import();
  if (imported.kind !== "IMPORTED") throw Error("IMPORT_FAILED");
  const record = (await readProject(f.films, imported.projectId))!;
  expect((record.shots![0] as Record<string, unknown>).splitSource).toEqual(
    (result.project.shots as Record<string, unknown>[])[0]!.splitSource,
  );
  expect(await createFilmHistory({ filmsRoot: f.films }).list(record.id)).toMatchObject({
    kind: "LIST",
    entries: [],
  });
  expect(
    await createFilmHistory({ filmsRoot: f.films }).restore({
      projectId: record.id,
      historyId: result.backup.id,
      expectedHash: filmHistoryRecordHash(record),
    }),
  ).toMatchObject({ kind: "FAILED", unchanged: true });
  expect(await readFile(f.video, "utf8")).toBe("original-video-bytes");
});

it("uses fresh raw CAS after an unchanged save while keeping the main-reviewed semantic plan", async () => {
  const f = await fixture(),
    ready = await prepared(f);
  const saved = await writeProject(f.films, { ...f.record, savedAt: "old timestamp" });
  const fresh = { ...f.input, expectedHash: filmHistoryRecordHash(saved) };
  expect(fresh.expectedHash).not.toBe(f.input.expectedHash);
  const review = await f.api.prepare(fresh);
  expect(review).toMatchObject({ kind: "READY", reviewFingerprint: ready.reviewFingerprint });
  expect(await f.api.apply({ ...fresh, reviewFingerprint: ready.reviewFingerprint })).toMatchObject(
    { kind: "APPLIED" },
  );
});
it("verifies the actual checksummed split backup against complete original hash without restoring or writing", async () => {
  const f = await fixture(),
    ready = await prepared(f),
    result = await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  expect(result.kind).toBe("APPLIED");
  if (result.kind !== "APPLIED") throw Error("not applied");
  const bytes = await readFile(f.file),
    proof = { projectId: f.id, historyId: result.backup.id, beforeHash: f.input.expectedHash };
  expect(await f.api.verifyBackup(proof)).toEqual({
    kind: "VERIFIED",
    ...proof,
    entry: result.backup,
  });
  expect(await readFile(f.file)).toEqual(bytes);
  expect(await f.api.verifyBackup({ ...proof, beforeHash: "0".repeat(64) })).toMatchObject({
    kind: "FAILED",
    code: "BACKUP_FAILED",
  });
  expect(await f.api.verifyBackup({ ...proof, historyId: "hst_" + "0".repeat(32) })).toMatchObject({
    kind: "FAILED",
    code: "BACKUP_FAILED",
  });
  expect(await f.api.verifyBackup({ ...proof, projectId: "film_cccccccccccccccc" })).toMatchObject({
    kind: "FAILED",
    code: "BACKUP_FAILED",
  });
  expect(await f.api.verifyBackup({ ...proof, path: "forged" })).toMatchObject({
    kind: "FAILED",
    code: "INVALID_INPUT",
  });
  expect(await readFile(f.file)).toEqual(bytes);
});
it("never trusts matching history labels or summary when the snapshot bytes/checksum or original content differ", async () => {
  const f = await fixture(),
    ready = await prepared(f),
    result = await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  if (result.kind !== "APPLIED") throw Error("not applied");
  const path = join(f.episode, "history", result.backup.id + ".json"),
    stored = JSON.parse(await readFile(path, "utf8")),
    proof = { projectId: f.id, historyId: result.backup.id, beforeHash: f.input.expectedHash };
  stored.snapshot.sourceText = "tampered creative body";
  await writeFile(path, JSON.stringify(stored));
  expect(await f.api.verifyBackup(proof)).toMatchObject({ kind: "FAILED", code: "BACKUP_FAILED" });
  const body = { ...stored };
  delete body.checksum;
  stored.checksum = filmHistoryRecordHash(body);
  await writeFile(path, JSON.stringify(stored));
  expect(await f.api.verifyBackup(proof)).toMatchObject({ kind: "FAILED", code: "BACKUP_FAILED" });
});
it("backup verification remains BUSY until the original native write/readback lifecycle actually settles", async () => {
  const f = await fixture(),
    ready = await prepared(f);
  let release!: () => void, entered!: () => void;
  fault.mode = "pending";
  fault.hold = new Promise<void>((r) => (release = r));
  const admission = new Promise<void>((r) => (entered = r));
  fault.entered = entered;
  const pending = f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  await admission;
  const entries = await readdir(join(f.episode, "history")),
    historyId = entries[0]!.replace(/\.json$/u, "");
  expect(
    await f.api.verifyBackup({ projectId: f.id, historyId, beforeHash: f.input.expectedHash }),
  ).toMatchObject({ kind: "FAILED", code: "BUSY" });
  release();
  const result = await pending;
  expect(result.kind).toBe("APPLIED");
  expect(
    await f.api.verifyBackup({ projectId: f.id, historyId, beforeHash: f.input.expectedHash }),
  ).toMatchObject({ kind: "VERIFIED" });
});
it("shared structural projection rejects old shot/take/clip identities and duplicate new children without mutating the original", async () => {
  const f = await fixture(),
    ready = await prepared(f),
    original = structuredClone(f.record),
    historyId = "hst_" + "f".repeat(32),
    ids = ready.plan.parts.map(() => randomUUID());
  expect(
    projectDialogueSplitRecord(
      f.record,
      "source",
      ready.plan,
      ready.reviewFingerprint,
      historyId,
      ids,
    ),
  ).not.toBeNull();
  for (const old of ["source", "take", "old-voice"]) {
    expect(
      projectDialogueSplitRecord(
        f.record,
        "source",
        ready.plan,
        ready.reviewFingerprint,
        historyId,
        [old, ...ids.slice(1)],
      ),
    ).toBeNull();
  }
  expect(
    projectDialogueSplitRecord(
      f.record,
      "source",
      ready.plan,
      ready.reviewFingerprint,
      historyId,
      ids.map(() => ids[0]!),
    ),
  ).toBeNull();
  expect(f.record).toEqual(original);
});
it("valid checksum and original hash still do not grant a differently labelled or cross-series history entry as split backup", async () => {
  const f = await fixture(),
    ready = await prepared(f),
    result = await f.api.apply({ ...f.input, reviewFingerprint: ready.reviewFingerprint });
  if (result.kind !== "APPLIED") throw Error("not applied");
  const path = join(f.episode, "history", result.backup.id + ".json"),
    original = JSON.parse(await readFile(path, "utf8")),
    proof = { projectId: f.id, historyId: result.backup.id, beforeHash: f.input.expectedHash };
  for (const kind of ["reason", "series"]) {
    const changed = structuredClone(original);
    if (kind === "reason") changed.entry.reason = "manual";
    else changed.seriesId = "film_cccccccccccccccc";
    const body = { ...changed };
    delete body.checksum;
    changed.checksum = filmHistoryRecordHash(body);
    await writeFile(path, JSON.stringify(changed));
    expect(await f.api.verifyBackup(proof)).toMatchObject({
      kind: "FAILED",
      code: "BACKUP_FAILED",
    });
  }
});
