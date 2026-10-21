import type { GrokLoginBridge, GrokLoginTextResult } from "@aijian/contracts/grok-auth";
import { grokLoginFailureMessage } from "./transport";

export type GrokLoginDispatchResult =
  | {
      kind: "OK";
      text: string;
      billingAccountKind: "grok_login";
      model: string;
      message: string;
    }
  | {
      kind: "ERROR" | "UNAVAILABLE";
      code: string;
      billingAccountKind: "grok_login";
      message: string;
    };

/**
 * Desktop transport for a Grok subscription login.
 * The access token stays in the desktop credential store. This function only
 * sends the model id and the text. The service worker still refuses a queued
 * grok_login dispatch before any HTTP call, because that process has no token.
 */
export async function dispatchGrokLoginText(
  bridge: GrokLoginBridge | undefined,
  input: { model: string; text: string },
): Promise<GrokLoginDispatchResult> {
  if (!bridge) {
    return {
      kind: "UNAVAILABLE",
      code: "DESKTOP_REQUIRED",
      billingAccountKind: "grok_login",
      message: grokLoginFailureMessage("DESKTOP_REQUIRED"),
    };
  }
  const result: GrokLoginTextResult = await bridge.completeText(input);
  if (result.kind === "OK") {
    return {
      kind: "OK",
      text: result.text,
      model: result.model,
      billingAccountKind: result.billingAccountKind,
      message: `已用 Grok 登录账号生成。计费类别 ${result.billingAccountKind}。模型 ${result.model}。这段结果不会写入来源抽取提案。`,
    };
  }
  return {
    kind: "ERROR",
    code: result.code,
    billingAccountKind: result.billingAccountKind,
    message: grokLoginFailureMessage(result.code),
  };
}
