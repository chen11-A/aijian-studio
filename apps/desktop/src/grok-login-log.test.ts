import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGrokRuntime } from "./grok-auth-runtime";
import type { GrokSession, GrokStore } from "./grok-auth-storage";
import { createGrokLoginLog } from "./grok-login-log";

describe("Grok login log", () => {
  it("writes status codes and drops token-like lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-log-"));
    const log = createGrokLoginLog(join(directory, "logs", "grok-login.log"));
    try {
      await log.event("sign_in_error", { code: "CALLBACK_REJECTED", httpStatus: 400 });
      await log.event("sign_in_error", { code: "access_token=secret-value" });
      await log.event("bearer eyJhbGciOiJub25lIn0.payload.sig");
      const text = await readFile(log.path, "utf8");
      expect(text).toContain('"code":"CALLBACK_REJECTED"');
      expect(text).toContain('"httpStatus":400');
      expect(text).not.toContain("secret-value");
      expect(text).not.toContain("eyJ");
      expect(text).not.toContain("access_token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not write the device code, user code, or tokens from a login", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-log-"));
    const log = createGrokLoginLog(join(directory, "grok-login.log"));
    let polls = 0;
    let clock = 1_700_000_000_000;
    const runtime = createGrokRuntime({
      store: memoryStore(),
      log,
      fetch: async (input, init) => {
        const url = String(input);
        const body = String(init?.body ?? "");
        if (url.endsWith("/device/code")) {
          return Response.json({
            device_code: "device-secret-value",
            user_code: "WDJB-MJHT",
            verification_uri_complete: "https://auth.x.ai/device?user_code=WDJB-MJHT",
            expires_in: 30,
            interval: 1,
          });
        }
        if (url.endsWith("/token")) {
          polls += 1;
          if (polls === 1) {
            return Response.json({ error: "authorization_pending" }, { status: 400 });
          }
          return Response.json({
            access_token: "access-secret-value",
            refresh_token: "refresh-secret-value",
            expires_in: 3600,
            scope: "openid",
          });
        }
        if (url.endsWith("/userinfo")) {
          return Response.json({ sub: "user-1", email: "person@example.test" });
        }
        if (url.endsWith("/models")) {
          return Response.json({ data: [{ id: "grok-4", name: "Grok 4" }] });
        }
        return new Response(body ? "no" : "no", { status: 404 });
      },
      openBrowser: async () => undefined,
      confirmSignIn: async () => true,
      signInMethod: "device",
      deviceCodeEndpoint: "https://auth.x.ai/oauth2/device/code",
      endpoints: {
        token: "https://auth.x.ai/oauth2/token",
        revoke: "https://auth.x.ai/oauth2/revoke",
        userinfo: "https://auth.x.ai/oauth2/userinfo",
        api: "https://api.x.ai/v1",
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    try {
      expect(await runtime.signIn()).toMatchObject({ kind: "OK" });
      const text = await readFile(log.path, "utf8");
      expect(text).toContain("sign_in_ok");
      expect(text).toContain("browser_opened");
      expect(text).not.toContain("device-secret-value");
      expect(text).not.toContain("WDJB-MJHT");
      expect(text).not.toContain("access-secret-value");
      expect(text).not.toContain("refresh-secret-value");
      expect(text).not.toContain("user_code");
      expect(text).not.toContain("device_code");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function memoryStore(): GrokStore {
  let session: GrokSession | null = null;
  return {
    available: () => true,
    read: async () => session,
    write: async (value) => {
      session = structuredClone(value);
    },
    clear: async () => {
      session = null;
    },
  };
}
