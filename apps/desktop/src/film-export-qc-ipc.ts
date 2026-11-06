import { createExportOperations } from "./film-export-operation";
import type { FilmExportProgressEvent } from "@aijian/contracts/film-export-qc";
import { createFilmExportQc, qcInput, type FilmQcHost } from "./film-export-qc";
/** Separate narrow API: historical low-level media export does not produce a QC receipt. */
export function registerFilmExportQc<T>(
  handle: (channel: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  owner: (event: T) => string,
  host: FilmQcHost,
  watchOwner?: (event: T, dispose: () => void) => void,
  send?: (event: T, snapshot: FilmExportProgressEvent) => void,
) {
  const qc = createFilmExportQc(host);
  const watched = new Set<string>();
  const senders = new Map<string, T>();
  const operations = createExportOperations((owner, snapshot) => {
    const event = senders.get(owner);
    if (event && authorized(event)) send?.(event, snapshot);
  });
  for (const action of ["prepare", "publish", "discard", "cancel"] as const)
    handle(`film:qc-${action}`, async (event, ...args) => {
      if (!authorized(event)) throw new Error("Film QC sender is not authorized");
      const id = owner(event);
      senders.set(id, event);
      if (!watched.has(id)) {
        watched.add(id);
        watchOwner?.(event, () => {
          watched.delete(id);
          senders.delete(id);
          operations.dispose(id);
          void qc.dispose(id);
        });
      }
      if (
        args.length !== 1 &&
        !(
          args.length === 2 &&
          (action === "prepare" || action === "publish") &&
          (args[1] === undefined ||
            (typeof args[1] === "string" && /^[\w:-]{1,128}$/.test(args[1])))
        )
      )
        throw new Error("Film QC accepts one request and an optional execution ID");
      if (action === "cancel") {
        if (typeof args[0] !== "string" || !/^[\w:-]{1,128}$/.test(args[0]))
          throw new Error("Invalid export operation");
        return operations.cancel(id, args[0]);
      }
      if (action === "prepare" || action === "publish") {
        let input;
        try {
          input = qcInput(args[0]);
        } catch {
          return { kind: "FAILED", code: "INVALID_INPUT" };
        }
        const operation = operations.begin(id, input.projectId, args[1]);
        if (!operation) return { kind: "FAILED", code: "BUSY" };
        let phase: "waitingReview" | "completed" | "partial" | "failed" = "failed";
        try {
          const result =
            action === "prepare"
              ? await qc.prepare(id, args[0], operation.work)
              : await qc.publish(id, args[0], operation.work);
          if (operation.work.signal.aborted && result.kind === "READY") {
            await qc.discard(id, result.qcReceipt);
            return { kind: "FAILED", code: "OPERATION_STOPPED" };
          }
          phase =
            result.kind === "READY" || result.kind === "CANCELLED"
              ? "waitingReview"
              : result.kind === "PUBLISHED"
                ? "completed"
                : result.kind === "PARTIAL"
                  ? "partial"
                  : "failed";
          return result;
        } finally {
          await operation.finish(phase);
        }
      }
      if (typeof args[0] !== "string" || args[0].length > 128)
        throw new Error("Invalid QC receipt");
      return qc.discard(owner(event), args[0]);
    });
}
