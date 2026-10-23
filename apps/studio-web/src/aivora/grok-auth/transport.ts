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
    [
      "NOT_CONNECTED",
      "AWAITING_BROWSER",
      "CONNECTED",
      "ENTITLEMENT_DENIED",
      "REAUTH_REQUIRED",
    ].includes(String(value.state)) &&
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
  "已经用 Grok 账号登录，但这个订阅档位还不能用来生成。这次没有产生结果。可以点「改用密钥（高级备用）」填写密钥，或换一个允许生成的档位后重新登录。";

export const GROK_WAITING_MESSAGE =
  "已打开系统浏览器。在 xAI 页面点同意后会自动回到这里，并显示已登录和可用模型。不用复制代码，也不用输入密码或密钥。若回调被拒绝，会自动打开已带验证码的链接并完成登录。";

export const GROK_LOGIN_LOG_HINT =
  "登录失败时请看本机日志 %APPDATA%\\AIVORA Dev Core\\logs\\grok-login.log。日志只记状态码，不写令牌。";

const LOGIN_LOG_CODES = new Set([
  "REAUTH_REQUIRED",
  "NOT_CONNECTED",
  "DESKTOP_REQUIRED",
  "SECURE_STORAGE_UNAVAILABLE",
  "SECURE_STORAGE_INVALID",
  "AUTH_CANCELLED",
  "AUTH_DENIED",
  "AUTH_FAILED",
  "AUTH_STATE_MISMATCH",
  "AUTH_IN_PROGRESS",
  "AUTH_ATTEMPT_EXPIRED",
  "CALLBACK_LISTENER_UNAVAILABLE",
  "CALLBACK_REJECTED",
  "INVALID_CALLBACK_URI",
  "TOKEN_EXCHANGE_FAILED",
  "TOKEN_RESPONSE_INVALID",
  "DEVICE_CODE_FAILED",
  "DEVICE_CODE_LINK_MISSING",
  "BROWSER_OPEN_FAILED",
  "CONNECTION_UNAVAILABLE",
  "USERINFO_FAILED",
]);

export function grokLoginFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    ENTITLEMENT_DENIED: GROK_ENTITLEMENT_MESSAGE,
    REAUTH_REQUIRED:
      "Grok 登录已失效，或刷新没有成功。请重新点「用 Grok 账号登录」。若仍不能生成，再改用密钥。",
    NOT_CONNECTED: "还没有登录 Grok 账号。",
    DESKTOP_REQUIRED: "用 Grok 账号登录需要桌面应用。网页预览不能打开授权页，也不能保存令牌。",
    BILLING_NOT_RECORDED: "这次没有调用模型，因为计费记录没有写入。请确认桌面服务已启动后再试。",
    BILLING_PROJECT_REQUIRED:
      "请先打开一个已保存的作品，再使用 Grok 账号生成。这次没有调用。也可以改用密钥。",
    DISPATCH_ALREADY_FINISHED: "同一次派发已经记过结果，没有再次调用模型。",
    DISCONNECTED: "订阅账号未连接。请重新登录，或改用密钥。",
    QUOTA_UNAVAILABLE: "订阅额度不可用。请改用密钥，或稍后再试。",
    RATE_UNAVAILABLE: "订阅调用频率不可用。请改用密钥，或稍后再试。",
    SECURE_STORAGE_UNAVAILABLE: "系统安全凭据库不可用。请先解锁本机凭据库，不会改为明文保存。",
    SECURE_STORAGE_INVALID: "保存的 Grok 登录记录无法安全读取。请重新登录。",
    AUTH_CANCELLED: "已取消 Grok 登录。",
    AUTH_DENIED: "你没有同意这次授权。可以重新点「用 Grok 账号登录」，或改用密钥。",
    AUTH_IN_PROGRESS: "已经有一次 Grok 登录在进行。请等待它结束。",
    AUTH_ATTEMPT_EXPIRED: "等待授权页返回已超时。请重新点「用 Grok 账号登录」。",
    AUTH_FAILED: "xAI 没有完成这次授权。可以重新登录，或改用密钥。",
    AUTH_STATE_MISMATCH: "授权回包和这次登录对不上。登录已停止，没有保存令牌。请重新登录。",
    CALLBACK_LISTENER_UNAVAILABLE:
      "本机登录回调没有启动。已改为自动打开带验证码的链接。若仍失败，请改用密钥。",
    CALLBACK_REJECTED:
      "授权页没有接受本机回调。这次没有读取 Cookie。已改为自动打开带验证码的链接；若仍失败，请点「改用密钥（高级备用）」。",
    INVALID_CALLBACK_URI: "本机回调地址无效，登录已停止。请改用密钥。",
    TOKEN_EXCHANGE_FAILED: "授权没有换成登录会话。请重新点「用 Grok 账号登录」。",
    TOKEN_RESPONSE_INVALID: "xAI 的登录响应不完整。请重新登录。",
    DEVICE_CODE_FAILED: "没能向 xAI 发起登录。请重试。若仍失败，改用密钥。",
    DEVICE_CODE_LINK_MISSING:
      "xAI 没有返回可自动打开的验证链接。这次没有让你复制代码。请重试或改用密钥。",
    BROWSER_OPEN_FAILED: "系统浏览器没有打开。登录已停止。请重试。",
    CONNECTION_UNAVAILABLE: "登录没有完成。请重试，或改用密钥。",
    USERINFO_FAILED: "账号资料没有读成。若上面已显示已登录，可以继续；否则请重新登录。",
    MODELS_FAILED: "模型目录没有读成。登录状态请看上面的账号，不要把它当成推理失败。",
    TEXT_FAILED: "这次推理没有成功。若账号仍显示已登录，可以稍后重试，或改用密钥。",
    TEXT_REJECTED: "这段文本或模型名称不能发送。没有调用 xAI。",
  };
  const message = messages[code] ?? `Grok 登录没有完成（${code}）。可以改用密钥（高级备用）。`;
  if (messages[code] && !LOGIN_LOG_CODES.has(code)) return message;
  return `${message} ${GROK_LOGIN_LOG_HINT}`;
}
