/**
 * ChatGPT and Grok subscription logins are peer account rows.
 * Grok uses the public xAI authorization server (auth.x.ai) and api.x.ai.
 * An API key is a separate, secondary connection and does not spend the
 * subscription login.
 */

import type { ChatGPTModel, ChatGPTStatus } from "../chatgpt-auth/transport";
import type { GrokLoginModel, GrokLoginStatus } from "../grok-auth/transport";
import { DOCUMENTED_XAI_MODELS, type XaiSandboxSession } from "./xai-account";

export type AccountProviderId = "CHATGPT_OFFICIAL" | "GROK_LOGIN" | "XAI_API";

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
  grok?: GrokLoginStatus | null;
  grokModels?: readonly GrokLoginModel[];
  grokLoading?: boolean;
  xai?: XaiSandboxSession | null;
}): readonly [ConnectedAccountSlot, ConnectedAccountSlot, ConnectedAccountSlot] {
  return [
    chatgptSlot(input.chatgpt ?? null, input.chatgptModels ?? [], input.chatgptLoading),
    grokLoginSlot(input.grok ?? null, input.grokModels ?? [], input.grokLoading),
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
    method: "浏览器登录",
    connected: planAuthorized,
    state,
    quota,
    models: listed.map((model) => ({ id: model.slug, label: model.displayName })),
    difference: "用浏览器登录 ChatGPT。登录后，文本模型来自这个账号。",
  };
}

function grokLoginSlot(
  status: GrokLoginStatus | null,
  models: readonly GrokLoginModel[],
  loading = false,
): ConnectedAccountSlot {
  let state = "未连接";
  let quota = "未登录。登录后额度未知，本页不查询用量，也不写成 0。";
  let connected = false;
  let listed: readonly ConnectedAccountModel[] = [];
  if (loading) {
    state = "正在读取";
    quota = "额度未知。读取完成前不显示为 0。";
  } else if (!status || status.runtime === "DESKTOP_REQUIRED") {
    state = "需要桌面应用";
    quota = "网页预览不能开始 Grok 登录。订阅额度未知。";
  } else if (status.state === "AWAITING_BROWSER") {
    state = "等待浏览器授权";
    quota = "授权尚未完成。订阅额度未知。";
  } else if (status.state === "REAUTH_REQUIRED") {
    state = "需要重新登录";
    quota = "订阅额度未知。重新登录前不能当作已授权。";
  } else if (status.state === "ENTITLEMENT_DENIED") {
    state = status.accountLabel ? `已登录 · ${status.accountLabel}` : "已登录";
    quota = "登录成功，但模型目录或推理返回 403。请改用 API Key。剩余额度未知。";
  } else if (status.state === "CONNECTED") {
    connected = true;
    state = status.accountLabel ? `已连接 · ${status.accountLabel}` : "已连接";
    quota = "订阅登录已建立。剩余额度未知，本页不查询用量，也不写成 0。";
    listed = models.map((model) => ({ id: model.id, label: model.label }));
  }
  return {
    provider: "GROK_LOGIN",
    title: "Grok",
    method: "浏览器登录",
    connected,
    state,
    quota,
    models: listed,
    difference: "用浏览器登录 Grok。登录后，模型来自这个账号，登录信息只留在这台电脑上。",
  };
}

function xaiSlot(session: XaiSandboxSession | null): ConnectedAccountSlot {
  return {
    provider: "XAI_API",
    title: "Grok 密钥",
    method: "高级备用",
    connected: session !== null,
    state: session ? `API Key 已登记 · 末四位 ${session.keyHint}` : "未使用",
    quota: session
      ? "这是 API 余额，不是订阅额度。余额未知，未查询，不写成 0。"
      : "登录成功但推理返回 403 时，再用控制台 API Key。",
    models: session
      ? DOCUMENTED_XAI_MODELS.map((model) => ({ id: model.modelId, label: model.label }))
      : [],
    difference: "备用通道。只检查密钥格式，不会访问网络，也不会提前占用预算。",
  };
}
