import type { CreateProviderConnectionInput } from "../../api/studio";

export type ProviderKind = CreateProviderConnectionInput["provider_kind"];
export type Capability = "TEXT" | "IMAGE" | "VIDEO" | "SPEECH";

export const capabilityLabels: Record<Capability, string> = {
  TEXT: "剧本",
  IMAGE: "图片",
  VIDEO: "视频",
  SPEECH: "配音",
};

export const providerPresets: Record<
  ProviderKind,
  { label: string; description: string; baseUrl: string; keyRequired: boolean }
> = {
  OPENAI: {
    label: "OpenAI",
    description: "剧本、结构化提示词与图像能力",
    baseUrl: "https://api.openai.com/v1",
    keyRequired: true,
  },
  XAI: {
    label: "xAI",
    description: "Grok 文本模型与后续媒体能力",
    baseUrl: "https://api.x.ai/v1",
    keyRequired: true,
  },
  OPENAI_COMPATIBLE: {
    label: "OpenAI 兼容",
    description: "DeepSeek、OpenRouter、LiteLLM 或自建网关",
    baseUrl: "",
    keyRequired: true,
  },
  OLLAMA: {
    label: "Ollama 本地",
    description: "无需把小说正文发送到云端",
    baseUrl: "http://127.0.0.1:11434/v1",
    keyRequired: false,
  },
};

export function compileModels(fields: Record<Capability, string>) {
  const byId = new Map<string, Set<Capability>>();
  for (const [capability, value] of Object.entries(fields) as Array<[Capability, string]>) {
    for (const modelId of value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      const capabilities = byId.get(modelId) ?? new Set<Capability>();
      capabilities.add(capability);
      byId.set(modelId, capabilities);
    }
  }
  return [...byId].map(([model_id, capabilities]) => ({
    model_id,
    capabilities: [...capabilities],
  }));
}
