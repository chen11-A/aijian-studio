import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { textModel } from "../film/project";
import type { AgentId } from "../film/phase2";
import { completeAgentBatched } from "../film/request-batches";
import type { AgentReply } from "./workflow";

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
  },
): Promise<AgentReply> {
  const stale = (): AgentReply => ({
    text: null,
    detail: "输入已变化，本次请求已停止。",
    code: "REQUEST_STALE",
  });
  if (!host.current()) return stale();
  const membership = await host.bridge.status();
  if (!host.current()) return stale();
  if (
    membership.provider !== "GROK_LOGIN" ||
    membership.runtime !== "DESKTOP" ||
    membership.state !== "CONNECTED"
  )
    return { text: null, detail: "需要 Grok 会员登录。", code: "GROK_MEMBERSHIP_REQUIRED" };
  const projectId = await host.billingProject();
  if (!host.current()) return stale();
  if (!projectId)
    return { text: null, detail: "这一次没有记到作品上。", code: "BILLING_PROJECT_REQUIRED" };
  let model = textModel(host.modelIds);
  if (!model) {
    try {
      const listed = await host.bridge.models();
      if (!host.current()) return stale();
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
  return completeAgentBatched(agent, context, instruction, async (text) => {
    if (!host.current()) return stale();
    const result = await host.bridge.completeText({
      model,
      text,
      projectId,
      agent,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!host.current()) return stale();
    if (result.kind === "OK") return { text: result.text, detail: "" };
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
              : "模型没有返回。",
    };
  });
}
