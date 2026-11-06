import {
  applyPerformancePlans,
  performancePlanPrompt,
  type PerformanceState,
} from "../../film/performance-plan";
import { performanceLine } from "../../film/operations";
import {
  gazeHandoff,
  parseLooseJson,
  performanceFromModel,
  assignPerformance,
} from "../../film/phase2";
import type { FilmShot } from "../../film/project";
import type { AgentReply } from "../workflow";
export type PerformanceDraftHost = {
  request: (agent: "performance", context: string, instruction: string) => Promise<AgentReply>;
  current: () => boolean;
  connected: boolean;
};
export type PerformanceDraftResult =
  | { status: "stale" }
  | { status: "rejected"; notice: string }
  | {
      status: "ready";
      shot: FilmShot;
      line: string;
      notice: string;
      event: "performance" | "offline";
      performanceState?: PerformanceState;
    };
/** Manual one-shot performance suggestion, separate from the pipeline's scene-scoped executor. */
export async function planPerformanceDraft(
  current: FilmShot,
  host: PerformanceDraftHost,
): Promise<PerformanceDraftResult> {
  const gaze = gazeHandoff(current.characters);
  let line = `${performanceLine(current.picture)}${gaze ? ` ${gaze}` : ""}`;
  let note = "没登录，先用软件自己的规则写了表演，请看一下。点「放进分镜」放到这一镜。";
  const context = `镜头 id：${current.id}；人物：${current.characters.join("、")}\n${current.picture}`;
  const instruction =
    "写这一镜的表演，shot_id 使用给出的 id，who 写人物名字，其他人物放 others 并写 name。";
  const reply = await host.request("performance", context, instruction);
  if (!host.current()) return { status: "stale" };
  let raw = reply.text ? parseLooseJson(reply.text) : null;
  const parseDraft = (value: unknown) =>
    performanceFromModel(value, current.characters) ||
    assignPerformance(value, [current], current.characters)[0]?.performance ||
    null;
  let parsed = raw ? parseDraft(raw) : null;
  if (!parsed && host.connected) {
    const again = await host.request(
      "performance",
      context,
      `${instruction}只输出 JSON，不要解释。`,
    );
    if (!host.current()) return { status: "stale" };
    raw = again.text ? parseLooseJson(again.text) : null;
    parsed = raw ? parseDraft(raw) : null;
    if (!parsed) {
      return {
        status: "rejected",
        notice: `${again.detail || reply.detail || "表演建议这次用不了。"} 这次没有修改镜头。`,
      };
    }
  }
  const planned = raw ? applyPerformancePlans([current], raw, { draft: true }) : null;
  const performanceState = planned?.state;
  const scoped = raw && !performanceState?.unassigned.length ? raw : null;
  const voiceNote = scoped
    ? assignPerformance(scoped, [current], current.characters)[0]
    : undefined;
  const direction = voiceNote?.delivery ?? "";
  if (voiceNote?.voiceRisk && performanceState) {
    performanceState.voiceReviews = [{ shotId: current.id, reason: voiceNote.voiceRisk }];
  }
  if (parsed && !performanceState?.unassigned.length) {
    line =
      (planned?.shots[0]?.performancePlan?.people.length
        ? performancePlanPrompt({ ...planned.shots[0]!, userFields: [] })
        : "") || parsed;
    note = "表演指导写好了。点「放进分镜」放到这一镜。";
  }
  if (performanceState?.unassigned.length) {
    line = current.performance;
    note = "有表演尚未对应到镜头或人物，请核对后再写入。";
  }
  if (voiceNote?.voiceRisk) note = "配音语气还需核对，已保留原语气。";
  // An explicit manual request creates a replacement draft; the host protects saved field locks.
  const rejectedPlan = Boolean(performanceState?.unassigned.length);
  const performanceShot = {
    ...current,
    performancePlan: planned?.shots[0]?.performancePlan ?? current.performancePlan,
    performance: line,
    performanceSource: rejectedPlan ? current.performanceSource : "agent:performance",
    delivery: current.userFields.includes("delivery")
      ? current.delivery
      : direction || current.delivery,
    source: rejectedPlan ? current.source : "agent:performance",
    userFields: current.userFields.filter((field) => field !== "performance"),
  };
  return {
    status: "ready",
    shot: performanceShot,
    line,
    notice: note,
    event: parsed ? "performance" : "offline",
    ...(performanceState ? { performanceState } : {}),
  };
}
