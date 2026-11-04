import { createHash, randomUUID } from "node:crypto";
import {
  nativePreviewPlanResponse,
  type NativePreviewPlanResult,
  type NativePreviewPlanResponse,
} from "@aijian/contracts/native-preview-plan";
import { visualJson } from "@aijian/contracts/visual-bible";
import {
  isMediaPreviewResult,
  isOpenMediaPreviewCommand,
  isMediaPreviewMutation,
  isSeekMediaPreviewCommand,
  isMediaPreviewStatusQuery,
  type MediaPreviewIdentity,
  type MediaPreviewMutation,
  type MediaPreviewStatus,
  type MediaPreviewStatusQuery,
  type MediaPreviewResult,
  type OpenMediaPreviewCommand,
  type SeekMediaPreviewCommand,
} from "./media-preview-session-contract";
import type { MediaPreviewSessionHost } from "./media-preview-session-ipc";

type NativeCommandKind = "play" | "pause" | "seek" | "close";
export interface NativePreviewConnection {
  /** Host replies must echo the minted session, generation and complete frozen identity. */
  command(
    kind: NativeCommandKind,
    command: MediaPreviewMutation | SeekMediaPreviewCommand,
  ): Promise<unknown>;
  status(query: { session_id: string; generation: number }): Promise<unknown>;
  /** Bound termination belongs to the trusted runtime, including late launch and parent exit. */
  terminate(): Promise<void>;
  onExit(listener: () => void): () => void;
}
export interface TrustedNativePreviewRuntime {
  /** Main-only adapter: verify binary/license profile and fresh owned sources before process launch.
   * The native child must enforce this hard lease itself; renderer input never supplies paths.
   */
  open(
    command: OpenMediaPreviewCommand & {
      session_id: string;
      generation: number;
      expires_at: string;
      plan: NativePreviewPlanResponse["data"];
    },
  ): Promise<NativePreviewConnection>;
}
type Options = {
  resolvePlan: (identity: MediaPreviewIdentity) => Promise<NativePreviewPlanResult>;
  runtime: TrustedNativePreviewRuntime | null;
  now?: () => number;
  timeoutMs?: number;
  leaseMs?: number;
  maxSessions?: number;
  maxCommands?: number;
};
type Entry = {
  command: OpenMediaPreviewCommand;
  status: MediaPreviewStatus;
  frames: number;
  connection: NativePreviewConnection | null;
  unknown: boolean;
  pending: boolean;
  readPending: boolean;
  launchPending: boolean;
  exitObserved: boolean;
  releaseConfirmed: boolean;
  termination: Promise<boolean> | null;
  unsubscribe: (() => void) | null;
  expiry: ReturnType<typeof setTimeout> | null;
  journal: Map<string, { payload: string; result: MediaPreviewResult }>;
};
export type ManagedMediaPreviewHost = MediaPreviewSessionHost & {
  invalidateAll(): void;
  shutdown(): Promise<void>;
};
const unknown = (): MediaPreviewResult => ({ kind: "UNKNOWN" });
const unavailable = (
  reason: "NATIVE_HOST_NOT_INSTALLED" | "PLAN_NOT_READY" | "TRANSPORT_NOT_READY",
): MediaPreviewResult => ({ kind: "UNAVAILABLE", reason });
const terminal = (state: MediaPreviewStatus["state"]) =>
  ["FAILED", "EXPIRED", "CLOSED"].includes(state);
const sameIdentity = (a: MediaPreviewIdentity, b: MediaPreviewIdentity) =>
  visualJson(a) === visualJson(b);

