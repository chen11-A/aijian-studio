import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { textModel } from "../film/project";
import type { AgentId } from "../film/phase2";
import { completeAgentBatched } from "../film/request-batches";
import {
  captureEnabled,
  captureEpoch,
  captureScope,
  sameCaptureScope,
  sameCaptureInput,
  recordAgentReply,
  type CaptureFilm,
} from "./agent-capture";
import type { AgentReply, AgentRequestControl } from "./workflow";

export async function completeMembershipAgent(
  agent: AgentId,
  context: string,
  instruction: string,
  host: {
    bridge: GrokLoginBridge;
    modelIds: string[];
    billingProject: () => Promise<string>;
    current: () => boolean;
    modelsChanged: (ids: string[]) => void;
    control?: AgentRequestControl;
    captureFilm?: () => CaptureFilm | null;
  },
): Promise<AgentReply> {
  const stale = (): AgentReply => ({
    text: null,
    detail: "输入已变化，本次请求已停止。",
    code:
      host.control && Date.now() >= host.control.deadlineAt
        ? "TEXT_TIMEOUT"
        : host.control?.signal.aborted
          ? "TEXT_CANCELLED"
          : "REQUEST_STALE",
  });
  const current = () =>
    host.current() &&
    !host.control?.signal.aborted &&
    (!host.control || Date.now() < host.control.deadlineAt);
  if (!current()) return stale();
  const requestEpoch = captureEpoch();
  const input =
    (agent === "director" || agent === "action") && captureEnabled() ? host.captureFilm?.() : null;
  const capturedScope = input ? await captureScope(input) : null;
  if (!current()) return stale();
  const membership = await host.bridge.status();
  if (!current()) return stale();
  if (
    membership.provider !== "GROK_LOGIN" ||
    membership.runtime !== "DESKTOP" ||
    membership.state !== "CONNECTED"
  )
    return { text: null, detail: "需要 Grok 会员登录。", code: "GROK_MEMBERSHIP_REQUIRED" };
  const projectId = await host.billingProject();
  if (!current()) return stale();
  if (!projectId)
    return { text: null, detail: "这一次没有记到作品上。", code: "BILLING_PROJECT_REQUIRED" };
  let model = textModel(host.modelIds);
  if (!model) {
    try {
      const listed = await host.bridge.models();
      if (!current()) return stale();
      if (listed.kind === "OK") {
        const ids = listed.models.map((item) => item.id);
        host.modelsChanged(ids);
        model = textModel(ids);
      }
    } catch {
      return { text: null, detail: "模型列表没有读到。", code: "MODEL_UNAVAILABLE" };
    }
  }
  if (!model)
    return { text: null, detail: "模型列表里没有能写字的模型。", code: "MODEL_UNAVAILABLE" };
  const reply = await completeAgentBatched(agent, context, instruction, async (text) => {
    if (!current()) return stale();
    const idempotencyKey = crypto.randomUUID();
    const cancel = () => {
      try {
        void host.bridge.cancelText?.(idempotencyKey).catch(() => undefined);
      } catch {
        /* A detached bridge must not prevent the caller from cancelling. */
      }
    };
    host.control?.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (!current()) return stale();
      const result = await host.bridge.completeText({
        model,
        text,
        projectId,
        agent,
        idempotencyKey,
        ...(host.control ? { deadlineAt: host.control.deadlineAt } : {}),
      });
      if (!current()) return stale();
      if (result.kind === "OK") return { text: result.text, detail: "" };
      // R2-B03: the reply stopped coming, but what arrived is already a whole answer.
      const partial =
        "partialText" in result && typeof result.partialText === "string" ? result.partialText : "";
      if (
        (result.code === "STALL_RETRYING" || result.code === "TEXT_TIMEOUT") &&
        wholeJsonReply(partial)
      )
        return { text: partial, detail: "" };
      return {
        text: null,
        code: result.code,
        detail:
          "detail" in result && typeof result.detail === "string" && result.detail
            ? result.detail
            : result.code === "ENTITLEMENT_DENIED"
              ? "当前账号不能用这个文本模型。"
              : result.code === "REAUTH_REQUIRED"
                ? "需要重新登录。"
                : "这次没有收到回复。",
      };
    } finally {
      host.control?.signal.removeEventListener("abort", cancel);
    }
  });
  // 3JR-B11 (R2-02): kept word for word on this computer only when the person turned it on.
  if (
    reply.text &&
    capturedScope &&
    current() &&
    captureEnabled() &&
    requestEpoch === captureEpoch()
  ) {
    const live = host.captureFilm?.();
    const latestScope = live ? await captureScope(live) : null;
    const latestFilm = host.captureFilm?.();
    if (
      latestScope &&
      sameCaptureScope(capturedScope, latestScope) &&
      current() &&
      live &&
      latestFilm &&
      sameCaptureInput(live, latestFilm)
    )
      recordAgentReply(agent, context, instruction, reply.text, capturedScope, requestEpoch);
  }
  return reply;
}

/**
 * R2-B03: true only for text that is one complete JSON object or array as it stands, optionally
 * in a ```json fence — the model finished writing it. A reply cut off mid-way never parses here
 * (unlike the lenient reply parser, which repairs truncated JSON), so it still counts as stalled.
 */
export function wholeJsonReply(text: string): boolean {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();
  if (!body.startsWith("{") && !body.startsWith("[")) return false;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
}
