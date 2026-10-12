import { createHash } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import { visualJson } from "@aijian/contracts/visual-bible";
import { isRecord } from "./api-contract-guards";
import { ADMITTED_INSTALLED_MLT, type InstalledMltPolicy } from "./media-preview-installed-policy";
import {
  createMltNativeProcessRuntime,
  type MltLaunchLease,
  type OwnedMltProcess,
} from "./media-preview-native-runtime";
import {
  encodeMltOpen,
  type MltPrivateMaterial,
  type MltWireOpen,
} from "./media-preview-native-wire";
import { admitMltPeClosure, type HeldPeBytes } from "./media-preview-pe-admission";
import type { TrustedNativePreviewRuntime } from "./media-preview-supervisor";
import type { SidecarPrivatePipe, PrivatePipeResult } from "./sidecar-private-pipe";

const fields = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).length === names.length && names.every((n) => Object.hasOwn(value, n));
function ok(result: PrivatePipeResult): Record<string, unknown> {
  if (result.kind !== "OK" || !isRecord(result.value))
    throw new Error("Owned native result is unknown");
  return result.value;
}
function bytes(value: unknown, length: number): Buffer {
  if (typeof value !== "string" || value.length > 174_772) throw new Error("Invalid private bytes");
  const buffer = Buffer.from(value, "base64");
  if (buffer.length !== length || buffer.toString("base64") !== value)
    throw new Error("Private bytes are truncated or noncanonical");
  return buffer;
}
/** Production main entry. Even a supplied pipe cannot populate compiled release policy. */
export function createInstalledMltNativeRuntime(options: {
  platform: NodeJS.Platform;
  packaged: boolean;
  getPipe: () => SidecarPrivatePipe | null;
}): TrustedNativePreviewRuntime | null {
  if (options.platform !== "win32" || !options.packaged || ADMITTED_INSTALLED_MLT.length !== 1)
    return null;
  const policy = ADMITTED_INSTALLED_MLT[0]!;
  const hash = `sha256:${createHash("sha256").update(visualJson(policy.profile)).digest("hex")}`;
  return createMltNativeProcessRuntime({
    admittedProfileHashes: [hash],
    async prepare(command) {
      const pipe = options.getPipe();
      if (!pipe) throw new Error("Owned installed sidecar is unavailable");
      return prepareOwnedMltLease(pipe, policy, command);
    },
  });
}
/** Internal composition also exercised by controlled byte-pipe tests. Not an IPC API. */
export async function prepareOwnedMltLease(
  pipe: SidecarPrivatePipe,
  policy: InstalledMltPolicy,
  command: MltWireOpen,
): Promise<MltLaunchLease> {
  const profileHash = `sha256:${createHash("sha256").update(visualJson(policy.profile)).digest("hex")}`;
  const prepared = ok(
    await pipe.request("prepare", { opening: command, profile_hash: profileHash }),
  );
  if (
    !fields(prepared, ["lease_id", "material", "pe_receipt"]) ||
    typeof prepared.lease_id !== "string" ||
    !/^npl_[0-9a-f]{32}$/.test(prepared.lease_id)
  )
    throw new Error("Private preparation is uncorrelated");
  const leaseId = prepared.lease_id;
  let launched = false,
    stopped = false,
    released = false,
    ended = false,
    sequence = 0;
  let stdoutBytes = 0,
    stderrBytes = 0;
  const stdout = new PassThrough(),
    stderr = new PassThrough();
  // During preparation/partial launch there may be no runtime listener yet.
  stdout.on("error", () => undefined);
  stderr.on("error", () => undefined);
  const exits = new Set<() => void>();
  function exit() {
    if (ended) return;
    ended = true;
    for (const listener of exits) listener();
  }
  let termination: Promise<void> | null = null;
  const unsubscribeFailure = pipe.onFailure(exit);
  const unsubscribeStream = pipe.onStream((event) => {
    if (event.lease_id !== leaseId) return false;
    if (
      !fields(event, ["event", "peer_pid", "lease_id", "sequence", "stream", "bytes"]) ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence !== sequence + 1 ||
      sequence >= 4096 ||
      !["stdout", "stderr", "exit"].includes(String(event.stream)) ||
      !launched ||
      released ||
      ended
    )
      throw new Error("Owned pipe event differs from its original lease");
    sequence++;
    if (event.stream === "exit") {
      if (event.bytes !== "") throw new Error("Exit observation contains unknown bytes");
      exit();
      return true;
    }
    if (typeof event.bytes !== "string") throw new Error("Invalid owned pipe bytes");
    const raw = Buffer.from(event.bytes, "base64");
    if (!raw.length || raw.length > 4096 || raw.toString("base64") !== event.bytes)
      throw new Error("Owned pipe bytes are invalid");
    if (event.stream === "stdout") {
      stdoutBytes += raw.length;
      if (stdoutBytes > 2_097_152) throw new Error("Owned stdout limit exceeded");
      stdout.write(raw);
    } else {
      stderrBytes += raw.length;
      if (stderrBytes > 65_536) throw new Error("Owned stderr limit exceeded");
      stderr.write(raw);
    }
    return true;
  });
  async function release() {
    if (released) return;
    if (launched && !stopped) throw new Error("Owned native stop is unconfirmed");
    const result = ok(await pipe.request("release", { lease_id: leaseId }));
    if (!fields(result, ["lease_id"]) || result.lease_id !== leaseId)
      throw new Error("Native release is uncorrelated");
    released = true;
    unsubscribeStream();
    unsubscribeFailure();
    stdout.destroy();
    stderr.destroy();
    exit();
  }
  try {
    if (
      !isRecord(prepared.material) ||
      !fields(prepared.material, [
        "profile_hash",
        "profile",
        "runtime_root",
        "framework_path",
        "module_directory",
        "data_directory",
        "runtime_files",
        "sources",
      ]) ||
      prepared.material.profile_hash !== profileHash ||
      visualJson(prepared.material.profile) !== visualJson(policy.profile) ||
      visualJson(prepared.pe_receipt) !== visualJson(policy.peReceipt)
    )
      throw new Error("Owned material differs from compiled release policy");
    const material = prepared.material as MltPrivateMaterial;
    encodeMltOpen(command, material, [profileHash]); // Bounds and exact source before allocating bytes.
    const held: HeldPeBytes[] = [];
    let total = 0;
    for (const file of policy.profile.files) {
      total += file.byte_size;
      if (total > 2_147_483_648) throw new Error("Held PE inventory is too large");
      const raw = Buffer.alloc(file.byte_size);
      for (let offset = 0; offset < raw.length;) {
        const length = Math.min(65_536, raw.length - offset);
        const response = ok(
          await pipe.request("read", {
            lease_id: leaseId,
            relative_path: file.relative_path,
            offset,
            length,
          }),
        );
        if (!fields(response, ["lease_id", "bytes"]) || response.lease_id !== leaseId)
          throw new Error("Held-byte receipt differs from its lease");
        bytes(response.bytes, length).copy(raw, offset);
        offset += length;
      }
      held.push({ relative_path: file.relative_path, bytes: raw });
    }
    const proof = admitMltPeClosure(policy.profile, prepared.pe_receipt, held, policy.systemDlls);
    const stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (!launched || stopped || released || !Buffer.isBuffer(chunk)) {
          callback(new Error("Owned native writer is unavailable"));
          return;
        }
        void pipe.request("write", { lease_id: leaseId, bytes: chunk.toString("base64") }).then(
          (result) => {
            try {
              const value = ok(result);
              if (!fields(value, ["lease_id"]) || value.lease_id !== leaseId)
                throw new Error("Uncorrelated write");
              callback();
            } catch {
              callback(new Error("Owned native write is unknown"));
            }
          },
          () => callback(new Error("Owned native write is unknown")),
        );
      },
    });
    stdin.on("error", () => undefined);
    const owned: OwnedMltProcess = {
      stdin,
      stdout,
      stderr,
      killAndWait() {
        termination ??= (async () => {
          const result = ok(await pipe.request("stop", { lease_id: leaseId }));
          if (
            !fields(result, [
              "lease_id",
              "start_settled",
              "zero_active",
              "readers_joined",
              "owner_closed",
            ]) ||
            result.lease_id !== leaseId ||
            result.start_settled !== true ||
            result.zero_active !== true ||
            result.readers_joined !== true ||
            result.owner_closed !== true
          )
            throw new Error("Original native owner did not prove complete stop");
          stopped = true;
          stdin.destroy();
          exit();
        })();
        return termination;
      },
      onExit(listener) {
        if (ended) listener();
        exits.add(listener);
        return () => {
          exits.delete(listener);
        };
      },
    };
    let launching: Promise<OwnedMltProcess> | null = null;
    return {
      material,
      pe_admission: proof,
      release,
      launch(openingPacket) {
        launching ??= (async () => {
          if (
            released ||
            ended ||
            openingPacket.compare(encodeMltOpen(command, material, [profileHash])) !== 0
          )
            throw new Error("Opening differs from the original owned exact plan");
          launched = true;
          const response = ok(
            await pipe.request("launch", {
              lease_id: leaseId,
              bytes: openingPacket.toString("base64"),
            }),
          );
          if (!fields(response, ["lease_id"]) || response.lease_id !== leaseId)
            throw new Error("Native launch is uncorrelated");
          return owned;
        })();
        return launching;
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
