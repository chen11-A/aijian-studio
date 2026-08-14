import type { components } from "@aijian/contracts";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
export type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
export type ProjectData = components["schemas"]["ProjectData"];
export type ProjectListResponse = components["schemas"]["ProjectListResponse"];
export type ProjectResponse = components["schemas"]["ProjectResponse"];
export type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
export type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
export type SourceManifestResponse = components["schemas"]["SourceManifestResponse"];
export type StoryBibleIndexResponse = components["schemas"]["StoryBibleIndexResponse"];
export type StoryBibleVersionResponse = components["schemas"]["StoryBibleVersionResponse"];
export type TaskQueueResponse = components["schemas"]["TaskQueueResponse"];
export type InvalidationOperationListResponse =
  components["schemas"]["InvalidationOperationListResponse"];
export type InvalidationOperationDetailResponse =
  components["schemas"]["InvalidationOperationDetailResponse"];
export type CreateProviderConnectionInput =
  components["schemas"]["CreateProviderConnectionRequest"];
export type ProviderConnectionListResponse =
  components["schemas"]["ProviderConnectionListResponse"];
export type ProviderConnectionResponse = components["schemas"]["ProviderConnectionResponse"];

export interface StudioTransport {
  getHealth(): Promise<HealthResponse>;
  listProjects(): Promise<ProjectListResponse>;
  createProject(input: CreateProjectInput): Promise<ProjectResponse>;
  getProject(projectId: string): Promise<ProjectResponse>;
  listSources(projectId: string): Promise<SourceDocumentListResponse>;
  getSource(projectId: string, sourceId: string): Promise<SourceDocumentResponse>;
  importTextSource(
    projectId: string,
    input: ImportTextSourceInput,
  ): Promise<SourceDocumentResponse>;
  getSourceManifest(projectId: string): Promise<SourceManifestResponse | null>;
  getStoryBibleIndex(projectId: string): Promise<StoryBibleIndexResponse | null>;
  getStoryBibleVersion(projectId: string, versionId: string): Promise<StoryBibleVersionResponse>;
  listProjectTasks(projectId: string): Promise<TaskQueueResponse>;
  listInvalidationOperations(projectId: string): Promise<InvalidationOperationListResponse>;
  getInvalidationOperation(
    projectId: string,
    operationId: string,
  ): Promise<InvalidationOperationDetailResponse>;
  listProviderConnections(): Promise<ProviderConnectionListResponse>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionResponse>;
  deleteProviderConnection(connectionId: string): Promise<void>;
}

export interface AijianDesktopBridge {
  health(): Promise<HealthResponse>;
  listProjects(): Promise<ProjectListResponse>;
  createProject(input: CreateProjectInput): Promise<ProjectResponse>;
  getProject(projectId: string): Promise<ProjectResponse>;
  listSources(projectId: string): Promise<SourceDocumentListResponse>;
  getSource(projectId: string, sourceId: string): Promise<SourceDocumentResponse>;
  importTextSource(
    projectId: string,
    input: ImportTextSourceInput,
  ): Promise<SourceDocumentResponse>;
  getSourceManifest(projectId: string): Promise<SourceManifestResponse | null>;
  getStoryBibleIndex(projectId: string): Promise<StoryBibleIndexResponse | null>;
  getStoryBibleVersion(projectId: string, versionId: string): Promise<StoryBibleVersionResponse>;
  listProjectTasks(projectId: string): Promise<TaskQueueResponse>;
  listInvalidationOperations(projectId: string): Promise<InvalidationOperationListResponse>;
  getInvalidationOperation(
    projectId: string,
    operationId: string,
  ): Promise<InvalidationOperationDetailResponse>;
  listProviderConnections(): Promise<ProviderConnectionListResponse>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionResponse>;
  deleteProviderConnection(connectionId: string): Promise<void>;
}

declare global {
  interface Window {
    aijian?: AijianDesktopBridge;
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request_id !== "string") return false;
  if (typeof candidate.data !== "object" || candidate.data === null) return false;
  const data = candidate.data as Record<string, unknown>;
  return data.status === "ok" && data.service === "aijian-api" && typeof data.version === "string";
}

async function browserRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let code = "";
    try {
      const payload: unknown = await response.json();
      code = isErrorResponse(payload) ? ` (${payload.error.code})` : "";
    } catch {
      // Preserve the stable HTTP status when an intermediary returned a non-JSON body.
    }
    throw new Error(`Studio API request failed with status ${response.status}${code}`);
  }
  return (await response.json()) as T;
}

async function browserHealth(): Promise<HealthResponse> {
  const payload = await browserRequest<unknown>("/api/v1/health", {
    headers: { Accept: "application/json" },
  });
  if (!isHealthResponse(payload)) {
    throw new Error("Health response does not match the published contract");
  }
  return payload;
}

