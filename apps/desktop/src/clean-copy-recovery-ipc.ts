import { createCleanCopyRecovery } from "./clean-copy-recovery";
export function registerCleanCopyRecovery<T>(
  handle: (channel: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  host: Parameters<typeof createCleanCopyRecovery>[0],
) {
  const recover = createCleanCopyRecovery(host);
  handle("film:recover-clean-copy", async (event, ...args) => {
    if (!authorized(event)) throw new Error("Clean recovery sender is not authorized");
    if (args.length !== 1) throw new Error("Invalid clean recovery input");
    return recover(args[0]);
  });
}
