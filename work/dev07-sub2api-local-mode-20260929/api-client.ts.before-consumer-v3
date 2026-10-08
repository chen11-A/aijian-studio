import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";

import type { components } from "@aijian/contracts";
import {
  isInvalidationOperationPageResponse,
  isInvalidationOperationResponse,
  validateInvalidationOperationPageQuery,
  type InvalidationOperationPageQuery,
  type InvalidationOperationPageResponse,
  type InvalidationOperationResponse,
} from "@aijian/contracts/invalidation-operation";

import {
  isArtifactProposalDecisionKey,
  isArtifactProposalDraftAcceptanceInput,
  isArtifactProposalDraftAcceptanceResponse,
  isArtifactProposalRejectionInput,
  isArtifactProposalRejectionResponse,
  isArtifactProposalResponse,
  type ArtifactProposalDecisionResult,
  type ArtifactProposalDraftAcceptanceInput,
  type ArtifactProposalDraftAcceptanceResponse,
  type ArtifactProposalRejectionInput,
  type ArtifactProposalRejectionResponse,
  type ArtifactProposalResponse,
} from "./artifact-proposal-contract";
import {
  appPreferencesDefiniteError,
  isAppPreferencesResponse,
  isSaveAppPreferencesCommand,
  type AppPreferencesReadResult,
  type AppPreferencesSaveResult,
  type SaveAppPreferencesCommand,
} from "./app-preferences-contract";
import {
  isAddMediaAssetReferenceCommand,
  isMediaAssetId,
  isMediaAssetListResponse,
  isMediaAssetResponse,
  isMediaAssetVersionId,
  isMediaProjectId,
  isRemoveMediaAssetReferenceCommand,
  mediaAssetDefiniteError,
  type AddMediaAssetReferenceCommand,
  type MediaAssetDeleteResult,
  type MediaAssetImportResult,
  type MediaAssetListResult,
  type MediaAssetPreviewResult,
  type MediaAssetReadResult,
  type MediaAssetReferenceResult,
  type MediaAssetUnreferenceResult,
  type RemoveMediaAssetReferenceCommand,
} from "./media-asset-contract";
import {
  isSub2APIConfiguredReadinessResponse,
  isSub2APIConnectionId,
  isSub2APIModelId,
  sub2APIReadinessDefiniteError,
  type Sub2APIConfiguredReadinessResult,
} from "./sub2api-configured-readiness-contract";
import {
  isEditSub2APIMetadataCommand,
  isRotateSub2APIKeyCommand,
  isSub2APIMetadataReceipt,
  isSub2APIKeyRotationReceipt,
  isSub2APIRotationOperationId,
  isSub2APIRotationOperationResponse,
  sub2APIMutationDefiniteError,
  sub2APIRotationReadDefiniteError,
  type EditSub2APIMetadataCommand,
  type RotateSub2APIKeyCommand,
  type Sub2APIConnectionMutationResult,
  type Sub2APIRotationReadResult,
} from "./sub2api-connection-mutation-contract";
import {
  episodeScriptDefiniteError,
  isCreateEpisodeScriptVersionRequest,
  isEpisodeScriptEpisodeId,
  isEpisodeScriptIdempotencyKey,
  isEpisodeScriptProjectId,
  isEpisodeScriptVersionCreatedResponse,
  isEpisodeScriptVersionId,
  isEpisodeScriptVersionResponse,
  type CreateEpisodeScriptVersionRequest,
  type EpisodeScriptCreateResult,
  type EpisodeScriptLatestResult,
  type EpisodeScriptVersionResult,
} from "./episode-script-contract";
import {
  episodeScriptConfirmationDefiniteError,
  isCreateEpisodeScriptConfirmationRequest,
  isEpisodeScriptConfirmationCreatedResponse,
  isEpisodeScriptConfirmationId,
  isEpisodeScriptConfirmationStatusResponse,
  type CreateEpisodeScriptConfirmationRequest,
  type EpisodeScriptConfirmationCreateResult,
  type EpisodeScriptConfirmationReadResult,
} from "./episode-script-confirmation-contract";
import {
  isSourceProposalAcceptanceProjectId,
  isSourceProposalAcceptanceResponse,
  isSourceProposalAcceptanceVersionId,
  sourceProposalAcceptanceDefiniteError,
  type SourceProposalAcceptanceResult,
} from "./source-proposal-acceptance-contract";
import {
  isAgentCatalogResponse,
  isSkillCatalogResponse,
  type AgentCatalogResponse,
  type SkillCatalogResponse,
} from "./agent-skill-catalog-contract";
import {
  hasControlCharacter,
  hasOnlyKeys,
  hasRequestId,
  isIdArray,
  isNullableId,
  isRecord,
  isStringArray,
} from "./api-contract-guards";
import {
  isEpisodeCreateErrorResponse,
  isEpisodeId,
  isEpisodeListResponse,
  isEpisodeProjectId,
  isEpisodeResponse,
  normalizeEpisodeCreateInput,
  validateEpisodeListQuery,
  type CreateEpisodeInput,
  type EpisodeCreateResult,
  type EpisodeListQuery,
  type EpisodeListResponse,
  type EpisodeResponse,
} from "./episode-contract";
import { isHealthResponse, type HealthResponse } from "./health-contract";
import {
  isProjectUpdateId,
  isProjectUpdateReceipt,
  normalizeProjectUpdateCommand,
  projectUpdateDefiniteError,
  type ProjectUpdateCommand,
  type ProjectUpdateResult,
} from "./project-update-contract";
import {
  isCreateProviderConnectionInput,
  isProviderConnectionId,
  isProviderConnectionListResponse,
  isProviderConnectionResponse,
  isSub2APIOriginMode,
  type CreateProviderConnectionInput,
  type ProviderConnectionListResponse,
  type ProviderConnectionResponse,
} from "./provider-connection-contract";
import {
  isFakeTimelineRunCreateCommand,
  isFakeTimelineRunOperationResponse,
  isFakeTimelineRunResponse,
  fakeTimelineRunIdempotencyKey,
  type FakeTimelineRunCreateCommand,
  type FakeTimelineRunCreateResult,
  type FakeTimelineRunOperationQueryResult,
} from "./fake-timeline-run-contract";
import {
  isCreatedProposalRunResponse,
  isProposalRunCreateCommand,
  proposalRunIdempotencyKey,
  type ProposalRunCreateCommand,
  type ProposalRunCreateResult,
} from "./proposal-run-contract";
import {
  isRemoteSourceExtractCreateCommand,
  isRemoteSourceExtractCreatedResponse,
  isRemoteSourceExtractOriginalRunResponse,
  isSourceExtractionResponse,
  isSourceExtractionVersionId,
  remoteSourceExtractIdempotencyKey,
  remoteSourceExtractRunId,
  type RemoteSourceExtractCreateCommand,
  type RemoteSourceExtractCreateResult,
  type RemoteSourceExtractOriginalRunResult,
  type SourceExtractionReadResult,
} from "./remote-source-extract-contract";
import {
  classifyVersionedSourceExtractionProposal,
  isSub2APIApprovalCommand,
  isSub2APIApprovalResponse,
  isSub2APIOperationResponse,
  isSub2APIProjectId,
  isSub2APIQueueCommand,
  isSub2APIQueueReceipt,
  isVersionedProposalNotFound,
  isVersionedSourceExtractionProposalId,
  sub2APIApprovalIdempotencyKey,
  sub2APIDefiniteError,
  sub2APIQueueIdempotencyKey,
  sub2APIRunId,
  type Sub2APIApprovalCommand,
  type Sub2APIApprovalReadResult,
  type Sub2APIApprovalResult,
  type Sub2APIOperationReadResult,
  type Sub2APIQueueCommand,
  type Sub2APIQueueResult,
  type VersionedSourceExtractionProposalReadResult,
} from "./remote-source-extract-v2-contract";
import {
  isProductionBriefCreateCommand,
  isProductionBriefLatestResponse,
  isProductionBriefResponse,
  normalizeProductionBriefCreateCommand,
  productionBriefSafeError,
  productionBriefIdempotencyKey,
  type ProductionBriefCreateCommand,
  type ProductionBriefCreateResult,
  type NormalizedProductionBriefCreateCommand,
} from "./production-brief-contract";
import type { SidecarSession } from "./sidecar-protocol";
import { canonicalLoopbackOrigin } from "./sidecar-origin";
import type { components as ReviewComponents } from "./source-manifest-review.generated";
import { isTaskQueueResponse, type TaskQueueResponse } from "./task-queue-contract";
import {
  isReorderTimelineClipInput,
  isReplaceTimelineClipInput,
  isTimelineResponse,
  isTrimTimelineClipInput,
  type ReorderTimelineClipInput,
  type ReplaceTimelineClipInput,
  type TimelineResponse,
  type TrimTimelineClipInput,
} from "./timeline-contract";
import {
  isDevelopmentExportCreateInput,
  isDevelopmentExportNoClaimDetails,
  isDevelopmentExportResponse,
  isDevelopmentExportIdentity,
  type DevelopmentExportCreateInput,
  type DevelopmentExportCreateResult,
  type DevelopmentExportDefiniteRejection,
  type DevelopmentExportResponse,
} from "./development-export-contract";

export type {
  CreateProviderConnectionInput,
  ProviderConnectionListResponse,
  ProviderConnectionResponse,
} from "./provider-connection-contract";
export type {
  Sub2APIConfiguredReadinessResponse,
  Sub2APIConfiguredReadinessResult,
} from "./sub2api-configured-readiness-contract";
export type {
  EditSub2APIMetadataCommand,
  RotateSub2APIKeyCommand,
  Sub2APIConnectionMutationResult,
  Sub2APIRotationReadResult,
} from "./sub2api-connection-mutation-contract";
export type {
  CreateEpisodeScriptVersionRequest,
  EpisodeScriptCreateResult,
  EpisodeScriptLatestResult,
  EpisodeScriptVersionResult,
} from "./episode-script-contract";
export type {
  CreateEpisodeScriptConfirmationRequest,
  EpisodeScriptConfirmationCreateResult,
  EpisodeScriptConfirmationReadResult,
} from "./episode-script-confirmation-contract";
export type { SourceProposalAcceptanceResult } from "./source-proposal-acceptance-contract";
export type { AgentCatalogResponse, SkillCatalogResponse } from "./agent-skill-catalog-contract";
export type {
  AppPreferencesReadResult,
  AppPreferencesResponse,
  AppPreferencesSaveResult,
  SaveAppPreferencesCommand,
} from "./app-preferences-contract";
export type {
  AddMediaAssetReferenceCommand,
  MediaAssetDeleteResult,
  MediaAssetImportResult,
  MediaAssetListResult,
  MediaAssetPreviewResult,
  MediaAssetReadResult,
  MediaAssetReferenceResult,
  MediaAssetUnreferenceResult,
  RemoveMediaAssetReferenceCommand,
  MediaAssetResponse,
  MediaAssetListResponse,
} from "./media-asset-contract";
export type {
  ArtifactProposalDecisionResult,
  ArtifactProposalDraftAcceptanceInput,
  ArtifactProposalDraftAcceptanceResponse,
  ArtifactProposalRejectionInput,
  ArtifactProposalRejectionResponse,
  ArtifactProposalResponse,
} from "./artifact-proposal-contract";
export type { TaskQueueResponse } from "./task-queue-contract";
export type { ProjectUpdateCommand, ProjectUpdateResult } from "./project-update-contract";
export type {
  FakeTimelineRunCreateCommand,
  FakeTimelineRunCreateResult,
  FakeTimelineRunOperationQueryResult,
  FakeTimelineRunOperationResponse,
  FakeTimelineRunResponse,
} from "./fake-timeline-run-contract";
export type { ProposalRunCreateCommand, ProposalRunCreateResult } from "./proposal-run-contract";
export type {
  RemoteSourceExtractCreateCommand,
  RemoteSourceExtractCreateInput,
  RemoteSourceExtractCreateResult,
  RemoteSourceExtractOriginalRunResult,
  SourceExtractionReadResult,
  SourceExtractionResponse,
} from "./remote-source-extract-contract";
export type {
  Sub2APIApprovalCommand,
  Sub2APIApprovalReadResult,
  Sub2APIApprovalResponse,
  Sub2APIApprovalResult,
  Sub2APIOperationReadResult,
  Sub2APIOperationResponse,
  Sub2APIQueueCommand,
  Sub2APIQueueResult,
  Sub2APIQueueReceipt,
  SourceExtractionProposalV2,
  SourceExtractionProposalV2Response,
  UnknownRemoteCost,
  VersionedSourceExtractionProposalReadResult,
} from "./remote-source-extract-v2-contract";
export type {
  ProductionBriefCreateCommand,
  ProductionBriefCreateResult,
} from "./production-brief-contract";
export type ProductionBriefResponse = components["schemas"]["ProductionBriefResponse"];
export type {
  ReorderTimelineClipInput,
  ReplaceTimelineClipInput,
  TimelineResponse,
  TrimTimelineClipInput,
} from "./timeline-contract";
export type {
  CreateEpisodeInput,
  EpisodeCreateResult,
  EpisodeListQuery,
  EpisodeListResponse,
  EpisodeResponse,
} from "./episode-contract";
export type {
  DevelopmentExportCreateInput,
  DevelopmentExportCreateResult,
  DevelopmentExportDefiniteRejection,
  DevelopmentExportOpenResult,
  DevelopmentExportPreviewResult,
  DevelopmentExportSaveResult,
  DevelopmentExportOutput,
  DevelopmentExportRemoteUnknown,
  DevelopmentExportResponse,
} from "./development-export-contract";

export type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
export type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
export type ProjectListResponse = components["schemas"]["ProjectListResponse"];
export type ProjectResponse = components["schemas"]["ProjectResponse"];
export type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
export type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
export type SourceDocumentTextResponse = components["schemas"]["SourceDocumentTextResponse"];
export type SourceManifestResponse = components["schemas"]["SourceManifestResponse"];
export type StoryBibleIndexResponse = components["schemas"]["StoryBibleIndexResponse"];
export type StoryBibleVersionResponse = components["schemas"]["StoryBibleVersionResponse"];
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type SidecarApiSession = Pick<SidecarSession, "origin" | "token">;

export type SourceManifestReviewIdentity = {
  project_id: string;
  version_id: string;
  content_hash: string;
  expected_revision: number;
};

type ReviewSchemas = ReviewComponents["schemas"];
export type SourceManifestReviewReport = ReviewSchemas["GateReadinessReportData"] & { gate: "G1" };
export type SourceManifestPreparedReview = Omit<
  ReviewSchemas["PreparedReviewActionResponse"],
  "data"
> & {
  data: {
    report: SourceManifestReviewReport;
    challenge: ReviewSchemas["ConfirmationChallengeData"] & { gate: "G1" };
    confirmation_token: string;
  };
};
export type SourceManifestSubmissionReceipt = ReviewSchemas["ReviewSubmissionResponse"];
export type SourceManifestSignoffReceipt = ReviewSchemas["ReviewSignoffResponse"];
export type SourceManifestDecisionReceipt = ReviewSchemas["GateDecisionResponse"];
export type SourceManifestReviewTarget = SourceManifestReviewIdentity & {
  artifact_id: string;
  version_number: number;
  review_evidence_revision: number;
  review_version_id: string | null;
  review_submission_id: string | null;
  accepted_version_id: string | null;
};

export type SourceManifestReviewResult<T> =
  | { kind: "SUCCEEDED"; receipt: T }
  | { kind: "INVALID_INPUT" }
  | {
      kind: "DEFINITE_SERVER_ERROR";
      status: number;
      code: SourceManifestReviewErrorCode;
      request_id: string;
    }
  | { kind: "REMOTE_UNKNOWN" };

export type SourceManifestReviewErrorCode =
  | "SIDECAR_AUTH_REQUIRED"
  | "SIDECAR_REQUEST_REJECTED"
  | "PROJECT_NOT_FOUND"
  | "SOURCE_MANIFEST_NOT_FOUND"
  | "GATE_NOT_READY"
  | "REVIEW_INVALID"
  | "PRECONDITION_FAILED"
  | "VALIDATION_ERROR"
  | "PRECONDITION_REQUIRED";

/** Main-only source review boundary; never expose this client through preload. */
export interface SourceManifestReviewClient {
  getSourceManifestForReview(
    input: SourceManifestReviewIdentity,
  ): Promise<SourceManifestReviewResult<SourceManifestResponse>>;
  prepareSourceManifestSubmit(
    input: SourceManifestReviewTarget,
  ): Promise<SourceManifestReviewResult<SourceManifestPreparedReview>>;
  submitSourceManifestReview(
    input: SourceManifestReviewTarget,
    prepared: SourceManifestPreparedReview,
  ): Promise<SourceManifestReviewResult<SourceManifestSubmissionReceipt>>;
  prepareSourceManifestSignoff(
    input: SourceManifestReviewTarget,
  ): Promise<SourceManifestReviewResult<SourceManifestPreparedReview>>;
  signoffSourceManifestReview(
    input: SourceManifestReviewTarget,
    prepared: SourceManifestPreparedReview,
  ): Promise<SourceManifestReviewResult<SourceManifestSignoffReceipt>>;
  prepareSourceManifestDecision(
    input: SourceManifestReviewTarget,
    report: SourceManifestReviewReport,
    rationale: string,
  ): Promise<SourceManifestReviewResult<SourceManifestPreparedReview>>;
  decideSourceManifestReview(
    input: SourceManifestReviewTarget,
    prepared: SourceManifestPreparedReview,
    rationale: string,
  ): Promise<SourceManifestReviewResult<SourceManifestDecisionReceipt>>;
  copySourceManifestDraft(
    input: SourceManifestReviewTarget,
  ): Promise<SourceManifestReviewResult<SourceManifestResponse>>;
}

