import { describe, expect, it } from "vitest";
import { authorizeInBrowser } from "./chatgpt-auth-callback";
const hostId = "urn:uuid:11111111-1111-4111-8111-111111111111";
describe("loopback callback using only a local synthetic callback", () => {
  it("binds exact loopback and keeps waiting after a wrong state", async () => {
    const result = await authorizeInBrowser(
      { hostId },
      async (raw) => {
        const request = new URL(raw);
        const callback = new URL(request.searchParams.get("redirect_uri") ?? "");
        expect(callback.hostname).toBe("127.0.0.1");
        expect(callback.pathname).toBe("/auth/callback");
        callback.search = new URLSearchParams({
          state: "wrong",
          code: "fixture-code",
          client_id: "oaiapp_fixture",
        }).toString();
        const wrong = await fetch(callback);
        expect(wrong.status).toBe(400);
        callback.searchParams.set("state", request.searchParams.get("state") ?? "");
        const accepted = await fetch(callback);
        expect(accepted.status).toBe(200);
      },
      AbortSignal.timeout(2000),
    );
    expect(result.clientId).toBe("oaiapp_fixture");
    expect(result.code).toBe("fixture-code");
  });
  it("closes the local listener after cancellation and browser open failure", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      authorizeInBrowser({ hostId }, async () => undefined, controller.signal),
    ).rejects.toThrow("AUTH_CANCELLED");
    await expect(
      authorizeInBrowser(
        { hostId },
        async () => {
          throw new Error("fixture");
        },
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow("BROWSER_OPEN_FAILED");
  });
});
