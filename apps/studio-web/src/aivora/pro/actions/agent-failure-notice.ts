import type { UiNotice } from "../../film/contracts3j";
import { NOTICE_TEXT, type NoticeCode } from "../../film/notices";
import type { AgentReply } from "../workflow";

/** Preserve failure identity/reason; model text is never rewritten or used as an error. */
export function agentFailureNotice(
  reply: AgentReply,
  fallbackCode: NoticeCode,
  unchanged: string,
): { notice: string; structuredNotice: UiNotice } {
  const reason = reply.text && !reply.code ? "" : reply.detail.trim();
  const code = reply.code || fallbackCode;
  const text = NOTICE_TEXT[code as NoticeCode] ?? NOTICE_TEXT[fallbackCode];
  return {
    notice: [reason || "这次回复用不了。", unchanged].join(" "),
    structuredNotice: {
      code,
      text,
      detail: [reason === text ? "" : reason, unchanged].filter(Boolean).join(" "),
    },
  };
}
