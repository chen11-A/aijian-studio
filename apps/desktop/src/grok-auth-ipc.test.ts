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
    expect(runtime.completeText).toHaveBeenCalledExactlyOnceWith({
      model: "grok-4",
      text: "hello",
    });
    await expect(handlers.get("grok-auth:text")?.(true, { model: "grok-4" })).rejects.toThrow(
      "Invalid",
    );
  });
});
