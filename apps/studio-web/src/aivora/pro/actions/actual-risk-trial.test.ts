import { afterEach, expect, it, vi } from "vitest";
import type {
  FilmRiskTrialGateway,
  FilmRiskTrialInput,
  FilmRiskTrialReady,
} from "@aijian/contracts/film-risk-trial";
import { sampleFilm, type FilmProject } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import { historyRecordHash } from "./persistent-history";
import {
  actualTrialInputKey,
  prepareActualTrial,
  readActualTrialMedia,
  type ActualTrialHost,
} from "./actual-risk-trial";
const copy = <T>(value: T): T => structuredClone(value);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  delete window.aijian;
  vi.restoreAllMocks();
});
function fixture() {
  let live = sampleFilm();
  for (const shot of live.shots) shot.continuityFromShotId = "";
  const target = live.shots[0]!;
  target.selectedTakeId = "take-real";
  target.takes = [
    {
      id: "take-real",
      shotId: target.id,
      index: 3,
      status: "done",
      videoPath: "/private/actual.mp4",
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      reason: "",
      createdAt: "",
    },
  ];
  let disk = copy(live),
    failSave = false;
  const writes: FilmProject[] = [];
  const scope = {
    projectId: live.id,
    shotId: target.id,
    takeId: target.selectedTakeId,
    page: "edit",
  };
  const persistence = createFilmPersistence({
    current: () => live,
    write: async (film) => {
      if (failSave) throw Error("PRIVATE_PATH_SHOULD_NOT_RENDER");
      disk = { ...copy(film), savedAt: "2026-11-07T00:00:00.000Z" };
      writes.push(copy(disk));
      return copy(disk);
    },
  });
  const host: ActualTrialHost = {
    current: () => live,
    selection: () => scope,
    apply: (film) => (live = film),
    persistence,
  };
  const ready = (input: FilmRiskTrialInput): FilmRiskTrialReady => ({
    kind: "READY",
    projectId: input.projectId,
    projectHash: input.expectedHash,
    reviewId: `rtr_${"a".repeat(32)}`,
    shotId: input.shotId,
    takeId: input.takeId,
    inputFingerprint: "a".repeat(64),
    label: "第 7 场 · 镜头 4",
    versionLabel: "第 3 版",
    durationSeconds: 2.25,
    batchShotCount: disk.shots.length,
    existingDecision: null,
    limitations: ["人工记录不代替技术验收。"],
  });
  const prepare = vi.fn<FilmRiskTrialGateway["prepareFilmRiskTrial"]>(async (input) => {
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    return ready(input);
  });
  const media = vi.fn<FilmRiskTrialGateway["readFilmRiskTrialMedia"]>(async () => ({
    kind: "MEDIA" as const,
    bytes: new Uint8Array([1, 2, 3]),
  }));
  const record = vi.fn(),
    check = vi.fn();
  window.aijian = {
    readFilmProject: vi.fn(async () => copy(disk)),
    prepareFilmRiskTrial: prepare,
    readFilmRiskTrialMedia: media,
    recordFilmRiskTrialDecision: record,
    checkFilmRiskTrialDecision: check,
  } as unknown as NonNullable<typeof window.aijian>;
  return {
    host,
    scope,
    persistence,
    writes,
    prepare,
    media,
    record,
    check,
    ready,
    current: () => live,
    raw: () => copy(disk),
    setRaw: (value: FilmProject) => {
      disk = value;
    },
    edit: (change: Partial<FilmProject>) => {
      live = { ...live, ...change };
    },
    fail: () => {
      failSave = true;
    },
  };
}
it("saves through the real queue then releases the owner before native preparation, media reading or human review", async () => {
  const f = fixture(),
    entered = deferred<void>(),
    reply = deferred<FilmRiskTrialReady>();
  f.prepare.mockImplementationOnce(async (input) => {
    entered.resolve();
    await reply.promise;
    return f.ready(input);
  });
  const task = prepareActualTrial(f.host, () => true);
  await entered.promise;
  expect(f.writes).toHaveLength(1);
  expect((await f.persistence.flushAll()).status).toBe("saved");
  const lease = await f.persistence.acquire(f.scope.projectId);
  await lease.release();
  reply.resolve(f.ready(f.prepare.mock.calls[0]![0]));
  const result = await task;
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw Error("READY_REQUIRED");
  expect(await readActualTrialMedia(f.host, result.review, () => true)).toEqual({
    kind: "media",
    bytes: new Uint8Array([1, 2, 3]),
  });
  expect(f.media).toHaveBeenCalledExactlyOnceWith(f.scope.projectId, result.review.ready.reviewId);
  expect(f.record).not.toHaveBeenCalled();
  expect(f.check).not.toHaveBeenCalled();
  expect(f.current().shots).toEqual(f.raw().shots);
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("does not prepare after save failure and never exposes the original exception", async () => {
  const f = fixture();
  f.fail();
  expect(await prepareActualTrial(f.host, () => true)).toEqual({
    kind: "failed",
    message: "当前编辑还没保存上，请先核对保存状态，再准备试片。",
  });
  expect(f.prepare).not.toHaveBeenCalled();
  expect((await f.persistence.flushAll()).status).toBe("failed");
});
it("re-reads only a saved-time CAS change once using the complete fresh canonical hash", async () => {
  const f = fixture(),
    before = copy(f.current());
  f.prepare.mockImplementationOnce(async () => {
    f.setRaw({ ...f.raw(), savedAt: "2026-11-07T00:00:01.000Z" });
    return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  });
  const result = await prepareActualTrial(f.host, () => true);
  expect(result.kind).toBe("ready");
  expect(f.prepare).toHaveBeenCalledTimes(2);
  const first = f.prepare.mock.calls[0]![0],
    second = f.prepare.mock.calls[1]![0];
  expect(first.expectedHash).not.toBe(second.expectedHash);
  expect(second.expectedHash).toBe(await historyRecordHash(f.raw()));
  expect(f.current()).toEqual(before);
  expect(f.record).not.toHaveBeenCalled();
});
it("rejects creative CAS drift without a second preparation or canonical adoption", async () => {
  const f = fixture(),
    before = copy(f.current());
  f.prepare.mockImplementationOnce(async () => {
    f.setRaw({ ...f.raw(), styleZh: "实际不同的创作决定" });
    return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
  });
  expect((await prepareActualTrial(f.host, () => true)).kind).toBe("failed");
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.current()).toEqual(before);
});
it("discards closed or changed-version late preparations and media without recording anything", async () => {
  const f = fixture(),
    gate = deferred<FilmRiskTrialReady>(),
    admitted = deferred<void>();
  let current = true;
  f.prepare.mockImplementationOnce(async (input) => {
    admitted.resolve();
    await gate.promise;
    return f.ready(input);
  });
  const task = prepareActualTrial(f.host, () => current);
  await admitted.promise;
  current = false;
  gate.resolve(f.ready(f.prepare.mock.calls[0]![0]));
  expect(await task).toEqual({ kind: "stale" });
  expect(f.media).not.toHaveBeenCalled();
  const result = await prepareActualTrial(f.host, () => true);
  if (result.kind !== "ready") throw Error("READY_REQUIRED");
  const mediaGate = deferred<{ kind: "MEDIA"; bytes: Uint8Array }>(),
    mediaEntered = deferred<void>();
  f.media.mockImplementationOnce(async () => {
    mediaEntered.resolve();
    return mediaGate.promise;
  });
  const reading = readActualTrialMedia(f.host, result.review, () => true);
  await mediaEntered.promise;
  f.edit({
    shots: f
      .current()
      .shots.map((shot) =>
        shot.id === f.scope.shotId ? { ...shot, selectedTakeId: "another" } : shot,
      ),
  });
  mediaGate.resolve({ kind: "MEDIA", bytes: new Uint8Array([1]) });
  expect(await reading).toEqual({ kind: "stale" });
  expect(f.record).not.toHaveBeenCalled();
});
it("requires an explicit unique actual selected version and reports missing native capability without local substitution", async () => {
  const f = fixture();
  expect(actualTrialInputKey(f.current(), f.scope)).not.toBeNull();
  const duplicate = copy(f.current());
  duplicate.shots.push(copy(duplicate.shots[0]!));
  expect(actualTrialInputKey(duplicate, f.scope)).toBeNull();
  const unselected = copy(f.current());
  unselected.shots[0]!.selectedTakeId = "";
  expect(actualTrialInputKey(unselected, f.scope)).toBeNull();
  delete window.aijian!.prepareFilmRiskTrial;
  expect(await prepareActualTrial(f.host, () => true)).toEqual({ kind: "unsupported" });
  expect(f.writes).toHaveLength(0);
});
