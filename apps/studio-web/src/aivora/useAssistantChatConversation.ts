import { useEffect, useRef, useState } from "react";
import type {
  AssistantChatBridge,
  AssistantChatPreviewResult,
  AssistantChatScope,
} from "@aijian/contracts/official-text";
import { assistantChatReferences, type AssistantSelectionPublication } from "./assistantSelection";

export type ChatMessage = { role: "user" | "assistant"; text: string };
type ActivePreview = Extract<AssistantChatPreviewResult, { kind: "READY" }> & {
  signature: string;
};
export type AssistantChatInputs = {
  bridge?: AssistantChatBridge;
  scope: AssistantChatScope;
  profileId: string | null;
  model: string;
  modelVerified: boolean;
  publication: AssistantSelectionPublication;
  included: boolean;
};

/** A renderer-only conversation. Main owns actual history and the exact outbound preview. */
export function useAssistantChatConversation(inputs: AssistantChatInputs) {
  const { bridge, scope, profileId, model, modelVerified, publication, included } = inputs;
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<ActivePreview | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [pendingState, setPendingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const sessionId = useRef(crypto.randomUUID());
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const discarded = useRef(new Set<string>());
  const previewRef = useRef<ActivePreview | null>(null);
  previewRef.current = preview;
  const references = assistantChatReferences(publication, included);
  const signature = JSON.stringify({
    scope,
    profileId,
    model,
    modelVerified,
    publication,
    included,
    text,
  });
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const conversationIdentity = JSON.stringify({
    profileId,
    projectId: scope.projectId,
    episodeId: scope.episodeId,
  });
  const currentConversationIdentity = useRef(conversationIdentity);
  currentConversationIdentity.current = conversationIdentity;
  const currentPage = useRef(scope.page);
  currentPage.current = scope.page;
  const previousConversationIdentity = useRef(conversationIdentity);
  const selectedModelReady = !!bridge && !!profileId && !!model && modelVerified;
  const blocked = pendingState !== "ready" || pendingIds.length > 0;
  const canPreview =
    selectedModelReady && !blocked && !busy && !!text.trim() && text.length <= 8000;

  function discard(id: string) {
    if (!bridge || discarded.current.has(id)) return;
    discarded.current.add(id);
    void bridge.discardPreview(id).catch(() => {
      /* The native preview has its own expiry and send validation. */
    });
  }
  useEffect(() => {
    const held = previewRef.current;
    if (held && held.signature !== signature) {
      discard(held.previewId);
      setPreview(null);
    }
    generation.current += 1;
  }, [signature]);
  useEffect(() => {
    if (previousConversationIdentity.current === conversationIdentity) return;
    previousConversationIdentity.current = conversationIdentity;
    sessionId.current = crypto.randomUUID();
    setMessages([]);
    setText("");
    setPreview(null);
    setPendingIds([]);
    setNotice("");
  }, [conversationIdentity]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      const held = previewRef.current;
      if (held) discard(held.previewId);
    };
  }, []);

  useEffect(() => {
    if (!bridge || !profileId || !modelVerified) {
      setPendingState("idle");
      return;
    }
    let active = true;
    setPendingState("loading");
    void bridge
      .listPending({ scope, expectedProfileId: profileId })
      .then((result) => {
        if (!active) return;
        if (result.kind === "OK") {
          setPendingIds((old) => [...new Set([...old, ...result.operationIds])]);
          setPendingState("ready");
        } else {
          setPendingState("error");
          setNotice(`无法核对待处理请求（${result.code}），暂不发送。`);
        }
      })
      .catch(() => {
        if (active) {
          setPendingState("error");
          setNotice("无法核对待处理请求，暂不发送。");
        }
      });
    return () => {
      active = false;
    };
  }, [bridge, profileId, modelVerified, scope.projectId, scope.episodeId, scope.page]);

  async function requestPreview() {
    if (!canPreview || busyRef.current || !bridge || !profileId) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current;
    const submittedSignature = signature;
    try {
      const result = await bridge.preview({
        sessionId: sessionId.current,
        scope,
        userText: text.trim(),
        model,
        expectedProfileId: profileId,
        references,
      });
      if (
        !mounted.current ||
        ticket !== generation.current ||
        submittedSignature !== currentSignature.current
      ) {
        if (result.kind === "READY") discard(result.previewId);
        return;
      }
      if (result.kind === "READY") setPreview({ ...result, signature: submittedSignature });
      else setNotice(`未生成发送预览（${result.code}）。请核对连接、模型和保存版本。`);
    } catch {
      if (mounted.current && ticket === generation.current)
        setNotice("发送预览结果不明，请核对后手动重试。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function sendPreview() {
    const held = previewRef.current;
    if (
      !held ||
      held.signature !== signature ||
      !bridge ||
      !profileId ||
      !selectedModelReady ||
      blocked ||
      busyRef.current
    )
      return;
    busyRef.current = true;
    setBusy(true);
    const sentConversation = conversationIdentity;
    const sentSession = sessionId.current;
    const submittedText = text.trim();
    try {
      const result = await bridge.send({
        previewId: held.previewId,
        operationId: held.operationId,
        inputHash: held.inputHash,
        expectedProfileId: profileId,
      });
      if (
        !mounted.current ||
        sentConversation !== currentConversationIdentity.current ||
        sentSession !== sessionId.current
      )
        return;
      setPreview(null);
      if (result.kind === "COMPLETED") {
        setMessages((old) => [
          ...old,
          { role: "user", text: submittedText },
          { role: "assistant", text: result.text },
        ]);
        if (held.signature === currentSignature.current) setText("");
        setNotice(
          held.signature === currentSignature.current
            ? "已收到建议；作品尚未修改。"
            : "已收到基于发送时旧上下文的建议；作品尚未修改。",
        );
      } else if (result.kind === "REMOTE_UNKNOWN") {
        setPendingIds((old) => [...new Set([...old, result.operationId])]);
        setNotice("发送结果待核对。请只读核对，暂不发起新请求。");
      } else setNotice(`请求未发送（${result.code}）。可重新预览后决定下一步。`);
    } catch {
      if (
        mounted.current &&
        sentConversation === currentConversationIdentity.current &&
        sentSession === sessionId.current
      ) {
        setPreview(null);
        setPendingIds((old) => [...new Set([...old, held.operationId])]);
        setNotice("发送结果未知。请只读核对，暂不发起新请求。");
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function inspectPending() {
    const operationId = pendingIds[0];
    if (!bridge || !profileId || !operationId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const inspectedConversation = conversationIdentity;
    const inspectedSession = sessionId.current;
    const inspectedPage = scope.page;
    try {
      const result = await bridge.getOperation({
        operationId,
        expectedProfileId: profileId,
        scope,
      });
      if (
        !mounted.current ||
        inspectedConversation !== currentConversationIdentity.current ||
        inspectedSession !== sessionId.current ||
        currentPage.current !== inspectedPage ||
        result.operationId !== operationId
      )
        return;
      if (result.kind === "COMPLETED") {
        setMessages((old) => [...old, { role: "assistant", text: result.text }]);
        setPendingIds((old) => old.filter((id) => id !== operationId));
        setNotice("已只读核对到回复；作品尚未修改。");
      } else if (result.kind === "NOT_SENT") {
        setPendingIds((old) => old.filter((id) => id !== operationId));
        setNotice(`已核对原请求未发送（${result.code}）。`);
      } else if (result.kind === "COMPLETED_UNAVAILABLE") {
        setNotice("原请求已完成，但回复正文在本次运行中不可恢复；请保留操作记录。");
      } else setNotice("原请求结果仍待核对，暂不发起新请求。");
    } catch {
      if (
        mounted.current &&
        inspectedConversation === currentConversationIdentity.current &&
        inspectedSession === sessionId.current &&
        currentPage.current === inspectedPage
      )
        setNotice("只读核对失败，仍阻止新请求。");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function startNewSession() {
    if (!bridge || !profileId || blocked || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const startingSession = sessionId.current;
    try {
      const result = await bridge.listPending({ scope, expectedProfileId: profileId });
      if (
        !mounted.current ||
        conversationIdentity !== currentConversationIdentity.current ||
        startingSession !== sessionId.current
      )
        return;
      if (result.kind !== "OK") {
        setPendingState("error");
        setNotice("无法核对原请求，新会话未开始。");
      } else if (result.operationIds.length) {
        setPendingIds((old) => [...new Set([...old, ...result.operationIds])]);
        setNotice("原请求仍待核对，新会话未开始。");
      } else {
        const held = previewRef.current;
        if (held) discard(held.previewId);
        sessionId.current = crypto.randomUUID();
        setPreview(null);
        setText("");
        setMessages([]);
        setNotice("已开始新的本地会话。此前可见消息已清空。 ");
      }
    } catch {
      if (
        mounted.current &&
        conversationIdentity === currentConversationIdentity.current &&
        startingSession === sessionId.current
      ) {
        setPendingState("error");
        setNotice("无法核对原请求，新会话未开始。");
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return {
    text,
    setText,
    messages,
    preview: preview?.signature === signature ? preview : null,
    pendingIds,
    pendingState,
    busy,
    notice,
    canPreview,
    selectedModelReady,
    requestPreview,
    sendPreview,
    inspectPending,
    startNewSession,
    canStartNewSession: !!bridge && !!profileId && !blocked && !busy,
  };
}
