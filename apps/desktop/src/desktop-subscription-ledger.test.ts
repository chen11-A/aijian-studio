import { describe, expect, it } from "vitest";
import { createSubscriptionLedger } from "./desktop-subscription-ledger";

describe("desktop subscription ledger", () => {
  it("sends a hash and account kind, never the prompt or a token", async () => {
    let body = "";
    const fetcher: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          data: {
            dispatch_id: "dsd_" + "ab".repeat(16),
            record_id: "dbr_" + "cd".repeat(16),
            created: true,
            outcome: "RECORDED",
            account_kind: "grok_login",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    };
    const ledger = createSubscriptionLedger(fetcher, {
      origin: "http://127.0.0.1:43123",
      token: "a".repeat(43),
    });
    await ledger.record({
      projectId: "prj_" + "12".repeat(16),
      accountKind: "grok_login",
      model: "grok-4",
      text: "机密正文",
      idempotencyKey: "desktop-dispatch-key-0001",
      connected: true,
    });
    expect(body).not.toContain("机密正文");
    expect(body).not.toContain("access_token");
    expect(body).toContain("grok_login");
    expect(body).toContain("sha256:");
  });
});
