import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateProviderConnectionInput,
  ProviderConnectionListResponse,
  StudioTransport,
} from "../../api/studio";
import { ProviderConnectionForm } from "./ProviderConnectionForm";
import { capabilityLabels, providerPresets } from "./provider-settings-model";
import "./provider-settings.css";

type SettingsState =
  | { kind: "loading" }
  | { kind: "ready"; response: ProviderConnectionListResponse }
  | { kind: "error" };

interface ProviderSettingsWorkspaceProps {
  listConnections: StudioTransport["listProviderConnections"];
  createConnection: StudioTransport["createProviderConnection"];
  deleteConnection: StudioTransport["deleteProviderConnection"];
}

export function ProviderSettingsWorkspace(props: ProviderSettingsWorkspaceProps) {
  const { listConnections, createConnection, deleteConnection } = props;
  const [state, setState] = useState<SettingsState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setState({ kind: "loading" });
    try {
      const response = await listConnections();
      if (requestSequence.current === requestId) {
        setState({ kind: "ready", response });
      }
    } catch {
      if (requestSequence.current === requestId) {
        setState({ kind: "error" });
      }
    }
  }, [listConnections]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const create = async (input: CreateProviderConnectionInput) => {
    setSaving(true);
    setSaveError(null);
    try {
      await createConnection(input);
      await load();
    } catch (error) {
      await load();
      const cleanupRequired =
        error instanceof Error && error.message.includes("CREDENTIAL_CLEANUP_REQUIRED");
      setSaveError(
        cleanupRequired
          ? "系统凭据可能需要清理。已显示本次保留的连接，请确认连接 ID 后移除。"
          : "连接未保存。已重新读取配置，请检查名称、地址和系统凭据库后重试。",
      );
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (connectionId: string) => {
    try {
      await deleteConnection(connectionId);
      setConfirmingId(null);
      await load();
    } catch {
      setSaveError("无法移除连接；原配置未被界面隐藏。");
    }
  };

  return (
    <section className="provider-settings" aria-labelledby="provider-settings-title">
      <header className="settings-hero">
        <div>
          <span className="settings-kicker">MODEL INFRASTRUCTURE</span>
          <h2 id="provider-settings-title">统一模型连接</h2>
          <p>集中管理文本、图片、视频与配音模型；项目只引用连接 ID，不接触密钥。</p>
        </div>
        <div className="settings-security-badge">
          <span aria-hidden="true">◆</span>
          <div>
            <strong>系统凭据库</strong>
            <small>密钥单向写入</small>
          </div>
        </div>
      </header>

      <aside className="membership-notice">
        <strong>会员与 API 是两套账户体系</strong>
        <p>
          ChatGPT Plus/Pro 和 Grok 会员通常不等于开发者 API
          额度。这里填写的是供应商开发者控制台签发的 API Key。
        </p>
      </aside>

      <div className="settings-grid">
        <section className="connections-panel" aria-labelledby="connections-title">
          <header>
            <div>
              <span className="settings-kicker">CONNECTIONS</span>
              <h3 id="connections-title">已配置连接</h3>
            </div>
            <a className="mobile-add-connection" href="#new-provider-connection">
              新增连接 ↓
            </a>
            {state.kind === "ready" && <b>{state.response.data.length}</b>}
          </header>
          {state.kind === "loading" && (
            <div className="settings-state" role="status">
              正在读取安全配置…
            </div>
          )}
          {state.kind === "error" && (
            <div className="settings-state error" role="alert">
              <strong>配置读取失败</strong>
              <button onClick={() => void load()}>重新读取</button>
            </div>
          )}
          {state.kind === "ready" && state.response.data.length === 0 && (
            <div className="settings-empty">
              <span aria-hidden="true">＋</span>
              <strong>还没有模型连接</strong>
              <p>从右侧选择 OpenAI、xAI、兼容接口或本地 Ollama。</p>
            </div>
          )}
          {state.kind === "ready" &&
            state.response.data.map((connection) => (
              <article className="connection-card" key={connection.id}>
                <header>
                  <div className="provider-monogram">
                    {providerPresets[connection.provider_kind].label.slice(0, 2)}
                  </div>
                  <div>
                    <strong>{connection.display_name}</strong>
                    <span>{providerPresets[connection.provider_kind].label}</span>
                  </div>
                  <i className={`credential-${connection.credential_status.toLowerCase()}`}>
                    {connection.credential_status === "CONFIGURED"
                      ? "密钥已配置"
                      : connection.credential_status === "UNAVAILABLE"
                        ? "凭据库不可用"
                        : "无需密钥 / 未配置"}
                  </i>
                </header>
                <code>{connection.base_url}</code>
                <div className="connection-models">
                  {connection.models.length === 0 ? (
                    <span>尚未登记模型 ID</span>
                  ) : (
                    connection.models.map((model) => (
                      <span key={model.model_id}>
                        <strong>{model.model_id}</strong>
                        <small>
                          {model.capabilities.map((item) => capabilityLabels[item]).join(" · ")}
                        </small>
                      </span>
                    ))
                  )}
                </div>
                <footer>
                  {confirmingId === connection.id ? (
                    <div className="remove-confirm" role="alert">
                      <span>同时移除系统凭据？</span>
                      <button onClick={() => void remove(connection.id)}>确认移除</button>
                      <button onClick={() => setConfirmingId(null)}>取消</button>
                    </div>
                  ) : (
                    <button className="remove-link" onClick={() => setConfirmingId(connection.id)}>
                      移除连接
                    </button>
                  )}
                </footer>
              </article>
            ))}
        </section>
        <ProviderConnectionForm busy={saving} error={saveError} onSubmit={create} />
      </div>
    </section>
  );
}
