import { afterEach, expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";
import type { EditSub2APIMetadataCommand } from "./sub2api-connection-mutation-contract";

const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
const connectionId = `pcn_${"6".repeat(32)}`;
const origin = "http://127.0.0.1:43124";
const connection = {
  id: connectionId,
  provider_kind: "SUB2API",
  display_name: "Local Sub2API",
  base_url: origin,
  origin_mode: "LOCAL_LOOPBACK_HTTP",
  enabled: true,
  models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
  credential_status: "CONFIGURED",
  revision: 1,
  created_at: "2026-09-29T00:00:00Z",
  updated_at: "2026-09-29T00:00:00Z",
};
const command: EditSub2APIMetadataCommand = {
  expected_revision: 1,
  display_name: "Local Sub2API updated",
  base_url: origin,
  origin_mode: "LOCAL_LOOPBACK_HTTP",
  enabled: true,
  models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
};
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };

afterEach(() => vi.useRealTimers());

test("a hung authoritative pre-read ends within the deadline without PATCH", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_input: string, _init?: RequestInit) => new Promise<Response>(() => {}));
  const pending = createLocalApiClient(fetcher, session).editSub2APIMetadata(connectionId, command);

  await vi.advanceTimersByTimeAsync(15_000);
  await expect(pending).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(`${session.origin}/api/v1/provider-connections`);
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

test("a hung authoritative post-read ends within the deadline after one PATCH", async () => {
  vi.useFakeTimers();
  const updated = { ...connection, display_name: command.display_name, revision: 2 };
  const fetcher = vi
    .fn((_input: string, _init?: RequestInit): Promise<Response> =>
      Promise.reject(new Error("unexpected extra request")),
    )
    .mockResolvedValueOnce(Response.json({ data: [connection], request_id: requestId }))
    .mockResolvedValueOnce(
      Response.json(
        { data: updated, request_id: requestId },
        { headers: { "X-Request-ID": requestId } },
      ),
    )
    .mockImplementationOnce(() => new Promise<Response>(() => {}));
  const pending = createLocalApiClient(fetcher, session).editSub2APIMetadata(connectionId, command);

  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.map((call) => call[1]?.method ?? "GET")).toEqual([
    "GET",
    "PATCH",
    "GET",
  ]);
  expect(fetcher.mock.calls[2]?.[1]?.signal?.aborted).toBe(true);
});
