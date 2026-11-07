import { createFilmDialogueSplits } from "./film-dialogue-split";
export function registerFilmDialogueSplits<T>(
  handle: (channel: string, listener: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  host: Parameters<typeof createFilmDialogueSplits>[0],
) {
  const splits = createFilmDialogueSplits(host);
  for (const action of ["prepare", "apply"] as const)
    handle(`film:dialogue-split-${action}`, async (event, ...args) => {
      if (!authorized(event)) throw Error("Dialogue split sender is not authorized");
      if (args.length !== 1) throw Error("Invalid dialogue split request");
      return action === "prepare" ? splits.prepare(args[0]) : splits.apply(args[0]);
    });
}
