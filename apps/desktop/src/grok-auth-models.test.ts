import { describe, expect, it } from "vitest";
import { listGrokCatalog, listGrokModels } from "./grok-auth-http";
import { createGrokRuntime } from "./grok-auth-runtime";
import type { GrokSession } from "./grok-auth-storage";

const endpoints = {
  token: "https://auth.example.test/token",
  revoke: "https://auth.example.test/revoke",
  userinfo: "https://auth.example.test/userinfo",
  api: "https://api.example.test/v1",
};

describe("Grok model catalog", () => {
  it("keeps output modalities from the live list and skips entries without an id", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "grok-4.7", name: "Grok 4.7" },
            {
              id: "grok-imagine-image-2.0",
              name: "Grok Imagine Image 2.0",
              output_modalities: ["image"],
            },
            { name: "missing id" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await expect(listGrokModels(fetch, "token", endpoints)).resolves.toEqual([
      { id: "grok-4.7", label: "Grok 4.7" },
      {
        id: "grok-imagine-image-2.0",
        label: "Grok Imagine Image 2.0",
        outputModalities: ["image"],
      },
    ]);
  });

  it("fills image and video from their own lists and does not treat voices as models", async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      expect(url).not.toMatch(/images\/generations|videos\/generations|\/tts$/);
      if (url.endsWith("/models")) {
        return json({ data: [{ id: "grok-4.7", name: "Grok 4.7" }] });
      }
      if (url.endsWith("/language-models")) {
        return json({ models: [{ id: "grok-4.3", name: "Grok 4.3" }] });
      }
      if (url.endsWith("/image-generation-models")) {
        return json({ models: [{ id: "grok-imagine-image-2.0", name: "Grok Imagine Image 2.0" }] });
      }
      if (url.endsWith("/video-generation-models")) {
        return json({
          models: [
            {
              id: "grok-imagine-video-1.5",
              name: "Grok Imagine Video 1.5",
              output_modalities: ["video"],
            },
          ],
        });
      }
      if (url.endsWith("/tts/voices")) {
        return json({ voices: [{ voice_id: "eve" }] });
      }
      return new Response("missing", { status: 404 });
    };
    const listed = await listGrokCatalog(fetch, "token", endpoints);
    expect(listed.models).toEqual([
      { id: "grok-4.7", label: "Grok 4.7" },
      { id: "grok-4.3", label: "Grok 4.3" },
      {
        id: "grok-imagine-image-2.0",
        label: "Grok Imagine Image 2.0",
        outputModalities: ["image"],
      },
      {
        id: "grok-imagine-video-1.5",
        label: "Grok Imagine Video 1.5",
        outputModalities: ["video"],
      },
    ]);
    expect(listed.notices).toEqual([{ capability: "SPEECH", reason: "voices", httpStatus: 200 }]);
    expect(JSON.stringify(listed.models)).not.toContain("eve");
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  });

  it("records a permission denial without inventing image or video models", async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/models")) return json({ data: [{ id: "grok-4.7", name: "Grok 4.7" }] });
      if (url.endsWith("/language-models")) return new Response("{}", { status: 404 });
      return new Response("{}", { status: 403 });
    };
    const listed = await listGrokCatalog(fetch, "token", endpoints);
    expect(listed.models).toEqual([{ id: "grok-4.7", label: "Grok 4.7" }]);
    expect(listed.notices).toEqual([
      { capability: "IMAGE", reason: "denied", httpStatus: 403 },
      { capability: "VIDEO", reason: "denied", httpStatus: 403 },
      { capability: "SPEECH", reason: "denied", httpStatus: 403 },
    ]);
    expect(listed.reports.map((report) => report.outcome)).toEqual(["denied", "denied", "denied"]);
  });

  it("stays quiet when an image listing route is absent", async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/models")) return json({ data: [{ id: "grok-4.7" }] });
      if (url.endsWith("/image-generation-models")) return new Response("nope", { status: 404 });
      if (url.endsWith("/video-generation-models")) return json({ models: [] });
      if (url.endsWith("/tts/voices")) return new Response("nope", { status: 404 });
      return new Response("nope", { status: 404 });
    };
    const listed = await listGrokCatalog(fetch, "token", endpoints);
    expect(listed.models).toEqual([{ id: "grok-4.7", label: "grok-4.7" }]);
    expect(listed.notices).toEqual([{ capability: "VIDEO", reason: "none", httpStatus: 200 }]);
    expect(listed.reports.find((report) => report.capability === "IMAGE")).toMatchObject({
      outcome: "missing",
      httpStatus: 404,
    });
  });

  it("logs the media HTTP status and never the access token", async () => {
    const token = "secret-access-token";
    const events: { event: string; fields?: { code?: string; httpStatus?: number } }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      expect(url).not.toContain(token);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      expect(init?.method ?? "GET").toBe("GET");
      if (url.endsWith("/models")) return json({ data: [{ id: "grok-4.7", name: "Grok 4.7" }] });
      if (url.endsWith("/language-models")) return new Response("{}", { status: 404 });
      if (url.endsWith("/image-generation-models")) return new Response("{}", { status: 403 });
      if (url.endsWith("/video-generation-models")) return new Response("{}", { status: 401 });
      if (url.endsWith("/tts/voices")) return json({ voices: [{ voice_id: "ara" }] });
      throw new Error(`unexpected ${url}`);
    };
    const runtime = createGrokRuntime({
      store: {
        available: () => true,
        read: async () => session(token),
        write: async () => undefined,
        clear: async () => undefined,
      },
      fetch,
      openBrowser: async () => undefined,
      confirmSignIn: async () => false,
      endpoints,
      now: () => Date.now(),
      log: {
        path: "unused",
        event: async (event, fields) => {
          events.push({ event, fields });
        },
      },
    });
    await expect(runtime.models()).resolves.toEqual({
      kind: "OK",
      models: [{ id: "grok-4.7", label: "Grok 4.7" }],
      notices: [
        { capability: "IMAGE", reason: "denied", httpStatus: 403 },
        { capability: "VIDEO", reason: "denied", httpStatus: 401 },
        { capability: "SPEECH", reason: "voices", httpStatus: 200 },
      ],
    });
    expect(events).toEqual(
      expect.arrayContaining([
        { event: "catalog_image", fields: { code: "DENIED", httpStatus: 403 } },
        { event: "catalog_video", fields: { code: "DENIED", httpStatus: 401 } },
        { event: "catalog_speech", fields: { code: "VOICES", httpStatus: 200 } },
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(events)).not.toContain("refresh-secret");
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function session(token: string): GrokSession {
  return {
    version: 1,
    accessToken: token,
    refreshToken: "refresh-secret",
    expiresAt: Date.now() + 86_400_000,
    scopes: ["openid"],
    subject: "user",
    email: "person@example.test",
    name: null,
    inferenceDenied: false,
  };
}
