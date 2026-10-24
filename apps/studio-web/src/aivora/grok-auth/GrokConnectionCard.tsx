import { Button } from "../Common";
import { useApiKeyFallback } from "../account/navigation";
import { useGrokAccount } from "./GrokConnectionContext";

export function GrokConnectionCard() {
  const connection = useGrokAccount();
  const status = connection?.status;
  const desktop = status?.runtime === "DESKTOP";
  const signedIn = status?.state === "CONNECTED" || status?.state === "ENTITLEMENT_DENIED";
  const model = connection?.models[0];
  return (
    <section className="v2-utility-card" aria-label="Grok 账号登录">
      <h2>用 Grok 账号登录</h2>
      <p>
        {connection?.loading
          ? "正在读取登录状态。"
          : connection?.busy
            ? "正在等待浏览器授权。同意后会自动回到这里。"
            : !desktop
              ? "需要桌面应用。网页预览不能打开授权页，也不能保存令牌。"
              : status?.state === "CONNECTED"
                ? `已登录${status.accountLabel ? ` · ${status.accountLabel}` : ""}。关闭软件再打开不用重新登录。`
                : status?.state === "ENTITLEMENT_DENIED"
                  ? `已登录${status.accountLabel ? ` · ${status.accountLabel}` : ""}，但当前订阅还不能生成。`
                  : status?.state === "AWAITING_BROWSER"
                    ? "正在等待浏览器授权。同意后会自动回到这里。"
                    : status?.state === "REAUTH_REQUIRED"
                      ? "需要重新登录。"
                      : "尚未登录。"}
      </p>
      {connection?.notice && (
        <p className="chatgpt-notice" role="status">
          {connection.notice}
        </p>
      )}
      <div className="account-actions">
        {signedIn ? (
          <span className="account-status" role="status" aria-label="已登录">
            已登录
          </span>
        ) : (
          <Button
            primary
            disabled={!connection || !desktop || connection.busy || connection.loading}
            onClick={() => void connection?.signIn()}
          >
            用 Grok 账号登录
          </Button>
        )}
        <Button
          disabled={!connection || !desktop || connection.busy || !model}
          onClick={() => void connection?.checkInference(model!.id)}
        >
          测试一下能不能用
        </Button>
        <Button
          disabled={!connection || !desktop || connection.busy || !signedIn}
          onClick={() => void connection?.signOut()}
        >
          退出 Grok 登录
        </Button>
        <Button onClick={() => useApiKeyFallback()}>改用密钥（高级备用）</Button>
      </div>
      <details className="connection-more">
        <summary>登录说明</summary>
        <p>
          点一次上面的按钮。系统浏览器打开 xAI
          授权页，点同意后自动回到这里，并列出这个账号能用的模型。不用复制代码，也不用输入密码或密钥。登录本身不会发起推理。
        </p>
        <p>
          有的订阅可以登录，但还不能生成。出现这个结果时，点「改用密钥（高级备用）」，不要反复登录。
        </p>
      </details>
    </section>
  );
}
