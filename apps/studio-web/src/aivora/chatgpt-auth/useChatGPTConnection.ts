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

function connectedProfileId(status: ChatGPTStatus): string | null {
  if (
    status.runtime !== "DESKTOP" ||
    status.secureStorage !== "AVAILABLE" ||
    status.state !== "CONNECTED" ||
    !status.activeProfileId
  )
    return null;
  const active = status.profiles.find((profile) => profile.id === status.activeProfileId);
  return active?.connected && active.planUsage ? active.id : null;
}

export function useChatGPTConnection(provided?: ChatGPTBridge, onConnected?: () => void) {
  const bridge = provided ?? chatGPTBridge();
  const [status, setStatus] = useState<ChatGPTStatus>(DESKTOP_REQUIRED);
  const [loading, setLoading] = useState(true);
  const [statusReadFailed, setStatusReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [modelsProfileId, setModelsProfileId] = useState<string | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const statusReading = useRef(false);
  const operation = useRef(false);
  const signingIn = useRef(false);
  const connected = useRef(onConnected);
  connected.current = onConnected;
  const load = useCallback(async () => {
    if (operation.current) return;
    const current = ++generation.current;
    statusReading.current = true;
    setLoading(true);
    setModels([]);
    setModelsProfileId(null);
    try {
      const value = await readChatGPTStatus(bridge);
      if (mounted.current && generation.current === current) {
        setStatus(value);
        setStatusReadFailed(false);
        setNotice(value.lastError ? chatGPTErrorMessage(value.lastError) : "");
      }
    } catch {
      if (mounted.current && generation.current === current) {
        setStatusReadFailed(true);
        setNotice("无法读取官方账号状态，尚未确认连接。请重试。");
      }
    } finally {
      if (generation.current === current) {
        statusReading.current = false;
        if (mounted.current) setLoading(false);
      }
    }
  }, [bridge]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      statusReading.current = false;
      const cancelSignIn = signingIn.current;
      signingIn.current = false;
      operation.current = false;
      if (cancelSignIn) void bridge?.cancel().catch(() => undefined);
    };
  }, [bridge, load]);
  async function action(
    run: (bridge: ChatGPTBridge) => Promise<ChatGPTActionResult>,
    login = false,
  ) {
    if (!bridge || operation.current) return;
    const current = ++generation.current;
    statusReading.current = false;
    operation.current = true;
    signingIn.current = login;
    setBusy(true);
    setLoading(false);
    setNotice("");
    setModels([]);
    setModelsProfileId(null);
    try {
      const result = await run(bridge);
      if (!mounted.current || generation.current !== current) return;
      if (!validStatus(result.status)) throw new Error("invalid status");
      setStatus(result.status);
      setStatusReadFailed(result.kind !== "OK");
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
      if (mounted.current && generation.current === current) {
        setStatusReadFailed(true);
        setNotice("结果尚未确认。请重新读取账号状态，避免重复授权。");
      }
    } finally {
      if (generation.current === current) {
        operation.current = false;
        signingIn.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function readModels() {
    const expectedProfileId = connectedProfileId(status);
    if (!bridge || operation.current || statusReading.current || loading || !expectedProfileId)
      return;
    const current = ++generation.current;
    operation.current = true;
    setBusy(true);
    setModels([]);
    setModelsProfileId(null);
    setNotice("");
    try {
      const before = await readChatGPTStatus(bridge);
      if (!mounted.current || generation.current !== current) return;
      if (connectedProfileId(before) !== expectedProfileId) {
        setStatus(before);
        setStatusReadFailed(true);
        setNotice("账号状态已变化，请重新读取后再查看模型目录。");
        return;
      }
      const result = await bridge.models();
      if (!mounted.current || generation.current !== current) return;
      const after = await readChatGPTStatus(bridge);
      if (!mounted.current || generation.current !== current) return;
      setStatus(after);
      if (connectedProfileId(after) !== expectedProfileId) {
        setStatusReadFailed(true);
        setNotice("账号状态已变化，模型目录已丢弃。请重新读取。");
        return;
      }
      if (result.kind === "ERROR") {
        setStatusReadFailed(true);
        setNotice(chatGPTErrorMessage(result.code));
        return;
      }
      if (result.kind !== "OK") throw new Error("invalid models result");
      if (
        !Array.isArray(result.models) ||
        result.models.some(
          (model) => typeof model.slug !== "string" || typeof model.displayName !== "string",
        )
      )
        throw new Error("invalid models");
      if (result.profileId !== expectedProfileId) {
        setStatusReadFailed(true);
        setNotice("模型目录未绑定当前账号，请重新读取账号状态。");
        return;
      }
      setModels(result.models);
      setModelsProfileId(expectedProfileId);
      setStatusReadFailed(false);
      setNotice(
        result.models.length
          ? "模型目录来自当前账号。尚未执行模型推理。"
          : "当前账号未返回可选模型。",
      );
    } catch {
      if (mounted.current && generation.current === current) {
        setStatusReadFailed(true);
        setNotice("模型目录尚未确认，请稍后重新读取。");
      }
    } finally {
      if (generation.current === current) {
        operation.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function help(topic: keyof typeof HELP_URLS) {
    if (bridge?.openHelp)
      void bridge.openHelp(topic).catch(() => {
        if (mounted.current) setNotice("无法打开系统浏览器，请稍后重试。");
      });
    else window.open(HELP_URLS[topic], "_blank", "noopener,noreferrer");
  }
  return {
    status,
    loading,
    statusReadFailed,
    busy,
    notice,
    models,
    modelsProfileId,
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
