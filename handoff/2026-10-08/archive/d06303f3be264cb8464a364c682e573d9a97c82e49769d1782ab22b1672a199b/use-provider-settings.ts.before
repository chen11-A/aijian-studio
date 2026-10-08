import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateProviderConnectionInput,
  ProviderConnectionListResponse,
  StudioTransport,
} from "../api/studio";

export type ProviderSettingsState =
  | { kind: "loading" }
  | { kind: "ready"; response: ProviderConnectionListResponse }
  | { kind: "error" };

interface ProviderSettingsTransport {
  listConnections: StudioTransport["listProviderConnections"];
  createConnection: StudioTransport["createProviderConnection"];
  deleteConnection: StudioTransport["deleteProviderConnection"];
}

export function useProviderSettings(transport: ProviderSettingsTransport) {
  const { listConnections, createConnection, deleteConnection } = transport;
  const [state, setState] = useState<ProviderSettingsState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const createPending = useRef(false);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setState({ kind: "loading" });
    try {
      const response = await listConnections();
      if (requestSequence.current === requestId) setState({ kind: "ready", response });
    } catch {
      if (requestSequence.current === requestId) setState({ kind: "error" });
    }
  }, [listConnections]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const create = useCallback(
    async (input: CreateProviderConnectionInput) => {
      if (createPending.current) return;
      createPending.current = true;
      setSaving(true);
      setSaveError(null);
      try {
        await createConnection(input);
        await load();
      } catch (error) {
        await load();
        const cleanupRequired =
          error instanceof Error && error.message.includes("CREDENTIAL_CLEANUP_REQUIRED");
        setSaveError(
          cleanupRequired
            ? "系统凭据可能需要清理。已显示本次保留的连接，请确认连接 ID 后移除。"
            : "连接未保存。已重新读取配置，请检查名称、地址和系统凭据库后重试。",
        );
        throw error;
      } finally {
        createPending.current = false;
        setSaving(false);
      }
    },
    [createConnection, load],
  );

  const remove = useCallback(
    async (connectionId: string) => {
      if (confirmingId !== connectionId) return;
      try {
        await deleteConnection(connectionId);
        setConfirmingId(null);
        await load();
      } catch {
        setSaveError("无法移除连接；原配置未被界面隐藏。");
      }
    },
    [confirmingId, deleteConnection, load],
  );

  return { state, saving, saveError, confirmingId, setConfirmingId, load, create, remove };
}
