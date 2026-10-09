import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateProviderConnectionInput,
  ProviderConnectionListResponse,
  StudioTransport,
} from "../api/studio";
import { readProviderJournal } from "./sub2api-provider-journal";

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
        const receipt = await createConnection(input);
        if (input.provider_kind === "SUB2API" && input.origin_mode === "LOCAL_LOOPBACK_HTTP") {
          const created = receipt.data;
          const expectedModels = JSON.stringify(input.models);
          if (
            !receipt.request_id ||
            !/^pcn_[0-9a-f]{32}$/.test(created.id) ||
            created.provider_kind !== "SUB2API" ||
            created.origin_mode !== "LOCAL_LOOPBACK_HTTP" ||
            created.revision !== 1 ||
            created.base_url !== input.base_url ||
            created.display_name !== input.display_name ||
            created.enabled !== input.enabled ||
            created.credential_status !== "CONFIGURED" ||
            JSON.stringify(created.models) !== expectedModels
          ) {
            throw new Error("Sub2API local create receipt did not match the submitted mode");
          }
          const response = await listConnections();
          const current = response.data.find((item) => item.id === created.id);
          if (
            !response.request_id ||
            !current ||
            current.provider_kind !== "SUB2API" ||
            current.origin_mode !== created.origin_mode ||
            current.revision !== created.revision ||
            current.base_url !== created.base_url ||
            current.display_name !== created.display_name ||
            current.enabled !== created.enabled ||
            current.credential_status !== created.credential_status ||
            JSON.stringify(current.models) !== expectedModels
          ) {
            throw new Error("Sub2API local create was not confirmed by the connection list");
          }
          requestSequence.current += 1;
          setState({ kind: "ready", response });
        } else {
          await load();
        }
      } catch (error) {
        await load();
        const cleanupRequired =
          error instanceof Error && error.message.includes("CREDENTIAL_CLEANUP_REQUIRED");
        setSaveError(
          cleanupRequired
            ? "系统凭据可能需要清理。已显示本次保留的连接，请确认连接 ID 后移除。"
            : "连接保存结果未知。已重新读取配置；请核对连接 ID 和修订，不要直接重复提交。",
        );
        throw error;
      } finally {
        createPending.current = false;
        setSaving(false);
      }
    },
    [createConnection, listConnections, load],
  );

  const remove = useCallback(
    async (connectionId: string) => {
      if (confirmingId !== connectionId) return;
      const connection =
        state.kind === "ready"
          ? state.response.data.find((item) => item.id === connectionId)
          : null;
      if (
        connection?.provider_kind === "SUB2API" &&
        readProviderJournal(connectionId).kind !== "empty"
      ) {
        setSaveError("该连接有待核对的 B31 操作或本地记录不可用；已阻止移除。");
        return;
      }
      try {
        await deleteConnection(connectionId);
        setConfirmingId(null);
        await load();
      } catch {
        await load();
        setSaveError("移除结果未知。已重新读取连接列表；请核对原连接 ID，不要直接重复移除。");
      }
    },
    [confirmingId, deleteConnection, load, state],
  );

  return { state, saving, saveError, confirmingId, setConfirmingId, load, create, remove };
}
