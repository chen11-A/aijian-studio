import {
  episodeStoryboardDefiniteError,
  isCreateEpisodeStoryboardVersionRequest,
  isEpisodeStoryboardEpisodeId,
  isEpisodeStoryboardIdempotencyKey,
  isEpisodeStoryboardProjectId,
  isEpisodeStoryboardVersionCreatedResponse,
  isEpisodeStoryboardVersionId,
  isEpisodeStoryboardVersionResponse,
  type EpisodeStoryboardGateway,
} from "./episode-storyboard-contract";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{ status: number; payload: unknown; requestId: string | null } | null>;

export function createEpisodeStoryboardClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): EpisodeStoryboardGateway {
  return {
    async getEpisodeStoryboard(projectId, episodeId) {
      if (!isEpisodeStoryboardProjectId(projectId) || !isEpisodeStoryboardEpisodeId(episodeId))
        throw new Error("Episode storyboard requires canonical scope ids");
      const result = await readHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/storyboard`,
        { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isEpisodeStoryboardVersionResponse(payload, projectId, episodeId, requestId)
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      const error = episodeStoryboardDefiniteError(status, payload, requestId);
      return error?.status === 404 && error.code === "STORYBOARD_NOT_FOUND"
        ? { kind: "EMPTY" }
        : (error ?? { kind: "REMOTE_UNKNOWN" });
    },
    async getEpisodeStoryboardVersion(projectId, episodeId, versionId) {
      if (
        !isEpisodeStoryboardProjectId(projectId) ||
        !isEpisodeStoryboardEpisodeId(episodeId) ||
        !isEpisodeStoryboardVersionId(versionId)
      )
        throw new Error("Episode storyboard requires canonical version ids");
      const result = await readHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/storyboard/versions/${versionId}`,
        { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isEpisodeStoryboardVersionResponse(
          payload,
          projectId,
          episodeId,
          requestId,
          versionId,
        )
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        episodeStoryboardDefiniteError(status, payload, requestId) ?? { kind: "REMOTE_UNKNOWN" }
      );
    },
    async createEpisodeStoryboardVersion(projectId, episodeId, idempotencyKey, payload) {
      if (
        !isEpisodeStoryboardProjectId(projectId) ||
        !isEpisodeStoryboardEpisodeId(episodeId) ||
        !isEpisodeStoryboardIdempotencyKey(idempotencyKey) ||
        !isCreateEpisodeStoryboardVersionRequest(payload, projectId, episodeId)
      )
        throw new Error("Episode storyboard write requires canonical arguments");
      const result = await readHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/storyboard/versions`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload: response, requestId } = result;
      if (status === 201)
        return isEpisodeStoryboardVersionCreatedResponse(
          response,
          projectId,
          episodeId,
          requestId,
          payload,
        )
          ? { kind: "CREATED", receipt: response }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        episodeStoryboardDefiniteError(status, response, requestId) ?? { kind: "REMOTE_UNKNOWN" }
      );
    },
  };
}
