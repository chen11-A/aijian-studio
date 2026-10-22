import type { ReactNode } from "react";
import { Button } from "./Common";
import { Logo } from "./Icon";

export type WelcomePhase = "unknown" | "signed-out" | "waiting" | "signed-in";

/** Visual grouping only. It does not decide whether a login succeeded. */
export function welcomeStatusTone(text: string, phase: WelcomePhase): string {
  if (!text) return "";
  if (phase === "waiting") return "is-waiting";
  if (text.includes("403")) return "is-denied";
  if (phase === "signed-in") return "is-ok";
  return "is-error";
}

export function WelcomeBrand() {
  return (
    <div className="welcome-brand">
      <Logo />
      <strong>AIVORA</strong>
    </div>
  );
}

export function GrokSignInButton({ disabled, onClick }: { disabled?: boolean; onClick(): void }) {
  return (
    <Button primary disabled={disabled} onClick={onClick}>
      用 Grok 账号登录
    </Button>
  );
}

export function WelcomeFinePrint({ children }: { children?: ReactNode }) {
  return (
    <>
      <p className="welcome-fine">在系统浏览器里点同意即可。登录信息只保存在这台电脑上。</p>
      <details className="welcome-more">
        <summary>了解更多</summary>
        <p>
          点一次「用 Grok 账号登录」，系统浏览器会打开 xAI
          授权页。点同意后自动回到这里，并显示已登录和可用模型。不用复制代码，也不用输入密码或密钥。SuperGrok
          / X Premium+ 都可以登录。若推理返回 403，点「改用 API Key（高级备用）」填写密钥。ChatGPT
          账号同样在浏览器里授权。本地创作不需要登录。
        </p>
        {children}
      </details>
    </>
  );
}
