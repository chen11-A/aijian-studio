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
        <h2 id="first-service-title">选择 AI 连接方式</h2>
        <Button onClick={onClose} aria-label="关闭连接方式选择">
          关闭
        </Button>
      </header>
      <p>无需注册 AIVORA 账号。选择适合你的方式，之后可随时在“AI 服务”中更改。</p>
      {notice && <p role="status">{notice}</p>}
      <div className="first-run-service-options">
        <section>
          <h3>ChatGPT 官方账号</h3>
          <p>查看适用条件后，通过 OpenAI 官方浏览器授权。套餐权限以实际授权结果为准。</p>
          <Button primary onClick={() => onSelect("chatgpt")}>
            继续到官方授权
          </Button>
        </section>
        <section>
          <h3>已有 API / Sub2API</h3>
          <p>直接使用自己的模型 API 或 Sub2API 服务，无需登录 ChatGPT。</p>
          <Button onClick={() => onSelect("api")}>跳过 ChatGPT，配置 API</Button>
        </section>
      </div>
      <footer>
        <span>本地创建、编辑与保存作品不需要 AI 登录。</span>
        <Button onClick={() => onSelect("offline")}>暂时离线创作</Button>
      </footer>
    </dialog>
  );
}
