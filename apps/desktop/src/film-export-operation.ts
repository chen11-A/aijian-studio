import { randomUUID } from "node:crypto";
import type {
  FilmExportCancelAck,
  FilmExportPhase,
  FilmExportProgressEvent,
  FilmExportProgressMeasure,
} from "@aijian/contracts/film-export-qc";
export type ExportWork = {
  signal: AbortSignal;
  phase: (phase: FilmExportPhase, progress?: FilmExportProgressMeasure) => void;
  cancellable: (value: boolean) => void;
  published: (aspectRatio: "16:9" | "9:16") => void;
  track: <T>(work: Promise<T>) => Promise<T>;
  /** Main-only: a stopped process is not cleanly stopped if private cleanup failed. */
  cleanupUnconfirmed?: () => void;
};
type Entry = {
  owner: string;
  controller: AbortController;
  view: FilmExportProgressEvent;
  running: boolean;
  pending: Set<Promise<unknown>>;
  cleanupConfirmed: boolean;
};
/** Owner-bound operations have a stable ID and one monotonically increasing event sequence. */
export function createExportOperations(
  send: (owner: string, event: FilmExportProgressEvent) => void,
) {
  const entries = new Map<string, Entry>();
  const emit = (entry: Entry) => {
    entry.view.seq += 1;
    try {
      send(entry.owner, structuredClone(entry.view));
    } catch {
      /* A destroyed sender is handled by the owner disposer. */
    }
  };
  return {
    begin(owner: string, projectId: string, id: unknown) {
      const operationId = id === undefined ? randomUUID() : id;
      if (typeof operationId !== "string" || !/^[\w:-]{1,128}$/.test(operationId))
        throw new Error("INVALID_INPUT");
      if (
        entries.has(operationId) ||
        [...entries.values()].some(
          (entry) => entry.owner === owner && entry.view.projectId === projectId && entry.running,
        )
      )
        return null;
      const old = [...entries].filter(([, entry]) => entry.owner === owner && !entry.running);
      for (const [key] of old.slice(0, Math.max(0, old.length - 31))) entries.delete(key);
      const entry: Entry = {
        owner,
        controller: new AbortController(),
        running: true,
        pending: new Set(),
        cleanupConfirmed: true,
        view: {
          operationId,
          projectId,
          seq: 0,
          phase: "preparing",
          cancelState: "available",
          published: [],
        },
      };
      entries.set(operationId, entry);
      emit(entry);
      const work: ExportWork = {
        signal: entry.controller.signal,
        phase: (phase, progress) => {
          entry.view.phase = phase;
          entry.view.progress = progress;
          emit(entry);
        },
        cancellable: (value) => {
          entry.view.cancelState = entry.controller.signal.aborted
            ? "requested"
            : value
              ? "available"
              : "unavailable";
          emit(entry);
        },
        published: (aspectRatio) => {
          entry.view.published.push({
            aspectRatio,
            label: aspectRatio === "16:9" ? "横屏成片" : "竖屏成片",
          });
          emit(entry);
        },
        cleanupUnconfirmed: () => {
          entry.cleanupConfirmed = false;
        },
        track: <T>(promise: Promise<T>) => {
          entry.pending.add(promise);
          void promise.then(
            () => entry.pending.delete(promise),
            () => entry.pending.delete(promise),
          );
          return promise;
        },
      };
      return {
        work,
        finish: async (phase: FilmExportPhase, stoppedConfirmed = true) => {
          // No new stop request is accepted after the result is determined.
          entry.view.cancelState = entry.controller.signal.aborted ? "requested" : "unavailable";
          emit(entry);
          // A rejected Promise.all can precede its other stream/child closures.
          while (entry.pending.size) await Promise.allSettled([...entry.pending]);
          entry.running = false;
          entry.view.phase = phase;
          entry.view.progress = undefined;
          entry.view.cancelState =
            entry.controller.signal.aborted && stoppedConfirmed && entry.cleanupConfirmed
              ? "stopped"
              : "unavailable";
          emit(entry);
        },
      };
    },
    cancel(owner: string, operationId: string): FilmExportCancelAck {
      const entry = entries.get(operationId);
      if (!entry || entry.owner !== owner) return { kind: "NOT_FOUND" };
      if (!entry.running) {
        emit(entry);
        return {
          kind: entry.view.cancelState === "stopped" ? "STOPPED" : "UNAVAILABLE",
          snapshot: structuredClone(entry.view),
        };
      }
      if (entry.view.cancelState === "unavailable") {
        emit(entry);
        return { kind: "UNAVAILABLE", snapshot: structuredClone(entry.view) };
      }
      if (!entry.controller.signal.aborted) {
        entry.view.cancelState = "requested";
        emit(entry);
        entry.controller.abort();
      }
      return { kind: "REQUESTED", snapshot: structuredClone(entry.view) };
    },
    dispose(owner: string) {
      for (const entry of entries.values())
        if (entry.owner === owner && entry.running) {
          entry.view.cancelState = "requested";
          emit(entry);
          entry.controller.abort();
        }
    },
  };
}
