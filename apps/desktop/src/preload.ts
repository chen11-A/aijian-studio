import type { components } from "@aijian/contracts";
import { contextBridge, ipcRenderer } from "electron";

import { createAgentSkillCatalogPreload } from "./agent-skill-catalog-ipc";

type HealthResponse = components["schemas"]["HealthResponse"];
type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
type ProjectListResponse = components["schemas"]["ProjectListResponse"];
type ProjectResponse = components["schemas"]["ProjectResponse"];
type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
type SourceManifestResponse = components["schemas"]["SourceManifestResponse"];
type StoryBibleIndexResponse = components["schemas"]["StoryBibleIndexResponse"];
type StoryBibleVersionResponse = components["schemas"]["StoryBibleVersionResponse"];
type TaskQueueResponse = components["schemas"]["TaskQueueResponse"];
type TimelineResponse = components["schemas"]["TimelineResponse"];
type TrimTimelineClipInput = components["schemas"]["TrimTimelineClipRequest"];
type ReorderTimelineClipInput = components["schemas"]["ReorderTimelineClipRequest"];
type ReplaceTimelineClipInput = components["schemas"]["ReplaceTimelineClipRequest"];
type CreateProviderConnectionInput = components["schemas"]["CreateProviderConnectionRequest"];
type ProviderConnectionListResponse = components["schemas"]["ProviderConnectionListResponse"];
type ProviderConnectionResponse = components["schemas"]["ProviderConnectionResponse"];

contextBridge.exposeInMainWorld("aijian", {
  health: (): Promise<HealthResponse> =>
    ipcRenderer.invoke("health:get") as Promise<HealthResponse>,
  listProjects: (): Promise<ProjectListResponse> =>
    ipcRenderer.invoke("projects:list") as Promise<ProjectListResponse>,
  createProject: (input: CreateProjectInput): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:create", input) as Promise<ProjectResponse>,
  getProject: (projectId: string): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:get", projectId) as Promise<ProjectResponse>,
  listSources: (projectId: string): Promise<SourceDocumentListResponse> =>
    ipcRenderer.invoke("sources:list", projectId) as Promise<SourceDocumentListResponse>,
  getSource: (projectId: string, sourceId: string): Promise<SourceDocumentResponse> =>
    ipcRenderer.invoke("sources:get", projectId, sourceId) as Promise<SourceDocumentResponse>,
  importTextSource: (
    projectId: string,
    input: ImportTextSourceInput,
  ): Promise<SourceDocumentResponse> =>
    ipcRenderer.invoke("sources:import-text", projectId, input) as Promise<SourceDocumentResponse>,
  getSourceManifest: (projectId: string): Promise<SourceManifestResponse | null> =>
    ipcRenderer.invoke(
      "artifacts:get-source-manifest",
      projectId,
    ) as Promise<SourceManifestResponse | null>,
  getStoryBibleIndex: (projectId: string): Promise<StoryBibleIndexResponse | null> =>
    ipcRenderer.invoke(
      "artifacts:get-story-bible-index",
      projectId,
    ) as Promise<StoryBibleIndexResponse | null>,
  getStoryBibleVersion: (
    projectId: string,
    versionId: string,
  ): Promise<StoryBibleVersionResponse> =>
    ipcRenderer.invoke(
      "artifacts:get-story-bible-version",
      projectId,
      versionId,
    ) as Promise<StoryBibleVersionResponse>,
  listProjectTasks: (projectId: string): Promise<TaskQueueResponse> =>
    ipcRenderer.invoke("tasks:list", projectId) as Promise<TaskQueueResponse>,
  ...createAgentSkillCatalogPreload((channel, projectId) => ipcRenderer.invoke(channel, projectId)),
  startFakeTimelineWorkflow: (projectId: string): Promise<TimelineResponse> =>
    ipcRenderer.invoke("workflows:start-fake-timeline", projectId) as Promise<TimelineResponse>,
  getProjectTimeline: (projectId: string): Promise<TimelineResponse | null> =>
    ipcRenderer.invoke("timeline:get", projectId) as Promise<TimelineResponse | null>,
  trimTimelineClip: (projectId: string, input: TrimTimelineClipInput): Promise<TimelineResponse> =>
    ipcRenderer.invoke("timeline:trim", projectId, input) as Promise<TimelineResponse>,
  reorderTimelineClip: (
    projectId: string,
    input: ReorderTimelineClipInput,
  ): Promise<TimelineResponse> =>
    ipcRenderer.invoke("timeline:reorder", projectId, input) as Promise<TimelineResponse>,
  replaceTimelineClip: (
    projectId: string,
    input: ReplaceTimelineClipInput,
  ): Promise<TimelineResponse> =>
    ipcRenderer.invoke("timeline:replace", projectId, input) as Promise<TimelineResponse>,
  listProviderConnections: (): Promise<ProviderConnectionListResponse> =>
    ipcRenderer.invoke("providers:list") as Promise<ProviderConnectionListResponse>,
  createProviderConnection: (
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionResponse> =>
    ipcRenderer.invoke("providers:create", input) as Promise<ProviderConnectionResponse>,
  deleteProviderConnection: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke("providers:delete", connectionId) as Promise<void>,
});
