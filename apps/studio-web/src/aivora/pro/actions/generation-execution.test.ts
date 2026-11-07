import { beforeEach, expect, it, vi } from "vitest";
import type {
  FilmGenerationExecutionInput,
  FilmGenerationExecutionResult,
} from "@aijian/contracts/film-generation-execution";
import { sampleFilm } from "../../film/project";
import {
  prepareVideoQueue,
  prepareBlockedVideoQueue,
  resumeQueuedFilm,
} from "../../film/generation-queue";
import { generationExecutionTargets } from "./generation-prepare";
import {
  createGenerationExecutionSession,
  prepareCurrentGenerationExecution,
  validGenerationExecution,
} from "./generation-execution";
import { historyRecordHash } from "./persistent-history";
const input: FilmGenerationExecutionInput = {
  projectId: "film-local",
  expectedProjectHash: "a".repeat(64),
  mode: "video",
  targets: [
    { shotId: "shot1", versions: 2 },
    { shotId: "shot2", versions: 1 },
  ],
};
function prepared(): Extract<FilmGenerationExecutionResult, { kind: "PREPARED" }> {
  return {
    kind: "PREPARED",
    executionId: "execution-1",
    projectId: input.projectId,
    projectHash: input.expectedProjectHash,
    targets: [
      { shotId: "shot1", videoSlotIds: ["video1", "video2"] },
      { shotId: "shot2", videoSlotIds: ["video3"] },
    ],
    stages: [
      { stageId: "place", kind: "location-reference", targetId: "location1" },
      { stageId: "front", kind: "portrait", targetId: "person1", view: "正面" },
      { stageId: "side", kind: "portrait", targetId: "person1", view: "侧面" },
      { stageId: "frame", kind: "shot-frame", targetId: "shot1" },
    ],
  };
}
function env() {
  const prepare = vi.fn(async (): Promise<FilmGenerationExecutionResult> => prepared()),
    retire = vi.fn(async () => ({ kind: "RETIRED" as const }));
  return {
    prepare,
    retire,
    session: createGenerationExecutionSession(
      { prepareFilmGenerationExecution: prepare, retireFilmGenerationExecution: retire },
      () => true,
    ),
  };
}
beforeEach(() => vi.restoreAllMocks());
it("does nothing before explicit prepare and missing capabilities cannot fall back", async () => {
  const f = env();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(() => f.session.image("shot-frame", "shot1")).toThrow("UNAVAILABLE");
  const unavailable = createGenerationExecutionSession({}, () => true);
  await expect(unavailable.prepare(input)).rejects.toThrow("UNAVAILABLE");
  expect(f.prepare).not.toHaveBeenCalled();
});
it("uses only exact issued stage and slot locators without rewriting model body or adding dependencies", async () => {
  const f = env();
  await f.session.prepare(input);
  expect(f.prepare).toHaveBeenCalledExactlyOnceWith(input);
  expect(f.session.image("portrait", "person1", "正面")).toEqual({
    executionId: "execution-1",
    stageId: "front",
  });
  expect(f.session.image("portrait", "person1", "侧面")).toEqual({
    executionId: "execution-1",
    stageId: "side",
  });
  expect(f.session.image("location-reference", "location1")).toEqual({
    executionId: "execution-1",
    stageId: "place",
  });
  expect(f.session.video("shot1", 1, "queued-take")).toEqual({
    executionId: "execution-1",
    videoSlotId: "video2",
    shotId: "shot1",
    takeId: "queued-take",
  });
  expect(() => f.session.image("portrait", "person1", "背面")).toThrow("STAGE_UNAVAILABLE");
  expect(() => f.session.video("shot1", 2, "extra-take")).toThrow("SLOT_UNAVAILABLE");
  expect(f.retire).not.toHaveBeenCalled();
});
it("retires one issued slot synchronously without stopping its siblings, then retires the whole session once", async () => {
  const f = env();
  await f.session.prepare(input);
  f.session.retireSlot("shot1", 0);
  expect(f.retire).toHaveBeenCalledExactlyOnceWith({
    executionId: "execution-1",
    videoSlotId: "video1",
  });
  expect(() => f.session.video("shot1", 0, "take1")).toThrow("SLOT_UNAVAILABLE");
  expect(f.session.video("shot1", 1, "take2").videoSlotId).toBe("video2");
  f.session.retireSlot("shot1", 0);
  expect(f.retire).toHaveBeenCalledTimes(1);
  f.session.retire();
  f.session.retire();
  expect(f.retire).toHaveBeenLastCalledWith({ executionId: "execution-1" });
  expect(f.retire).toHaveBeenCalledTimes(2);
  expect(() => f.session.image("shot-frame", "shot1")).toThrow("STALE");
});
it("accounts for a valid late native prepare by retiring it before discarding the capture", async () => {
  let resolve!: (v: FilmGenerationExecutionResult) => void;
  const f = env();
  f.prepare.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let valid = true;
  const pending = f.session.prepare(input, () => valid);
  valid = false;
  resolve(prepared());
  await expect(pending).rejects.toThrow("STALE");
  expect(f.retire).toHaveBeenCalledExactlyOnceWith({ executionId: "execution-1" });
  expect(() => f.session.video("shot1", 0, "take")).toThrow("STALE");
});
it("does not prepare twice while pending or after an unknown transport outcome", async () => {
  let resolve!: (v: FilmGenerationExecutionResult) => void;
  const f = env();
  f.prepare.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = f.session.prepare(input);
  await expect(f.session.prepare(input)).rejects.toThrow("ALREADY_PREPARED");
  resolve(prepared());
  await pending;
  expect(f.prepare).toHaveBeenCalledTimes(1);
  const broken = env();
  broken.prepare.mockRejectedValue(Error("PRIVATE"));
  await expect(broken.session.prepare(input)).rejects.toThrow("UNCONFIRMED");
  await expect(broken.session.prepare(input)).rejects.toThrow("ALREADY_PREPARED");
  expect(broken.prepare).toHaveBeenCalledTimes(1);
  expect(() => broken.session.image("shot-frame", "shot1")).toThrow("UNAVAILABLE");
});
it("rejects incomplete, foreign, ambiguous or extra-field prepared replies as whole tables", () => {
  for (const change of [
    (p: ReturnType<typeof prepared>) => p.targets[0]!.videoSlotIds.pop(),
    (p: ReturnType<typeof prepared>) => p.targets.reverse(),
    (p: ReturnType<typeof prepared>) => p.targets[1]!.videoSlotIds.splice(0, 1, "video1"),
    (p: ReturnType<typeof prepared>) => p.stages.push({ ...p.stages[0]!, stageId: "another" }),
    (p: ReturnType<typeof prepared>) => (p.projectHash = "b".repeat(64)),
    (p: ReturnType<typeof prepared>) => Object.assign(p, { PRIVATE: "extra" }),
  ]) {
    const p = prepared();
    change(p);
    expect(validGenerationExecution(p, input)).toBe(false);
  }
});
it("uses a fresh complete raw CAS after saved metadata drift, but rejects creative drift without adoption", async () => {
  const film = sampleFilm();
  let live = film;
  const f = env(),
    raw = { ...film, savedAt: "later", directory: "native-private" };
  f.prepare.mockImplementation(async (request) => ({
    ...prepared(),
    projectId: request.projectId,
    projectHash: request.expectedProjectHash,
  }));
  await prepareCurrentGenerationExecution(
    f.session,
    film,
    { mode: "video", targets: input.targets },
    { current: () => live, valid: () => true, read: async () => raw },
  );
  expect(f.prepare.mock.calls[0]![0].expectedProjectHash).toBe(await historyRecordHash(raw));
  expect(live).toBe(film);
  const other = env();
  await expect(
    prepareCurrentGenerationExecution(
      other.session,
      film,
      { mode: "video", targets: input.targets },
      {
        current: () => live,
        valid: () => true,
        read: async () => ({ ...raw, styleZh: "changed" }),
      },
    ),
  ).rejects.toThrow("STALE");
  expect(other.prepare).not.toHaveBeenCalled();
  live = { ...film };
});
it("computes versions from the original queue's fresh/resume/blocked subsets without allocating or changing input", () => {
  const film = sampleFilm(),
    selected = film.shots.slice(0, 2);
  const before = structuredClone(film);
  expect(generationExecutionTargets(film, selected, { versions: 3 })).toEqual(
    prepareVideoQueue(film, selected, 3, false).groups.map((g) => ({
      shotId: g.shot.id,
      versions: g.takes.length,
    })),
  );
  expect(film).toEqual(before);
  const queue = prepareVideoQueue(film, selected, 3, false).film;
  queue.shots[0]!.takes[1]!.status = "failed";
  queue.shots[0]!.takes[1]!.interruptedFrom = "queued";
  const ids = [queue.shots[0]!.takes[1]!.id, queue.shots[1]!.takes[0]!.id];
  const scope = generationExecutionTargets(queue, selected, {
    versions: 3,
    resume: true,
    takeIds: ids,
  });
  expect(scope).toEqual(
    prepareVideoQueue(resumeQueuedFilm(queue), selected, 3, true, ids).groups.map((g) => ({
      shotId: g.shot.id,
      versions: g.takes.length,
    })),
  );
  const jobs = queue.jobs.slice(0, 2).map((j) => ({ ...j, status: "blocked" as const }));
  const blocked = { ...film, jobs };
  expect(
    generationExecutionTargets(blocked, [selected[0]!], {
      versions: 3,
      blockedIds: jobs.map((j) => j.id),
    }),
  ).toEqual(
    prepareBlockedVideoQueue(
      blocked,
      jobs.map((j) => j.id),
    ).groups.map((g) => ({ shotId: g.shot.id, versions: g.takes.length })),
  );
});
