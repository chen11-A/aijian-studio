import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CreateProviderConnectionInput, ProviderConnectionListResponse } from "../api/studio";
import { useProviderSettings } from "./use-provider-settings";

const input: CreateProviderConnectionInput = {
  provider_kind: "SUB2API",
  origin_mode: "LOCAL_LOOPBACK_HTTP",
  display_name: "Local fixture",
  base_url: "http://127.0.0.1:8000/v1",
  enabled: true,
  models: [],
  api_key: "synthetic-test-key",
};
function connection(): ProviderConnectionListResponse["data"][number] {
  return {
    id: `pcn_${"1".repeat(32)}`,
    provider_kind: "SUB2API",
    origin_mode: "LOCAL_LOOPBACK_HTTP",
    display_name: input.display_name,
    base_url: input.base_url,
    enabled: input.enabled,
    models: [],
    credential_status: "CONFIGURED",
    revision: 1,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
  };
}
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("local Sub2API creation requires matching receipt and readback", () => {
  const faults = [
    "request",
    "id",
    "provider",
    "mode",
    "revision",
    "url",
    "name",
    "enabled",
    "credential",
    "models",
  ] as const;
  for (const phase of ["receipt", "readback"] as const) {
    test.each(faults)(`${phase} rejects %s mismatch without repeating create`, async (fault) => {
      const created = connection();
      const read = connection();
      const corrupted = phase === "receipt" ? created : read;
      if (fault === "id") corrupted.id = "pcn_other";
      if (fault === "provider") corrupted.provider_kind = "OPENAI";
      if (fault === "mode") corrupted.origin_mode = "PUBLIC_HTTPS";
      if (fault === "revision") corrupted.revision = 2;
      if (fault === "url") corrupted.base_url = "http://127.0.0.1:9000/v1";
      if (fault === "name") corrupted.display_name = "Changed";
      if (fault === "enabled") corrupted.enabled = false;
      if (fault === "credential") corrupted.credential_status = "MISSING";
      if (fault === "models")
        corrupted.models = [{ model_id: "different-model", capabilities: ["TEXT"] }];
      const initial = { request_id: requestId, data: [] };
      const listConnections = vi.fn().mockResolvedValue(initial);
      const createConnection = vi.fn().mockResolvedValue({
        request_id: phase === "receipt" && fault === "request" ? "" : requestId,
        data: created,
      });
      const { result } = renderHook(() =>
        useProviderSettings({
          listConnections,
          createConnection,
          deleteConnection: vi.fn(),
        }),
      );
      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      if (phase === "readback")
        listConnections.mockResolvedValueOnce({
          request_id: fault === "request" ? "" : requestId,
          data: [read],
        });
      await act(async () => {
        await expect(result.current.create(input)).rejects.toThrow();
      });
      expect(createConnection).toHaveBeenCalledExactlyOnceWith(input);
      expect(result.current.saving).toBe(false);
      expect(result.current.saveError).toContain("连接保存结果未知");
      expect(result.current.state).toEqual({ kind: "ready", response: initial });
    });
  }

  test("only exact readback completes local creation", async () => {
    const response = { request_id: requestId, data: [connection()] };
    const listConnections = vi.fn().mockResolvedValue(response);
    const createConnection = vi
      .fn()
      .mockResolvedValue({ request_id: requestId, data: connection() });
    const { result } = renderHook(() =>
      useProviderSettings({ listConnections, createConnection, deleteConnection: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      await result.current.create(input);
    });
    expect(result.current.state).toEqual({ kind: "ready", response });
    expect(result.current.saveError).toBeNull();
    expect(listConnections).toHaveBeenCalledTimes(2);
    expect(createConnection).toHaveBeenCalledTimes(1);
  });

  test("simultaneous create requests dispatch once while waiting for receipt", async () => {
    let finish!: (value: { request_id: string; data: ReturnType<typeof connection> }) => void;
    const createConnection = vi.fn(
      () =>
        new Promise<{ request_id: string; data: ReturnType<typeof connection> }>((resolve) => {
          finish = resolve;
        }),
    );
    const listConnections = vi
      .fn()
      .mockResolvedValue({ request_id: requestId, data: [connection()] });
    const { result } = renderHook(() =>
      useProviderSettings({ listConnections, createConnection, deleteConnection: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      const first = result.current.create(input);
      await result.current.create(input);
      expect(createConnection).toHaveBeenCalledTimes(1);
      finish({ request_id: requestId, data: connection() });
      await first;
    });
    expect(result.current.saving).toBe(false);
  });
});