export interface LocalApiClient {
  getHealth(): Promise<HealthResponse>;
  listProjects(): Promise<ProjectListResponse>;
  createProject(input: CreateProjectInput): Promise<ProjectResponse>;
  getProject(projectId: string): Promise<ProjectResponse>;
  updateProject(projectId: string, command: ProjectUpdateCommand): Promise<ProjectUpdateResult>;
  listEpisodes(projectId: string, query?: EpisodeListQuery): Promise<EpisodeListResponse>;
  getEpisode(projectId: string, episodeId: string): Promise<EpisodeResponse>;
  createEpisode(projectId: string, input: CreateEpisodeInput): Promise<EpisodeCreateResult>;
  getEpisodeScript(projectId: string, episodeId: string): Promise<EpisodeScriptLatestResult>;
  getEpisodeScriptVersion(
    projectId: string, episodeId: string, versionId: string,
  ): Promise<EpisodeScriptVersionResult>;
  createEpisodeScriptVersion(
    projectId: string, episodeId: string, idempotencyKey: string,
    payload: CreateEpisodeScriptVersionRequest,
  ): Promise<EpisodeScriptCreateResult>;
  getEpisodeScriptConfirmation(
    projectId: string, episodeId: string,
  ): Promise<EpisodeScriptConfirmationReadResult>;
  createEpisodeScriptConfirmation(
    projectId: string, episodeId: string, idempotencyKey: string,
    payload: CreateEpisodeScriptConfirmationRequest,
  ): Promise<EpisodeScriptConfirmationCreateResult>;
  getEpisodeScriptConfirmationReceipt(
    projectId: string, episodeId: string, confirmationId: string,
  ): Promise<EpisodeScriptConfirmationReadResult>;
  getSourceProposalAcceptanceForVersion(
    projectId: string, versionId: string,
  ): Promise<SourceProposalAcceptanceResult>;
  listSources(projectId: string): Promise<SourceDocumentListResponse>;
  getSource(projectId: string, sourceId: string): Promise<SourceDocumentResponse>;
  getSourceText(projectId: string, sourceId: string): Promise<SourceDocumentTextResponse>;
  importTextSource(
    projectId: string,
    input: ImportTextSourceInput,
  ): Promise<SourceDocumentResponse>;
  getSourceManifest(projectId: string): Promise<SourceManifestResponse | null>;
  getStoryBibleIndex(projectId: string): Promise<StoryBibleIndexResponse | null>;
  getStoryBibleVersion(projectId: string, versionId: string): Promise<StoryBibleVersionResponse>;
  getProductionBrief(projectId: string): Promise<ProductionBriefResponse | null>;
  getProductionBriefVersion(projectId: string, versionId: string): Promise<ProductionBriefResponse>;
  createProductionBriefVersion(
    projectId: string,
    command: ProductionBriefCreateCommand,
  ): Promise<ProductionBriefCreateResult>;
  listProjectTasks(projectId: string): Promise<TaskQueueResponse>;
  createProposalRun(
    projectId: string,
    command: ProposalRunCreateCommand,
  ): Promise<ProposalRunCreateResult>;
  createRemoteSourceExtractRun(
    projectId: string,
    command: RemoteSourceExtractCreateCommand,
  ): Promise<RemoteSourceExtractCreateResult>;
  readOriginalRemoteSourceExtractRun(
    projectId: string,
    originalCommand: RemoteSourceExtractCreateCommand,
  ): Promise<RemoteSourceExtractOriginalRunResult>;
  getSourceExtraction(projectId: string): Promise<SourceExtractionReadResult>;
  getSourceExtractionVersion(
    projectId: string,
    versionId: string,
  ): Promise<SourceExtractionReadResult>;
  readVersionedSourceExtractionProposal(
    projectId: string,
    proposalId: string,
  ): Promise<VersionedSourceExtractionProposalReadResult>;
  createSub2APISourceExtractRun(
    projectId: string, command: Sub2APIQueueCommand,
  ): Promise<Sub2APIQueueResult>;
  readOriginalSub2APISourceExtractOperation(
    projectId: string, originalCommand: Sub2APIQueueCommand,
  ): Promise<Sub2APIOperationReadResult>;
  approveSub2APISourceExtractCall(
    projectId: string, originalCommand: Sub2APIQueueCommand,
    approvalCommand: Sub2APIApprovalCommand,
  ): Promise<Sub2APIApprovalResult>;
  getSub2APISourceExtractApproval(
    projectId: string, originalCommand: Sub2APIQueueCommand,
  ): Promise<Sub2APIApprovalReadResult>;
  getAppPreferences(): Promise<AppPreferencesReadResult>;
  saveAppPreferences(command: SaveAppPreferencesCommand): Promise<AppPreferencesSaveResult>;
  listProjectMediaAssets(projectId: string): Promise<MediaAssetListResult>;
  getProjectMediaAsset(projectId: string, assetId: string): Promise<MediaAssetReadResult>;
  importProjectMediaAssetFile(
    projectId: string, assetId: string | null, selectedPath: string,
  ): Promise<MediaAssetImportResult>;
  readProjectMediaAssetPreview(
    projectId: string, assetId: string, versionId: string,
  ): Promise<MediaAssetPreviewResult>;
  addProjectMediaAssetEpisodeReference(
    projectId: string, assetId: string, command: AddMediaAssetReferenceCommand,
  ): Promise<MediaAssetReferenceResult>;
  removeProjectMediaAssetEpisodeReference(
    projectId: string, assetId: string, command: RemoveMediaAssetReferenceCommand,
  ): Promise<MediaAssetUnreferenceResult>;
  deleteProjectMediaAsset(projectId: string, assetId: string): Promise<MediaAssetDeleteResult>;
  createFakeTimelineRun(
    projectId: string,
    command: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunCreateResult>;
  queryFakeTimelineRunOperation(
    projectId: string,
    originalCommand: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunOperationQueryResult>;
  listInvalidationOperations(
    projectId: string,
    query?: InvalidationOperationPageQuery,
  ): Promise<InvalidationOperationPageResponse>;
  getInvalidationOperation(
    projectId: string,
    operationId: string,
  ): Promise<InvalidationOperationResponse>;
  getArtifactProposal(projectId: string, proposalId: string): Promise<ArtifactProposalResponse>;
  acceptArtifactProposalAsDraft(
    projectId: string,
    proposalId: string,
    input: ArtifactProposalDraftAcceptanceInput,
  ): Promise<ArtifactProposalDecisionResult<ArtifactProposalDraftAcceptanceResponse>>;
  rejectArtifactProposal(
    projectId: string,
    proposalId: string,
    input: ArtifactProposalRejectionInput,
  ): Promise<ArtifactProposalDecisionResult<ArtifactProposalRejectionResponse>>;
  listProjectAgents(projectId: string): Promise<AgentCatalogResponse>;
  listProjectSkills(projectId: string): Promise<SkillCatalogResponse>;
  startFakeTimelineWorkflow(projectId: string): Promise<TimelineResponse>;
  getProjectTimeline(projectId: string): Promise<TimelineResponse | null>;
  trimTimelineClip(projectId: string, input: TrimTimelineClipInput): Promise<TimelineResponse>;
  reorderTimelineClip(
    projectId: string,
    input: ReorderTimelineClipInput,
  ): Promise<TimelineResponse>;
  replaceTimelineClip(
    projectId: string,
    input: ReplaceTimelineClipInput,
  ): Promise<TimelineResponse>;
  createDevelopmentExport(
    projectId: string,
    input: DevelopmentExportCreateInput,
  ): Promise<DevelopmentExportCreateResult>;
  getDevelopmentExport(
    projectId: string,
    operationId: string,
    timelineVersionId: string,
    expectedRevision: number,
  ): Promise<DevelopmentExportResponse>;
  listProviderConnections(): Promise<ProviderConnectionListResponse>;
  readSub2APIConfiguredReadiness(
    connectionId: string, modelId: string,
  ): Promise<Sub2APIConfiguredReadinessResult>;
  editSub2APIMetadata(
    connectionId: string, command: EditSub2APIMetadataCommand,
  ): Promise<Sub2APIConnectionMutationResult>;
  rotateSub2APIKey(
    connectionId: string, command: RotateSub2APIKeyCommand,
  ): Promise<Sub2APIConnectionMutationResult>;
  readSub2APIKeyRotation(
    connectionId: string, operationId: string,
  ): Promise<Sub2APIRotationReadResult>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionResponse>;
  deleteProviderConnection(connectionId: string): Promise<void>;
}

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const INVALIDATION_OPERATION_ID_PATTERN = /^ivo_[0-9a-f]{32}$/;
const PROPOSAL_ID_PATTERN = /^prp_[0-9a-f]{32}$/;
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{32}$/;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const SOURCE_BLOCK_ID_PATTERN = /^srcb_[0-9a-f]{32}$/;
const ARTIFACT_ID_PATTERN = /^art_[0-9a-f]{32}$/;
const VERSION_ID_PATTERN = /^ver_[0-9a-f]{32}$/;
const SUBMISSION_ID_PATTERN = /^sub_[0-9a-f]{32}$/;
const ENTITY_ID_PATTERN = /^ent_[0-9a-f]{32}$/;
const FACT_ID_PATTERN = /^fact_[0-9a-f]{32}$/;
const QUESTION_ID_PATTERN = /^qst_[0-9a-f]{32}$/;
const CONFLICT_ID_PATTERN = /^cfl_[0-9a-f]{32}$/;
const SOURCE_SPAN_ID_PATTERN = /^spn_[0-9a-f]{32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_SOURCE_BASE64_LENGTH = Math.ceil((5 * 1024 * 1024) / 3) * 4;
const MAX_LOCAL_API_JSON_BYTES = 16 * 1024 * 1024;
const DEFINITE_DECISION_STATUSES = new Set([401, 403, 404, 409, 422]);
type EpisodeDefiniteStatus = 401 | 403 | 404 | 409 | 422;

function isEpisodeDefiniteStatus(status: number): status is EpisodeDefiniteStatus {
  return status === 401 || status === 403 || status === 404 || status === 409 || status === 422;
}

const REVIEW_IDENTITY_KEYS = ["project_id", "version_id", "content_hash", "expected_revision"];
const REVIEW_TARGET_KEYS = [
  ...REVIEW_IDENTITY_KEYS,
  "artifact_id",
  "version_number",
  "review_evidence_revision",
  "review_version_id",
  "review_submission_id",
  "accepted_version_id",
];
const REPORT_ID_PATTERN = /^rpt_[0-9a-f]{32}$/;
const CHALLENGE_ID_PATTERN = /^chg_[0-9a-f]{32}$/;
const SIGNOFF_ID_PATTERN = /^sig_[0-9a-f]{32}$/;
const DECISION_ID_PATTERN = /^dec_[0-9a-f]{32}$/;
// gate_policy.py DEFAULT_GATE_POLICIES['source_manifest'], canonical_content_hash protocol.
const G1_POLICY_SNAPSHOT_HASH =
  "sha256:d9b44c6cb3464ff85eb7a546286691af0cf92e536d361fc8d5985aaf4320420c";
type SourceReviewAction = "submit" | "signoff" | "decision";

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) && hasOnlyKeys(value, keys) && keys.every((key) => Object.hasOwn(value, key))
  );
}

function isReviewInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isReviewDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return (
    month! >= 1 &&
    month! <= 12 &&
    day! >= 1 &&
    day! <= new Date(Date.UTC(year!, month!, 0)).getUTCDate() &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number(value.slice(17, 19)) < 60
  );
}

function isReviewIdentity(
  value: unknown,
): value is SourceManifestReviewIdentity & Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.project_id === "string" &&
    PROJECT_ID_PATTERN.test(value.project_id) &&
    typeof value.version_id === "string" &&
    VERSION_ID_PATTERN.test(value.version_id) &&
    typeof value.content_hash === "string" &&
    CONTENT_HASH_PATTERN.test(value.content_hash) &&
    isReviewInteger(value.expected_revision, 1) &&
    value.expected_revision < Number.MAX_SAFE_INTEGER
  );
}

function isStrictReviewHead(value: unknown): value is ReviewSchemas["ArtifactHeadData"] {
  return (
    isArtifactHead(value) &&
    isNullableId(value.review_version_id, VERSION_ID_PATTERN) &&
    isNullableId(value.accepted_version_id, VERSION_ID_PATTERN) &&
    (value.review_version_id === null) === (value.review_submission_id === null) &&
    isReviewInteger(value.revision, 1) &&
    isReviewInteger(value.review_evidence_revision) &&
    isReviewDate(value.updated_at)
  );
}

function reviewTargetSnapshot(input: unknown): SourceManifestReviewTarget | null {
  if (
    !hasExactKeys(input, REVIEW_TARGET_KEYS) ||
    !isReviewIdentity(input) ||
    typeof input.artifact_id !== "string" ||
    !ARTIFACT_ID_PATTERN.test(input.artifact_id) ||
    !isReviewInteger(input.version_number, 1) ||
    input.version_number >= Number.MAX_SAFE_INTEGER ||
    !isReviewInteger(input.review_evidence_revision) ||
    input.review_evidence_revision >= Number.MAX_SAFE_INTEGER ||
    !isNullableId(input.review_version_id, VERSION_ID_PATTERN) ||
    !isNullableId(input.review_submission_id, SUBMISSION_ID_PATTERN) ||
    !isNullableId(input.accepted_version_id, VERSION_ID_PATTERN) ||
    (input.review_version_id === null) !== (input.review_submission_id === null)
  )
    return null;
  return {
    project_id: input.project_id,
    artifact_id: input.artifact_id,
    version_id: input.version_id,
    content_hash: input.content_hash,
    expected_revision: input.expected_revision,
    version_number: input.version_number,
    review_evidence_revision: input.review_evidence_revision,
    review_version_id: input.review_version_id as string | null,
    review_submission_id: input.review_submission_id as string | null,
    accepted_version_id: input.accepted_version_id as string | null,
  };
}

function isSourceReviewReport(
  value: unknown,
  target: SourceManifestReviewTarget,
  action: SourceReviewAction,
): value is SourceManifestReviewReport {
  if (
    !hasExactKeys(value, [
      "id",
      "artifact_id",
      "version_id",
      "gate",
      "submission_id",
      "policy_code",
      "policy_version",
      "head_revision",
      "review_evidence_revision",
      "report",
      "report_hash",
      "expires_at",
      "created_at",
    ]) ||
    typeof value.id !== "string" ||
    !REPORT_ID_PATTERN.test(value.id) ||
    value.artifact_id !== target.artifact_id ||
    value.version_id !== target.version_id ||
    value.gate !== "G1" ||
    value.submission_id !== (action === "submit" ? null : target.review_submission_id) ||
    (action !== "submit" &&
      (target.review_submission_id === null || target.review_version_id !== target.version_id)) ||
    value.policy_code !== "g1.source-manifest" ||
    value.policy_version !== "1" ||
    !isReviewInteger(value.head_revision, 1) ||
    !isReviewInteger(value.review_evidence_revision) ||
    value.head_revision !== target.expected_revision - (action === "decision" ? 1 : 0) ||
    value.review_evidence_revision !== target.review_evidence_revision ||
    !isReviewDate(value.created_at) ||
    !isReviewDate(value.expires_at) ||
    Date.parse(value.expires_at) <= Date.parse(value.created_at) ||
    !hasExactKeys(value.report, [
      "ready",
      "blocking",
      "policy_code",
      "policy_version",
      "policy_snapshot_hash",
    ])
  )
    return false;
  const report = value.report;
  if (
    report.ready !== true ||
    !Array.isArray(report.blocking) ||
    report.blocking.length !== 0 ||
    report.policy_code !== value.policy_code ||
    report.policy_version !== value.policy_version ||
    report.policy_snapshot_hash !== G1_POLICY_SNAPSHOT_HASH
  )
    return false;
  // This is the fixed G1 readiness object, sorted exactly as Python canonical_content_bytes.
  const canonical = JSON.stringify({
    blocking: [],
    policy_code: report.policy_code,
    policy_snapshot_hash: report.policy_snapshot_hash,
    policy_version: report.policy_version,
    ready: true,
  });
  return (
    value.report_hash === `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`
  );
}

function isPreparedSourceReview(
  value: unknown,
  target: SourceManifestReviewTarget,
  action: SourceReviewAction,
  expectedReport?: SourceManifestReviewReport,
): value is SourceManifestPreparedReview {
  if (
    !hasExactKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !hasExactKeys(value.data, ["report", "challenge", "confirmation_token"]) ||
    !isSourceReviewReport(value.data.report, target, action) ||
    typeof value.data.confirmation_token !== "string" ||
    !/^[A-Za-z0-9_-]{20,256}$/.test(value.data.confirmation_token) ||
    !hasExactKeys(value.data.challenge, [
      "id",
      "artifact_id",
      "version_id",
      "gate",
      "action",
      "readiness_report_id",
      "head_revision",
      "review_evidence_revision",
      "expires_at",
      "consumed_at",
      "created_at",
    ])
  )
    return false;
  const { report, challenge } = value.data;
  return (
    (!expectedReport ||
      Object.keys(expectedReport).every(
        (key) =>
          key === "report" ||
          report[key as keyof SourceManifestReviewReport] ===
            expectedReport[key as keyof SourceManifestReviewReport],
      )) &&
    typeof challenge.id === "string" &&
    CHALLENGE_ID_PATTERN.test(challenge.id) &&
    challenge.artifact_id === target.artifact_id &&
    challenge.version_id === target.version_id &&
    challenge.gate === "G1" &&
    challenge.action === action &&
    challenge.readiness_report_id === report.id &&
    challenge.head_revision === target.expected_revision &&
    challenge.review_evidence_revision === target.review_evidence_revision &&
    challenge.consumed_at === null &&
    isReviewDate(challenge.created_at) &&
    isReviewDate(challenge.expires_at) &&
    Date.parse(challenge.expires_at) > Date.parse(challenge.created_at) &&
    Date.parse(challenge.created_at) >= Date.parse(report.created_at)
  );
}

