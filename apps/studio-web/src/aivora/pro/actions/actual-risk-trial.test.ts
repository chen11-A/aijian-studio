import { afterEach, expect, it, vi } from "vitest";
import type {
  FilmRiskTrialDecision,
  FilmRiskTrialRecordInput,
  FilmRiskTrialGateway,
  FilmRiskTrialInput,
  FilmRiskTrialReady,
} from "@aijian/contracts/film-risk-trial";
import { sampleFilm, type FilmProject } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import * as hashes from "./persistent-history";
import { historyRecordHash } from "./persistent-history";
import { recordActualTrial, recoverActualTrial } from "./actual-risk-trial-record";
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
  const record = vi.fn<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>(),
    check = vi.fn<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>();
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

async function recordingFixture() {
  const f = fixture();
  const binding = {
    global: "b".repeat(64),
    trial: "c".repeat(64),
    targets: [{ shotId: f.scope.shotId, fingerprint: "d".repeat(64) }],
  };
  const fingerprint = await historyRecordHash({
    projectId: f.scope.projectId,
    shotId: f.scope.shotId,
    takeId: f.scope.takeId,
    binding,
  });
  f.prepare.mockImplementation(async (input) => {
    if (input.expectedHash !== (await historyRecordHash(f.raw())))
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    const rows = f.raw().riskTrialDecisions ?? [];
    const prior = rows.at(-1);
    return {
      ...f.ready(input),
      inputFingerprint: fingerprint,
      existingDecision: prior
        ? (Object.fromEntries(
            Object.entries(prior).filter(([key]) => key !== "binding"),
          ) as unknown as FilmRiskTrialDecision)
        : null,
    };
  });
  const first = await prepareActualTrial(f.host, () => true);
  if (first.kind !== "ready") throw Error("READY_REQUIRED");
  const write = (input: FilmRiskTrialRecordInput) => {
    const decision = {
      schemaVersion: 1 as const,
      id: `rtd_${"e".repeat(32)}`,
      projectId: input.projectId,
      shotId: f.scope.shotId,
      takeId: f.scope.takeId,
      inputFingerprint: fingerprint,
      decision: input.decision,
      note: input.note,
      recordedAt: "2026-11-07T01:00:00.000Z",
    };
    f.setRaw({
      ...f.raw(),
      savedAt: "2026-11-07T01:00:00.000Z",
      riskTrialDecisions: [
        ...(f.raw().riskTrialDecisions ?? []),
        Object.assign({ ...decision }, { binding }),
      ],
    });
    return {
      kind: "RECORDED" as const,
      project: f.raw() as unknown as Record<string, unknown>,
      decision,
    };
  };
  f.record.mockImplementation(async (input) => write(input));
  return { ...f, review: first.review, write };
}
it("records exactly once through native, validates the full append and source receipt, and preserves all existing media", async () => {
  const f = await recordingFixture(),
    before = copy(f.current());
  const result = await recordActualTrial(f.host, f.review, "accepted", "  人工原文🙂  ");
  expect(result.kind).toBe("recorded");
  expect(result.recorded?.verified).toBe(true);
  expect(result.recorded?.value.note).toBe("  人工原文🙂  ");
  expect(f.record).toHaveBeenCalledTimes(1);
  expect(f.check).not.toHaveBeenCalled();
  expect(f.current().shots).toEqual(before.shots);
  expect(f.current().audioClips).toEqual(before.audioClips);
  expect(f.current().riskTrialDecisions).toEqual(f.raw().riskTrialDecisions);
  expect(f.persistence.externalWriteState(before.id)).toBeNull();
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("keeps a lost ACK globally unknown while main is BUSY, then checks one complete append without repeating record", async () => {
  const f = await recordingFixture();
  let busy = true;
  f.record.mockImplementationOnce(async (input) => {
    f.write(input);
    throw Error("LOST_ACK_PRIVATE");
  });
  const producer = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementation(async (input) =>
    busy ? { kind: "FAILED", code: "BUSY", unchanged: true } : producer(input),
  );
  const result = await recordActualTrial(f.host, f.review, "needs-changes", "还需核对");
  expect(result.kind).toBe("unknown");
  expect(result.pending).toBeTruthy();
  expect((await f.persistence.flushAll()).status).toBe("unknown");
  expect((await recoverActualTrial(f.host, result.pending!)).kind).toBe("unknown");
  busy = false;
  const recovered = await recoverActualTrial(f.host, result.pending!);
  expect(recovered.kind).toBe("recorded");
  expect(recovered.recorded?.verified).toBe(true);
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("does not confuse malformed or partial raw deltas with a recorded decision", async () => {
  const f = await recordingFixture();
  f.record.mockImplementationOnce(async (input) => {
    const result = f.write(input);
    f.setRaw({ ...f.raw(), title: "意外其他改动" });
    return result;
  });
  const result = await recordActualTrial(f.host, f.review, "accepted", "");
  expect(result.kind).toBe("unknown");
  expect(f.current().riskTrialDecisions).toBeUndefined();
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.persistence.flushAll()).status).toBe("unknown");
});
it("preserves late edits as conflict, then explicitly adopts only a fresh verified saved version", async () => {
  const f = await recordingFixture(),
    admitted = deferred<void>(),
    reply = deferred<void>();
  f.record.mockImplementationOnce(async (input) => {
    const result = f.write(input);
    admitted.resolve();
    await reply.promise;
    return result;
  });
  const recording = recordActualTrial(f.host, f.review, "accepted", "人工记录");
  await admitted.promise;
  f.edit({ title: "后来仍保留的草稿" });
  await f.persistence.save(f.current());
  reply.resolve();
  const result = await recording;
  expect(result.kind).toBe("unknown");
  expect(f.current().title).toBe("后来仍保留的草稿");
  const context = result.pending!;
  expect(context.observedRaw).toBeTruthy();
  const conflict = {
    raw: context.observedRaw!,
    live: f.current(),
    draft: f.persistence.externalWriteState(f.scope.projectId)!.draft,
  };
  const resolved = await recoverActualTrial(f.host, context, conflict);
  expect(resolved.kind).toBe("recorded");
  expect(f.current().title).toBe(context.rawBefore.title);
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("keeps transport failure unknown until a legal gate and two complete exact-before reads prove no write", async () => {
  const f = await recordingFixture();
  f.record.mockRejectedValueOnce(Error("UNREACHABLE_PRIVATE"));
  f.prepare.mockRejectedValueOnce(Error("UNREACHABLE_PRIVATE"));
  const result = await recordActualTrial(f.host, f.review, "needs-changes", "");
  expect(result.kind).toBe("unknown");
  expect((await recoverActualTrial(f.host, result.pending!)).kind).toBe("unknown");
  expect((await f.persistence.flushAll()).status).toBe("unknown");
  const resolved = await recoverActualTrial(f.host, result.pending!);
  expect(resolved.kind).toBe("failed");
  expect(f.persistence.externalWriteState(f.scope.projectId)).toBeNull();
  expect(f.current().riskTrialDecisions).toBeUndefined();
  expect(f.record).toHaveBeenCalledTimes(1);
});

it.each(["current", "foreign"] as const)(
  "rechecks %s current/draft identity after a yielded proof before confirming or applying",
  async (kind) => {
    const f = await recordingFixture();
    f.record.mockImplementationOnce(async (input) => {
      f.write(input);
      throw Error("LOST_ACK");
    });
    const first = await recordActualTrial(f.host, f.review, "accepted", "guard");
    expect(first.kind).toBe("unknown");
    const retained = f.persistence.externalWriteState(f.scope.projectId)!.draft;
    const other = { ...copy(f.current()), id: "film_other_actualtrial", title: "另一作品" };
    if (kind === "foreign") f.host.apply(other);
    const entered = deferred<void>(),
      released = deferred<void>(),
      originalHash = hashes.historyRecordHash;
    let held = false;
    vi.spyOn(hashes, "historyRecordHash").mockImplementation(async (value) => {
      if (value === retained && !held) {
        held = true;
        entered.resolve();
        await released.promise;
      }
      return originalHash(value);
    });
    const recovery = recoverActualTrial(f.host, first.pending!);
    await entered.promise;
    f.host.apply({ ...retained, title: "原稿微任务期间新编辑" });
    f.persistence.externalWriteState(f.scope.projectId);
    if (kind === "foreign") f.host.apply(other);
    released.resolve();
    expect((await recovery).kind).toBe("unknown");
    expect(f.persistence.externalWriteState(f.scope.projectId)!.draft.title).toBe(
      "原稿微任务期间新编辑",
    );
    expect(f.current()).toBe(
      kind === "foreign" ? other : f.persistence.externalWriteState(f.scope.projectId)!.draft,
    );
    expect(f.record).toHaveBeenCalledTimes(1);
  },
);
it("never clears pending when the final queue confirmation returns false", async () => {
  const f = await recordingFixture();
  f.record.mockImplementationOnce(async (input) => {
    f.write(input);
    throw Error("LOST_ACK");
  });
  const first = await recordActualTrial(f.host, f.review, "accepted", "");
  const acquire = f.persistence.acquireExternalRecovery;
  vi.spyOn(f.persistence, "acquireExternalRecovery").mockImplementation(async (id) => {
    const lease = await acquire(id);
    return { ...lease, confirmExternalWrite: () => false };
  });
  expect((await recoverActualTrial(f.host, first.pending!)).kind).toBe("unknown");
  expect((await f.persistence.flushAll()).status).toBe("unknown");
  expect(f.record).toHaveBeenCalledTimes(1);
});
it("retains a proved human fact but gives no verified continuation when main can no longer verify the source", async () => {
  const f = await recordingFixture();
  f.prepare.mockResolvedValueOnce({ kind: "FAILED", code: "SOURCE_UNVERIFIED", unchanged: true });
  const result = await recordActualTrial(f.host, f.review, "accepted", "原人工记录");
  expect(result.kind).toBe("recorded");
  expect(result.recorded?.verified).toBe(false);
  expect(result.message).toContain("试片需重新核对");
  expect(f.check).not.toHaveBeenCalled();
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("does not use INVALID_INPUT or transport as a no-write lifecycle proof", async () => {
  const f = await recordingFixture();
  f.record.mockRejectedValueOnce(Error("LOST_ACK"));
  const first = await recordActualTrial(f.host, f.review, "needs-changes", "");
  f.prepare.mockResolvedValueOnce({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true });
  expect((await recoverActualTrial(f.host, first.pending!)).kind).toBe("unknown");
  f.prepare.mockResolvedValueOnce({ kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true });
  expect((await recoverActualTrial(f.host, first.pending!)).kind).toBe("failed");
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("keeps a confirmed native record separate from a failed save of later edits during release", async () => {
  const f = await recordingFixture(),
    acquire = f.persistence.acquire;
  vi.spyOn(f.persistence, "acquire").mockImplementation(async (id) => {
    const lease = await acquire(id);
    return {
      ...lease,
      release: async () => {
        f.edit({ title: "之后未保存的新标题" });
        f.fail();
        await lease.release();
      },
    };
  });
  const result = await recordActualTrial(f.host, f.review, "accepted", "已保存人工事实");
  expect(result.kind).toBe("failed");
  expect(result.recorded?.value.note).toBe("已保存人工事实");
  expect(result.pending).toBeUndefined();
  expect(f.persistence.externalWriteState(f.scope.projectId)).toBeNull();
  expect(f.current().title).toBe("之后未保存的新标题");
  expect((await f.persistence.flushAll()).status).toBe("failed");
  expect(f.record).toHaveBeenCalledTimes(1);
});

it("binds only the selected trial's source/version identity, preserves metadata-only saves and independent target outputs", () => {
  const f = fixture(),
    before = f.current(),
    key = actualTrialInputKey(before, f.scope);
  for (const [field, value] of [
    ["videoPath", "/private/replaced.mp4"],
    ["cleanVideoPath", "/private/clean.mp4"],
    ["index", 8],
    ["prompt", "new version prompt"],
    ["createdAt", "2026-11-07T02:00:00Z"],
  ] as const) {
    const film = copy(before);
    Object.assign(film.shots[0]!.takes[0]!, { [field]: value });
    expect(actualTrialInputKey(film, f.scope)).not.toBe(key);
  }
  const independent = copy(before);
  independent.shots[1]!.takes = [
    {
      ...copy(before.shots[0]!.takes[0]!),
      id: "independent-output",
      shotId: independent.shots[1]!.id,
      videoPath: "/private/other-target.mp4",
    },
  ];
  independent.shots[1]!.selectedTakeId = "independent-output";
  expect(actualTrialInputKey(independent, f.scope)).toBe(key);
  expect(
    actualTrialInputKey(
      { ...before, savedAt: "later", directory: "/private/metadata-only" },
      f.scope,
    ),
  ).toBe(key);
});
