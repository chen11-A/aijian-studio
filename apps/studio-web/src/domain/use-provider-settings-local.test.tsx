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

describe("retired connection creation never reaches the transport", () => {
  test("refuses a retired provider before any create request", async () => {
    const listConnections = vi.fn().mockResolvedValue({ request_id: requestId, data: [] });
    const createConnection = vi.fn();
    const { result } = renderHook(() =>
      useProviderSettings({ listConnections, createConnection, deleteConnection: vi.fn() }),
    );
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      await result.current.create(input);
    });
    expect(createConnection).not.toHaveBeenCalled();
    expect(result.current.saveError).toContain("已停用");
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
      const openai = { ...input, provider_kind: "OPENAI" as const };
      const first = result.current.create(openai);
      await result.current.create(openai);
      expect(createConnection).toHaveBeenCalledTimes(1);
      finish({ request_id: requestId, data: connection() });
      await first;
    });
    expect(result.current.saving).toBe(false);
  });
});
