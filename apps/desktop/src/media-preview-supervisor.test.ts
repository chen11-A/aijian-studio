/** Controlled protocol adapters only: no process, binary, MLT decoder or native window. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { NativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import {
  createManagedMediaPreviewHost,
  type ManagedMediaPreviewHost,
  type TrustedNativePreviewRuntime,
  type NativePreviewConnection,
} from "./media-preview-supervisor";
import type {
  MediaPreviewIdentity,
  MediaPreviewStatus,
  MediaPreviewMutation,
} from "./media-preview-session-contract";

const hosts: ManagedMediaPreviewHost[] = [];
const fixture = (): NativePreviewPlanResponse =>
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/native-preview-plan.json"),
      "utf8",
    ),
  );
function identity(receipt = fixture()): MediaPreviewIdentity {
  const s = receipt.data.plan.source;
  return {
    project_id: s.project_id,
    episode_id: s.episode_id,
    assembly_artifact_id: s.assembly_artifact_id!,
    assembly_version_id: s.assembly_version_id!,
    assembly_content_hash: s.assembly_content_hash!,
    assembly_head_revision: s.assembly_head_revision!,
    plan_hash: receipt.data.plan_hash,
  };
}
function setup(
  limits: { timeoutMs?: number; leaseMs?: number; maxSessions?: number; maxCommands?: number } = {},
) {
  const receipt = fixture();
  let current!: MediaPreviewStatus;
  let exited = () => {};
  const connection: NativePreviewConnection = {
    command: vi.fn(async (kind, command) => {
      current = {
        ...current,
        generation: command.generation,
        state:
          kind === "play"
            ? "PLAYING"
            : kind === "pause"
              ? "PAUSED"
              : kind === "close"
                ? "CLOSED"
                : "PAUSED",
        clock: {
          ...current.clock,
          shown_frame_index:
            "frame_index" in command ? command.frame_index : current.clock.shown_frame_index,
        },
      };
      return { kind: "STATUS", status: structuredClone(current) };
    }),
    status: vi.fn(async () => ({ kind: "STATUS", status: structuredClone(current) })),
    terminate: vi.fn(async () => {}),
    onExit: vi.fn((listener) => {
      exited = listener;
      return vi.fn();
    }),
  };
  const runtime: TrustedNativePreviewRuntime = {
    open: vi.fn(async (command) => {
      current = {
        session_id: command.session_id,
        generation: command.generation,
        open_request_id: command.open_request_id,
        identity: command.identity,
        state: "READY_PAUSED",
        transport: { kind: "NATIVE_SDL2_WINDOW", embedded: false },
        clock: {
          shown_frame_index: 0,
          audio_output_sample_index: null,
          audio_sample_rate_hz: null,
          authority: "SHOWN_FRAME",
        },
        expires_at: command.expires_at,
        failure: null,
      };
      return connection;
    }),
  };
  const resolvePlan = vi.fn(async () => ({ kind: "READY" as const, receipt }));
  const host = createManagedMediaPreviewHost({ resolvePlan, runtime, ...limits });
  hosts.push(host);
  const command = { open_request_id: "pvo_" + "a".repeat(32), identity: identity(receipt) };
  const mutation = (status: MediaPreviewStatus, digit = "b"): MediaPreviewMutation => ({
    session_id: status.session_id,
    generation: status.generation,
    command_id: "pvc_" + digit.repeat(32),
  });
  return {
    host,
    receipt,
    command,
    runtime,
    connection,
    resolvePlan,
    mutation,
    current: () => current,
    setCurrent: (value: MediaPreviewStatus) => {
      current = value;
    },
    exit: () => exited(),
  };
}
async function ready(test: ReturnType<typeof setup>) {
  const result = await test.host.open(test.command);
  expect(result.kind).toBe("STATUS");
  if (result.kind !== "STATUS") throw new Error("fixture protocol not ready");
  return result.status;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-11T07:00:00Z");
});
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.invalidateAll());
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("managed native preview ownership", () => {
  it("holds a failed episode until owned termination is positively confirmed", async () => {
    const test = setup();
    let stopped!: () => void;
    vi.mocked(test.connection.terminate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stopped = resolve;
        }),
    );
    vi.mocked(test.connection.onExit).mockImplementationOnce(() => {
      throw new Error("Controlled subscription failure");
    });
    expect(await test.host.open(test.command)).toMatchObject({
      kind: "STATUS",
      status: { state: "FAILED", failure: "HOST_PROTOCOL" },
    });
    const next = { ...test.command, open_request_id: "pvo_" + "f".repeat(32) };
    expect(await test.host.open(next)).toEqual({
      kind: "UNAVAILABLE",
      reason: "TRANSPORT_NOT_READY",
    });
    expect(test.runtime.open).toHaveBeenCalledTimes(1);
    stopped();
    await vi.advanceTimersByTimeAsync(0);
    expect(await test.host.open(next)).toMatchObject({
      kind: "STATUS",
      status: { state: "READY_PAUSED" },
    });
    expect(test.runtime.open).toHaveBeenCalledTimes(2);
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
  });
  it("never releases same-episode ownership after a failed termination timeout", async () => {
    const test = setup({ timeoutMs: 20, leaseMs: 30 });
    await ready(test);
    vi.mocked(test.connection.terminate).mockImplementationOnce(() => new Promise(() => {}));
    test.exit();
    await vi.advanceTimersByTimeAsync(31);
    expect(
      await test.host.open({ ...test.command, open_request_id: "pvo_" + "f".repeat(32) }),
    ).toEqual({ kind: "UNAVAILABLE", reason: "TRANSPORT_NOT_READY" });
    expect(test.runtime.open).toHaveBeenCalledTimes(1);
  });
  it("keeps a late invalidated launch occupied until its owned connection is stopped", async () => {
    const test = setup({ timeoutMs: 20 });
    let launched!: (v: NativePreviewConnection) => void, stopped!: () => void;
    vi.mocked(test.runtime.open).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          launched = resolve;
        }),
    );
    vi.mocked(test.connection.terminate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stopped = resolve;
        }),
    );
    const pending = test.host.open(test.command);
    await vi.advanceTimersByTimeAsync(0);
    test.host.invalidateAll();
    const next = { ...test.command, open_request_id: "pvo_" + "f".repeat(32) };
    expect(await test.host.open(next)).toEqual({
      kind: "UNAVAILABLE",
      reason: "TRANSPORT_NOT_READY",
    });
    launched(test.connection);
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(await test.host.open(next)).toEqual({
      kind: "UNAVAILABLE",
      reason: "TRANSPORT_NOT_READY",
    });
    stopped();
    await vi.advanceTimersByTimeAsync(0);
    expect(await test.host.open(next)).toMatchObject({
      kind: "STATUS",
      status: { state: "READY_PAUSED" },
    });
    expect(test.runtime.open).toHaveBeenCalledTimes(2);
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
  });
  it("keeps rejected partial launch UNKNOWN and occupied after lease expiry", async () => {
    const test = setup({ leaseMs: 30 });
    vi.mocked(test.runtime.open).mockRejectedValueOnce(
      new Error("Partial launch cleanup is unproven"),
    );
    expect(await test.host.open(test.command)).toEqual({ kind: "UNKNOWN" });
    await vi.advanceTimersByTimeAsync(31);
    expect(
      await test.host.open({ ...test.command, open_request_id: "pvo_" + "f".repeat(32) }),
    ).toEqual({ kind: "UNAVAILABLE", reason: "TRANSPORT_NOT_READY" });
    expect(test.runtime.open).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, Number.MAX_SAFE_INTEGER])("rejects unbounded supervisor limits %s", (value) => {
    expect(() =>
      createManagedMediaPreviewHost({ runtime: null, resolvePlan: vi.fn(), timeoutMs: value }),
    ).toThrow();
  });
  it("stays unavailable without runtime, never reads plans and cannot claim an absent old request", async () => {
    const resolvePlan = vi.fn();
    const host = createManagedMediaPreviewHost({ runtime: null, resolvePlan });
    hosts.push(host);
    expect(await host.open(setup().command)).toEqual({
      kind: "UNAVAILABLE",
      reason: "NATIVE_HOST_NOT_INSTALLED",
    });
    expect(resolvePlan).not.toHaveBeenCalled();
    expect(await host.status({ open_request_id: "pvo_" + "a".repeat(32) })).toEqual({
      kind: "UNKNOWN",
    });
  });
  it("binds open identity before await, deduplicates pending and ready requests and refuses ID reuse", async () => {
    const test = setup();
    const opening = test.host.open(test.command);
    expect(await test.host.open(test.command)).toEqual({ kind: "UNKNOWN" });
    const status = await readyReply(opening);
    expect(await test.host.open(test.command)).toEqual({ kind: "STATUS", status });
    expect(test.runtime.open).toHaveBeenCalledTimes(1);
    expect(test.resolvePlan).toHaveBeenCalledTimes(1);
    expect(
      await test.host.open({
        ...test.command,
        identity: { ...test.command.identity, assembly_head_revision: 99 },
      }),
    ).toEqual({ kind: "UNKNOWN" });
    expect(
      await test.host.open({ ...test.command, open_request_id: "pvo_" + "c".repeat(32) }),
    ).toEqual({ kind: "UNAVAILABLE", reason: "TRANSPORT_NOT_READY" });
  });
  it.each(["hash", "scope", "source", "test"])("rejects %s before native launch", async (fault) => {
    const test = setup();
    if (fault === "hash") test.receipt.data.plan_hash = "sha256:" + "0".repeat(64);
    if (fault === "scope") test.receipt.data.plan.source.episode_id = "ep_" + "f".repeat(32);
    if (fault === "source") test.receipt.data.plan.source.assembly_head_revision = 99;
    if (fault === "test") test.receipt.data.plan.scope = "ENGINEERING_TEST";
    const result = await test.host.open(test.command);
    expect(result).toMatchObject({
      kind: "STATUS",
      status: { state: "FAILED", failure: "PLAN_MISMATCH" },
    });
    expect(test.runtime.open).not.toHaveBeenCalled();
  });
  it("performs the native command once, increments generation and refuses conflicting replay", async () => {
    const test = setup(),
      status = await ready(test),
      command = test.mutation(status);
    const reply = await test.host.play(command);
    expect(reply).toMatchObject({ kind: "STATUS", status: { generation: 2, state: "PLAYING" } });
    expect(await test.host.play(command)).toEqual(reply);
    expect(test.connection.command).toHaveBeenCalledTimes(1);
    expect(await test.host.pause(command)).toEqual({ kind: "UNKNOWN" });
    expect(await test.host.pause({ ...command, command_id: "pvc_" + "c".repeat(32) })).toEqual({
      kind: "STALE_SESSION",
    });
    expect(await test.host.status({ session_id: status.session_id, generation: 1 })).toEqual({
      kind: "STALE_SESSION",
    });
    expect(await test.host.status({ open_request_id: test.command.open_request_id })).toMatchObject(
      { kind: "STATUS", status: { generation: 2, state: "PLAYING" } },
    );
  });
  it("keeps UNKNOWN control blocked and reconciles by original open ID without dispatching it again", async () => {
    const test = setup(),
      status = await ready(test),
      command = test.mutation(status);
    vi.mocked(test.connection.command).mockResolvedValueOnce({ kind: "UNKNOWN" });
    expect(await test.host.play(command)).toEqual({ kind: "UNKNOWN" });
    expect(await test.host.play(command)).toEqual({ kind: "UNKNOWN" });
    expect(
      await test.host.pause({ ...command, generation: 2, command_id: "pvc_" + "c".repeat(32) }),
    ).toEqual({ kind: "UNKNOWN" });
    test.setCurrent({ ...test.current(), generation: 2, state: "PLAYING" });
    expect(await test.host.status({ open_request_id: test.command.open_request_id })).toMatchObject(
      { kind: "STATUS", status: { state: "PLAYING", generation: 2 } },
    );
    expect(test.connection.command).toHaveBeenCalledTimes(1);
  });
  it("serializes readonly and mutation ownership and blocks another pending command", async () => {
    const test = setup(),
      initial = await ready(test);
    let read!: (value: unknown) => void;
    vi.mocked(test.connection.status).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          read = resolve;
        }),
    );
    const pendingRead = test.host.status({ open_request_id: test.command.open_request_id });
    await vi.advanceTimersByTimeAsync(0);
    expect(await test.host.play(test.mutation(initial))).toEqual({ kind: "UNKNOWN" });
    expect(test.connection.command).not.toHaveBeenCalled();
    read({ kind: "STATUS", status: initial });
    expect(await pendingRead).toMatchObject({ kind: "STATUS", status: { generation: 1 } });
    const played = await test.host.play(test.mutation(initial, "b"));
    expect(played).toMatchObject({ kind: "STATUS", status: { generation: 2, state: "PLAYING" } });
    if (played.kind !== "STATUS") throw new Error("fixture play missing");
    let finish!: (value: unknown) => void;
    vi.mocked(test.connection.command).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const command = test.mutation(played.status, "c"),
      pausing = test.host.pause(command);
    await vi.advanceTimersByTimeAsync(0);
    expect(await test.host.pause(command)).toEqual({ kind: "UNKNOWN" });
    expect(
      await test.host.seek({ ...command, command_id: "pvc_" + "d".repeat(32), frame_index: 0 }),
    ).toEqual({ kind: "STALE_SESSION" });
    finish({ kind: "UNKNOWN" });
    expect(await pausing).toEqual({ kind: "UNKNOWN" });
    expect(test.connection.command).toHaveBeenCalledTimes(2);
  });
  it("never accepts a contradictory native command outcome as success", async () => {
    const test = setup(),
      initial = await ready(test);
    vi.mocked(test.connection.command).mockResolvedValueOnce({
      kind: "STATUS",
      status: { ...initial, generation: 2, state: "PAUSED" },
    });
    expect(await test.host.play(test.mutation(initial))).toEqual({ kind: "UNKNOWN" });
  });
  it("rejects out-of-range seek before dispatch and verifies observed seek frame", async () => {
    const test = setup(),
      status = await ready(test),
      command = test.mutation(status);
    expect(await test.host.seek({ ...command, frame_index: 50 })).toEqual({
      kind: "STALE_SESSION",
    });
    expect(test.connection.command).not.toHaveBeenCalled();
    const reply = await test.host.seek({ ...command, frame_index: 49 });
    expect(reply).toMatchObject({
      kind: "STATUS",
      status: { generation: 2, clock: { shown_frame_index: 49 } },
    });
    vi.mocked(test.connection.command).mockResolvedValueOnce({
      kind: "STATUS",
      status: {
        ...test.current(),
        generation: 3,
        clock: { ...test.current().clock, shown_frame_index: 10 },
      },
    });
    expect(
      await test.host.seek({
        ...command,
        generation: 2,
        command_id: "pvc_" + "c".repeat(32),
        frame_index: 20,
      }),
    ).toEqual({ kind: "UNKNOWN" });
  });
  it.each(["generation", "identity", "frame", "clock", "lease", "date", "unverified"])(
    "never adopts malformed %s status",
    async (fault) => {
      const test = setup();
      await ready(test);
      const bad = structuredClone(test.current());
      if (fault === "generation") bad.generation = 99;
      if (fault === "identity") bad.identity.assembly_version_id = "ver_" + "f".repeat(32);
      if (fault === "frame") bad.clock.shown_frame_index = 50;
      if (fault === "clock")
        bad.clock = {
          shown_frame_index: 1,
          audio_output_sample_index: 1,
          audio_sample_rate_hz: 32000,
          authority: "NATIVE_AUDIO_OUTPUT",
        };
      if (fault === "lease") bad.expires_at = "2026-10-11T08:00:00.000Z";
      if (fault === "date") bad.expires_at = "2026-99-99T00:00:00Z";
      if (fault === "unverified") bad.clock.authority = "UNVERIFIED";
      vi.mocked(test.connection.status).mockResolvedValueOnce({ kind: "STATUS", status: bad });
      expect(await test.host.status({ open_request_id: test.command.open_request_id })).toEqual({
        kind: "UNKNOWN",
      });
    },
  );
  it("expires leases and cleans once, with no timer-derived frame position", async () => {
    const test = setup({ leaseMs: 1000 });
    const status = await ready(test);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await test.host.status({ open_request_id: test.command.open_request_id })).toMatchObject(
      {
        kind: "STATUS",
        status: { state: "EXPIRED", clock: { shown_frame_index: null, authority: "UNVERIFIED" } },
      },
    );
    test.host.invalidateAll();
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
    expect(await test.host.play(test.mutation(status))).toMatchObject({
      kind: "STATUS",
      status: { state: "EXPIRED" },
    });
    expect(test.connection.command).not.toHaveBeenCalled();
  });
  it("cleans a late launch after timeout once and never relaunches UNKNOWN", async () => {
    const test = setup({ timeoutMs: 20 });
    let finish!: (value: NativePreviewConnection) => void;
    vi.mocked(test.runtime.open).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = test.host.open(test.command);
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toEqual({ kind: "UNKNOWN" });
    finish(test.connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
    expect(await test.host.open(test.command)).toEqual({ kind: "UNKNOWN" });
    expect(test.runtime.open).toHaveBeenCalledTimes(1);
  });
  it("invalidates a late launch and all active sessions on document exit", async () => {
    const test = setup();
    let finish!: (value: NativePreviewConnection) => void;
    vi.mocked(test.runtime.open).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = test.host.open(test.command);
    await vi.advanceTimersByTimeAsync(0);
    test.host.invalidateAll();
    finish(test.connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toMatchObject({ kind: "STATUS", status: { state: "EXPIRED" } });
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
  });
  it("reports native exit and permits explicit failed-session release only after owned termination", async () => {
    const test = setup();
    await ready(test);
    test.exit();
    await vi.advanceTimersByTimeAsync(0);
    const reply = await test.host.status({ open_request_id: test.command.open_request_id });
    expect(reply).toMatchObject({
      kind: "STATUS",
      status: { state: "FAILED", failure: "NATIVE_EXIT" },
    });
    if (reply.kind !== "STATUS") throw new Error("fixture exit missing");
    expect(await test.host.close(test.mutation(reply.status))).toMatchObject({
      kind: "STATUS",
      status: { state: "CLOSED", failure: null },
    });
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
  });
  it("keeps failed close UNKNOWN when owned termination is unverified", async () => {
    const test = setup({ timeoutMs: 20 });
    await ready(test);
    vi.mocked(test.connection.terminate).mockImplementationOnce(() => new Promise(() => {}));
    test.exit();
    await vi.advanceTimersByTimeAsync(21);
    const result = await test.host.status({ open_request_id: test.command.open_request_id });
    if (result.kind !== "STATUS") throw new Error("fixture exit missing");
    expect(await test.host.close(test.mutation(result.status))).toEqual({ kind: "UNKNOWN" });
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
  });
  it("handles synchronous exit subscription and tears it down without leaking", async () => {
    const test = setup(),
      unsubscribe = vi.fn();
    vi.mocked(test.connection.onExit).mockImplementationOnce((listener) => {
      listener();
      return unsubscribe;
    });
    expect(await test.host.open(test.command)).toMatchObject({
      kind: "STATUS",
      status: { state: "FAILED", failure: "NATIVE_EXIT" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
    expect(test.connection.status).not.toHaveBeenCalled();
  });
  it("captures command identity before an asynchronous plan read", async () => {
    const test = setup();
    const raw = structuredClone(test.command);
    const opening = test.host.open(raw);
    raw.identity.assembly_head_revision = 999;
    const result = await readyReply(opening);
    expect(result.identity.assembly_head_revision).toBe(
      test.command.identity.assembly_head_revision,
    );
    expect(test.runtime.open).toHaveBeenCalledTimes(1);
  });
  it("expires duplicate open receipts even before a delayed expiry timer runs", async () => {
    const test = setup({ leaseMs: 1000 });
    await ready(test);
    vi.setSystemTime("2026-10-11T07:00:02Z");
    expect(await test.host.open(test.command)).toMatchObject({
      kind: "STATUS",
      status: { state: "EXPIRED" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
  });
  it("never launches when the original plan read times out and later returns", async () => {
    const test = setup({ timeoutMs: 20 });
    let finish!: (value: { kind: "READY"; receipt: NativePreviewPlanResponse }) => void;
    test.resolvePlan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = test.host.open(test.command);
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toEqual({ kind: "UNKNOWN" });
    finish({ kind: "READY", receipt: test.receipt });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.runtime.open).not.toHaveBeenCalled();
    expect(await test.host.open(test.command)).toEqual({ kind: "UNKNOWN" });
  });
  it("bounds session/command journals while preserving original IDs and explicit close", async () => {
    const test = setup({ maxSessions: 1, maxCommands: 1 }),
      status = await ready(test);
    const play = await test.host.play(test.mutation(status));
    if (play.kind !== "STATUS") throw new Error("fixture play missing");
    expect(await test.host.pause(test.mutation(play.status, "c"))).toEqual({
      kind: "UNAVAILABLE",
      reason: "TRANSPORT_NOT_READY",
    });
    expect(await test.host.close(test.mutation(play.status, "d"))).toMatchObject({
      kind: "STATUS",
      status: { state: "CLOSED" },
    });
    expect(
      await test.host.open({ ...test.command, open_request_id: "pvo_" + "e".repeat(32) }),
    ).toEqual({ kind: "UNAVAILABLE", reason: "TRANSPORT_NOT_READY" });
  });
  it("waits for bounded owned cleanup during shutdown without synthesizing a frame", async () => {
    const test = setup({ timeoutMs: 20 });
    await ready(test);
    let finish!: () => void;
    vi.mocked(test.connection.terminate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let completed = false;
    const shutdown = test.host.shutdown().then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(false);
    finish();
    await shutdown;
    expect(completed).toBe(true);
    expect(test.connection.terminate).toHaveBeenCalledTimes(1);
    expect(await test.host.status({ open_request_id: test.command.open_request_id })).toMatchObject(
      {
        kind: "STATUS",
        status: { state: "EXPIRED", clock: { shown_frame_index: null, authority: "UNVERIFIED" } },
      },
    );
  });
  it.each(["project", "episode"])(
    "does not block an independent %s or permit old callbacks into it",
    async (scope) => {
      const test = setup();
      const first = await ready(test);
      if (scope === "project") test.receipt.data.plan.source.project_id = "prj_" + "f".repeat(32);
      else test.receipt.data.plan.source.episode_id = "ep_" + "f".repeat(32);
      test.receipt.data.plan_hash = `sha256:${createHash("sha256").update(visualJson(test.receipt.data.plan)).digest("hex")}`;
      const second = await test.host.open({
        open_request_id: "pvo_" + "b".repeat(32),
        identity: identity(test.receipt),
      });
      expect(second.kind).toBe("STATUS");
      if (second.kind !== "STATUS") throw new Error("second protocol missing");
      expect(second.status.session_id).not.toBe(first.session_id);
      expect(test.runtime.open).toHaveBeenCalledTimes(2);
      // This intentionally single fake connection now echoes the second session; the first must reject it.
      expect(await test.host.status({ open_request_id: test.command.open_request_id })).toEqual({
        kind: "UNKNOWN",
      });
    },
  );
});
async function readyReply(promise: Promise<unknown>): Promise<MediaPreviewStatus> {
  const value = (await promise) as { kind: string; status: MediaPreviewStatus };
  expect(value.kind).toBe("STATUS");
  return value.status;
}
