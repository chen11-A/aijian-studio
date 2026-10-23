import type { TaskQueueResponse } from "../api/studio";

export type TaskQueueItem = TaskQueueResponse["data"]["tasks"][number];
export type QueueFilter = "all" | "active" | "attention" | "completed";
export type QueueState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; response: TaskQueueResponse }
  | { kind: "error" };

export const nodeLabels: Record<string, string> = {
  "timeline.assemble.fake": "Fake 分镜时间线",
  "story.extract": "故事提取",
  "script.generate": "剧本生成",
  "storyboard.plan": "分镜规划",
  "asset.generate": "素材生成",
  "edit.assemble": "剪辑合成",
  "export.master": "母版导出",
  story_film: "一句话成片",
  "local.story_film.v1": "一句话成片",
};

export const attemptLabels: Record<string, string> = {
  FAILED: "没有完成",
  SUCCEEDED: "已完成",
  CANCELLED: "已取消",
  REMOTE_UNKNOWN: "结果未知",
  NOT_SUBMITTED: "没有提交",
  READY: "等待开始",
  LEASED: "已接手",
  RUNNING: "进行中",
  WAITING_REMOTE: "等待结果",
};

export function shortHash(value: string): string {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

export function formatTime(value: string | null): string {
  if (!value) return "尚无检查点";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function toneFor(item: TaskQueueItem): "working" | "attention" | "done" | "quiet" {
  const label = item.presentation?.status_label;
  if (label === "已被后来的成片取代" || label === "上一次没有做完，已经结束") return "quiet";
  if (
    item.node.status === "RECONCILIATION_REQUIRED" ||
    ["REMOTE_UNKNOWN", "FAILED", "NOT_SUBMITTED"].includes(item.attempt.status)
  ) {
    return "attention";
  }
  if (item.attempt.status === "SUCCEEDED") return "done";
  if (["READY", "LEASED", "RUNNING", "WAITING_REMOTE"].includes(item.attempt.status)) {
    return "working";
  }
  return "quiet";
}

export function matchesFilter(item: TaskQueueItem, filter: QueueFilter): boolean {
  const tone = toneFor(item);
  if (filter === "active") return tone === "working";
  if (filter === "attention") return tone === "attention";
  if (filter === "completed") return tone === "done";
  return true;
}
