import { createHash } from "node:crypto";
import {
  impactCanonical,
  impactEnvelope,
  impactEpisode,
  impactId,
  impactInput,
  impactOperation,
  impactPage,
  impactProject,
  impactReport,
  impactUuid,
  type ScriptImpactGateway,
  type ScriptImpactReport,
} from "@aijian/contracts/script-confirmation-impact";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;
function boundReport(report: ScriptImpactReport): boolean {
  return (
    report.assessment_hash ===
    `sha256:${createHash("sha256").update(impactCanonical(report.assessment), "utf8").digest("hex")}`
  );
}
/** Read-only, authenticated sidecar paths. Missing operations remain UNKNOWN. */
export function createScriptConfirmationImpactClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): ScriptImpactGateway {
  async function get(path: string) {
    try {
      const result = await readHttp(path, { method: "GET", headers });
      return result?.status === 200 && impactEnvelope(result.payload, result.requestId)
        ? result.payload
        : null;
    } catch {
      return null;
    }
  }
  return {
    async listScriptConfirmationImpacts(projectId, cursor) {
      if (!impactProject(projectId) || (cursor !== undefined && !impactId(cursor)))
        throw new Error("Impact list requires canonical scope and cursor");
      const receipt = await get(
        `/api/v1/projects/${projectId}/script-confirmation-impacts${cursor ? `?cursor=${cursor}` : ""}`,
      );
      return receipt && impactPage(receipt.data, projectId)
        ? { kind: "FOUND", receipt: { ...receipt, data: receipt.data } }
        : { kind: "REMOTE_UNKNOWN" };
    },
    async getScriptConfirmationImpact(projectId, reportId) {
      if (!impactProject(projectId) || !impactId(reportId))
        throw new Error("Impact detail requires canonical scope and report");
      const receipt = await get(
        `/api/v1/projects/${projectId}/script-confirmation-impacts/${reportId}`,
      );
      return receipt &&
        impactReport(receipt.data, projectId) &&
        receipt.data.report_id === reportId &&
        boundReport(receipt.data)
        ? { kind: "FOUND", receipt: { ...receipt, data: receipt.data } }
        : { kind: "REMOTE_UNKNOWN" };
    },
    async getEpisodeScriptConfirmationOperation(projectId, episodeId, operationId, payload) {
      if (
        !impactProject(projectId) ||
        !impactEpisode(episodeId) ||
        !impactUuid(operationId) ||
        !impactInput(payload)
      )
        throw new Error("Original operation requires complete canonical input");
      const query = new URLSearchParams({
        version_id: payload.version_id,
        expected_content_hash: payload.expected_content_hash,
        expected_head_revision: String(payload.expected_head_revision),
      });
      const receipt = await get(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/script/confirmation-operations/${operationId}?${query}`,
      );
      return receipt &&
        impactOperation(receipt.data, projectId, episodeId, operationId, payload) &&
        (!receipt.data.lookup.report || boundReport(receipt.data.lookup.report))
        ? { kind: "FOUND", receipt: { ...receipt, data: receipt.data } }
        : { kind: "REMOTE_UNKNOWN" };
    },
  };
}
