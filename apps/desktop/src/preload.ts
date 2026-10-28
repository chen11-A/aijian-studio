import type {
  LocalMediaReviewGateway,
  LOCAL_MEDIA_REVIEW_CHANNELS as SharedLocalReviewChannels,
} from "@aijian/contracts/local-media-review";
import type {
  AssemblyReadinessTarget,
  AssemblyReadinessResult,
} from "@aijian/contracts/assembly-readiness";
import type {
  AssemblyExactGateway,
  ASSEMBLY_EXACT_CHANNELS as SharedAssemblyExactChannels,
} from "@aijian/contracts/assembly-exact";
import type {
  ManualMediaCandidateGateway,
  MANUAL_MEDIA_CANDIDATE_CHANNELS as SharedManualCandidateChannels,
} from "@aijian/contracts/manual-media-candidate";
import type {
  MediaPreparationGateway,
  MEDIA_PREPARATION_CHANNELS as SharedPreparationChannels,
} from "@aijian/contracts/media-preparation";
import type {
  ScriptImpactGateway,
  IMPACT_CHANNELS as SharedImpactChannels,
} from "@aijian/contracts/script-confirmation-impact";
import type { ProjectSettingsGateway } from "@aijian/contracts/project-settings";
import type { NativePreviewPlanResult } from "@aijian/contracts/native-preview-plan";
import type {
  OpenMediaPreviewCommand,
  MediaPreviewMutation,
  SeekMediaPreviewCommand,
  MediaPreviewStatusQuery,
  MediaPreviewResult,
} from "./media-preview-session-contract";
import type {
  AudioAssetProbeReadResult,
  AudioAssetProbeWriteResult,
} from "./audio-asset-probe-contract";
import type {
  InvalidationConsumerIdentity,
  InvalidationConsumerResponse,
} from "@aijian/contracts/invalidation-consumer";
import type { VisualGateway, VisualHistoryGateway } from "@aijian/contracts/visual-bible";
import type { OfficialDirectorBridge } from "@aijian/contracts/official-director";
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
import type {
  CreateDraftReviewRevisionPlanRequest,
  ApproveDraftReviewRevisionPlanRequest,
  AttachDraftReviewRevisionCandidateRequest,
  RecheckDraftReviewRevisionCandidateRequest,
  DraftReviewRevisionResult,
  DraftReviewRevisionScopeResult,
} from "./draft-review-revision-contract";
import type { OfficialTextBridge } from "@aijian/contracts/official-text";
import type { AssistantChatBridge } from "@aijian/contracts/official-text";
import type { ChatGPTBridge } from "@aijian/contracts/chatgpt-auth";
import type { GrokLoginBridge } from "@aijian/contracts/grok-auth";
import type { StoryFilmCreateInput } from "./story-film-client";
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
  EpisodeScriptWriteOperationResult,
  CreateEpisodeScriptConfirmationRequest,
  EpisodeScriptConfirmationCreateResult,
  EpisodeScriptConfirmationReadResult,
  SourceProposalAcceptanceResult,
} from "./api-client";
import type { SourceManifestReviewOperationResult } from "./source-manifest-review";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  InvalidationOperationPageQuery,
  InvalidationOperationPageResponse,
} from "@aijian/contracts/invalidation-operation";

// Sandbox preload is emitted by tsc without bundling. Only Electron may be a
// runtime import; these fixed literals are checked against the shared channels.
const LOCAL_MEDIA_REVIEW_CHANNELS: typeof SharedLocalReviewChannels = {
  target: "local-media-review:target",
  list: "local-media-review:list",
  get: "local-media-review:get",
  status: "local-media-review:status",
  save: "local-media-review:save",
  original: "local-media-review:original",
};
const ASSEMBLY_EXACT_CHANNELS: typeof SharedAssemblyExactChannels = {
  save: "assembly-exact:save",
  original: "assembly-exact:original",
};
const MANUAL_MEDIA_CANDIDATE_CHANNELS: typeof SharedManualCandidateChannels = {
  list: "manual-media-candidate:list",
  get: "manual-media-candidate:get",
  save: "manual-media-candidate:save",
  original: "manual-media-candidate:original",
};
const MEDIA_PREPARATION_CHANNELS: typeof SharedPreparationChannels = {
  list: "media-preparation:list",
  get: "media-preparation:get",
  save: "media-preparation:save",
  original: "media-preparation:original",
};
const IMPACT_CHANNELS: typeof SharedImpactChannels = {
  list: "script-confirmation-impact:list",
  detail: "script-confirmation-impact:detail",
  operation: "script-confirmation-impact:original-operation",
};
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
// Sandbox preload permits Electron only; keep fixed invokes inline, checked against IPC contracts.
const SETTINGS_CHANNELS = {
  read: "aivora:project-settings:read",
  receipt: "aivora:project-settings:receipt",
  write: "aivora:project-settings:write",
} as const;
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