/** Main-process ephemeral process ownership; immutable assembly/probe data stays in the sidecar. */
export function createManagedMediaPreviewHost(options: Options): ManagedMediaPreviewHost {
  const runtime = options.runtime,
    resolvePlan = options.resolvePlan;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000,
    leaseMs = options.leaseMs ?? 300_000;
  const maxSessions = options.maxSessions ?? 64,
    maxCommands = options.maxCommands ?? 256;
  for (const value of [timeoutMs, leaseMs, maxSessions, maxCommands])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Native preview requires positive bounded limits");
  if (timeoutMs > 30_000 || leaseMs > 3_600_000 || maxSessions > 256 || maxCommands > 1024)
    throw new Error("Native preview supervisor limits are too large");
  const opens = new Map<string, Entry>(),
    sessions = new Map<string, Entry>();
  const terminations = new WeakMap<NativePreviewConnection, Promise<boolean>>();
  async function bounded<T>(action: Promise<T>): Promise<T | null> {
    let timer!: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        action,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  function reply(entry: Entry): MediaPreviewResult {
    return entry.unknown ? unknown() : { kind: "STATUS", status: structuredClone(entry.status) };
  }
  function stopConnection(connection: NativePreviewConnection): Promise<boolean> {
    let stopped = terminations.get(connection);
    if (!stopped) {
      stopped = bounded(
        Promise.resolve().then(async () => {
          await connection.terminate();
          return true;
        }),
      ).then((result) => result === true);
      terminations.set(connection, stopped);
    }
    return stopped;
  }
  function terminate(entry: Entry) {
    if (!entry.connection || entry.termination) return;
    try {
      entry.unsubscribe?.();
    } catch {
      /* Continue owned termination if event cleanup fails. */
    }
    entry.unsubscribe = null;
    trackTermination(entry, entry.connection);
  }
  function trackTermination(entry: Entry, connection: NativePreviewConnection) {
    entry.termination = stopConnection(connection);
    void entry.termination.then((stopped) => {
      // A terminal UI state is not evidence that the owned native process exited.
      entry.releaseConfirmed = stopped;
    });
  }
  function finish(
    entry: Entry,
    state: "FAILED" | "EXPIRED" | "CLOSED",
    failure: MediaPreviewStatus["failure"],
  ) {
    entry.status = {
      ...entry.status,
      state,
      failure,
      clock: {
        shown_frame_index: null,
        audio_output_sample_index: null,
        audio_sample_rate_hz: null,
        authority: "UNVERIFIED",
      },
    };
    entry.pending = false;
    entry.unknown = false;
    if (state !== "FAILED") {
      if (entry.expiry) clearTimeout(entry.expiry);
      entry.expiry = null;
    }
    terminate(entry);
  }
  function expired(entry: Entry): boolean {
    if (
      !["EXPIRED", "CLOSED"].includes(entry.status.state) &&
      now() >= Date.parse(entry.status.expires_at)
    )
      finish(entry, "EXPIRED", null);
    return terminal(entry.status.state);
  }
  function accept(entry: Entry, result: unknown): boolean {
    if (expired(entry) || !isMediaPreviewResult(result) || result.kind !== "STATUS") return false;
    const status = result.status;
    if (
      status.session_id !== entry.status.session_id ||
      status.generation !== entry.status.generation ||
      status.open_request_id !== entry.command.open_request_id ||
      !sameIdentity(status.identity, entry.command.identity) ||
      status.expires_at !== entry.status.expires_at ||
      (status.clock.shown_frame_index !== null && status.clock.shown_frame_index >= entry.frames) ||
      (status.clock.authority === "NATIVE_AUDIO_OUTPUT" &&
        status.clock.audio_sample_rate_hz !== 48000) ||
      (status.clock.authority === "UNVERIFIED" && status.clock.shown_frame_index !== null) ||
      (status.state === "FAILED" ? status.failure === null : status.failure !== null) ||
      ["STARTING", "SEEKING"].includes(status.state)
    )
      return false;
    entry.status = structuredClone(status);
    entry.unknown = false;
    entry.pending = false;
    if (terminal(status.state)) {
      if (status.state !== "FAILED") {
        if (entry.expiry) clearTimeout(entry.expiry);
        entry.expiry = null;
      }
      terminate(entry);
    }
    return true;
  }
  function planMatches(
    result: NativePreviewPlanResult,
    identity: MediaPreviewIdentity,
  ): result is Extract<NativePreviewPlanResult, { kind: "READY" }> {
    if (
      result.kind !== "READY" ||
      !nativePreviewPlanResponse(
        result.receipt,
        identity.project_id,
        identity.episode_id,
        identity.assembly_version_id,
        result.receipt.request_id,
      )
    )
      return false;
    const data = result.receipt.data,
      source = data.plan.source;
    return (
      source.assembly_artifact_id === identity.assembly_artifact_id &&
      source.assembly_content_hash === identity.assembly_content_hash &&
      source.assembly_head_revision === identity.assembly_head_revision &&
      data.plan_hash === identity.plan_hash &&
      data.plan_hash ===
        `sha256:${createHash("sha256").update(visualJson(data.plan)).digest("hex")}`
    );
  }
  async function open(raw: OpenMediaPreviewCommand): Promise<MediaPreviewResult> {
    if (!isOpenMediaPreviewCommand(raw)) throw new Error("Native preview open is not canonical");
    const command = structuredClone(raw),
      prior = opens.get(command.open_request_id);
    if (prior) {
      expired(prior);
      return sameIdentity(prior.command.identity, command.identity) ? reply(prior) : unknown();
    }
    if (!runtime) return unavailable("NATIVE_HOST_NOT_INSTALLED");
    if (opens.size >= maxSessions) return unavailable("TRANSPORT_NOT_READY");
    for (const active of opens.values())
      if (
        active.command.identity.project_id === command.identity.project_id &&
        active.command.identity.episode_id === command.identity.episode_id &&
        (!expired(active) || active.launchPending || !active.releaseConfirmed)
      )
        return unavailable("TRANSPORT_NOT_READY");
    const expires_at = new Date(now() + leaseMs).toISOString();
    const entry: Entry = {
      command,
      frames: 0,
      connection: null,
      unknown: true,
      pending: true,
      readPending: false,
      launchPending: false,
      exitObserved: false,
      releaseConfirmed: true,
      termination: null,
      unsubscribe: null,
      expiry: null,
      journal: new Map(),
      status: {
        session_id: `pvs_${randomUUID().replace(/-/g, "")}`,
        generation: 1,
        open_request_id: command.open_request_id,
        identity: command.identity,
        state: "STARTING",
        transport: { kind: "NATIVE_SDL2_WINDOW", embedded: false },
        clock: {
          shown_frame_index: null,
          audio_output_sample_index: null,
          audio_sample_rate_hz: null,
          authority: "UNVERIFIED",
        },
        expires_at,
        failure: null,
      },
    };
    // Bind the open ID and exact identity before any asynchronous read or native launch.
    opens.set(command.open_request_id, entry);
    sessions.set(entry.status.session_id, entry);
    entry.expiry = setTimeout(() => finish(entry, "EXPIRED", null), leaseMs);
    entry.expiry.unref?.();
    const read = await bounded(
      Promise.resolve().then(() => resolvePlan(structuredClone(command.identity))),
    );
    const resolved = read === null ? null : structuredClone(read);
    if (expired(entry)) return reply(entry);
    if (!resolved) {
      entry.pending = false;
      return unknown();
    }
    if (!planMatches(resolved, command.identity)) {
      finish(
        entry,
        "FAILED",
        resolved.kind === "REJECTED" ? "SOURCE_UNAVAILABLE" : "PLAN_MISMATCH",
      );
      return reply(entry);
    }
    entry.frames = resolved.receipt.data.plan.total_frames;
    entry.launchPending = true;
    entry.releaseConfirmed = false;
    const launching = Promise.resolve().then(() =>
      runtime.open({
        ...structuredClone(command),
        session_id: entry.status.session_id,
        generation: entry.status.generation,
        expires_at,
        plan: structuredClone(resolved.receipt.data),
      }),
    );
    let retained = false;
    void launching.then(
      (connection) => {
        entry.launchPending = false;
        if (!retained && (expired(entry) || !entry.pending)) trackTermination(entry, connection);
      },
      () => {
        entry.launchPending = false;
        // A rejected launch can have partial native resources. No cleanup proof
        // was returned; retain episode ownership until this host lifetime ends.
      },
    );
    const connection = await bounded(launching);
    if (!connection) {
      entry.pending = false;
      return unknown();
    }
    if (expired(entry)) {
      trackTermination(entry, connection);
      return reply(entry);
    }
    retained = true;
    entry.connection = connection;
    try {
      entry.unsubscribe = connection.onExit(() => {
        entry.exitObserved = true;
        // A valid CLOSED receipt may already be resolved in this same turn.
        // Let its original pending command settle before interpreting ordered exit.
        if ((!entry.pending || entry.status.state === "STARTING") && !terminal(entry.status.state))
          finish(entry, "FAILED", "NATIVE_EXIT");
      });
      if (terminal(entry.status.state)) {
        entry.unsubscribe();
        entry.unsubscribe = null;
        return reply(entry);
      }
    } catch {
      finish(entry, "FAILED", "HOST_PROTOCOL");
      return reply(entry);
    }
    const status = await bounded(
      Promise.resolve().then(() =>
        connection.status({
          session_id: entry.status.session_id,
          generation: entry.status.generation,
        }),
      ),
    );
    if (!accept(entry, status)) {
      entry.pending = false;
      entry.unknown = !terminal(entry.status.state);
    }
    if (entry.exitObserved && !terminal(entry.status.state)) finish(entry, "FAILED", "NATIVE_EXIT");
    return reply(entry);
  }
  async function status(raw: MediaPreviewStatusQuery): Promise<MediaPreviewResult> {
    if (!isMediaPreviewStatusQuery(raw)) throw new Error("Native preview status is not canonical");
    const query = structuredClone(raw),
      entry =
        "open_request_id" in query
          ? opens.get(query.open_request_id)
          : sessions.get(query.session_id);
    if (!entry) return unknown();
    if ("generation" in query && query.generation !== entry.status.generation)
      return { kind: "STALE_SESSION" };
    if (expired(entry) || entry.pending || !entry.connection) return reply(entry);
    if (entry.readPending) return unknown();
    const generation = entry.status.generation;
    entry.readPending = true;
    let result: unknown;
    try {
      result = await bounded(
        Promise.resolve().then(() =>
          entry.connection!.status({ session_id: entry.status.session_id, generation }),
        ),
      );
    } finally {
      entry.readPending = false;
    }
    if (entry.status.generation !== generation || entry.pending) return unknown();
    if (!accept(entry, result)) entry.unknown = !terminal(entry.status.state);
    return reply(entry);
  }
  async function mutate(
    kind: NativeCommandKind,
    raw: MediaPreviewMutation | SeekMediaPreviewCommand,
  ): Promise<MediaPreviewResult> {
    if (!(kind === "seek" ? isSeekMediaPreviewCommand(raw) : isMediaPreviewMutation(raw)))
      throw new Error("Native preview mutation is not canonical");
    const command = structuredClone(raw),
      entry = sessions.get(command.session_id);
    if (!entry) return { kind: "STALE_SESSION" };
    const payload = visualJson({ kind, command }),
      prior = entry.journal.get(command.command_id);
    if (prior) return prior.payload === payload ? structuredClone(prior.result) : unknown();
    if (command.generation !== entry.status.generation) return { kind: "STALE_SESSION" };
    expired(entry);
    if (entry.status.state === "FAILED" && kind === "close") {
      if (entry.pending || entry.unknown) return unknown();
      const journal = { payload, result: unknown() };
      entry.journal.set(command.command_id, journal);
      entry.pending = true;
      entry.unknown = true;
      entry.status = { ...entry.status, generation: entry.status.generation + 1 };
      const generation = entry.status.generation;
      const stopped = entry.connection ? await entry.termination : true;
      if (entry.status.state !== "FAILED" || entry.status.generation !== generation) {
        journal.result = reply(entry);
        return structuredClone(journal.result);
      }
      if (stopped) finish(entry, "CLOSED", null);
      else entry.unknown = true;
      journal.result = reply(entry);
      return structuredClone(journal.result);
    }
    if (terminal(entry.status.state)) return reply(entry);
    if (entry.pending || entry.readPending || entry.unknown || !entry.connection) return unknown();
    if (entry.journal.size >= maxCommands && kind !== "close")
      return unavailable("TRANSPORT_NOT_READY");
    const allowed =
      kind === "play"
        ? ["READY_PAUSED", "PAUSED"]
        : kind === "pause"
          ? ["PLAYING"]
          : kind === "seek"
            ? ["READY_PAUSED", "PAUSED", "PLAYING"]
            : ["READY_PAUSED", "PAUSED", "PLAYING"];
    if (
      !allowed.includes(entry.status.state) ||
      (kind === "seek" && (command as SeekMediaPreviewCommand).frame_index >= entry.frames)
    )
      return { kind: "STALE_SESSION" };
    const journal = { payload, result: unknown() };
    entry.journal.set(command.command_id, journal);
    entry.pending = true;
    entry.unknown = true;
    entry.status = { ...entry.status, generation: entry.status.generation + 1 };
    const generation = entry.status.generation;
    const result = await bounded(
      Promise.resolve().then(() => entry.connection!.command(kind, { ...command, generation })),
    );
    if (entry.status.generation !== generation || terminal(entry.status.state)) {
      journal.result = reply(entry);
      return structuredClone(journal.result);
    }
    entry.pending = false;
    const desired =
      isMediaPreviewResult(result) &&
      result.kind === "STATUS" &&
      (result.status.state === "FAILED" ||
        (kind === "play"
          ? result.status.state === "PLAYING"
          : kind === "pause"
            ? result.status.state === "PAUSED"
            : kind === "close"
              ? result.status.state === "CLOSED"
              : result.status.clock.shown_frame_index ===
                (command as SeekMediaPreviewCommand).frame_index));
    if (!desired || !accept(entry, result)) entry.unknown = true;
    if (entry.exitObserved && !terminal(entry.status.state)) finish(entry, "FAILED", "NATIVE_EXIT");
    journal.result = reply(entry);
    return structuredClone(journal.result);
  }
  return {
    open,
    status,
    play: (command) => mutate("play", command),
    pause: (command) => mutate("pause", command),
    seek: (command) => mutate("seek", command),
    close: (command) => mutate("close", command),
    invalidateAll() {
      for (const entry of opens.values())
        if (!["CLOSED", "EXPIRED"].includes(entry.status.state)) finish(entry, "EXPIRED", null);
    },
    async shutdown() {
      for (const entry of opens.values())
        if (!["CLOSED", "EXPIRED"].includes(entry.status.state)) finish(entry, "EXPIRED", null);
      await Promise.allSettled(
        [...opens.values()]
          .map((entry) => entry.termination)
          .filter((value): value is Promise<boolean> => value !== null),
      );
    },
  };
}
