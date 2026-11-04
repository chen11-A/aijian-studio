import { randomBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { parseSidecarHandshake, type SidecarSession } from "./sidecar-protocol";
import { isRecord } from "./api-contract-guards";

/** Owned spawn pipes only. No HTTP, preload, paths, environment opt-in or reconnect. */
export const PRIVATE_PIPE_MAX_LINE = 262_144;
export type NativePrivateOperation = "prepare" | "read" | "launch" | "write" | "stop" | "release";
export type PrivatePipeResult =
  { kind: "OK"; value: unknown } | { kind: "UNKNOWN" | "UNAVAILABLE" | "REFUSED" };
export interface SidecarPrivatePipe {
  request(operation: NativePrivateOperation, payload: unknown): Promise<PrivatePipeResult>;
  onStream(listener: (event: Record<string, unknown>) => boolean): () => void;
  onFailure(listener: () => void): () => void;
  close(): void;
}
function fields(value: Record<string, unknown>, names: readonly string[]) {
  return Object.keys(value).length === names.length && names.every((n) => Object.hasOwn(value, n));
}
export function createSidecarPrivatePipe(options: {
  stdin: Writable;
  stdout: Readable;
  childPid: () => number | undefined;
  parentPid?: number;
  timeoutMs?: number;
}): { ready: Promise<SidecarSession>; pipe: SidecarPrivatePipe } {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("Private pipe timeout is unbounded");
  let resolveReady!: (session: SidecarSession) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<SidecarSession>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let session: SidecarSession | null = null;
  let failed = false;
  let remainder = Buffer.alloc(0);
  let pending: {
    id: string;
    resolve: (result: PrivatePipeResult) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const streams = new Set<(event: Record<string, unknown>) => boolean>();
  const failures = new Set<() => void>();
  let queued = 0;
  let serial: Promise<void> = Promise.resolve();
  function fail() {
    if (failed) return;
    failed = true;
    remainder = Buffer.alloc(0);
    rejectReady(new Error("Owned sidecar pipe is unavailable"));
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ kind: "UNKNOWN" });
      pending = null;
    }
    for (const listener of failures) {
      try {
        listener();
      } catch {
        /* Preserve other owners. */
      }
    }
    // EOF wakes sidecar's local owner shutdown; root exit itself is never a Job proof.
    if (!options.stdin.writableEnded && !options.stdin.destroyed) options.stdin.end();
  }
  function line(bytes: Buffer) {
    if (failed) return;
    if (bytes.includes(13) || Buffer.from(bytes.toString("utf8")).compare(bytes) !== 0)
      throw new Error("Invalid private pipe encoding");
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (JSON.stringify(value) !== bytes.toString("utf8"))
      throw new Error("Private JSON is noncanonical or has duplicate fields");
    if (!session) {
      const parsed = parseSidecarHandshake(bytes.toString("utf8"));
      if (parsed.pid !== options.childPid()) throw new Error("Handshake is from a different child");
      session = parsed;
      resolveReady(parsed);
      return;
    }
    if (!isRecord(value) || value.peer_pid !== session.pid)
      throw new Error("Private reply peer differs from the owned child");
    if (value.event === "aivora_native_stream") {
      if (!fields(value, ["event", "peer_pid", "lease_id", "sequence", "stream", "bytes"]))
        throw new Error("Unknown private stream fields");
      let owners = 0;
      for (const listener of streams) if (listener(value)) owners++;
      if (owners !== 1) throw new Error("Stream has no unique original owner");
      return;
    }
    if (
      value.event !== "aivora_native_reply" ||
      !fields(value, ["event", "peer_pid", "request_id", "result"]) ||
      !pending ||
      value.request_id !== pending.id ||
      !isRecord(value.result)
    )
      throw new Error("Private reply is uncorrelated");
    const result = value.result;
    if (
      !(result.kind === "OK"
        ? fields(result, ["kind", "value"])
        : ["UNKNOWN", "UNAVAILABLE", "REFUSED"].includes(String(result.kind)) &&
          fields(result, ["kind"]))
    )
      throw new Error("Unknown private result");
    clearTimeout(pending.timer);
    pending.resolve(result as PrivatePipeResult);
    pending = null;
  }
  function data(chunk: Buffer) {
    if (failed) return; // Keep draining owned stdout after poisoning, without buffering it.
    try {
      if (!Buffer.isBuffer(chunk)) throw new Error("Private stdout must contain bytes");
      let first = 0;
      for (;;) {
        const next = chunk.indexOf(10, first);
        const end = next < 0 ? chunk.length : next;
        const part = chunk.subarray(first, end);
        const limit = session ? PRIVATE_PIPE_MAX_LINE : 4096;
        if (remainder.length + part.length > limit) throw new Error("Private line is too large");
        remainder = Buffer.concat([remainder, part]);
        if (next < 0) break;
        const complete = remainder;
        remainder = Buffer.alloc(0);
        line(complete);
        if (failed) return;
        first = next + 1;
      }
    } catch {
      fail();
    }
  }
  options.stdout.on("data", data);
  options.stdout.on("error", fail);
  options.stdout.on("end", fail);
  options.stdin.on("error", fail);
  return {
    ready,
    pipe: {
      request(operation, payload) {
        if (failed || !session || queued >= 64) return Promise.resolve({ kind: "UNKNOWN" });
        const id = "npr_" + randomBytes(16).toString("hex");
        let bytes: Buffer;
        try {
          bytes = Buffer.from(
            JSON.stringify({
              event: "aivora_native_request",
              request_id: id,
              peer_pid: session.pid,
              parent_pid: options.parentPid ?? process.pid,
              operation,
              payload,
            }) + "\n",
          );
          if (bytes.length > PRIVATE_PIPE_MAX_LINE) throw new Error("Private request is too large");
        } catch {
          return Promise.resolve({ kind: "UNKNOWN" });
        }
        queued++;
        const result = serial.then(() => {
          if (failed || pending) return { kind: "UNKNOWN" } as PrivatePipeResult;
          return new Promise<PrivatePipeResult>((resolve) => {
            const timer = setTimeout(fail, timeoutMs);
            timer.unref?.();
            pending = { id, resolve, timer };
            try {
              options.stdin.write(bytes, (error) => {
                if (error) fail();
              });
            } catch {
              fail();
            }
          });
        });
        serial = result.then(
          () => undefined,
          () => undefined,
        );
        return result.finally(() => {
          queued--;
        });
      },
      onStream(listener) {
        streams.add(listener);
        return () => {
          streams.delete(listener);
        };
      },
      onFailure(listener) {
        if (failed) listener();
        failures.add(listener);
        return () => {
          failures.delete(listener);
        };
      },
      close: fail,
    },
  };
}
