import { useEffect, useRef } from "react";
import { Button } from "./Common";
import "./first-run-service-choice.css";

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
          <h3>SuperGrok / X Premium+</h3>
          <p>
            用 SuperGrok / X Premium+ 账号登录。各档位都可以登录；若推理返回 403，点一次即可改用 API
            Key，不用反复登录。
          </p>
          <Button primary onClick={() => onSelect("grok")}>
            用 SuperGrok / X Premium+ 账号登录
          </Button>
        </section>
        <section>
          <h3>ChatGPT 官方账号</h3>
          <p>同样在浏览器里授权。文本模型仍只在模型中心选择。</p>
          <Button primary onClick={() => onSelect("chatgpt")}>
            使用 ChatGPT 官方账号
          </Button>
        </section>
      </div>
      <p>本地创建、编辑与保存作品不需要 AI 登录。API Key 只在订阅登录不可用时再使用。</p>
      <footer>
        <Button onClick={() => onSelect("api")}>使用 API Key（高级备用）</Button>
        <Button onClick={() => onSelect("offline")}>暂时离线创作</Button>
      </footer>
    </dialog>
  );
}
