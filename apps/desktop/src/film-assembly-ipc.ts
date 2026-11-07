import type { FilmExportProgressEvent } from "@aijian/contracts/film-export-qc";
import { createExportOperations } from "./film-export-operation";
import { assemblyInput, createFilmAssemblies, type FilmAssemblyHost } from "./film-assembly";
/** Private rough-cut operations never mint a QC receipt or publish user files. */
export function registerFilmAssemblies<T>(
  handle: (name: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  owner: (event: T) => string,
  host: FilmAssemblyHost,
  watchOwner?: (event: T, dispose: () => void) => void,
  send?: (event: T, view: FilmExportProgressEvent) => void,
) {
  const core = createFilmAssemblies(host),
    events = new Map<string, T>(),
    watched = new Set<string>();
  const operations = createExportOperations((id, view) => {
    const event = events.get(id);
    if (event && authorized(event)) send?.(event, view);
  });
  for (const action of ["prepare", "cancel"] as const)
    handle(`film:assembly-${action}`, async (event, ...args) => {
      if (!authorized(event)) throw Error("Assembly sender is not authorized");
      const id = owner(event);
      events.set(id, event);
      if (!watched.has(id)) {
        watched.add(id);
        watchOwner?.(event, () => {
          watched.delete(id);
          events.delete(id);
          operations.dispose(id);
        });
      }
      if (action === "cancel") {
        if (args.length !== 1 || typeof args[0] !== "string" || !/^[\w:-]{1,128}$/.test(args[0]))
          throw Error("Invalid assembly cancellation");
        return operations.cancel(id, args[0]);
      }
      if (args.length !== 1 && args.length !== 2) throw Error("Invalid assembly arguments");
      let input;
      try {
        input = assemblyInput(args[0]);
      } catch {
        return { kind: "FAILED", code: "INVALID_INPUT" };
      }
      const operation = operations.begin(id, input.projectId, args[1]);
      if (!operation) return { kind: "FAILED", code: "BUSY" };
      try {
        const result = await core.assemble(input, operation.work);
        await operation.finish(
          result.kind === "ASSEMBLED"
            ? "completed"
            : result.kind === "PARTIAL"
              ? "partial"
              : "failed",
        );
        return result;
      } catch {
        await operation.finish("unknown", false);
        return { kind: "FAILED", code: "ASSEMBLY_FAILED" };
      }
    });
}
