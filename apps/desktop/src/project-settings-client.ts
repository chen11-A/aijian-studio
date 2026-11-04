import { createHash } from "node:crypto";
import {
  settingsProjectId,
  settingsOperationId,
  settingsCommand,
  settingsResponse,
  settingsReceipt,
  settingsIdentity,
  settingsReceiptMatches,
  settingsError,
} from "@aijian/contracts/project-settings";
import type { ProjectSettingsGateway } from "@aijian/contracts/project-settings";
type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
export function createProjectSettingsClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): ProjectSettingsGateway {
  const base = (projectId: string) => {
    if (!settingsProjectId(projectId))
      throw new Error("Project settings require canonical project id");
    return `/api/v1/projects/${projectId}/settings`;
  };
  return {
    async getProjectSettings(projectId) {
      const path = base(projectId);
      try {
        const r = await readHttp(path, { headers });
        if (r?.status === 200 && settingsResponse(r.payload, projectId, r.requestId))
          return { kind: "FOUND", receipt: r.payload };
        if (r) return settingsError(r.status, r.payload, r.requestId) ?? { kind: "UNKNOWN" };
      } catch {
        /* A read failure does not replace persisted truth. */
      }
      return { kind: "UNKNOWN" };
    },
    async getProjectSettingsReceipt(projectId, operationId) {
      const path = base(projectId);
      if (!settingsOperationId(operationId))
        throw new Error("Project settings require canonical operation id");
      try {
        const r = await readHttp(`${path}/operations/${operationId}`, { headers });
        if (r?.status === 200 && settingsReceipt(r.payload, projectId, operationId, r.requestId))
          return { kind: "FOUND", receipt: r.payload };
        if (r) return settingsError(r.status, r.payload, r.requestId) ?? { kind: "UNKNOWN" };
      } catch {
        /* Missing or late receipt does not authorize resend. */
      }
      return { kind: "UNKNOWN" };
    },
    async updateProjectSettings(projectId, input) {
      const path = base(projectId);
      const command = structuredClone(input);
      if (!settingsCommand(command)) throw new Error("Invalid project settings command");
      const hash = `sha256:${createHash("sha256").update(settingsIdentity(projectId, command)).digest("hex")}`;
      try {
        const r = await readHttp(path, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
        if (
          r?.status === 200 &&
          settingsReceipt(r.payload, projectId, command.operation_id, r.requestId) &&
          settingsReceiptMatches(r.payload, command, hash)
        )
          return { kind: "FOUND", receipt: r.payload };
        if (r) {
          const error = settingsError(r.status, r.payload, r.requestId);
          return error && error.code !== "PROJECT_SETTINGS_RECEIPT_NOT_FOUND"
            ? error
            : { kind: "UNKNOWN" };
        }
      } catch {
        /* Dispatch may have committed; do not retry. */
      }
      return { kind: "UNKNOWN" };
    },
  };
}
