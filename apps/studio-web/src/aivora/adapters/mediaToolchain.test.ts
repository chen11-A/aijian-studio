import { describe, expect, it, vi } from "vitest";
import fixtures from "../../../../../packages/contracts/fixtures/local-media-toolchain-status.json";
import {
  createMediaToolchainStore,
  desktopMediaToolchain,
  parseMediaToolchainStatus,
} from "./mediaToolchain";
import type {
  MediaToolchainGateway,
  MediaToolchainReadResult,
  MediaToolchainStatus,
} from "../mediaToolchainContract";

const status: MediaToolchainStatus = {
  schema_version: 1,
  state: "AVAILABLE",
  source: "EXTERNAL",
  directory: "C:\\Tools\\bin",
  profile_id: "windows-x86_64-gyan-full-8.1.2-dev",
  version: "8.1.2",
  diagnostic: "Verified",
  can_probe: true,
  can_preview: true,
  can_draft_export: true,
  formal_release_approved: false,
};
const result: MediaToolchainReadResult = { kind: "STATUS", status };
function gateway() {
  return {
    getMediaToolchainStatus: vi
      .fn<MediaToolchainGateway["getMediaToolchainStatus"]>()
      .mockResolvedValue(result),
    selectMediaToolchain: vi
      .fn<MediaToolchainGateway["selectMediaToolchain"]>()
      .mockResolvedValue(result),
    clearMediaToolchain: vi
      .fn<MediaToolchainGateway["clearMediaToolchain"]>()
      .mockResolvedValue(result),
  };
}

describe("verified media capability contract", () => {
  it("accepts the actual backend serializer fixture for every admitted status", () => {
    expect(new Set(fixtures.map((fixture) => fixture.state))).toEqual(
      new Set(["AVAILABLE", "NOT_CONFIGURED", "INVALID", "UNSUPPORTED"]),
    );
    expect(
      fixtures.filter((fixture) => fixture.state === "AVAILABLE").map((fixture) => fixture.source),
    ).toEqual(expect.arrayContaining(["EXTERNAL", "DEVELOPMENT_OVERRIDE", "DEVELOPMENT_LOCAL"]));
    for (const fixture of fixtures)
      expect(parseMediaToolchainStatus({ kind: "STATUS", status: fixture })).toEqual(fixture);
  });

  it.each(["DEVELOPMENT_OVERRIDE", "DEVELOPMENT_LOCAL"] as const)(
    "accepts verified %s status without admitting arbitrary capabilities",
    (source) => {
      const developmentStatus = {
        ...status,
        source,
        profile_id: "admitted-unfrozen-profile",
        version: "7.1.1",
      };
      expect(parseMediaToolchainStatus({ kind: "STATUS", status: developmentStatus })).toEqual(
        developmentStatus,
      );
      expect(
        parseMediaToolchainStatus({
          kind: "STATUS",
          status: { ...developmentStatus, formal_release_approved: true },
        }),
      ).toBeNull();
      expect(
        parseMediaToolchainStatus({
          kind: "STATUS",
          status: { ...developmentStatus, state: "INVALID" },
        }),
      ).toBeNull();
    },
  );
  it("validates the authority response and exact external profile without approving formal release", () => {
    expect(parseMediaToolchainStatus(result)).toEqual(status);
    expect(
      parseMediaToolchainStatus({ kind: "STATUS", status: { ...status, diagnostic: "" } }),
    ).not.toBeNull();
    for (const patch of [
      { schema_version: 2 },
      { formal_release_approved: true },
      { can_probe: "true" },
      { source: "NONE" },
      { source: "GUESSED" },
      { state: "INVALID" },
      { version: "8.1.1" },
      { profile_id: "unverified" },
      { directory: null },
      { diagnostic: null },
      { diagnostic: "unsafe\ntext" },
      { extra: "unexpected" },
      { can_preview: false },
    ])
      expect(
        parseMediaToolchainStatus({ kind: "STATUS", status: { ...status, ...patch } }),
      ).toBeNull();
    for (const invalid of [
      null,
      [],
      {},
      { kind: "REMOTE_UNKNOWN" },
      { kind: "STATUS", status: [] },
    ])
      expect(parseMediaToolchainStatus(invalid)).toBeNull();
    expect(
      parseMediaToolchainStatus({
        kind: "STATUS",
        status: { ...status, source: "BUNDLED", version: "other", profile_id: "admitted-local" },
      }),
    ).not.toBeNull();
  });
  it("rejects tool metadata when the status says no tool source is configured", () => {
    const empty = {
      ...status,
      state: "NOT_CONFIGURED",
      source: "NONE",
      profile_id: null,
      version: null,
      directory: null,
      can_probe: false,
      can_preview: false,
      can_draft_export: false,
    };
    for (const state of ["NOT_CONFIGURED", "INVALID", "UNSUPPORTED"]) {
      expect(
        parseMediaToolchainStatus({ kind: "STATUS", status: { ...empty, state } }),
      ).not.toBeNull();
      for (const field of ["profile_id", "version", "directory"] as const) {
        expect(
          parseMediaToolchainStatus({
            kind: "STATUS",
            status: {
              ...empty,
              state,
              [field]: status[field],
            },
          }),
        ).toBeNull();
      }
    }
  });
  it("exposes a stable no-argument bridge adapter without using its presence as readiness", async () => {
    const native = gateway();
    const adapter = desktopMediaToolchain(native)!;
    expect(adapter).toBe(desktopMediaToolchain(native));
    expect(
      desktopMediaToolchain({ getMediaToolchainStatus: native.getMediaToolchainStatus }),
    ).toBeUndefined();
    await adapter.getMediaToolchainStatus();
    await adapter.selectMediaToolchain();
    await adapter.clearMediaToolchain();
    for (const method of Object.values(native)) expect(method).toHaveBeenCalledExactlyOnceWith();
    const store = createMediaToolchainStore(adapter);
    expect(store.getSnapshot().status).toBeNull();
  });
});

