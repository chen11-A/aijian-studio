import { useState } from "react";
import { Button } from "../Common";
import { useChatGPTConnection } from "./useChatGPTConnection";
import type { ChatGPTBridge } from "./transport";
import { ChatGPTLoginPreparation } from "./ChatGPTLoginPreparation";
import type { OfficialConnectionState } from "./ChatGPTConnectionContext";
import "./chatgpt-connection.css";

export function ChatGPTConnectionCard({
  transport,
  onConnected,
  onUseApi,
  onOpenProjects,
}: {
  transport?: ChatGPTBridge;
  onConnected?: () => void;
  onUseApi?: () => void;
  onOpenProjects?: () => void;
}) {
  const connection = useChatGPTConnection(transport, onConnected);
  return (
    <ChatGPTConnectionControls
      connection={connection}
      onUseApi={onUseApi}
      onOpenProjects={onOpenProjects}
    />
  );
}

/** Shares one account controller with the readiness view; never starts a second login lifecycle. */
export function ChatGPTConnectionControls({
  connection,
  selection,
  onUseApi,
  onOpenProjects,
}: {
  connection: ReturnType<typeof useChatGPTConnection>;
  selection?: OfficialConnectionState;
  onUseApi?: () => void;
  onOpenProjects?: () => void;
}) {
  const { status, loading, busy, notice, models, statusReadFailed } = connection;
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
        <span className="chatgpt-status">
          {loading || busy ? "核对中" : statusReadFailed ? "状态未确认" : labels[status.state]}
        </span>
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
      {status.state === "CONNECTED" && !statusReadFailed && !loading && (
        <div className="chatgpt-models">
          <p>套餐权限已验证。模型与实际生成能力须分别核对，尚未验证真实推理。</p>
          <Button
            disabled={busy}
            onClick={() => void (selection ? selection.readModels() : connection.readModels())}
          >
            读取此账号的可用模型
          </Button>
          {selection && (
            <>
              <label>
                默认官方文本模型
                <select
                  value={
                    !selection.requiresReselection &&
                    selection.catalogProfileId &&
                    selection.preference.defaultModel?.profileId === selection.catalogProfileId &&
                    models.some(
                      (item) => item.slug === selection.preference.defaultModel?.modelSlug,
                    )
                      ? selection.preference.defaultModel.modelSlug
                      : ""
                  }
                  disabled={busy || !selection.catalogProfileId || models.length === 0}
                  onChange={(event) => selection.setDefaultModel(event.target.value)}
                >
                  <option value="">
                    {selection.requiresReselection
                      ? "请重新选择模型"
                      : selection.catalogProfileId
                        ? "请选择模型"
                        : "先读取当前账号模型"}
                  </option>
                  {selection.catalogProfileId &&
                    models.map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.displayName}
                      </option>
                    ))}
                </select>
              </label>
              {selection.preference.defaultModel && !selection.catalogProfileId && (
                <p role="status">已保存的默认模型待当前账号目录重新核验，暂不能用于生成。</p>
              )}
              {selection.preference.defaultModel &&
                selection.catalogProfileId &&
                (selection.preference.defaultModel.profileId !== selection.catalogProfileId ||
                  !models.some(
                    (item) => item.slug === selection.preference.defaultModel?.modelSlug,
                  )) && <p role="status">已保存的默认模型与当前账号或目录不匹配，请重新选择。</p>}
              {selection.preferenceError && (
                <p role="alert">
                  {selection.preferenceIssue === "CONFLICT"
                    ? "其他窗口修改了模型偏好；当前选择已停用。请先重新读取偏好，再核对模型目录。"
                    : "模型偏好保存或读取失败，当前选择已停用。请检查本机存储后重试。"}
                </p>
              )}
              {selection.requiresReselection && (
                <p role="status">账号已切换或退出后重连，请重新选择模型确认。</p>
              )}
              {selection.preferenceError && (
                <Button onClick={selection.reloadPreference}>重新读取模型偏好</Button>
              )}
            </>
          )}
          {models.length > 0 && (
            <>
              <p>
                {selection
                  ? "以下目录仅证明当前账号返回了这些模型，尚未验证推理。"
                  : "以下为账号返回的只读目录，不是在此处选择生成模型。"}
              </p>
              <ul aria-label="当前账号可用模型（只读）">
                {models.map((model) => (
                  <li key={model.slug}>
                    {model.displayName} <span>{model.slug}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>
            {selection
              ? "这里选择文本默认模型；项目中可覆盖。生成前还需核对当前账号、模型和作品输入。"
              : "选择模型：进入项目并选择分集，在分镜页打开 AI 导演提案，读取模型后使用“官方模型”下拉框。生成前需准备并确认剧本和制作意图。"}
          </p>
          {onOpenProjects && (
            <Button disabled={busy} onClick={onOpenProjects}>
              {selection ? "前往项目准备生成" : "前往项目选择生成模型"}
            </Button>
          )}
          <p>
            当前软件仅接入此通道的文本生成，尚未接入图像生成工具、图片结果处理、视频或配音。ChatGPT
            套餐接入通道目前不支持图像生成工具；网页里的生图功能不等于此通道可以调用。
          </p>
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
