import type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
import type {
  MediaToolchainResult,
  MediaToolchainSelectionResult,
  MediaToolchainCancelResult,
} from "./media-toolchain-contract";
import type {
  MediaAssetProbeReadResult,
  MediaAssetProbeWriteResult,
} from "./media-asset-probe-contract";
import type {
  CreateDraftReviewNoteRequest,
  ResolveDraftReviewNoteRequest,
  DraftReviewResult,
} from "./draft-review-contract";
import type { OfficialTextBridge } from "@aijian/contracts/official-text";
import type { ChatGPTBridge } from "@aijian/contracts/chatgpt-auth";
import type {
  DraftExportPreviewResult,
  DraftExportRevealResult,
  DraftExportCommand,
  DraftExportListResult,
  DraftExportResult,
  DraftExportSubmitResult,
} from "./draft-export-contract";
import type {
  CreateEpisodeMediaAssemblyVersionRequest,
  EpisodeMediaAssemblyResult,
  EpisodeMediaAssemblyWriteResult,
} from "./episode-media-assembly-contract";
import type { components } from "@aijian/contracts";
import type {
  CreateEpisodeInput,
  EpisodeCreateResult,
  EpisodeListQuery,
  EpisodeListResponse,
  EpisodeResponse,
  FakeTimelineRunOperationQueryResult,
  SourceDocumentTextResponse,
  DevelopmentExportCreateInput,
  DevelopmentExportCreateResult,
  DevelopmentExportResponse,
  DevelopmentExportOpenResult,
  DevelopmentExportPreviewResult,
  DevelopmentExportSaveResult,
  RemoteSourceExtractCreateCommand,
  RemoteSourceExtractCreateResult,
  RemoteSourceExtractOriginalRunResult,
  SourceExtractionReadResult,
  VersionedSourceExtractionProposalReadResult,
  Sub2APIApprovalCommand,
  Sub2APIApprovalReadResult,
  Sub2APIApprovalResult,
  Sub2APIOperationReadResult,
  Sub2APIQueueCommand,
  Sub2APIQueueResult,
  ProjectUpdateCommand,
  ProjectUpdateResult,
  AppPreferencesReadResult,
  AppPreferencesSaveResult,
  SaveAppPreferencesCommand,
  AddMediaAssetReferenceCommand,
  MediaAssetDeleteResult,
  MediaAssetImportResult,
  MediaAssetListResult,
  MediaAssetPreviewResult,
  MediaAssetReadResult,
  MediaAssetReferenceResult,
  MediaAssetUnreferenceResult,
  RemoveMediaAssetReferenceCommand,
  Sub2APIConfiguredReadinessResult,
  EditSub2APIMetadataCommand,
  RotateSub2APIKeyCommand,
  Sub2APIConnectionMutationResult,
  Sub2APIRotationReadResult,
  CreateProjectCreativeLibraryVersionRequest,
  ProjectCreativeLibraryLatestResult,
  ProjectCreativeLibraryVersionResult,
  ProjectCreativeLibraryCreateResult,
  CreateEpisodeStoryboardVersionRequest,
  EpisodeStoryboardCreateResult,
  EpisodeStoryboardLatestResult,
  EpisodeStoryboardVersionResult,
  CreateEpisodeScriptVersionRequest,
  EpisodeScriptCreateResult,
  EpisodeScriptLatestResult,
  EpisodeScriptVersionResult,
  CreateEpisodeScriptConfirmationRequest,
  EpisodeScriptConfirmationCreateResult,
  EpisodeScriptConfirmationReadResult,
  SourceProposalAcceptanceResult,
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

// Separate renderer-safe official login surface. Credentials and callback values never cross IPC.
contextBridge.exposeInMainWorld("aijianChatGPT", {
  status: () => ipcRenderer.invoke("chatgpt-auth:status"),
  signIn: (scope, profileId) => ipcRenderer.invoke("chatgpt-auth:sign-in", scope, profileId),
  cancel: () => ipcRenderer.invoke("chatgpt-auth:cancel"),
  selectProfile: (profileId) => ipcRenderer.invoke("chatgpt-auth:select", profileId),
  signOut: () => ipcRenderer.invoke("chatgpt-auth:sign-out"),
  models: () => ipcRenderer.invoke("chatgpt-auth:models"),
  openHelp: (topic) => ipcRenderer.invoke("chatgpt-auth:help", topic),
} satisfies ChatGPTBridge);

// Trusted proposal surface. There is deliberately no renderer completion/reservation endpoint.
contextBridge.exposeInMainWorld("aijianOfficialText", {
  list: (project, episode) => ipcRenderer.invoke("official-text:list", project, episode),
  get: (project, episode, operation) =>
    ipcRenderer.invoke("official-text:get", project, episode, operation),
  generate: (command) => ipcRenderer.invoke("official-text:generate", command),
  adopt: (project, episode, operation, input) =>
    ipcRenderer.invoke("official-text:adopt", project, episode, operation, input),
} satisfies OfficialTextBridge);

// HUMAN-only proposal surface. There is no arbitrary path, renderer fetch or AI completion API.
contextBridge.exposeInMainWorld("aijianShotPlan", {
  prepareHumanShotPlan: (projectId, episodeId) =>
    ipcRenderer.invoke("shot-plan:prepare", projectId, episodeId),
  getShotPlanProposal: (projectId, episodeId) =>
    ipcRenderer.invoke("shot-plan:latest", projectId, episodeId),
  getShotPlanProposalVersion: (projectId, episodeId, versionId) =>
    ipcRenderer.invoke("shot-plan:version", projectId, episodeId, versionId),
  getHumanShotPlanWriteStatus: (projectId, episodeId, operationId) =>
    ipcRenderer.invoke("shot-plan:write-status", projectId, episodeId, operationId),
  getShotPlanAdoptionStatus: (projectId, episodeId, versionId) =>
    ipcRenderer.invoke("shot-plan:adoption-status", projectId, episodeId, versionId),
  createHumanShotPlanProposal: (projectId, episodeId, operationId, payload) =>
    ipcRenderer.invoke("shot-plan:create-human", projectId, episodeId, operationId, payload),
  adoptHumanShotPlanProposal: (projectId, episodeId, versionId, operationId, payload) =>
    ipcRenderer.invoke(
      "shot-plan:adopt-human",
      projectId,
      episodeId,
      versionId,
      operationId,
      payload,
    ),
} satisfies ShotPlanGateway);

contextBridge.exposeInMainWorld("aijian", {
  getMediaAssetProbeEvidence: (
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeReadResult> =>
    ipcRenderer.invoke(
      "media-asset-probe:get",
      projectId,
      assetId,
      versionId,
    ) as Promise<MediaAssetProbeReadResult>,
  probeSelectedMediaAssetVersion: (
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetProbeWriteResult> =>
    ipcRenderer.invoke(
      "media-asset-probe:probe-selected",
      projectId,
      assetId,
      versionId,
    ) as Promise<MediaAssetProbeWriteResult>,
  getMediaToolchainStatus: (): Promise<MediaToolchainResult> =>
    ipcRenderer.invoke("media-toolchain:status") as Promise<MediaToolchainResult>,
  selectMediaToolchain: (): Promise<MediaToolchainSelectionResult> =>
    ipcRenderer.invoke("media-toolchain:select") as Promise<MediaToolchainSelectionResult>,
  clearMediaToolchain: (): Promise<MediaToolchainResult> =>
    ipcRenderer.invoke("media-toolchain:clear") as Promise<MediaToolchainResult>,
  cancelMediaToolchainSelection: (): Promise<MediaToolchainCancelResult> =>
    ipcRenderer.invoke("media-toolchain:cancel-selection") as Promise<MediaToolchainCancelResult>,
  getAppPreferences: (): Promise<AppPreferencesReadResult> =>
    ipcRenderer.invoke("app-preferences:get") as Promise<AppPreferencesReadResult>,
  saveAppPreferences: (command: SaveAppPreferencesCommand): Promise<AppPreferencesSaveResult> =>
    ipcRenderer.invoke("app-preferences:save", command) as Promise<AppPreferencesSaveResult>,
  listProjectMediaAssets: (projectId: string): Promise<MediaAssetListResult> =>
    ipcRenderer.invoke("media-assets:list", projectId) as Promise<MediaAssetListResult>,
  getProjectMediaAsset: (projectId: string, assetId: string): Promise<MediaAssetReadResult> =>
    ipcRenderer.invoke("media-assets:get", projectId, assetId) as Promise<MediaAssetReadResult>,
  importProjectMediaAssetFromPicker: (projectId: string): Promise<MediaAssetImportResult> =>
    ipcRenderer.invoke(
      "media-assets:import-from-picker",
      projectId,
    ) as Promise<MediaAssetImportResult>,
  importProjectMediaAssetVersionFromPicker: (
    projectId: string,
    assetId: string,
  ): Promise<MediaAssetImportResult> =>
    ipcRenderer.invoke(
      "media-assets:import-version-from-picker",
      projectId,
      assetId,
    ) as Promise<MediaAssetImportResult>,
  readProjectMediaAssetPreview: (
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<MediaAssetPreviewResult> =>
    ipcRenderer.invoke(
      "media-assets:preview",
      projectId,
      assetId,
      versionId,
    ) as Promise<MediaAssetPreviewResult>,
  addProjectMediaAssetEpisodeReference: (
    projectId: string,
    assetId: string,
    command: AddMediaAssetReferenceCommand,
  ): Promise<MediaAssetReferenceResult> =>
    ipcRenderer.invoke(
      "media-assets:add-episode-reference",
      projectId,
      assetId,
      command,
    ) as Promise<MediaAssetReferenceResult>,
  removeProjectMediaAssetEpisodeReference: (
    projectId: string,
    assetId: string,
    command: RemoveMediaAssetReferenceCommand,
  ): Promise<MediaAssetUnreferenceResult> =>
    ipcRenderer.invoke(
      "media-assets:remove-episode-reference",
      projectId,
      assetId,
      command,
    ) as Promise<MediaAssetUnreferenceResult>,
  deleteProjectMediaAsset: (projectId: string, assetId: string): Promise<MediaAssetDeleteResult> =>
    ipcRenderer.invoke(
      "media-assets:delete",
      projectId,
      assetId,
    ) as Promise<MediaAssetDeleteResult>,
  health: (): Promise<HealthResponse> =>
    ipcRenderer.invoke("health:get") as Promise<HealthResponse>,
  listProjects: (): Promise<ProjectListResponse> =>
    ipcRenderer.invoke("projects:list") as Promise<ProjectListResponse>,
  createProject: (input: CreateProjectInput): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:create", input) as Promise<ProjectResponse>,
  getProject: (projectId: string): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:get", projectId) as Promise<ProjectResponse>,
  updateProject: (projectId: string, command: ProjectUpdateCommand): Promise<ProjectUpdateResult> =>
    ipcRenderer.invoke("projects:update", projectId, command) as Promise<ProjectUpdateResult>,
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
  getSourceText: (projectId: string, sourceId: string): Promise<SourceDocumentTextResponse> =>
    ipcRenderer.invoke(
      "sources:get-text",
      projectId,
      sourceId,
    ) as Promise<SourceDocumentTextResponse>,
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
  createRemoteSourceExtractRun: (
    projectId: string,
    command: RemoteSourceExtractCreateCommand,
  ): Promise<RemoteSourceExtractCreateResult> =>
    ipcRenderer.invoke(
      "remote-source-extract:create",
      projectId,
      command,
    ) as Promise<RemoteSourceExtractCreateResult>,
  readOriginalRemoteSourceExtractRun: (
    projectId: string,
    originalCommand: RemoteSourceExtractCreateCommand,
  ): Promise<RemoteSourceExtractOriginalRunResult> =>
    ipcRenderer.invoke(
      "remote-source-extract:read-original-run",
      projectId,
      originalCommand,
    ) as Promise<RemoteSourceExtractOriginalRunResult>,
  getSourceExtraction: (projectId: string): Promise<SourceExtractionReadResult> =>
    ipcRenderer.invoke("source-extraction:get", projectId) as Promise<SourceExtractionReadResult>,
  getSourceExtractionVersion: (
    projectId: string,
    versionId: string,
  ): Promise<SourceExtractionReadResult> =>
    ipcRenderer.invoke(
      "source-extraction:get-version",
      projectId,
      versionId,
    ) as Promise<SourceExtractionReadResult>,
  readVersionedSourceExtractionProposal: (
    projectId: string,
    proposalId: string,
  ): Promise<VersionedSourceExtractionProposalReadResult> =>
    ipcRenderer.invoke(
      "source-extraction:read-versioned-proposal",
      projectId,
      proposalId,
    ) as Promise<VersionedSourceExtractionProposalReadResult>,
  createSub2APISourceExtractRun: (
    projectId: string,
    command: Sub2APIQueueCommand,
  ): Promise<Sub2APIQueueResult> =>
    ipcRenderer.invoke(
      "sub2api-source-extract:queue",
      projectId,
      command,
    ) as Promise<Sub2APIQueueResult>,
  readOriginalSub2APISourceExtractOperation: (
    projectId: string,
    originalCommand: Sub2APIQueueCommand,
  ): Promise<Sub2APIOperationReadResult> =>
    ipcRenderer.invoke(
      "sub2api-source-extract:read-original-operation",
      projectId,
      originalCommand,
    ) as Promise<Sub2APIOperationReadResult>,
  approveSub2APISourceExtractCall: (
    projectId: string,
    originalCommand: Sub2APIQueueCommand,
    approvalCommand: Sub2APIApprovalCommand,
  ): Promise<Sub2APIApprovalResult> =>
    ipcRenderer.invoke(
      "sub2api-source-extract:approve-one-call",
      projectId,
      originalCommand,
      approvalCommand,
    ) as Promise<Sub2APIApprovalResult>,
  getSub2APISourceExtractApproval: (
    projectId: string,
    originalCommand: Sub2APIQueueCommand,
  ): Promise<Sub2APIApprovalReadResult> =>
    ipcRenderer.invoke(
      "sub2api-source-extract:read-approval",
      projectId,
      originalCommand,
    ) as Promise<Sub2APIApprovalReadResult>,
  createFakeTimelineRun: (
    projectId: string,
    command: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunCreateResult> =>
    ipcRenderer.invoke(
      "fake-timeline-runs:create",
      projectId,
      command,
    ) as Promise<FakeTimelineRunCreateResult>,
  queryFakeTimelineRunOperation: (
    projectId: string,
    originalCommand: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunOperationQueryResult> =>
    ipcRenderer.invoke(
      "fake-timeline-runs:query-operation",
      projectId,
      originalCommand,
    ) as Promise<FakeTimelineRunOperationQueryResult>,
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
  createDevelopmentExport: (
    projectId: string,
    input: DevelopmentExportCreateInput,
  ): Promise<DevelopmentExportCreateResult> =>
    ipcRenderer.invoke(
      "development-exports:create",
      projectId,
      input,
    ) as Promise<DevelopmentExportCreateResult>,
  getDevelopmentExport: (
    projectId: string,
    operationId: string,
    timelineVersionId: string,
    expectedRevision: number,
  ): Promise<DevelopmentExportResponse> =>
    ipcRenderer.invoke(
      "development-exports:get",
      projectId,
      operationId,
      timelineVersionId,
      expectedRevision,
    ) as Promise<DevelopmentExportResponse>,
  readDevelopmentExportPreview: (
    projectId: string,
    operationId: string,
    timelineVersionId: string,
    expectedRevision: number,
    expectedSha256: string,
  ): Promise<DevelopmentExportPreviewResult> =>
    ipcRenderer.invoke(
      "development-exports:read-preview",
      projectId,
      operationId,
      timelineVersionId,
      expectedRevision,
      expectedSha256,
    ) as Promise<DevelopmentExportPreviewResult>,
  openDevelopmentExport: (
    projectId: string,
    operationId: string,
    timelineVersionId: string,
    expectedRevision: number,
  ): Promise<DevelopmentExportOpenResult> =>
    ipcRenderer.invoke(
      "development-exports:open",
      projectId,
      operationId,
      timelineVersionId,
      expectedRevision,
    ) as Promise<DevelopmentExportOpenResult>,
  saveDevelopmentExport: (
    projectId: string,
    operationId: string,
    timelineVersionId: string,
    expectedRevision: number,
  ): Promise<DevelopmentExportSaveResult> =>
    ipcRenderer.invoke(
      "development-exports:save",
      projectId,
      operationId,
      timelineVersionId,
      expectedRevision,
    ) as Promise<DevelopmentExportSaveResult>,
  listProviderConnections: (): Promise<ProviderConnectionListResponse> =>
    ipcRenderer.invoke("providers:list") as Promise<ProviderConnectionListResponse>,
  readSub2APIConfiguredReadiness: (
    connectionId: string,
    modelId: string,
  ): Promise<Sub2APIConfiguredReadinessResult> =>
    ipcRenderer.invoke(
      "providers:sub2api-configured-readiness",
      connectionId,
      modelId,
    ) as Promise<Sub2APIConfiguredReadinessResult>,
  editSub2APIMetadata: (
    connectionId: string,
    command: EditSub2APIMetadataCommand,
  ): Promise<Sub2APIConnectionMutationResult> =>
    ipcRenderer.invoke(
      "providers:edit-sub2api-metadata",
      connectionId,
      command,
    ) as Promise<Sub2APIConnectionMutationResult>,
  rotateSub2APIKey: (
    connectionId: string,
    command: RotateSub2APIKeyCommand,
  ): Promise<Sub2APIConnectionMutationResult> =>
    ipcRenderer.invoke(
      "providers:rotate-sub2api-key",
      connectionId,
      command,
    ) as Promise<Sub2APIConnectionMutationResult>,
  readSub2APIKeyRotation: (
    connectionId: string,
    operationId: string,
  ): Promise<Sub2APIRotationReadResult> =>
    ipcRenderer.invoke(
      "providers:read-sub2api-rotation",
      connectionId,
      operationId,
    ) as Promise<Sub2APIRotationReadResult>,
  getProjectCreativeLibrary: (projectId: string): Promise<ProjectCreativeLibraryLatestResult> =>
    ipcRenderer.invoke(
      "project-creative-library:latest",
      projectId,
    ) as Promise<ProjectCreativeLibraryLatestResult>,
  getProjectCreativeLibraryVersion: (
    projectId: string,
    versionId: string,
  ): Promise<ProjectCreativeLibraryVersionResult> =>
    ipcRenderer.invoke(
      "project-creative-library:version",
      projectId,
      versionId,
    ) as Promise<ProjectCreativeLibraryVersionResult>,
  createProjectCreativeLibraryVersion: (
    projectId: string,
    idempotencyKey: string,
    payload: CreateProjectCreativeLibraryVersionRequest,
  ): Promise<ProjectCreativeLibraryCreateResult> =>
    ipcRenderer.invoke(
      "project-creative-library:create-version",
      projectId,
      idempotencyKey,
      payload,
    ) as Promise<ProjectCreativeLibraryCreateResult>,
  readDraftExportPreview: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportPreviewResult> =>
    ipcRenderer.invoke(
      "draft-exports:preview",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftExportPreviewResult>,
  revealDraftExportOutput: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportRevealResult> =>
    ipcRenderer.invoke(
      "draft-exports:reveal-output",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftExportRevealResult>,
  listDraftReviewNotes: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftReviewResult> =>
    ipcRenderer.invoke(
      "draft-review:list",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftReviewResult>,
  createDraftReviewNote: (
    projectId: string,
    episodeId: string,
    operationId: string,
    command: CreateDraftReviewNoteRequest,
  ): Promise<DraftReviewResult> =>
    ipcRenderer.invoke(
      "draft-review:create-note",
      projectId,
      episodeId,
      operationId,
      command,
    ) as Promise<DraftReviewResult>,
  resolveDraftReviewNote: (
    projectId: string,
    episodeId: string,
    operationId: string,
    noteId: string,
    command: ResolveDraftReviewNoteRequest,
  ): Promise<DraftReviewResult> =>
    ipcRenderer.invoke(
      "draft-review:resolve-note",
      projectId,
      episodeId,
      operationId,
      noteId,
      command,
    ) as Promise<DraftReviewResult>,
  listDraftExports: (projectId: string, episodeId: string): Promise<DraftExportListResult> =>
    ipcRenderer.invoke(
      "draft-exports:list",
      projectId,
      episodeId,
    ) as Promise<DraftExportListResult>,
  getDraftExport: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportResult> =>
    ipcRenderer.invoke(
      "draft-exports:get",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftExportResult>,
  createDraftCompositionPreview: (
    projectId: string,
    episodeId: string,
    command: DraftExportCommand,
  ): Promise<DraftExportSubmitResult> =>
    ipcRenderer.invoke(
      "draft-exports:create-composition-preview",
      projectId,
      episodeId,
      command,
    ) as Promise<DraftExportSubmitResult>,
  createDraftExportFromPicker: (
    projectId: string,
    episodeId: string,
    command: DraftExportCommand,
  ): Promise<DraftExportSubmitResult> =>
    ipcRenderer.invoke(
      "draft-exports:create-from-picker",
      projectId,
      episodeId,
      command,
    ) as Promise<DraftExportSubmitResult>,
  cancelDraftExport: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportResult> =>
    ipcRenderer.invoke(
      "draft-exports:cancel",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftExportResult>,
  readLatestEpisodeMediaAssembly: (
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeMediaAssemblyResult> =>
    ipcRenderer.invoke(
      "episode-media-assembly:latest",
      projectId,
      episodeId,
    ) as Promise<EpisodeMediaAssemblyResult>,
  getEpisodeMediaAssemblyVersion: (
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<EpisodeMediaAssemblyResult> =>
    ipcRenderer.invoke(
      "episode-media-assembly:version",
      projectId,
      episodeId,
      versionId,
    ) as Promise<EpisodeMediaAssemblyResult>,
  createEpisodeMediaAssemblyVersion: (
    projectId: string,
    episodeId: string,
    payload: CreateEpisodeMediaAssemblyVersionRequest,
  ): Promise<EpisodeMediaAssemblyWriteResult> =>
    ipcRenderer.invoke(
      "episode-media-assembly:create-version",
      projectId,
      episodeId,
      payload,
    ) as Promise<EpisodeMediaAssemblyWriteResult>,
  getEpisodeStoryboard: (
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeStoryboardLatestResult> =>
    ipcRenderer.invoke(
      "episode-storyboard:latest",
      projectId,
      episodeId,
    ) as Promise<EpisodeStoryboardLatestResult>,
  getEpisodeStoryboardVersion: (
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<EpisodeStoryboardVersionResult> =>
    ipcRenderer.invoke(
      "episode-storyboard:version",
      projectId,
      episodeId,
      versionId,
    ) as Promise<EpisodeStoryboardVersionResult>,
  createEpisodeStoryboardVersion: (
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: CreateEpisodeStoryboardVersionRequest,
  ): Promise<EpisodeStoryboardCreateResult> =>
    ipcRenderer.invoke(
      "episode-storyboard:create-version",
      projectId,
      episodeId,
      idempotencyKey,
      payload,
    ) as Promise<EpisodeStoryboardCreateResult>,
  getEpisodeScript: (projectId: string, episodeId: string): Promise<EpisodeScriptLatestResult> =>
    ipcRenderer.invoke(
      "episode-script:latest",
      projectId,
      episodeId,
    ) as Promise<EpisodeScriptLatestResult>,
  getEpisodeScriptVersion: (
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<EpisodeScriptVersionResult> =>
    ipcRenderer.invoke(
      "episode-script:version",
      projectId,
      episodeId,
      versionId,
    ) as Promise<EpisodeScriptVersionResult>,
  createEpisodeScriptVersion: (
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: CreateEpisodeScriptVersionRequest,
  ): Promise<EpisodeScriptCreateResult> =>
    ipcRenderer.invoke(
      "episode-script:create-version",
      projectId,
      episodeId,
      idempotencyKey,
      payload,
    ) as Promise<EpisodeScriptCreateResult>,
  getEpisodeScriptConfirmation: (
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeScriptConfirmationReadResult> =>
    ipcRenderer.invoke(
      "episode-script-confirmation:current",
      projectId,
      episodeId,
    ) as Promise<EpisodeScriptConfirmationReadResult>,
  createEpisodeScriptConfirmation: (
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: CreateEpisodeScriptConfirmationRequest,
  ): Promise<EpisodeScriptConfirmationCreateResult> =>
    ipcRenderer.invoke(
      "episode-script-confirmation:create",
      projectId,
      episodeId,
      idempotencyKey,
      payload,
    ) as Promise<EpisodeScriptConfirmationCreateResult>,
  getEpisodeScriptConfirmationReceipt: (
    projectId: string,
    episodeId: string,
    confirmationId: string,
  ): Promise<EpisodeScriptConfirmationReadResult> =>
    ipcRenderer.invoke(
      "episode-script-confirmation:receipt",
      projectId,
      episodeId,
      confirmationId,
    ) as Promise<EpisodeScriptConfirmationReadResult>,
  getSourceProposalAcceptanceForVersion: (
    projectId: string,
    versionId: string,
  ): Promise<SourceProposalAcceptanceResult> =>
    ipcRenderer.invoke(
      "source-extraction:proposal-acceptance",
      projectId,
      versionId,
    ) as Promise<SourceProposalAcceptanceResult>,
  createProviderConnection: (
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionResponse> =>
    ipcRenderer.invoke("providers:create", input) as Promise<ProviderConnectionResponse>,
  deleteProviderConnection: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke("providers:delete", connectionId) as Promise<void>,
});