describe("shared media status state machine", () => {
  it("fails closed without native methods or trustworthy readback", async () => {
    const missing = createMediaToolchainStore();
    await missing.refresh();
    await missing.select();
    await missing.clear();
    expect(missing.getSnapshot().phase).toBe("UNAVAILABLE");
    const native = gateway();
    native.getMediaToolchainStatus.mockRejectedValue(new Error("offline"));
    const store = createMediaToolchainStore(native);
    await store.refresh();
    await store.select();
    expect(store.getSnapshot().phase).toBe("UNKNOWN");
    expect(store.getSnapshot().status).toBeNull();
    expect(native.selectMediaToolchain).not.toHaveBeenCalled();
  });
  it("locks duplicate actions across listeners and publishes removal to every consumer", async () => {
    const native = gateway();
    const store = createMediaToolchainStore(native);
    const listenerA = vi.fn(),
      listenerB = vi.fn();
    const unsubscribe = store.subscribe(listenerA);
    store.subscribe(listenerB);
    await store.refresh();
    let finish!: (value: MediaToolchainReadResult) => void;
    native.clearMediaToolchain.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = store.clear();
    await Promise.resolve();
    await store.select();
    await store.clear();
    expect(store.getSnapshot().busy).toBe(true);
    expect(native.clearMediaToolchain).toHaveBeenCalledTimes(1);
    expect(native.selectMediaToolchain).not.toHaveBeenCalled();
    finish({
      kind: "STATUS",
      status: {
        ...status,
        state: "NOT_CONFIGURED",
        source: "NONE",
        profile_id: null,
        version: null,
        directory: null,
        can_probe: false,
        can_preview: false,
        can_draft_export: false,
      },
    });
    await pending;
    expect(store.getSnapshot().status?.can_draft_export).toBe(false);
    expect(listenerA.mock.calls.length).toBe(listenerB.mock.calls.length);
    unsubscribe();
  });
  it("reads after an unknown write without replay, remains locked until readback succeeds", async () => {
    const native = gateway();
    const store = createMediaToolchainStore(native);
    await store.refresh();
    native.selectMediaToolchain.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    native.getMediaToolchainStatus.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    await store.select();
    await store.select();
    expect(native.selectMediaToolchain).toHaveBeenCalledTimes(1);
    expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().phase).toBe("UNKNOWN");
    native.getMediaToolchainStatus.mockResolvedValue(result);
    await store.refresh();
    expect(store.getSnapshot().phase).toBe("READY");
  });
  it.each(["PICKER_CANCELLED", "PICKER_BUSY"] as const)(
    "reads back after %s and never reopens the picker",
    async (kind) => {
      const native = gateway();
      const store = createMediaToolchainStore(native);
      await store.refresh();
      native.selectMediaToolchain.mockResolvedValue({ kind });
      await store.select();
      expect(native.selectMediaToolchain).toHaveBeenCalledTimes(1);
      expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(2);
      expect(store.getSnapshot().status).toEqual(status);
    },
  );
  it("keeps invalid candidate diagnostic visible until explicit read, then restores the authoritative prior config", async () => {
    const native = gateway();
    const store = createMediaToolchainStore(native);
    await store.refresh();
    native.selectMediaToolchain.mockResolvedValue({
      kind: "STATUS",
      status: {
        ...status,
        state: "INVALID",
        diagnostic: "Hash mismatch",
        can_probe: false,
        can_preview: false,
        can_draft_export: false,
      },
    });
    await store.select();
    expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().status?.diagnostic).toBe("Hash mismatch");
    await store.refresh();
    expect(store.getSnapshot().status?.state).toBe("AVAILABLE");
  });
  it("recovers synchronous bridge exceptions through readback instead of becoming permanently busy", async () => {
    const native = gateway();
    const store = createMediaToolchainStore(native);
    await store.refresh();
    native.selectMediaToolchain.mockImplementation(() => {
      throw new Error("closed");
    });
    await store.select();
    expect(store.getSnapshot().busy).toBe(false);
    expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(2);
  });
});

