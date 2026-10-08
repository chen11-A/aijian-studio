import { useState } from "react";
import { Button } from "../Common";
import { useChatGPTConnection } from "./useChatGPTConnection";
import type { ChatGPTBridge } from "./transport";
import { ChatGPTLoginPreparation } from "./ChatGPTLoginPreparation";
import "./chatgpt-connection.css";

export function ChatGPTConnectionCard({
  transport,
  onConnected,
  onUseApi,
}: {
  transport?: ChatGPTBridge;
  onConnected?: () => void;
  onUseApi?: () => void;
}) {
  const connection = useChatGPTConnection(transport, onConnected);
  const { status, loading, busy, notice, models } = connection;
  const [preparing, setPreparing] = useState(false);
  const [profileId, setProfileId] = useState<string | null | undefined>(undefined);
  const labels = {
    NOT_CONNECTED: "未连接",
    AWAITING_BROWSER: "等待浏览器授权",
    CONNECTED: "账号已连接 · 套餐已授权",
    IDENTITY_ONLY: "账号已连接 · 未授权套餐",
    REAUTH_REQUIRED: "需要重新授权",
  };
  function prepare(id?: string | null) {
    setProfileId(id);
    setPreparing(true);
  }
  return (
    <section className="v2-utility-card chatgpt-connection-card" aria-label="ChatGPT 官方登录">
      <header>
        <div>
          <h2>ChatGPT 官方登录</h2>
          <p>符合条件的 Plus / Pro 账号可授权文本能力使用套餐。</p>
        </div>
        <span className="chatgpt-status">{loading ? "读取中" : labels[status.state]}</span>
      </header>
      <p className="chatgpt-scope-note">
        适用于个人本机、开源项目和获准私有应用。商业或托管分发需先确认资格。
      </p>
      {loading && <p role="status">正在读取本机账号状态…</p>}
      {!loading && status.runtime === "DESKTOP_REQUIRED" && (
        <p role="status">请在 AIVORA 桌面应用中授权。网页预览保留 API 配置入口。</p>
      )}
      {!loading && status.secureStorage === "UNAVAILABLE" && (
        <p role="status">系统安全凭据库不可用，官方登录暂不可开始。</p>
      )}
      {notice && (
        <p className="chatgpt-notice" role="status">
          {notice}
        </p>
      )}
      {status.profiles.length > 0 && (
        <div className="chatgpt-profiles">
          {status.profiles.map((profile) => (
            <div key={profile.id}>
              <span>
                {profile.label} · {profile.email ?? "待完成身份验证"}
                {profile.id === status.activeProfileId ? " · 当前账号" : ""}
              </span>
              {profile.connected ? (
                <Button
                  disabled={busy || profile.id === status.activeProfileId}
                  onClick={() => void connection.select(profile.id)}
                >
                  使用此账号
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => prepare(profile.id)}>
                  完成此账号登录
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {!preparing && (
        <div className="chatgpt-actions">
          <Button
            primary
            disabled={
              loading ||
              busy ||
              status.runtime !== "DESKTOP" ||
              status.secureStorage !== "AVAILABLE"
            }
            onClick={() => prepare()}
          >
            Continue with ChatGPT
          </Button>
          {status.profiles.length > 0 && (
            <Button disabled={busy} onClick={() => prepare(null)}>
              添加账号
            </Button>
          )}
          {onUseApi && <Button onClick={onUseApi}>跳过，使用 API</Button>}
          <Button disabled={busy || loading} onClick={() => void connection.load()}>
            重新读取状态
          </Button>
        </div>
      )}
      {preparing && (
        <ChatGPTLoginPreparation
          status={status}
          busy={busy}
          onUseApi={onUseApi}
          onBegin={(scope) => {
            void connection.signIn(scope, profileId).then(() => setPreparing(false));
          }}
          onCancel={() => {
            if (busy) void connection.cancel();
            else setPreparing(false);
          }}
        />
      )}
      {status.state === "CONNECTED" && (
        <div className="chatgpt-models">
          <p>套餐权限已验证。模型与实际生成能力须分别核对，尚未验证真实推理。</p>
          <Button disabled={busy} onClick={() => void connection.readModels()}>
            读取此账号的可用模型
          </Button>
          {models.length > 0 && (
            <ul aria-label="当前账号可用模型">
              {models.map((model) => (
                <li key={model.slug}>
                  {model.displayName} <span>{model.slug}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <footer className="chatgpt-actions">
        <Button onClick={() => connection.help("documentation")}>官方接入说明</Button>
        <Button onClick={() => connection.help("eligibility")}>商业接入资格</Button>
        {status.profiles.length > 0 && (
          <>
            <Button onClick={() => connection.help("usage")}>管理 ChatGPT 用量</Button>
            <Button disabled={busy} onClick={() => void connection.signOut()}>
              退出当前账号
            </Button>
          </>
        )}
      </footer>
      <small>
        官方通道与 API / Sub2API 分开。图片、视频与配音仍需相应服务；此连接不读取 ChatGPT 历史对话。
      </small>
    </section>
  );
}
