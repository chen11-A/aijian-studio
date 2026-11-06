import { createFilmHistory } from "./film-history";
export function registerFilmHistory<T>(
  handle: (name: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  filmsRoot: string,
) {
  const history = createFilmHistory({ filmsRoot });
  for (const action of ["list", "capture", "restore"] as const) {
    handle(`film:history-${action}`, async (event, ...args) => {
      if (!authorized(event)) throw new Error("Film history sender is not authorized");
      if (args.length !== 1) throw new Error("Invalid history request");
      return action === "list"
        ? history.list(args[0])
        : action === "capture"
          ? history.capture(args[0])
          : history.restore(args[0]);
    });
  }
}