describe("owned media picker lifecycle", () => {
  it("cancels before the pending select microtask without ever opening a native picker", async () => {
    const native = {
      ...gateway(),
      cancelMediaToolchainSelection: vi.fn().mockResolvedValue({ kind: "NO_PENDING_SELECTION" }),
    };
    const store = createMediaToolchainStore(native);
    await store.refresh();
    const owner = Symbol();
    const pending = store.select(owner);
    await store.cancelSelection(owner);
    await pending;
    expect(native.selectMediaToolchain).not.toHaveBeenCalled();
    expect(native.cancelMediaToolchainSelection).not.toHaveBeenCalled();
  });
  it("does not let another owner cancel the picker, keeps busy until settle and ignores late receipts", async () => {
    const native = {
      ...gateway(),
      cancelMediaToolchainSelection: vi.fn().mockResolvedValue({ kind: "CANCELLED" }),
    };
    const store = createMediaToolchainStore(native);
    await store.refresh();
    let finish!: (result: MediaToolchainReadResult) => void;
    native.selectMediaToolchain.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const owner = Symbol();
    const pending = store.select(owner);
    await Promise.resolve();
    await store.cancelSelection(Symbol());
    expect(native.cancelMediaToolchainSelection).not.toHaveBeenCalled();
    await store.cancelSelection(owner);
    expect(native.cancelMediaToolchainSelection).toHaveBeenCalledExactlyOnceWith();
    expect(store.getSnapshot().busy).toBe(true);
    finish({
      kind: "STATUS",
      status: {
        ...status,
        state: "INVALID",
        can_probe: false,
        can_preview: false,
        can_draft_export: false,
      },
    });
    await pending;
    expect(store.getSnapshot().status).toEqual(status);
    expect(store.getSnapshot().notice).toContain("已取消尚未提交");
  });
  it("reports already-submitted settings without claiming rollback", async () => {
    const native = {
      ...gateway(),
      cancelMediaToolchainSelection: vi.fn().mockResolvedValue({ kind: "ALREADY_SUBMITTED" }),
    };
    const store = createMediaToolchainStore(native);
    await store.refresh();
    let finish!: (result: MediaToolchainReadResult) => void;
    native.selectMediaToolchain.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const owner = Symbol();
    const pending = store.select(owner);
    await Promise.resolve();
    await store.cancelSelection(owner);
    finish(result);
    await pending;
    expect(store.getSnapshot().notice).toContain("无法撤回");
    expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(2);
  });
});