function getRequest<T>(path: string): Promise<T> {
  return browserRequest<T>(path, { headers: { Accept: "application/json" } });
}

function isErrorResponse(value: unknown): value is { error: { code: string } } {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as Record<string, unknown>).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).code === "string"
  );
}

async function getOptionalRequest<T>(path: string, absentCode: string): Promise<T | null> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (response.status === 404) {
    const payload: unknown = await response.json();
    if (isErrorResponse(payload) && payload.error.code === absentCode) return null;
    const errorCode = isErrorResponse(payload) ? payload.error.code : "INVALID_ERROR_RESPONSE";
    throw new Error(`Studio API request failed with status 404 (${errorCode})`);
  }
  if (!response.ok) {
    throw new Error(`Studio API request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function postRequest<T>(path: string, payload: unknown): Promise<T> {
  return browserRequest<T>(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function deleteRequest(path: string): Promise<void> {
  const response = await fetch(path, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Studio API request failed with status ${response.status}`);
}

export function createStudioTransport(): StudioTransport {
  const bridge = window.aijian;
  if (bridge) {
    return {
      getHealth: () => bridge.health(),
      listProjects: () => bridge.listProjects(),
      createProject: (input) => bridge.createProject(input),
      getProject: (projectId) => bridge.getProject(projectId),
      listSources: (projectId) => bridge.listSources(projectId),
      getSource: (projectId, sourceId) => bridge.getSource(projectId, sourceId),
      importTextSource: (projectId, input) => bridge.importTextSource(projectId, input),
      getSourceManifest: (projectId) => bridge.getSourceManifest(projectId),
      getStoryBibleIndex: (projectId) => bridge.getStoryBibleIndex(projectId),
      getStoryBibleVersion: (projectId, versionId) =>
        bridge.getStoryBibleVersion(projectId, versionId),
      listProjectTasks: (projectId) => bridge.listProjectTasks(projectId),
      listInvalidationOperations: (projectId) => bridge.listInvalidationOperations(projectId),
      getInvalidationOperation: (projectId, operationId) =>
        bridge.getInvalidationOperation(projectId, operationId),
      listProviderConnections: () => bridge.listProviderConnections(),
      createProviderConnection: (input) => bridge.createProviderConnection(input),
      deleteProviderConnection: (connectionId) => bridge.deleteProviderConnection(connectionId),
    };
  }
  return {
    getHealth: browserHealth,
    listProjects: () => getRequest<ProjectListResponse>("/api/v1/projects"),
    createProject: (input) => postRequest<ProjectResponse>("/api/v1/projects", input),
    getProject: (projectId) => getRequest<ProjectResponse>(`/api/v1/projects/${projectId}`),
    listSources: (projectId) =>
      getRequest<SourceDocumentListResponse>(`/api/v1/projects/${projectId}/sources`),
    getSource: (projectId, sourceId) =>
      getRequest<SourceDocumentResponse>(`/api/v1/projects/${projectId}/sources/${sourceId}`),
    importTextSource: (projectId, input) =>
      postRequest<SourceDocumentResponse>(`/api/v1/projects/${projectId}/sources`, input),
    getSourceManifest: (projectId) =>
      getOptionalRequest<SourceManifestResponse>(
        `/api/v1/projects/${projectId}/source-manifest`,
        "SOURCE_MANIFEST_NOT_FOUND",
      ),
    getStoryBibleIndex: (projectId) =>
      getOptionalRequest<StoryBibleIndexResponse>(
        `/api/v1/projects/${projectId}/story-bible`,
        "STORY_BIBLE_NOT_FOUND",
      ),
    getStoryBibleVersion: (projectId, versionId) =>
      getRequest<StoryBibleVersionResponse>(
        `/api/v1/projects/${projectId}/story-bible/versions/${versionId}`,
      ),
    listProjectTasks: (projectId) =>
      getRequest<TaskQueueResponse>(`/api/v1/projects/${projectId}/tasks`),
    listInvalidationOperations: (projectId) =>
      getRequest<InvalidationOperationListResponse>(
        `/api/v1/projects/${projectId}/invalidation-operations`,
      ),
    getInvalidationOperation: (projectId, operationId) =>
      getRequest<InvalidationOperationDetailResponse>(
        `/api/v1/projects/${projectId}/invalidation-operations/${operationId}`,
      ),
    listProviderConnections: () =>
      getRequest<ProviderConnectionListResponse>("/api/v1/provider-connections"),
    createProviderConnection: (input) =>
      postRequest<ProviderConnectionResponse>("/api/v1/provider-connections", input),
    deleteProviderConnection: (connectionId) =>
      deleteRequest(`/api/v1/provider-connections/${connectionId}`),
  };
}
