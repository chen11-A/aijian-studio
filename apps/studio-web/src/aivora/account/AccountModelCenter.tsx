import { useEffect, useState } from "react";
import type { CreateProviderConnectionInput, ProviderConnectionData } from "../../api/studio";
import { Button } from "../Common";
import { useOfficialConnection } from "../chatgpt-auth/ChatGPTConnectionContext";
import { useGrokAccount } from "../grok-auth/GrokConnectionContext";
import { connectedAccountSlots } from "./account-connections";
import { useModelCenter } from "./CurrentModelLink";
import { openAivoraPage, useApiKeyFallback } from "./navigation";
import { capabilitiesForListedModel } from "./model-capabilities";
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

import { Select } from "../Select";
const capabilities = [
  ["TEXT", "文本"],
  ["IMAGE", "图像"],
  ["VIDEO", "视频"],
  ["SPEECH", "配音"],
] as const;

function grokListingReason(
  capability: Capability,
  grok: ReturnType<typeof useGrokAccount>,
): string | null {
  if (capability === "TEXT" || !grok) return null;
  const state = grok.status.state;
  if (state !== "CONNECTED" && state !== "ENTITLEMENT_DENIED") return null;
  const notice = grok.notices.find((item) => item.capability === capability);
  if (!notice) return null;
  if (notice.reason === "denied") {
    if (capability === "IMAGE") return "当前 Grok 登录权限暂不支持图像生成";
    if (capability === "VIDEO") return "当前 Grok 登录权限暂不支持视频生成";
    return "当前 Grok 登录权限暂不支持配音";
  }
  if (notice.reason === "none" || notice.reason === "voices") {
    if (capability === "IMAGE") return "当前 Grok 登录没有返回图像模型";
    if (capability === "VIDEO") return "当前 Grok 登录没有返回视频模型";
    return "这个账号没有返回可用的配音声音。";
  }
  if (capability === "IMAGE") return "图像模型目录暂时读不到";
  if (capability === "VIDEO") return "视频模型目录暂时读不到";
  return "配音目录暂时读不到";
}

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
  onOpenGrok,
}: {
  connections?: readonly ProviderConnectionData[];
  saving?: boolean;
  onSaveXaiKey?: (input: CreateProviderConnectionInput) => Promise<void>;
  onOpenChatGpt?: () => void;
  onOpenGrok?: () => void;
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
    const push = (value: string, label: string) => {
      if (!options.some((option) => option.value === value)) options.push({ value, label });
    };
    for (const model of grok?.models ?? []) {
      if (!capabilitiesForListedModel(model).includes(capability)) continue;
      push(choiceValue({ provider: "GROK_LOGIN", modelId: model.id }), model.label);
    }
    if (session) {
      for (const model of DOCUMENTED_XAI_MODELS) {
        if (model.capability === capability)
          push(
            choiceValue({ provider: "XAI_API", modelId: model.modelId }),
            `${model.label} · xAI 文档目录`,
          );
      }
    }
    for (const model of chatModels) {
      if (!capabilitiesForListedModel({ id: model.slug }).includes(capability)) continue;
      push(
        choiceValue({ provider: "CHATGPT_OFFICIAL", modelId: model.slug }),
        `${model.displayName} · ChatGPT 官方`,
      );
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

  function gapFor(capability: Capability): { reason: string; action?: string; run?: () => void } {
    const label = capabilities.find(([key]) => key === capability)?.[1] ?? "这类";
    if (grok?.loading || official?.connection.loading)
      return { reason: "正在读取已连接账号的模型。" };
    const names: string[] = [];
    const grokState = grok?.status.state;
    if (grokState === "CONNECTED" || grokState === "ENTITLEMENT_DENIED") names.push("Grok 账号");
    if (official?.catalogProfileId && official.connection.status.state === "CONNECTED")
      names.push("ChatGPT 账号");
    if (session) names.push("xAI 密钥");
    if (connections.some((connection) => connection.models.length > 0)) names.push("已保存的连接");
    if (names.length === 0) {
      return capability === "TEXT"
        ? {
            reason: "还没有连接能提供文本模型的账号。",
            action: "用 Grok 账号登录",
            run: () => {
              onOpenGrok?.();
              openAivoraPage("services");
            },
          }
        : {
            reason: `还没有连接能提供${label}模型的账号。`,
            action: "连接密钥",
            run: () => useApiKeyFallback(),
          };
    }
    const grokReason = grokListingReason(capability, grok);
    return {
      reason: grokReason ?? `${names.join("、")}暂不提供${label}模型`,
      action: "连接密钥",
      run: () => useApiKeyFallback(),
    };
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
      setNotice("本机无法保存试用会话。完整密钥没有被写入。");
      return;
    }
    setSession(opened.session);
    setKey("");
    setNotice("备用密钥已记下末四位。未访问 api.x.ai，也还没有确认这把密钥是否有效。");
  }

  function disconnect() {
    const storage = browserStorage();
    if (storage) writeXaiSession(storage, null);
    setSession(null);
    for (const [capability] of capabilities) {
      if (center.choices[capability]?.provider === "XAI_API") selectCenteredModel(capability, null);
    }
    setNotice("已断开备用密钥。本机保存的连接不会被删除。");
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
            if (options.length === 0) {
              const gap = gapFor(capability);
              return (
                <div key={capability} className="model-gap" data-model-gap={capability}>
                  <span>{label}模型</span>
                  <p data-model-reason>{gap.reason}</p>
                  {gap.action && gap.run && <Button onClick={gap.run}>{gap.action}</Button>}
                </div>
              );
            }
            return (
              <label key={capability}>
                {label}模型
                <Select
                  aria-label={`${label}模型`}
                  value={
                    options.some((option) => option.value === shown(capability))
                      ? shown(capability)
                      : ""
                  }
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
                </Select>
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
            登录成功但还不能生成时，可以改用控制台密钥。这不是 grok.com
            的网页密码。登记密钥不会访问网络，也不会扣费。
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
              登记备用密钥
            </Button>
            {onSaveXaiKey && (
              <Button disabled={saving || key.length === 0} onClick={() => void saveCredential()}>
                {saving ? "正在保存…" : "写入凭据库（不调用模型）"}
              </Button>
            )}
            {session && <Button onClick={disconnect}>取消登记</Button>}
          </div>
          {key.length === 0 && <p>先填写密钥，再保存到本机。这一步不会调用模型。</p>}
          <p>
            这里只检查密钥格式并记住末四位。不会访问网络，不会扣费，也不能证明密钥有效。
            {xaiSaved ? " 本机已经保存过一条密钥连接。" : ""}
          </p>
        </section>
      </details>

      <section className="v2-utility-card" aria-label="已连接账号">
        <h2>已连接账号</h2>
        <p>这里只显示已经登录的账号。模型在上面选择。</p>
        <div className="account-pair">
          {accounts.map((account) => (
            <article key={account.provider} aria-label={`${account.title} 账号`}>
              <h3>{account.title}</h3>
              <span className="account-status">
                {account.method} · {account.state}
              </span>
              <p>{account.quota}</p>
              <p>{account.difference}</p>
              <p>
                {account.models.length > 0
                  ? `已准备 ${account.models.length} 个可选项，请在上方选择。`
                  : "当前没有可选项。"}
              </p>
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
      <div className="model-notice-slot">
        {notice ? <p role="status">{notice}</p> : <p aria-hidden="true"> </p>}
      </div>
    </div>
  );
}
