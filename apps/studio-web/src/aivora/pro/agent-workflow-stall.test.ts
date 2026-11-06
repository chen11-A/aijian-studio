import { describe, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { completeMembershipAgent, wholeJsonReply } from "./agent-workflow";

const whole = JSON.stringify({ shots: [{ picture: "雨夜巷口", line: "雨太大" }] });

function host(result: Awaited<ReturnType<GrokLoginBridge["completeText"]>>) {
  const bridge = {
    status: vi.fn().mockResolvedValue({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
    }),
    completeText: vi.fn().mockResolvedValue(result),
    cancelText: vi.fn().mockResolvedValue(undefined),
  } as unknown as GrokLoginBridge;
  return {
    bridge,
    modelIds: ["grok-4.7"],
    billingProject: async () => `prj_${"a".repeat(32)}`,
    current: () => true,
    modelsChanged: () => undefined,
  };
}

const stalled = (code: string, partialText?: string) =>
  ({
    kind: "ERROR",
    code,
    billingAccountKind: "grok_login",
    detail: "很久没有新的字，已停止。可以再问一次。",
    ...(partialText === undefined ? {} : { partialText }),
  }) as const;

describe("R2-B03 a reply that stopped coming after it was already whole", () => {
  it("is used as the answer, without a failure", async () => {
    for (const code of ["STALL_RETRYING", "TEXT_TIMEOUT"]) {
      const reply = await completeMembershipAgent(
        "art",
        "画风：雨夜",
        "写出画风",
        host(stalled(code, whole)),
      );
      expect(reply).toEqual({ text: whole, detail: "" });
    }
    const fenced = `\`\`\`json\n${whole}\n\`\`\``;
    const reply = await completeMembershipAgent(
      "art",
      "画风：雨夜",
      "写出画风",
      host(stalled("STALL_RETRYING", fenced)),
    );
    expect(reply.text).toBe(fenced);
  });

  it("still stops, and is retried, when the text was cut off or the user cancelled", async () => {
    const cut = whole.slice(0, -3);
    const reply = await completeMembershipAgent(
      "art",
      "画风：雨夜",
      "写出画风",
      host(stalled("STALL_RETRYING", cut)),
    );
    expect(reply).toMatchObject({ text: null, code: "STALL_RETRYING" });
    const none = await completeMembershipAgent(
      "art",
      "画风：雨夜",
      "写出画风",
      host(stalled("TEXT_TIMEOUT")),
    );
    expect(none).toMatchObject({ text: null, code: "TEXT_TIMEOUT" });
    const cancelled = await completeMembershipAgent(
      "art",
      "画风：雨夜",
      "写出画风",
      host(stalled("TEXT_CANCELLED", whole)),
    );
    expect(cancelled).toMatchObject({ text: null, code: "TEXT_CANCELLED" });
  });

  it("counts only text that parses as it stands", () => {
    expect(wholeJsonReply(whole)).toBe(true);
    expect(wholeJsonReply(`[${whole}]`)).toBe(true);
    expect(wholeJsonReply(whole.slice(0, -1))).toBe(false);
    expect(wholeJsonReply(`好的，镜头如下：${whole}`)).toBe(false);
    expect(wholeJsonReply('"只是一句话"')).toBe(false);
    expect(wholeJsonReply("")).toBe(false);
  });
});
