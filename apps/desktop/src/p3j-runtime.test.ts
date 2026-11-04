import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentLog } from "./agent-log";
import { completeGrokText, type Fetch } from "./grok-auth-http";
import { createGrokRuntime } from "./grok-auth-runtime";
import { requestStill, safeExportName } from "./film-library";
import { registerFilmLibraryHandlers, type FilmLibraryHost } from "./film-library-ipc";

// Correct-behavior regressions for audit P1-02/03/08/09 and P2-05.
describe("phase3j desktop regressions", () => {
  it("persists metadata only, never provider bodies, credentials, or novel prose", async () => {
    const directory = await mkdtemp(join(tmpdir(), "p3j-log-"));
    const path = join(directory, "agents.log");
    const log = createAgentLog(path);
    const body =
      '{"apiKey":"FAKE_ONLY","Cookie":"session=FAKE_ONLY","url":"https://example.invalid/?X-Amz-Signature=FAKE_ONLY","novel":"原创回归小说正文"}';
    log.write({
      agent: "director",
      model: "grok-4.7",
      endpoint: "responses",
      httpStatus: 200,
      parsed: "text",
      body,
      responseChars: body.length,
    });
    await vi.waitFor(async () => {
      const written = await readFile(path, "utf8");
      expect(written).not.toMatch(/FAKE_ONLY|apiKey|Cookie|Signature|原创|body/);
      expect(JSON.parse(written)).toMatchObject({
        agent: "director",
        model: "grok-4.7",
        responseChars: body.length,
      });
    });
  });

  it.each([8001, 20_000, 100_000])(
    "sends the entire %i-character request without the old 8000 limit",
    async (length) => {
      const text = "文".repeat(length);
      const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body)).input).toBe(text);
        return Response.json({ output_text: "完成" });
      });
      const runtime = createGrokRuntime({
        store: {
          available: () => true,
          read: async () => ({
            version: 1,
            accessToken: "fake",
            refreshToken: "fake-refresh",
            expiresAt: Date.now() + 3600000,
            scopes: [],
            subject: "fixture",
            email: null,
            name: null,
            inferenceDenied: false,
          }),
          write: async () => undefined,
          clear: async () => undefined,
        },
        fetch: fetcher,
        openBrowser: async () => undefined,
        confirmSignIn: async () => true,
      });
      expect(await runtime.completeText({ model: "grok-4.7", text })).toMatchObject({
        kind: "OK",
        text: "完成",
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(
        await runtime.completeText({ model: "grok-4.7", text: `${"文".repeat(100_000)}多` }),
      ).toMatchObject({ kind: "ERROR", code: "TEXT_REJECTED" });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("times out before headers even when the transport never settles", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      const fetcher: Fetch = (_url, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => undefined);
      };
      const failed = completeGrokText(fetcher, {
        accessToken: "fake",
        model: "grok-4.7",
        text: "fixture",
        limits: { idleMs: 50, totalMs: 10 },
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      expect(await failed).toMatchObject({ code: "TEXT_TIMEOUT" });
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces total deadline while a body is silent, before its idle timeout", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel })));
      const failed = completeGrokText(fetcher, {
        accessToken: "fake",
        model: "grok-4.7",
        text: "fixture",
        limits: { idleMs: 100, totalMs: 10 },
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      expect(await failed).toMatchObject({ code: "TEXT_TIMEOUT" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send a request that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await expect(
      completeGrokText(fetcher, {
        accessToken: "fake",
        model: "grok-4.7",
        text: "fixture",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "TEXT_CANCELLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses one total deadline across headers, body, and the compatibility retry", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return Response.json({ error: "unsupported" }, { status: 404 });
      });
      const failed = completeGrokText(fetcher, {
        accessToken: "fake",
        model: "grok-4.7",
        text: "fixture",
        limits: { idleMs: 50, totalMs: 10 },
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      expect(await failed).toMatchObject({ code: "TEXT_TIMEOUT" });
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a stalled body promptly and releases timers", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const cancel = vi.fn();
      const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel })));
      const failed = completeGrokText(fetcher, {
        accessToken: "fake",
        model: "grok-4.7",
        text: "fixture",
        signal: controller.signal,
        limits: { idleMs: 50, totalMs: 100 },
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1);
      controller.abort();
      expect(await failed).toMatchObject({ code: "TEXT_CANCELLED" });
      await vi.advanceTimersByTimeAsync(1);
      expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "CON",
    "NUL",
    "PRN",
    "AUX",
    "COM1",
    "LPT9",
    "con.mp4",
    "NUL.backup",
    "COM¹",
    "LPT²",
    "CON... ",
  ])("exports reserved Windows name %s safely", (name) => {
    const result = safeExportName(name);
    expect(result).toMatch(/^_.+\.mp4$/);
    expect(result).not.toMatch(/[. ]$/);
  });

  it("includes each reference in the actual image editing request", async () => {
    const references = Array.from(
      { length: 5 },
      (_, index) => `https://example.invalid/portrait-${index}.png`,
    );
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.x.ai/v1/images/edits");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        images: references.map((url) => ({ type: "image_url", url })),
        aspect_ratio: "16:9",
      });
      return new Response(null, { status: 400 });
    });
    await requestStill({
      prompt: "fixture",
      token: "fake",
      destination: "/unused",
      aspectRatio: "16:9",
      references,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const rejected = await requestStill({
      prompt: "fixture",
      token: "fake",
      destination: "/unused",
      references: [...references, "https://example.invalid/six.png"],
      fetcher,
    });
    expect(rejected.reason).toContain("最多支持 5 张");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("carries local portraits through IPC and rejects an out-of-root image", async () => {
    const root = await mkdtemp(join(tmpdir(), "p3j-images-"));
    const outside = await mkdtemp(join(tmpdir(), "p3j-outside-"));
    const image = join(root, "portrait.png");
    const foreign = join(outside, "private.png");
    await writeFile(image, "synthetic-png-bytes");
    await writeFile(foreign, "not-to-be-sent");
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).images).toEqual([
        {
          type: "image_url",
          url: `data:image/png;base64,${Buffer.from("synthetic-png-bytes").toString("base64")}`,
        },
      ]);
      return new Response(null, { status: 400 });
    });
    const logStill = vi.fn();
    const host: FilmLibraryHost = {
      logStill,
      filmsRoot: () => root,
      storyFilmsRoot: () => root,
      runFfmpeg: async () => undefined,
      mediaToken: async () => "fake",
      fetcher,
      pickDirectory: async () => null,
      copyFile: async () => undefined,
      reveal: () => undefined,
      open: async () => "",
    };
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerFilmLibraryHandlers(
      (channel, handler) => handlers.set(channel, handler),
      (event: boolean) => event,
      host,
    );
    const still = handlers.get("film:still");
    await still?.(true, "film_series0000000001", "fixture", "16:9", [image]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(logStill).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImageCount: 1,
        requestChars: 7,
        durationMs: expect.any(Number),
      }),
    );
    expect(
      await still?.(true, "film_series0000000001", "fixture", "16:9", [foreign]),
    ).toMatchObject({ path: "", reason: "参考图无法读取，请重新选择。" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("keeps debug off by default and only logs reference counts with explicit debug", async () => {
  const root = await mkdtemp(join(tmpdir(), "p3j-debug-"));
  const path = join(root, "agent.log");
  const entry = {
    model: "grok-4.7",
    endpoint: "image-edit",
    httpStatus: 200,
    body: "secret novel prompt",
    referenceImageCount: 5,
    requestChars: 100,
    durationMs: 10,
  };
  createAgentLog(path).write(entry);
  await vi.waitFor(async () =>
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      referenceImageCount: 5,
      requestChars: 100,
      durationMs: 10,
    }),
  );
  expect(await readFile(path, "utf8")).not.toContain('"debug"');
  createAgentLog(path, { debug: true }).write(entry);
  await vi.waitFor(async () =>
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(2),
  );
  const written = await readFile(path, "utf8");
  expect(written).toContain('"debug":true');
  expect(written).not.toContain("secret novel prompt");
});

it("does not include video reference declarations in first-frame prompts", async () => {
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.prompt).toBe("雨夜书店。");
    expect(body.images).toEqual([{ type: "image_url", url: "https://example.invalid/face.png" }]);
    return new Response(null, { status: 400 });
  });
  await requestStill({
    prompt: "<IMAGE_1> 是人物的定妆照。雨夜书店。",
    token: "synthetic",
    destination: "/unused",
    references: ["https://example.invalid/face.png"],
    fetcher,
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
