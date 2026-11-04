import type { FilmProject, FilmShot, FilmTake } from "./project";

/** Only work known not to have been dispatched can resume without a provider lookup. */
export function canResumeTake(take: FilmTake): boolean {
  return (
    take.status === "queued" || (take.status === "failed" && take.interruptedFrom === "queued")
  );
}

export function resumeQueuedFilm(film: FilmProject): FilmProject {
  const next = {
    ...film,
    shots: film.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) =>
        canResumeTake(take)
          ? { ...take, status: "queued" as const, interruptedFrom: undefined, reason: "" }
          : take,
      ),
    })),
  };
  return {
    ...next,
    jobs: [
      ...film.jobs.filter(
        (job) =>
          !next.shots.some((shot) =>
            shot.takes.some(
              (take) =>
                take.status === "queued" &&
                (job.takeId === take.id ||
                  (!job.takeId && job.shotId === shot.id && job.take === take.index)),
            ),
          ),
      ),
      ...next.shots.flatMap((shot) =>
        shot.takes
          .filter((take) => take.status === "queued")
          .map((take) => ({
            id: `video:${take.id}`,
            shotId: shot.id,
            takeId: take.id,
            kind: "video" as const,
            take: take.index,
            status: "queued" as const,
            prompt: take.prompt,
            attempt:
              film.jobs.find(
                (job) =>
                  job.takeId === take.id ||
                  (!job.takeId && job.shotId === shot.id && job.take === take.index),
              )?.attempt ?? 0,
            reason: "",
          })),
      ),
    ],
  };
}

/** Accepts a job id or a version id. Never guesses a different version by list position. */
export function videoTaskTarget(film: FilmProject, id: string) {
  const job = film.jobs.find((item) => item.id === id && item.kind === "video");
  for (const shot of film.shots) {
    const legacy =
      job && !job.takeId && job.shotId === shot.id
        ? shot.takes.filter((take) => take.index === job.take)
        : [];
    const take =
      shot.takes.find((item) => item.id === id || item.id === job?.takeId) ??
      (legacy.length === 1 ? legacy[0] : undefined);
    if (take) {
      const linked = film.jobs.filter(
        (item) =>
          item.takeId === take.id ||
          (!item.takeId && item.shotId === shot.id && item.take === take.index),
      );
      return { shot, take, job: job ?? (linked.length === 1 ? linked[0] : undefined) };
    }
  }
  return null;
}

/** Returns the specific running target for the host's existing cancellation bridge. */
export function cancelVideoTask(film: FilmProject, id: string) {
  const target = videoTaskTarget(film, id);
  if (!target || (!canResumeTake(target.take) && target.take.status !== "running"))
    return { film, running: false, jobId: null };
  return {
    running: target.take.status === "running",
    jobId: target.job?.id ?? `video:${target.take.id}`,
    film: {
      ...film,
      shots: film.shots.map((shot) => ({
        ...shot,
        takes: shot.takes.map((take) =>
          take.id === target.take.id
            ? { ...take, status: "failed" as const, interruptedFrom: undefined, reason: "已取消" }
            : take,
        ),
      })),
      jobs: film.jobs.map((job) =>
        job.id === target.job?.id || job.takeId === target.take.id
          ? { ...job, status: "cancelled" as const, interruptedFrom: undefined }
          : job,
      ),
    },
  };
}

export function prepareVideoQueue(
  film: FilmProject,
  targets: FilmShot[],
  versions: number,
  resume: boolean,
  takeIds?: string[],
) {
  let next = resume ? resumeQueuedFilm(film) : film;
  const groups = targets.map((target) => {
    const shot = next.shots.find((item) => item.id === target.id) ?? target;
    const takes: FilmTake[] = resume
      ? shot.takes.filter(
          (take) => take.status === "queued" && (!takeIds || takeIds.includes(take.id)),
        )
      : Array.from({ length: Math.max(1, Math.min(versions, 4)) }, (_, index) => ({
          id: crypto.randomUUID(),
          shotId: shot.id,
          index: shot.takes.length + index + 1,
          status: "queued",
          stillUrl: "",
          videoPath: "",
          videoUrl: "",
          prompt: shot.picture,
          createdAt: new Date().toISOString(),
          reason: "",
        }));
    if (!resume)
      next = {
        ...next,
        shots: next.shots.map((item) =>
          item.id === shot.id
            ? {
                ...item,
                takes: [...item.takes, ...takes],
                selectedTakeId: item.selectedTakeId || takes[0]?.id || "",
              }
            : item,
        ),
        jobs: [
          ...next.jobs,
          ...takes.map((take) => ({
            id: `video:${take.id}`,
            shotId: shot.id,
            takeId: take.id,
            kind: "video" as const,
            take: take.index,
            status: "queued" as const,
            prompt: take.prompt,
            reason: "",
          })),
        ],
      };
    return { shot, takes, hadTakes: shot.takes.some((take) => take.status === "done") };
  });
  return { film: next, groups };
}

