import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatGPTActionResult } from "@aijian/contracts/chatgpt-auth";
import {
  chatGPTBridge,
  chatGPTErrorMessage,
  DESKTOP_REQUIRED,
  HELP_URLS,
  readChatGPTStatus,
  validStatus,
  type ChatGPTBridge,
  type ChatGPTModel,
  type ChatGPTStatus,
  type ChatGPTUseScope,
} from "./transport";

export function useChatGPTConnection(provided?: ChatGPTBridge, onConnected?: () => void) {
  const bridge = provided ?? chatGPTBridge();
  const [status, setStatus] = useState<ChatGPTStatus>(DESKTOP_REQUIRED);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const mounted = useRef(false);
  const generation = useRef(0);
  const operation = useRef(false);
  const signingIn = useRef(false);
  const connected = useRef(onConnected);
  connected.current = onConnected;
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await readChatGPTStatus(bridge);
      if (mounted.current && generation.current === current) {
        setStatus(value);
        setNotice(value.lastError ? chatGPTErrorMessage(value.lastError) : "");
      }
    } catch {
      if (mounted.current && generation.current === current)
        setNotice("无法读取官方账号状态，尚未确认连接。请重试。");
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [bridge]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      if (signingIn.current) void bridge?.cancel().catch(() => undefined);
    };
  }, [bridge, load]);
  async function action(
    run: (bridge: ChatGPTBridge) => Promise<ChatGPTActionResult>,
    login = false,
  ) {
    if (!bridge || operation.current) return;
    generation.current += 1;
    operation.current = true;
    signingIn.current = login;
    setBusy(true);
    setNotice("");
    setModels([]);
    try {
      const result = await run(bridge);
      if (!mounted.current) return;
      if (!validStatus(result.status)) throw new Error("invalid status");
      setStatus(result.status);
      setNotice(
        result.kind === "ERROR"
          ? chatGPTErrorMessage(result.code)
          : result.kind === "CANCELLED"
            ? "已取消登录。可以继续使用 API 连接。"
            : result.status.lastError
              ? chatGPTErrorMessage(result.status.lastError)
              : "",
      );
      if (login && result.kind === "OK" && result.status.state === "CONNECTED")
        connected.current?.();
    } catch {
      if (mounted.current) setNotice("结果尚未确认。请重新读取账号状态，避免重复授权。");
    } finally {
      operation.current = false;
      signingIn.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function readModels() {
    if (!bridge || operation.current) return;
    operation.current = true;
    setBusy(true);
    setModels([]);
    setNotice("");
    try {
      const result = await bridge.models();
      if (!mounted.current) return;
      if (result.kind === "ERROR") setNotice(chatGPTErrorMessage(result.code));
      else if (
        !Array.isArray(result.models) ||
        result.models.some(
          (model) => typeof model.slug !== "string" || typeof model.displayName !== "string",
        )
      )
        throw new Error("invalid models");
      else {
        setModels(result.models);
        setNotice(
          result.models.length
            ? "模型目录来自当前账号。尚未执行模型推理。"
            : "当前账号未返回可选模型。",
        );
      }
      const next = await readChatGPTStatus(bridge);
      if (mounted.current) setStatus(next);
    } catch {
      if (mounted.current) setNotice("模型目录尚未确认，请稍后重新读取。");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function help(topic: keyof typeof HELP_URLS) {
    if (bridge?.openHelp)
      void bridge.openHelp(topic).catch(() => setNotice("无法打开系统浏览器，请稍后重试。"));
    else window.open(HELP_URLS[topic], "_blank", "noopener,noreferrer");
  }
  return {
    status,
    loading,
    busy,
    notice,
    models,
    load,
    readModels,
    help,
    signIn: (scope: ChatGPTUseScope, profileId?: string | null) =>
      action((current) => current.signIn(scope, profileId), true),
    select: (id: string) => action((current) => current.selectProfile(id)),
    signOut: () => action((current) => current.signOut()),
    cancel: async () => {
      if (signingIn.current) await bridge?.cancel();
    },
  };
}