function isReviewResultHead(
  value: unknown,
  target: SourceManifestReviewTarget,
  action: SourceReviewAction,
): value is ReviewSchemas["ArtifactHeadData"] {
  return (
    isStrictReviewHead(value) &&
    value.artifact_id === target.artifact_id &&
    value.latest_version_id === target.version_id &&
    value.revision === target.expected_revision + 1 &&
    value.review_evidence_revision ===
      target.review_evidence_revision + (action === "submit" ? 1 : 0) &&
    value.accepted_version_id ===
      (action === "decision" ? target.version_id : target.accepted_version_id) &&
    value.review_version_id === (action === "decision" ? null : target.version_id) &&
    (action === "decision"
      ? value.review_submission_id === null
      : action === "signoff"
        ? value.review_submission_id === target.review_submission_id
        : value.review_submission_id !== null)
  );
}

function isSourceSubmissionReceipt(
  value: unknown,
  target: SourceManifestReviewTarget,
  prepared: SourceManifestPreparedReview,
): value is SourceManifestSubmissionReceipt {
  if (
    !hasExactKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !hasExactKeys(value.data, ["head", "submission"]) ||
    !isReviewResultHead(value.data.head, target, "submit") ||
    !hasExactKeys(value.data.submission, [
      "id",
      "artifact_id",
      "version_id",
      "gate",
      "readiness_report_id",
      "supersedes_submission_id",
      "submitted_by_actor_id",
      "submitted_at",
    ])
  )
    return false;
  const submission = value.data.submission;
  return (
    typeof submission.id === "string" &&
    SUBMISSION_ID_PATTERN.test(submission.id) &&
    submission.id === value.data.head.review_submission_id &&
    submission.id !== target.review_submission_id &&
    submission.artifact_id === target.artifact_id &&
    submission.version_id === target.version_id &&
    submission.gate === "G1" &&
    submission.readiness_report_id === prepared.data.report.id &&
    submission.supersedes_submission_id === target.review_submission_id &&
    submission.submitted_by_actor_id === "local-user" &&
    isReviewDate(submission.submitted_at)
  );
}

function isSourceSignoffReceipt(
  value: unknown,
  target: SourceManifestReviewTarget,
  prepared: SourceManifestPreparedReview,
): value is SourceManifestSignoffReceipt {
  if (
    !hasExactKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !hasExactKeys(value.data, ["head", "signoffs"]) ||
    !isReviewResultHead(value.data.head, target, "signoff") ||
    !Array.isArray(value.data.signoffs) ||
    value.data.signoffs.length !== 2
  )
    return false;
  const signoffs = value.data.signoffs;
  return (
    signoffs.every(
      (signoff) =>
        hasExactKeys(signoff, [
          "id",
          "artifact_id",
          "version_id",
          "submission_id",
          "gate",
          "role",
          "actor_id",
          "review_evidence_revision",
          "readiness_report_id",
          "self_review",
          "supersedes_signoff_id",
          "signed_at",
        ]) &&
        typeof signoff.id === "string" &&
        SIGNOFF_ID_PATTERN.test(signoff.id) &&
        signoff.artifact_id === target.artifact_id &&
        signoff.version_id === target.version_id &&
        signoff.submission_id === target.review_submission_id &&
        signoff.gate === "G1" &&
        (signoff.role === "writer" || signoff.role === "producer") &&
        signoff.actor_id === "local-user" &&
        signoff.review_evidence_revision === target.review_evidence_revision &&
        signoff.readiness_report_id === prepared.data.report.id &&
        typeof signoff.self_review === "boolean" &&
        isNullableId(signoff.supersedes_signoff_id, SIGNOFF_ID_PATTERN) &&
        signoff.supersedes_signoff_id !== signoff.id &&
        isReviewDate(signoff.signed_at),
    ) &&
    signoffs[0].id !== signoffs[1].id &&
    signoffs[0].role !== signoffs[1].role &&
    signoffs[0].self_review === signoffs[1].self_review
  );
}

function isSourceDecisionReceipt(
  value: unknown,
  target: SourceManifestReviewTarget,
  prepared: SourceManifestPreparedReview,
  rationale: string,
): value is SourceManifestDecisionReceipt {
  if (
    !hasExactKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !hasExactKeys(value.data, ["head", "decision"]) ||
    !isReviewResultHead(value.data.head, target, "decision") ||
    !hasExactKeys(value.data.decision, [
      "id",
      "artifact_id",
      "version_id",
      "submission_id",
      "gate",
      "decision",
      "readiness_report_id",
      "actor_id",
      "actor_role",
      "self_review",
      "rationale",
      "decided_at",
    ])
  )
    return false;
  const decision = value.data.decision;
  return (
    typeof decision.id === "string" &&
    DECISION_ID_PATTERN.test(decision.id) &&
    decision.artifact_id === target.artifact_id &&
    decision.version_id === target.version_id &&
    decision.submission_id === target.review_submission_id &&
    decision.gate === "G1" &&
    decision.decision === "approved" &&
    decision.readiness_report_id === prepared.data.report.id &&
    decision.actor_id === "local-user" &&
    decision.actor_role === "producer" &&
    typeof decision.self_review === "boolean" &&
    decision.rationale === rationale &&
    isReviewDate(decision.decided_at)
  );
}

function isReviewRationale(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    [...value].length <= 1000
  );
}

function isStrictReviewManifest(
  value: unknown,
  projectId: string,
): value is SourceManifestResponse {
  if (!isSourceManifestResponse(value, projectId) || !isStrictReviewHead(value.data.head))
    return false;
  return [value.data.latest_version, value.data.review_version, value.data.accepted_version].every(
    (version) =>
      version === null ||
      (isNullableId(version.parent_version_id, VERSION_ID_PATTERN) &&
        isReviewInteger(version.version_number, 1) &&
        isReviewDate(version.created_at) &&
        Array.isArray(version.content.exclusions) &&
        version.content.documents.every(
          (document) =>
            isReviewInteger(document.byte_size) &&
            isReviewInteger(document.chapter_count) &&
            isReviewInteger(document.import_order) &&
            document.blocks.every(
              (block) =>
                isReviewInteger(block.ordinal) &&
                isReviewInteger(block.chapter_index) &&
                isReviewInteger(block.start_byte) &&
                isReviewInteger(block.end_byte),
            ),
        )),
  );
}

function sourceReviewErrorCode(
  status: number,
  payload: unknown,
  phase: "get" | "review" | "copy",
): SourceManifestReviewErrorCode | undefined {
  if (
    !isErrorResponse(payload) ||
    !hasExactKeys(payload, ["error", "request_id"]) ||
    !hasExactKeys(payload.error, ["code", "message", "retryable", "details"]) ||
    payload.error.retryable !== false ||
    Object.keys(payload.error.details).length !== 0
  )
    return undefined;
  const code = payload.error.code;
  if (status === 401 && code === "SIDECAR_AUTH_REQUIRED") return code;
  if (status === 403 && code === "SIDECAR_REQUEST_REJECTED") return code;
  if (status === 404 && (code === "PROJECT_NOT_FOUND" || code === "SOURCE_MANIFEST_NOT_FOUND"))
    return code;
  if (status === 422 && code === "VALIDATION_ERROR") return code;
  if (phase === "get") return undefined;
  if (status === 412 && code === "PRECONDITION_FAILED") return code;
  if (status === 428 && code === "PRECONDITION_REQUIRED") return code;
  if (
    phase === "review" &&
    status === 409 &&
    (code === "GATE_NOT_READY" || code === "REVIEW_INVALID")
  )
    return code;
  return undefined;
}

function normalizeRejectionInput(
  input: ArtifactProposalRejectionInput,
): ArtifactProposalRejectionInput {
  return {
    reason_code: input.reason_code,
    comment: input.comment.normalize("NFC").replace(/\r\n?/g, "\n").trim(),
  };
}

function proposalDecisionKey(
  action: "accept" | "reject",
  projectId: string,
  proposalId: string,
  input: ArtifactProposalDraftAcceptanceInput | ArtifactProposalRejectionInput,
): string {
  const requestIdentity = JSON.stringify({
    version: 1,
    action,
    project_id: projectId,
    proposal_id: proposalId,
    input,
  });
  const digest = createHash("sha256").update(requestIdentity, "utf8").digest("hex");
  const key = `proposal-${action}:sha256:${digest}`;
  if (!isArtifactProposalDecisionKey(key)) {
    throw new Error("Artifact proposal decision key generation failed closed");
  }
  return key;
}

function isProject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "name",
      "aspect_ratio",
      "target_duration_seconds",
      "source_language",
      "status",
      "revision",
      "created_at",
      "updated_at",
    ]) &&
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

function isErrorResponse(value: unknown): value is {
  error: { code: string; message: string; retryable: boolean; details: Record<string, string> };
  request_id: string;
} {
  if (!isRecord(value) || !hasRequestId(value) || !isRecord(value.error)) return false;
  const { error } = value;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean" &&
    isRecord(error.details) &&
    Object.values(error.details).every((detail) => typeof detail === "string")
  );
}

function developmentExportRejection(
  status: number,
  payload: unknown,
  projectId: string,
  input: DevelopmentExportCreateInput,
): DevelopmentExportDefiniteRejection | null {
  if (
    !isErrorResponse(payload) ||
    !hasExactKeys(payload, ["error", "request_id"]) ||
    !hasExactKeys(payload.error, ["code", "message", "retryable", "details"]) ||
    payload.error.retryable !== false
  ) return null;

  const { code, details } = payload.error;
  let disposition: DevelopmentExportDefiniteRejection["disposition"];
  let requestEffect: DevelopmentExportDefiniteRejection["request_effect"];
  if (status === 422 && code === "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED") {
    if (!isDevelopmentExportNoClaimDetails(details, projectId, input)) return null;
    disposition = "REVIEW_INPUT";
    requestEffect = "NO_EXPORT_CLAIM";
  } else {
    if (Object.keys(details).length !== 0) return null;
    if (status === 401 && code === "SIDECAR_AUTH_REQUIRED") {
      disposition = "RESTORE_AUTH";
    } else if (status === 403 && code === "SIDECAR_REQUEST_REJECTED") {
      disposition = "RESTORE_AUTH";
    } else if (status === 404 && (
      code === "PROJECT_NOT_FOUND" || code === "TIMELINE_NOT_FOUND" ||
      code === "DEVELOPMENT_EXPORT_NOT_FOUND"
    )) {
      disposition = "REVIEW_INPUT";
    } else if (status === 409 && code === "DEVELOPMENT_EXPORT_CONFLICT") {
      disposition = "RECONCILE_OPERATION";
    } else if (status === 422 && (
      code === "VALIDATION_ERROR" || code === "DEVELOPMENT_EXPORT_INVALID"
    )) {
      disposition = "REVIEW_INPUT";
    } else {
      return null;
    }
  }
  return {
    kind: "DEFINITE_REJECTION", project_id: projectId, operation_id: input.operation_id,
    timeline_version_id: input.timeline_version_id, expected_revision: input.expected_revision,
    status, code, request_id: payload.request_id, disposition,
    ...(requestEffect ? { request_effect: requestEffect } : {}),
  };
}

function isProjectResponse(value: unknown): value is ProjectResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    isProject(value.data)
  );
}

function isProjectListResponse(value: unknown): value is ProjectListResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(isProject)
  );
}

function isSourceBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "ordinal",
      "kind",
      "chapter_index",
      "text",
      "normalized_start_byte",
      "normalized_end_byte",
      "content_sha256",
    ]) &&
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

function isSourceDocumentListResponse(
  value: unknown,
  expectedProjectId?: string,
): value is SourceDocumentListResponse {
  const summaryKeys = [
    "id",
    "project_id",
    "filename",
    "media_type",
    "encoding",
    "byte_size",
    "raw_sha256",
    "imported_at",
    "chapter_count",
    "block_count",
  ];
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(
      (summary) =>
        isRecord(summary) &&
        hasOnlyKeys(summary, summaryKeys) &&
        isSourceDocumentSummary(summary) &&
        (expectedProjectId === undefined || summary.project_id === expectedProjectId),
    )
  );
}

function isSourceDocumentResponse(
  value: unknown,
  expectedProjectId?: string,
  expectedSourceId?: string,
): value is SourceDocumentResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data)
  ) {
    return false;
  }
  const data = value.data;
  return (
    hasOnlyKeys(data, [
      "id",
      "project_id",
      "filename",
      "media_type",
      "encoding",
      "byte_size",
      "raw_sha256",
      "imported_at",
      "chapter_count",
      "block_count",
      "blocks",
    ]) &&
    isSourceDocumentSummary(data) &&
    (expectedProjectId === undefined || data.project_id === expectedProjectId) &&
    (expectedSourceId === undefined || data.id === expectedSourceId) &&
    Array.isArray(data.blocks) &&
    data.block_count === data.blocks.length &&
    data.blocks.every(isSourceBlock)
  );
}

function isSourceDocumentTextResponse(
  value: unknown,
  expectedProjectId: string,
  expectedSourceId: string,
): value is SourceDocumentTextResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "id",
      "project_id",
      "raw_sha256",
      "normalized_text",
      "normalized_sha256",
    ])
  )
    return false;
  const data = value.data;
  return (
    data.id === expectedSourceId &&
    data.project_id === expectedProjectId &&
    typeof data.raw_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(data.raw_sha256) &&
    typeof data.normalized_text === "string" &&
    Buffer.byteLength(data.normalized_text, "utf8") <= MAX_SOURCE_BYTES &&
    typeof data.normalized_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(data.normalized_sha256) &&
    createHash("sha256").update(data.normalized_text, "utf8").digest("hex") ===
      data.normalized_sha256
  );
}

function isArtifactHead(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "artifact_id",
      "latest_version_id",
      "review_version_id",
      "review_submission_id",
      "accepted_version_id",
      "revision",
      "review_evidence_revision",
      "updated_at",
    ]) &&
    typeof value.artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(value.artifact_id) &&
    typeof value.latest_version_id === "string" &&
    VERSION_ID_PATTERN.test(value.latest_version_id) &&
    isNullableId(value.review_version_id ?? null, VERSION_ID_PATTERN) &&
    isNullableId(value.review_submission_id, SUBMISSION_ID_PATTERN) &&
    isNullableId(value.accepted_version_id ?? null, VERSION_ID_PATTERN) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    Number.isInteger(value.review_evidence_revision) &&
    Number(value.review_evidence_revision) >= 0 &&
    typeof value.updated_at === "string"
  );
}

function isArtifactVersion(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value.artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(value.artifact_id) &&
    typeof value.id === "string" &&
    VERSION_ID_PATTERN.test(value.id) &&
    isNullableId(value.parent_version_id ?? null, VERSION_ID_PATTERN) &&
    Number.isInteger(value.version_number) &&
    Number(value.version_number) >= 1 &&
    value.schema_version === "1.0.0" &&
    typeof value.content_hash === "string" &&
    CONTENT_HASH_PATTERN.test(value.content_hash) &&
    typeof value.change_summary === "string" &&
    typeof value.created_at === "string" &&
    isRecord(value.content)
  );
}

function isManifestBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "source_block_id",
      "ordinal",
      "kind",
      "chapter_index",
      "start_byte",
      "end_byte",
      "content_sha256",
    ]) &&
    typeof value.source_block_id === "string" &&
    SOURCE_BLOCK_ID_PATTERN.test(value.source_block_id) &&
    Number.isInteger(value.ordinal) &&
    (value.kind === "chapter_heading" || value.kind === "paragraph") &&
    Number.isInteger(value.chapter_index) &&
    Number.isInteger(value.start_byte) &&
    Number.isInteger(value.end_byte) &&
    Number(value.end_byte) >= Number(value.start_byte) &&
    typeof value.content_sha256 === "string" &&
    SHA256_PATTERN.test(value.content_sha256)
  );
}

function isManifestDocument(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "source_document_id",
      "filename",
      "media_type",
      "encoding",
      "byte_size",
      "chapter_count",
      "raw_sha256",
      "normalized_sha256",
      "import_order",
      "blocks",
    ]) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID_PATTERN.test(value.source_document_id) &&
    typeof value.filename === "string" &&
    value.media_type === "text/plain" &&
    value.encoding === "utf-8" &&
    Number.isInteger(value.byte_size) &&
    Number.isInteger(value.chapter_count) &&
    typeof value.raw_sha256 === "string" &&
    SHA256_PATTERN.test(value.raw_sha256) &&
    typeof value.normalized_sha256 === "string" &&
    SHA256_PATTERN.test(value.normalized_sha256) &&
    Number.isInteger(value.import_order) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isManifestBlock)
  );
}

