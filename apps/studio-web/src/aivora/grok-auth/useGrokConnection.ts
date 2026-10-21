import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GrokLoginActionResult,
  GrokLoginModel,
  GrokLoginStatus,
} from "@aijian/contracts/grok-auth";
import {
  GROK_DESKTOP_REQUIRED,
  grokBridge,
  GROK_WAITING_MESSAGE,
  grokLoginFailureMessage,
  readGrokStatus,
  validGrokStatus,
  type GrokLoginBridge,
} from "./transport";

export function useGrokConnection(provided?: GrokLoginBridge, projectId?: string | null) {
  const bridge = provided ?? grokBridge();
  const [status, setStatus] = useState<GrokLoginStatus>(GROK_DESKTOP_REQUIRED);
  const [models, setModels] = useState<GrokLoginModel[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const signingIn = useRef(false);

  const applyModels = useCallback(
    async (current: number, next: GrokLoginStatus) => {
      if (!bridge || next.state !== "CONNECTED") {
        if (mounted.current && generation.current === current) setModels([]);
        return;
      }
      const listed = await bridge.models();
      if (!mounted.current || generation.current !== current) return;
      if (listed.kind === "OK") setModels(listed.models);
      else {
        setModels([]);
        setNotice(grokLoginFailureMessage(listed.code));
      }
    },
    [bridge],
  );

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await readGrokStatus(bridge);
      if (!mounted.current || generation.current !== current) return;
      setStatus(value);
      if (value.state === "ENTITLEMENT_DENIED")
        setNotice(grokLoginFailureMessage("ENTITLEMENT_DENIED"));
      else if (value.lastError) setNotice(grokLoginFailureMessage(value.lastError));
      else setNotice("");
      await applyModels(current, value);
    } catch {
      if (mounted.current && generation.current === current) {
        setNotice("无法读取 Grok 登录状态。请重试。");
      }
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [applyModels, bridge]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      if (signingIn.current) void bridge?.cancel().catch(() => undefined);
      signingIn.current = false;
    };
  }, [bridge, load]);

  async function signIn() {
    if (!bridge || busy) return;
    const current = ++generation.current;
    signingIn.current = true;
    setBusy(true);
    setNotice(GROK_WAITING_MESSAGE);
    try {
      const result = await bridge.signIn();
      if (!mounted.current || generation.current !== current) return;
      await applyAction(current, result);
    } catch {
      if (mounted.current && generation.current === current) {
        setNotice("登录结果尚未确认。请重新读取状态，避免重复授权。");
      }
    } finally {
      if (generation.current === current) {
        signingIn.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }

  async function applyAction(current: number, result: GrokLoginActionResult) {
    if (!validGrokStatus(result.status)) throw new Error("invalid status");
    setStatus(result.status);
    if (result.kind === "ERROR") setNotice(grokLoginFailureMessage(result.code));
    else if (result.kind === "CANCELLED") setNotice("已取消 Grok 登录。");
    else if (result.status.state === "ENTITLEMENT_DENIED")
      setNotice(grokLoginFailureMessage("ENTITLEMENT_DENIED"));
    else if (result.status.lastError) setNotice(grokLoginFailureMessage(result.status.lastError));
    else setNotice("");
    await applyModels(current, result.status);
  }

  async function signOut() {
    if (!bridge || busy) return;
    const current = ++generation.current;
    setBusy(true);
    try {
      const result = await bridge.signOut();
      if (!mounted.current || generation.current !== current) return;
      await applyAction(current, result);
      setModels([]);
    } catch {
      if (mounted.current && generation.current === current) setNotice("退出结果尚未确认。");
    } finally {
      if (mounted.current && generation.current === current) setBusy(false);
    }
  }

  async function checkInference(modelId: string) {
    if (!bridge || busy) return;
    const current = ++generation.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await bridge.completeText({
        model: modelId,
        text: "ping",
        ...(projectId ? { projectId, idempotencyKey: crypto.randomUUID() } : {}),
      });
      if (!mounted.current || generation.current !== current) return;
      if (result.kind === "OK") {
        setNotice(`这次推理已返回。计费类别 ${result.billingAccountKind}。结果不会写入作品。`);
      } else {
        setNotice(grokLoginFailureMessage(result.code));
      }
      const value = await readGrokStatus(bridge);
      if (mounted.current && generation.current === current) setStatus(value);
    } catch {
      if (mounted.current && generation.current === current) {
        setNotice("没有确认这次推理。请看账号状态，不要重复点击。");
      }
    } finally {
      if (mounted.current && generation.current === current) setBusy(false);
    }
  }

  return {
    bridge,
    status,
    models,
    notice,
    loading,
    busy,
    reload: load,
    signIn,
    signOut,
    checkInference,
  };
}

export type GrokConnection = ReturnType<typeof useGrokConnection>;
