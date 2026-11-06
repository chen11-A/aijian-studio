import { createFilmExportQc, type FilmQcHost } from "./film-export-qc";
/** Separate narrow API: historical low-level media export does not produce a QC receipt. */
export function registerFilmExportQc<T>(
  handle: (channel: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  owner: (event: T) => string,
  host: FilmQcHost,
  watchOwner?: (event: T, dispose: () => void) => void,
) {
  const qc = createFilmExportQc(host);
  const watched = new Set<string>();
  for (const action of ["prepare", "publish", "discard"] as const)
    handle(`film:qc-${action}`, async (event, ...args) => {
      if (!authorized(event)) throw new Error("Film QC sender is not authorized");
      const id = owner(event);
      if (!watched.has(id)) {
        watched.add(id);
        watchOwner?.(event, () => {
          watched.delete(id);
          void qc.dispose(id);
        });
      }
      if (args.length !== 1) throw new Error("Film QC accepts one request");
      if (action === "prepare") return qc.prepare(owner(event), args[0]);
      if (action === "publish") return qc.publish(owner(event), args[0]);
      if (typeof args[0] !== "string" || args[0].length > 128)
        throw new Error("Invalid QC receipt");
      return qc.discard(owner(event), args[0]);
    });
}
