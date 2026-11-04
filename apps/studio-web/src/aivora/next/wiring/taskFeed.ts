import { useEffect, useState } from "react";
import type { BatchProgress, TaskItem } from "@aijian/contracts/task-progress";
import type { FilmProject } from "../../film/project";
import { subscribeTasks } from "../../film/task-progress";

/**
 * Wiring between the workspace and GPT's task progress (3J-B17). Components in next/ only take
 * props; this file is where the live list comes from.
 */
export type TaskFeed = { tasks: TaskItem[]; batches: BatchProgress[] };

const EMPTY: TaskFeed = { tasks: [], batches: [] };

/**
 * The live task list. The desktop app hands it over through window.aijian.onTask, which keeps
 * it when the page reloads; a plain browser reads the same list from film/task-progress.ts.
 * Both give the current list right away and then every change.
 */
export function useTaskFeed(): TaskFeed {
  const [feed, setFeed] = useState<TaskFeed>(EMPTY);
  useEffect(() => {
    const listen = window.aijian?.onTask ?? subscribeTasks;
    return listen((tasks, batches) => setFeed({ tasks, batches }));
  }, []);
  return feed;
}

/**
 * Names each job the way the task center shows it. A job on a shot of this film becomes
 * 「第 2 场第 6 个镜头」 (the job id stays as small text); other jobs keep their own title.
 */
export function namedTasks(tasks: readonly TaskItem[], film: FilmProject | null): TaskItem[] {
  return tasks.map((task) => {
    const shot = film?.shots.find((item) => item.id === task.shotId);
    const scene = film?.scenes.find((item) => item.id === shot?.sceneId);
    if (!shot || !scene) return task;
    return { ...task, title: `第 ${scene.no} 场第 ${shot.no} 个镜头` };
  });
}

/** For 后台生成 in the status bar: jobs still going, and the share of all jobs that ended. */
export function feedProgress(feed: TaskFeed): { active: number; percent: number } {
  const total = feed.tasks.length;
  const ended = feed.tasks.filter((task) => task.status === "done" || task.status === "failed");
  return {
    active: total - ended.length,
    percent: total === 0 ? 0 : Math.round((ended.length / total) * 100),
  };
}
