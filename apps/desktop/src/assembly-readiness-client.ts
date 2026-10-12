import {
  readinessData,
  readinessTarget,
  type AssemblyReadinessGateway,
} from "@aijian/contracts/assembly-readiness";
import { createHash } from "node:crypto";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import {
  isAssemblyProjectId,
  isAssemblyEpisodeId,
  isEpisodeMediaAssemblyResponse,
} from "./episode-media-assembly-contract";
import { hasRequestId, isRecord } from "./api-contract-guards";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;

export function createAssemblyReadinessClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): AssemblyReadinessGateway {
  return {
    async getEpisodeAssemblyReadiness(projectId, episodeId, target) {
      if (
        !isAssemblyProjectId(projectId) ||
        !isAssemblyEpisodeId(episodeId) ||
        !readinessTarget(target)
      )
        throw new Error("Assembly readiness requires exact scoped saved version and hash");
      const result = await readHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/media-assembly/versions/${target.version_id}/readiness?expected_content_hash=${encodeURIComponent(target.content_hash)}`,
        { method: "GET", headers },
      );
      if (!result || result.status !== 200) return { kind: "REMOTE_UNKNOWN" };
      const { payload, requestId } = result;
      if (
        !isRecord(payload) ||
        Object.keys(payload).length !== 2 ||
        !hasRequestId(payload) ||
        typeof payload.request_id !== "string" ||
        payload.request_id !== requestId ||
        !readinessData(payload.data, target, (assembly) =>
          isEpisodeMediaAssemblyResponse(
            { data: assembly, request_id: requestId },
            projectId,
            episodeId,
            requestId,
            target.version_id,
          ),
        )
      )
        return { kind: "REMOTE_UNKNOWN" };
      if (
        `sha256:${createHash("sha256").update(impactCanonical(payload.data.assembly.content)).digest("hex")}` !==
        target.content_hash
      )
        return { kind: "REMOTE_UNKNOWN" };
      return { kind: "FOUND", receipt: { data: payload.data, request_id: payload.request_id } };
    },
  };
}
