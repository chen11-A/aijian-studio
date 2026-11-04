import { describe, expect, it, vi } from "vitest";
import { registerChatGPTHandlers } from "./chatgpt-auth-ipc";
import type { ChatGPTBridge } from "@aijian/contracts/chatgpt-auth";
describe("minimal official auth IPC", () => {
  function setup() {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const runtime = {
      status: vi.fn(),
      signIn: vi.fn(),
      cancel: vi.fn(),
      selectProfile: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(),
    };
    const open = vi.fn();
    registerChatGPTHandlers(
      (channel, callback) => handlers.set(channel, callback),
      (valid: boolean) => valid,
      () => runtime as ChatGPTBridge,
      open,
    );
    return { handlers, runtime, open };
  }
  it("rejects all non-owner/subframe calls before constructing a runtime", async () => {
    const { handlers, runtime } = setup();
    for (const handler of handlers.values())
      await expect(handler(false)).rejects.toThrow("sender is not authorized");
    expect(runtime.status).not.toHaveBeenCalled();
    expect(runtime.signIn).not.toHaveBeenCalled();
  });
  it("allows only fixed operations and help topics, with no renderer URL or token API", async () => {
    const { handlers, runtime, open } = setup();
    await handlers.get("chatgpt-auth:sign-in")?.(true, "LOCAL_PERSONAL");
    expect(runtime.signIn).toHaveBeenCalledExactlyOnceWith("LOCAL_PERSONAL", undefined);
    await expect(handlers.get("chatgpt-auth:sign-in")?.(true, "ANY_APP")).rejects.toThrow(
      "Invalid",
    );
    await expect(handlers.get("chatgpt-auth:status")?.(true, "extra")).rejects.toThrow(
      "Unexpected",
    );
    await expect(handlers.get("chatgpt-auth:help")?.(true, "https://evil.example")).rejects.toThrow(
      "Invalid",
    );
    await handlers.get("chatgpt-auth:help")?.(true, "usage");
    expect(open).toHaveBeenCalledExactlyOnceWith("https://chatgpt.com/settings/usage");
    expect([...handlers.keys()]).not.toContain("chatgpt-auth:token");
  });
});

it("routes all fixed read/account commands and rejects malformed selects", async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const runtime = {
    status: vi.fn(),
    signIn: vi.fn(),
    cancel: vi.fn(),
    selectProfile: vi.fn(),
    signOut: vi.fn(),
    models: vi.fn(),
  };
  registerChatGPTHandlers(
    (channel, fn) => handlers.set(channel, fn),
    () => true,
    () => runtime as ChatGPTBridge,
    vi.fn(),
  );
  for (const action of ["status", "cancel", "sign-out", "models"])
    await handlers.get(`chatgpt-auth:${action}`)?.(true);
  expect(runtime.status).toHaveBeenCalledOnce();
  expect(runtime.cancel).toHaveBeenCalledOnce();
  expect(runtime.signOut).toHaveBeenCalledOnce();
  expect(runtime.models).toHaveBeenCalledOnce();
  await handlers.get("chatgpt-auth:select")?.(true, "11111111-1111-4111-8111-111111111111");
  expect(runtime.selectProfile).toHaveBeenCalledOnce();
  await expect(handlers.get("chatgpt-auth:select")?.(true, "bad")).rejects.toThrow("Invalid");
});
