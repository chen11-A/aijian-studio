import type { components } from "@aijian/contracts";

import type { SidecarSession } from "./sidecar-protocol";

type HealthResponse = components["schemas"]["HealthResponse"];
export type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
export type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
export type ProjectListResponse = components["schemas"]["ProjectListResponse"];
export type ProjectResponse = components["schemas"]["ProjectResponse"];
export type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
export type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type SidecarApiSession = Pick<SidecarSession, "origin" | "token">;

export interface LocalApiClient {
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK_ID_PATTERN = /^srcb_[0-9a-f]{32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_SOURCE_BASE64_LENGTH = Math.ceil((5 * 1024 * 1024) / 3) * 4;

function canonicalLoopbackOrigin(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Local API URL must be a canonical loopback origin");
  }

  const isCanonical =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.port !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  if (!isCanonical || url.origin !== baseUrl) {
    throw new Error("Local API URL must be a canonical loopback origin");
  }
  return url.origin;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.request_id !== "string" || !UUID_PATTERN.test(candidate.request_id)) {
    return false;
  }
  if (typeof candidate.data !== "object" || candidate.data === null) return false;
  const data = candidate.data as Record<string, unknown>;
  return data.status === "ok" && data.service === "aijian-api" && typeof data.version === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function isProject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    PROJECT_ID_PATTERN.test(value.id) &&
    typeof value.name === "string" &&
    value.aspect_ratio === "9:16" &&
    Number.isInteger(value.target_duration_seconds) &&
    value.source_language === "zh-CN" &&
    (value.status === "active" || value.status === "archived") &&
    Number.isInteger(value.revision) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function hasRequestId(value: Record<string, unknown>): boolean {
  return typeof value.request_id === "string" && UUID_PATTERN.test(value.request_id);
}

function isProjectResponse(value: unknown): value is ProjectResponse {
  return isRecord(value) && hasRequestId(value) && isProject(value.data);
}

function isProjectListResponse(value: unknown): value is ProjectListResponse {
  return (
    isRecord(value) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(isProject)
  );
}

function isSourceBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    SOURCE_BLOCK_ID_PATTERN.test(value.id) &&
    Number.isInteger(value.ordinal) &&
    (value.kind === "chapter_heading" || value.kind === "paragraph") &&
    Number.isInteger(value.chapter_index) &&
    typeof value.text === "string" &&
    Number.isInteger(value.normalized_start_byte) &&
    Number.isInteger(value.normalized_end_byte) &&
    typeof value.content_sha256 === "string" &&
    SHA256_PATTERN.test(value.content_sha256)
  );
}

function isSourceDocumentSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    SOURCE_ID_PATTERN.test(value.id) &&
    typeof value.project_id === "string" &&
    PROJECT_ID_PATTERN.test(value.project_id) &&
    typeof value.filename === "string" &&
    value.media_type === "text/plain" &&
    value.encoding === "utf-8" &&
    Number.isInteger(value.byte_size) &&
    typeof value.raw_sha256 === "string" &&
    SHA256_PATTERN.test(value.raw_sha256) &&
    typeof value.imported_at === "string" &&
    Number.isInteger(value.chapter_count) &&
    Number.isInteger(value.block_count)
  );
}

function isSourceDocumentListResponse(value: unknown): value is SourceDocumentListResponse {
  return (
    isRecord(value) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(isSourceDocumentSummary)
  );
}

function isSourceDocumentResponse(value: unknown): value is SourceDocumentResponse {
  if (!isRecord(value) || !hasRequestId(value) || !isRecord(value.data)) return false;
  const data = value.data;
  return (
    isSourceDocumentSummary(data) &&
    Array.isArray(data.blocks) &&
    data.block_count === data.blocks.length &&
    data.blocks.every(isSourceBlock)
  );
}

