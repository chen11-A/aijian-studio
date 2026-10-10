import type { ChatGPTBridge, ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
export type {
  ChatGPTBridge,
  ChatGPTStatus,
  ChatGPTUseScope,
  ChatGPTModel,
} from "@aijian/contracts/chatgpt-auth";

declare global {
  interface Window {
    aijianChatGPT?: ChatGPTBridge;
  }
}
export const DESKTOP_REQUIRED: ChatGPTStatus = {
  provider: "CHATGPT_OFFICIAL",
  runtime: "DESKTOP_REQUIRED",
  state: "NOT_CONNECTED",
  useScope: null,
  secureStorage: "NOT_CHECKED",
  activeProfileId: null,
  profiles: [],
  lastError: null,
  liveVerified: false,
};
export const HELP_URLS = {
  documentation: "https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt",
  usage: "https://chatgpt.com/settings/usage",
  eligibility: "https://openai.com/form/sign-in-with-chatgpt-interest/",
} as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const text = (value: unknown, limit = 300): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  });
export function validStatus(value: unknown): value is ChatGPTStatus {
  if (
    !record(value) ||
    !exact(value, [
      "provider",
      "runtime",
      "state",
      "useScope",
      "secureStorage",
      "activeProfileId",
      "profiles",
      "lastError",
      "liveVerified",
    ]) ||
    value.provider !== "CHATGPT_OFFICIAL" ||
    !["DESKTOP", "DESKTOP_REQUIRED"].includes(String(value.runtime)) ||
    ![
      "NOT_CONNECTED",
      "AWAITING_BROWSER",
      "CONNECTED",
      "IDENTITY_ONLY",
      "REAUTH_REQUIRED",
    ].includes(String(value.state)) ||
    (value.useScope !== null &&
      !["LOCAL_PERSONAL", "OPEN_SOURCE", "APPROVED_PRIVATE"].includes(String(value.useScope))) ||
    !["AVAILABLE", "UNAVAILABLE", "NOT_CHECKED"].includes(String(value.secureStorage)) ||
    (value.activeProfileId !== null && !text(value.activeProfileId, 36)) ||
    (value.lastError !== null && !text(value.lastError, 100)) ||
    typeof value.liveVerified !== "boolean" ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 20
  )
    return false;
  const ids = new Set<string>();
  for (const profile of value.profiles) {
    if (
      !record(profile) ||
      !exact(profile, ["id", "label", "email", "connected", "planUsage"]) ||
      !text(profile.id, 36) ||
      ids.has(profile.id) ||
      !text(profile.label, 80) ||
      (profile.email !== null && !text(profile.email, 254)) ||
      typeof profile.connected !== "boolean" ||
      typeof profile.planUsage !== "boolean" ||
      (profile.planUsage && !profile.connected)
    )
      return false;
    ids.add(profile.id);
  }
  const active = value.profiles.find(
    (profile) => record(profile) && profile.id === value.activeProfileId,
  );
  if (value.activeProfileId !== null && !active) return false;
  if (value.state === "CONNECTED" && (!active?.connected || !active.planUsage)) return false;
  if (value.state === "IDENTITY_ONLY" && (!active?.connected || active.planUsage)) return false;
  return (
    value.runtime !== "DESKTOP_REQUIRED" ||
    (value.state === "NOT_CONNECTED" && value.profiles.length === 0)
  );
}
export function chatGPTBridge(): ChatGPTBridge | undefined {
  return window.aijianChatGPT;
}
/** Read-only connection display state, suitable for deciding whether first-use setup can be skipped. */
export async function readChatGPTStatus(bridge = chatGPTBridge()): Promise<ChatGPTStatus> {
  if (!bridge) return { ...DESKTOP_REQUIRED, profiles: [] };
  const value: unknown = await bridge.status();
  if (!validStatus(value)) throw new Error("CHATGPT_STATUS_INVALID");
  return value;
}
export function chatGPTErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    OPENAI_REQUEST_FAILED:
      "官方服务请求未成功（OPENAI_REQUEST_FAILED）。这不等于账号未登录；请检查本机诊断日志中的 HTTP 状态。",
    MODEL_CATALOG_INVALID:
      "模型目录格式未通过校验（MODEL_CATALOG_INVALID），尚未确认可用模型；账号连接状态单独显示。",
    RESPONSE_INVALID:
      "官方服务响应格式异常（RESPONSE_INVALID），本次操作未确认成功；请检查连接后手动重试。",
    RESPONSE_TOO_LARGE: "官方服务响应超出安全读取上限（RESPONSE_TOO_LARGE），本次操作已停止。",
    OPERATION_IN_PROGRESS:
      "已有账号操作正在进行（OPERATION_IN_PROGRESS），请等待完成，不要重复登录。",
    SECURE_STORAGE_UNAVAILABLE:
      "系统安全凭据库不可用。请在桌面系统解锁凭据库后重试；不会改为明文保存。",
    SECURE_STORAGE_INVALID: "保存的账号记录无法安全读取。保留现有文件，请检查桌面凭据库。",
    SECURE_STORAGE_WRITE_FAILED: "凭据保存未能确认。请重新核对账号状态，暂不使用套餐。",
    AUTH_CANCELLED: "已取消登录。可以继续使用 API 连接。",
    AUTH_DENIED: "你未授予这次权限。可以重新授权或使用 API。",
    AUTH_ATTEMPT_EXPIRED:
      "等待官方网页返回已超时，尚未确认登录。请先确认网页能正常打开，再回来手动开始一次登录。",
    BROWSER_OPEN_FAILED: "系统浏览器未能打开。请检查这台电脑的默认浏览器，再手动重试。",
    CALLBACK_LISTENER_UNAVAILABLE:
      "本机登录回调服务未能启动，登录尚未开始。请检查应用运行环境后再试。",
    AUTH_STATE_MISMATCH: "返回信息与本次登录不匹配，未确认登录。请回到软件手动重新开始。",
    IDENTITY_INVALID: "未能验证 OpenAI 账号签名或身份，未建立连接。",
    ACCOUNT_MISMATCH: "返回账号与选择的账号不一致，原连接保留。",
    REGISTRATION_MISMATCH: "返回注册信息不一致，请重新登录。",
    REAUTH_REQUIRED: "登录已失效或刷新结果不明确，请重新授权。",
    PLAN_USAGE_NOT_AUTHORIZED: "已登录不等于已授权套餐。请重新登录并审阅套餐使用权限。",
    USAGE_LIMIT: "已达到当前账号的用量限制，请在 ChatGPT 中管理用量。",
    REMOTE_REVOCATION_UNCONFIRMED:
      "本机已退出，但远端撤销未确认。请在 ChatGPT 用量设置中断开应用。",
    PROFILE_NOT_FOUND: "此账号尚未完成登录，请选择重新授权。",
    CONNECTION_UNAVAILABLE:
      "尚未确认连接。若官方网页提示无法访问，请先排查这台电脑访问 auth.openai.com 的浏览器连接，再手动重试。",
  };
  return messages[code] ?? "操作未通过验证，未确认成功。请重新核对连接或使用 API。";
}
