import {
  DRAFT_EXPORT_CHANNELS,
  isDraftExportOperationId,
  isDraftExportScope,
} from "./draft-export-contract";
import type { DraftExportClient } from "./draft-export-ipc";
import { accessDraftExportOutput } from "./draft-export-output";

/** Renderer IDs locate a fresh backend receipt; no renderer path reaches the filesystem. */
export function registerDraftExportOutputHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => DraftExportClient,
  isTopLevelFrame: (event: TEvent) => boolean,
  revealOutput: (trustedPath: string) => void,
): void {
  let busy = false;
  for (const action of ["preview", "reveal"] as const) {
    handle(DRAFT_EXPORT_CHANNELS[action], async (event, ...args) => {
      if (!isTopLevelFrame(event))
        throw new Error("Draft output IPC sender frame is not authorized");
      const client = clientFor(event);
      if (
        args.length !== 3 ||
        !isDraftExportScope(args[0], args[1]) ||
        !isDraftExportOperationId(args[2])
      )
        throw new Error("Draft output IPC requires only canonical scope and operation ids");
      if (busy) return { kind: "OUTPUT_UNAVAILABLE", code: "OUTPUT_BUSY" };
      busy = true;
      try {
        const stillAuthorized = () => {
          if (!isTopLevelFrame(event) || clientFor(event) !== client)
            throw new Error("Draft output IPC sender changed during verification");
        };
        const result = await accessDraftExportOutput(
          client,
          args[0] as string,
          args[1] as string,
          args[2],
          action,
          (path) => {
            stillAuthorized();
            revealOutput(path);
          },
        );
        stillAuthorized();
        return result;
      } finally {
        busy = false;
      }
    });
  }
}