contextBridge.exposeInMainWorld("aijianGrok", {
  status: () => ipcRenderer.invoke("grok-auth:status"),
  signIn: () => ipcRenderer.invoke("grok-auth:sign-in"),
  cancel: () => ipcRenderer.invoke("grok-auth:cancel"),
  signOut: () => ipcRenderer.invoke("grok-auth:sign-out"),
  models: () => ipcRenderer.invoke("grok-auth:models"),
  completeText: (input) => ipcRenderer.invoke("grok-auth:text", input),
  speak: (input) => ipcRenderer.invoke("grok-auth:speech", input),
  recordAgent: (input) => ipcRenderer.invoke("grok-auth:agent-log", input),
} satisfies GrokLoginBridge);

contextBridge.exposeInMainWorld("aijianAssistantChat", {
  preview: (request) => ipcRenderer.invoke("assistant-chat:preview", request),
  send: (request) => ipcRenderer.invoke("assistant-chat:send", request),
  discardPreview: (previewId) => ipcRenderer.invoke("assistant-chat:discard-preview", previewId),
  getOperation: (query) => ipcRenderer.invoke("assistant-chat:get-operation", query),
  listPending: (query) => ipcRenderer.invoke("assistant-chat:list-pending", query),
} satisfies AssistantChatBridge);

// Trusted proposal surface. There is deliberately no renderer completion/reservation endpoint.
contextBridge.exposeInMainWorld("aijianOfficialText", {
  list: (project, episode) => ipcRenderer.invoke("official-text:list", project, episode),
  get: (project, episode, operation) =>
    ipcRenderer.invoke("official-text:get", project, episode, operation),
  generate: (command) => ipcRenderer.invoke("official-text:generate", command),
  adopt: (project, episode, operation, input) =>
    ipcRenderer.invoke("official-text:adopt", project, episode, operation, input),
} satisfies OfficialTextBridge);

