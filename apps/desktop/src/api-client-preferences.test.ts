import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import type { SaveAppPreferencesCommand } from "./app-preferences-contract";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const command: SaveAppPreferencesCommand = {
  expected_revision: 0,
  user_name: "Synthetic",
  display_bio: "Local",
  ui_language: "zh-CN",
  ui_theme: "dark-cinematic",
};
function receipt(saved: boolean) {
  return {
    request_id: requestId,
    data: {
      saved,
      revision: saved ? 1 : 0,
      user_name: saved ? command.user_name : "",
      display_bio: saved ? command.display_bio : "",
      ui_language: "zh-CN",
      ui_theme: "dark-cinematic",
      created_at: saved ? "2026-09-14T00:00:00Z" : null,
      updated_at: saved ? "2026-09-14T00:00:00Z" : null,
    },
  };
}
function response(saved: boolean, change = {}) {
  const value = receipt(saved);
  return Response.json(
    { ...value, data: { ...value.data, ...change } },
    {
      headers: { "X-Request-ID": requestId, ETag: `"revision-${saved ? 1 : 0}"` },
    },
  );
}

describe("native app preference API receipt boundary", () => {
  test("reads the exact unset preference contract", async () => {
    const fetcher = vi.fn(async () => response(false));
    const client = createLocalApiClient(fetcher, session);
    expect(await client.getAppPreferences()).toEqual({ kind: "FOUND", receipt: receipt(false) });
    expect(fetcher).toHaveBeenCalledWith(
      `${session.origin}/api/v1/app-preferences`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${session.token}` }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("sends one revision-bound PATCH and accepts only the matching receipt", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response(true));
    expect(await createLocalApiClient(fetcher, session).saveAppPreferences(command)).toEqual({
      kind: "SAVED",
      receipt: receipt(true),
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual(command);
  });

  test.each([
    { saved: false },
    { revision: 2 },
    { user_name: "other" },
    { display_bio: "other" },
    { ui_language: "en" },
    { ui_theme: "light" },
    { unexpected: true },
  ])("keeps mismatched successful response unknown %# without replay", async (change) => {
    const fetcher = vi.fn(async () => response(true, change));
    expect(await createLocalApiClient(fetcher, session).saveAppPreferences(command)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each(["read", "save"] as const)(
    "%s preserves unknown on untrusted HTTP outcomes",
    async (operation) => {
      for (const produce of [
        () => Promise.reject(new Error("network unavailable")),
        () => Promise.resolve(new Response("not JSON")),
        () => Promise.resolve(Response.json(receipt(true))),
        () => Promise.resolve(Response.json({ error: "untrusted" }, { status: 500 })),
        () =>
          Promise.resolve(
            Response.json(receipt(true), {
              headers: { "X-Request-ID": requestId, ETag: '"revision-99"' },
            }),
          ),
      ]) {
        const fetcher = vi.fn(produce);
        const client = createLocalApiClient(fetcher, session);
        expect(
          await (operation === "read"
            ? client.getAppPreferences()
            : client.saveAppPreferences(command)),
        ).toEqual({ kind: "REMOTE_UNKNOWN" });
        expect(fetcher).toHaveBeenCalledOnce();
      }
    },
  );

  test.each([
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [409, "APP_PREFERENCES_REVISION_CONFLICT"],
    [422, "VALIDATION_ERROR"],
  ] as const)(
    "recognizes authenticated definite error %s without treating it as success",
    async (status, code) => {
      const payload = {
        request_id: requestId,
        error: { code, message: "Synthetic rejection", retryable: false, details: {} },
      };
      const fetcher = vi.fn(async () =>
        Response.json(payload, { status, headers: { "X-Request-ID": requestId } }),
      );
      const client = createLocalApiClient(fetcher, session);
      const expected = { kind: "DEFINITE_SERVER_ERROR", status, code, request_id: requestId };
      expect(await client.getAppPreferences()).toEqual(expected);
      expect(await client.saveAppPreferences(command)).toEqual(expected);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  test.each([{ user_name: "" }, { expected_revision: -1 }, { unexpected: true }])(
    "rejects noncanonical writes before HTTP %#",
    async (change) => {
      const fetcher = vi.fn();
      await expect(
        createLocalApiClient(fetcher, session).saveAppPreferences({ ...command, ...change }),
      ).rejects.toThrow("canonical app preferences");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