function isCreateProjectInput(value: unknown): value is CreateProjectInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const validKeys = ["aspect_ratio", "name", "source_language", "target_duration_seconds"];
  const nameLength = typeof value.name === "string" ? [...value.name].length : 0;
  return (
    keys.length === validKeys.length &&
    validKeys.every((key, index) => keys[index] === key) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    nameLength <= 80 &&
    !hasControlCharacter(value.name) &&
    value.aspect_ratio === "9:16" &&
    Number.isInteger(value.target_duration_seconds) &&
    Number(value.target_duration_seconds) >= 30 &&
    Number(value.target_duration_seconds) <= 180 &&
    value.source_language === "zh-CN"
  );
}

function isImportTextSourceInput(value: unknown): value is ImportTextSourceInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const validKeys = ["content_base64", "filename", "media_type"];
  return (
    keys.length === validKeys.length &&
    validKeys.every((key, index) => keys[index] === key) &&
    typeof value.filename === "string" &&
    value.filename.length > 0 &&
    value.filename.length <= 255 &&
    value.filename.toLowerCase().endsWith(".txt") &&
    !value.filename.includes("/") &&
    !value.filename.includes("\\") &&
    !hasControlCharacter(value.filename) &&
    value.media_type === "text/plain" &&
    typeof value.content_base64 === "string" &&
    value.content_base64.length >= 4 &&
    value.content_base64.length <= MAX_SOURCE_BASE64_LENGTH &&
    BASE64_PATTERN.test(value.content_base64)
  );
}

export function createLocalApiClient(fetcher: Fetcher, session: SidecarApiSession): LocalApiClient {
  const origin = canonicalLoopbackOrigin(session.origin);
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(session.token)) {
    throw new Error("Local API client requires a valid sidecar session");
  }
  const authorization = `Bearer ${session.token}`;
  const headers = {
    Accept: "application/json",
    Authorization: authorization,
    Origin: "app://aijian",
  };

  async function requestJson<T>(
    path: string,
    validator: (value: unknown) => value is T,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetcher(`${origin}${path}`, init);
    if (!response.ok) {
      throw new Error(`Local API request failed with status ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!validator(payload)) {
      throw new Error("Local API response does not match the published contract");
    }
    return payload;
  }

  function postInit(payload: unknown): RequestInit {
    return {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };
  }

  return {
    async getHealth(): Promise<HealthResponse> {
      const response = await fetcher(`${origin}/api/v1/health`, {
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          Origin: "app://aijian",
        },
      });
      if (!response.ok) {
        throw new Error(`Local API health request failed with status ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!isHealthResponse(payload)) {
        throw new Error("Local API health response does not match the published contract");
      }
      return payload;
    },
    listProjects: () =>
      requestJson("/api/v1/projects", isProjectListResponse, {
        headers,
      }),
    async createProject(input: CreateProjectInput): Promise<ProjectResponse> {
      if (!isCreateProjectInput(input)) {
        throw new Error("Local API client requires valid project input");
      }
      return requestJson("/api/v1/projects", isProjectResponse, postInit(input));
    },
    async getProject(projectId: string): Promise<ProjectResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(`/api/v1/projects/${projectId}`, isProjectResponse, { headers });
    },
    async listSources(projectId: string): Promise<SourceDocumentListResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(`/api/v1/projects/${projectId}/sources`, isSourceDocumentListResponse, {
        headers,
      });
    },
    async getSource(projectId: string, sourceId: string): Promise<SourceDocumentResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!SOURCE_ID_PATTERN.test(sourceId)) {
        throw new Error("Local API client requires a valid source id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources/${sourceId}`,
        isSourceDocumentResponse,
        { headers },
      );
    },
    async importTextSource(
      projectId: string,
      input: ImportTextSourceInput,
    ): Promise<SourceDocumentResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!isImportTextSourceInput(input)) {
        throw new Error("Local API client requires valid text source input");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources`,
        isSourceDocumentResponse,
        postInit(input),
      );
    },
  };
}
