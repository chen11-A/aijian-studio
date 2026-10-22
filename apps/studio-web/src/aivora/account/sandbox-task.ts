/** Local stand-in for the media task desk. No network, budget reservation, or dispatch. */

export type SandboxTaskStatus =
  "idle" | "queued" | "running" | "cancelled" | "failed" | "unknown" | "candidate";

export type SandboxMediaTask = {
  id: string;
  status: SandboxTaskStatus;
  queries: number;
  note: string;
};

const idle = (note: string): SandboxMediaTask => ({ id: "", status: "idle", queries: 0, note });

export function sandboxSubmit(current: SandboxMediaTask | null, id: string): SandboxMediaTask {
  if (
    current &&
    (current.status === "queued" || current.status === "running" || current.status === "unknown")
  )
    return { ...current, note: "已有未结束的沙箱任务。没有重复提交，也没有派发。" };
  return {
    id,
    status: "queued",
    queries: 0,
    note: "沙箱已排队。没有访问上游，没有预留预算，没有产生费用。",
  };
}

export function sandboxQuery(current: SandboxMediaTask | null): SandboxMediaTask {
  if (!current || current.status === "idle") return idle("没有可查询的沙箱任务。");
  if (current.status === "unknown")
    return { ...current, note: "结果未知。沙箱不会自动重试，也不会把它当成成功或失败。" };
  if (current.status === "queued")
    return {
      ...current,
      status: "running",
      queries: current.queries + 1,
      note: "沙箱查询：任务仍在本地模拟运行。",
    };
  if (current.status === "running")
    return {
      ...current,
      status: "candidate",
      queries: current.queries + 1,
      note: "沙箱候选已返回。没有媒体文件，不能当作成片或素材。",
    };
  return { ...current, queries: current.queries + 1, note: current.note };
}

export function sandboxCancel(current: SandboxMediaTask | null): SandboxMediaTask {
  if (!current || current.status === "idle") return idle("没有可取消的沙箱任务。");
  if (current.status === "queued" || current.status === "running")
    return {
      ...current,
      status: "cancelled",
      note: "沙箱任务已取消。上游没有收到请求，所以这也不是远程停费。",
    };
  if (current.status === "unknown")
    return { ...current, note: "结果未知时不能在本地宣称已经取消上游任务。" };
  return { ...current, note: "这个状态不能再取消。" };
}

export function sandboxMarkFailed(current: SandboxMediaTask | null): SandboxMediaTask {
  if (!current || (current.status !== "queued" && current.status !== "running"))
    return current ?? idle("只有排队或运行中的沙箱任务可以标记失败。");
  return { ...current, status: "failed", note: "沙箱标记为失败。没有费用，也没有文件。" };
}

export function sandboxMarkUnknown(current: SandboxMediaTask | null): SandboxMediaTask {
  if (!current || current.status !== "running")
    return current ?? idle("只有运行中的沙箱任务可以标记为结果未知。");
  return {
    ...current,
    status: "unknown",
    note: "沙箱结果未知。请只查询，不要再次提交。",
  };
}

export function sandboxVoiceResult(input: {
  line: string;
  consent: boolean;
  action: "audition" | "generate";
}): string {
  if (!input.consent) return "需要先勾选声线使用同意。沙箱不会生成声音。";
  if (!input.line.trim()) return "请先填写对白。没有调用配音模型。";
  if (input.action === "audition") return "沙箱没有音频文件，不能试听，也没有计费。";
  return "沙箱未调用配音模型，未生成文件，未计费，也未做口型。";
}
