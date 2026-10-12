/** Controlled byte pipes only. Never a process, binary, compiler, decoder or native window. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { admitMltPeClosure } from "./media-preview-pe-admission";
import { syntheticPeMaterial } from "./media-preview-pe-admission.test-support";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { NativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import {
  createMltNativeProcessRuntime,
  type MltLaunchLease,
  type OwnedMltProcess,
} from "./media-preview-native-runtime";
import type { MediaPreviewMutation } from "./media-preview-session-contract";
import { createManagedMediaPreviewHost } from "./media-preview-supervisor";
import {
  decodeMltStatus,
  encodeMltOpen,
  MLT_MAX_PACKET_BYTES,
  type MltPrivateMaterial,
  type MltWireOpen,
} from "./media-preview-native-wire";

function fixture(): MltWireOpen {
  const receipt: NativePreviewPlanResponse = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/native-preview-plan.json"),
      "utf8",
    ),
  );
  const s = receipt.data.plan.source;
  return {
    session_id: "pvs_" + "a".repeat(32),
    generation: 1,
    open_request_id: "pvo_" + "b".repeat(32),
    expires_at: "2026-10-11T23:05:00.000Z",
    identity: {
      project_id: s.project_id,
      episode_id: s.episode_id,
      assembly_artifact_id: s.assembly_artifact_id!,
      assembly_version_id: s.assembly_version_id!,
      assembly_content_hash: s.assembly_content_hash!,
      assembly_head_revision: s.assembly_head_revision!,
      plan_hash: receipt.data.plan_hash,
    },
    plan: receipt.data,
  };
}
function material(command = fixture()): MltPrivateMaterial {
  const media = command.plan.plan.video_tracks[0]!.clips[0]!.media;
  const { profile } = syntheticPeMaterial();
  const files = profile.files;
  return {
    profile,
    runtime_root: "C:\\sealed",
    profile_hash: `sha256:${createHash("sha256").update(visualJson(profile)).digest("hex")}`,
    framework_path: "C:\\sealed\\libmlt-7.dll",
    module_directory: "C:\\sealed\\modules",
    data_directory: "C:\\sealed\\data",
    runtime_files: files.map((file) => ({
      path: "C:\\sealed\\" + file.relative_path,
      sha256: file.sha256,
      byte_size: file.byte_size,
    })),
    sources: [
      {
        path: "C:\\session\\selected.source",
        sha256: media.sha256,
        byte_size: media.byte_size,
        asset_id: media.asset_id,
        asset_version_id: media.asset_version_id,
      },
    ],
  };
}
function reply(command: MltWireOpen, sequence = 0, state = 0, frame = 0): Buffer {
  const parts: Buffer[] = [];
  const u32 = (value: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value);
    parts.push(b);
  };
  const text = (value: string) => {
    const bytes = Buffer.from(value);
    u32(bytes.length);
    parts.push(bytes);
  };
  u32(1);
  u32(2);
  u32(sequence);
  text(command.session_id);
  u32(command.generation);
  text(command.open_request_id);
  text(visualJson(command.identity));
  text(command.expires_at);
  u32(state);
  u32(frame);
  const body = Buffer.concat(parts),
    size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([size, body]);
}
function setup(timeoutMs = 1000) {
  const command = fixture(),
    source = material(command);
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  let exit = () => {},
    respond = true,
    exitAfterClose = false,
    nativeState = 0,
    nativeFrame = 0;
  const writes: Buffer[] = [];
  const owned: OwnedMltProcess = {
    stdin,
    stdout,
    stderr,
    killAndWait: vi.fn(async () => {}),
    onExit: vi.fn((listener) => {
      exit = listener;
      return () => {};
    }),
  };
  stdin.on("data", (packet: Buffer) => {
    writes.push(packet);
    if (!respond) return;
    const body = packet.subarray(4),
      kind = body.readUInt32LE(4);
    if (kind === 1) stdout.write(reply(command));
    else {
      const id = body.readUInt32LE(8),
        operation = body.readUInt32LE(16);
      if (operation !== 0) {
        nativeState = operation === 1 ? 1 : operation === 4 ? 3 : 2;
        nativeFrame =
          operation === 3 ? body.readUInt32LE(body.length - 4) : operation === 4 ? 0xffff_ffff : 0;
      }
      stdout.write(
        reply({ ...command, generation: body.readUInt32LE(12) }, id, nativeState, nativeFrame),
      );
      if (operation === 4 && exitAfterClose) exit();
    }
  });
  const synthetic = syntheticPeMaterial();
  const lease: MltLaunchLease = {
    material: source,
    pe_admission: admitMltPeClosure(
      source.profile,
      synthetic.receipt,
      synthetic.held,
      synthetic.system,
    ),
    launch: vi.fn(async (packet: Buffer) => {
      // Controlled opening delivery before returning the owned streams.
      stdin.write(packet);
      return owned;
    }),
    release: vi.fn(async () => {}),
  };
  const prepare = vi.fn(async (raw: MltWireOpen) => {
    Object.assign(command, structuredClone(raw));
    return lease;
  });
  const runtime = createMltNativeProcessRuntime({
    admittedProfileHashes: [source.profile_hash],
    prepare,
    timeoutMs,
  });
  return {
    command,
    source,
    runtime,
    owned,
    lease,
    prepare,
    stdout,
    stderr,
    writes,
    setRespond: (value: boolean) => {
      respond = value;
    },
    exit: () => exit(),
    closeThenExit: () => {
      exitAfterClose = true;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
it("refuses an unadmitted profile before preparation or launch", async () => {
  const test = setup();
  const runtime = createMltNativeProcessRuntime({
    admittedProfileHashes: [],
    prepare: test.prepare,
  });
  await expect(runtime.open(test.command)).rejects.toThrow("No MLT");
  expect(test.prepare).not.toHaveBeenCalled();
});
it.each([
  "profile",
  "source-version",
  "source-hash",
  "source-size",
  "duplicate",
  "path",
  "framework",
  "surrogate",
])("refuses wrong private material before launch: %s", async (fault) => {
  const test = setup(),
    file = test.source.sources[0]!;
  if (fault === "profile") test.source.profile_hash = "sha256:" + "e".repeat(64);
  if (fault === "source-version") file.asset_version_id = "asv_" + "e".repeat(32);
  if (fault === "source-hash") file.sha256 = "e".repeat(64);
  if (fault === "source-size") file.byte_size++;
  if (fault === "duplicate") test.source.sources.push({ ...file });
  if (fault === "path") file.path = "C:\\session\\..\\escaped";
  if (fault === "framework") test.source.framework_path = "C:\\other\\libmlt-7.dll";
  if (fault === "surrogate") file.path = "C:\\session\\\ud800";
  await expect(test.runtime.open(test.command)).rejects.toThrow();
  expect(test.lease.launch).not.toHaveBeenCalled();
  expect(test.lease.release).toHaveBeenCalledOnce();
});
it("rejects TEST and mutated plan before launch", () => {
  const test = setup();
  test.command.plan.plan.scope = "ENGINEERING_TEST";
  expect(() => encodeMltOpen(test.command, test.source, [test.source.profile_hash])).toThrow();
  test.command.plan.plan.scope = "DRAFT_PREVIEW";
  test.command.plan.plan.canvas_width++;
  expect(() => encodeMltOpen(test.command, test.source, [test.source.profile_hash])).toThrow();
});
it.each([
  "claimed-hash",
  "runtime-hash",
  "runtime-size",
  "extra-profile-field",
  "omitted-notice",
  "capability",
  "network",
  "module",
])("requires complete profile/body/inventory agreement: %s", async (fault) => {
  const test = setup();
  if (fault === "claimed-hash") test.source.profile.source_patch_sha256 = "0".repeat(64);
  if (fault === "runtime-hash") test.source.runtime_files[0]!.sha256 = "0".repeat(64);
  if (fault === "runtime-size") test.source.runtime_files[0]!.byte_size++;
  if (fault === "extra-profile-field")
    Object.assign(test.source.profile, { automatic_update: true });
  if (fault === "omitted-notice") test.source.profile.files.pop();
  if (fault === "capability")
    Object.assign(test.source.profile.capability, { audio_output_clock: true });
  if (fault === "network") Object.assign(test.source.profile, { network_disabled_build: false });
  if (fault === "module") test.source.profile.files[2]!.relative_path = "modules\\foreign.dll";
  await expect(test.runtime.open(test.command)).rejects.toThrow();
  expect(test.lease.launch).not.toHaveBeenCalled();
  expect(test.lease.release).toHaveBeenCalledOnce();
});
it("retains a partial rejected launch lease for its owner to reconcile", async () => {
  const test = setup();
  test.lease.launch = vi.fn(async () => {
    throw new Error("Partial native Job startup unknown");
  });
  await expect(test.runtime.open(test.command)).rejects.toThrow("unknown");
  expect(test.lease.launch).toHaveBeenCalledOnce();
  expect(test.lease.release).not.toHaveBeenCalled();
});
it("handles split byte receipts, original mutation dedupe and real host frame proof", async () => {
  const test = setup();
  test.setRespond(false);
  const opening = test.runtime.open(test.command);
  await vi.waitFor(() => expect(test.writes).toHaveLength(1));
  const bytes = reply(test.command);
  test.stdout.write(bytes.subarray(0, 7));
  test.stdout.write(bytes.subarray(7));
  const connection = await opening;
  test.setRespond(true);
  const mutation = {
    session_id: test.command.session_id,
    generation: 2,
    command_id: "pvc_" + "d".repeat(32),
    frame_index: 17,
  };
  const result = await connection.command("seek", mutation);
  expect(result).toMatchObject({
    kind: "STATUS",
    status: {
      state: "PAUSED",
      clock: {
        shown_frame_index: 17,
        authority: "SHOWN_FRAME",
        audio_output_sample_index: null,
        audio_sample_rate_hz: null,
      },
    },
  });
  expect(await connection.command("seek", mutation)).toEqual(result);
  expect(test.writes).toHaveLength(2);
  expect(await connection.command("seek", { ...mutation, frame_index: 18 })).toEqual({
    kind: "UNKNOWN",
  });
  expect(
    await connection.command("seek", {
      ...mutation,
      generation: 1,
      command_id: "pvc_" + "c".repeat(32),
    }),
  ).toEqual({
    kind: "STALE_SESSION",
  });
  await connection.terminate();
  expect(test.owned.killAndWait).toHaveBeenCalledOnce();
  expect(test.lease.release).toHaveBeenCalledOnce();
});
it.each([
  "session",
  "generation",
  "identity",
  "expiry",
  "frame",
  "unsolicited",
  "oversized",
  "stderr",
])("rejects corrupt receipt or flood and terminates: %s", async (fault) => {
  const test = setup(10),
    connection = await test.runtime.open(test.command);
  test.setRespond(false);
  const read = connection.status({ session_id: test.command.session_id, generation: 1 });
  const changed = structuredClone(test.command);
  if (fault === "session") changed.session_id = "pvs_" + "f".repeat(32);
  if (fault === "generation") changed.generation++;
  if (fault === "identity") changed.identity.episode_id = "ep_" + "f".repeat(32);
  if (fault === "expiry") changed.expires_at = "2026-10-11T23:06:00.000Z";
  if (fault === "stderr") test.stderr.write(Buffer.alloc(65537));
  else if (fault === "oversized") {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(MLT_MAX_PACKET_BYTES + 1);
    test.stdout.write(b);
  } else
    test.stdout.write(
      reply(changed, fault === "unsolicited" ? 99 : 1, 2, fault === "frame" ? 50 : 0),
    );
  expect(await read).toEqual({ kind: "UNKNOWN" });
  await connection.terminate();
  expect(test.owned.killAndWait).toHaveBeenCalledOnce();
});
it("unknown timeout never resends and failed owned termination cannot release files", async () => {
  vi.useFakeTimers();
  const test = setup(10),
    connection = await test.runtime.open(test.command);
  test.owned.killAndWait = vi.fn(async () => {
    throw new Error("Unconfirmed Job");
  });
  test.setRespond(false);
  const mutation = {
    session_id: test.command.session_id,
    generation: 2,
    command_id: "pvc_" + "d".repeat(32),
  };
  const request = connection.command("play", mutation);
  await vi.advanceTimersByTimeAsync(11);
  expect(await request).toEqual({ kind: "UNKNOWN" });
  expect(await connection.command("play", mutation)).toEqual({ kind: "UNKNOWN" });
  expect(test.writes).toHaveLength(2);
  await expect(connection.terminate()).rejects.toThrow("Unconfirmed Job");
  expect(test.lease.release).not.toHaveBeenCalled();
});
it("cleans confirmed ownership when exit subscription fails", async () => {
  const test = setup();
  test.owned.onExit = () => {
    throw new Error("Subscription refused");
  };
  await expect(test.runtime.open(test.command)).rejects.toThrow("Subscription");
  expect(test.owned.killAndWait).toHaveBeenCalledOnce();
  expect(test.lease.release).toHaveBeenCalledOnce();
});
it("native exit invalidates reads without claiming hardware time", async () => {
  const test = setup(),
    connection = await test.runtime.open(test.command),
    listener = vi.fn();
  connection.onExit(listener);
  test.exit();
  expect(listener).toHaveBeenCalledOnce();
  expect(await connection.status({ session_id: test.command.session_id, generation: 1 })).toEqual({
    kind: "UNKNOWN",
  });
  await connection.terminate();
  expect(test.lease.release).toHaveBeenCalledOnce();
});
it("status parser rejects trailing bytes, invalid UTF-8 and alternate protocol", () => {
  const packet = reply(fixture()).subarray(4);
  expect(decodeMltStatus(packet).shown_frame).toBe(0);
  expect(() => decodeMltStatus(Buffer.concat([packet, Buffer.from([0])]))).toThrow();
  const version = Buffer.from(packet);
  version.writeUInt32LE(2, 0);
  expect(() => decodeMltStatus(version)).toThrow();
  const corrupt = Buffer.from(packet);
  corrupt[16] = 255;
  expect(() => decodeMltStatus(corrupt)).toThrow();
});
it("production supervisor remains unavailable with runtime null", async () => {
  const test = setup();
  const host = createManagedMediaPreviewHost({ runtime: null, resolvePlan: vi.fn() });
  expect(
    await host.open({
      open_request_id: test.command.open_request_id,
      identity: test.command.identity,
    }),
  ).toEqual({ kind: "UNAVAILABLE", reason: "NATIVE_HOST_NOT_INSTALLED" });
  await host.shutdown();
  expect(test.lease.launch).not.toHaveBeenCalled();
});

it.each(["forged", "cloned", "different-profile"])(
  "refuses unusable held-PE proof before dispatch: %s",
  async (fault) => {
    const test = setup();
    if (fault === "forged") test.lease.pe_admission = { kind: "STATIC_HELD_PE_CLOSURE" };
    else if (fault === "cloned") test.lease.pe_admission = structuredClone(test.lease.pe_admission);
    else {
      const other = syntheticPeMaterial();
      other.profile.source_patch_sha256 = "7".repeat(64);
      test.lease.pe_admission = admitMltPeClosure(
        other.profile,
        other.receipt,
        other.held,
        other.system,
      );
    }
    await expect(test.runtime.open(test.command)).rejects.toThrow("PE closure");
    expect(test.lease.launch).not.toHaveBeenCalled();
    expect(test.lease.release).toHaveBeenCalledOnce();
  },
);

it("composes the production supervisor and byte runtime through advancing generations and ordered close exit", async () => {
  const test = setup();
  test.closeThenExit();
  const receipt: NativePreviewPlanResponse = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/native-preview-plan.json"),
      "utf8",
    ),
  );
  const host = createManagedMediaPreviewHost({
    runtime: test.runtime,
    resolvePlan: async () => ({ kind: "READY", receipt }),
    timeoutMs: 500,
    leaseMs: 120000,
  });
  try {
    let result = await host.open({
      open_request_id: test.command.open_request_id,
      identity: test.command.identity,
    });
    if (result.kind !== "STATUS") throw new Error("Controlled opening missing");
    const opened = result.status;
    for (const [index, kind] of (["play", "pause", "seek", "close"] as const).entries()) {
      const mutation: MediaPreviewMutation = {
        session_id: result.status.session_id,
        generation: result.status.generation,
        command_id: "pvc_" + String(index + 1).repeat(32),
      };
      result =
        kind === "seek"
          ? await host.seek({ ...mutation, frame_index: 17 })
          : await host[kind](mutation);
      expect(result).toMatchObject({
        kind: "STATUS",
        status: {
          generation: index + 2,
          state: kind === "play" ? "PLAYING" : kind === "close" ? "CLOSED" : "PAUSED",
        },
      });
      if (result.kind !== "STATUS") throw new Error("Controlled command missing");
      if (kind !== "close")
        expect(
          await host.status({
            session_id: result.status.session_id,
            generation: result.status.generation,
          }),
        ).toMatchObject({ kind: "STATUS", status: { generation: index + 2 } });
    }
    expect(await host.status({ session_id: opened.session_id, generation: 1 })).toEqual({
      kind: "STALE_SESSION",
    });
    await host.shutdown();
    expect(test.owned.killAndWait).toHaveBeenCalledOnce();
    expect(test.lease.release).toHaveBeenCalledOnce();
  } finally {
    await host.shutdown();
  }
});
it("refuses old and skipped generations before any native write and binds replies to each original waiter", async () => {
  const test = setup(),
    connection = await test.runtime.open(test.command);
  const mutation = {
    session_id: test.command.session_id,
    generation: 1,
    command_id: "pvc_" + "1".repeat(32),
  };
  expect(await connection.command("play", mutation)).toEqual({ kind: "STALE_SESSION" });
  expect(await connection.command("play", { ...mutation, generation: 3 })).toEqual({
    kind: "STALE_SESSION",
  });
  expect(test.writes).toHaveLength(1);
  test.setRespond(false);
  const result = connection.command("play", { ...mutation, generation: 2 });
  // A valid old-generation status cannot satisfy this original generation-2 waiter.
  test.stdout.write(reply(test.command, 1, 1));
  expect(await result).toEqual({ kind: "UNKNOWN" });
  expect(await connection.command("play", { ...mutation, generation: 2 })).toEqual({
    kind: "UNKNOWN",
  });
  expect(test.writes).toHaveLength(2);
  await connection.terminate();
});

it("a pending read cannot mint a control generation or desynchronize the native host", async () => {
  const test = setup();
  const receipt: NativePreviewPlanResponse = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/native-preview-plan.json"),
      "utf8",
    ),
  );
  const host = createManagedMediaPreviewHost({
    runtime: test.runtime,
    resolvePlan: async () => ({ kind: "READY", receipt }),
    timeoutMs: 500,
    leaseMs: 120000,
  });
  try {
    const opened = await host.open({
      open_request_id: test.command.open_request_id,
      identity: test.command.identity,
    });
    if (opened.kind !== "STATUS") throw new Error("Missing controlled status");
    test.setRespond(false);
    const before = test.writes.length;
    const reading = host.status({ session_id: opened.status.session_id, generation: 1 });
    await vi.waitFor(() => expect(test.writes).toHaveLength(before + 1));
    expect(
      await host.play({
        session_id: opened.status.session_id,
        generation: 1,
        command_id: "pvc_" + "c".repeat(32),
      }),
    ).toEqual({ kind: "UNKNOWN" });
    expect(test.writes).toHaveLength(before + 1);
    const packet = test.writes.at(-1)!;
    test.stdout.write(reply(test.command, packet.readUInt32LE(12)));
    expect(await reading).toMatchObject({ kind: "STATUS", status: { generation: 1 } });
    test.setRespond(true);
    expect(
      await host.play({
        session_id: opened.status.session_id,
        generation: 1,
        command_id: "pvc_" + "d".repeat(32),
      }),
    ).toMatchObject({ kind: "STATUS", status: { generation: 2, state: "PLAYING" } });
    expect(
      await host.status({ session_id: opened.status.session_id, generation: 2 }),
    ).toMatchObject({ kind: "STATUS", status: { generation: 2, state: "PLAYING" } });
  } finally {
    await host.shutdown();
  }
});
