import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ProviderConnectionListResponse } from "../api/studio";
import { useProviderSettings } from "./use-provider-settings";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const emptyResponse: ProviderConnectionListResponse = { data: [], request_id: requestId };
const providerConnection = (id: string): ProviderConnectionListResponse["data"][number] => ({
  id,
  provider_kind: "OPENAI",
  display_name: id,
  base_url: "https://api.openai.com/v1",
  enabled: true,
  models: [],
  credential_status: "MISSING",
  revision: 1,
  created_at: "2026-08-04T02:00:00Z",
  updated_at: "2026-08-04T02:00:00Z",
});

describe("useProviderSettings", () => {
  test("recovers a failed read through an explicit reload", async () => {
    const listConnections = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(emptyResponse);
    const { result } = renderHook(() =>
      useProviderSettings({
        listConnections,
        createConnection: vi.fn(),
        deleteConnection: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.state).toEqual({ kind: "ready", response: emptyResponse });
  });

  test("reloads retained metadata and exposes credential cleanup guidance after a failed create", async () => {
    const retained = {
      id: "pcn_retained",
      provider_kind: "OPENAI",
      display_name: "retained",
      models: [],
    };
    const listConnections = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce({ data: [retained], request_id: requestId });
    const createConnection = vi.fn().mockRejectedValue(new Error("CREDENTIAL_CLEANUP_REQUIRED"));
    const { result } = renderHook(() =>
      useProviderSettings({ listConnections, createConnection, deleteConnection: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      try {
        await result.current.create({} as never);
      } catch {
        /* asserted below */
      }
    });
    expect(result.current.state).toEqual({
      kind: "ready",
      response: { data: [retained], request_id: requestId },
    });
    expect(result.current.saveError).toContain("凭据可能需要清理");
  });

  test("keeps the confirmation and visible state after a failed delete", async () => {
    const response = { data: [{ id: "pcn_kept" }], request_id: requestId };
    const listConnections = vi.fn().mockResolvedValue(response);
    const createConnection = vi.fn();
    const deleteConnection = vi.fn().mockRejectedValue(new Error("conflict"));
    const { result } = renderHook(() =>
      useProviderSettings({ listConnections, createConnection, deleteConnection }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    act(() => result.current.setConfirmingId("pcn_kept"));
    await act(async () => {
      await result.current.remove("pcn_kept");
    });
    expect(result.current.confirmingId).toBe("pcn_kept");
    expect(result.current.state).toEqual({ kind: "ready", response });
    expect(result.current.saveError).toContain("原配置未被界面隐藏");
  });

  test("requires matching removal confirmation before deleting a connection", async () => {
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const listConnections = vi.fn().mockResolvedValue(emptyResponse);
    const { result } = renderHook(() =>
      useProviderSettings({ listConnections, createConnection: vi.fn(), deleteConnection }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    await act(async () => {
      await result.current.remove("pcn_guarded");
    });
    expect(deleteConnection).not.toHaveBeenCalled();

    act(() => result.current.setConfirmingId("pcn_guarded"));
    await act(async () => {
      await result.current.remove("pcn_guarded");
    });
    expect(deleteConnection).toHaveBeenCalledWith("pcn_guarded");
  });

  test("does not mislabel an ordinary create conflict as credential cleanup", async () => {
    const listConnections = vi.fn().mockResolvedValue(emptyResponse);
    const { result } = renderHook(() =>
      useProviderSettings({
        listConnections,
        createConnection: vi.fn().mockRejectedValue(new Error("PROVIDER_CONNECTION_CONFLICT")),
        deleteConnection: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      try {
        await result.current.create({} as never);
      } catch {
        /* asserted below */
      }
    });
    expect(result.current.saveError).toContain("连接未保存");
    expect(result.current.saveError).not.toContain("凭据可能需要清理");
  });
  test("ignores an expired provider read after a newer reload completes", async () => {
    let resolveOld!: (value: typeof emptyResponse) => void;
    const old = new Promise<typeof emptyResponse>((resolve) => {
      resolveOld = resolve;
    });
    const fresh = { data: [providerConnection("pcn_fresh")], request_id: requestId };
    const listConnections = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(fresh);
    const { result } = renderHook(() =>
      useProviderSettings({
        listConnections,
        createConnection: vi.fn(),
        deleteConnection: vi.fn(),
      }),
    );
    await act(async () => {
      await result.current.load();
    });
    await act(async () => {
      resolveOld({ data: [providerConnection("pcn_old")], request_id: requestId });
    });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ready", response: fresh }));
  });
});
