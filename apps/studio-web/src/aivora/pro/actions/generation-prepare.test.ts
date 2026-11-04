import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { prepareVideoQueue } from "../../film/generation-queue";
import { planVideoJobs } from "../../film/operations";
import { VIDEO_DRAFT_MODEL } from "../capabilities";
import {
  generationPreflight,
  prepareGeneration,
  prepareGenerationRetry,
} from "./generation-prepare";
function withStatus(film: ReturnType<typeof sampleFilm>, id: string, status: "failed" | "done") {
  return {
    ...film,
    shots: film.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) => (take.id === id ? { ...take, status } : take)),
    })),
    jobs: film.jobs.map((job) => (job.takeId === id ? { ...job, status } : job)),
  };
}
function fixture() {
  const film = sampleFilm();
  return {
    ...film,
    jobs: [],
    shots: film.shots.slice(0, 2).map((shot) => ({ ...shot, takes: [], selectedTakeId: "" })),
  };
}
it("distinguishes unknown model discovery from a discovered unsupported draft model", () => {
  const film = { ...fixture(), draft: true };
  expect(generationPreflight(film, { modelIds: [] }).kind).toBe("ready");
  expect(generationPreflight(film, { modelIds: [VIDEO_DRAFT_MODEL] }).kind).toBe("ready");
  expect(generationPreflight(film, { modelIds: ["other"] })).toMatchObject({
    kind: "stopped",
    notice: expect.stringContaining(VIDEO_DRAFT_MODEL),
  });
  expect(generationPreflight({ ...film, draft: false }, { modelIds: ["other"] }).kind).toBe(
    "ready",
  );
  expect(generationPreflight({ ...film, shots: [] }, { modelIds: [] })).toMatchObject({
    kind: "stopped",
    notice: "先在剧本里拆镜头。",
  });
});
it("records blocked attempts only for selected shots and leaves resume/blocked retry unchanged", () => {
  const film = fixture();
  const jobs = film.shots.flatMap((shot) => planVideoJobs(shot, 2, false, "old"));
  const original = { ...film, jobs };
  const options = { versions: 1, canSubmit: false, blockedReason: "login" };
  const result = prepareGeneration(original, [film.shots[0]!], options);
  expect(result.kind).toBe("blocked");
  if (result.kind !== "blocked") throw new Error("blocked expected");
  expect(result.apply).toBe(true);
  expect(result.film.jobs.filter((job) => job.shotId === film.shots[1]!.id)).toEqual(jobs.slice(2));
  expect(result.film.jobs.filter((job) => job.shotId === film.shots[0]!.id)).toHaveLength(1);
  expect(result.film.jobs.at(-1)?.reason).toBe("login");
  for (const extra of [{ resume: true }, { blockedIds: [jobs[0]!.id] }]) {
    expect(prepareGeneration(original, film.shots, { ...options, ...extra })).toMatchObject({
      kind: "blocked",
      apply: false,
      film: original,
    });
  }
});
it("prioritizes blocked IDs and creates exactly their requested versions independent of defaults", () => {
  let film = prepareVideoQueue(fixture(), fixture().shots, 1, false).film;
  const take = film.shots[0]!.takes[0]!;
  film = withStatus(film, take.id, "failed");
  const blocked = planVideoJobs(film.shots[1]!, 2, false, "login");
  film = { ...film, jobs: [...film.jobs, ...blocked] };
  const retry = prepareGenerationRetry(film, [`video:${take.id}`, blocked[1]!.id]);
  expect(retry.kind).toBe("blocked");
  if (retry.kind !== "blocked") throw new Error("blocked expected");
  expect(retry.blockedIds).toEqual([blocked[1]!.id]);
  const queued = prepareGeneration(film, retry.targets, {
    blockedIds: retry.blockedIds,
    versions: 4,
    canSubmit: true,
    blockedReason: "",
  });
  if (queued.kind !== "ready") throw new Error("ready expected");
  expect(queued.prepared.groups.flatMap((group) => group.takes)).toHaveLength(1);
  expect(queued.prepared.film.shots[0]!.takes[0]?.status).toBe("failed");
  expect(queued.prepared.film.jobs.some((job) => job.id === blocked[0]!.id)).toBe(true);
});
it("retries an exact failed version without reusing done versions or sending queued neighbors", () => {
  const base = fixture();
  let film = prepareVideoQueue(base, base.shots, 2, false).film;
  const [failed, done] = film.shots[0]!.takes;
  film = withStatus(film, failed!.id, "failed");
  film = withStatus(film, done!.id, "done");
  const retry = prepareGenerationRetry(film, [`video:${failed!.id}`, done!.id, "missing"]);
  if (retry.kind !== "resume") throw new Error("resume expected");
  const result = prepareGeneration(retry.film, retry.targets, {
    versions: 4,
    resume: true,
    takeIds: retry.takeIds,
    canSubmit: true,
    blockedReason: "",
  });
  if (result.kind !== "ready") throw new Error("ready expected");
  expect(result.prepared.groups.flatMap((group) => group.takes.map((take) => take.id))).toEqual([
    failed!.id,
  ]);
  expect(result.prepared.film.shots.flatMap((shot) => shot.takes)).toHaveLength(4);
  expect(result.prepared.film.shots[0]!.takes[1]?.status).toBe("done");
  expect(prepareGenerationRetry(film, [done!.id, "missing"]).kind).toBe("empty");
});
