/**
 * One account row for ChatGPT and one for Grok.
 *
 * ChatGPT uses the existing official Sign in with ChatGPT OAuth. A connected
 * profile with plan permission can spend that ChatGPT plan. Grok has no
 * published equivalent: xAI documents API keys only, and says Grok subscription
 * billing is separate from API billing. `grok login --device-auth` belongs to
 * the Grok CLI, not to a third-party client registration AIVORA may implement.
 */

import type { ChatGPTModel, ChatGPTStatus } from "../chatgpt-auth/transport";
import { DOCUMENTED_XAI_MODELS, type XaiSandboxSession } from "./xai-account";

export type AccountProviderId = "CHATGPT_OFFICIAL" | "XAI_API";

export type ConnectedAccountModel = {
  id: string;
  label: string;
};

export type ConnectedAccountSlot = {
  provider: AccountProviderId;
  title: string;
  method: string;
  connected: boolean;
  state: string;
  quota: string;
  models: readonly ConnectedAccountModel[];
  difference: string;
};

export function connectedAccountSlots(input: {
  chatgpt?: ChatGPTStatus | null;
  chatgptModels?: readonly ChatGPTModel[];
  chatgptLoading?: boolean;
  xai?: XaiSandboxSession | null;
}): readonly [ConnectedAccountSlot, ConnectedAccountSlot] {
  return [
    chatgptSlot(input.chatgpt ?? null, input.chatgptModels ?? [], input.chatgptLoading),
    xaiSlot(input.xai ?? null),
  ];
}

function chatgptSlot(
  status: ChatGPTStatus | null,
  models: readonly ChatGPTModel[],
  loading = false,
): ConnectedAccountSlot {
  const active = status?.profiles.find((profile) => profile.id === status.activeProfileId);
  const planAuthorized = status?.state === "CONNECTED" && active?.planUsage === true;
  const listed = planAuthorized ? models : [];
  let state = "未连接";
  let quota = "未连接，没有可显示的套餐额度。";
  if (loading) {
    state = "正在读取";
    quota = "额度未知。读取完成前不显示为 0。";
  } else if (!status || status.runtime === "DESKTOP_REQUIRED") {
    state = "需要桌面应用";
    quota = "网页预览不能开始官方登录。套餐额度未知。";
  } else if (status.state === "AWAITING_BROWSER") {
    state = "等待浏览器授权";
    quota = "授权尚未完成。套餐额度未知。";
  } else if (status.state === "REAUTH_REQUIRED") {
    state = "需要重新授权";
    quota = "套餐额度未知。重新登录前不能当作已授权。";
  } else if (status.state === "IDENTITY_ONLY") {
    state = active?.email ? `已登录 · ${active.email}` : "已登录身份";
    quota = "套餐未授权。不能按 ChatGPT 订阅额度调用。";
  } else if (planAuthorized) {
    state = active?.email ? `已连接 · ${active.email}` : "已连接";
    quota = "套餐已授权。剩余额度未知，本页不查询用量，也不写成 0。";
  }
  return {
    provider: "CHATGPT_OFFICIAL",
    title: "ChatGPT",
    method: "官方 OAuth",
    connected: planAuthorized,
    state,
    quota,
    models: listed.map((model) => ({ id: model.slug, label: model.displayName })),
    difference: "沿用仓库里的 Sign in with ChatGPT。授权套餐后，文本模型来自该账号目录。",
  };
}

function xaiSlot(session: XaiSandboxSession | null): ConnectedAccountSlot {
  return {
    provider: "XAI_API",
    title: "Grok",
    method: "官方 API Key",
    connected: session !== null,
    state: session ? `API Key 已登记 · 末四位 ${session.keyHint}` : "未连接",
    quota: session
      ? "不能使用 Grok 订阅额度。API 余额未知，未查询，不写成 0。"
      : "未连接。没有与 ChatGPT 相同的订阅登录，因此这里没有订阅额度。",
    models: session
      ? DOCUMENTED_XAI_MODELS.map((model) => ({ id: model.modelId, label: model.label }))
      : [],
    difference:
      "与 ChatGPT 并列，但不是同一种登录。xAI 公开文档只让第三方使用 API Key；同一账号的 Grok 订阅和 API 分开计费。本页不预留、不派发作品预算。",
  };
}
