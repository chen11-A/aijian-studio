import { useCallback, useState } from "react";

import type { CreateProviderConnectionInput } from "../api/studio";
import {
  compileModels,
  providerPresets,
  type Capability,
  type ProviderKind,
} from "./provider-settings-model";

const emptyModels: Record<Capability, string> = { TEXT: "", IMAGE: "", VIDEO: "", SPEECH: "" };

export function useProviderConnectionForm(
  onSubmit: (input: CreateProviderConnectionInput) => Promise<void>,
) {
  const [providerKind, setProviderKind] = useState<ProviderKind>("OPENAI");
  const [displayName, setDisplayName] = useState("OpenAI 主连接");
  const [baseUrl, setBaseUrl] = useState(providerPresets.OPENAI.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(emptyModels);
  const [modelError, setModelError] = useState<string | null>(null);

  const chooseProvider = useCallback((nextKind: ProviderKind) => {
    const next = providerPresets[nextKind];
    setProviderKind(nextKind);
    setDisplayName(next.label);
    setBaseUrl(next.baseUrl);
    setApiKey("");
    setModels(emptyModels);
    setModelError(null);
  }, []);

  const setModel = useCallback((capability: Capability, value: string) => {
    if (providerKind === "SUB2API" && capability !== "TEXT") return;
    setModels((current) => ({ ...current, [capability]: value }));
  }, [providerKind]);

  const submit = useCallback(() => {
    if (providerKind === "SUB2API") {
      const rawOrigin = baseUrl.trim().replace(/\/+$/, "");
      let origin: URL;
      try {
        origin = new URL(rawOrigin);
      } catch {
        setModelError("Sub2API 须填写自己的公网 HTTPS 服务地址，仅填域名和可选端口。");
        return;
      }
      if (origin.protocol !== "https:" || !/^https:\/\/[^/?#]+$/.test(rawOrigin) ||
          rawOrigin.includes("\\") || rawOrigin.includes("%") || /\s/.test(rawOrigin) ||
          origin.username || origin.password || origin.pathname !== "/" ||
          origin.search || origin.hash) {
        setModelError("Sub2API 地址须为 HTTPS origin，不含路径、账号、查询参数或片段。");
        return;
      }
      if (apiKey.trim().length < 8) {
        setModelError("Sub2API 须填写至少 8 字符的业务 API Key。");
        return;
      }
      if (!models.TEXT.trim() || models.IMAGE.trim() ||
          models.VIDEO.trim() || models.SPEECH.trim()) {
        setModelError("Sub2API 首批只接受显式 TEXT 模型 ID，不接受图片、视频或配音模型。");
        return;
      }
    }
    const compiledModels = compileModels(models);
    if (compiledModels.length === 0) {
      setModelError("至少填写一个用于剧本、图片、视频或配音的模型 ID。");
      return;
    }
    setModelError(null);
    const input: CreateProviderConnectionInput = {
      provider_kind: providerKind,
      display_name: displayName.trim(),
      base_url: baseUrl.trim(),
      enabled: true,
      models: compiledModels,
      ...(apiKey.length > 0 ? { api_key: apiKey } : {}),
    };
    void onSubmit(input).then(
      () => setApiKey(""),
      () => undefined,
    );
  }, [apiKey, baseUrl, displayName, models, onSubmit, providerKind]);

  return {
    providerKind,
    displayName,
    baseUrl,
    apiKey,
    models,
    modelError,
    chooseProvider,
    setDisplayName,
    setBaseUrl,
    setApiKey,
    setModel,
    submit,
  };
}
