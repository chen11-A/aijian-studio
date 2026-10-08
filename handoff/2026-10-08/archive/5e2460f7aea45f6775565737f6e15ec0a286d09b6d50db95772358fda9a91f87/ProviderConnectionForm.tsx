import type { CreateProviderConnectionInput } from "../api/studio";
import { providerPresets, type ProviderKind } from "../domain/provider-settings-model";
import { useProviderConnectionForm } from "../domain/use-provider-connection-form";

interface ProviderConnectionFormProps {
  busy: boolean;
  error: string | null;
  onSubmit(input: CreateProviderConnectionInput): Promise<void>;
}

export function ProviderConnectionForm({ busy, error, onSubmit }: ProviderConnectionFormProps) {
  const form = useProviderConnectionForm(onSubmit);
  const {
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
  } = form;
  const preset = providerPresets[providerKind];

  return (
    <form
      id="new-provider-connection"
      className="provider-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
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
            disabled={busy}
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
            disabled={busy}
          />
        </label>
        <label>
          <span>Base URL</span>
          <input
            value={baseUrl}
            type="url"
            maxLength={2048}
            required
            placeholder={providerKind === "SUB2API"
              ? "https://gateway.example.com"
              : "https://api.example.com/v1"}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      {providerKind === "SUB2API" &&
        <p>填写你自己的公网 HTTPS 服务 origin（域名和可选端口），不要添加 /v1 等路径；服务端会核验实际地址。</p>}

      <label className="secret-field">
        <span>
          {providerKind === "SUB2API" ? "业务 API Key" : "API Key"}
          <small>{preset.keyRequired ? "必填" : "本地服务可留空"}</small>
        </span>
        <input
          type="password"
          value={apiKey}
          minLength={preset.keyRequired ? 8 : undefined}
          required={preset.keyRequired}
          autoComplete="off"
          placeholder={preset.keyRequired ? "只写入系统凭据库，不会再次显示" : "可选"}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={busy}
        />
        <em>密钥不会写入项目数据库、日志或前端缓存。</em>
      </label>

      <fieldset className="model-fields" aria-describedby="provider-model-error">
        <legend>
          模型 ID <small>{providerKind === "SUB2API"
            ? "仅填写 TEXT 模型，多个请用逗号分隔"
            : "至少填写一类，多个请用逗号分隔"}</small>
        </legend>
        {(
          [
            ["TEXT", "剧本 / 提示词"],
            ["IMAGE", "角色 / 场景图片"],
            ["VIDEO", "镜头视频"],
            ["SPEECH", "配音"],
          ] as const
        ).filter(([capability]) => providerKind !== "SUB2API" || capability === "TEXT")
          .map(([capability, label]) => (
            <label key={capability}>
              <span>{label}</span>
              <input
                value={models[capability]}
                placeholder="输入供应商控制台中的模型 ID"
                onChange={(event) => setModel(capability, event.target.value)}
                disabled={busy}
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
