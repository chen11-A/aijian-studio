import {
  isCreateProjectCreativeLibraryVersionRequest,
  isCreativeIdempotencyKey,
  isCreativeProjectId,
  isCreativeVersionId,
  isProjectCreativeLibraryVersionCreatedResponse,
  isProjectCreativeLibraryVersionResponse,
  projectCreativeLibraryDefiniteError,
  type ProjectCreativeLibraryGateway,
} from "./project-creative-library-contract";

type ReadHttp = (
  path: string,
  init: RequestInit,
) => Promise<{
  status: number;
  payload: unknown;
  requestId: string | null;
} | null>;

export function createProjectCreativeLibraryClient(
  readHttp: ReadHttp,
  headers: Record<string, string>,
): ProjectCreativeLibraryGateway {
  return {
    async getProjectCreativeLibrary(projectId) {
      if (!isCreativeProjectId(projectId))
        throw new Error("Creative library requires canonical project id");
      const result = await readHttp(`/api/v1/projects/${projectId}/creative-library`, { headers });
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isProjectCreativeLibraryVersionResponse(payload, projectId, requestId)
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      const error = projectCreativeLibraryDefiniteError(status, payload, requestId);
      return error?.status === 404 && error.code === "CREATIVE_LIBRARY_NOT_FOUND"
        ? { kind: "EMPTY" }
        : (error ?? { kind: "REMOTE_UNKNOWN" });
    },
    async getProjectCreativeLibraryVersion(projectId, versionId) {
      if (!isCreativeProjectId(projectId) || !isCreativeVersionId(versionId))
        throw new Error("Creative library requires canonical version id");
      const result = await readHttp(
        `/api/v1/projects/${projectId}/creative-library/versions/${versionId}`,
        { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200)
        return isProjectCreativeLibraryVersionResponse(payload, projectId, requestId, versionId)
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        projectCreativeLibraryDefiniteError(status, payload, requestId) ?? {
          kind: "REMOTE_UNKNOWN",
        }
      );
    },
    async createProjectCreativeLibraryVersion(projectId, idempotencyKey, payload) {
      if (
        !isCreativeProjectId(projectId) ||
        !isCreativeIdempotencyKey(idempotencyKey) ||
        !isCreateProjectCreativeLibraryVersionRequest(payload, projectId)
      )
        throw new Error("Creative library write requires canonical arguments");
      const result = await readHttp(`/api/v1/projects/${projectId}/creative-library/versions`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload: response, requestId } = result;
      if (status === 201)
        return isProjectCreativeLibraryVersionCreatedResponse(
          response,
          projectId,
          requestId,
          payload,
        )
          ? { kind: "CREATED", receipt: response }
          : { kind: "REMOTE_UNKNOWN" };
      return (
        projectCreativeLibraryDefiniteError(status, response, requestId) ?? {
          kind: "REMOTE_UNKNOWN",
        }
      );
    },
  };
}
