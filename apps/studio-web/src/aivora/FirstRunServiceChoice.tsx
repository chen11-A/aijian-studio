import { useEffect, useRef } from "react";
import { Button } from "./Common";
import "./first-run-service-choice.css";

export type FirstRunServiceChoiceKind = "chatgpt" | "api" | "offline";
const choiceKey = "aivora.service-onboarding.v1";

/** A UI preference only. It must never be used as proof of authorization. */
export function hasServiceEntryChoice(): boolean {
  try {
    const choice = window.localStorage.getItem(choiceKey);
    return choice === "api" || choice === "offline" || choice === "chatgpt";
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
  notice,
}: {
  onSelect(choice: FirstRunServiceChoiceKind): void;
  onClose(): void;
  notice?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
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
      <header>
        <h2 id="first-service-title">连接 AI</h2>
        <Button onClick={onClose} aria-label="关闭连接方式选择">
          关闭
        </Button>
      </header>
      <p>无需注册 AIVORA 账号。连接和模型都在「AI 服务」里完成，之后可以更改。</p>
      {notice && <p role="status">{notice}</p>}
      <div className="first-run-service-options">
        <section>
          <h3>连接 Grok</h3>
          <p>官方没有与 ChatGPT 相同的订阅登录。用控制台 API Key 连接，不能使用 Grok 订阅额度。</p>
          <Button primary onClick={() => onSelect("api")}>
            连接 Grok（API Key）
          </Button>
        </section>
        <section>
          <h3>ChatGPT 官方账号</h3>
          <p>可选。浏览器授权后，文本模型仍只在模型中心选择。</p>
          <Button onClick={() => onSelect("chatgpt")}>使用 ChatGPT 官方账号</Button>
        </section>
      </div>
      <footer>
        <span>本地创建、编辑与保存作品不需要 AI 登录。</span>
        <Button onClick={() => onSelect("offline")}>暂时离线创作</Button>
      </footer>
    </dialog>
  );
}
