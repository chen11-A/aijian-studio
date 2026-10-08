import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AUTH_TTL,
  createAuthorizationAttempt,
  DYNAMIC_CLIENT,
  RESOURCE,
} from "./chatgpt-auth-oauth";
const hostId = "urn:uuid:11111111-1111-4111-8111-111111111111";
const redirectUri = "http://127.0.0.1:32123/auth/callback";
function setup(clientId?: string) {
  return createAuthorizationAttempt({ hostId, redirectUri, ...(clientId ? { clientId } : {}) });
}
function callback(attempt: ReturnType<typeof setup>, overrides: Record<string, string> = {}) {
  const url = new URL(attempt.url);
  return `${redirectUri}?${new URLSearchParams({ code: "fixture-code", state: url.searchParams.get("state") ?? "", client_id: "oaiapp_fixture", ...overrides })}`;
}
describe("official OAuth attempt security", () => {
  it("uses documented dynamic registration and fresh S256 values", () => {
    const first = setup();
    const second = setup();
    const url = new URL(first.url);
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.searchParams.get("client_id")).toBe(DYNAMIC_CLIENT);
    expect(url.searchParams.get("resource")).toBe(RESOURCE);
    expect(url.searchParams.get("agent_name_hint")).toBe("AIVORA");
    expect(url.searchParams.get("state")).not.toBe(new URL(second.url).searchParams.get("state"));
    const result = first.consume(callback(first));
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(result.verifier).digest("base64url"),
    );
    expect(result.nonce).toBe(url.searchParams.get("nonce"));
    expect(result.clientId).toBe("oaiapp_fixture");
    expect(result.redirectUri).toBe(redirectUri);
    expect(() => first.consume(callback(first))).toThrow("AUTH_ATTEMPT_EXPIRED");
  });
  it.each([
    "http://localhost:32123/auth/callback",
    "http://127.0.0.1/auth/callback",
    "http://127.0.0.1:80/auth/callback",
    "http://127.0.0.1:0/auth/callback",
    "http://127.0.0.1:99999/auth/callback",
    "https://127.0.0.1:32123/auth/callback",
    "http://127.0.0.1:32123/callback",
    "http://127.0.0.1:32123/auth/callback?x=1",
  ])("rejects unsafe callback %s", (value) => {
    expect(() => createAuthorizationAttempt({ hostId, redirectUri: value })).toThrow(
      "INVALID_CALLBACK_URI",
    );
  });
  it("rejects invalid host and issued client identifiers", () => {
    expect(() => createAuthorizationAttempt({ hostId: "some-host", redirectUri })).toThrow(
      "INVALID_HOST_ID",
    );
    expect(() =>
      createAuthorizationAttempt({ hostId, redirectUri, clientId: DYNAMIC_CLIENT }),
    ).toThrow("INVALID_CLIENT_ID");
  });
  it("rejects wrong state and origin without consuming a valid attempt", () => {
    const value = setup();
    expect(() => value.consume(callback(value, { state: "wrong" }))).toThrow("AUTH_STATE_MISMATCH");
    expect(() => value.consume(callback(value).replace(":32123/", ":32124/"))).toThrow(
      "CALLBACK_REJECTED",
    );
    expect(() => value.consume(callback(value) + "#fragment")).toThrow("CALLBACK_REJECTED");
    expect(() => value.consume("not-a-url")).toThrow("CALLBACK_REJECTED");
    expect(() => value.consume(callback(value) + "&state=duplicate")).toThrow("CALLBACK_REJECTED");
    expect(value.consume(callback(value)).code).toBe("fixture-code");
  });
  it.each(["dynamic_agent_client", "", "different/client"])(
    "never exchanges invalid issued client %s",
    (client_id) => {
      const value = setup();
      expect(() => value.consume(callback(value, { client_id }))).toThrow("REGISTRATION_MISMATCH");
    },
  );
  it("retains returning client and rejects client substitution", () => {
    const value = setup("oaiapp_fixture");
    expect(new URL(value.url).searchParams.has("agent_name_hint")).toBe(false);
    const cb = new URL(callback(value));
    cb.searchParams.delete("client_id");
    expect(value.consume(cb.href).clientId).toBe("oaiapp_fixture");
    const other = setup("oaiapp_fixture");
    expect(() => other.consume(callback(other, { client_id: "oaiapp_other" }))).toThrow(
      "REGISTRATION_MISMATCH",
    );
  });
  it("requires a code and handles denial before exchange", () => {
    const denied = setup();
    expect(() => denied.consume(callback(denied, { error: "access_denied" }))).toThrow(
      "AUTH_DENIED",
    );
    const failed = setup();
    expect(() => failed.consume(callback(failed, { error: "server_error" }))).toThrow(
      "AUTH_FAILED",
    );
    const missing = setup();
    expect(() => missing.consume(callback(missing, { code: "" }))).toThrow("AUTH_CODE_MISSING");
  });
  it("expires and cancels attempts", () => {
    let now = 0;
    const value = createAuthorizationAttempt({ hostId, redirectUri }, () => now);
    now = AUTH_TTL;
    expect(() => value.consume(callback(value))).toThrow("AUTH_ATTEMPT_EXPIRED");
    const cancelled = setup();
    cancelled.cancel();
    expect(() => cancelled.consume(callback(cancelled))).toThrow("AUTH_ATTEMPT_EXPIRED");
  });
});
