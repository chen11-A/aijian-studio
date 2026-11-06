import { describe, expect, it } from "vitest";
import { sampleFilm, interruptStaleWork } from "./project";
import {
  prepareVideoQueue,
  setVideoTaskState,
  videoTaskTarget,
  cancelVideoTask,
} from "./generation-queue";

function emptyFilm(): ReturnType<typeof sampleFilm> {
  const film = sampleFilm();
  return {
    ...film,
    jobs: [],
    shots: film.shots.slice(0, 2).map((shot) => ({ ...shot, takes: [], selectedTakeId: "" })),
  };
}

describe("persisted video queue", () => {
  it("resumes the same unsent versions across scenes without resending interrupted running work", () => {
    const film = emptyFilm();
    const prepared = prepareVideoQueue(film, film.shots, 2, false);
    const ids = prepared.film.shots.flatMap((shot) => shot.takes.map((take) => take.id));
    const running = setVideoTaskState(prepared.film, ids[0]!, "running");
    const disk = JSON.parse(JSON.stringify(interruptStaleWork(running).film));
    expect(disk.shots[0].takes[0].interruptedFrom).toBe("running");
    expect(disk.shots[0].takes[1].interruptedFrom).toBe("queued");
    const resumed = prepareVideoQueue(disk, disk.shots, 4, true);
    expect(resumed.groups.flatMap((group) => group.takes.map((take) => take.id))).toEqual(
      ids.slice(1),
    );
    expect(resumed.film.shots.flatMap((shot) => shot.takes.map((take) => take.id))).toEqual(ids);
    expect(resumed.film.shots[0]!.takes[0]!.status).toBe("failed");
    expect(new Set(resumed.film.jobs.map((job) => job.id)).size).toBe(resumed.film.jobs.length);
  });
  it("cancels by exact version or job id without cancelling adjacent versions", () => {
    const film = emptyFilm();
    const next = prepareVideoQueue(film, film.shots.slice(0, 1), 2, false).film;
    const take = next.shots[0]!.takes[1]!;
    expect(videoTaskTarget(next, `video:${take.id}`)?.take.id).toBe(take.id);
    const cancelled = cancelVideoTask(next, take.id);
    expect(cancelled.film.shots[0]!.takes.map((item) => item.status)).toEqual(["queued", "failed"]);
    expect(cancelled.film.jobs[1]!.status).toBe("cancelled");
    expect(
      prepareVideoQueue(cancelled.film, cancelled.film.shots, 1, true).groups[0]!.takes,
    ).toHaveLength(1);
    expect(videoTaskTarget(next, "unknown")).toBeNull();
  });
});

it("explicit retry keeps the failed version id and does not reset adjacent versions", async () => {
  const { retryVideoTasks, failRunningVideoTasks, generationTargets } =
    await import("./generation-queue");
  const film = emptyFilm();
  const queue = prepareVideoQueue(film, film.shots, 2, false);
  const chosen = queue.groups[0]!.takes[0]!;
  const failed = failRunningVideoTasks(
    setVideoTaskState(queue.film, chosen.id, "running"),
    queue.groups,
    "network",
  );
  const retried = retryVideoTasks(failed, [`video:${chosen.id}`]);
  expect(retried.shots[0]!.takes[0]!.id).toBe(chosen.id);
  expect(retried.shots[0]!.takes[0]!.status).toBe("queued");
  expect(retried.shots[1]).toEqual(failed.shots[1]);
  expect(generationTargets(retried, [retried.shots[0]!], true)).toEqual([retried.shots[0]]);
  expect(retried.shots.flatMap((shot) => shot.takes)).toHaveLength(4);
  const retry = prepareVideoQueue(retried, retried.shots, 4, true, [chosen.id]);
  expect(retry.groups.flatMap((group) => group.takes.map((take) => take.id))).toEqual([chosen.id]);
});

