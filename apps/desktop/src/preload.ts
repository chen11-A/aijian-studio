import type { components } from "@aijian/contracts";
import { contextBridge, ipcRenderer } from "electron";

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
type ArtifactProposalResponse = components["schemas"]["ArtifactProposalResponse"];
type ArtifactProposalDraftAcceptanceInput =
  components["schemas"]["CreateArtifactProposalDraftAcceptanceRequest"];
type ArtifactProposalDraftAcceptanceResponse =
  components["schemas"]["ArtifactProposalDraftAcceptanceResponse"];
type ArtifactProposalRejectionInput =
  components["schemas"]["CreateArtifactProposalRejectionRequest"];
type ArtifactProposalRejectionResponse = components["schemas"]["ArtifactProposalRejectionResponse"];
type ArtifactProposalDecisionResult<TReceipt> =
  | { kind: "SUCCEEDED"; receipt: TReceipt }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
type ProposalRunCreateInput = components["schemas"]["CreateProposalRunRequest"];
type CreatedProposalRunResponse = components["schemas"]["CreatedProposalRunResponse"];
type ProposalRunCreateCommand = { operation_id: string; input: ProposalRunCreateInput };
type ProposalRunCreateResult =
  | { kind: "SUCCEEDED"; receipt: CreatedProposalRunResponse; replayed: boolean }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
type AgentCatalogResponse = components["schemas"]["AgentCatalogResponse"];
type SkillCatalogResponse = components["schemas"]["SkillCatalogResponse"];
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
  getArtifactProposal: (projectId: string, proposalId: string): Promise<ArtifactProposalResponse> =>
    ipcRenderer.invoke("proposals:get", projectId, proposalId) as Promise<ArtifactProposalResponse>,
  acceptArtifactProposalAsDraft: (
    projectId: string,
    proposalId: string,
    input: ArtifactProposalDraftAcceptanceInput,
  ): Promise<ArtifactProposalDecisionResult<ArtifactProposalDraftAcceptanceResponse>> =>
    ipcRenderer.invoke("proposals:accept-as-draft", projectId, proposalId, input) as Promise<
      ArtifactProposalDecisionResult<ArtifactProposalDraftAcceptanceResponse>
    >,
  rejectArtifactProposal: (
    projectId: string,
    proposalId: string,
    input: ArtifactProposalRejectionInput,
  ): Promise<ArtifactProposalDecisionResult<ArtifactProposalRejectionResponse>> =>
    ipcRenderer.invoke("proposals:reject", projectId, proposalId, input) as Promise<
      ArtifactProposalDecisionResult<ArtifactProposalRejectionResponse>
    >,
  createProposalRun: (
    projectId: string,
    command: ProposalRunCreateCommand,
  ): Promise<ProposalRunCreateResult> =>
    ipcRenderer.invoke(
      "proposal-runs:create",
      projectId,
      command,
    ) as Promise<ProposalRunCreateResult>,
  listProjectAgents: (projectId: string): Promise<AgentCatalogResponse> =>
    ipcRenderer.invoke("agents:list", projectId) as Promise<AgentCatalogResponse>,
  listProjectSkills: (projectId: string): Promise<SkillCatalogResponse> =>
    ipcRenderer.invoke("skills:list", projectId) as Promise<SkillCatalogResponse>,
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