// AI director requests and human decisions only. Trusted prompts/completions stay in main.
contextBridge.exposeInMainWorld("aijianOfficialDirector", {
  list: (project, episode) => ipcRenderer.invoke("official-director:list", project, episode),
  get: (project, episode, operation) =>
    ipcRenderer.invoke("official-director:get", project, episode, operation),
  generate: (command) => ipcRenderer.invoke("official-director:generate", command),
  adopt: (project, episode, operation, input) =>
    ipcRenderer.invoke("official-director:adopt", project, episode, operation, input),
  reject: (project, episode, operation, input) =>
    ipcRenderer.invoke("official-director:reject", project, episode, operation, input),
} satisfies OfficialDirectorBridge);

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
  getAudioAssetProbeEvidence: (
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeReadResult> =>
    ipcRenderer.invoke(
      "audio-asset-probe:get",
      projectId,
      assetId,
      versionId,
    ) as Promise<AudioAssetProbeReadResult>,
  probeSelectedAudioAssetVersion: (
    projectId: string,
    assetId: string,
    versionId: string,
  ): Promise<AudioAssetProbeWriteResult> =>
    ipcRenderer.invoke(
      "audio-asset-probe:probe-selected",
      projectId,
      assetId,
      versionId,
    ) as Promise<AudioAssetProbeWriteResult>,
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
  getVisualReviewState: (p: string, v: string): ReturnType<VisualGateway["getVisualReviewState"]> =>
    ipcRenderer.invoke("visual-bible:review-state", p, v) as ReturnType<
      VisualGateway["getVisualReviewState"]
    >,
  getVisualBible: (p: string): ReturnType<VisualGateway["getVisualBible"]> =>
    ipcRenderer.invoke("visual-bible:index", p) as ReturnType<VisualGateway["getVisualBible"]>,
  listVisualBibleVersions: (
    p: string,
    cursor: string | null,
  ): ReturnType<VisualHistoryGateway["listVisualBibleVersions"]> =>
    ipcRenderer.invoke("visual-bible:history", p, cursor) as ReturnType<
      VisualHistoryGateway["listVisualBibleVersions"]
    >,
  getVisualBibleVersion: (
    p: string,
    v: string,
  ): ReturnType<VisualGateway["getVisualBibleVersion"]> =>
    ipcRenderer.invoke("visual-bible:version", p, v) as ReturnType<
      VisualGateway["getVisualBibleVersion"]
    >,
  getVisualBibleReadiness: (
    p: string,
    v: string,
  ): ReturnType<VisualGateway["getVisualBibleReadiness"]> =>
    ipcRenderer.invoke("visual-bible:readiness", p, v) as ReturnType<
      VisualGateway["getVisualBibleReadiness"]
    >,
  getVisualBibleAuthority: (
    p: string,
    v: string,
  ): ReturnType<VisualGateway["getVisualBibleAuthority"]> =>
    ipcRenderer.invoke("visual-bible:authority", p, v) as ReturnType<
      VisualGateway["getVisualBibleAuthority"]
    >,
  readVisualReviewOperation: (
    p: string,
    v: string,
    c: string,
  ): ReturnType<VisualGateway["readVisualReviewOperation"]> =>
    ipcRenderer.invoke("visual-bible:review-operation", p, v, c) as ReturnType<
      VisualGateway["readVisualReviewOperation"]
    >,
  getVisualInspectionOperation: (
    p: string,
    op: string,
  ): ReturnType<VisualGateway["getVisualInspectionOperation"]> =>
    ipcRenderer.invoke("visual-bible:inspection-operation", p, op) as ReturnType<
      VisualGateway["getVisualInspectionOperation"]
    >,
  saveVisualBible: (
    p: string,
    key: string,
    payload: Parameters<VisualGateway["saveVisualBible"]>[2],
  ): ReturnType<VisualGateway["saveVisualBible"]> =>
    ipcRenderer.invoke("visual-bible:save", p, key, payload) as ReturnType<
      VisualGateway["saveVisualBible"]
    >,
  getVisualSaveOperation: (
    p: string,
    key: string,
    payload: Parameters<VisualGateway["getVisualSaveOperation"]>[2],
  ): ReturnType<VisualGateway["getVisualSaveOperation"]> =>
    ipcRenderer.invoke("visual-bible:save-operation", p, key, payload) as ReturnType<
      VisualGateway["getVisualSaveOperation"]
    >,
  prepareVisualReview: (
    identity: Parameters<VisualGateway["prepareVisualReview"]>[0],
    input: Parameters<VisualGateway["prepareVisualReview"]>[1],
  ): ReturnType<VisualGateway["prepareVisualReview"]> =>
    ipcRenderer.invoke("visual-bible:prepare", identity, input) as ReturnType<
      VisualGateway["prepareVisualReview"]
    >,
  confirmVisualReview: (
    ticket: Parameters<VisualGateway["confirmVisualReview"]>[0],
  ): ReturnType<VisualGateway["confirmVisualReview"]> =>
    ipcRenderer.invoke("visual-bible:confirm", ticket) as ReturnType<
      VisualGateway["confirmVisualReview"]
    >,
  inspectVisualReference: (
    p: string,
    a: string,
    v: string,
    hash: string,
    op: string,
  ): ReturnType<VisualGateway["inspectVisualReference"]> =>
    ipcRenderer.invoke("visual-bible:inspect", p, a, v, hash, op) as ReturnType<
      VisualGateway["inspectVisualReference"]
    >,
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
  getStoryFilmPlan: (projectId: string) => ipcRenderer.invoke("story-film:plan", projectId),
  createStoryFilm: (projectId: string, input: StoryFilmCreateInput) =>
    ipcRenderer.invoke("story-film:create", projectId, input),
  getStoryFilmProgress: (projectId: string) => ipcRenderer.invoke("story-film:progress", projectId),
  cancelStoryFilm: (projectId: string) => ipcRenderer.invoke("story-film:cancel", projectId),
  readStoryFilmMedia: (path: string) =>
    ipcRenderer.invoke("story-film:read", path) as Promise<Uint8Array>,
  revealStoryFilm: (path: string) =>
    ipcRenderer.invoke("story-film:reveal", path) as Promise<{ ok: boolean }>,
  exportStoryFilm: (path: string) =>
    ipcRenderer.invoke("story-film:export", path) as Promise<{ ok: boolean; cancelled?: boolean }>,
  listFilmSeries: () => ipcRenderer.invoke("film:list-series"),
  listFilmEpisodes: (seriesId: string) => ipcRenderer.invoke("film:list-episodes", seriesId),
  readFilmProject: (id: string) => ipcRenderer.invoke("film:read", id),
  writeFilmProject: (film: unknown) => ipcRenderer.invoke("film:write", film),
  deleteFilmProject: (id: string) => ipcRenderer.invoke("film:delete", id),
  renameFilmSeries: (seriesId: string, title: string) =>
    ipcRenderer.invoke("film:rename", seriesId, title),
  readFilmMedia: (path: string) =>
    ipcRenderer.invoke("film:read-media", path) as Promise<Uint8Array>,
  assembleFilm: (seriesId: string, sources: string[], musicPath = "", duck = false) =>
    ipcRenderer.invoke("film:assemble", seriesId, sources, musicPath, duck),
  importMusic: (seriesId: string, source: string) =>
    ipcRenderer.invoke("film:import-music", seriesId, source) as Promise<{ path: string }>,
  filePath: (file: File) => webUtils.getPathForFile(file),
  flushed: () => ipcRenderer.send("film:flushed"),
  onFlush: (handler: () => void) => {
    ipcRenderer.on("aivora:flush", () => handler());
  },
  generateFilmStill: (seriesId: string, prompt: string) =>
    ipcRenderer.invoke("film:still", seriesId, prompt),
  pickFilmFolder: () => ipcRenderer.invoke("film:pick-folder") as Promise<string | null>,
  defaultFilmFolder: () => ipcRenderer.invoke("film:default-folder") as Promise<string>,
  exportFilmCut: (source: string, directory: string, name?: string) =>
    ipcRenderer.invoke("film:export", source, directory, name),
  revealFilmPath: (path: string) => ipcRenderer.invoke("film:reveal", path),
  openFilmPath: (path: string) => ipcRenderer.invoke("film:open", path),
  getProject: (projectId: string): Promise<ProjectResponse> =>
    ipcRenderer.invoke("projects:get", projectId) as Promise<ProjectResponse>,
  getProjectSettings: ((projectId) =>
    ipcRenderer.invoke(
      SETTINGS_CHANNELS.read,
      projectId,
    )) as ProjectSettingsGateway["getProjectSettings"],
  getProjectSettingsReceipt: ((projectId, operationId) =>
    ipcRenderer.invoke(
      SETTINGS_CHANNELS.receipt,
      projectId,
      operationId,
    )) as ProjectSettingsGateway["getProjectSettingsReceipt"],
  updateProjectSettings: ((projectId, command) =>
    ipcRenderer.invoke(
      SETTINGS_CHANNELS.write,
      projectId,
      command,
    )) as ProjectSettingsGateway["updateProjectSettings"],
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
  inspectInvalidationConsumer: (
    identity: InvalidationConsumerIdentity,
  ): Promise<InvalidationConsumerResponse> =>
    ipcRenderer.invoke(
      "invalidation-operations:inspect-consumer",
      identity,
    ) as Promise<InvalidationConsumerResponse>,
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
  listDraftReviewRevisionPlans: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftReviewRevisionResult> =>
    ipcRenderer.invoke(
      "draft-review-revision:list",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftReviewRevisionResult>,
  getDraftReviewRevisionScope: (
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftReviewRevisionScopeResult> =>
    ipcRenderer.invoke(
      "draft-review-revision:scope",
      projectId,
      episodeId,
      operationId,
    ) as Promise<DraftReviewRevisionScopeResult>,
  createDraftReviewRevisionPlan: (
    projectId: string,
    episodeId: string,
    operationId: string,
    command: CreateDraftReviewRevisionPlanRequest,
  ): Promise<DraftReviewRevisionResult> =>
    ipcRenderer.invoke(
      "draft-review-revision:create-plan",
      projectId,
      episodeId,
      operationId,
      command,
    ) as Promise<DraftReviewRevisionResult>,
  approveDraftReviewRevisionPlan: (
    projectId: string,
    episodeId: string,
    operationId: string,
    planId: string,
    command: ApproveDraftReviewRevisionPlanRequest,
  ): Promise<DraftReviewRevisionResult> =>
    ipcRenderer.invoke(
      "draft-review-revision:approve-plan",
      projectId,
      episodeId,
      operationId,
      planId,
      command,
    ) as Promise<DraftReviewRevisionResult>,
  attachDraftReviewRevisionCandidate: (
    projectId: string,
    episodeId: string,
    operationId: string,
    planId: string,
    command: AttachDraftReviewRevisionCandidateRequest,
  ): Promise<DraftReviewRevisionResult> =>
    ipcRenderer.invoke(
      "draft-review-revision:attach-candidate",
      projectId,
      episodeId,
      operationId,
      planId,
      command,
    ) as Promise<DraftReviewRevisionResult>,
  recheckDraftReviewRevisionCandidate: (
    projectId: string,
    episodeId: string,
    operationId: string,
    planId: string,
    candidateId: string,
    command: RecheckDraftReviewRevisionCandidateRequest,
  ): Promise<DraftReviewRevisionResult> =>
    ipcRenderer.invoke(
      "draft-review-revision:recheck-candidate",
      projectId,
      episodeId,
      operationId,
      planId,
      candidateId,
      command,
    ) as Promise<DraftReviewRevisionResult>,
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
  getLocalMediaReviewTarget: ((p, e, q) =>
    ipcRenderer.invoke(
      LOCAL_MEDIA_REVIEW_CHANNELS.target,
      p,
      e,
      q,
    )) as LocalMediaReviewGateway["getLocalMediaReviewTarget"],
  listLocalMediaReviews: ((p, e, cursor) =>
    ipcRenderer.invoke(
      LOCAL_MEDIA_REVIEW_CHANNELS.list,
      p,
      e,
      cursor,
    )) as LocalMediaReviewGateway["listLocalMediaReviews"],
  getLocalMediaReview: ((p, e, id) =>
    ipcRenderer.invoke(
      LOCAL_MEDIA_REVIEW_CHANNELS.get,
      p,
      e,
      id,
    )) as LocalMediaReviewGateway["getLocalMediaReview"],
  getLocalMediaReviewStatus: ((p, e, q) =>
    ipcRenderer.invoke(
      LOCAL_MEDIA_REVIEW_CHANNELS.status,
      p,
      e,
      q,
    )) as LocalMediaReviewGateway["getLocalMediaReviewStatus"],
  saveLocalMediaReview: ((p, e, c) =>
    ipcRenderer.invoke(
      LOCAL_MEDIA_REVIEW_CHANNELS.save,
      p,
      e,
      c,
    )) as LocalMediaReviewGateway["saveLocalMediaReview"],
  getLocalMediaReviewOperation: ((p, e, c) =>
    ipcRenderer.invoke(
      LOCAL_MEDIA_REVIEW_CHANNELS.original,
      p,
      e,
      c,
    )) as LocalMediaReviewGateway["getLocalMediaReviewOperation"],
  getEpisodeAssemblyReadiness: (
    projectId: string,
    episodeId: string,
    target: AssemblyReadinessTarget,
  ): Promise<AssemblyReadinessResult> =>
    ipcRenderer.invoke(
      "episode-assembly-readiness:read",
      projectId,
      episodeId,
      target,
    ) as Promise<AssemblyReadinessResult>,
  readLatestEpisodeMediaAssembly: (
    projectId: string,
    episodeId: string,
  ): Promise<EpisodeMediaAssemblyResult> =>
    ipcRenderer.invoke(
      "episode-media-assembly:latest",
      projectId,
      episodeId,
    ) as Promise<EpisodeMediaAssemblyResult>,
  getNativeMediaPreviewPlan: (
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<NativePreviewPlanResult> =>
    ipcRenderer.invoke(
      "media-preview:plan",
      projectId,
      episodeId,
      versionId,
    ) as Promise<NativePreviewPlanResult>,
  openMediaPreviewSession: (command: OpenMediaPreviewCommand): Promise<MediaPreviewResult> =>
    ipcRenderer.invoke("media-preview:open", command) as Promise<MediaPreviewResult>,
  playMediaPreviewSession: (command: MediaPreviewMutation): Promise<MediaPreviewResult> =>
    ipcRenderer.invoke("media-preview:play", command) as Promise<MediaPreviewResult>,
  pauseMediaPreviewSession: (command: MediaPreviewMutation): Promise<MediaPreviewResult> =>
    ipcRenderer.invoke("media-preview:pause", command) as Promise<MediaPreviewResult>,
  seekMediaPreviewSession: (command: SeekMediaPreviewCommand): Promise<MediaPreviewResult> =>
    ipcRenderer.invoke("media-preview:seek", command) as Promise<MediaPreviewResult>,
  readMediaPreviewSessionStatus: (query: MediaPreviewStatusQuery): Promise<MediaPreviewResult> =>
    ipcRenderer.invoke("media-preview:status", query) as Promise<MediaPreviewResult>,
  closeMediaPreviewSession: (command: MediaPreviewMutation): Promise<MediaPreviewResult> =>
    ipcRenderer.invoke("media-preview:close", command) as Promise<MediaPreviewResult>,
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
  getEpisodeScriptWriteOperation: (
    projectId: string,
    episodeId: string,
    operationId: string,
    payload: CreateEpisodeScriptVersionRequest,
  ): Promise<EpisodeScriptWriteOperationResult> =>
    ipcRenderer.invoke(
      "episode-script:original-write",
      projectId,
      episodeId,
      operationId,
      payload,
    ) as Promise<EpisodeScriptWriteOperationResult>,
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
  listMediaPreparations: ((p, e, cursor) =>
    ipcRenderer.invoke(
      MEDIA_PREPARATION_CHANNELS.list,
      p,
      e,
      cursor,
    )) as MediaPreparationGateway["listMediaPreparations"],
  getMediaPreparation: ((p, e, id) =>
    ipcRenderer.invoke(
      MEDIA_PREPARATION_CHANNELS.get,
      p,
      e,
      id,
    )) as MediaPreparationGateway["getMediaPreparation"],
  saveMediaPreparation: ((p, e, c) =>
    ipcRenderer.invoke(
      MEDIA_PREPARATION_CHANNELS.save,
      p,
      e,
      c,
    )) as MediaPreparationGateway["saveMediaPreparation"],
  getMediaPreparationOperation: ((p, e, c) =>
    ipcRenderer.invoke(
      MEDIA_PREPARATION_CHANNELS.original,
      p,
      e,
      c,
    )) as MediaPreparationGateway["getMediaPreparationOperation"],
  listManualMediaCandidates: ((p, e, cursor) =>
    ipcRenderer.invoke(
      MANUAL_MEDIA_CANDIDATE_CHANNELS.list,
      p,
      e,
      cursor,
    )) as ManualMediaCandidateGateway["listManualMediaCandidates"],
  getManualMediaCandidate: ((p, e, id) =>
    ipcRenderer.invoke(
      MANUAL_MEDIA_CANDIDATE_CHANNELS.get,
      p,
      e,
      id,
    )) as ManualMediaCandidateGateway["getManualMediaCandidate"],
  saveManualMediaCandidate: ((p, e, c) =>
    ipcRenderer.invoke(
      MANUAL_MEDIA_CANDIDATE_CHANNELS.save,
      p,
      e,
      c,
    )) as ManualMediaCandidateGateway["saveManualMediaCandidate"],
  getManualMediaCandidateOperation: ((p, e, c) =>
    ipcRenderer.invoke(
      MANUAL_MEDIA_CANDIDATE_CHANNELS.original,
      p,
      e,
      c,
    )) as ManualMediaCandidateGateway["getManualMediaCandidateOperation"],
  saveExact: ((p, e, c) =>
    ipcRenderer.invoke(ASSEMBLY_EXACT_CHANNELS.save, p, e, c)) as AssemblyExactGateway["saveExact"],
  getOriginal: ((p, e, c) =>
    ipcRenderer.invoke(
      ASSEMBLY_EXACT_CHANNELS.original,
      p,
      e,
      c,
    )) as AssemblyExactGateway["getOriginal"],

  listScriptConfirmationImpacts: ((projectId, cursor) =>
    ipcRenderer.invoke(
      IMPACT_CHANNELS.list,
      projectId,
      cursor,
    )) as ScriptImpactGateway["listScriptConfirmationImpacts"],
  getScriptConfirmationImpact: ((projectId, reportId) =>
    ipcRenderer.invoke(
      IMPACT_CHANNELS.detail,
      projectId,
      reportId,
    )) as ScriptImpactGateway["getScriptConfirmationImpact"],
  getEpisodeScriptConfirmationOperation: ((projectId, episodeId, operationId, payload) =>
    ipcRenderer.invoke(
      IMPACT_CHANNELS.operation,
      projectId,
      episodeId,
      operationId,
      payload,
    )) as ScriptImpactGateway["getEpisodeScriptConfirmationOperation"],
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