export function setVideoTaskState(film: FilmProject, takeId: string, status: "queued" | "running") {
  return {
    ...film,
    shots: film.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) =>
        take.id === takeId ? { ...take, status, interruptedFrom: undefined } : take,
      ),
    })),
    jobs: film.jobs.map((job) =>
      job.takeId === takeId
        ? {
            ...job,
            status,
            interruptedFrom: undefined,
            attempt: status === "running" ? (job.attempt ?? 0) + 1 : job.attempt,
          }
        : job,
    ),
  };
}

export function cancelQueuedVideoTasks(film: FilmProject) {
  let next = film;
  for (const shot of film.shots)
    for (const take of shot.takes)
      if (take.status === "queued") next = cancelVideoTask(next, take.id).film;
  return next;
}

export function failRunningVideoTasks(
  film: FilmProject,
  groups: { takes: FilmTake[] }[],
  reason: string,
) {
  const ids = new Set(groups.flatMap((group) => group.takes.map((take) => take.id)));
  return {
    ...film,
    shots: film.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) =>
        ids.has(take.id) && take.status === "running"
          ? { ...take, status: "failed" as const, reason }
          : take,
      ),
    })),
    jobs: film.jobs.map((job) =>
      job.takeId && ids.has(job.takeId) && job.status === "running"
        ? { ...job, status: "failed" as const, reason }
        : job,
    ),
  };
}

export function pruneCancelledJobs(film: FilmProject, cancelled: Set<string>) {
  for (const id of cancelled) {
    const job = film.jobs.find((item) => item.id === id);
    if (!job || (job.status !== "running" && job.status !== "queued")) cancelled.delete(id);
  }
}

export function videoQueueInterruption(film: FilmProject, stopped: boolean, paused: boolean) {
  if (!stopped && !paused) return null;
  return {
    film: stopped ? cancelQueuedVideoTasks(film) : film,
    notice: stopped
      ? { code: "GENERATION_CANCELLED", text: "已取消还没开始的镜头。" }
      : { code: "GENERATION_PAUSED", text: "已暂停。点继续再生成剩下的。" },
  };
}

export function generationTargets(
  film: FilmProject,
  targets: FilmShot[] | undefined,
  resume: boolean,
  fallback?: FilmShot,
) {
  return (
    resume
      ? (targets ?? film.shots).filter((shot) => shot.takes.some(canResumeTake))
      : (targets ?? [fallback ?? film.shots[0]])
  ).filter((shot): shot is FilmShot => Boolean(shot));
}

/** Explicit retry reuses only the chosen failed versions, never creates neighboring takes. */
export function retryVideoTasks(film: FilmProject, ids: string[]): FilmProject {
  const selected = new Set(ids.map((id) => videoTaskTarget(film, id)?.take.id).filter(Boolean));
  let next = film;
  for (const shot of film.shots)
    for (const take of shot.takes)
      if (selected.has(take.id) && take.status === "failed")
        next = setVideoTaskState(next, take.id, "queued");
  return next;
}

export function retryableVideoTask(film: FilmProject, id: string): boolean {
  const job = film.jobs.find((item) => item.id === id && item.kind === "video");
  if (!job) return false;
  const target = videoTaskTarget(film, id);
  return (
    job.status === "blocked" ||
    (job.status === "failed" && target?.take.status === "failed" && !canResumeTake(target.take))
  );
}
