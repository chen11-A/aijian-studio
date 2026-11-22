import { describe, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { registerGrokHandlers } from "./grok-auth-ipc";

describe("Grok login IPC", () => {
  it("rejects a foreign sender and any extra argument before calling the runtime", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const runtime: GrokLoginBridge = {
      status: vi.fn(),
      signIn: vi.fn(),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(),
      completeText: vi.fn(),
    };
    registerGrokHandlers(
      (channel, callback) => handlers.set(channel, callback),
      (event: boolean) => event,
      () => runtime,
    );
    await expect(handlers.get("grok-auth:status")?.(false)).rejects.toThrow("not authorized");
    expect(runtime.status).not.toHaveBeenCalled();
    await expect(handlers.get("grok-auth:sign-in")?.(true, "extra")).rejects.toThrow("Unexpected");
    await handlers.get("grok-auth:text")?.(true, { model: "grok-4", text: "hello" });
    expect(runtime.completeText).toHaveBeenCalledOnce();
    const sent = (
      runtime.completeText as unknown as {
        mock: { calls: { model: string; text: string; onProgress?: unknown }[][] };
      }
    ).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ model: "grok-4", text: "hello" });
    expect(typeof sent?.onProgress).toBe("function");
    await expect(handlers.get("grok-auth:text")?.(true, { model: "grok-4" })).rejects.toThrow(
      "Invalid",
    );
  });

  it("requires the exact speech adapter when supplied and never forwards it to runtime", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const speak = vi.fn<NonNullable<GrokLoginBridge["speak"]>>();
    const runtimeFor = vi.fn((): GrokLoginBridge => ({
      status: vi.fn(),
      signIn: vi.fn(),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(),
      completeText: vi.fn(),
      speak,
    }));
    registerGrokHandlers(
      (channel, callback) => handlers.set(channel, callback),
      (event: boolean) => event,
      runtimeFor,
    );
    const speech = handlers.get("grok-auth:speech")!;
    const request = {
      voiceId: "leo",
      text: "雨太大。",
      projectId: "prj_example",
      idempotencyKey: "local-test",
      speed: 0.85,
    };
    const selected = { provider: "GROK_LOGIN", modelId: "grok-tts" };
    await expect(speech(false, { ...request, speechSelection: selected })).rejects.toThrow(
      "not authorized",
    );
    await expect(speech(true, { ...request, model: "grok-tts" })).rejects.toThrow("Invalid");
    for (const speechSelection of [
      { provider: "GROK_LOGIN", modelId: "eve" },
      { provider: "XAI_API", modelId: "grok-tts" },
      { provider: "CHATGPT_OFFICIAL", modelId: "grok-tts" },
      { provider: "CONNECTION", modelId: "grok-tts", connectionId: "conn" },
      { ...selected, connectionId: "conn" },
      { ...selected, endpoint: "https://example.invalid" },
      { ...selected, voiceId: "eve" },
      null,
      undefined,
      [],
    ]) {
      await expect(speech(true, { ...request, speechSelection })).resolves.toMatchObject({
        kind: "ERROR",
        code: "SPEECH_MODEL_UNSUPPORTED",
        detail: expect.stringContaining("模型中心"),
      });
    }
    expect(runtimeFor).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();

    await speech(true, request);
    await speech(true, { ...request, speechSelection: selected });
    expect(runtimeFor).toHaveBeenCalledTimes(2);
    expect(speak.mock.calls).toEqual([[request], [request]]);
  });

  it("serves a text-only Grok catalog only for an unpackaged screenshot launch", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const runtime: GrokLoginBridge = {
      status: vi.fn(),
      signIn: vi.fn(),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(),
      completeText: vi.fn(),
    };
    registerGrokHandlers(
      (channel, callback) => handlers.set(channel, callback),
      () => true,
      () => runtime,
    );
    const previous = process.env.AIVORA_SCREENSHOT_GROK;
    const processWithDefault = process as NodeJS.Process & { defaultApp?: boolean };
    const previousDefault = processWithDefault.defaultApp;
    process.env.AIVORA_SCREENSHOT_GROK = "text-only";
    try {
      await handlers.get("grok-auth:status")?.(true);
      expect(runtime.status).toHaveBeenCalledOnce();

      processWithDefault.defaultApp = true;
      const status = await handlers.get("grok-auth:status")?.(true);
      const models = await handlers.get("grok-auth:models")?.(true);
      const text = await handlers.get("grok-auth:text")?.(true, { model: "grok-4.7", text: "hi" });
      expect(status).toMatchObject({
        state: "CONNECTED",
        runtime: "DESKTOP",
        accountLabel: "grok-user@example.com",
      });
      expect(models).toEqual({ kind: "OK", models: [{ id: "grok-4.7", label: "grok-4.7" }] });
      expect(text).toEqual({
        kind: "ERROR",
        code: "SCREENSHOT_ONLY",
        billingAccountKind: "grok_login",
      });
      expect(runtime.models).not.toHaveBeenCalled();
      expect(runtime.completeText).not.toHaveBeenCalled();
    } finally {
      processWithDefault.defaultApp = previousDefault;
      if (previous === undefined) delete process.env.AIVORA_SCREENSHOT_GROK;
      else process.env.AIVORA_SCREENSHOT_GROK = previous;
    }
  });
});
