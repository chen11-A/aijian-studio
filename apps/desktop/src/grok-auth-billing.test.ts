import { describe, expect, it, vi } from "vitest";
import { createGrokRuntime } from "./grok-auth-runtime";
import type { GrokSession, GrokStore } from "./grok-auth-storage";
import type { createSubscriptionLedger } from "./desktop-subscription-ledger";

const session: GrokSession = {
  version: 1,
  accessToken: "local-access-token",
  refreshToken: "local-refresh-token",
  expiresAt: Date.now() + 60 * 60 * 1000,
  scopes: ["openid"],
  subject: "user",
  email: "person@example.test",
  name: null,
  inferenceDenied: false,
};

function store(): GrokStore {
  return {
    available: () => true,
    read: async () => session,
    write: async () => undefined,
    clear: async () => undefined,
  };
}

describe("Grok desktop dispatch billing", () => {
  it("records billing before HTTP and does not send the token to the ledger", async () => {
    const calls: string[] = [];
    const ledger: ReturnType<typeof createSubscriptionLedger> = {
      record: vi.fn(async (input) => {
        calls.push("record");
        expect(JSON.stringify(input)).not.toContain("local-access-token");
        expect(JSON.stringify(input)).not.toContain("local-refresh-token");
        expect(input.accountKind).toBe("grok_login");
        return {
          dispatchId: "dsd_" + "ab".repeat(16),
          recordId: "dbr_" + "cd".repeat(16),
          created: true,
          outcome: "RECORDED" as const,
          accountKind: "grok_login" as const,
        };
      }),
      finish: vi.fn(async () => {
        calls.push("finish");
      }),
    };
    const fetch = vi.fn(async () => {
      calls.push("http");
      return new Response(JSON.stringify({ output_text: "草稿" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const runtime = createGrokRuntime({
      store: store(),
      fetch,
      openBrowser: async () => undefined,
      confirmSignIn: async () => false,
      ledger,
      endpoints: {
        token: "http://127.0.0.1/token",
        revoke: "http://127.0.0.1/revoke",
        userinfo: "http://127.0.0.1/userinfo",
        api: "http://127.0.0.1/v1",
      },
    });
    const result = await runtime.completeText({
      model: "grok-4",
      text: "你好",
      projectId: "prj_" + "12".repeat(16),
      idempotencyKey: "desktop-dispatch-key-0001",
    });
    expect(result.kind).toBe("OK");
    expect(calls).toEqual(["record", "http", "finish"]);
  });

  it("does not call xAI when the billing record is refused", async () => {
    const fetch = vi.fn();
    const runtime = createGrokRuntime({
      store: store(),
      fetch,
      openBrowser: async () => undefined,
      confirmSignIn: async () => false,
      ledger: {
        record: async () => {
          throw new Error("BILLING_NOT_RECORDED");
        },
        finish: async () => undefined,
      },
    });
    const result = await runtime.completeText({
      model: "grok-4",
      text: "你好",
      projectId: "prj_" + "12".repeat(16),
      idempotencyKey: "desktop-dispatch-key-0001",
    });
    expect(result).toMatchObject({ kind: "ERROR", code: "BILLING_NOT_RECORDED" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
