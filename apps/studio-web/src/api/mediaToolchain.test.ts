import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioTransport, type AijianDesktopBridge } from "./studio";
import type { MediaToolchainGateway } from "../aivora/mediaToolchainContract";

afterEach(() => {
  delete window.aijian;
  vi.restoreAllMocks();
});

describe("native media toolchain transport", () => {
  it("provides stable explicit no-argument native calls without adding a renderer path or HTTP route", async () => {
    const native: MediaToolchainGateway = {
      getMediaToolchainStatus: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      selectMediaToolchain: vi.fn().mockResolvedValue({ kind: "PICKER_CANCELLED" }),
      clearMediaToolchain: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    };
    window.aijian = native as AijianDesktopBridge;
    const capability = createStudioTransport().mediaToolchain!;
    expect(capability).toBe(createStudioTransport().mediaToolchain);
    await expect(capability.getMediaToolchainStatus()).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    await expect(capability.selectMediaToolchain()).resolves.toEqual({ kind: "PICKER_CANCELLED" });
    await expect(capability.clearMediaToolchain()).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    for (const method of Object.values(native)) expect(method).toHaveBeenCalledExactlyOnceWith();
  });
  it("keeps missing and partial native capability unavailable rather than guessing readiness", () => {
    expect(createStudioTransport().mediaToolchain).toBeUndefined();
    window.aijian = { getMediaToolchainStatus: vi.fn() } as unknown as AijianDesktopBridge;
    expect(createStudioTransport().mediaToolchain).toBeUndefined();
  });
});
