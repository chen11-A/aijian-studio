import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProviderWrite,
  newRotationOperationId,
  persistProviderWrite,
  readProviderJournal,
  type ProviderPendingWrite,
} from "./sub2api-provider-journal";

const connectionId = `pcn_${"a".repeat(32)}`;
const key = `aivora:sub2api-provider:pending:${connectionId}`;
const rotation: ProviderPendingWrite = {
  kind: "rotation",
  connectionId,
  expectedRevision: 1,
  operationId: `pcop_${"b".repeat(32)}`,
};
const metadata: ProviderPendingWrite = {
  kind: "metadata",
  connectionId,
  command: {
    expected_revision: 1,
    display_name: "Synthetic",
    base_url: "https://text.example.com",
    origin_mode: "PUBLIC_HTTPS",
    enabled: true,
    models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Sub2API pending write journal", () => {
  it.each([rotation, metadata])("persists and clears only the exact original $kind", (write) => {
    expect(readProviderJournal(connectionId)).toEqual({ kind: "empty" });
    expect(persistProviderWrite(write)).toBe(true);
    expect(readProviderJournal(connectionId)).toEqual({ kind: "pending", write });
    expect(persistProviderWrite(write)).toBe(false);
    expect(clearProviderWrite({ ...rotation, operationId: `pcop_${"c".repeat(32)}` })).toBe(false);
    expect(clearProviderWrite(write)).toBe(true);
    expect(readProviderJournal(connectionId)).toEqual({ kind: "empty" });
    expect(clearProviderWrite(write)).toBe(false);
  });

  it.each([
    null,
    false,
    [],
    {},
    { ...rotation, connectionId: "other" },
    { ...rotation, expectedRevision: 0 },
    { ...rotation, operationId: "invalid" },
    { ...metadata, command: null },
    { ...metadata, command: { ...metadata.command, expected_revision: 0 } },
    {
      ...metadata,
      command: { ...metadata.command, models: [{ model_id: "image", capabilities: ["IMAGE"] }] },
    },
    {
      ...metadata,
      command: {
        ...metadata.command,
        origin_mode: "LOCAL_LOOPBACK_HTTP",
        base_url: "http://localhost:80",
      },
    },
    { ...metadata, command: { ...metadata.command, origin_mode: "unknown" } },
  ])("blocks malformed or mismatched stored write %# without erasing it", (value) => {
    const raw = JSON.stringify(value);
    localStorage.setItem(key, raw);
    expect(readProviderJournal(connectionId)).toEqual({ kind: "blocked" });
    expect(persistProviderWrite(rotation)).toBe(false);
    expect(clearProviderWrite(rotation)).toBe(false);
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it("accepts the explicit canonical loopback metadata journal", () => {
    const write: ProviderPendingWrite = {
      ...metadata,
      command: {
        ...metadata.command,
        origin_mode: "LOCAL_LOOPBACK_HTTP",
        base_url: "http://[::1]:8080",
      },
    };
    expect(persistProviderWrite(write)).toBe(true);
    expect(readProviderJournal(connectionId)).toEqual({ kind: "pending", write });
  });

  it("fails closed for invalid JSON and invalid connection identity", () => {
    localStorage.setItem(key, "{");
    expect(readProviderJournal(connectionId)).toEqual({ kind: "blocked" });
    expect(readProviderJournal("invalid")).toEqual({ kind: "blocked" });
    expect(persistProviderWrite({ ...rotation, connectionId: "invalid" })).toBe(false);
  });

  it("does not report persistence when storage write or readback fails", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(persistProviderWrite(rotation)).toBe(false);
    write.mockImplementation(() => undefined);
    expect(persistProviderWrite(rotation)).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readProviderJournal(connectionId)).toEqual({ kind: "blocked" });
  });

  it("retains the journal if removal throws or has no effect", () => {
    expect(persistProviderWrite(rotation)).toBe(true);
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(clearProviderWrite(rotation)).toBe(false);
    remove.mockImplementation(() => undefined);
    expect(clearProviderWrite(rotation)).toBe(false);
    expect(readProviderJournal(connectionId)).toEqual({ kind: "pending", write: rotation });
  });

  it("generates canonical independent identities and refuses an unavailable RNG", () => {
    const first = newRotationOperationId();
    expect(first).toMatch(/^pcop_[0-9a-f]{32}$/);
    expect(newRotationOperationId()).not.toBe(first);
    vi.spyOn(window.crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(newRotationOperationId()).toBeNull();
  });
});
