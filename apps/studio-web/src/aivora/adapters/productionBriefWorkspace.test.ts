import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingProductionBriefCommand,
  pendingProductionBriefCommand,
  readPendingProductionBriefCommand,
  readProductionBrief,
  retainProductionBriefCommand,
  writeProductionBrief,
} from "./productionBriefWorkspace";
const projectId = `prj_${"1".repeat(32)}`;
const command = { operation_id: "op_1", input: {} } as never;
const legalCommand = {
  operation_id: "123e4567-e89b-42d3-a456-426614174000",
  input: {
    parent_version_id: null,
    expected_revision: null,
    change_summary: "draft",
    content: {
      schema_version: "1.0.0",
      creative_entry: { kind: "original_idea", origin_statement: "idea", references: [] },
      creative: { premise: "p", intent: "i", constraints: [] },
      delivery: {
        width_px: 1080,
        height_px: 1920,
        language: "zh-CN",
        display_aspect_ratio: { num: 9, den: 16 },
        frame_rate: { num: 24, den: 1 },
      },
      duration_intent: { episode_mode: "unspecified", work_seconds: 60, episode_seconds: null },
      budget_intent: { state: "unknown", amount_micros: null, currency: null },
      rights_declaration: { state: "unknown", statement: null },
    },
  },
};
afterEach(() => localStorage.clear());
describe("productionBriefWorkspace", () => {
  it("does not turn an unavailable bridge into an empty saved brief", async () => {
    await expect(readProductionBrief({} as never, projectId)).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
  });
  it("keeps a missing latest brief distinct from a read error", async () => {
    const getProductionBrief = vi.fn().mockResolvedValue(null);
    await expect(readProductionBrief({ getProductionBrief } as never, projectId)).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: null,
    });
  });
  it("passes the exact operation command through without retrying it", async () => {
    const createProductionBriefVersion = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    await expect(
      writeProductionBrief({ createProductionBriefVersion } as never, projectId, command),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(createProductionBriefVersion).toHaveBeenCalledWith(projectId, command);
  });
  it("retains the canonical operation for an explicit recovery after reopening", () => {
    retainProductionBriefCommand(projectId, command);
    expect(pendingProductionBriefCommand(projectId)).toEqual(command);
    clearPendingProductionBriefCommand(projectId);
    expect(pendingProductionBriefCommand(projectId)).toBeNull();
  });
  it("reports a storage write failure instead of claiming the operation is recoverable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("quota");
    });
    expect(retainProductionBriefCommand(projectId, command)).toBe(false);
    setItem.mockRestore();
  });
  it("marks an incomplete persisted command corrupt instead of recoverable", () => {
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: { operation_id: "x", input: {} } }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "CORRUPT" });
  });
  it("does not treat a non-project pending map as a recoverable command store", () => {
    localStorage.setItem("aivora.production-brief.pending.v1", JSON.stringify([legalCommand]));
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "UNREADABLE" });
  });
  it("reports an unreadable store when the local-storage getter fails", () => {
    const ownDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("blocked");
      },
    });
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "UNREADABLE" });
    if (ownDescriptor) Object.defineProperty(window, "localStorage", ownDescriptor);
    else delete (window as { localStorage?: Storage }).localStorage;
  });
  it("reports an unreadable store when reading the pending key fails", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "UNREADABLE" });
    getItem.mockRestore();
  });
  it("recognizes a complete persisted C3 command for explicit recovery", () => {
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: legalCommand }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({
      kind: "READY",
      command: legalCommand,
    });
  });
  it("recognizes a complete source-adaptation command for explicit recovery", () => {
    const adaptation = structuredClone(legalCommand);
    (adaptation.input.content as { creative_entry: unknown }).creative_entry = {
      kind: "source_adaptation",
      adaptation_statement: "adapt",
      source_document_id: `src_${"a".repeat(32)}`,
      source_manifest_version_id: `ver_${"b".repeat(32)}`,
      source_block_ids: [`srcb_${"c".repeat(32)}`],
    };
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: adaptation }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({
      kind: "READY",
      command: adaptation,
    });
  });
  it("rejects a command whose nested delivery contract was damaged", () => {
    const damaged = structuredClone(legalCommand);
    delete (damaged.input.content.delivery as { frame_rate?: unknown }).frame_rate;
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: damaged }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "CORRUPT" });
  });
  it("rejects a declared budget without its required amount and currency", () => {
    const damaged = structuredClone(legalCommand);
    damaged.input.content.budget_intent = {
      state: "declared",
      amount_micros: null,
      currency: null,
    };
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: damaged }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "CORRUPT" });
  });
  it.each([
    [
      "an unreduced delivery ratio",
      (value: typeof legalCommand) =>
        (value.input.content.delivery.display_aspect_ratio = { num: 18, den: 32 }),
    ],
    [
      "unknown rights with a statement",
      (value: typeof legalCommand) =>
        ((value.input.content as { rights_declaration: unknown }).rights_declaration = {
          state: "unknown",
          statement: "claimed",
        }),
    ],
    [
      "a per-episode duration without episode seconds",
      (value: typeof legalCommand) =>
        ((value.input.content as { duration_intent: unknown }).duration_intent = {
          episode_mode: "per_episode",
          work_seconds: null,
          episode_seconds: null,
        }),
    ],
  ])("rejects %s as a single-field persisted-command violation", (_name, damage) => {
    const damaged = structuredClone(legalCommand);
    damage(damaged);
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: damaged }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "CORRUPT" });
  });
  it("normalizes a bridge rejection to an unknown result without retrying", async () => {
    const createProductionBriefVersion = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      writeProductionBrief({ createProductionBriefVersion } as never, projectId, command),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(createProductionBriefVersion).toHaveBeenCalledTimes(1);
  });
  it.each(["{", "not-json"])(
    "preserves unreadable pending JSON %s without retain or clear",
    (raw) => {
      const key = "aivora.production-brief.pending.v1";
      localStorage.setItem(key, raw);
      expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "UNREADABLE" });
      expect(retainProductionBriefCommand(projectId, legalCommand as never)).toBe(false);
      expect(clearPendingProductionBriefCommand(projectId)).toBe(false);
      expect(localStorage.getItem(key)).toBe(raw);
    },
  );
  it("cannot clear a newer same-project operation and preserves another project command", () => {
    const newer = structuredClone(legalCommand);
    newer.operation_id = "123e4567-e89b-42d3-a456-426614174001";
    const otherProject = `prj_${"2".repeat(32)}`;
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: newer, [otherProject]: legalCommand }),
    );
    expect(clearPendingProductionBriefCommand(projectId, legalCommand.operation_id)).toBe(false);
    expect(readPendingProductionBriefCommand(projectId)).toMatchObject({
      kind: "READY",
      command: newer,
    });
    expect(readPendingProductionBriefCommand(otherProject)).toMatchObject({
      kind: "READY",
      command: legalCommand,
    });
  });
  it.each([
    ["omitted", undefined],
    ["legal", [{ reference_kind: "research", description: "research note" }]],
  ])("keeps %s original references recoverable", (_name, references) => {
    const value = structuredClone(legalCommand);
    if (references === undefined)
      delete (value.input.content.creative_entry as { references?: unknown }).references;
    else (value.input.content.creative_entry as { references?: unknown }).references = references;
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: value }),
    );
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "READY", command: value });
  });
  it.each([
    [
      "duplicate",
      [
        { reference_kind: "research", description: "x" },
        { reference_kind: "research", description: "x" },
      ],
    ],
    ["extra key", [{ reference_kind: "research", description: "x", extra: true }]],
    ["malformed", [null]],
  ])("rejects %s references without rewriting raw storage", (_name, references) => {
    const value = structuredClone(legalCommand);
    (value.input.content.creative_entry as { references?: unknown }).references = references;
    const raw = JSON.stringify({ [projectId]: value });
    localStorage.setItem("aivora.production-brief.pending.v1", raw);
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "CORRUPT" });
    expect(localStorage.getItem("aivora.production-brief.pending.v1")).toBe(raw);
  });
  it("rejects a rational denominator beyond the accepted bound without rewriting raw storage", () => {
    const value = structuredClone(legalCommand);
    value.input.content.delivery.frame_rate = { num: 1, den: 2_147_483_648 };
    const raw = JSON.stringify({ [projectId]: value });
    localStorage.setItem("aivora.production-brief.pending.v1", raw);
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "CORRUPT" });
    expect(localStorage.getItem("aivora.production-brief.pending.v1")).toBe(raw);
  });
  it("clears only its matching project operation and preserves another project command", () => {
    const otherProject = `prj_${"3".repeat(32)}`;
    localStorage.setItem(
      "aivora.production-brief.pending.v1",
      JSON.stringify({ [projectId]: legalCommand, [otherProject]: legalCommand }),
    );
    expect(clearPendingProductionBriefCommand(projectId, legalCommand.operation_id)).toBe(true);
    expect(readPendingProductionBriefCommand(projectId)).toEqual({ kind: "READY", command: null });
    expect(readPendingProductionBriefCommand(otherProject)).toEqual({
      kind: "READY",
      command: legalCommand,
    });
  });
  it("refuses a save when storage becomes unavailable after a readable pending store", () => {
    const key = "aivora.production-brief.pending.v1";
    const raw = JSON.stringify({ [projectId]: legalCommand });
    localStorage.setItem(key, raw);
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const originalStorage = window.localStorage;
    let calls = 0;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        calls += 1;
        if (calls > 1) throw new Error("storage unavailable");
        return originalStorage;
      },
    });
    try {
      expect(retainProductionBriefCommand(projectId, legalCommand as never)).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
    expect(localStorage.getItem(key)).toBe(raw);
  });
});
