import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentLog, redactSecrets } from "./agent-log";
import { completeGrokText, GrokTextFailure, type Fetch } from "./grok-auth-http";
import { createGrokRuntime } from "./grok-auth-runtime";
import type { GrokSession, GrokStore } from "./grok-auth-storage";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Grok text calls", () => {
  it("reads a nested reply that includes a newline", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/responses");
      return jsonResponse(200, {
        output: [{ content: [{ type: "output_text", text: '{\n"shots":[]\n}' }] }],
      });
    });
    const text = await completeGrokText(fetch as unknown as Fetch, {
      accessToken: "token",
      model: "grok-4",
      text: "拆镜头",
    });
    expect(text).toContain("shots");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a plain chat completion before giving up", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith("/responses")) {
        return jsonResponse(404, { error: "missing", access_token: "secret-token" });
      }
      return jsonResponse(200, { choices: [{ message: { content: "plain reply" } }] });
    });
    const text = await completeGrokText(fetch as unknown as Fetch, {
      accessToken: "token",
      model: "grok-4",
      text: "拆镜头",
    });
    expect(text).toBe("plain reply");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("logs both failures without the token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aivora-agents-"));
    const log = createAgentLog(join(directory, "logs", "agents.log"));
    const session: GrokSession = {
      version: 1,
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid"],
      subject: "person",
      email: null,
      name: null,
      inferenceDenied: false,
    };
    const store: GrokStore = {
      available: () => true,
      read: async () => session,
      write: async () => undefined,
      clear: async () => undefined,
    };
    const fetch = vi.fn(async (url: string) =>
      jsonResponse(String(url).endsWith("/responses") ? 404 : 400, {
        error: "no text",
        access_token: "secret-token",
        authorization: "bearer access-token-value",
      }),
    );
    const runtime = createGrokRuntime({
      store,
      fetch: fetch as unknown as Fetch,
      openBrowser: async () => undefined,
      confirmSignIn: async () => true,
      agentLog: log,
    });
    const result = await runtime.completeText({ model: "grok-4", text: "ping" });
    expect(result).toMatchObject({
      kind: "ERROR",
      code: "TEXT_FAILED",
      httpStatus: 400,
    });
    if (result.kind === "ERROR") expect(result.detail).toContain("已改用普通对话再试过");
    await vi.waitFor(async () => {
      const written = await readFile(join(directory, "logs", "agents.log"), "utf8");
      expect(written).toContain("responses");
      expect(written).toContain("chat");
      expect(written).not.toContain("secret-token");
      expect(written).not.toContain("access-token-value");
    });
  });

  it("redacts a bearer token and keeps a short status", () => {
    expect(redactSecrets("bearer abc.def model missing")).toBe("[redacted] model missing");
    expect(GrokTextFailure).toBeTruthy();
  });
});
