import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { LocalApiClient } from "./api-client";
import { registerVisualBibleHandlers } from "./visual-bible-ipc";
const p = "prj_" + "a".repeat(32),
  v = "ver_" + "b".repeat(32);
function setup() {
  const frame = { isDestroyed: () => false, detached: false };
  const web = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: frame });
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: web });
  const client = {
    getVisualBibleVersion: vi.fn(),
    persistVisualInspection: vi.fn(),
    readProjectMediaAssetPreview: vi.fn(),
  };
  const decode = vi.fn(),
    confirm = vi.fn();
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  >();
  registerVisualBibleHandlers((channel, handler) => handlers.set(channel, handler), {
    getWindow: () => window as unknown as BrowserWindow,
    getClient: () => client as unknown as LocalApiClient,
    decode,
    confirm,
    decoderVersion: () => "TEST",
  });
  const event = { sender: web, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { handlers, event, client, web, decode, confirm };
}
describe("G5 trusted native sender and document boundary", () => {
  it("refuses other frames and closed payload arguments before any source or write", async () => {
    const s = setup(),
      read = s.handlers.get("visual-bible:version")!;
    await expect(
      read(
        {
          ...s.event,
          senderFrame: { isDestroyed: () => false, detached: false },
        } as IpcMainInvokeEvent,
        p,
        v,
      ),
    ).rejects.toThrow("sender");
    await expect(read(s.event, p, v, "extra")).rejects.toThrow("canonical");
    await expect(read(s.event, "../project", v)).rejects.toThrow("canonical");
    expect(s.client.getVisualBibleVersion).not.toHaveBeenCalled();
  });
  it("navigation A→B→A refuses a reply from the previous document", async () => {
    const s = setup();
    let resolve!: (v: unknown) => void;
    s.client.getVisualBibleVersion.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const reply = s.handlers.get("visual-bible:version")!(s.event, p, v);
    s.web.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    s.web.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    resolve({ kind: "FOUND", data: {} });
    await expect(reply).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("renderer cannot supply image proof, local paths or an extra inspection argument", async () => {
    const s = setup(),
      inspect = s.handlers.get("visual-bible:inspect")!;
    await expect(
      inspect(
        s.event,
        p,
        "asset_" + "c".repeat(32),
        "asv_" + "d".repeat(32),
        "e".repeat(64),
        "vinop_" + "f".repeat(32),
        { decoder: "FAKE_PASS" },
      ),
    ).rejects.toThrow("exact media");
    await expect(
      inspect(s.event, p, "/tmp/user-file", v, "e".repeat(64), "vinop_" + "f".repeat(32)),
    ).rejects.toThrow("exact media");
    expect(s.client.readProjectMediaAssetPreview).not.toHaveBeenCalled();
    expect(s.client.persistVisualInspection).not.toHaveBeenCalled();
    expect(s.decode).not.toHaveBeenCalled();
  });
});
