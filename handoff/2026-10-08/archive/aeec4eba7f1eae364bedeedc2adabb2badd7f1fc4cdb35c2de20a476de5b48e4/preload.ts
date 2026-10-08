import type { components } from "@aijian/contracts";
import type {
  CreateEpisodeInput,
  EpisodeCreateResult,
  EpisodeListQuery,
  EpisodeListResponse,
  EpisodeResponse,
} from "./api-client";
import type { SourceManifestReviewOperationResult } from "./source-manifest-review";
import { contextBridge, ipcRenderer } from "electron";
import type {
  InvalidationOperationPageQuery,
  InvalidationOperationPageResponse,
} from "@aijian/contracts/invalidation-operation";

type HealthResponse = components["schemas"]["HealthResponse"];
type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
type ProjectListResponse = components["schemas"]["ProjectListResponse"];
type ProjectResponse = components["schemas"]["ProjectResponse"];
type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
type SourceManifestResponse = components["schemas"]["SourceManifestResponse"];
// This type-only import erases completely; the sandbox preload has no relative runtime imports.
type SourceManifestReviewResult = SourceManifestReviewOperationResult;
type SourceManifestReviewIdentity = {
  project_id: string;
  version_id: string;
  content_hash: string;
  expected_revision: number;
};
type StoryBibleIndexResponse = components["schemas"]["StoryBibleIndexResponse"];
type StoryBibleVersionResponse = components["schemas"]["StoryBibleVersionResponse"];
type TaskQueueResponse = components["schemas"]["TaskQueueResponse"];
type ArtifactProposalResponse = components["schemas"]["ArtifactProposalResponse"];
type InvalidationOperationResponse = components["schemas"]["InvalidationOperationResponse"];
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
type FakeTimelineRunCreateInput = components["schemas"]["CreateFakeTimelineRunRequest"];
type FakeTimelineRunResponse = components["schemas"]["FakeTimelineRunResponse"];
type FakeTimelineRunCreateCommand = { operation_id: string; input: FakeTimelineRunCreateInput };
type FakeTimelineRunCreateResult =
  | { kind: "SUCCEEDED"; receipt: FakeTimelineRunResponse; replayed: boolean }
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
type ProductionBriefResponse = components["schemas"]["ProductionBriefResponse"];
type ProductionBriefCreateInput = {
  content: components["schemas"]["ProductionBriefContentV1"];
  parent_version_id: string | null;
  expected_revision: number | null;
  change_summary: string;
};
type ProductionBriefCreateResult =
  | { kind: "SUCCEEDED"; receipt: ProductionBriefResponse }
  | { kind: "DEFINITE_SERVER_ERROR"; status: 409 | 422 | 428; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };

contextBridge.exposeInMainWorld("aijian", {
  health: (): Promise<HealthResponse> =>
    ipcRenderer.invoke("health:get") as Promise<HealthResponse>,
  listProjects: (): Promise<ProjectListResponse> =>
    ipcRenderer.invoke("projects:list") as Promise<ProjectListResponse>,
  createProject: (input: CreateProjectInput): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:create", input) as Promise<ProjectResponse>,
  getProject: (projectId: string): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:get", projectId) as Promise<ProjectResponse>,
  listEpisodes: (projectId: string, query?: EpisodeListQuery): Promise<EpisodeListResponse> =>
    ipcRenderer.invoke(
      "episodes:list",
      projectId,
      query === undefined ? {} : query,
    ) as Promise<EpisodeListResponse>,
  getEpisode: (projectId: string, episodeId: string): Promise<EpisodeResponse> =>
    ipcRenderer.invoke("episodes:get", projectId, episodeId) as Promise<EpisodeResponse>,
  createEpisode: (projectId: string, input: CreateEpisodeInput): Promise<EpisodeCreateResult> =>
    ipcRenderer.invoke("episodes:create", projectId, input) as Promise<EpisodeCreateResult>,
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
  submitSourceManifest: (
    input: SourceManifestReviewIdentity,
  ): Promise<SourceManifestReviewResult> =>
    ipcRenderer.invoke("source-manifest:submit", input) as Promise<SourceManifestReviewResult>,
  confirmSourceManifestBaseline: (
    input: SourceManifestReviewIdentity & { rationale: string },
  ): Promise<SourceManifestReviewResult> =>
    ipcRenderer.invoke(
      "source-manifest:confirm-baseline",
      input,
    ) as Promise<SourceManifestReviewResult>,
  copySourceManifestDraft: (
    input: SourceManifestReviewIdentity,
  ): Promise<SourceManifestReviewResult> =>
    ipcRenderer.invoke("source-manifest:copy-draft", input) as Promise<SourceManifestReviewResult>,
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
  getProductionBrief: (projectId: string): Promise<ProductionBriefResponse | null> =>
    ipcRenderer.invoke(
      "production-brief:get",
      projectId,
    ) as Promise<ProductionBriefResponse | null>,
  getProductionBriefVersion: (
    projectId: string,
    versionId: string,
  ): Promise<ProductionBriefResponse> =>
    ipcRenderer.invoke(
      "production-brief:get-version",
      projectId,
      versionId,
    ) as Promise<ProductionBriefResponse>,
  createProductionBriefVersion: (
    projectId: string,
    command: { operation_id: string; input: ProductionBriefCreateInput },
  ): Promise<ProductionBriefCreateResult> =>
    ipcRenderer.invoke(
      "production-brief:create",
      projectId,
      command,
    ) as Promise<ProductionBriefCreateResult>,
  listProjectTasks: (projectId: string): Promise<TaskQueueResponse> =>
    ipcRenderer.invoke("tasks:list", projectId) as Promise<TaskQueueResponse>,
  getArtifactProposal: (projectId: string, proposalId: string): Promise<ArtifactProposalResponse> =>
    ipcRenderer.invoke("proposals:get", projectId, proposalId) as Promise<ArtifactProposalResponse>,
  listInvalidationOperations: (
    projectId: string,
    query?: InvalidationOperationPageQuery,
  ): Promise<InvalidationOperationPageResponse> =>
    ipcRenderer.invoke(
      "invalidation-operations:list",
      projectId,
      query === undefined ? {} : query,
    ) as Promise<InvalidationOperationPageResponse>,
  getInvalidationOperation: (
    projectId: string,
    operationId: string,
  ): Promise<InvalidationOperationResponse> =>
    ipcRenderer.invoke(
      "invalidation-operations:get",
      projectId,
      operationId,
    ) as Promise<InvalidationOperationResponse>,
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
  createFakeTimelineRun: (
    projectId: string,
    command: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunCreateResult> =>
    ipcRenderer.invoke(
      "fake-timeline-runs:create",
      projectId,
      command,
    ) as Promise<FakeTimelineRunCreateResult>,
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
