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
function connection(revision: number, change = {}) {
  return {
    id,
    provider_kind: "SUB2API",
    display_name: command.display_name,
    base_url: command.base_url,
    origin_mode: command.origin_mode,
    enabled: true,
    models: command.models,
    credential_status: "CONFIGURED",
    revision,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...change,
  };
}
function wire(data: unknown) {
  return Response.json({ data, request_id: requestId }, { headers: { "X-Request-ID": requestId } });
}

describe("Sub2API metadata authoritative readback", () => {
  test.each([true, false])(
    "requires matching readback after one PATCH (explicit public mode %s)",
    async (explicit) => {
      const fetcher = vi
        .fn(async (_url: string, _init?: RequestInit) => wire([]))
        .mockResolvedValueOnce(wire([connection(1)]))
        .mockResolvedValueOnce(wire(connection(2)))
        .mockResolvedValueOnce(wire([connection(2)]));
      const input = explicit ? command : { ...command };
      if (!explicit) delete input.origin_mode;
      expect(await createLocalApiClient(fetcher, session).editSub2APIMetadata(id, input)).toEqual({
        kind: "UPDATED",
        receipt: { data: connection(2), request_id: requestId },
      });
      expect(fetcher.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
        "GET",
        "PATCH",
        "GET",
      ]);
      expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual(command);
    },
  );

  test.each(["absent", "stale", "wrong provider", "network"])(
    "does not PATCH after %s pre-read",
    async (outcome) => {
      const fetcher = vi.fn(async () => {
        if (outcome === "network") throw new Error("offline");
        if (outcome === "absent") return wire([]);
        if (outcome === "stale") return wire([connection(3)]);
        return wire([connection(1, { provider_kind: "OPENAI", origin_mode: null })]);
      });
      expect(await createLocalApiClient(fetcher, session).editSub2APIMetadata(id, command)).toEqual(
        { kind: "REMOTE_UNKNOWN" },
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test("cannot implicitly change a persisted local connection to public mode", async () => {
    const fetcher = vi.fn(async () =>
      wire([
        connection(1, { base_url: "http://127.0.0.1:8080", origin_mode: "LOCAL_LOOPBACK_HTTP" }),
      ]),
    );
    const input = { ...command };
    delete input.origin_mode;
    await expect(
      createLocalApiClient(fetcher, session).editSub2APIMetadata(id, input),
    ).rejects.toThrow("explicit origin_mode");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each(["reply", "post-read", "network", "definite", "untrusted"])(
    "does not replay an edit after %s failure",
    async (outcome) => {
      const fetcher = vi
        .fn(async () => wire([]))
        .mockResolvedValueOnce(wire([connection(1)]))
        .mockImplementationOnce(async () => {
          if (outcome === "network") throw new Error("lost reply");
          if (outcome === "definite")
            return Response.json(
              {
                request_id: requestId,
                error: {
                  code: "PROVIDER_CONFLICT",
                  message: "Synthetic conflict",
                  retryable: false,
                  details: {},
                },
              },
              { status: 409, headers: { "X-Request-ID": requestId } },
            );
          if (outcome === "untrusted") return Response.json({}, { status: 500 });
          return wire(connection(outcome === "reply" ? 99 : 2));
        });
      expect(
        await createLocalApiClient(fetcher, session).editSub2APIMetadata(id, command),
      ).toMatchObject({
        kind: outcome === "definite" ? "DEFINITE_SERVER_ERROR" : "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledTimes(outcome === "post-read" ? 3 : 2);
    },
  );
});

describe("Sub2API key rotation", () => {
  test("sends one operation-bound key write and only returns the sanitized receipt", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => wire(connection(2)));
    const result = await createLocalApiClient(fetcher, session).rotateSub2APIKey(id, rotate);
    expect(result).toEqual({
      kind: "UPDATED",
      receipt: { data: connection(2), request_id: requestId },
    });
    expect(JSON.stringify(result)).not.toContain(rotate.api_key);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe(
      `${session.origin}/api/v1/provider-connections/${id}/credential-rotations`,
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(rotate);
  });

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

  test.each(["rotate", "read"] as const)(
    "%s preserves unknown and definite errors without retry",
    async (operation) => {
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
        expect(
          await (operation === "rotate"
            ? client.rotateSub2APIKey(id, rotate)
            : client.readSub2APIKeyRotation(id, operationId)),
        ).toMatchObject({
          kind: outcome === "definite" ? "DEFINITE_SERVER_ERROR" : "REMOTE_UNKNOWN",
        });
        expect(fetcher).toHaveBeenCalledOnce();
      }
    },
  );

  test("rejects invalid metadata and rotation identities before contacting Sidecar", async () => {
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    await expect(client.editSub2APIMetadata("../connection", command)).rejects.toThrow();
    await expect(client.rotateSub2APIKey(id, { ...rotate, api_key: "short" })).rejects.toThrow();
    await expect(client.readSub2APIKeyRotation(id, "bad")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
