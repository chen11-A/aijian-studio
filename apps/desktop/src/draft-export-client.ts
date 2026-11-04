import { isAbsolute } from "node:path";
import { episodeMediaAssemblyDefiniteError } from "./episode-media-assembly-contract";
import {
  draftExportPreclaimToolchainError,
  isDraftExportCommand,
  isDraftExportListResponse,
  isDraftExportOperationId,
  isDraftExportResponse,
  isDraftExportScope,
  type DraftExportCommand,
  type DraftExportResult,
} from "./draft-export-contract";
import type { DraftExportClient } from "./draft-export-ipc";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
export function createDraftExportClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): DraftExportClient {
  const scope = (projectId: string, episodeId: string) => {
    if (!isDraftExportScope(projectId, episodeId))
      throw new Error("Draft export requires canonical scope ids");
    return `/api/v1/projects/${projectId}/episodes/${episodeId}/draft-exports`;
  };
  const readJob = async (
    projectId: string,
    episodeId: string,
    operationId: string,
    action: "GET" | "CANCEL" | "CREATE",
    command?: DraftExportCommand & { output_path: string },
  ): Promise<DraftExportResult> => {
    const base = scope(projectId, episodeId);
    if (!isDraftExportOperationId(operationId))
      throw new Error("Draft export requires canonical operation id");
    const path =
      action === "CREATE"
        ? base
        : `${base}/${operationId}${action === "CANCEL" ? "/cancellations" : ""}`;
    const result = await readHttp(
      path,
      action === "GET"
        ? { headers }
        : {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            ...(command ? { body: JSON.stringify(command) } : {}),
          },
    );
    if (!result) return { kind: "REMOTE_UNKNOWN" };
    const { status, payload, requestId } = result;
    if ([200, 201, 202].includes(status)) {
      if (
        !isDraftExportResponse(payload, projectId, episodeId, requestId, operationId) ||
        (command &&
          (payload.data.assembly_version_id !== command.assembly_version_id ||
            payload.data.assembly_content_hash !== command.assembly_content_hash))
      )
        return { kind: "REMOTE_UNKNOWN" };
      return { kind: "FOUND", receipt: payload };
    }
    const error =
      episodeMediaAssemblyDefiniteError(status, payload, requestId) ??
      (action === "CREATE" ? draftExportPreclaimToolchainError(status, payload, requestId) : null);
    return action === "GET" && error?.status === 404 && error.code === "DRAFT_EXPORT_NOT_FOUND"
      ? { kind: "NOT_FOUND", request_id: error.request_id }
      : (error ?? { kind: "REMOTE_UNKNOWN" });
  };
  return {
    async listDraftExports(projectId, episodeId) {
      const result = await readHttp(scope(projectId, episodeId), { headers });
      if (!result) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isDraftExportListResponse(payload, projectId, episodeId, requestId)
          ? { kind: "LISTED", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        episodeMediaAssemblyDefiniteError(status, payload, requestId) ?? { kind: "REMOTE_UNKNOWN" }
      );
    },
    getDraftExport: (projectId, episodeId, operationId) =>
      readJob(projectId, episodeId, operationId, "GET"),
    cancelDraftExport: (projectId, episodeId, operationId) =>
      readJob(projectId, episodeId, operationId, "CANCEL"),
    createDraftExport(projectId, episodeId, command) {
      const { output_path, ...rendererCommand } = command;
      if (
        !isDraftExportCommand(rendererCommand) ||
        typeof output_path !== "string" ||
        !isAbsolute(output_path) ||
        !output_path.toLowerCase().endsWith(".mp4") ||
        output_path.includes("\0")
      )
        throw new Error("Draft export requires validated native destination");
      return readJob(projectId, episodeId, command.operation_id, "CREATE", command);
    },
  };
}
