import { useEffect, useRef } from "react";
import { Button } from "./Common";
import {
  GrokSignInButton,
  WelcomeBrand,
  WelcomeFinePrint,
  welcomeStatusTone,
} from "./WelcomeSignIn";
import "./welcome-sign-in.css";

export type FirstRunServiceChoiceKind = "grok" | "chatgpt" | "api" | "offline";
const choiceKey = "aivora.service-onboarding.v1";

/** A UI preference only. It must never be used as proof of authorization. */
export function hasServiceEntryChoice(): boolean {
  try {
    const choice = window.localStorage.getItem(choiceKey);
    return choice === "grok" || choice === "api" || choice === "offline" || choice === "chatgpt";
  } catch {
    return false;
  }
}

export function rememberServiceEntryChoice(choice: FirstRunServiceChoiceKind): boolean {
  try {
    window.localStorage.setItem(choiceKey, choice);
    return true;
  } catch {
    return false;
  }
}

export function FirstRunServiceChoice({
  onSelect,
  onClose,
  onGrokLogin,
  grokBusy = false,
  notice,
}: {
  onSelect(choice: FirstRunServiceChoiceKind): void;
  onClose(): void;
  onGrokLogin?(): void;
  grokBusy?: boolean;
  notice?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const tone = welcomeStatusTone(
    notice ?? "",
    grokBusy ? "waiting" : notice ? "signed-out" : "unknown",
  );
  return (
    <dialog
      ref={dialog}
      className="first-run-service-choice"
      aria-labelledby="first-service-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="welcome-sign-in">
        <div className="welcome-dialog-tools">
          <Button onClick={onClose} aria-label="关闭连接方式选择">
            关闭
          </Button>
        </div>
        <WelcomeBrand />
        <h2 id="first-service-title" className="welcome-title">
          把故事，变成看得见的世界。
        </h2>
        {notice && (
          <p className={`welcome-status ${tone}`} role="status">
            {notice}
          </p>
        )}
        <div className="welcome-actions">
          <GrokSignInButton
            disabled={grokBusy}
            onClick={() => {
              if (onGrokLogin) onGrokLogin();
              else onSelect("grok");
            }}
          />
          <Button disabled={grokBusy} onClick={() => onSelect("chatgpt")}>
            使用 ChatGPT 账号
          </Button>
        </div>
        <div className="welcome-links">
          <button type="button" onClick={() => onSelect("api")}>
            使用 API Key
          </button>
          <button type="button" onClick={() => onSelect("offline")}>
            暂时离线创作
          </button>
        </div>
        <WelcomeFinePrint />
      </div>
    </dialog>
  );
}
