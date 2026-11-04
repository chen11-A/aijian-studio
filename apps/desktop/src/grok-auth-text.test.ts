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

  it("logs a successful text call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aivora-agents-ok-"));
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
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        output: [{ content: [{ type: "output_text", text: "导演拆好了" }] }],
        access_token: "secret-token",
      }),
    );
    const runtime = createGrokRuntime({
      store,
      fetch: fetch as unknown as Fetch,
      openBrowser: async () => undefined,
      confirmSignIn: async () => true,
      agentLog: log,
    });
    const result = await runtime.completeText({
      model: "grok-4.7",
      text: "把这一场拆成镜头",
      projectId: `prj_${"a".repeat(32)}`,
      idempotencyKey: "once",
    });
    expect(result.kind).toBe("OK");
    runtime.recordAgent?.({
      agent: "director",
      model: "grok-4.7",
      status: "ok",
      parsed: "shots",
      detail: "导演拆好了",
    });
    await vi.waitFor(async () => {
      const written = await readFile(join(directory, "logs", "agents.log"), "utf8");
      expect(written).toContain("responses");
      expect(written).toContain("director");
      expect(written).toContain("shots");
      expect(written).not.toContain("secret-token");
      expect(written).not.toContain("access-token-value");
    });
  });

  it("accepts a stream that keeps sending for 100 seconds", async () => {
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      const fetch = vi.fn(async () => {
        const stream = new ReadableStream({
          async start(controller) {
            for (let index = 0; index < 10; index += 1) {
              await new Promise((resolve) => setTimeout(resolve, 10_000));
              controller.enqueue(
                encoder.encode(
                  `data: {"type":"response.output_text.delta","delta":"镜头${index}"}\n\n`,
                ),
              );
            }
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      });
      const pending = completeGrokText(fetch as unknown as Fetch, {
        accessToken: "token",
        model: "grok-4",
        text: "拆镜头",
        limits: { idleMs: 60_000, totalMs: 5 * 60_000 },
      });
      await vi.advanceTimersByTimeAsync(100_000);
      await expect(pending).resolves.toContain("镜头9");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when a stream stays silent for 60 seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => {
        const stream = new ReadableStream({
          start() {
            /* no bytes and no close */
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      });
      const pending = completeGrokText(fetch as unknown as Fetch, {
        accessToken: "token",
        model: "grok-4",
        text: "拆镜头",
        limits: { idleMs: 60_000, totalMs: 5 * 60_000 },
      });
      const failed = pending.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(60_000);
      const error = await failed;
      expect(error).toBeInstanceOf(GrokTextFailure);
      expect(error).toMatchObject({ code: "STALL_RETRYING" });
      expect((error as GrokTextFailure).attempts[0]?.body).toContain("很久没有新的字");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a long shot list and drops the reasoning summary", async () => {
    const picture = "雨夜巷口她停下脚步，霓虹倒映在积水里。".repeat(28);
    const shots = Array.from({ length: 6 }, (_, index) => ({
      picture: `${picture}镜头${index + 1}`,
      size: index % 2 === 0 ? "近景" : "特写",
      seconds: 3,
      line: "雨太大，我听不清。",
      speaker: index % 2 === 0 ? "林雨" : "刀疤",
      performance: "皱眉，抬眼，手抓紧伞柄。呼吸停一下再开口。",
      characters: ["林雨", "刀疤"],
    }));
    const reply = JSON.stringify({ shots });
    expect(reply.length).toBeGreaterThan(3000);
    const reasoning = "正在按短剧导演规则拆解这一场戏。将用 JSON 输出镜头分镜。已细化四镜结构。";
    const encoder = new TextEncoder();
    const events = [
      ...reasoning.match(/.{1,18}/g)!.map((delta) => ({
        type: "response.reasoning_summary_text.delta",
        delta,
      })),
      ...reply.match(/.{1,180}/g)!.map((delta) => ({ type: "response.output_text.delta", delta })),
      { type: "response.output_text.done", text: reply },
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "reasoning",
              summary: [{ type: "summary_text", text: reasoning }],
            },
            { type: "message", content: [{ type: "output_text", text: reply }] },
          ],
          output_text: reply,
        },
      },
    ];
    const seen: string[] = [];
    const fetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const text = await completeGrokText(fetch as unknown as Fetch, {
      accessToken: "token",
      model: "grok-4.7",
      text: "把这一场拆成镜头",
      onProgress: (partial) => seen.push(partial),
    });
    expect(text).toBe(reply);
    expect(text).not.toContain("正在按短剧");
    expect(seen.every((partial) => !partial.includes("正在按短剧"))).toBe(true);
    const parsed = JSON.parse(text) as { shots: { picture: string; speaker: string }[] };
    expect(parsed.shots).toHaveLength(6);
    expect(parsed.shots[0]?.picture.length).toBeGreaterThan(100);
    expect(parsed.shots[0]?.speaker).toBe("林雨");
    expect(parsed.shots[5]?.speaker).toBe("刀疤");
  });

  it("does not cut a JSON reply that is longer than 800 characters", async () => {
    const picture = "巷".repeat(1200);
    const body = { shots: [{ picture, size: "近景", seconds: 3 }] };
    const fetch = vi.fn(async () => jsonResponse(200, body));
    const text = await completeGrokText(fetch as unknown as Fetch, {
      accessToken: "token",
      model: "grok-4.7",
      text: "拆镜头",
    });
    expect(text.length).toBeGreaterThan(800);
    expect(JSON.parse(text).shots[0].picture).toBe(picture);
  });

  it("does not pretend a packaged build is signed in", async () => {
    const previous = process.env.AIVORA_SLOW_TEXT_FIXTURE;
    process.env.AIVORA_SLOW_TEXT_FIXTURE = "1";
    try {
      const runtime = createGrokRuntime({
        store: {
          available: () => false,
          read: async () => null,
          write: async () => undefined,
          clear: async () => undefined,
        },
        fetch: vi.fn() as unknown as Fetch,
        openBrowser: async () => undefined,
        confirmSignIn: async () => true,
        packaged: true,
      });
      expect((await runtime.status()).state).toBe("NOT_CONNECTED");
    } finally {
      if (previous === undefined) delete process.env.AIVORA_SLOW_TEXT_FIXTURE;
      else process.env.AIVORA_SLOW_TEXT_FIXTURE = previous;
    }
  });

  it("cancels only the latest text call", async () => {
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
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const runtime = createGrokRuntime({
      store: {
        available: () => true,
        read: async () => session,
        write: async () => undefined,
        clear: async () => undefined,
      },
      fetch: fetch as unknown as Fetch,
      openBrowser: async () => undefined,
      confirmSignIn: async () => true,
    });
    const first = runtime.completeText({ model: "grok-4.7", text: "先写这一场" });
    const second = runtime.completeText({ model: "grok-4.7", text: "再写下一场" });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    runtime.cancelWork();
    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.aborted).toBe(true);
    runtime.cancelWork();
    expect(signals[0]?.aborted).toBe(true);
    await Promise.allSettled([first, second]);
  });

  it("redacts a bearer token and keeps a short status", () => {
    expect(redactSecrets("bearer abc.def model missing")).toBe("[redacted] model missing");
    expect(GrokTextFailure).toBeTruthy();
  });
});
