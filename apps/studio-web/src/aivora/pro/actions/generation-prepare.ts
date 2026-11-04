import type { FilmProject, FilmShot } from "../../film/project";
import {
  generationTargets,
  prepareBlockedVideoQueue,
  prepareVideoQueue,
  retryVideoTasks,
  videoTaskTarget,
} from "../../film/generation-queue";
import { planVideoJobs } from "../../film/operations";
import { VIDEO_DRAFT_MODEL } from "../capabilities";

/** Pure preflight, before billing/auth awaits. An empty model list means not discovered yet. */
export function generationPreflight(
  film: FilmProject,
  options: {
    targets?: FilmShot[];
    resume?: boolean;
    fallback?: FilmShot;
    modelIds: string[];
  },
) {
  const selected = generationTargets(
    film,
    options.targets,
    options.resume ?? false,
    options.fallback,
  );
  if (!selected.length) return { kind: "stopped" as const, selected, notice: "先在剧本里拆镜头。" };
  if (film.draft && options.modelIds.length && !options.modelIds.includes(VIDEO_DRAFT_MODEL))
    return {
      kind: "stopped" as const,
      selected,
      notice: `模型列表里没有 ${VIDEO_DRAFT_MODEL}，不能先出草稿。`,
    };
  return { kind: "ready" as const, selected };
}

/** Run after the caller rechecks request/project ownership following billing preparation. */
export function prepareGeneration(
  film: FilmProject,
  selected: FilmShot[],
  options: {
    versions: number;
    resume?: boolean;
    takeIds?: string[];
    blockedIds?: string[];
    canSubmit: boolean;
    blockedReason: string;
  },
) {
  if (!options.canSubmit) {
    if (options.resume || options.blockedIds)
      return { kind: "blocked" as const, film, apply: false, notice: options.blockedReason };
    const jobs = selected.flatMap((shot) =>
      planVideoJobs(shot, options.versions, false, options.blockedReason),
    );
    return {
      kind: "blocked" as const,
      film: {
        ...film,
        jobs: [
          ...film.jobs.filter((job) => !selected.some((shot) => shot.id === job.shotId)),
          ...jobs,
        ],
      },
      apply: true,
      notice: options.blockedReason,
    };
  }
  return {
    kind: "ready" as const,
    prepared: options.blockedIds
      ? prepareBlockedVideoQueue(film, options.blockedIds)
      : prepareVideoQueue(
          film,
          selected,
          options.versions,
          options.resume ?? false,
          options.takeIds,
        ),
  };
}

/** Blocked jobs take precedence exactly as in the workspace; explicit version IDs never select neighbors. */
export function prepareGenerationRetry(current: FilmProject, ids: string[]) {
  const blocked = current.jobs.filter(
    (job) => ids.includes(job.id) && job.kind === "video" && job.status === "blocked",
  );
  if (blocked.length)
    return {
      kind: "blocked" as const,
      targets: current.shots.filter((shot) => blocked.some((job) => job.shotId === shot.id)),
      blockedIds: blocked.map((job) => job.id),
    };
  const film = retryVideoTasks(current, ids);
  const targets = film.shots.filter((shot) =>
    shot.takes.some(
      (take) =>
        take.status === "queued" &&
        ids.some((id) => videoTaskTarget(film, id)?.take.id === take.id),
    ),
  );
  if (!targets.length) return { kind: "empty" as const };
  return {
    kind: "resume" as const,
    film,
    targets,
    takeIds: ids.flatMap((id) => {
      const take = videoTaskTarget(film, id)?.take;
      return take ? [take.id] : [];
    }),
  };
}
