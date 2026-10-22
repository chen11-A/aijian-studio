import { useEffect, useState } from "react";
import type { CreateProviderConnectionInput, ProviderConnectionData } from "../../api/studio";
import { Button } from "../Common";
import { useOfficialConnection } from "../chatgpt-auth/ChatGPTConnectionContext";
import { useGrokAccount } from "../grok-auth/GrokConnectionContext";
import { connectedAccountSlots } from "./account-connections";
import { useModelCenter } from "./CurrentModelLink";
import { openAivoraPage } from "./navigation";
import {
  choiceValue,
  parseChoiceValue,
  selectCenteredModel,
  type CenterChoice,
} from "./model-center";
import {
  DOCUMENTED_XAI_MODELS,
  XAI_API_ORIGIN,
  XAI_DOCS,
  checkXaiApiKey,
  openXaiSandboxSession,
  readXaiSession,
  writeXaiSession,
  xaiConnectionModels,
  type XaiSandboxSession,
} from "./xai-account";
import type { Capability } from "../../domain/provider-settings-model";
import "./surfaces.css";

const capabilities = [
  ["TEXT", "文本"],
  ["IMAGE", "图像"],
  ["VIDEO", "视频"],
  ["SPEECH", "配音"],
] as const;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function AccountModelCenter({
  connections = [],
  saving = false,
  onSaveXaiKey,
  onOpenChatGpt,
}: {
  connections?: readonly ProviderConnectionData[];
  saving?: boolean;
  onSaveXaiKey?: (input: CreateProviderConnectionInput) => Promise<void>;
  onOpenChatGpt?: () => void;
}) {
  const official = useOfficialConnection();
  const grok = useGrokAccount();
  const center = useModelCenter();
  const [session, setSession] = useState<XaiSandboxSession | null>(() => {
    const storage = browserStorage();
    return storage ? readXaiSession(storage) : null;
  });
  const [key, setKey] = useState("");
  const [notice, setNotice] = useState("");
  const xaiSaved = connections.some((connection) => connection.provider_kind === "XAI");
  const chatModels =
    official?.catalogProfileId && official.connection.models ? official.connection.models : [];
  const accounts = connectedAccountSlots({
    chatgpt: official?.connection.status,
    chatgptModels: chatModels,
    chatgptLoading: official?.connection.loading,
    grok: grok?.status,
    grokModels: grok?.models,
    grokLoading: grok?.loading,
    xai: session,
  });
  useEffect(() => {
    if (!grok || grok.loading || grok.busy || grok.status.runtime !== "DESKTOP") return;
    if (
      grok.status.state === "CONNECTED" ||
      grok.status.state === "ENTITLEMENT_DENIED" ||
      grok.status.state === "AWAITING_BROWSER"
    )
      return;
    for (const [capability] of capabilities) {
      if (center.choices[capability]?.provider === "GROK_LOGIN")
        selectCenteredModel(capability, null);
    }
  }, [center.choices, grok]);

  function optionsFor(capability: Capability): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    if (capability === "TEXT") {
      for (const model of grok?.models ?? []) {
        options.push({
          value: choiceValue({ provider: "GROK_LOGIN", modelId: model.id }),
          label: `${model.label} · Grok 账号`,
        });
      }
    }
    if (session) {
      for (const model of DOCUMENTED_XAI_MODELS) {
        if (model.capability === capability)
          options.push({
            value: choiceValue({ provider: "XAI_API", modelId: model.modelId }),
            label: `${model.label} · xAI 文档目录`,
          });
      }
    }
    if (capability === "TEXT") {
      for (const model of chatModels) {
        options.push({
          value: choiceValue({ provider: "CHATGPT_OFFICIAL", modelId: model.slug }),
          label: `${model.displayName} · ChatGPT 官方`,
        });
      }
    }
    for (const connection of connections) {
      for (const model of connection.models) {
        if (!model.capabilities.includes(capability)) continue;
        const choice: CenterChoice = {
          provider: "CONNECTION",
          connectionId: connection.id,
          modelId: model.model_id,
        };
        options.push({
          value: choiceValue(choice),
          label: `${connection.display_name} · ${model.model_id}`,
        });
      }
    }
    return options;
  }

  function shown(capability: Capability) {
    if (capability === "TEXT" && official?.requiresReselection) return "";
    const choice = center.choices[capability];
    return choice ? choiceValue(choice) : "";
  }

  function pick(capability: Capability, value: string) {
    if (!value) {
      selectCenteredModel(capability, null);
      if (capability === "TEXT") official?.clearDefaultModel();
      setNotice("已清空这一类的模型。其他页面会显示未选择。");
      return;
    }
    const choice = parseChoiceValue(value);
    if (!choice) return;
    if (choice.provider === "CHATGPT_OFFICIAL" && !official?.setDefaultModel(choice.modelId)) {
      setNotice("官方文本模型没有保存。请先读取当前 ChatGPT 账号的模型目录。");
      return;
    }
    if (!selectCenteredModel(capability, choice)) {
      setNotice("模型选择没有写入本机。");
      return;
    }
    setNotice("模型已在模型中心更新。其他页面只显示这个选择。");
  }

  function connectSandbox() {
    const storage = browserStorage();
    const opened = openXaiSandboxSession(key, new Date().toISOString());
    if (!opened.ok) {
      setNotice(opened.message);
      return;
    }
    if (!storage || !writeXaiSession(storage, opened.session)) {
      setNotice("本机无法保存沙箱会话。完整密钥没有被写入。");
      return;
    }
    setSession(opened.session);
    setKey("");
    setNotice("沙箱已连接。未访问 api.x.ai，未校验这把密钥是否真实有效。");
  }

  function disconnect() {
    const storage = browserStorage();
    if (storage) writeXaiSession(storage, null);
    setSession(null);
    for (const [capability] of capabilities) {
      if (center.choices[capability]?.provider === "XAI_API") selectCenteredModel(capability, null);
    }
    setNotice("已断开沙箱会话。凭据库中的 xAI 连接不会被删除。");
  }

  async function saveCredential() {
    if (!onSaveXaiKey) return;
    const checked = checkXaiApiKey(key);
    if (!checked.ok) {
      setNotice(checked.message);
      return;
    }
    if (xaiSaved) {
      setNotice("凭据库里已经有 xAI 连接。不会再创建一条，也不会读出明文密钥。");
      return;
    }
    try {
      await onSaveXaiKey({
        provider_kind: "XAI",
        display_name: "xAI",
        base_url: XAI_API_ORIGIN,
        enabled: true,
        api_key: key,
        models: xaiConnectionModels(),
      });
      setKey("");
      setNotice("已提交到本机凭据库。输入框已清空。这不是模型调用，也不是付款。");
    } catch {
      setNotice("凭据库没有确认保存。密钥仍只留在输入框，没有写入浏览器存储。");
    }
  }

  return (
    <div className="account-center" id="model-center" tabIndex={-1}>
      <section className="v2-utility-card" aria-label="模型中心">
        <h2>模型</h2>
        <p>全软件只在这里选择模型。创作页只显示当前选择。</p>
        <div className="account-model-grid">
          {capabilities.map(([capability, label]) => {
            const options = optionsFor(capability);
            return (
              <label key={capability}>
                {label}模型
                <select
                  aria-label={`${label}模型`}
                  value={
                    options.some((option) => option.value === shown(capability))
                      ? shown(capability)
                      : ""
                  }
                  disabled={options.length === 0}
                  onChange={(event) => pick(capability, event.target.value)}
                >
                  <option value="">
                    {capability === "TEXT" && official?.requiresReselection
                      ? "请重新选择模型"
                      : "未选择"}
                  </option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        {official?.preferenceError && (
          <p role="alert">官方模型偏好没有可靠读出。请重新读取 ChatGPT 账号后再选文本模型。</p>
        )}
      </section>

      <details className="account-advanced">
        <summary>控制台密钥（高级备用）</summary>
        <section className="v2-utility-card" aria-label="Grok 密钥备用">
          <p>
            订阅登录成功但推理返回 403 时，再用控制台 API Key。密钥不是 grok.com
            的网页密码。沙箱不会访问 api.x.ai。
          </p>
          <label>
            xAI 密钥
            <input
              id="xai-api-key"
              type="password"
              autoComplete="off"
              value={key}
              disabled={saving}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <div className="account-actions">
            <Button primary disabled={saving || key.length === 0} onClick={connectSandbox}>
              连接 API Key（沙箱）
            </Button>
            <Button onClick={() => openAivoraPage("generation")}>看看媒体沙箱（不产生费用）</Button>
            {onSaveXaiKey && (
              <Button disabled={saving || key.length === 0} onClick={() => void saveCredential()}>
                {saving ? "正在写入凭据库…" : "写入凭据库（不调用模型）"}
              </Button>
            )}
            {session && <Button onClick={disconnect}>断开沙箱</Button>}
          </div>
          <p>
            沙箱只检查密钥形状并记住末四位。它不访问 api.x.ai，不扣费，也不证明密钥有效。
            {xaiSaved ? " 凭据库里已有一条 xAI 连接。" : ""}
          </p>
        </section>
      </details>

      <section className="v2-utility-card" aria-label="已连接账号">
        <h2>已连接账号</h2>
        <p>只显示 ChatGPT 和 Grok 的连接、模型和额度。没有可购买的套餐。</p>
        <div className="account-pair">
          {accounts.map((account) => (
            <article key={account.provider} aria-label={`${account.title} 账号`}>
              <h3>{account.title}</h3>
              <span className="account-status">
                {account.method} · {account.state}
              </span>
              <p>{account.quota}</p>
              <p>{account.difference}</p>
              {account.models.length > 0 ? (
                <ul aria-label={`${account.title} 可用模型`}>
                  {account.models.map((model) => (
                    <li key={model.id}>
                      {model.label} <span>{model.id}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>当前没有可列入模型中心的模型。</p>
              )}
            </article>
          ))}
        </div>
        <div className="account-actions">
          {onOpenChatGpt && <Button onClick={onOpenChatGpt}>打开 ChatGPT 登录</Button>}
          <Button onClick={() => openAivoraPage("costs")}>查看作品用量</Button>
          <a href={XAI_DOCS.billing} target="_blank" rel="noreferrer">
            xAI 计费说明
          </a>
        </div>
      </section>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
