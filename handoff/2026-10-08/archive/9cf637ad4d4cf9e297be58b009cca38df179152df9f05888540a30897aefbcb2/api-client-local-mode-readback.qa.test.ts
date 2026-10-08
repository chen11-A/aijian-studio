import { expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";
import type { EditSub2APIMetadataCommand } from "./sub2api-connection-mutation-contract";

test("one local metadata PATCH preserves mode and reads back revision and metadata", async () => {
  expect((globalThis as unknown as { __QA_NETWORK_GUARD_ACTIVE__?: boolean })
    .__QA_NETWORK_GUARD_ACTIVE__).toBe(true);
  const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
  const connectionId = `pcn_${"6".repeat(32)}`;
  const baseUrl = "http://127.0.0.1:43124";
  const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
  const before = {
    id: connectionId,
    provider_kind: "SUB2API",
    display_name: "Local Sub2API",
    base_url: baseUrl,
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
    base_url: baseUrl,
    origin_mode: "LOCAL_LOOPBACK_HTTP",
    enabled: true,
    models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
  };
  const after = { ...before, display_name: command.display_name, revision: 2 };
  const receipt = { data: after, request_id: requestId };
  const fetcher = vi.fn((_input: string, _init?: RequestInit): Promise<Response> =>
    Promise.reject(new Error("unexpected extra request")))
    .mockResolvedValueOnce(Response.json({ data: [before], request_id: requestId }))
    .mockResolvedValueOnce(Response.json(receipt, {
      headers: { "X-Request-ID": requestId },
    }))
    .mockResolvedValueOnce(Response.json({ data: [after], request_id: requestId }));

  const result = await createLocalApiClient(fetcher, session).editSub2APIMetadata(
    connectionId, command,
  );

  expect(result).toEqual({ kind: "UPDATED", receipt });
  expect(fetcher.mock.calls.map((call) => call[1]?.method ?? "GET"))
    .toEqual(["GET", "PATCH", "GET"]);
  expect(fetcher.mock.calls[0]?.[0]).toBe(`${session.origin}/api/v1/provider-connections`);
  expect(fetcher.mock.calls[2]?.[0]).toBe(`${session.origin}/api/v1/provider-connections`);
  const patchBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
  expect(patchBody).toMatchObject({
    origin_mode: "LOCAL_LOOPBACK_HTTP",
    expected_revision: 1,
    display_name: "Local Sub2API updated",
    base_url: baseUrl,
  });
});
