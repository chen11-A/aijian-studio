import { createHash } from "node:crypto";
import { nativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import type { NativePreviewPlanGateway } from "@aijian/contracts/native-preview-plan";
import { visualJson } from "@aijian/contracts/visual-bible";
import { hasRequestId, isRecord } from "./api-contract-guards";
import {
  isAssemblyProjectId,
  isAssemblyEpisodeId,
  isAssemblyVersionId,
} from "./episode-media-assembly-contract";

export type { NativePreviewPlanResult } from "@aijian/contracts/native-preview-plan";
export type NativePreviewPlanClient = NativePreviewPlanGateway;
type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;
export function createNativePreviewPlanClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): NativePreviewPlanClient {
  return {
    async getNativeMediaPreviewPlan(projectId, episodeId, versionId) {
      if (
        !isAssemblyProjectId(projectId) ||
        !isAssemblyEpisodeId(episodeId) ||
        !isAssemblyVersionId(versionId)
      )
        throw new Error("Native preview plan requires canonical exact scope");
      try {
        const result = await readHttp(
          `/api/v1/projects/${projectId}/episodes/${episodeId}/media-assembly/versions/${versionId}/native-preview-plan`,
          { method: "GET", headers },
        );
        if (!result) return { kind: "UNKNOWN" };
        const receipt = structuredClone(result.payload);
        if (
          result.status === 200 &&
          nativePreviewPlanResponse(receipt, projectId, episodeId, versionId, result.requestId) &&
          receipt.data.plan_hash ===
            `sha256:${createHash("sha256").update(visualJson(receipt.data.plan)).digest("hex")}`
        )
          return { kind: "READY", receipt };
        if (
          [401, 403, 404, 409, 422].includes(result.status) &&
          isRecord(receipt) &&
          hasRequestId(receipt) &&
          receipt.request_id === result.requestId &&
          Object.keys(receipt).length === 2 &&
          isRecord(receipt.error) &&
          Object.keys(receipt.error).length === 4 &&
          typeof receipt.error.message === "string" &&
          isRecord(receipt.error.details) &&
          receipt.error.retryable === false &&
          typeof receipt.error.code === "string" &&
          /^[A-Z][A-Z0-9_]{0,119}$/.test(receipt.error.code)
        )
          return { kind: "REJECTED", status: result.status, code: receipt.error.code };
      } catch {
        /* A read failure neither authorizes execution nor replaces prior exact evidence. */
      }
      return { kind: "UNKNOWN" };
    },
  };
}
