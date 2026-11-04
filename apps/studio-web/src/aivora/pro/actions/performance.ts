import { performanceLine } from "../../film/operations";
import {
  gazeHandoff,
  parseLooseJson,
  performanceFromModel,
  voiceDirectionFromModel,
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
    };
/** Manual one-shot performance suggestion, separate from the pipeline's scene-scoped executor. */
export async function planPerformanceDraft(
  current: FilmShot,
  host: PerformanceDraftHost,
): Promise<PerformanceDraftResult> {
  const gaze = gazeHandoff(current.characters);
  let line = `${performanceLine(current.picture)}${gaze ? ` ${gaze}` : ""}`;
  let note = "没有登录，已用离线表演指导。点「写入分镜」写到这一镜。";
  const reply = await host.request("performance", current.picture, "写这一镜的表演");
  if (!host.current()) return { status: "stale" };
  let raw = reply.text ? parseLooseJson(reply.text) : null;
  let parsed = raw ? performanceFromModel(raw, current.characters) : null;
  if (!parsed && host.connected) {
    const again = await host.request(
      "performance",
      current.picture,
      "写这一镜的表演。只输出 JSON，不要解释。",
    );
    if (!host.current()) return { status: "stale" };
    raw = again.text ? parseLooseJson(again.text) : null;
    parsed = raw ? performanceFromModel(raw, current.characters) : null;
    if (!parsed) {
      return {
        status: "rejected",
        notice: `${again.detail || reply.detail || "模型没有按格式返回。"} 没有写入。`,
      };
    }
  }
  const direction = raw ? voiceDirectionFromModel(raw) : "";
  if (parsed) {
    line = parsed;
    note = "表演指导写好了。点「写入分镜」写到这一镜。";
  }
  const performanceShot = {
    ...current,
    performance: line,
    performanceSource: "agent:performance",
    delivery: direction || current.delivery,
    source: "agent:performance",
    userFields: current.userFields.filter((field) => field !== "performance"),
  };
  return {
    status: "ready",
    shot: performanceShot,
    line,
    notice: note,
    event: parsed ? "performance" : "offline",
  };
}
