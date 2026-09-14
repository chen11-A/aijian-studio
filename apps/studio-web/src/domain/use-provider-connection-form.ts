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
    setModels((current) => ({ ...current, [capability]: value }));
  }, []);

  const submit = useCallback(() => {
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
