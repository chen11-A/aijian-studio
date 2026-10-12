/** Production composition over controlled owned pipes/synthetic PE; no native execution. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { NativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import { syntheticPeMaterial } from "./media-preview-pe-admission.test-support";
import {
  createInstalledMltNativeRuntime,
  prepareOwnedMltLease,
} from "./media-preview-sidecar-runtime";
import { createMltNativeProcessRuntime } from "./media-preview-native-runtime";
import { createSidecarPrivatePipe } from "./sidecar-private-pipe";
import { encodeMltOpen, type MltWireOpen } from "./media-preview-native-wire";

function command(): MltWireOpen {
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
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    plan: receipt.data,
    identity: {
      project_id: s.project_id,
      episode_id: s.episode_id,
      assembly_artifact_id: s.assembly_artifact_id!,
      assembly_version_id: s.assembly_version_id!,
      assembly_content_hash: s.assembly_content_hash!,
      assembly_head_revision: s.assembly_head_revision!,
      plan_hash: receipt.data.plan_hash,
    },
  };
}
function status(opening: MltWireOpen, sequence = 0, state = 0): Buffer {
  const parts: Buffer[] = [];
  const u32 = (v: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(v);
    parts.push(bytes);
  };
  const text = (v: string) => {
    const bytes = Buffer.from(v);
    u32(bytes.length);
    parts.push(bytes);
  };
  u32(1);
  u32(2);
  u32(sequence);
  text(opening.session_id);
  u32(opening.generation);
  text(opening.open_request_id);
  text(visualJson(opening.identity));
  text(opening.expires_at);
  u32(state);
  u32(state === 3 ? 0xffff_ffff : 0);
  const body = Buffer.concat(parts),
    size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([size, body]);
}
async function setup(fault = "") {
  const opening = command(),
    synthetic = syntheticPeMaterial();
  const policy = {
    profile: synthetic.profile,
    peReceipt: synthetic.receipt,
    systemDlls: [...synthetic.system],
  };
  const profileHash = `sha256:${createHash("sha256").update(visualJson(policy.profile)).digest("hex")}`;
  const selected = opening.plan.plan.video_tracks[0]!.clips[0]!.media;
  const material = {
    profile: policy.profile,
    profile_hash: profileHash,
    runtime_root: "C:\\sealed",
    framework_path: "C:\\sealed\\libmlt-7.dll",
    module_directory: "C:\\sealed\\modules",
    data_directory: "C:\\sealed\\data",
    runtime_files: policy.profile.files.map((f) => ({
      path: "C:\\sealed\\" + f.relative_path,
      sha256: f.sha256,
      byte_size: f.byte_size,
    })),
    sources: [{ ...selected, path: "C:\\private\\exact.source" }].map(
      ({ asset_id, asset_version_id, sha256, byte_size, path }) => ({
        asset_id,
        asset_version_id,
        sha256,
        byte_size,
        path,
      }),
    ),
  };
  if (fault === "swapped-source") material.sources[0]!.asset_version_id = "asv_" + "c".repeat(32);
  const leaseId = "npl_" + "d".repeat(32);
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  const transport = createSidecarPrivatePipe({
    stdin,
    stdout,
    childPid: () => 1234,
    parentPid: 4321,
  });
  const emit = (v: unknown) => stdout.write(JSON.stringify(v) + "\n");
  let eventSequence = 0;
  const stream = (data: Buffer) =>
    emit({
      event: "aivora_native_stream",
      peer_pid: 1234,
      lease_id: leaseId,
      sequence: ++eventSequence,
      stream: "stdout",
      bytes: data.toString("base64"),
    });
  const requests: { operation: string; payload: Record<string, unknown> }[] = [];
  const openingPackets: Buffer[] = [],
    commandPackets: Buffer[] = [];
  stdin.on("data", (raw: Buffer) => {
    const request = JSON.parse(raw.toString());
    requests.push(request);
    let value: unknown = { lease_id: leaseId };
    if (request.operation === "prepare")
      value = { lease_id: leaseId, material, pe_receipt: policy.peReceipt };
    if (request.operation === "read") {
      const held = synthetic.held.find((f) => f.relative_path === request.payload.relative_path)!;
      const chunk = Buffer.from(
        held.bytes.subarray(
          request.payload.offset,
          request.payload.offset + request.payload.length,
        ),
      );
      if (fault === "held-bytes") chunk[0] = chunk[0]! ^ 1;
      value = {
        lease_id: fault === "read-lease" ? "npl_" + "e".repeat(32) : leaseId,
        bytes: chunk.toString("base64"),
      };
    }
    if (request.operation === "launch") {
      openingPackets.push(Buffer.from(request.payload.bytes, "base64"));
      stream(status(opening));
      if (fault === "launch-ack") value = { lease_id: "npl_" + "e".repeat(32) };
    }
    if (request.operation === "write") {
      const packet = Buffer.from(request.payload.bytes, "base64");
      commandPackets.push(packet);
      stream(
        status({ ...opening, generation: packet.readUInt32LE(16) }, packet.readUInt32LE(12), 1),
      );
    }
    if (request.operation === "stop")
      value = {
        lease_id: leaseId,
        start_settled: true,
        zero_active: fault !== "stop-proof",
        readers_joined: true,
        owner_closed: true,
      };
    emit({
      event: "aivora_native_reply",
      peer_pid: 1234,
      request_id: request.request_id,
      result: { kind: "OK", value },
    });
  });
  emit({
    event: "ready",
    host: "127.0.0.1",
    pid: 1234,
    port: 45000,
    protocol_version: 1,
    token: "a".repeat(43),
  });
  await transport.ready;
  const runtime = createMltNativeProcessRuntime({
    admittedProfileHashes: [profileHash],
    prepare: (c) => prepareOwnedMltLease(transport.pipe, policy, c),
    timeoutMs: 100,
  });
  return { opening, material, runtime, transport, requests, openingPackets, commandPackets };
}
it("production compiled policy remains closed even for a packaged Windows caller", () => {
  expect(
    createInstalledMltNativeRuntime({
      platform: "win32",
      packaged: true,
      getPipe: () => {
        throw new Error("Empty release policy must not access any pipe");
      },
    }),
  ).toBeNull();
});
it("reads exact held PE bytes, freezes OPEN before dispatch and sends only later commands", async () => {
  const test = await setup();
  const connection = await test.runtime.open(test.opening);
  expect(test.openingPackets).toHaveLength(1);
  expect(test.openingPackets[0]).toEqual(
    encodeMltOpen(test.opening, test.material, [test.material.profile_hash]),
  );
  expect(test.commandPackets).toHaveLength(0);
  const result = await connection.command("play", {
    session_id: test.opening.session_id,
    generation: 2,
    command_id: "pvc_" + "f".repeat(32),
  });
  expect(result).toMatchObject({ kind: "STATUS" });
  expect(test.commandPackets).toHaveLength(1);
  expect(test.commandPackets[0]!.readUInt32LE(8)).toBe(3);
  await connection.terminate();
  expect(test.requests.filter((r) => r.operation === "stop")).toHaveLength(1);
  expect(test.requests.filter((r) => r.operation === "release")).toHaveLength(1);
  test.transport.pipe.close();
});
it.each(["held-bytes", "read-lease", "swapped-source"])(
  "rejects %s before native dispatch and releases pending preparation",
  async (fault) => {
    const test = await setup(fault);
    await expect(test.runtime.open(test.opening)).rejects.toThrow();
    expect(test.openingPackets).toHaveLength(0);
    expect(test.requests.filter((r) => r.operation === "release")).toHaveLength(1);
    test.transport.pipe.close();
  },
);
it("retains partial ownership after contradictory launch acknowledgement without replay", async () => {
  const test = await setup("launch-ack");
  await expect(test.runtime.open(test.opening)).rejects.toThrow();
  expect(test.openingPackets).toHaveLength(1);
  expect(test.requests.filter((r) => r.operation === "release")).toHaveLength(0);
  test.transport.pipe.close();
});
it("refuses false Job termination proof and does not release or resend stop", async () => {
  const test = await setup("stop-proof");
  const connection = await test.runtime.open(test.opening);
  await expect(connection.terminate()).rejects.toThrow("complete stop");
  await expect(connection.terminate()).rejects.toThrow("complete stop");
  expect(test.requests.filter((r) => r.operation === "stop")).toHaveLength(1);
  expect(test.requests.filter((r) => r.operation === "release")).toHaveLength(0);
  test.transport.pipe.close();
});
