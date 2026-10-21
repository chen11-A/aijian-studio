/**
 * xAI / Grok account connection for AIVORA.
 *
 * Checked against public docs on 2026-10-21:
 * - https://docs.x.ai/docs/quickstart — console API key, Bearer token to
 *   https://api.x.ai/v1. No third-party OAuth client.
 * - https://docs.x.ai/developers/faq/accounts — the Grok account and the xAI API
 *   account can be the same login, but billing is separate. Grok subscription
 *   quota is not API quota.
 * - https://docs.x.ai/docs/key-information — API billing is prepaid credits by
 *   default. This module does not read a balance.
 * - https://docs.x.ai/build/enterprise and https://docs.x.ai/build/cli/reference —
 *   `grok login` and `grok login --device-auth` authenticate the Grok CLI.
 *   They are not a published Sign in with Grok client registration, so this
 *   module does not call them or invent a client id.
 * - https://docs.x.ai/x-subscription/usage-limits — the weekly pool covers
 *   eligible first-party Grok and Cursor usage, not third-party API calls.
 *
 * The sandbox accepts a well-formed key and stores only the last four characters.
 * It does not call api.x.ai, does not create a charge, and does not invent a balance.
 */

export const XAI_API_ORIGIN = "https://api.x.ai/v1";
export const XAI_SESSION_KEY = "aivora.xai-account.v1";
export const XAI_DOCS = {
  quickstart: "https://docs.x.ai/docs/quickstart",
  billing: "https://docs.x.ai/docs/key-information",
  console: "https://console.x.ai",
} as const;

export const DOCUMENTED_XAI_MODELS = [
  { modelId: "grok-4.7", capability: "TEXT", label: "Grok 4.7" },
  { modelId: "grok-imagine-image-2.0", capability: "IMAGE", label: "Grok Imagine Image 2.0" },
] as const;

export type DocumentedXaiModel = (typeof DOCUMENTED_XAI_MODELS)[number];

export type XaiMembershipView = {
  status: "unverified_sandbox";
  billingMethod: "prepaid_credits";
  invoicedBilling: "disabled_by_default";
  balance: "unknown";
  consumerPlan: "not_an_api_entitlement";
  benefits: readonly string[];
  budgetRelation: string;
};

export type XaiSandboxSession = {
  version: 1;
  mode: "sandbox";
  liveProbe: "not_performed";
  keyHint: string;
  connectedAt: string;
  membership: XaiMembershipView;
};

const MEMBERSHIP: XaiMembershipView = {
  status: "unverified_sandbox",
  billingMethod: "prepaid_credits",
  invoicedBilling: "disabled_by_default",
  balance: "unknown",
  consumerPlan: "not_an_api_entitlement",
  benefits: [
    "登记后可在模型中心看到文档快照里的文本与图像模型。这不是该账号的实时目录。",
    "不包含 SuperGrok、X Premium 或 grok.com 订阅额度。",
    "不自动充值，不收款，不调用付费模型。",
  ],
  budgetRelation:
    "xAI API 预付费账与作品预算是两本账。本页不写入、不预留、不派发。看不到的金额保持未知，不显示为 0。",
};

export function xaiMembershipView(): XaiMembershipView {
  return MEMBERSHIP;
}

export function xaiConnectionModels() {
  return DOCUMENTED_XAI_MODELS.map((model) => ({
    model_id: model.modelId,
    capabilities: [model.capability] as ["TEXT"] | ["IMAGE"],
  }));
}

export function checkXaiApiKey(
  value: string,
): { ok: true; hint: string } | { ok: false; message: string } {
  if (value !== value.trim() || /\s/.test(value))
    return { ok: false, message: "密钥不能包含空格。请粘贴控制台里的 API Key，而不是登录密码。" };
  if (!value.startsWith("xai-"))
    return {
      ok: false,
      message: "这不是 xAI 控制台 API Key。官方密钥以 xai- 开头。Grok 网页账号不能在这里登录。",
    };
  if (value.length < 12 || value.length > 512)
    return { ok: false, message: "密钥长度不在控制台密钥的常见范围内。" };
  return { ok: true, hint: value.slice(-4) };
}

export function openXaiSandboxSession(
  key: string,
  connectedAt: string,
): { ok: true; session: XaiSandboxSession } | { ok: false; message: string } {
  const checked = checkXaiApiKey(key);
  if (!checked.ok) return checked;
  const session: XaiSandboxSession = {
    version: 1,
    mode: "sandbox",
    liveProbe: "not_performed",
    keyHint: checked.hint,
    connectedAt,
    membership: xaiMembershipView(),
  };
  if (JSON.stringify(session).includes(key))
    return { ok: false, message: "沙箱拒绝保存完整密钥。" };
  return { ok: true, session };
}

function isSession(value: unknown): value is XaiSandboxSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Partial<XaiSandboxSession>;
  return (
    session.version === 1 &&
    session.mode === "sandbox" &&
    session.liveProbe === "not_performed" &&
    typeof session.keyHint === "string" &&
    session.keyHint.length === 4 &&
    typeof session.connectedAt === "string" &&
    session.membership?.status === "unverified_sandbox" &&
    session.membership.balance === "unknown" &&
    session.membership.consumerPlan === "not_an_api_entitlement"
  );
}

export function readXaiSession(storage: Pick<Storage, "getItem">): XaiSandboxSession | null {
  try {
    const raw = storage.getItem(XAI_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeXaiSession(
  storage: Pick<Storage, "setItem" | "removeItem">,
  session: XaiSandboxSession | null,
): boolean {
  try {
    if (!session) {
      storage.removeItem(XAI_SESSION_KEY);
      return true;
    }
    if (!isSession(session)) return false;
    storage.setItem(XAI_SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
