import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authorizeGrokInBrowser } from "./grok-auth-callback";
import { createGrokRuntime } from "./grok-auth-runtime";
import { GROK_CLIENT_ID } from "./grok-auth-oauth";
import { createGrokStore, type GrokEncryption, type GrokSession } from "./grok-auth-storage";

type Seen = { method: string; url: string; body: string };

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function mockOAuth() {
  const seen: Seen[] = [];
  let refresh = "refresh-1";
  let access = "access-1";
  let modelsStatus = 200;
  let textStatus = 200;
  let revoked = "";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : "";
    seen.push({ method: request.method ?? "", url: request.url ?? "", body });
    if (url.pathname === "/oauth2/authorize") {
      const redirect = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      response.writeHead(302, { location: `${redirect}?code=auth-code&state=${state}` }).end();
      return;
    }
    if (url.pathname === "/oauth2/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        if (form.get("refresh_token") !== refresh) {
          response.writeHead(400).end("{}");
          return;
        }
        refresh = "refresh-2";
        access = "access-2";
      } else if (form.get("code") !== "auth-code" || form.get("client_id") !== GROK_CLIENT_ID) {
        response.writeHead(400).end("{}");
        return;
      }
      json(response, {
        access_token: access,
        refresh_token: refresh,
        expires_in: 7200,
        scope: "openid offline_access",
      });
      return;
    }
    if (url.pathname === "/oauth2/revoke") {
      revoked = new URLSearchParams(body).get("token") ?? "";
      response.writeHead(200).end();
      return;
    }
    if (url.pathname === "/oauth2/userinfo") {
      json(response, { sub: "grok-user", email: "person@example.test", name: "Persona" });
      return;
    }
    if (url.pathname === "/v1/models") {
      if (modelsStatus !== 200) {
        response.writeHead(modelsStatus).end("{}");
        return;
      }
      json(response, { data: [{ id: "grok-4", name: "Grok 4" }] });
      return;
    }
    if (url.pathname === "/v1/responses") {
      if (textStatus !== 200) {
        response.writeHead(textStatus).end("{}");
        return;
      }
      json(response, { output_text: "fixture reply" });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock address");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    seen,
    revoked: () => revoked,
    setModelsStatus(status: number) {
      modelsStatus = status;
    },
    setTextStatus(status: number) {
      textStatus = status;
    },
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
}

function memoryStore() {
  let session: GrokSession | null = null;
  return {
    available: () => true,
    read: async () => session,
    write: async (value: GrokSession) => {
      session = structuredClone(value);
    },
    clear: async () => {
      session = null;
    },
    current: () => session,
  };
}

describe("Grok subscription login against a mock OAuth server", () => {
  it("logs in with loopback PKCE, rotates refresh, signs out, and falls back on inference 403", async () => {
    const oauth = await mockOAuth();
    const store = memoryStore();
    let clock = 1_700_000_000_000;
    const runtime = createGrokRuntime({
      store,
      fetch: globalThis.fetch,
      openBrowser: async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error("authorize redirect failed");
      },
      confirmSignIn: async () => true,
      endpoints: {
        token: `${oauth.base}/oauth2/token`,
        revoke: `${oauth.base}/oauth2/revoke`,
        userinfo: `${oauth.base}/oauth2/userinfo`,
        api: `${oauth.base}/v1`,
      },
      authorizeEndpoint: `${oauth.base}/oauth2/authorize`,
      loopbackPort: 0,
      authorize: authorizeGrokInBrowser,
      now: () => clock,
    });
    try {
      const signedIn = await runtime.signIn();
      expect(signedIn).toMatchObject({
        kind: "OK",
        status: { state: "CONNECTED", accountLabel: "person@example.test" },
      });
      expect(JSON.stringify(signedIn)).not.toMatch(/access-1|refresh-1/);
      const authorize = oauth.seen.find((item) => item.url.startsWith("/oauth2/authorize"));
      const authorizeParams = new URL(authorize?.url ?? "/", oauth.base).searchParams;
      expect(authorizeParams.get("client_id")).toBe(GROK_CLIENT_ID);
      expect(authorizeParams.get("code_challenge_method")).toBe("S256");
      expect(authorizeParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      const exchanged = oauth.seen.find((item) => item.body.includes("grant_type=authorization_code"));
      expect(exchanged?.body).toContain("code_verifier=");
      const listed = await runtime.models();
      expect(listed).toEqual({ kind: "OK", models: [{ id: "grok-4", label: "Grok 4" }] });
      expect(store.current()?.refreshToken).toBe("refresh-1");

      clock += 7200 * 1000;
      expect(await runtime.models()).toMatchObject({ kind: "OK" });
      expect(store.current()?.refreshToken).toBe("refresh-2");
      expect(store.current()?.accessToken).toBe("access-2");
      const refresh = oauth.seen.filter((item) => item.body.includes("grant_type=refresh_token"));
      expect(refresh.some((item) => item.body.includes("refresh_token=refresh-1"))).toBe(true);

      oauth.setTextStatus(403);
      const denied = await runtime.completeText({ model: "grok-4", text: "ping" });
      expect(denied).toEqual({
        kind: "ERROR",
        code: "ENTITLEMENT_DENIED",
        billingAccountKind: "grok_login",
      });
      expect((await runtime.status()).state).toBe("ENTITLEMENT_DENIED");
      const posted = oauth.seen.find((item) => item.url.startsWith("/v1/responses"));
      expect(posted?.body).toContain('"store":false');

      expect(await runtime.signOut()).toMatchObject({ kind: "OK", status: { state: "NOT_CONNECTED" } });
      expect(oauth.revoked()).toBe("refresh-2");
      expect(store.current()).toBeNull();
      expect(await runtime.models()).toMatchObject({ kind: "ERROR", code: "NOT_CONNECTED" });
    } finally {
      await oauth.close();
    }
  });

  it("keeps a saved session when the model directory returns 403", async () => {
    const oauth = await mockOAuth();
    oauth.setModelsStatus(403);
    const store = memoryStore();
    const runtime = createGrokRuntime({
      store,
      fetch: globalThis.fetch,
      openBrowser: (url) => fetch(url).then(() => undefined),
      confirmSignIn: async () => true,
      endpoints: {
        token: `${oauth.base}/oauth2/token`,
        revoke: `${oauth.base}/oauth2/revoke`,
        userinfo: `${oauth.base}/oauth2/userinfo`,
        api: `${oauth.base}/v1`,
      },
      authorizeEndpoint: `${oauth.base}/oauth2/authorize`,
      loopbackPort: 0,
      authorize: authorizeGrokInBrowser,
    });
    try {
      expect(await runtime.signIn()).toMatchObject({
        kind: "OK",
        status: { state: "ENTITLEMENT_DENIED", accountLabel: "person@example.test" },
      });
      expect(store.current()?.inferenceDenied).toBe(true);
      expect(oauth.seen.some((item) => item.url.startsWith("/v1/responses"))).toBe(false);
    } finally {
      await oauth.close();
    }
  });

  it("does not open the browser when secure storage is the plaintext fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-auth-"));
    const encryption: GrokEncryption = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "basic_text",
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString("utf8"),
    };
    const store = createGrokStore(directory, encryption);
    const runtime = createGrokRuntime({
      store,
      fetch: globalThis.fetch,
      openBrowser: async () => {
        throw new Error("browser opened");
      },
      confirmSignIn: async () => true,
    });
    try {
      expect(store.available()).toBe(false);
      expect(await runtime.signIn()).toMatchObject({ kind: "ERROR", code: "SECURE_STORAGE_UNAVAILABLE" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
