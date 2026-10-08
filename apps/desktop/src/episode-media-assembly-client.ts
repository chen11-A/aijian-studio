import {
  episodeMediaAssemblyDefiniteError,
  isAssemblyEpisodeId,
  isAssemblyProjectId,
  isAssemblyVersionId,
  isCreateEpisodeMediaAssemblyVersionRequest,
  isEpisodeMediaAssemblyResponse,
} from "./episode-media-assembly-contract";
import type { EpisodeMediaAssemblyClient } from "./episode-media-assembly-ipc";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;

export function createEpisodeMediaAssemblyClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): EpisodeMediaAssemblyClient {
  const scope = (projectId: string, episodeId: string) => {
    if (!isAssemblyProjectId(projectId) || !isAssemblyEpisodeId(episodeId))
      throw new Error("Episode media assembly requires canonical scope ids");
    return `/api/v1/projects/${projectId}/episodes/${episodeId}/media-assembly`;
  };
  return {
    async readLatestEpisodeMediaAssembly(projectId, episodeId) {
      const result = await readHttp(scope(projectId, episodeId), { headers });
      if (!result) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isEpisodeMediaAssemblyResponse(payload, projectId, episodeId, requestId)
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      const error = episodeMediaAssemblyDefiniteError(status, payload, requestId);
      return error?.status === 404 && error.code === "ASSEMBLY_NOT_FOUND"
        ? { kind: "NOT_FOUND", request_id: error.request_id }
        : (error ?? { kind: "REMOTE_UNKNOWN" });
    },
    async getEpisodeMediaAssemblyVersion(projectId, episodeId, versionId) {
      const path = scope(projectId, episodeId);
      if (!isAssemblyVersionId(versionId))
        throw new Error("Assembly requires canonical version id");
      const result = await readHttp(`${path}/versions/${versionId}`, { headers });
      if (!result) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isEpisodeMediaAssemblyResponse(payload, projectId, episodeId, requestId, versionId)
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        episodeMediaAssemblyDefiniteError(status, payload, requestId) ?? { kind: "REMOTE_UNKNOWN" }
      );
    },
    async createEpisodeMediaAssemblyVersion(projectId, episodeId, command) {
      const path = scope(projectId, episodeId);
      if (!isCreateEpisodeMediaAssemblyVersionRequest(command, projectId, episodeId))
        throw new Error("Assembly write requires a valid scoped edit decision");
      const result = await readHttp(`${path}/versions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!result) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 201)
        return isEpisodeMediaAssemblyResponse(payload, projectId, episodeId, requestId)
          ? { kind: "CREATED", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        episodeMediaAssemblyDefiniteError(status, payload, requestId) ?? { kind: "REMOTE_UNKNOWN" }
      );
    },
  };
}
