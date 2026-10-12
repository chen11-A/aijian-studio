import type { Readable, Writable } from "node:stream";
import { requireMltPeAdmission, type MltPeAdmission } from "./media-preview-pe-admission";
import { visualJson } from "@aijian/contracts/visual-bible";
import {
  isMediaPreviewMutation,
  isSeekMediaPreviewCommand,
  type MediaPreviewResult,
  type MediaPreviewStatus,
} from "./media-preview-session-contract";
import type {
  NativePreviewConnection,
  TrustedNativePreviewRuntime,
} from "./media-preview-supervisor";
import {
  decodeMltStatus,
  encodeMltCommand,
  encodeMltOpen,
  MLT_MAX_PACKET_BYTES,
  type MltPrivateMaterial,
  type MltWireOpen,
} from "./media-preview-native-wire";

/** This seam must own a pre-resume Windows Job, held loader files and source snapshots.
 * killAndWait may resolve only after the Job reports zero active processes and pipes join.
 * It cannot be implemented as a child.kill()/exit-event shortcut.
 */
export interface OwnedMltProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killAndWait(): Promise<void>;
  onExit(listener: () => void): () => void;
}
export interface MltLaunchLease {
  material: MltPrivateMaterial;
  /** Minted from raw bytes read from the native held handles, bound to full profile. */
  pe_admission: MltPeAdmission;
  /** No shell/PATH/renderer paths; owns every partial-launch cleanup on rejection. */
  /** Opening is frozen before synchronous owned dispatch, never sent again on stdin. */
  launch(openingPacket: Buffer): Promise<OwnedMltProcess>;
  /** Release held sources/runtime only after confirmed owned termination. */
  release(): Promise<void>;
}
type Options = {
  /** Trusted application release policy, not a user manifest or environment toggle. */
  admittedProfileHashes: readonly string[];
  prepare: (command: MltWireOpen) => Promise<MltLaunchLease>;
  timeoutMs?: number;
};
/** Private integration factory; production composition admits only compiled reviewed profiles. */
export function createMltNativeProcessRuntime(options: Options): TrustedNativePreviewRuntime {
  const admitted = [...options.admittedProfileHashes];
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("MLT protocol timeout must be bounded");
  return {
    async open(raw) {
      const command = structuredClone(raw);
      if (admitted.length === 0) throw new Error("No MLT binary/license profile is admitted");
      const lease = await options.prepare(command);
      let packet: Buffer;
      try {
        requireMltPeAdmission(lease.pe_admission, lease.material.profile);
        packet = encodeMltOpen(command, lease.material, admitted);
      } catch (error) {
        await lease.release();
        throw error;
      }
      // prepare/launch own their late/partial work. A rejected launch cannot release its lease:
      // native cleanup must be proved by its owner, rather than guessed from Promise rejection.
      const owned = await lease.launch(packet);
      let generation = command.generation,
        sequence = 0,
        ended = false,
        failed = false,
        terminating: Promise<void> | null = null;
      let buffer = Buffer.alloc(0),
        outputBytes = 0,
        errorBytes = 0;
      const listeners = new Set<() => void>();
      const pending = new Map<
        number,
        {
          generation: number;
          resolve: (value: MediaPreviewResult) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();
      function settleUnknown() {
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.resolve({ kind: "UNKNOWN" });
        }
        pending.clear();
      }
      let unsubscribe = () => undefined as void;
      try {
        unsubscribe = owned.onExit(() => {
          ended = true;
          settleUnknown();
          for (const listener of listeners) listener();
        });
      } catch (error) {
        await owned.killAndWait();
        await lease.release();
        throw error;
      }
      const terminate = (): Promise<void> => {
        if (!terminating)
          terminating = (async () => {
            // killAndWait must reject when ownership cannot establish termination. No release then.
            await owned.killAndWait();
            ended = true;
            settleUnknown();
            unsubscribe();
            owned.stdout.off("data", onData);
            owned.stderr.off("data", onErrorData);
            owned.stdin.off("error", fail);
            owned.stdout.off("error", fail);
            owned.stderr.off("error", fail);
            await lease.release();
          })();
        return terminating;
      };
      function fail() {
        if (failed) return;
        failed = true;
        settleUnknown();
        // Retain failed termination; supervisor keeps ownership unavailable until proven stopped.
        void terminate().catch(() => undefined);
      }
      function onErrorData(bytes: Buffer) {
        errorBytes += bytes.length;
        if (errorBytes > 65_536) fail(); // Native diagnostics never enter user-facing receipts.
      }
      function onData(bytes: Buffer) {
        if (failed || ended) return;
        outputBytes += bytes.length;
        if (outputBytes > 2_097_152 || buffer.length + bytes.length > MLT_MAX_PACKET_BYTES * 2) {
          fail();
          return;
        }
        buffer = Buffer.concat([buffer, bytes]);
        while (buffer.length >= 4) {
          const size = buffer.readUInt32LE(0);
          if (size < 32 || size > MLT_MAX_PACKET_BYTES) {
            fail();
            return;
          }
          if (buffer.length < size + 4) return;
          const body = buffer.subarray(4, size + 4);
          buffer = buffer.subarray(size + 4);
          try {
            const reply = decodeMltStatus(body),
              waiter = pending.get(reply.sequence);
            if (
              !waiter ||
              reply.session_id !== command.session_id ||
              reply.generation !== waiter.generation ||
              reply.open_request_id !== command.open_request_id ||
              reply.identity_json !== visualJson(command.identity) ||
              reply.expires_at !== command.expires_at ||
              (reply.shown_frame !== null && reply.shown_frame >= command.plan.plan.total_frames) ||
              (["CLOSED", "FAILED"].includes(reply.state) && reply.shown_frame !== null)
            ) {
              fail();
              return;
            }
            const status: MediaPreviewStatus = {
              session_id: command.session_id,
              generation: reply.generation,
              open_request_id: command.open_request_id,
              identity: command.identity,
              expires_at: command.expires_at,
              state: reply.state,
              transport: { kind: "NATIVE_SDL2_WINDOW", embedded: false },
              clock: {
                shown_frame_index: reply.shown_frame,
                audio_output_sample_index: null,
                audio_sample_rate_hz: null,
                authority: reply.shown_frame === null ? "UNVERIFIED" : "SHOWN_FRAME",
              },
              failure: reply.state === "FAILED" ? "HOST_PROTOCOL" : null,
            };
            clearTimeout(waiter.timer);
            pending.delete(reply.sequence);
            waiter.resolve({ kind: "STATUS", status });
          } catch {
            fail();
            return;
          }
        }
      }
      // Register the opening waiter before enabling stream flow. The owner can
      // already have buffered the native opening receipt from its frozen handle.
      const openingReply = send(null, 0);
      try {
        owned.stdout.on("data", onData);
        owned.stderr.on("data", onErrorData);
        owned.stdin.on("error", fail);
        owned.stdout.on("error", fail);
        owned.stderr.on("error", fail);
      } catch (error) {
        await terminate();
        throw error;
      }
      function send(bytes: Buffer | null, id: number): Promise<MediaPreviewResult> {
        if (ended || failed || pending.size !== 0) return Promise.resolve({ kind: "UNKNOWN" });
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            // A late receipt cannot turn an ambiguous mutation into an automatic replay.
            resolve({ kind: "UNKNOWN" });
            fail();
          }, timeoutMs);
          timer.unref?.();
          pending.set(id, { generation, resolve, timer });
          try {
            if (bytes !== null)
              owned.stdin.write(bytes, (error) => {
                if (error) fail();
              });
          } catch {
            fail();
          }
        });
      }
      const opened = await openingReply;
      if (opened.kind !== "STATUS" || opened.status.state !== "READY_PAUSED") {
        await terminate();
        throw new Error("MLT host did not acknowledge the exact frozen opening");
      }
      const journal = new Map<string, { payload: string; result: Promise<MediaPreviewResult> }>();
      const connection: NativePreviewConnection = {
        async command(kind, mutation) {
          if (
            !(kind === "seek"
              ? isSeekMediaPreviewCommand(mutation)
              : isMediaPreviewMutation(mutation)) ||
            mutation.session_id !== command.session_id
          )
            return { kind: "STALE_SESSION" };
          const payload = visualJson({ kind, mutation }),
            prior = journal.get(mutation.command_id);
          if (prior) return prior.payload === payload ? prior.result : { kind: "UNKNOWN" };
          if (journal.size >= 256 || sequence >= 1024) return { kind: "UNKNOWN" };
          if (pending.size !== 0 || ended || failed) {
            const result = Promise.resolve<MediaPreviewResult>({ kind: "UNKNOWN" });
            journal.set(mutation.command_id, { payload, result });
            return result;
          }
          if (generation >= 0xffff_ffff || mutation.generation !== generation + 1)
            return { kind: "STALE_SESSION" };
          const frame = "frame_index" in mutation ? mutation.frame_index : 0;
          if (frame >= command.plan.plan.total_frames) return { kind: "UNKNOWN" };
          generation = mutation.generation; // Advance once before the original write; UNKNOWN never rewinds.
          const id = ++sequence;
          const result = send(
            encodeMltCommand(id, generation, kind, mutation.command_id, frame),
            id,
          );
          journal.set(mutation.command_id, { payload, result });
          return result;
        },
        async status(query) {
          if (query.session_id !== command.session_id || query.generation !== generation)
            return { kind: "STALE_SESSION" };
          if (sequence >= 1024) return { kind: "UNKNOWN" };
          const id = ++sequence;
          return send(encodeMltCommand(id, generation, "status", "", 0), id);
        },
        terminate,
        onExit(listener) {
          if (ended) {
            listener();
            return () => undefined;
          }
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
      return connection;
    },
  };
}
