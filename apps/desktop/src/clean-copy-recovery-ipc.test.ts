import { expect, it, vi } from "vitest";
import { registerCleanCopyRecovery } from "./clean-copy-recovery-ipc";
it("rejects unauthorized senders and extra execution inputs before touching storage or service", async () => {
  let invoke!: (event: boolean, ...args: unknown[]) => Promise<unknown>;
  const read = vi.fn(async () => null),
    remake = vi.fn();
  registerCleanCopyRecovery<boolean>(
    (_name, handler) => {
      invoke = handler;
    },
    (event) => event,
    { filmsRoot: "unused", storyFilmsRoot: "unused", databasePath: "unused", read, remake },
  );
  await expect(invoke(false, {})).rejects.toThrow("not authorized");
  await expect(invoke(true, {}, "path")).rejects.toThrow("Invalid");
  expect(read).not.toHaveBeenCalled();
  expect(remake).not.toHaveBeenCalled();
});