function isSourceManifestResponse(
  value: unknown,
  expectedProjectId: string,
): value is SourceManifestResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "project_id",
      "head",
      "latest_version",
      "review_version",
      "accepted_version",
    ])
  ) {
    return false;
  }
  if (value.data.project_id !== expectedProjectId) return false;
  const {
    head,
    latest_version: latest,
    review_version: review,
    accepted_version: accepted,
  } = value.data;
  if (!isArtifactHead(head)) return false;
  const isManifestVersion = (candidate: unknown): candidate is Record<string, unknown> => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "id",
        "artifact_id",
        "version_number",
        "schema_version",
        "content",
        "content_hash",
        "parent_version_id",
        "change_summary",
        "created_at",
      ]) ||
      !isArtifactVersion(candidate) ||
      !isRecord(candidate.content)
    ) {
      return false;
    }
    const content = candidate.content;
    return (
      hasOnlyKeys(content, ["scope_type", "documents", "exclusions"]) &&
      content.scope_type === "full_work" &&
      Array.isArray(content.documents) &&
      content.documents.every(isManifestDocument) &&
      (content.exclusions === undefined || isStringArray(content.exclusions))
    );
  };
  if (!isManifestVersion(latest)) return false;
  const roleMatches = (candidate: unknown, expectedVersionId: unknown): boolean =>
    expectedVersionId === null
      ? candidate === null
      : isManifestVersion(candidate) &&
        candidate.id === expectedVersionId &&
        candidate.artifact_id === head.artifact_id;
  return (
    latest.artifact_id === head.artifact_id &&
    latest.id === head.latest_version_id &&
    roleMatches(review, head.review_version_id) &&
    roleMatches(accepted, head.accepted_version_id)
  );
}

function isStoryEntity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, ["entity_id", "kind", "name", "aliases"]) &&
    typeof value.entity_id === "string" &&
    ENTITY_ID_PATTERN.test(value.entity_id) &&
    ["character", "location", "organization", "prop", "costume"].includes(String(value.kind)) &&
    typeof value.name === "string" &&
    (value.aliases === undefined ||
      (Array.isArray(value.aliases) && value.aliases.every((item) => typeof item === "string")))
  );
}

const COMMON_STORY_FACT_KEYS = [
  "fact_id",
  "importance",
  "origin",
  "canon_status",
  "extraction_confidence_bps",
  "canon_certainty",
  "viewpoint_entity_id",
  "source_reliability",
  "decision_reason",
  "impact_scope",
  "supersedes_fact_ids",
  "derived_from_fact_ids",
  "kind",
] as const;

function hasCommonStoryFactFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.fact_id === "string" &&
    FACT_ID_PATTERN.test(value.fact_id) &&
    ["core", "supporting", "detail"].includes(String(value.importance)) &&
    [
      "source_explicit_assertion",
      "source_interpretation",
      "user_decision",
      "ai_inference",
    ].includes(String(value.origin)) &&
    ["proposed", "confirmed", "contested", "rejected"].includes(String(value.canon_status)) &&
    (value.extraction_confidence_bps === undefined ||
      value.extraction_confidence_bps === null ||
      (Number.isInteger(value.extraction_confidence_bps) &&
        Number(value.extraction_confidence_bps) >= 0 &&
        Number(value.extraction_confidence_bps) <= 10_000)) &&
    ["certain", "likely", "ambiguous", "intentionally_unreliable"].includes(
      String(value.canon_certainty),
    ) &&
    (value.viewpoint_entity_id === undefined ||
      isNullableId(value.viewpoint_entity_id, ENTITY_ID_PATTERN)) &&
    ["reliable", "uncertain", "unreliable", "not_applicable"].includes(
      String(value.source_reliability),
    ) &&
    (value.decision_reason === undefined ||
      value.decision_reason === null ||
      typeof value.decision_reason === "string") &&
    (value.impact_scope === undefined || isStringArray(value.impact_scope)) &&
    (value.supersedes_fact_ids === undefined ||
      isIdArray(value.supersedes_fact_ids, FACT_ID_PATTERN)) &&
    (value.derived_from_fact_ids === undefined ||
      isIdArray(value.derived_from_fact_ids, FACT_ID_PATTERN))
  );
}

function isStoryValidity(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["starts_after_event_fact_id", "ends_after_event_fact_id"])
  ) {
    return false;
  }
  return (
    (value.starts_after_event_fact_id === undefined ||
      isNullableId(value.starts_after_event_fact_id, FACT_ID_PATTERN)) &&
    (value.ends_after_event_fact_id === undefined ||
      isNullableId(value.ends_after_event_fact_id, FACT_ID_PATTERN))
  );
}

function isStoryStateValue(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "text":
      return hasOnlyKeys(value, ["kind", "value"]) && typeof value.value === "string";
    case "entity_ref":
      return (
        hasOnlyKeys(value, ["kind", "entity_id"]) &&
        typeof value.entity_id === "string" &&
        ENTITY_ID_PATTERN.test(value.entity_id)
      );
    case "boolean":
      return hasOnlyKeys(value, ["kind", "value"]) && typeof value.value === "boolean";
    case "number":
      return (
        hasOnlyKeys(value, ["kind", "value"]) &&
        typeof value.value === "number" &&
        Number.isFinite(value.value)
      );
    default:
      return false;
  }
}

function isTemporalRelation(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["relation", "other_event_fact_id"]) &&
    ["before", "after", "simultaneous"].includes(String(value.relation)) &&
    typeof value.other_event_fact_id === "string" &&
    FACT_ID_PATTERN.test(value.other_event_fact_id)
  );
}

function isStoryStateChange(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["entity_id", "property_key", "before", "after"])) {
    return false;
  }
  return (
    typeof value.entity_id === "string" &&
    ENTITY_ID_PATTERN.test(value.entity_id) &&
    [
      "holder",
      "wearer",
      "location",
      "condition",
      "possession",
      "relationship_status",
      "alive",
      "appearance",
    ].includes(String(value.property_key)) &&
    (value.before === undefined || isStoryStateValue(value.before)) &&
    (value.after === undefined || isStoryStateValue(value.after))
  );
}

function isStoryFact(value: unknown): boolean {
  if (!isRecord(value) || !hasCommonStoryFactFields(value)) return false;
  const keysFor = (specific: readonly string[]) =>
    hasOnlyKeys(value, [...COMMON_STORY_FACT_KEYS, ...specific]);
  const validAttributeFact = (entityKey: string) =>
    typeof value[entityKey] === "string" &&
    ENTITY_ID_PATTERN.test(String(value[entityKey])) &&
    typeof value.attribute === "string" &&
    typeof value.value === "string" &&
    isStoryValidity(value.validity);
  switch (value.kind) {
    case "character_fact":
      return (
        keysFor(["character_id", "attribute", "value", "validity"]) &&
        validAttributeFact("character_id")
      );
    case "location_fact":
      return (
        keysFor(["location_id", "attribute", "value", "validity"]) &&
        validAttributeFact("location_id")
      );
    case "organization_fact":
      return (
        keysFor(["organization_id", "attribute", "value", "validity"]) &&
        validAttributeFact("organization_id")
      );
    case "relationship_fact":
      return (
        keysFor(["subject_entity_id", "predicate", "object_entity_id", "validity"]) &&
        typeof value.subject_entity_id === "string" &&
        ENTITY_ID_PATTERN.test(value.subject_entity_id) &&
        typeof value.predicate === "string" &&
        typeof value.object_entity_id === "string" &&
        ENTITY_ID_PATTERN.test(value.object_entity_id) &&
        isStoryValidity(value.validity)
      );
    case "event_fact":
      return (
        keysFor([
          "participants",
          "location_id",
          "source_narrative_order",
          "story_time_order",
          "temporal_relations",
          "caused_by_fact_ids",
          "state_changes",
        ]) &&
        isIdArray(value.participants, ENTITY_ID_PATTERN) &&
        (value.location_id === undefined || isNullableId(value.location_id, ENTITY_ID_PATTERN)) &&
        Number.isInteger(value.source_narrative_order) &&
        Number.isInteger(value.story_time_order) &&
        (value.temporal_relations === undefined ||
          (Array.isArray(value.temporal_relations) &&
            value.temporal_relations.every(isTemporalRelation))) &&
        (value.caused_by_fact_ids === undefined ||
          isIdArray(value.caused_by_fact_ids, FACT_ID_PATTERN)) &&
        (value.state_changes === undefined ||
          (Array.isArray(value.state_changes) && value.state_changes.every(isStoryStateChange)))
      );
    case "world_rule_fact":
      return (
        keysFor(["rule_scope", "rule", "exceptions"]) &&
        typeof value.rule_scope === "string" &&
        typeof value.rule === "string" &&
        (value.exceptions === undefined || isStringArray(value.exceptions))
      );
    case "prop_fact":
    case "costume_fact": {
      const entityKey = value.kind === "prop_fact" ? "prop_id" : "costume_id";
      return (
        keysFor([entityKey, "property_key", "value", "validity"]) &&
        typeof value[entityKey] === "string" &&
        ENTITY_ID_PATTERN.test(String(value[entityKey])) &&
        ["holder", "wearer", "location", "condition", "appearance"].includes(
          String(value.property_key),
        ) &&
        isStoryStateValue(value.value) &&
        isStoryValidity(value.validity)
      );
    }
    default:
      return false;
  }
}

function isStoryQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "question_id",
      "scope_type",
      "scope_id",
      "question",
      "severity",
      "responsible_role",
      "blocking",
      "status",
      "resolution",
    ]) &&
    typeof value.question_id === "string" &&
    QUESTION_ID_PATTERN.test(value.question_id) &&
    typeof value.question === "string" &&
    typeof value.blocking === "boolean" &&
    typeof value.responsible_role === "string" &&
    ["artifact", "entity", "fact", "source_document"].includes(String(value.scope_type)) &&
    (value.scope_id === undefined ||
      value.scope_id === null ||
      typeof value.scope_id === "string") &&
    ["blocking", "major", "minor", "note"].includes(String(value.severity)) &&
    ["open", "resolved"].includes(String(value.status)) &&
    (value.resolution === undefined ||
      value.resolution === null ||
      typeof value.resolution === "string")
  );
}

function isStoryConflict(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "conflict_id",
      "conflict_type",
      "fact_ids",
      "severity",
      "responsible_role",
      "status",
      "resolution_reason",
      "resolution_fact_id",
    ]) &&
    typeof value.conflict_id === "string" &&
    CONFLICT_ID_PATTERN.test(value.conflict_id) &&
    typeof value.conflict_type === "string" &&
    Array.isArray(value.fact_ids) &&
    value.fact_ids.every((item) => typeof item === "string" && FACT_ID_PATTERN.test(item)) &&
    ["blocking", "major", "minor", "note"].includes(String(value.severity)) &&
    typeof value.responsible_role === "string" &&
    ["unresolved", "resolved_as_source_ambiguity", "resolved_by_user_decision"].includes(
      String(value.status),
    ) &&
    (value.resolution_reason === undefined ||
      value.resolution_reason === null ||
      typeof value.resolution_reason === "string") &&
    (value.resolution_fact_id === undefined ||
      isNullableId(value.resolution_fact_id, FACT_ID_PATTERN))
  );
}

function isStorySourceSpan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "fact_id",
      "source_document_id",
      "source_block_id",
      "role",
      "start_byte",
      "end_byte",
      "claim",
      "quote_hash",
    ]) &&
    typeof value.id === "string" &&
    SOURCE_SPAN_ID_PATTERN.test(value.id) &&
    typeof value.fact_id === "string" &&
    FACT_ID_PATTERN.test(value.fact_id) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID_PATTERN.test(value.source_document_id) &&
    typeof value.source_block_id === "string" &&
    SOURCE_BLOCK_ID_PATTERN.test(value.source_block_id) &&
    ["supports", "contradicts", "context"].includes(String(value.role)) &&
    Number.isInteger(value.start_byte) &&
    Number(value.start_byte) >= 0 &&
    Number.isInteger(value.end_byte) &&
    Number(value.end_byte) > Number(value.start_byte) &&
    typeof value.claim === "string" &&
    value.claim.length > 0 &&
    typeof value.quote_hash === "string" &&
    CONTENT_HASH_PATTERN.test(value.quote_hash)
  );
}

function isStoryBibleIndexResponse(
  value: unknown,
  expectedProjectId: string,
): value is StoryBibleIndexResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "project_id",
      "head",
      "latest_version",
      "review_version",
      "accepted_version",
    ]) ||
    value.data.project_id !== expectedProjectId
  ) {
    return false;
  }
  const {
    head,
    latest_version: latest,
    review_version: review,
    accepted_version: accepted,
  } = value.data;
  const isSummary = (candidate: unknown): candidate is Record<string, unknown> =>
    isRecord(candidate) &&
    hasOnlyKeys(candidate, [
      "id",
      "artifact_id",
      "version_number",
      "schema_version",
      "content_hash",
      "parent_version_id",
      "change_summary",
      "created_at",
    ]) &&
    typeof candidate.artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(candidate.artifact_id) &&
    typeof candidate.id === "string" &&
    VERSION_ID_PATTERN.test(candidate.id) &&
    isNullableId(candidate.parent_version_id ?? null, VERSION_ID_PATTERN) &&
    Number.isInteger(candidate.version_number) &&
    Number(candidate.version_number) >= 1 &&
    candidate.schema_version === "1.0.0" &&
    typeof candidate.content_hash === "string" &&
    CONTENT_HASH_PATTERN.test(candidate.content_hash) &&
    typeof candidate.change_summary === "string" &&
    typeof candidate.created_at === "string";
  if (!isArtifactHead(head) || !isSummary(latest)) return false;
  const roleMatches = (candidate: unknown, expectedVersionId: unknown): boolean =>
    expectedVersionId === null
      ? candidate === null
      : isSummary(candidate) &&
        candidate.id === expectedVersionId &&
        candidate.artifact_id === head.artifact_id;
  return (
    latest.id === head.latest_version_id &&
    latest.artifact_id === head.artifact_id &&
    roleMatches(review, head.review_version_id) &&
    roleMatches(accepted, head.accepted_version_id)
  );
}

