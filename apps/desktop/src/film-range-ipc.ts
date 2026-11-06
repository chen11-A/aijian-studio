import { createFilmRanges } from "./film-range";
/** Only the trusted main frame can create/consume its in-memory range plans. */
export function registerFilmRanges<T>(
  handle: (channel: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  host: Parameters<typeof createFilmRanges>[0],
) {
  const ranges = createFilmRanges(host);
  const actions = {
    prepare: ranges.prepareFilmRange,
    generate: ranges.generateFilmRange,
    finish: ranges.finishFilmRange,
  };
  for (const action of ["prepare", "generate", "finish"] as const)
    handle(`film:range-${action}`, async (event, ...args) => {
      if (!authorized(event) || args.length !== 1 || !args[0] || typeof args[0] !== "object")
        throw new Error("Invalid range request");
      return actions[action](args[0] as never);
    });
  handle("film:range-discard", async (event, ...args) => {
    if (!authorized(event) || args.length !== 2 || args.some((value) => typeof value !== "string"))
      throw new Error("Invalid range request");
    return ranges.discardFilmRange(args[0] as string, args[1] as string);
  });
}
