import type {
  GrokLoginBridge,
  GrokLoginModel,
  GrokLoginStatus,
  GrokLoginTextResult,
} from "@aijian/contracts/grok-auth";

export type { GrokLoginBridge, GrokLoginModel, GrokLoginStatus, GrokLoginTextResult };

declare global {
  interface Window {
    aijianGrok?: GrokLoginBridge;
  }
}

export const GROK_DESKTOP_REQUIRED: GrokLoginStatus = {
  provider: "GROK_LOGIN",
  runtime: "DESKTOP_REQUIRED",
  state: "NOT_CONNECTED",
  secureStorage: "NOT_CHECKED",
  accountLabel: null,
  lastError: null,
};

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

export function validGrokStatus(value: unknown): value is GrokLoginStatus {
  return (
    record(value) &&
    exact(value, ["provider", "runtime", "state", "secureStorage", "accountLabel", "lastError"]) &&
    value.provider === "GROK_LOGIN" &&
    (value.runtime === "DESKTOP" || value.runtime === "DESKTOP_REQUIRED") &&
    ["NOT_CONNECTED", "AWAITING_BROWSER", "CONNECTED", "ENTITLEMENT_DENIED", "REAUTH_REQUIRED"].includes(
      String(value.state),
    ) &&
    ["AVAILABLE", "UNAVAILABLE", "NOT_CHECKED"].includes(String(value.secureStorage)) &&
    (value.accountLabel === null || text(value.accountLabel, 254)) &&
    (value.lastError === null || text(value.lastError, 100)) &&
    (value.runtime !== "DESKTOP_REQUIRED" || value.state === "NOT_CONNECTED")
  );
}

export function grokBridge(): GrokLoginBridge | undefined {
  return window.aijianGrok;
}

export async function readGrokStatus(bridge = grokBridge()): Promise<GrokLoginStatus> {
  if (!bridge) return { ...GROK_DESKTOP_REQUIRED };
  const value: unknown = await bridge.status();
  if (!validGrokStatus(value)) throw new Error("GROK_STATUS_INVALID");
  return value;
}

export const GROK_ENTITLEMENT_MESSAGE =
  "已经用 SuperGrok / X Premium+ 账号登录，但 xAI 返回 403。部分普通 SuperGrok 订阅可以登录成功，推理仍会被拒绝。这次没有生成结果，也不会反复重试。请点「改用 API Key（高级备用）」填写控制台密钥，或换一个允许第三方推理的档位后重新登录。";

export function grokLoginFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    ENTITLEMENT_DENIED: GROK_ENTITLEMENT_MESSAGE,
    REAUTH_REQUIRED: "Grok 登录已失效，或刷新没有成功。请重新登录。若推理仍返回 403，再改用 API Key。",
    NOT_CONNECTED: "还没有登录 SuperGrok / X Premium+ 账号。",
    DESKTOP_REQUIRED: "用 SuperGrok / X Premium+ 账号登录需要桌面应用。网页预览不能保存令牌。",
    BILLING_NOT_RECORDED: "这次没有调用模型，因为计费记录没有写入。请确认桌面服务已启动后再试。",
    BILLING_PROJECT_REQUIRED: "请先打开一个已保存的作品，再使用 SuperGrok 生成。这次没有调用。也可以改用 API Key。",
    DISPATCH_ALREADY_FINISHED: "同一次派发已经记过结果，没有再次调用模型。",
    DISCONNECTED: "订阅账号未连接。请重新登录，或改用 API Key。",
    QUOTA_UNAVAILABLE: "订阅额度不可用。请改用 API Key，或稍后再试。",
    RATE_UNAVAILABLE: "订阅调用频率不可用。请改用 API Key，或稍后再试。",
    SECURE_STORAGE_UNAVAILABLE: "系统安全凭据库不可用。请先解锁本机凭据库，不会改为明文保存。",
    SECURE_STORAGE_INVALID: "保存的 Grok 登录记录无法安全读取。请重新登录。",
    AUTH_CANCELLED: "已取消 Grok 登录。",
    AUTH_DENIED: "你没有同意这次授权。可以重新登录，或改用 API Key。",
    AUTH_IN_PROGRESS: "已经有一次 Grok 登录在进行。请等待它结束。",
    AUTH_ATTEMPT_EXPIRED: "等待授权页返回已超时。请重新开始登录。",
    CALLBACK_LISTENER_UNAVAILABLE: "本机登录回调没有启动。登录已停止。请改用 API Key，或检查 127.0.0.1 后再试。",
    CALLBACK_REJECTED:
      "授权页没有接受本机回调。这次登录已停止，没有读取 Cookie，也不会反复重试。请点「改用 API Key（高级备用）」。",
    INVALID_CALLBACK_URI: "本机回调地址无效，登录已停止。请改用 API Key。",
    TOKEN_EXCHANGE_FAILED: "授权码没有换成令牌。请重新登录。",
    MODELS_FAILED: "模型目录没有读成。登录状态请看上面的账号，不要把它当成推理失败。",
    TEXT_FAILED: "这次推理没有成功。若账号仍显示已登录，可以稍后重试，或改用 API Key。",
    TEXT_REJECTED: "这段文本或模型名称不能发送。没有调用 xAI。",
  };
  return messages[code] ?? `Grok 登录没有完成（${code}）。可以改用 API Key（高级备用）。`;
}
