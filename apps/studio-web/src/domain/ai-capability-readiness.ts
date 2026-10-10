import type { ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
import type { ProviderConnectionData } from "../api/studio";
import type { Capability } from "./provider-settings-model";
import type { ProviderSettingsState } from "./use-provider-settings";

/** Local display evidence, never a provider entitlement, quota or execution authorization. */
export type ConnectionReadiness =
  | "CHECKING"
  | "UNKNOWN"
  | "DESKTOP_REQUIRED"
  | "DISCONNECTED"
  | "REAUTH_REQUIRED"
  | "PLAN_REQUIRED"
  | "AUTHORIZED_UNVERIFIED"
  | "DISABLED"
  | "CREDENTIAL_UNAVAILABLE"
  | "CREDENTIAL_MISSING"
  | "MODEL_MISSING"
  | "CONFIGURED_UNVERIFIED";

export const readinessLabels: Record<ConnectionReadiness, string> = {
  CHECKING: "正在读取账号状态",
  UNKNOWN: "账号状态读取失败 · 尚未确认",
  DESKTOP_REQUIRED: "请在桌面应用读取账号",
  DISCONNECTED: "尚未连接 ChatGPT 账号",
  REAUTH_REQUIRED: "账号需要重新授权",
  PLAN_REQUIRED: "已登录 · 套餐使用未授权",
  AUTHORIZED_UNVERIFIED: "套餐已授权 · 推理待验证",
  DISABLED: "连接已停用",
  CREDENTIAL_UNAVAILABLE: "系统凭据暂不可用",
  CREDENTIAL_MISSING: "尚未配置调用凭据",
  MODEL_MISSING: "尚未登记模型",
  CONFIGURED_UNVERIFIED: "本地已配置 · 调用待验证",
};

export function assessChatGPTConnection(input: {
  status: ChatGPTStatus;
  loading: boolean;
  busy: boolean;
  statusReadFailed: boolean;
}): ConnectionReadiness {
  if (input.loading || input.busy) return "CHECKING";
  if (input.statusReadFailed) return "UNKNOWN";
  const { status } = input;
  if (status.runtime !== "DESKTOP") return "DESKTOP_REQUIRED";
  if (status.secureStorage !== "AVAILABLE") return "CREDENTIAL_UNAVAILABLE";
  if (status.state === "AWAITING_BROWSER") return "CHECKING";
  if (status.state === "REAUTH_REQUIRED") return "REAUTH_REQUIRED";
  const active = status.profiles.find((profile) => profile.id === status.activeProfileId);
  if (!active?.connected) return "DISCONNECTED";
  if (status.state === "IDENTITY_ONLY" || !active.planUsage) return "PLAN_REQUIRED";
  return status.state === "CONNECTED" ? "AUTHORIZED_UNVERIFIED" : "DISCONNECTED";
}

export function assessConfiguredConnection(
  connection: ProviderConnectionData,
): ConnectionReadiness {
  if (!connection.enabled) return "DISABLED";
  if (connection.credential_status === "UNAVAILABLE") return "CREDENTIAL_UNAVAILABLE";
  if (connection.provider_kind !== "OLLAMA" && connection.credential_status !== "CONFIGURED")
    return "CREDENTIAL_MISSING";
  if (!connection.models.length) return "MODEL_MISSING";
  return "CONFIGURED_UNVERIFIED";
}

export const capabilityTitles: Record<Capability, string> = {
  TEXT: "文本与分镜",
  IMAGE: "图片生成",
  VIDEO: "视频生成",
  SPEECH: "配音生成",
};

export type CapabilityReadiness = {
  capability: Capability;
  state:
    "AUTHORIZED_UNVERIFIED" | "CONFIGURED_UNVERIFIED" | "MISSING" | "UNKNOWN" | "NOT_INTEGRATED";
  label: string;
  detail: string;
  configuredSources: { id: string; label: string }[];
};

/** A registered model/capability is user configuration, not evidence of a working adapter. */
export function assessCapabilities(chatGPT: ConnectionReadiness, providers: ProviderSettingsState) {
  const connections = providers.kind === "ready" ? providers.response.data : [];
  const assess = (capability: Capability): CapabilityReadiness => {
    const configuredSources = connections
      .filter(
        (connection) =>
          assessConfiguredConnection(connection) === "CONFIGURED_UNVERIFIED" &&
          connection.models.some((model) => model.capabilities.includes(capability)),
      )
      .map((connection) => ({ id: connection.id, label: connection.display_name }));
    if (capability !== "TEXT")
      return {
        capability,
        configuredSources,
        state: "NOT_INTEGRATED",
        label: "自动生成尚未接入",
        detail: "登记模型不会启用媒体生成；可先在外部生成后导入素材。",
      };
    if (chatGPT === "AUTHORIZED_UNVERIFIED")
      return {
        capability,
        configuredSources,
        state: "AUTHORIZED_UNVERIFIED",
        label: "ChatGPT 文本已授权 · 待实际调用",
        detail: "可进入项目准备 AI 导演提案；模型、输入、额度仍须在调用前核对。",
      };
    if (configuredSources.length)
      return {
        capability,
        configuredSources,
        state: "CONFIGURED_UNVERIFIED",
        label: "已登记文本候选 · 待验证",
        detail: "需核对具体入口支持的服务。连接记录不证明实际模型权限或套餐额度。",
      };
    if (providers.kind !== "ready" || ["CHECKING", "UNKNOWN"].includes(chatGPT))
      return {
        capability,
        configuredSources,
        state: "UNKNOWN",
        label: "文本能力尚未确认",
        detail: "连接目录或账号状态尚未读取成功，请重新读取；不会使用旧状态代替验证。",
      };
    return {
      capability,
      configuredSources,
      state: "MISSING",
      label: "尚无可准备的文本连接",
      detail: "连接并授权账号，或配置受支持的服务；也可以手工编写剧本。",
    };
  };
  return [assess("TEXT"), assess("IMAGE"), assess("VIDEO"), assess("SPEECH")] as const;
}
