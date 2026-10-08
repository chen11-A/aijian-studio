import { describe, expect, test, vi } from "vitest";
import { PRODUCTION_BRIEF_CHANNELS } from "./production-brief-contract";
import {
  registerProductionBriefHandlers,
  resolveProductionBriefTopFrameClient,
} from "./production-brief-ipc";

const projectId = `prj_${"1".repeat(32)}`;
describe("ProductionBrief IPC", () => {
  test("rejects malformed IPC before the client", async () => {
    const listeners = new Map<string, (event: object, ...args: unknown[]) => Promise<unknown>>();
    const client = {
      getProductionBrief: vi.fn(),
      getProductionBriefVersion: vi.fn(),
      createProductionBriefVersion: vi.fn(),
    };
    registerProductionBriefHandlers<object>(
      (channel, listener) => listeners.set(channel, listener),
      () => client,
    );
    await expect(
      listeners.get(PRODUCTION_BRIEF_CHANNELS.create)!({}, projectId, {}),
    ).rejects.toThrow("Invalid");
    await expect(
      listeners.get(PRODUCTION_BRIEF_CHANNELS.get)!({}, projectId, "extra"),
    ).rejects.toThrow("Invalid");
    expect(client.createProductionBriefVersion).not.toHaveBeenCalled();
  });
  test("rejects foreign, child, and missing main frames before client resolution", () => {
    const clientFor = vi.fn();
    const mainFrame = {};
    for (const event of [{ senderFrame: {} }, { senderFrame: undefined }]) {
      expect(() => resolveProductionBriefTopFrameClient(event, mainFrame, clientFor)).toThrow(
        "top-level frame",
      );
    }
    expect(() =>
      resolveProductionBriefTopFrameClient({ senderFrame: mainFrame }, undefined, clientFor),
    ).toThrow("top-level frame");
    expect(clientFor).not.toHaveBeenCalled();
  });
});
