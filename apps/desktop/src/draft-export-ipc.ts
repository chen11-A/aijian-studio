import { isAbsolute } from "node:path";
import {
  DRAFT_EXPORT_CHANNELS,
  isDraftExportCommand,
  isDraftExportOperationId,
  isDraftExportScope,
  type DraftExportCommand,
  type DraftExportListResult,
  type DraftExportResult,
  type DraftExportSubmitResult,
} from "./draft-export-contract";

export type DraftExportClient = {
  listDraftExports(projectId: string, episodeId: string): Promise<DraftExportListResult>;
  getDraftExport(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportResult>;
  createDraftExport(
    projectId: string,
    episodeId: string,
    command: DraftExportCommand & { output_path: string },
  ): Promise<DraftExportResult>;
  cancelDraftExport(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportResult>;
};
/** Only trusted main may introduce a Save-dialog or preview-cache destination. */
export function registerDraftExportHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => DraftExportClient,
  isTopLevelFrame: (event: TEvent) => boolean,
  selectOutput: (suggestedName: string) => Promise<string | null>,
  preparePreviewOutput?: (operationId: string) => Promise<string>,
): void {
  let pickerBusy = false;
  const inFlight = new Set<string>();
  function authorized(
    event: TEvent,
    args: unknown[],
    count: number,
  ): [DraftExportClient, string, string] {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) throw new Error("Draft export IPC sender frame is not authorized");
    if (args.length !== count || !isDraftExportScope(args[0], args[1]))
      throw new Error("Draft export IPC requires canonical scope ids");
    return [client, args[0] as string, args[1] as string];
  }
  handle(DRAFT_EXPORT_CHANNELS.list, async (event, ...args) => {
    const [client, projectId, episodeId] = authorized(event, args, 2);
    return client.listDraftExports(projectId, episodeId);
  });
  for (const action of ["get", "cancel"] as const)
    handle(DRAFT_EXPORT_CHANNELS[action], async (event, ...args) => {
      const [client, projectId, episodeId] = authorized(event, args, 3);
      if (!isDraftExportOperationId(args[2]))
        throw new Error("Draft export IPC requires canonical operation id");
      if (inFlight.has(args[2])) return { kind: "REMOTE_UNKNOWN" };
      return action === "get"
        ? client.getDraftExport(projectId, episodeId, args[2])
        : client.cancelDraftExport(projectId, episodeId, args[2]);
    });
  for (const action of ["create", "createPreview"] as const) {
    handle(
      DRAFT_EXPORT_CHANNELS[action],
      async (event, ...args): Promise<DraftExportSubmitResult> => {
        const [client, projectId, episodeId] = authorized(event, args, 3);
        if (!isDraftExportCommand(args[2]))
          throw new Error("Draft export IPC requires a path-free export command");
        if (pickerBusy) return { kind: "PICKER_BUSY" };
        const command = args[2];
        pickerBusy = true;
        inFlight.add(command.operation_id);
        try {
          let selected: string | null;
          if (action === "createPreview") {
            if (!preparePreviewOutput) return { kind: "CACHE_UNAVAILABLE" };
            try {
              selected = await preparePreviewOutput(command.operation_id);
            } catch {
              // No backend submit has happened: this is a definite pre-claim failure.
              return { kind: "CACHE_UNAVAILABLE" };
            }
          } else {
            selected = await selectOutput(`Aivora-DRAFT-${command.operation_id.slice(4, 12)}.mp4`);
          }
          if (selected === null) return { kind: "PICKER_CANCELLED" };
          if (
            !isAbsolute(selected) ||
            !selected.toLowerCase().endsWith(".mp4") ||
            selected.includes("\0")
          )
            return { kind: "INVALID_DESTINATION" };
          if (!isTopLevelFrame(event) || clientFor(event) !== client)
            throw new Error("Draft export IPC sender changed during destination preparation");
          return await client.createDraftExport(projectId, episodeId, {
            ...command,
            output_path: selected,
          });
        } finally {
          pickerBusy = false;
          inFlight.delete(command.operation_id);
        }
      },
    );
  }
}
