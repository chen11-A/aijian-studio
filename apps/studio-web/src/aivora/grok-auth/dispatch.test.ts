import { describe, expect, it, vi } from "vitest";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import { dispatchGrokLoginText } from "./dispatch";
import { GROK_ENTITLEMENT_MESSAGE } from "./transport";

describe("Grok login text dispatch", () => {
  it("returns grok_login on success and a Chinese API-key fallback on 403", async () => {
    const bridge: GrokLoginBridge = {
      status: vi.fn(),
      signIn: vi.fn(),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(),
      completeText: vi
        .fn()
        .mockResolvedValueOnce({
          kind: "OK",
          text: "草稿",
          billingAccountKind: "grok_login",
          model: "grok-4",
        })
        .mockResolvedValueOnce({
          kind: "ERROR",
          code: "ENTITLEMENT_DENIED",
          billingAccountKind: "grok_login",
        }),
    };
    expect(await dispatchGrokLoginText(bridge, { model: "grok-4", text: "hello" })).toMatchObject({
      kind: "OK",
      billingAccountKind: "grok_login",
      text: "草稿",
    });
    const denied = await dispatchGrokLoginText(bridge, { model: "grok-4", text: "hello" });
    expect(denied).toMatchObject({
      kind: "ERROR",
      code: "ENTITLEMENT_DENIED",
      billingAccountKind: "grok_login",
    });
    expect(denied.message).toBe(GROK_ENTITLEMENT_MESSAGE);
    expect(denied.message).toContain("API Key");
    expect(await dispatchGrokLoginText(undefined, { model: "grok-4", text: "hello" })).toMatchObject({
      kind: "UNAVAILABLE",
      code: "DESKTOP_REQUIRED",
      billingAccountKind: "grok_login",
    });
  });
});
