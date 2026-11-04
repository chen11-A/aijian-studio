import type { TaskCenterProps, TaskItem, TaskStatus } from "../TaskCenter";
import { INTERRUPTED_TAKE, isCancelled, shotName } from "./names";
import {
  readProject,
  type ProjectJob,
  type ProjectShot,
  type ProjectTake,
  type ProjectView,
} from "./read";
import type { Adapted } from "./result";

export type TaskCenterData = Pick<
  TaskCenterProps,
  "title" | "tasks" | "recovery" | "paused" | "error"
>;

export type TaskCenterOptions = {
  /**
   * The project was just read from disk, before the app touched it. A take still marked running
   * belongs to a session that ended, so nobody knows how it finished.
   */
  fromDisk?: boolean;
  /**
   * The host can ask Grok what happened to an interrupted take. Only then do interrupted takes
   * show as 不确定 with the 「查一下，再接着做」 banner; otherwise they are listed as failed.
   */
  canLookUp?: boolean;
  /** Whether the queue is paused right now. project.json does not keep this. */
  paused?: boolean;
  /** The time now in milliseconds, for 「已经等了 N 秒」 on running takes. */
  now?: number;
};

/** The reason the app gives a job it marks interrupted. */
const INTERRUPTED_JOB = "已中断";

const WHY_UNKNOWN = "软件关掉时还在生成，不知道有没有做完。";

function waited(take: ProjectTake, now: number | undefined): number | undefined {
  const since = Date.parse(take.createdAt);
  if (now === undefined || Number.isNaN(since)) return undefined;
  return Math.max(0, Math.round((now - since) / 1000));
}

function takeItem(
  project: ProjectView,
  shot: ProjectShot,
  take: ProjectTake,
  position: number,
  options: TaskCenterOptions,
): { item: TaskItem; interrupted: boolean } {
  const interrupted =
    (take.status === "failed" && take.reason === INTERRUPTED_TAKE) ||
    (Boolean(options.fromDisk) && take.status === "running");
  let status: TaskStatus = take.status;
  let reason: string | undefined = take.reason || undefined;
  if (interrupted) {
    status = options.canLookUp ? "uncertain" : "failed";
    reason = options.canLookUp ? undefined : reason || WHY_UNKNOWN;
  } else if (take.status === "done") {
    reason = undefined;
  }
  const version = take.index ?? position;
  const seconds = status === "running" ? waited(take, options.now) : undefined;
  return {
    interrupted,
    item: {
      id: take.id,
      shotId: shot.id,
      title: shotName(project, shot),
      version: `第 ${version} 版`,
      kind: "video",
      status,
      attempt: version,
      ...(reason ? { reason } : {}),
      ...(seconds === undefined ? {} : { waitedSeconds: seconds }),
    },
  };
}

/**
 * A job becomes a row only when no take stands for it: video jobs that were blocked before any
 * take was made, and picture jobs, which have no takes.
 */
function jobItem(
  project: ProjectView,
  job: ProjectJob,
  options: TaskCenterOptions,
): { item: TaskItem; interrupted: boolean } | null {
  if (job.status === "cancelled") return null;
  if (job.kind === "video" && job.status !== "blocked") return null;
  const shot = project.shots.find((item) => item.id === job.shotId);
  const interrupted =
    (job.status === "failed" && job.reason === INTERRUPTED_JOB) ||
    (Boolean(options.fromDisk) && job.status === "running");
  let status: TaskStatus = job.status;
  let reason: string | undefined = job.reason || undefined;
  if (interrupted) {
    status = options.canLookUp ? "uncertain" : "failed";
    reason = options.canLookUp ? undefined : reason || WHY_UNKNOWN;
  } else if (job.status === "done") {
    reason = undefined;
  }
  return {
    interrupted,
    item: {
      id: job.id,
      ...(shot ? { shotId: shot.id, title: shotName(project, shot) } : { title: job.id }),
      ...(job.take !== null ? { version: `版本 ${job.take}` } : {}),
      kind: job.kind === "video" ? "video" : "image",
      status,
      attempt: job.take ?? 1,
      ...(reason ? { reason } : {}),
    },
  };
}

/**
 * Task center rows from project.json. Every video take is a row, in shot order: the take keeps
 * its own status and failure message, while the jobs list only holds the last batch per shot and
 * keeps the reason it was queued with. Cancelled takes and jobs are left out. Stills, cast
 * portraits and voice lines are not recorded in project.json, so they do not appear.
 */
export function taskCenterData(
  value: unknown,
  options: TaskCenterOptions = {},
): Adapted<TaskCenterData> {
  const read = readProject(value);
  if (!read.ok) {
    return { ok: true, props: { title: "这一集", tasks: [], error: read.reason }, missing: [] };
  }
  const project = read.project;
  const rows = [
    ...project.shots.flatMap((shot) =>
      shot.takes.flatMap((take, index) =>
        isCancelled(take) ? [] : [takeItem(project, shot, take, index + 1, options)],
      ),
    ),
    ...project.jobs.flatMap((job) => jobItem(project, job, options) ?? []),
  ];
  const interrupted = rows.some((row) => row.interrupted);
  const title =
    [project.seriesTitle || project.title, project.episodeTitle].filter(Boolean).join(" · ") ||
    "这一集";
  return {
    ok: true,
    props: {
      title,
      tasks: rows.map((row) => row.item),
      recovery: options.canLookUp && interrupted ? { phase: "needs-check" } : null,
      paused: Boolean(options.paused),
    },
    missing: project.missing,
  };
}