function isStoryBibleVersionResponse(
  value: unknown,
  expectedProjectId: string,
  expectedVersionId: string,
): value is StoryBibleVersionResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["project_id", "head", "version"]) ||
    value.data.project_id !== expectedProjectId
  ) {
    return false;
  }
  const { head, version } = value.data;
  if (!isArtifactHead(head)) return false;

  const isStoryVersion = (candidate: unknown): candidate is Record<string, unknown> => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "id",
        "artifact_id",
        "version_number",
        "schema_version",
        "content",
        "source_spans",
        "content_hash",
        "parent_version_id",
        "change_summary",
        "created_at",
      ]) ||
      !isArtifactVersion(candidate) ||
      !Array.isArray(candidate.source_spans) ||
      !isRecord(candidate.content) ||
      !hasOnlyKeys(candidate.content, [
        "title",
        "logline",
        "source_scope",
        "entities",
        "facts",
        "questions",
        "conflicts",
      ])
    ) {
      return false;
    }
    const content = candidate.content;
    if (
      typeof content.title !== "string" ||
      content.title.trim().length === 0 ||
      [...content.title].length > 120 ||
      typeof content.logline !== "string" ||
      content.logline.trim().length === 0 ||
      [...content.logline].length > 500 ||
      !isRecord(content.source_scope) ||
      !hasOnlyKeys(content.source_scope, [
        "source_manifest_version_id",
        "scope_type",
        "documents",
        "exclusions",
      ]) ||
      !["full_work", "selected_range"].includes(String(content.source_scope.scope_type)) ||
      typeof content.source_scope.source_manifest_version_id !== "string" ||
      !VERSION_ID_PATTERN.test(content.source_scope.source_manifest_version_id) ||
      !Array.isArray(content.source_scope.documents) ||
      !content.source_scope.documents.every(
        (document) =>
          isRecord(document) &&
          hasOnlyKeys(document, [
            "source_document_id",
            "raw_sha256",
            "source_block_ids",
            "chapter_indices",
          ]) &&
          typeof document.source_document_id === "string" &&
          SOURCE_ID_PATTERN.test(document.source_document_id) &&
          typeof document.raw_sha256 === "string" &&
          SHA256_PATTERN.test(document.raw_sha256) &&
          isIdArray(document.source_block_ids, SOURCE_BLOCK_ID_PATTERN) &&
          Array.isArray(document.chapter_indices) &&
          document.chapter_indices.every(
            (chapter) => Number.isInteger(chapter) && Number(chapter) >= 1,
          ),
      ) ||
      !isStringArray(content.source_scope.exclusions) ||
      !Array.isArray(content.entities) ||
      content.entities.length < 1 ||
      content.entities.length > 2000 ||
      !content.entities.every(isStoryEntity) ||
      !Array.isArray(content.facts) ||
      content.facts.length < 1 ||
      content.facts.length > 20000 ||
      !content.facts.every(isStoryFact) ||
      !Array.isArray(content.questions) ||
      content.questions.length > 2000 ||
      !content.questions.every(isStoryQuestion) ||
      !Array.isArray(content.conflicts) ||
      content.conflicts.length > 2000 ||
      !content.conflicts.every(isStoryConflict) ||
      candidate.source_spans.length > 20000 ||
      !candidate.source_spans.every(isStorySourceSpan)
    ) {
      return false;
    }
    const factIds = new Set(
      content.facts.map((fact) => (fact as Record<string, unknown>).fact_id as string),
    );
    const entityIds = new Set(
      content.entities.map((entity) => (entity as Record<string, unknown>).entity_id as string),
    );
    if (factIds.size !== content.facts.length || entityIds.size !== content.entities.length) {
      return false;
    }
    const documentIds = new Set(
      content.source_scope.documents.map(
        (document) => (document as Record<string, unknown>).source_document_id as string,
      ),
    );
    return candidate.source_spans.every((span) => {
      const checked = span as Record<string, unknown>;
      return (
        factIds.has(checked.fact_id as string) &&
        documentIds.has(checked.source_document_id as string)
      );
    });
  };

  return (
    isStoryVersion(version) &&
    version.artifact_id === head.artifact_id &&
    version.id === expectedVersionId
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

export class DevelopmentExportGetError extends Error {
  constructor(
    readonly kind: "REMOTE_UNKNOWN" | "UNAVAILABLE",
    readonly status?: number,
    readonly code?: string,
  ) {
    super(status === undefined
      ? "Development export receipt could not be confirmed"
      : `Development export receipt request failed with status ${status}${code ? ` (${code})` : ""}`);
    this.name = "DevelopmentExportGetError";
  }
}

export function createLocalApiClient(
  fetcher: Fetcher,
  session: SidecarApiSession,
): LocalApiClient & SourceManifestReviewClient {
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

  async function readJsonWithLimit(
    response: Response,
    deadline?: { wait: <T>(pending: Promise<T>) => Promise<T> },
  ): Promise<unknown> {
    const contentLength = response.headers.get("Content-Length");
    if (contentLength && /^\d+$/.test(contentLength)) {
      const declaredBytes = Number(contentLength);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_LOCAL_API_JSON_BYTES) {
        throw new Error("Local API response exceeds the desktop safety limit");
      }
    }
    if (!response.body) {
      const pending = response.arrayBuffer();
      const bytes = new Uint8Array(await (deadline ? deadline.wait(pending) : pending));
      if (bytes.byteLength > MAX_LOCAL_API_JSON_BYTES) {
        throw new Error("Local API response exceeds the desktop safety limit");
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const pending = reader.read();
        const { done, value } = await (deadline ? deadline.wait(pending) : pending);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_LOCAL_API_JSON_BYTES) {
          if (!deadline) await reader.cancel("response too large");
          throw new Error("Local API response exceeds the desktop safety limit");
        }
        chunks.push(value);
      }
    } finally {
      if (deadline) {
        // Cleanup must not await an uncooperative stream's cancel promise.
        try {
          void reader.cancel().catch(() => {});
        } catch {
          /* best effort */
        }
      }
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  async function requestSourceReview<T>(
    path: string,
    validator: (value: unknown) => value is T,
    expectedRevision: number,
    body?: unknown,
    successStatus = 200,
    phase: "get" | "review" | "copy" = "get",
    responseRevision = expectedRevision,
  ): Promise<SourceManifestReviewResult<T>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Source review deadline"));
        controller.abort();
      }, 15_000);
    });
    const wait = <V>(pending: Promise<V>): Promise<V> => Promise.race([pending, expired]);
    let response: Response | undefined;
    const cancelBody = (value: Response) => {
      try {
        void value.body?.cancel().catch(() => {});
      } catch {
        /* best effort */
      }
    };
    try {
      const pending = fetcher(`${origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? headers
            : {
                ...headers,
                "Content-Type": "application/json",
                "If-Match": `"revision-${expectedRevision}"`,
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      // A fetch implementation can ignore abort and return a body after we have returned.
      void pending.then(
        (late) => {
          if (controller.signal.aborted) cancelBody(late);
        },
        () => {},
      );
      response = await wait(pending);
      const payload = await readJsonWithLimit(response, { wait });
      if (response.status !== successStatus) {
        const code = sourceReviewErrorCode(response.status, payload, phase);
        return code && isErrorResponse(payload)
          ? {
              kind: "DEFINITE_SERVER_ERROR",
              status: response.status,
              code,
              request_id: payload.request_id,
            }
          : { kind: "REMOTE_UNKNOWN" };
      }
      return response.headers.get("ETag") === `"revision-${responseRevision}"` && validator(payload)
        ? { kind: "SUCCEEDED", receipt: payload }
        : { kind: "REMOTE_UNKNOWN" };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    } finally {
      clearTimeout(timer!);
      controller.abort();
      if (response) cancelBody(response);
    }
  }

  async function prepareSourceReview(
    input: SourceManifestReviewTarget,
    action: SourceReviewAction,
    reportInput?: SourceManifestReviewReport,
    rationale?: string,
  ): Promise<SourceManifestReviewResult<SourceManifestPreparedReview>> {
    const target = reviewTargetSnapshot(input);
    if (
      !target ||
      (action !== "submit" && target.review_version_id !== target.version_id) ||
      (action === "decision" &&
        (!isReviewRationale(rationale) || !isSourceReviewReport(reportInput, target, action)))
    )
      return { kind: "INVALID_INPUT" };
    const report = reportInput === undefined ? undefined : structuredClone(reportInput);
    const body: ReviewSchemas["EmptyActionRequest"] | ReviewSchemas["PrepareGateDecisionRequest"] =
      action === "decision"
        ? { decision: "approved", rationale: rationale!, readiness_report_id: report!.id }
        : {};
    return requestSourceReview(
      `/api/v1/internal/projects/${target.project_id}/source-manifest/versions/${target.version_id}:prepare-${action}`,
      (payload): payload is SourceManifestPreparedReview =>
        isPreparedSourceReview(payload, target, action, report),
      target.expected_revision,
      body,
      200,
      "review",
    );
  }

  async function consumeSourceReview<T>(
    input: SourceManifestReviewTarget,
    preparedInput: SourceManifestPreparedReview,
    action: SourceReviewAction,
    validator: (
      payload: unknown,
      target: SourceManifestReviewTarget,
      prepared: SourceManifestPreparedReview,
    ) => payload is T,
    rationale?: string,
  ): Promise<SourceManifestReviewResult<T>> {
    const target = reviewTargetSnapshot(input);
    if (
      !target ||
      !isPreparedSourceReview(preparedInput, target, action) ||
      (action === "decision" && !isReviewRationale(rationale))
    )
      return { kind: "INVALID_INPUT" };
    const prepared = structuredClone(preparedInput);
    const confirmation: ReviewSchemas["ConfirmationRequest"] = {
      challenge_id: prepared.data.challenge.id,
      confirmation_token: prepared.data.confirmation_token,
    };
    const body: ReviewSchemas["ConfirmationRequest"] | ReviewSchemas["GateDecisionRequest"] =
      action === "decision"
        ? { ...confirmation, decision: "approved", rationale: rationale! }
        : confirmation;
    const suffix =
      action === "submit" ? ":submit" : action === "signoff" ? "/signoffs" : "/decisions";
    return requestSourceReview(
      `/api/v1/internal/projects/${target.project_id}/source-manifest/versions/${target.version_id}${suffix}`,
      (payload): payload is T => validator(payload, target, prepared),
      target.expected_revision,
      body,
      200,
      "review",
      target.expected_revision + 1,
    );
  }

  async function requestJson<T>(
    path: string,
    validator: (value: unknown) => value is T,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetcher(`${origin}${path}`, init);
    if (!response.ok) {
      let errorPayload: unknown;
      try {
        errorPayload = await readJsonWithLimit(response);
      } catch {
        throw new Error(`Local API request failed with status ${response.status}`);
      }
      const code = isErrorResponse(errorPayload) ? ` (${errorPayload.error.code})` : "";
      throw new Error(`Local API request failed with status ${response.status}${code}`);
    }
    const payload = await readJsonWithLimit(response);
    if (!validator(payload)) {
      throw new Error("Local API response does not match the published contract");
    }
    return payload;
  }

  async function readBoundedScriptHttp(
    path: string, init: RequestInit,
  ): Promise<{ status: number; payload: unknown; requestId: string | null;
    etag: string | null } | null> {
    try {
      const response = await fetcher(`${origin}${path}`, {
        ...init, signal: AbortSignal.timeout(15_000),
      });
      const payload = await readJsonWithLimit(response);
      return {
        status: response.status, payload,
        requestId: response.headers.get("X-Request-ID"),
        etag: response.headers.get("ETag"),
      };
    } catch {
      return null;
    }
  }

  async function requestSub2APIMutationHttp(
    path: string, init: RequestInit,
  ): Promise<{ status: number; payload: unknown; requestId: string | null } | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Sub2API mutation deadline"));
      }, 15_000);
    });
    const wait = <T>(pending: Promise<T>): Promise<T> => Promise.race([pending, deadline]);
    try {
      const response = await wait(fetcher(`${origin}${path}`, {
        ...init, signal: controller.signal,
      }));
      const payload = await readJsonWithLimit(response, { wait });
      return {
        status: response.status, payload,
        requestId: response.headers.get("X-Request-ID"),
      };
    } catch {
      return null;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function requestProductionBriefRead<T>(
    path: string,
    validator: (value: unknown) => value is T,
    absent: boolean,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("ProductionBrief read could not be completed");
    }
    let payload: unknown;
    try {
      payload = await readJsonWithLimit(response);
    } catch {
      throw new Error("ProductionBrief read could not be completed");
    }
    if (response.status === 404 && absent && isProductionBriefMissingError(payload, response))
      return null;
    if (
      response.status !== 200 ||
      !isRecord(payload) ||
      !hasRequestId(payload) ||
      response.headers.get("X-Request-ID") !== payload.request_id ||
      !validator(payload)
    )
      throw new Error("ProductionBrief read could not be completed");
    return payload;
  }

  function hasMatchingProductionBriefRequestId(value: unknown, response: Response): boolean {
    return (
      isRecord(value) &&
      hasRequestId(value) &&
      response.headers.get("X-Request-ID") === value.request_id
    );
  }

  function isProductionBriefMissingError(value: unknown, response: Response): boolean {
    if (
      !hasMatchingProductionBriefRequestId(value, response) ||
      !isRecord(value) ||
      !isRecord(value.error)
    )
      return false;
    return (
      hasOnlyKeys(value, ["error", "request_id"]) &&
      hasOnlyKeys(value.error, ["code", "message", "retryable", "details"]) &&
      value.error.code === "ARTIFACT_NOT_FOUND" &&
      typeof value.error.message === "string" &&
      typeof value.error.retryable === "boolean" &&
      isRecord(value.error.details) &&
      Object.values(value.error.details).every((detail) => typeof detail === "string")
    );
  }

  function productionBriefReceiptMatches(
    value: unknown,
    projectId: string,
    command: NormalizedProductionBriefCreateCommand,
  ): value is ProductionBriefResponse {
    if (!isProductionBriefResponse(value, projectId)) return false;
    const version = value.data.version;
    return (
      version.parent_version_id === command.input.parent_version_id &&
      version.change_summary === command.input.change_summary &&
      sameProductionBriefJson(version.content, command.input.content)
    );
  }

  function sameProductionBriefJson(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
      return (
        left.length === right.length &&
        left.every((item, index) => sameProductionBriefJson(item, right[index]))
      );
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) => Object.hasOwn(right, key) && sameProductionBriefJson(left[key], right[key]),
      )
    );
  }

  function hasMatchingEpisodeRequestId(value: unknown, response: Response): boolean {
    return (
      isRecord(value) &&
      hasRequestId(value) &&
      response.headers.get("X-Request-ID") === value.request_id
    );
  }

  async function requestEpisodeJson<T>(
    path: string,
    validator: (value: unknown) => value is T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Local API Episode request could not be completed");
    }
    if (response.status !== 200) {
      throw new Error("Local API Episode request could not be completed");
    }
    try {
      const payload = await readJsonWithLimit(response);
      if (!hasMatchingEpisodeRequestId(payload, response) || !validator(payload)) {
        throw new Error("Local API response does not match the published contract");
      }
      return payload;
    } catch {
      throw new Error("Local API Episode request could not be completed");
    }
  }

  async function requestEpisodeCreation(
    projectId: string,
    input: CreateEpisodeInput,
  ): Promise<EpisodeCreateResult> {
    let response: Response;
    try {
      response = await fetcher(`${origin}/api/v1/projects/${projectId}/episodes`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    try {
      const payload = await readJsonWithLimit(response);
      if (!hasMatchingEpisodeRequestId(payload, response)) return { kind: "REMOTE_UNKNOWN" };
      if (response.status === 201) {
        return isEpisodeResponse(payload, projectId)
          ? { kind: "SUCCEEDED", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      }
      if (
        !isEpisodeDefiniteStatus(response.status) ||
        !isEpisodeCreateErrorResponse(payload, response.status)
      ) {
        return { kind: "REMOTE_UNKNOWN" };
      }
      return {
        kind: "DEFINITE_SERVER_ERROR",
        status: response.status,
        code: payload.error.code,
        request_id: payload.request_id,
      };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  async function requestProposalDecision<TReceipt>(
    path: string,
    idempotencyKey: string,
    input: ArtifactProposalDraftAcceptanceInput | ArtifactProposalRejectionInput,
    validator: (value: unknown) => value is TReceipt,
  ): Promise<ArtifactProposalDecisionResult<TReceipt>> {
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (response.ok) {
      try {
        const payload = await readJsonWithLimit(response);
        return validator(payload)
          ? { kind: "SUCCEEDED", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    }
    if (!DEFINITE_DECISION_STATUSES.has(response.status)) {
      return { kind: "REMOTE_UNKNOWN" };
    }
    try {
      const payload = await readJsonWithLimit(response);
      if (!isErrorResponse(payload)) return { kind: "REMOTE_UNKNOWN" };
      return {
        kind: "DEFINITE_SERVER_ERROR",
        status: response.status,
        code: payload.error.code,
        request_id: payload.request_id,
      };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  async function requestProposalRunCreation(
    projectId: string,
    command: ProposalRunCreateCommand,
  ): Promise<ProposalRunCreateResult> {
    let response: Response;
    try {
      response = await fetcher(`${origin}/api/v1/projects/${projectId}/proposal-runs`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": proposalRunIdempotencyKey(command),
        },
        body: JSON.stringify(command.input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (response.status === 200 || response.status === 201) {
      try {
        const payload = await readJsonWithLimit(response);
        return isCreatedProposalRunResponse(payload, projectId, command, response.status === 201)
          ? { kind: "SUCCEEDED", receipt: payload, replayed: response.status === 200 }
          : { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    }
    if (!DEFINITE_DECISION_STATUSES.has(response.status)) return { kind: "REMOTE_UNKNOWN" };
    try {
      const payload = await readJsonWithLimit(response);
      if (
        !isErrorResponse(payload) ||
        !hasOnlyKeys(payload, ["error", "request_id"]) ||
        !hasOnlyKeys(payload.error, ["code", "message", "retryable", "details"])
      ) {
        return { kind: "REMOTE_UNKNOWN" };
      }
      return {
        kind: "DEFINITE_SERVER_ERROR",
        status: response.status,
        code: payload.error.code,
        request_id: payload.request_id,
      };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  function remoteSourceExtractError(status: number, payload: unknown): {
    code: string; request_id: string;
  } | null {
    if (!isErrorResponse(payload) ||
        !hasExactKeys(payload, ["error", "request_id"]) ||
        !hasExactKeys(payload.error, ["code", "message", "retryable", "details"]) ||
        payload.error.retryable !== false ||
        Object.keys(payload.error.details).length !== 0) return null;
    const code = payload.error.code;
    const known =
      (status === 401 && code === "SIDECAR_AUTH_REQUIRED") ||
      (status === 403 && code === "SIDECAR_REQUEST_REJECTED") ||
      (status === 404 && (code === "PROJECT_NOT_FOUND" || code === "SOURCE_MANIFEST_NOT_FOUND" ||
        code === "PROPOSAL_RUN_NOT_FOUND")) ||
      (status === 409 && (code === "PROPOSAL_RUN_INPUT_REJECTED" ||
        code === "IDEMPOTENCY_KEY_REUSED")) ||
      (status === 422 && code === "VALIDATION_ERROR");
    return known ? { code, request_id: payload.request_id } : null;
  }

  async function requestRemoteSourceExtractCreation(
    projectId: string,
    command: RemoteSourceExtractCreateCommand,
  ): Promise<RemoteSourceExtractCreateResult> {
    let response: Response;
    try {
      response = await fetcher(`${origin}/api/v1/projects/${projectId}/remote-source-extract-runs`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": remoteSourceExtractIdempotencyKey(command),
        },
        body: JSON.stringify(command.input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (response.status === 200 || response.status === 201) {
      try {
        const payload = await readJsonWithLimit(response);
        return isRemoteSourceExtractCreatedResponse(payload, projectId, command,
          response.status === 201)
          ? { kind: "QUEUED", receipt: payload, replayed: response.status === 200 }
          : { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    }
    try {
      const payload = await readJsonWithLimit(response);
      const error = remoteSourceExtractError(response.status, payload);
      return error && error.code !== "PROPOSAL_RUN_NOT_FOUND"
        ? { kind: "DEFINITE_SERVER_ERROR", status: response.status, ...error }
        : { kind: "REMOTE_UNKNOWN" };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  async function requestOriginalRemoteSourceExtractRun(
    projectId: string,
    originalCommand: RemoteSourceExtractCreateCommand,
  ): Promise<RemoteSourceExtractOriginalRunResult> {
    const unknown = (): RemoteSourceExtractOriginalRunResult =>
      ({ kind: "REMOTE_UNKNOWN", binding: "UNVERIFIED" });
    let response: Response;
    try {
      response = await fetcher(
        `${origin}/api/v1/projects/${projectId}/proposal-runs/${remoteSourceExtractRunId(projectId, originalCommand)}`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      return unknown();
    }
    try {
      const payload = await readJsonWithLimit(response);
      if (response.status === 200) {
        return isRemoteSourceExtractOriginalRunResponse(payload, projectId, originalCommand)
          ? { kind: "FOUND_RUN", receipt: payload, binding: "UNVERIFIED" }
          : unknown();
      }
      const error = remoteSourceExtractError(response.status, payload);
      return response.status === 404 && error?.code === "PROPOSAL_RUN_NOT_FOUND"
        ? { kind: "NOT_FOUND", binding: "UNVERIFIED" }
        : unknown();
    } catch {
      return unknown();
    }
  }

  async function requestSourceExtraction(
    projectId: string,
    versionId?: string,
  ): Promise<SourceExtractionReadResult> {
    const path = versionId === undefined
      ? `/api/v1/projects/${projectId}/source-extraction`
      : `/api/v1/projects/${projectId}/source-extraction/versions/${versionId}`;
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, {
        headers, signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    let payload: unknown;
    try {
      payload = await readJsonWithLimit(response);
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (response.status === 200) {
      if (!isSourceExtractionResponse(payload, projectId, versionId)) {
        return { kind: "REMOTE_UNKNOWN" };
      }
      const expectedEtag = versionId === undefined
        ? `"revision-${payload.data.head.revision}"`
        : `"${payload.data.version.content_hash}"`;
      return response.headers.get("ETag") === expectedEtag
        ? { kind: "FOUND", receipt: payload }
        : { kind: "REMOTE_UNKNOWN" };
    }
    if (!isErrorResponse(payload) ||
        !hasExactKeys(payload, ["error", "request_id"]) ||
        !hasExactKeys(payload.error, ["code", "message", "retryable", "details"]) ||
        payload.error.retryable !== false ||
        Object.keys(payload.error.details).length !== 0) return { kind: "REMOTE_UNKNOWN" };
    if (response.status === 404 && payload.error.code === "SOURCE_EXTRACTION_NOT_FOUND") {
      return { kind: "NOT_FOUND" };
    }
    if (response.status === 409 && payload.error.code === "SOURCE_EXTRACTION_INCONSISTENT") {
      return { kind: "INCONSISTENT", request_id: payload.request_id };
    }
    return { kind: "REMOTE_UNKNOWN" };
  }

  async function requestFakeTimelineRunCreation(
    projectId: string,
    command: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunCreateResult> {
    let response: Response;
    try {
      response = await fetcher(`${origin}/api/v1/projects/${projectId}/fake-timeline-runs`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": fakeTimelineRunIdempotencyKey(command),
        },
        body: JSON.stringify(command.input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    if (response.status === 200 || response.status === 201) {
      try {
        const payload = await readJsonWithLimit(response);
        return isFakeTimelineRunResponse(payload, projectId, command, response.status === 201)
          ? { kind: "SUCCEEDED", receipt: payload, replayed: response.status === 200 }
          : { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    }
    const definiteStatus =
      DEFINITE_DECISION_STATUSES.has(response.status) || response.status === 503;
    if (!definiteStatus) return { kind: "REMOTE_UNKNOWN" };
    try {
      const payload = await readJsonWithLimit(response);
      if (
        !isErrorResponse(payload) ||
        !hasOnlyKeys(payload, ["error", "request_id"]) ||
        !hasOnlyKeys(payload.error, ["code", "message", "retryable", "details"])
      ) {
        return { kind: "REMOTE_UNKNOWN" };
      }
      if (response.status === 503 && payload.error.code !== "FAKE_TIMELINE_RUNTIME_UNAVAILABLE") {
        return { kind: "REMOTE_UNKNOWN" };
      }
      return {
        kind: "DEFINITE_SERVER_ERROR",
        status: response.status,
        code: payload.error.code,
        request_id: payload.request_id,
      };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  async function requestFakeTimelineRunOperation(
    projectId: string,
    originalCommand: FakeTimelineRunCreateCommand,
  ): Promise<FakeTimelineRunOperationQueryResult> {
    const operationId = originalCommand.operation_id;
    const unknown = (): FakeTimelineRunOperationQueryResult =>
      ({ kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: operationId });
    let response: Response;
    try {
      response = await fetcher(
        `${origin}/api/v1/projects/${projectId}/fake-timeline-runs/operations/${operationId}`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      return unknown();
    }
    if (response.status === 200) {
      try {
        const payload = await readJsonWithLimit(response);
        return isFakeTimelineRunOperationResponse(payload, projectId, originalCommand)
          ? { kind: "FOUND", receipt: payload }
          : unknown();
      } catch {
        return unknown();
      }
    }
    if (!DEFINITE_DECISION_STATUSES.has(response.status)) return unknown();
    try {
      const payload = await readJsonWithLimit(response);
      if (!isErrorResponse(payload) ||
          !hasOnlyKeys(payload, ["error", "request_id"]) ||
          !hasOnlyKeys(payload.error, ["code", "message", "retryable", "details"])) {
        return unknown();
      }
      if (response.status === 404 &&
          payload.error.code === "FAKE_TIMELINE_OPERATION_NOT_FOUND") {
        return { kind: "NOT_FOUND", project_id: projectId, operation_id: operationId };
      }
      return { kind: "DEFINITE_SERVER_ERROR", project_id: projectId,
        operation_id: operationId, status: response.status,
        code: payload.error.code, request_id: payload.request_id };
    } catch {
      return unknown();
    }
  }

  async function requestProductionBriefCreation(
    projectId: string,
    command: NormalizedProductionBriefCreateCommand,
  ): Promise<ProductionBriefCreateResult> {
    try {
      const response = await fetcher(
        `${origin}/api/v1/projects/${projectId}/production-brief/versions`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": productionBriefIdempotencyKey(projectId, command),
          },
          body: JSON.stringify(command.input),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.status === 201) {
        const payload = await readJsonWithLimit(response);
        return productionBriefReceiptMatches(payload, projectId, command) &&
          response.headers.get("X-Request-ID") === payload.request_id
          ? { kind: "SUCCEEDED", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      }
      if (![409, 422, 428].includes(response.status)) return { kind: "REMOTE_UNKNOWN" };
      const payload = await readJsonWithLimit(response);
      return hasMatchingProductionBriefRequestId(payload, response)
        ? (productionBriefSafeError(payload, response.status) ?? { kind: "REMOTE_UNKNOWN" })
        : { kind: "REMOTE_UNKNOWN" };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  async function requestOptionalJson<T>(
    path: string,
    validator: (value: unknown) => value is T,
    absentCode:
      | "SOURCE_MANIFEST_NOT_FOUND"
      | "STORY_BIBLE_NOT_FOUND"
      | "TIMELINE_NOT_FOUND"
      | "ARTIFACT_NOT_FOUND",
  ): Promise<T | null> {
    const response = await fetcher(`${origin}${path}`, { headers });
    if (response.status === 404) {
      let errorPayload: unknown;
      try {
        errorPayload = await readJsonWithLimit(response);
      } catch {
        throw new Error("Local API 404 response does not match the published error contract");
      }
      if (!isErrorResponse(errorPayload)) {
        throw new Error("Local API 404 response does not match the published error contract");
      }
      if (errorPayload.error.code === absentCode) return null;
      throw new Error(`Local API request failed with status 404 (${errorPayload.error.code})`);
    }
    if (!response.ok) {
      throw new Error(`Local API request failed with status ${response.status}`);
    }
    const payload = await readJsonWithLimit(response);
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

  async function requestSub2APIOperation(
    projectId: string,
    command: Sub2APIQueueCommand,
  ): Promise<Sub2APIOperationReadResult> {
    const runId = sub2APIRunId(projectId, command);
    let response: Response;
    try {
      response = await fetcher(
        `${origin}/api/v1/projects/${projectId}/sub2api-source-extract-runs/${runId}/operation`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    try {
      const payload = await readJsonWithLimit(response);
      const requestId = response.headers.get("X-Request-ID");
      if (response.status === 200) {
        return isSub2APIOperationResponse(payload, projectId, command, requestId)
          ? { kind: "FOUND", runId, receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      }
      const error = sub2APIDefiniteError(response.status, payload, requestId);
      return error?.status === 404 && error.code === "SUB2API_RUN_NOT_FOUND"
        ? { kind: "NOT_FOUND", request_id: error.request_id }
        : error ?? { kind: "REMOTE_UNKNOWN" };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  async function requestSub2APIApprovalRead(
    projectId: string,
    command: Sub2APIQueueCommand,
  ): Promise<Sub2APIApprovalReadResult> {
    const runId = sub2APIRunId(projectId, command);
    let response: Response;
    try {
      response = await fetcher(
        `${origin}/api/v1/projects/${projectId}/sub2api-source-extract-runs/${runId}/approval`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
    try {
      const payload = await readJsonWithLimit(response);
      const requestId = response.headers.get("X-Request-ID");
      if (response.status === 200) {
        return isSub2APIApprovalResponse(payload, projectId, command, requestId)
          ? { kind: "FOUND", receipt: payload }
          : { kind: "REMOTE_UNKNOWN" };
      }
      const error = sub2APIDefiniteError(response.status, payload, requestId);
      return error?.status === 404 && error.code === "SUB2API_APPROVAL_NOT_FOUND"
        ? { kind: "NOT_FOUND", request_id: error.request_id }
        : error ?? { kind: "REMOTE_UNKNOWN" };
    } catch {
      return { kind: "REMOTE_UNKNOWN" };
    }
  }

  return {
    prepareSourceManifestSubmit: (input) => prepareSourceReview(input, "submit"),
    submitSourceManifestReview: (input, prepared) =>
      consumeSourceReview(input, prepared, "submit", isSourceSubmissionReceipt),
    prepareSourceManifestSignoff: (input) => prepareSourceReview(input, "signoff"),
    signoffSourceManifestReview: (input, prepared) =>
      consumeSourceReview(input, prepared, "signoff", isSourceSignoffReceipt),
    prepareSourceManifestDecision: (input, report, rationale) =>
      prepareSourceReview(input, "decision", report, rationale),
    decideSourceManifestReview: (input, prepared, rationale) =>
      consumeSourceReview(
        input,
        prepared,
        "decision",
        (payload, target, snapshot): payload is SourceManifestDecisionReceipt =>
          isSourceDecisionReceipt(payload, target, snapshot, rationale),
        rationale,
      ),
    async copySourceManifestDraft(input) {
      const target = reviewTargetSnapshot(input);
      if (!target) return { kind: "INVALID_INPUT" };
      return requestSourceReview(
        `/api/v1/internal/projects/${target.project_id}/source-manifest/versions/${target.version_id}:copy-draft`,
        (payload): payload is SourceManifestResponse =>
          isStrictReviewManifest(payload, target.project_id) &&
          payload.data.head.artifact_id === target.artifact_id &&
          payload.data.head.revision === target.expected_revision + 1 &&
          payload.data.head.review_evidence_revision === target.review_evidence_revision &&
          payload.data.head.review_version_id === target.review_version_id &&
          payload.data.head.review_submission_id === target.review_submission_id &&
          payload.data.head.accepted_version_id === target.accepted_version_id &&
          payload.data.latest_version.id !== target.version_id &&
          payload.data.latest_version.parent_version_id === target.version_id &&
          payload.data.latest_version.version_number === target.version_number + 1 &&
          payload.data.latest_version.content_hash === target.content_hash,
        target.expected_revision,
        {},
        201,
        "copy",
        target.expected_revision + 1,
      );
    },
    async getSourceManifestForReview(input) {
      if (!hasExactKeys(input, REVIEW_IDENTITY_KEYS) || !isReviewIdentity(input))
        return { kind: "INVALID_INPUT" };
      const identity = { ...input };
      return requestSourceReview(
        `/api/v1/projects/${identity.project_id}/source-manifest`,
        (payload): payload is SourceManifestResponse =>
          isStrictReviewManifest(payload, identity.project_id) &&
          payload.data.head.revision === identity.expected_revision &&
          payload.data.latest_version.id === identity.version_id &&
          payload.data.latest_version.content_hash === identity.content_hash,
        identity.expected_revision,
      );
    },
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
      const payload = await readJsonWithLimit(response);
      if (!isHealthResponse(payload)) {
        throw new Error("Local API health response does not match the published contract");
      }
      return payload;
    },
    async getAppPreferences(): Promise<AppPreferencesReadResult> {
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/app-preferences`, {
          headers, signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isAppPreferencesResponse(payload, requestId, response.headers.get("ETag"))
            ? { kind: "FOUND", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return appPreferencesDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async saveAppPreferences(command: SaveAppPreferencesCommand): Promise<AppPreferencesSaveResult> {
      if (!isSaveAppPreferencesCommand(command)) {
        throw new Error("Local API client requires a canonical app preferences command");
      }
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/app-preferences`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isAppPreferencesResponse(payload, requestId, response.headers.get("ETag")) &&
            payload.data.saved && payload.data.revision === command.expected_revision + 1 &&
            payload.data.user_name === command.user_name &&
            payload.data.display_bio === command.display_bio &&
            payload.data.ui_language === command.ui_language &&
            payload.data.ui_theme === command.ui_theme
            ? { kind: "SAVED", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return appPreferencesDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async listProjectMediaAssets(projectId: string): Promise<MediaAssetListResult> {
      if (!isMediaProjectId(projectId)) throw new Error("Media asset list requires a project id");
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}/assets`, {
          headers, signal: AbortSignal.timeout(5 * 60 * 1000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isMediaAssetListResponse(payload, projectId, requestId)
            ? { kind: "LISTED", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return mediaAssetDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async getProjectMediaAsset(projectId: string, assetId: string): Promise<MediaAssetReadResult> {
      if (!isMediaProjectId(projectId) || !isMediaAssetId(assetId)) {
        throw new Error("Media asset read requires canonical ids");
      }
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}/assets/${assetId}`, {
          headers, signal: AbortSignal.timeout(30 * 60 * 1000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isMediaAssetResponse(payload, projectId, requestId, assetId)
            ? { kind: "FOUND", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return mediaAssetDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async importProjectMediaAssetFile(
      projectId: string, assetId: string | null, selectedPath: string,
    ): Promise<MediaAssetImportResult> {
      if (!isMediaProjectId(projectId) || (assetId !== null && !isMediaAssetId(assetId)) ||
          typeof selectedPath !== "string" || selectedPath.length === 0) {
        throw new Error("Media asset import requires canonical main-process arguments");
      }
      let filename: string;
      try {
        filename = basename(selectedPath);
        if (filename.length === 0 || filename === "." || filename === ".." ||
            [...filename].length > 255 || [...filename].some((char) =>
              (char.codePointAt(0) ?? 0) < 32) ||
            encodeURIComponent(filename).length > 1024) {
          return { kind: "LOCAL_FILE_REJECTED", code: "INVALID_FILE" };
        }
      } catch {
        return { kind: "LOCAL_FILE_REJECTED", code: "INVALID_FILE" };
      }
      let file: Awaited<ReturnType<typeof open>>;
      try {
        file = await open(selectedPath, "r");
      } catch {
        return { kind: "LOCAL_FILE_REJECTED", code: "INVALID_FILE" };
      }
      let response: Response;
      try {
        const info = await file.stat().catch(() => null);
        if (info === null) {
          return { kind: "LOCAL_FILE_REJECTED", code: "INVALID_FILE" };
        }
        if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0) {
          return { kind: "LOCAL_FILE_REJECTED", code: "INVALID_FILE" };
        }
        if (info.size > 20 * 1024 * 1024 * 1024) {
          return { kind: "LOCAL_FILE_REJECTED", code: "FILE_TOO_LARGE" };
        }
        const stream = file.createReadStream({ autoClose: false });
        try {
          const path = assetId === null
            ? `/api/v1/projects/${projectId}/assets/import`
            : `/api/v1/projects/${projectId}/assets/${assetId}/versions/import`;
          response = await fetcher(`${origin}${path}`, {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/octet-stream",
              "Content-Length": String(info.size),
              "X-Aivora-Filename": encodeURIComponent(filename),
            },
            body: stream as unknown as RequestInit["body"],
            duplex: "half",
            signal: AbortSignal.timeout(30 * 60 * 1000),
          } as RequestInit);
        } finally {
          stream.destroy();
        }
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      } finally {
        await file.close().catch(() => {});
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 201) {
          return isMediaAssetResponse(payload, projectId, requestId, assetId ?? undefined)
            ? { kind: "IMPORTED", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return mediaAssetDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async readProjectMediaAssetPreview(
      projectId: string, assetId: string, versionId: string,
    ): Promise<MediaAssetPreviewResult> {
      if (!isMediaProjectId(projectId) || !isMediaAssetId(assetId) ||
          !isMediaAssetVersionId(versionId)) {
        throw new Error("Media asset preview requires canonical ids");
      }
      const listing = await this.listProjectMediaAssets(projectId);
      if (listing.kind !== "LISTED") return listing;
      const asset = listing.receipt.data.find((item) => item.id === assetId);
      const version = asset?.versions.find((item) => item.id === versionId);
      if (version === undefined) return { kind: "REMOTE_UNKNOWN" };
      let response: Response;
      try {
        response = await fetcher(
          `${origin}/api/v1/projects/${projectId}/assets/${assetId}/versions/${versionId}/content`,
          { headers, signal: AbortSignal.timeout(60_000) },
        );
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      if (response.status !== 200) {
        try {
          const payload = await readJsonWithLimit(response);
          return mediaAssetDefiniteError(
            response.status, payload, response.headers.get("X-Request-ID"),
          ) ?? { kind: "REMOTE_UNKNOWN" };
        } catch {
          return { kind: "REMOTE_UNKNOWN" };
        }
      }
      if (response.headers.get("ETag") !== `"sha256-${version.sha256}"` ||
          response.headers.get("Content-Type") !== version.mime_type ||
          version.byte_size > 32 * 1024 * 1024) return { kind: "REMOTE_UNKNOWN" };
      try {
        const declared = response.headers.get("Content-Length");
        if (declared !== null && (!/^\d+$/.test(declared) ||
            Number(declared) > 32 * 1024 * 1024)) return { kind: "REMOTE_UNKNOWN" };
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (response.body === null) return { kind: "REMOTE_UNKNOWN" };
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 32 * 1024 * 1024) return { kind: "REMOTE_UNKNOWN" };
            chunks.push(value);
          }
        } finally {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (size !== version.byte_size) return { kind: "REMOTE_UNKNOWN" };
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (createHash("sha256").update(bytes).digest("hex") !== version.sha256) {
          return { kind: "REMOTE_UNKNOWN" };
        }
        return { kind: "READY", mime_type: version.mime_type, sha256: version.sha256, bytes };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async addProjectMediaAssetEpisodeReference(
      projectId: string, assetId: string, command: AddMediaAssetReferenceCommand,
    ): Promise<MediaAssetReferenceResult> {
      if (!isMediaProjectId(projectId) || !isMediaAssetId(assetId) ||
          !isAddMediaAssetReferenceCommand(command)) {
        throw new Error("Media asset reference requires canonical arguments");
      }
      let response: Response;
      try {
        response = await fetcher(
          `${origin}/api/v1/projects/${projectId}/assets/${assetId}/episode-references`,
          { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(command), signal: AbortSignal.timeout(15_000) },
        );
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isMediaAssetResponse(payload, projectId, requestId, assetId) &&
            payload.data.episode_references.some((item) =>
              item.episode_id === command.episode_id &&
              item.version_id === command.version_id && item.role === command.role)
            ? { kind: "REFERENCED", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return mediaAssetDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async removeProjectMediaAssetEpisodeReference(
      projectId: string, assetId: string, command: RemoveMediaAssetReferenceCommand,
    ): Promise<MediaAssetUnreferenceResult> {
      if (!isMediaProjectId(projectId) || !isMediaAssetId(assetId) ||
          !isRemoveMediaAssetReferenceCommand(command)) {
        throw new Error("Media asset unreference requires canonical arguments");
      }
      let response: Response;
      try {
        response = await fetcher(
          `${origin}/api/v1/projects/${projectId}/assets/${assetId}` +
            `/episode-references/${command.episode_id}?role=${encodeURIComponent(command.role)}`,
          { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) },
        );
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isMediaAssetResponse(payload, projectId, requestId, assetId) &&
            !payload.data.episode_references.some((item) =>
              item.episode_id === command.episode_id && item.role === command.role)
            ? { kind: "UNREFERENCED", receipt: payload }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return mediaAssetDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async deleteProjectMediaAsset(
      projectId: string, assetId: string,
    ): Promise<MediaAssetDeleteResult> {
      if (!isMediaProjectId(projectId) || !isMediaAssetId(assetId)) {
        throw new Error("Media asset delete requires canonical ids");
      }
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}/assets/${assetId}`, {
          method: "DELETE", headers, signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      if (response.status === 204) return { kind: "DELETED" };
      try {
        const payload = await readJsonWithLimit(response);
        return mediaAssetDefiniteError(
          response.status, payload, response.headers.get("X-Request-ID"),
        ) ?? { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
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
      return requestJson(
        `/api/v1/projects/${projectId}`,
        (value): value is ProjectResponse =>
          isProjectResponse(value) && value.data.id === projectId,
        { headers },
      );
    },
    async updateProject(projectId: string, command: ProjectUpdateCommand): Promise<ProjectUpdateResult> {
      const normalized = normalizeProjectUpdateCommand(command);
      if (!isProjectUpdateId(projectId) || normalized === null) return { kind: "INVALID_INPUT" };
      const body = {
        ...(normalized.name === undefined ? {} : { name: normalized.name }),
        ...(normalized.status === undefined ? {} : { status: normalized.status }),
      };
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}`, {
          method: "PATCH",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "If-Match": `"revision-${normalized.expectedRevision}"`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isProjectUpdateReceipt(
            payload, projectId, normalized, response.headers.get("ETag"), requestId,
          ) ? { kind: "SUCCEEDED", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
        }
        return projectUpdateDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async listEpisodes(
      projectId: string,
      query: EpisodeListQuery = {},
    ): Promise<EpisodeListResponse> {
      if (!isEpisodeProjectId(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      const normalizedQuery = validateEpisodeListQuery(query);
      if (!normalizedQuery) {
        throw new Error("Local API client requires a valid Episode list query");
      }
      const search = new URLSearchParams();
      if (normalizedQuery.limit !== undefined) search.set("limit", String(normalizedQuery.limit));
      if (normalizedQuery.offset !== undefined) search.set("offset", normalizedQuery.offset);
      const suffix = search.size === 0 ? "" : `?${search.toString()}`;
      return requestEpisodeJson(
        `/api/v1/projects/${projectId}/episodes${suffix}`,
        (payload): payload is EpisodeListResponse =>
          isEpisodeListResponse(payload, projectId, normalizedQuery.limit ?? 50),
      );
    },
    async getEpisode(projectId: string, episodeId: string): Promise<EpisodeResponse> {
      if (!isEpisodeProjectId(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!isEpisodeId(episodeId)) {
        throw new Error("Local API client requires a valid Episode id");
      }
      return requestEpisodeJson(
        `/api/v1/projects/${projectId}/episodes/${episodeId}`,
        (payload): payload is EpisodeResponse => isEpisodeResponse(payload, projectId, episodeId),
      );
    },
    async createEpisode(
      projectId: string,
      input: CreateEpisodeInput,
    ): Promise<EpisodeCreateResult> {
      if (!isEpisodeProjectId(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      const normalizedInput = normalizeEpisodeCreateInput(input);
      if (!normalizedInput) {
        throw new Error("Local API client requires a valid Episode input");
      }
      return requestEpisodeCreation(projectId, normalizedInput);
    },
    async listSources(projectId: string): Promise<SourceDocumentListResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources`,
        (payload): payload is SourceDocumentListResponse =>
          isSourceDocumentListResponse(payload, projectId),
        { headers },
      );
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
        (payload): payload is SourceDocumentResponse =>
          isSourceDocumentResponse(payload, projectId, sourceId),
        { headers },
      );
    },
    async getSourceText(projectId: string, sourceId: string): Promise<SourceDocumentTextResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!SOURCE_ID_PATTERN.test(sourceId)) {
        throw new Error("Local API client requires a valid source id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources/${sourceId}/text`,
        (payload): payload is SourceDocumentTextResponse =>
          isSourceDocumentTextResponse(payload, projectId, sourceId),
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
        (payload): payload is SourceDocumentResponse =>
          isSourceDocumentResponse(payload, projectId),
        postInit(input),
      );
    },
    async getSourceManifest(projectId: string): Promise<SourceManifestResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestOptionalJson(
        `/api/v1/projects/${projectId}/source-manifest`,
        (payload): payload is SourceManifestResponse =>
          isSourceManifestResponse(payload, projectId),
        "SOURCE_MANIFEST_NOT_FOUND",
      );
    },
    async getStoryBibleIndex(projectId: string): Promise<StoryBibleIndexResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestOptionalJson(
        `/api/v1/projects/${projectId}/story-bible`,
        (payload): payload is StoryBibleIndexResponse =>
          isStoryBibleIndexResponse(payload, projectId),
        "STORY_BIBLE_NOT_FOUND",
      );
    },
    async getStoryBibleVersion(
      projectId: string,
      versionId: string,
    ): Promise<StoryBibleVersionResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!VERSION_ID_PATTERN.test(versionId)) {
        throw new Error("Local API client requires a valid version id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/story-bible/versions/${versionId}`,
        (payload): payload is StoryBibleVersionResponse =>
          isStoryBibleVersionResponse(payload, projectId, versionId),
        { headers },
      );
    },
    async getProductionBrief(projectId: string): Promise<ProductionBriefResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId))
        throw new Error("Local API client requires a valid project id");
      return requestProductionBriefRead(
        `/api/v1/projects/${projectId}/production-brief`,
        (payload): payload is ProductionBriefResponse =>
          isProductionBriefLatestResponse(payload, projectId),
        true,
      );
    },
    async getProductionBriefVersion(
      projectId: string,
      versionId: string,
    ): Promise<ProductionBriefResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !VERSION_ID_PATTERN.test(versionId))
        throw new Error("Local API client requires a valid ProductionBrief version");
      const response = await requestProductionBriefRead(
        `/api/v1/projects/${projectId}/production-brief/versions/${versionId}`,
        (payload): payload is ProductionBriefResponse =>
          isProductionBriefResponse(payload, projectId, versionId),
        false,
      );
      if (response === null) throw new Error("ProductionBrief read could not be completed");
      return response;
    },
    async createProductionBriefVersion(
      projectId: string,
      command: ProductionBriefCreateCommand,
    ): Promise<ProductionBriefCreateResult> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isProductionBriefCreateCommand(command))
        throw new Error("Local API client requires a valid ProductionBrief command");
      const normalized = normalizeProductionBriefCreateCommand(command);
      if (normalized === null)
        throw new Error("Local API client requires a valid ProductionBrief command");
      return requestProductionBriefCreation(projectId, normalized);
    },
    async listProjectTasks(projectId: string): Promise<TaskQueueResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/tasks`,
        (payload): payload is TaskQueueResponse => isTaskQueueResponse(payload, projectId),
        { headers },
      );
    },
    async createProposalRun(
      projectId: string,
      command: ProposalRunCreateCommand,
    ): Promise<ProposalRunCreateResult> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!isProposalRunCreateCommand(command)) {
        throw new Error("Local API client requires a valid proposal run command");
      }
      return requestProposalRunCreation(projectId, command);
    },
    async createRemoteSourceExtractRun(
      projectId: string,
      command: RemoteSourceExtractCreateCommand,
    ): Promise<RemoteSourceExtractCreateResult> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isRemoteSourceExtractCreateCommand(command)) {
        throw new Error("Local API client requires an exact remote source extract command");
      }
      return requestRemoteSourceExtractCreation(projectId, command);
    },
    async readOriginalRemoteSourceExtractRun(
      projectId: string,
      originalCommand: RemoteSourceExtractCreateCommand,
    ): Promise<RemoteSourceExtractOriginalRunResult> {
      if (!PROJECT_ID_PATTERN.test(projectId) ||
          !isRemoteSourceExtractCreateCommand(originalCommand)) {
        throw new Error("Local API client requires an exact remote source extract identity");
      }
      return requestOriginalRemoteSourceExtractRun(projectId, originalCommand);
    },
    async getSourceExtraction(projectId: string): Promise<SourceExtractionReadResult> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid SourceExtraction project");
      }
      return requestSourceExtraction(projectId);
    },
    async getSourceExtractionVersion(
      projectId: string,
      versionId: string,
    ): Promise<SourceExtractionReadResult> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isSourceExtractionVersionId(versionId)) {
        throw new Error("Local API client requires a valid SourceExtraction version");
      }
      return requestSourceExtraction(projectId, versionId);
    },
    async readVersionedSourceExtractionProposal(
      projectId: string,
      proposalId: string,
    ): Promise<VersionedSourceExtractionProposalReadResult> {
      if (!isVersionedSourceExtractionProposalId(projectId, proposalId)) {
        throw new Error("Local API client requires a valid SourceExtraction proposal identity");
      }
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}/proposals/${proposalId}`, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return classifyVersionedSourceExtractionProposal(
            payload, projectId, proposalId, requestId,
          ) ?? { kind: "REMOTE_UNKNOWN" };
        }
        if (response.status === 404 && isVersionedProposalNotFound(payload, requestId)) {
          return { kind: "NOT_FOUND", request_id: payload.request_id };
        }
        return { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async createSub2APISourceExtractRun(
      projectId: string,
      command: Sub2APIQueueCommand,
    ): Promise<Sub2APIQueueResult> {
      if (!isSub2APIProjectId(projectId) || !isSub2APIQueueCommand(command)) {
        throw new Error("Local API client requires an exact Sub2API queue command");
      }
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}/sub2api-source-extract-runs`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Idempotency-Key": sub2APIQueueIdempotencyKey(command),
          },
          body: JSON.stringify(command.input),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200 || response.status === 201) {
          return isSub2APIQueueReceipt(payload, projectId, command, requestId)
            ? { kind: "QUEUED", receipt: payload, replayed: response.status === 200 }
            : { kind: "REMOTE_UNKNOWN" };
        }
        return sub2APIDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async readOriginalSub2APISourceExtractOperation(
      projectId: string,
      originalCommand: Sub2APIQueueCommand,
    ): Promise<Sub2APIOperationReadResult> {
      if (!isSub2APIProjectId(projectId) || !isSub2APIQueueCommand(originalCommand)) {
        throw new Error("Local API client requires an exact Sub2API operation identity");
      }
      return requestSub2APIOperation(projectId, originalCommand);
    },
    async approveSub2APISourceExtractCall(
      projectId: string,
      originalCommand: Sub2APIQueueCommand,
      approvalCommand: Sub2APIApprovalCommand,
    ): Promise<Sub2APIApprovalResult> {
      if (!isSub2APIProjectId(projectId) || !isSub2APIQueueCommand(originalCommand) ||
          !isSub2APIApprovalCommand(approvalCommand)) {
        throw new Error("Local API client requires an exact one-call approval command");
      }
      const current = await requestSub2APIOperation(projectId, originalCommand);
      if (current.kind === "DEFINITE_SERVER_ERROR") return current;
      if (current.kind === "NOT_FOUND") {
        return {
          kind: "DEFINITE_SERVER_ERROR", status: 404,
          code: "SUB2API_RUN_NOT_FOUND", request_id: current.request_id,
        };
      }
      if (current.kind !== "FOUND" || current.receipt.data.content_status !== "PENDING" ||
          current.receipt.data.approval_id !== null ||
          current.receipt.data.scope.task_id !== approvalCommand.input.task_id ||
          current.receipt.data.scope.attempt_id !== approvalCommand.input.attempt_id ||
          current.receipt.data.scope.attempt_fingerprint !==
            approvalCommand.input.expected_attempt_fingerprint) {
        return { kind: "REMOTE_UNKNOWN" };
      }
      let response: Response;
      try {
        response = await fetcher(
          `${origin}/api/v1/projects/${projectId}/sub2api-source-extract-runs/${current.runId}/approval`,
          {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
              "Idempotency-Key": sub2APIApprovalIdempotencyKey(approvalCommand),
            },
            body: JSON.stringify(approvalCommand.input),
            signal: AbortSignal.timeout(15_000),
          },
        );
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          if (!isSub2APIApprovalResponse(
            payload, projectId, originalCommand, requestId, approvalCommand,
          )) return { kind: "REMOTE_UNKNOWN" };
          if (payload.data.status === "APPROVED_ONE_CALL") {
            return { kind: "APPROVED", receipt: payload };
          }
          if (payload.data.status === "CONSUMED") {
            return { kind: "CONSUMED", receipt: payload };
          }
          return { kind: "REMOTE_UNKNOWN" };
        }
        return sub2APIDefiniteError(response.status, payload, requestId) ??
          { kind: "REMOTE_UNKNOWN" };
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
    },
    async getSub2APISourceExtractApproval(
      projectId: string,
      originalCommand: Sub2APIQueueCommand,
    ): Promise<Sub2APIApprovalReadResult> {
      if (!isSub2APIProjectId(projectId) || !isSub2APIQueueCommand(originalCommand)) {
        throw new Error("Local API client requires an exact Sub2API approval identity");
      }
      return requestSub2APIApprovalRead(projectId, originalCommand);
    },
    async createFakeTimelineRun(
      projectId: string,
      command: FakeTimelineRunCreateCommand,
    ): Promise<FakeTimelineRunCreateResult> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!isFakeTimelineRunCreateCommand(command)) {
        throw new Error("Local API client requires a valid fake timeline run command");
      }
      return requestFakeTimelineRunCreation(projectId, command);
    },
    async queryFakeTimelineRunOperation(
      projectId: string,
      originalCommand: FakeTimelineRunCreateCommand,
    ): Promise<FakeTimelineRunOperationQueryResult> {
      if (!PROJECT_ID_PATTERN.test(projectId) ||
          !isFakeTimelineRunCreateCommand(originalCommand)) {
        throw new Error("Local API client requires a valid fake timeline run query command");
      }
      return requestFakeTimelineRunOperation(projectId, originalCommand);
    },
    async getInvalidationOperation(
      projectId: string,
      operationId: string,
    ): Promise<InvalidationOperationResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!INVALIDATION_OPERATION_ID_PATTERN.test(operationId)) {
        throw new Error("Local API client requires a valid invalidation operation id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/invalidation-operations/${operationId}`,
        (payload): payload is InvalidationOperationResponse =>
          isInvalidationOperationResponse(payload, projectId, operationId),
        { headers },
      );
    },
    async listInvalidationOperations(
      projectId: string,
      query: InvalidationOperationPageQuery = {},
    ): Promise<InvalidationOperationPageResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      let normalizedQuery: InvalidationOperationPageQuery;
      try {
        normalizedQuery = validateInvalidationOperationPageQuery(query);
      } catch {
        throw new Error("Local API client requires a valid invalidation operation page query");
      }
      const search = new URLSearchParams();
      if (normalizedQuery.limit !== undefined) search.set("limit", String(normalizedQuery.limit));
      if (typeof normalizedQuery.cursor === "string") search.set("cursor", normalizedQuery.cursor);
      const suffix = search.size === 0 ? "" : `?${search.toString()}`;
      return requestJson(
        `/api/v1/projects/${projectId}/invalidation-operations${suffix}`,
        (payload): payload is InvalidationOperationPageResponse =>
          isInvalidationOperationPageResponse(payload, projectId, normalizedQuery),
        { headers },
      );
    },
    async getArtifactProposal(
      projectId: string,
      proposalId: string,
    ): Promise<ArtifactProposalResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!PROPOSAL_ID_PATTERN.test(proposalId)) {
        throw new Error("Local API client requires a valid proposal id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/proposals/${proposalId}`,
        (payload): payload is ArtifactProposalResponse =>
          isArtifactProposalResponse(payload, projectId, proposalId),
        { headers },
      );
    },
    async acceptArtifactProposalAsDraft(
      projectId: string,
      proposalId: string,
      input: ArtifactProposalDraftAcceptanceInput,
    ): Promise<ArtifactProposalDecisionResult<ArtifactProposalDraftAcceptanceResponse>> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!PROPOSAL_ID_PATTERN.test(proposalId)) {
        throw new Error("Local API client requires a valid proposal id");
      }
      if (!isArtifactProposalDraftAcceptanceInput(input)) {
        throw new Error("Local API client requires a valid proposal acceptance input");
      }
      const canonicalInput: ArtifactProposalDraftAcceptanceInput = {
        parent_version_id: input.parent_version_id ?? null,
        expected_head_revision: input.expected_head_revision ?? null,
      };
      return requestProposalDecision(
        `/api/v1/projects/${projectId}/proposals/${proposalId}/acceptances`,
        proposalDecisionKey("accept", projectId, proposalId, canonicalInput),
        canonicalInput,
        (payload): payload is ArtifactProposalDraftAcceptanceResponse =>
          isArtifactProposalDraftAcceptanceResponse(payload, projectId, proposalId),
      );
    },
    async rejectArtifactProposal(
      projectId: string,
      proposalId: string,
      input: ArtifactProposalRejectionInput,
    ): Promise<ArtifactProposalDecisionResult<ArtifactProposalRejectionResponse>> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!PROPOSAL_ID_PATTERN.test(proposalId)) {
        throw new Error("Local API client requires a valid proposal id");
      }
      const canonicalInput = normalizeRejectionInput(input);
      if (!isArtifactProposalRejectionInput(canonicalInput)) {
        throw new Error("Local API client requires a valid proposal rejection input");
      }
      return requestProposalDecision(
        `/api/v1/projects/${projectId}/proposals/${proposalId}/rejections`,
        proposalDecisionKey("reject", projectId, proposalId, canonicalInput),
        canonicalInput,
        (payload): payload is ArtifactProposalRejectionResponse =>
          isArtifactProposalRejectionResponse(payload, projectId, proposalId),
      );
    },
    async listProjectAgents(projectId: string): Promise<AgentCatalogResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/agents`,
        (payload): payload is AgentCatalogResponse => isAgentCatalogResponse(payload, projectId),
        { headers },
      );
    },
    async listProjectSkills(projectId: string): Promise<SkillCatalogResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/skills`,
        (payload): payload is SkillCatalogResponse => isSkillCatalogResponse(payload, projectId),
        { headers },
      );
    },
    async startFakeTimelineWorkflow(projectId: string): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/workflows/fake-timeline`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        { method: "POST", headers },
      );
    },
    async getProjectTimeline(projectId: string): Promise<TimelineResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestOptionalJson(
        `/api/v1/projects/${projectId}/timeline`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        "TIMELINE_NOT_FOUND",
      );
    },
    async trimTimelineClip(
      projectId: string,
      input: TrimTimelineClipInput,
    ): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isTrimTimelineClipInput(input)) {
        throw new Error("Local API client requires a valid timeline trim command");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/timeline/trim`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        postInit(input),
      );
    },
    async reorderTimelineClip(
      projectId: string,
      input: ReorderTimelineClipInput,
    ): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isReorderTimelineClipInput(input)) {
        throw new Error("Local API client requires a valid timeline reorder command");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/timeline/reorder`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        postInit(input),
      );
    },
    async replaceTimelineClip(
      projectId: string,
      input: ReplaceTimelineClipInput,
    ): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isReplaceTimelineClipInput(input)) {
        throw new Error("Local API client requires a valid timeline replace command");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/timeline/replace`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        postInit(input),
      );
    },
    async createDevelopmentExport(
      projectId: string,
      input: DevelopmentExportCreateInput,
    ): Promise<DevelopmentExportCreateResult> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isDevelopmentExportCreateInput(input)) {
        throw new Error("Local API client requires a valid development export command");
      }
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/v1/projects/${projectId}/development-exports`,
          postInit(input));
      } catch {
        return { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: input.operation_id };
      }
      if (response.status === 503) {
        return { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: input.operation_id };
      }
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await readJsonWithLimit(response);
        } catch {
          return { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: input.operation_id };
        }
        return developmentExportRejection(response.status, payload, projectId, input) ??
          { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: input.operation_id };
      }
      let payload: unknown;
      try {
        payload = await readJsonWithLimit(response);
      } catch {
        return { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: input.operation_id };
      }
      return isDevelopmentExportResponse(payload, projectId, input.operation_id,
        input.timeline_version_id, input.expected_revision)
        ? payload
        : { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: input.operation_id };
    },
    async getDevelopmentExport(
      projectId: string,
      operationId: string,
      timelineVersionId: string,
      expectedRevision: number,
    ): Promise<DevelopmentExportResponse> {
      if (!isDevelopmentExportIdentity(projectId, operationId, timelineVersionId,
        expectedRevision)) {
        throw new Error("Local API client requires a valid development export identity");
      }
      let response: Response;
      try {
        response = await fetcher(
          `${origin}/api/v1/projects/${projectId}/development-exports/${operationId}`,
          { headers, signal: AbortSignal.timeout(15_000) },
        );
      } catch {
        throw new DevelopmentExportGetError("REMOTE_UNKNOWN");
      }
      if (response.status === 503) {
        throw new DevelopmentExportGetError("REMOTE_UNKNOWN", response.status);
      }
      if (!response.ok) {
        let code: string | undefined;
        try {
          const payload = await readJsonWithLimit(response);
          if (isErrorResponse(payload)) code = payload.error.code;
        } catch {
          // The HTTP status still distinguishes a definite rejection.
        }
        throw new DevelopmentExportGetError("UNAVAILABLE", response.status, code);
      }
      let payload: unknown;
      try {
        payload = await readJsonWithLimit(response);
      } catch {
        throw new DevelopmentExportGetError("REMOTE_UNKNOWN", response.status);
      }
      if (!isDevelopmentExportResponse(payload, projectId, operationId,
        timelineVersionId, expectedRevision)) {
        throw new DevelopmentExportGetError("REMOTE_UNKNOWN", response.status);
      }
      return payload;
    },
    listProviderConnections: () =>
      requestJson("/api/v1/provider-connections", isProviderConnectionListResponse, { headers }),
    async getEpisodeScript(
      projectId: string, episodeId: string,
    ): Promise<EpisodeScriptLatestResult> {
      if (!isEpisodeScriptProjectId(projectId) || !isEpisodeScriptEpisodeId(episodeId)) {
        throw new Error("Episode script read requires canonical ids");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/script`, { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        return isEpisodeScriptVersionResponse(payload, projectId, episodeId, requestId)
          ? { kind: "FOUND", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      const error = episodeScriptDefiniteError(status, payload, requestId);
      return error?.status === 404 && error.code === "SCRIPT_NOT_FOUND"
        ? { kind: "EMPTY" } : error ?? { kind: "REMOTE_UNKNOWN" };
    },
    async getEpisodeScriptVersion(
      projectId: string, episodeId: string, versionId: string,
    ): Promise<EpisodeScriptVersionResult> {
      if (!isEpisodeScriptProjectId(projectId) || !isEpisodeScriptEpisodeId(episodeId) ||
          !isEpisodeScriptVersionId(versionId)) {
        throw new Error("Episode script version read requires canonical ids");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/script/versions/${versionId}`,
        { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        return isEpisodeScriptVersionResponse(
          payload, projectId, episodeId, requestId, versionId,
        ) ? { kind: "FOUND", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return episodeScriptDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async createEpisodeScriptVersion(
      projectId: string, episodeId: string, idempotencyKey: string,
      payload: CreateEpisodeScriptVersionRequest,
    ): Promise<EpisodeScriptCreateResult> {
      if (!isEpisodeScriptProjectId(projectId) || !isEpisodeScriptEpisodeId(episodeId) ||
          !isEpisodeScriptIdempotencyKey(idempotencyKey) ||
          !isCreateEpisodeScriptVersionRequest(payload, projectId, episodeId)) {
        throw new Error("Episode script write requires canonical arguments");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/script/versions`,
        { method: "POST", headers: { ...headers, "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload: response, requestId } = result;
      if (status === 201) {
        return isEpisodeScriptVersionCreatedResponse(
          response, projectId, episodeId, requestId, payload,
        ) ? { kind: "CREATED", receipt: response } : { kind: "REMOTE_UNKNOWN" };
      }
      return episodeScriptDefiniteError(status, response, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async getEpisodeScriptConfirmation(
      projectId: string, episodeId: string,
    ): Promise<EpisodeScriptConfirmationReadResult> {
      if (!isEpisodeScriptProjectId(projectId) || !isEpisodeScriptEpisodeId(episodeId)) {
        throw new Error("Episode script confirmation read requires canonical ids");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/script/confirmation`,
        { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        return isEpisodeScriptConfirmationStatusResponse(
          payload, projectId, episodeId, requestId,
        ) ? { kind: "FOUND", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return episodeScriptConfirmationDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async createEpisodeScriptConfirmation(
      projectId: string, episodeId: string, idempotencyKey: string,
      payload: CreateEpisodeScriptConfirmationRequest,
    ): Promise<EpisodeScriptConfirmationCreateResult> {
      if (!isEpisodeScriptProjectId(projectId) || !isEpisodeScriptEpisodeId(episodeId) ||
          !isEpisodeScriptIdempotencyKey(idempotencyKey) ||
          !isCreateEpisodeScriptConfirmationRequest(payload)) {
        throw new Error("Episode script confirmation write requires canonical arguments");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}/script/confirmations`,
        { method: "POST", headers: { ...headers, "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload: response, requestId } = result;
      if (status === 201) {
        return isEpisodeScriptConfirmationCreatedResponse(
          response, projectId, episodeId, requestId, payload,
        ) ? { kind: "CREATED", receipt: response } : { kind: "REMOTE_UNKNOWN" };
      }
      return episodeScriptConfirmationDefiniteError(status, response, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async getEpisodeScriptConfirmationReceipt(
      projectId: string, episodeId: string, confirmationId: string,
    ): Promise<EpisodeScriptConfirmationReadResult> {
      if (!isEpisodeScriptProjectId(projectId) || !isEpisodeScriptEpisodeId(episodeId) ||
          !isEpisodeScriptConfirmationId(confirmationId)) {
        throw new Error("Episode script confirmation receipt requires canonical ids");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/episodes/${episodeId}` +
          `/script/confirmations/${confirmationId}`, { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        return isEpisodeScriptConfirmationStatusResponse(
          payload, projectId, episodeId, requestId, confirmationId,
        ) ? { kind: "FOUND", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return episodeScriptConfirmationDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async getSourceProposalAcceptanceForVersion(
      projectId: string, versionId: string,
    ): Promise<SourceProposalAcceptanceResult> {
      if (!isSourceProposalAcceptanceProjectId(projectId) ||
          !isSourceProposalAcceptanceVersionId(versionId)) {
        throw new Error("Source proposal acceptance read requires canonical ids");
      }
      const result = await readBoundedScriptHttp(
        `/api/v1/projects/${projectId}/source-extraction/versions/${versionId}` +
          "/proposal-acceptance", { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId, etag } = result;
      if (status === 200) {
        return isSourceProposalAcceptanceResponse(
          payload, projectId, versionId, requestId, etag,
        ) ? { kind: "FOUND", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return sourceProposalAcceptanceDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async readSub2APIConfiguredReadiness(
      connectionId: string, modelId: string,
    ): Promise<Sub2APIConfiguredReadinessResult> {
      if (!isSub2APIConnectionId(connectionId) || !isSub2APIModelId(modelId)) {
        throw new Error("Sub2API readiness requires canonical connection and model ids");
      }
      let response: Response;
      try {
        response = await fetcher(
          `${origin}/api/v1/provider-connections/${connectionId}` +
            `/sub2api-configured-readiness?model_id=${encodeURIComponent(modelId)}`,
          { headers, signal: AbortSignal.timeout(15_000) },
        );
      } catch {
        return { kind: "READINESS_UNKNOWN" };
      }
      try {
        const payload = await readJsonWithLimit(response);
        const requestId = response.headers.get("X-Request-ID");
        if (response.status === 200) {
          return isSub2APIConfiguredReadinessResponse(
            payload, connectionId, modelId, requestId,
          ) ? { kind: "READ", receipt: payload } : { kind: "READINESS_UNKNOWN" };
        }
        return sub2APIReadinessDefiniteError(response.status, payload, requestId) ??
          { kind: "READINESS_UNKNOWN" };
      } catch {
        return { kind: "READINESS_UNKNOWN" };
      }
    },
    async editSub2APIMetadata(
      connectionId: string, command: EditSub2APIMetadataCommand,
    ): Promise<Sub2APIConnectionMutationResult> {
      if (!isSub2APIConnectionId(connectionId) ||
          !isEditSub2APIMetadataCommand(command)) {
        throw new Error("Sub2API metadata edit requires canonical arguments");
      }
      let before: ProviderConnectionListResponse;
      try {
        before = await requestJson(
          "/api/v1/provider-connections", isProviderConnectionListResponse, { headers },
        );
      } catch {
        return { kind: "REMOTE_UNKNOWN" };
      }
      const current = before.data.find((item) => item.id === connectionId);
      if (!current || current.provider_kind !== "SUB2API" ||
          current.revision !== command.expected_revision ||
          !isRecord(current) || !isSub2APIOriginMode(current.origin_mode)) {
        return { kind: "REMOTE_UNKNOWN" };
      }
      if (command.origin_mode === undefined &&
          current.origin_mode === "LOCAL_LOOPBACK_HTTP") {
        throw new Error("Editing a local Sub2API connection requires explicit origin_mode");
      }
      const explicitCommand = {
        ...command, origin_mode: command.origin_mode ?? "PUBLIC_HTTPS",
      };
      const result = await requestSub2APIMutationHttp(
        `/api/v1/provider-connections/${connectionId}`,
        { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(explicitCommand) },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        if (!isSub2APIMetadataReceipt(payload, connectionId, explicitCommand, requestId)) {
          return { kind: "REMOTE_UNKNOWN" };
        }
        let after: ProviderConnectionListResponse;
        try {
          after = await requestJson(
            "/api/v1/provider-connections", isProviderConnectionListResponse, { headers },
          );
        } catch {
          return { kind: "REMOTE_UNKNOWN" };
        }
        const persisted = after.data.find((item) => item.id === connectionId);
        return persisted?.provider_kind === "SUB2API" &&
          isRecord(persisted) &&
          persisted.origin_mode === explicitCommand.origin_mode &&
          persisted.revision === payload.data.revision &&
          persisted.base_url === payload.data.base_url &&
          persisted.display_name === payload.data.display_name &&
          persisted.enabled === payload.data.enabled &&
          JSON.stringify(persisted.models) === JSON.stringify(payload.data.models)
          ? { kind: "UPDATED", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return sub2APIMutationDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async rotateSub2APIKey(
      connectionId: string, command: RotateSub2APIKeyCommand,
    ): Promise<Sub2APIConnectionMutationResult> {
      if (!isSub2APIConnectionId(connectionId) || !isRotateSub2APIKeyCommand(command)) {
        throw new Error("Sub2API rotation requires canonical arguments");
      }
      const result = await requestSub2APIMutationHttp(
        `/api/v1/provider-connections/${connectionId}/credential-rotations`,
        postInit(command),
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        return isSub2APIKeyRotationReceipt(payload, connectionId, command, requestId)
          ? { kind: "UPDATED", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return sub2APIMutationDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async readSub2APIKeyRotation(
      connectionId: string, operationId: string,
    ): Promise<Sub2APIRotationReadResult> {
      if (!isSub2APIConnectionId(connectionId) ||
          !isSub2APIRotationOperationId(operationId)) {
        throw new Error("Sub2API rotation read requires canonical ids");
      }
      const result = await requestSub2APIMutationHttp(
        `/api/v1/provider-connections/${connectionId}` +
          `/credential-rotations/${operationId}`,
        { headers },
      );
      if (result === null) return { kind: "REMOTE_UNKNOWN" };
      const { status, payload, requestId } = result;
      if (status === 200) {
        return isSub2APIRotationOperationResponse(
          payload, connectionId, operationId, requestId,
        ) ? { kind: "READ", receipt: payload } : { kind: "REMOTE_UNKNOWN" };
      }
      return sub2APIRotationReadDefiniteError(status, payload, requestId) ??
        { kind: "REMOTE_UNKNOWN" };
    },
    async createProviderConnection(
      input: CreateProviderConnectionInput,
    ): Promise<ProviderConnectionResponse> {
      if (!isCreateProviderConnectionInput(input)) {
        throw new Error("Local API client requires valid provider connection input");
      }
      return requestJson(
        "/api/v1/provider-connections",
        (value): value is ProviderConnectionResponse =>
          isProviderConnectionResponse(value) &&
          (input.provider_kind !== "SUB2API" ||
            (isRecord(value.data) &&
              value.data.provider_kind === "SUB2API" &&
              value.data.origin_mode === (input.origin_mode ?? "PUBLIC_HTTPS") &&
              value.data.base_url === input.base_url.replace(/\/+$/, "") &&
              value.data.revision === 1)),
        postInit(input),
      );
    },
    async deleteProviderConnection(connectionId: string): Promise<void> {
      if (!isProviderConnectionId(connectionId)) {
        throw new Error("Local API client requires a valid provider connection id");
      }
      const response = await fetcher(`${origin}/api/v1/provider-connections/${connectionId}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        let code = "";
        try {
          const errorPayload = await readJsonWithLimit(response);
          code = isErrorResponse(errorPayload) ? ` (${errorPayload.error.code})` : "";
        } catch {
          // The stable HTTP status remains useful if an intermediary replaced the error body.
        }
        throw new Error(`Local API request failed with status ${response.status}${code}`);
      }
    },
  };
}
