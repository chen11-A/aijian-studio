import { useLayoutEffect, useRef } from "react";
import type { AssistantChatBridge, AssistantChatScope } from "@aijian/contracts/official-text";
import type { AssistantSelectionPublication } from "./assistantSelection";
import { Button } from "./Common";
import { useAssistantChatConversation } from "./useAssistantChatConversation";
import "./assistant-chat.css";

export function AssistantChatConversation({
  bridge,
  scope,
  profileId,
  model,
  modelVerified,
  publication,
  included,
  setIncluded,
  onOpenServices,
  onOpenEditor,
}: {
  bridge?: AssistantChatBridge;
  scope: AssistantChatScope;
  profileId: string | null;
  model: string;
  modelVerified: boolean;
  publication: AssistantSelectionPublication;
  included: boolean;
  setIncluded: (included: boolean) => void;
  onOpenServices: () => void;
  onOpenEditor: () => void;
}) {
  const chat = useAssistantChatConversation({
    bridge,
    scope,
    profileId,
    model,
    modelVerified,
    publication,
    included,
  });
  const logRef = useRef<HTMLDivElement>(null);
  const lastAssistantCountRef = useRef(0);
  const readingHistoryRef = useRef(false);
  const autoScrollTopRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const assistantCount = chat.messages.filter((message) => message.role === "assistant").length;
    const isNewReply = assistantCount > lastAssistantCountRef.current;
    lastAssistantCountRef.current = assistantCount;
    if (assistantCount === 0) readingHistoryRef.current = false;
    if (!isNewReply || readingHistoryRef.current) return;
    const log = logRef.current;
    const last = log?.lastElementChild;
    if (!log || !(last instanceof HTMLElement) || !last.classList.contains("is-assistant")) return;
    const target =
      log.scrollTop + last.getBoundingClientRect().top - log.getBoundingClientRect().top;
    const max = Math.max(0, log.scrollHeight - log.clientHeight);
    const next = Math.min(max, Math.max(0, target));
    autoScrollTopRef.current = next;
    log.scrollTop = next;
  }, [chat.messages]);
  const hasReply = chat.messages.some((message) => message.role === "assistant");
  return (
    <section className="assistant-chat" aria-label="文字助手对话">
      <Button disabled={!chat.canStartNewSession} onClick={() => void chat.startNewSession()}>
        新会话
      </Button>
      <div
        ref={logRef}
        className="assistant-chat-messages"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const log = event.currentTarget;
          if (
            autoScrollTopRef.current !== null &&
            Math.abs(log.scrollTop - autoScrollTopRef.current) < 2
          ) {
            autoScrollTopRef.current = null;
            return;
          }
          autoScrollTopRef.current = null;
          readingHistoryRef.current = log.scrollTop + log.clientHeight < log.scrollHeight - 2;
        }}
      >
        {chat.messages.length ? (
          chat.messages.map((message, index) => (
            <article key={index} className={`assistant-chat-message is-${message.role}`}>
              <strong>{message.role === "user" ? "你" : "Aivora AI · 建议"}</strong>
              <p>{message.text}</p>
            </article>
          ))
        ) : (
          <p>可以询问写作、场次和镜头。</p>
        )}
      </div>
      <p>模型回复仅是建议，不会修改作品。</p>
      {hasReply && (
        <div className="assistant-chat-actions">
          <Button
            onClick={() => {
              const answer = [...chat.messages]
                .reverse()
                .find((message) => message.role === "assistant");
              if (answer) void navigator.clipboard?.writeText(answer.text).catch(() => undefined);
            }}
          >
            复制建议
          </Button>
          {scope.projectId && <Button onClick={onOpenEditor}>去作品编辑或审阅</Button>}
        </div>
      )}
      <div className="assistant-chat-context">
        <strong>当前内容</strong>
        {publication.kind === "AVAILABLE" ? (
          <>
            <p>
              {publication.selection.page} · {publication.selection.objectId} · 已保存版本{" "}
              {publication.selection.versionId}
            </p>
            <details>
              <summary>查看选中内容片段</summary>
              <pre>{publication.selection.excerpt}</pre>
              <p>此处仅帮助选择；最终发送正文以主进程预览为准。</p>
            </details>
            <label>
              <input
                type="checkbox"
                checked={included}
                onChange={(event) => setIncluded(event.target.checked)}
              />
              选中内容及必要的前后/关联资料（发送前预览）
            </label>
            {!included && <p>当前内容不随消息发送。</p>}
          </>
        ) : (
          <p>
            {publication.kind === "UNSAVED"
              ? "当前内容有未保存修改；请先保存，再选择引用。"
              : publication.kind === "UNAVAILABLE"
                ? "当前内容尚未可靠读取；请重新读取后再选择引用。"
                : publication.kind === "DIRECTOR_VIEW"
                  ? "正在查看导演提案；手写镜头内容未附带。"
                  : "当前没有可引用的已保存选中内容。"}
          </p>
        )}
      </div>
      {!chat.selectedModelReady && (
        <p role="status">
          请选择已核验的官方文字模型并确认桌面连接。{" "}
          <Button onClick={onOpenServices}>打开 AI 服务</Button>
        </p>
      )}
      {chat.pendingState === "loading" && <p role="status">正在核对未完成请求…</p>}
      {(chat.pendingIds.length > 0 || chat.pendingState === "error") && (
        <p role="alert">
          {chat.pendingIds.length > 0
            ? "原请求结果待核对；新消息暂不可发送。"
            : "无法核对原请求；新消息暂不可发送。"}
          {chat.pendingIds.length > 0 && (
            <Button disabled={chat.busy} onClick={() => void chat.inspectPending()}>
              只读核对结果
            </Button>
          )}
        </p>
      )}
      {chat.notice && <p role="status">{chat.notice}</p>}
      <label htmlFor="assistant-chat-input">给 AI 助手的消息</label>
      <textarea
        id="assistant-chat-input"
        aria-label="给 AI 助手的消息"
        maxLength={8000}
        value={chat.text}
        onChange={(event) => chat.setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.ctrlKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void chat.requestPreview();
          }
        }}
        placeholder="输入问题。Ctrl+Enter 预览，Enter 换行。"
      />
      <Button primary disabled={!chat.canPreview} onClick={() => void chat.requestPreview()}>
        {chat.busy ? "正在处理…" : "预览发送内容"}
      </Button>
      {chat.preview && (
        <section className="assistant-chat-preview" aria-label="实际发送预览">
          <h3>实际发送内容</h3>
          <pre>{chat.preview.outboundText}</pre>
          <p>包含来源：{chat.preview.includedSources.join("、") || "无作品引用"}</p>
          {chat.preview.historyOmitted > 0 && (
            <p>已省略 {chat.preview.historyOmitted} 条较早消息。</p>
          )}
          {chat.preview.contextTruncated && <p>上下文已按长度上限截断。</p>}
          <p>继续后仍需在桌面确认本次发送及费用。</p>
          <Button primary disabled={chat.busy} onClick={() => void chat.sendPreview()}>
            确认发送
          </Button>
        </section>
      )}
    </section>
  );
}