it("migrates a legacy job by unique persisted version number and rejects ambiguous matches", () => {
  const film = emptyFilm();
  const prepared = prepareVideoQueue(film, film.shots, 2, false).film;
  prepared.jobs = prepared.jobs.map((job) => ({
    ...job,
    id: `legacy-${job.shotId}-${job.take}`,
    takeId: undefined,
  }));
  const first = prepared.jobs[0]!;
  expect(videoTaskTarget(prepared, first.id)?.take.id).toBe(prepared.shots[0]!.takes[0]!.id);
  const recovered = interruptStaleWork(prepared).film;
  expect(
    cancelVideoTask(recovered, first.id).film.shots[0]!.takes[0]!.interruptedFrom,
  ).toBeUndefined();
  prepared.shots[0]!.takes[1]!.index = first.take;
  expect(videoTaskTarget(prepared, first.id)).toBeNull();
});
it("counts attempts separately from the B version index across explicit retry", () => {
  const film = emptyFilm();
  const prepared = prepareVideoQueue(film, film.shots, 2, false);
  const id = prepared.groups[0]!.takes[1]!.id;
  const first = setVideoTaskState(prepared.film, id, "running");
  expect(first.jobs.find((job) => job.takeId === id)).toMatchObject({ take: 2, attempt: 1 });
  const queued = setVideoTaskState(first, id, "queued");
  const rebuilt = prepareVideoQueue(queued, queued.shots, 2, true).film;
  expect(
    setVideoTaskState(rebuilt, id, "running").jobs.find((job) => job.takeId === id)?.attempt,
  ).toBe(2);
});

it("consumes each blocked record once and creates exactly its requested version", async () => {
  const { prepareBlockedVideoQueue } = await import("./generation-queue");
  const film = emptyFilm();
  film.jobs = [1, 2].map((take) => ({
    id: `blocked-${take}`,
    shotId: film.shots[0]!.id,
    kind: "video",
    take,
    status: "blocked",
    prompt: "",
    reason: "login required",
  }));
  const first = prepareBlockedVideoQueue(film, ["blocked-1"]);
  expect(first.film.shots[0]!.takes).toHaveLength(1);
  expect(first.film.jobs.some((job) => job.id === "blocked-1")).toBe(false);
  const second = prepareBlockedVideoQueue(first.film, ["blocked-2"]);
  expect(second.film.shots[0]!.takes).toHaveLength(2);
  expect(second.film.jobs.every((job) => job.status === "queued")).toBe(true);
  expect(prepareBlockedVideoQueue(second.film, ["blocked-1"]).groups).toEqual([]);
  const batch = prepareBlockedVideoQueue(film, ["blocked-1", "blocked-2"]);
  expect(batch.groups).toHaveLength(1);
  expect(batch.groups[0]!.takes).toHaveLength(2);
});

it("3JR-B08 fails only this batch's unsent versions after a scene prerequisite fails", async () => {
  const { failQueuedVideoPrerequisites, retryVideoTasks } = await import("./generation-queue");
  const film = emptyFilm();
  const first = prepareVideoQueue(film, film.shots.slice(0, 1), 3, false);
  const second = prepareVideoQueue(first.film, first.film.shots.slice(1), 1, false);
  const [queued, running, done] = first.groups[0]!.takes;
  const live = setVideoTaskState(second.film, running!.id, "running");
  live.shots[0]!.takes.find((take) => take.id === done!.id)!.status = "done";
  live.jobs.find((job) => job.takeId === done!.id)!.status = "done";
  const failed = failQueuedVideoPrerequisites(live, first.groups, "场景图还没出全，请补上。");
  expect(failed.shots[0]!.takes.map((take) => take.status)).toEqual(["failed", "running", "done"]);
  expect(failed.jobs.find((job) => job.takeId === queued!.id)).toMatchObject({
    status: "failed",
    interruptedFrom: "queued",
    reason: "场景图还没出全，请补上。",
  });
  expect(failed.shots[0]!.takes[0]).toMatchObject({ status: "failed", interruptedFrom: "queued" });
  expect(failed.shots[1]).toEqual(live.shots[1]);
  expect(failed.jobs.filter((job) => job.shotId === live.shots[1]!.id)).toEqual(
    live.jobs.filter((job) => job.shotId === live.shots[1]!.id),
  );
  const retry = retryVideoTasks(failed, [`video:${queued!.id}`]);
  expect(retry.shots[0]!.takes[0]).toMatchObject({ id: queued!.id, status: "queued" });
  expect(retry.shots[0]!.takes.slice(1)).toEqual(failed.shots[0]!.takes.slice(1));
});
