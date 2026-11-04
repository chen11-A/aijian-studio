import type { BatchProgress, TaskItem } from "@aijian/contracts/task-progress";
import type { TaskFeed } from "./taskFeed";

/** What one portrait slot on the character page shows (3J-U06). */
export type SlotState = "queued" | "running" | "failed" | "done";

export type PortraitFeed = {
  /** The latest portrait run of this film: running, or the last one that ended. */
  batch: BatchProgress | null;
  /** Keyed by `${characterId}:${view}`. Only slots this session has asked for are here. */
  slots: Record<string, { state: SlotState; reason: string }>;
};

/**
 * Portrait progress for one film, read from the task feed. GPT's makeAllPortraits
 * (pro/portrait-workflow.ts) opens a batch `portraits:<film id>:<run>` and gives every image
 * the task id `<batch id>:<character id>:<view>`; that is the only place this file looks.
 */
export function portraitFeed(feed: TaskFeed, filmId: string): PortraitFeed {
  const prefix = `portraits:${filmId}:`;
  const batches = feed.batches.filter((batch) => batch.batchId.startsWith(prefix));
  const batch = batches.filter((item) => item.running).at(-1) ?? batches.at(-1) ?? null;
  const slots: PortraitFeed["slots"] = {};
  for (const task of feed.tasks) {
    if (!task.id.startsWith(prefix)) continue;
    const parts = task.id.slice(prefix.length).split(":");
    if (parts.length < 3) continue;
    const view = parts.at(-1)!;
    const characterId = parts.slice(1, -1).join(":");
    slots[`${characterId}:${view}`] = { state: slotState(task), reason: task.reason ?? "" };
  }
  return { batch, slots };
}

function slotState(task: TaskItem): SlotState {
  if (task.status === "done") return "done";
  if (task.status === "failed") return "failed";
  if (task.status === "queued" || task.status === "requeued") return "queued";
  return "running";
}
