import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import type { EditSub2APIMetadataCommand } from "./sub2api-connection-mutation-contract";

const id = `pcn_${"a".repeat(32)}`;
const operationId = `pcop_${"b".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const command: EditSub2APIMetadataCommand = {
  expected_revision: 1,
  display_name: "Synthetic",
  base_url: "https://text.example.com",
  origin_mode: "PUBLIC_HTTPS",
  enabled: true,
  models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
};
const rotate = { expected_revision: 1, operation_id: operationId, api_key: "synthetic-test-key" };
function wire(data: unknown) {
  return Response.json({ data, request_id: requestId }, { headers: { "X-Request-ID": requestId } });
}

describe("retired connection writes", () => {
  test("metadata edit and key rotation return 410 without HTTP", async () => {
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    const retired = {
      kind: "DEFINITE_SERVER_ERROR",
      status: 410,
      code: "SUB2API_DISPATCH_RETIRED",
      request_id: "00000000-0000-4000-8000-000000000410",
    };
    expect(await client.editSub2APIMetadata(id, command)).toEqual(retired);
    expect(await client.rotateSub2APIKey(id, rotate)).toEqual(retired);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Sub2API key rotation reads", () => {
  test.each(["PREPARED", "APPLIED", "CONFLICT", "UNKNOWN"])(
    "reads %s without another key write",
    async (status) => {
      const data = {
        operation_id: operationId,
        connection_id: id,
        expected_revision: 1,
        status,
        applied_revision: status === "APPLIED" ? 2 : null,
        created_at: "2026-09-14T00:00:00Z",
        updated_at: "2026-09-14T00:00:00Z",
      };
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => wire(data));
      expect(
        await createLocalApiClient(fetcher, session).readSub2APIKeyRotation(id, operationId),
      ).toEqual({
        kind: "READ",
        receipt: { data, request_id: requestId },
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]![0]).toBe(
        `${session.origin}/api/v1/provider-connections/${id}/credential-rotations/${operationId}`,
      );
      expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
    },
  );

  test("read preserves unknown and definite errors without retry", async () => {
      for (const outcome of ["network", "JSON", "receipt", "untrusted", "definite"] as const) {
        const fetcher = vi.fn(async () => {
          if (outcome === "network") throw new Error("lost reply");
          if (outcome === "JSON") return new Response("{");
          if (outcome === "receipt") return wire({});
          return Response.json(
            outcome === "untrusted"
              ? {}
              : {
                  request_id: requestId,
                  error: {
                    code: "PROVIDER_NOT_FOUND",
                    message: "Synthetic missing",
                    retryable: false,
                    details: {},
                  },
                },
            { status: 404, headers: { "X-Request-ID": requestId } },
          );
        });
        const client = createLocalApiClient(fetcher, session);
        expect(await client.readSub2APIKeyRotation(id, operationId)).toMatchObject({
          kind: outcome === "definite" ? "DEFINITE_SERVER_ERROR" : "REMOTE_UNKNOWN",
        });
        expect(fetcher).toHaveBeenCalledOnce();
      }
  });

  test("rejects invalid metadata and rotation identities before contacting Sidecar", async () => {
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    await expect(client.editSub2APIMetadata("../connection", command)).rejects.toThrow();
    await expect(client.rotateSub2APIKey(id, { ...rotate, api_key: "short" })).rejects.toThrow();
    await expect(client.readSub2APIKeyRotation(id, "bad")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
