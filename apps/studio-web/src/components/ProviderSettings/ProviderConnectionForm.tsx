import { useState, type FormEvent } from "react";

import type { CreateProviderConnectionInput } from "../../api/studio";
import {
  compileModels,
  providerPresets,
  type Capability,
  type ProviderKind,
} from "./provider-settings-model";

interface ProviderConnectionFormProps {
  busy: boolean;
  error: string | null;
  onSubmit(input: CreateProviderConnectionInput): Promise<void>;
}

const emptyModels: Record<Capability, string> = { TEXT: "", IMAGE: "", VIDEO: "", SPEECH: "" };

export function ProviderConnectionForm({ busy, error, onSubmit }: ProviderConnectionFormProps) {
  const [providerKind, setProviderKind] = useState<ProviderKind>("OPENAI");
  const [displayName, setDisplayName] = useState("OpenAI 主连接");
  const [baseUrl, setBaseUrl] = useState(providerPresets.OPENAI.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(emptyModels);
  const [modelError, setModelError] = useState<string | null>(null);
  const preset = providerPresets[providerKind];

  const chooseProvider = (nextKind: ProviderKind) => {
    setProviderKind(nextKind);
    const next = providerPresets[nextKind];
    setDisplayName(next.label);
    setBaseUrl(next.baseUrl);
    setApiKey("");
    setModels(emptyModels);
    setModelError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
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
  };

  return (
    <form id="new-provider-connection" className="provider-form" onSubmit={submit}>
      <header>
        <span className="settings-kicker">NEW CONNECTION</span>
        <h3>添加模型供应商</h3>
        <p>先连接供应商，再把不同制作步骤分配给具体模型。</p>
      </header>

      <fieldset className="provider-picker">
        <legend>供应商类型</legend>
        {Object.entries(providerPresets).map(([kind, item]) => (
          <button
            type="button"
            key={kind}
            className={providerKind === kind ? "selected" : ""}
            aria-pressed={providerKind === kind}
            onClick={() => chooseProvider(kind as ProviderKind)}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </fieldset>

      <div className="provider-fields two-column">
        <label>
          <span>连接名称</span>
          <input
            value={displayName}
            maxLength={80}
            required
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label>
          <span>Base URL</span>
          <input
            value={baseUrl}
            type="url"
            maxLength={2048}
            required
            placeholder="https://api.example.com/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      </div>

      <label className="secret-field">
        <span>
          API Key <small>{preset.keyRequired ? "必填" : "本地服务可留空"}</small>
        </span>
        <input
          type="password"
          value={apiKey}
          minLength={preset.keyRequired ? 8 : undefined}
          required={preset.keyRequired}
          autoComplete="off"
          placeholder={preset.keyRequired ? "只写入系统凭据库，不会再次显示" : "可选"}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <em>密钥不会写入项目数据库、日志或前端缓存。</em>
      </label>

      <fieldset className="model-fields" aria-describedby="provider-model-error">
        <legend>
          模型 ID <small>至少填写一类，多个请用逗号分隔</small>
        </legend>
        {(
          [
            ["TEXT", "剧本 / 提示词"],
            ["IMAGE", "角色 / 场景图片"],
            ["VIDEO", "镜头视频"],
            ["SPEECH", "配音"],
          ] as const
        ).map(([capability, label]) => (
          <label key={capability}>
            <span>{label}</span>
            <input
              value={models[capability]}
              placeholder="输入供应商控制台中的模型 ID"
              onChange={(event) =>
                setModels((current) => ({ ...current, [capability]: event.target.value }))
              }
            />
          </label>
        ))}
      </fieldset>

      {modelError && (
        <p className="provider-form-error" id="provider-model-error" role="alert">
          {modelError}
        </p>
      )}

      {error && (
        <p className="provider-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="provider-save" type="submit" disabled={busy}>
        {busy ? "正在安全保存…" : "保存连接"}
      </button>
    </form>
  );
}
