import type { components } from "@aijian/contracts";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
export type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
export type ProjectData = components["schemas"]["ProjectData"];
export type ProjectListResponse = components["schemas"]["ProjectListResponse"];
export type ProjectResponse = components["schemas"]["ProjectResponse"];
export type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
export type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];

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
    throw new Error(`Studio API request failed with status ${response.status}`);
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

function postRequest<T>(path: string, payload: unknown): Promise<T> {
  return browserRequest<T>(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
  };
}
