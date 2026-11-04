/** Public task progress snapshot. Execution remains owned by the existing film workflow. */
export type TaskItem = {
  id: string;
  shotId?: string;
  title?: string;
  version?: string;
  kind: "video" | "image" | "voice" | "lipsync" | "export";
  status: "queued" | "running" | "uncertain" | "requeued" | "failed" | "done";
  attempt: number;
  reason?: string;
  suggestion?: string;
  waitedSeconds?: number;
};

export type BatchProgress = {
  batchId: string;
  label: string;
  done: number;
  total: number;
  failed: number;
  running: boolean;
};

export type TaskSnapshot = { tasks: TaskItem[]; batches: BatchProgress[] };
export type TaskListener = (tasks: TaskItem[], batches: BatchProgress[]) => void;
