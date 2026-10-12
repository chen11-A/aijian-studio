import type { components } from "./generated.js";
export type VisualContent = components["schemas"]["CreateVisualBibleVersionRequest"]["content"];
export type VisualWrite = components["schemas"]["CreateVisualBibleVersionRequest"];
export type VisualVersion = components["schemas"]["VisualBibleVersionData"];
export type VisualIndex = components["schemas"]["VisualBibleIndexData"];
export type VisualHistoryPage = components["schemas"]["VisualBibleHistoryPage"];
export type VisualHistoryEntry = components["schemas"]["VisualBibleHistoryEntry"];
export type VisualHistoryGateway = {
  listVisualBibleVersions(
    p: string,
    cursor: string | null,
  ): Promise<VisualResult<VisualHistoryPage>>;
};
export type VisualRead = components["schemas"]["VisualBibleReadData"];
export type VisualReadiness = components["schemas"]["VisualBibleReadinessData"];
export type VisualAuthority = components["schemas"]["VisualBibleAuthorityData"];
export type VisualOperation = components["schemas"]["VisualReviewOperationData"];
export type VisualInspection = components["schemas"]["VisualImageInspectionData"];
export type VisualReport = components["schemas"]["VisualGateReadinessReportData"];
export type VisualChallenge = components["schemas"]["VisualConfirmationChallengeData"];
export type VisualAction = {
  action: "submit" | "signoff" | "decision";
  roles: ("continuity_reviewer" | "producer")[];
  decision: "approved" | "rejected" | null;
  rationale: string | null;
  readiness_report_id: string | null;
};
export type VisualIdentity = {
  project_id: string;
  version_id: string;
  content_hash: string;
  expected_revision: number;
};
export type VisualTicket = VisualIdentity & {
  challenge_id: string;
  report_id: string;
  report_hash: string;
  input: VisualAction;
};
export type VisualPrepared = {
  report: VisualReport;
  challenge: VisualChallenge;
  confirmation_token: string;
};
export type VisualResult<T> =
  | { kind: "FOUND"; data: T; request_id: string }
  | { kind: "EMPTY" }
  | { kind: "REMOTE_UNKNOWN" }
  | { kind: "CANCELLED" }
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string };
export type VisualReviewState = components["schemas"]["VisualReviewStateData"];
export type VisualSaveOperation = components["schemas"]["VisualBibleSaveOperationData"];
export type VisualGateway = {
  getVisualReviewState(p: string, v: string): Promise<VisualResult<VisualReviewState>>;
  getVisualSaveOperation(
    p: string,
    key: string,
    payload: VisualWrite,
  ): Promise<VisualResult<VisualSaveOperation>>;
  getVisualBible(p: string): Promise<VisualResult<VisualIndex>>;
  getVisualBibleVersion(p: string, v: string): Promise<VisualResult<VisualRead>>;
  getVisualBibleReadiness(p: string, v: string): Promise<VisualResult<VisualReadiness>>;
  getVisualBibleAuthority(p: string, v: string): Promise<VisualResult<VisualAuthority>>;
  saveVisualBible(p: string, key: string, payload: VisualWrite): Promise<VisualResult<VisualRead>>;
  readVisualReviewOperation(
    p: string,
    v: string,
    challengeId: string,
  ): Promise<VisualResult<VisualOperation>>;
  getVisualInspectionOperation(
    p: string,
    operationId: string,
  ): Promise<VisualResult<VisualInspection>>;
  prepareVisualReview(
    identity: VisualIdentity,
    input: VisualAction,
  ): Promise<VisualResult<VisualTicket>>;
  confirmVisualReview(ticket: VisualTicket): Promise<VisualResult<VisualOperation>>;
  inspectVisualReference(
    p: string,
    assetId: string,
    versionId: string,
    sha256: string,
    operationId: string,
  ): Promise<VisualResult<VisualInspection>>;
};
export function visualProjectId(v: unknown): v is string;
export function visualVersionId(v: unknown): v is string;
export function visualAssetReference(v: unknown): boolean;
export function visualContent(v: unknown, p: string): v is VisualContent;
export function visualEnvironmentScope(
  v: unknown,
): v is components["schemas"]["VisualEnvironmentScopeV1"];
export function visualEnvironmentProjection(v: unknown): boolean;
export function visualEnvironmentEvidenceMatches(
  content: unknown,
  library: unknown,
  report: unknown,
): boolean;
export function visualEnvironmentChoicesWithinScope(board: unknown, visual: unknown): boolean;
export function visualWriteInput(v: unknown, p: string): v is VisualWrite;
export function visualReviewInput(v: unknown): v is VisualAction;
export function visualHead(v: unknown): boolean;
export function visualVersion(v: unknown, p: string): v is VisualVersion;
export function visualReadData(v: unknown, p: string): v is VisualRead;
export function visualIndexData(v: unknown, p: string): v is VisualIndex;
export function visualHistoryData(
  v: unknown,
  p: string,
  cursor: string | null,
  limit?: number,
): v is VisualHistoryPage;
export function visualEnvelope(
  v: unknown,
  requestId?: string,
): v is { data: unknown; request_id: string };
export function visualReport(v: unknown): v is VisualReport;
export function visualChallenge(v: unknown): v is VisualChallenge;
export function visualPreparedData(v: unknown): v is VisualPrepared;
export function visualOperationData(v: unknown, p: string, vId: string): v is VisualOperation;
export function visualActionOutcomeMatches(input: VisualAction, result: VisualOperation): boolean;
export function visualLocalReviewActorMatches(result: VisualOperation): boolean;
export function visualReadinessData(v: unknown, p: string, vId: string): v is VisualReadiness;
export function visualAuthorityData(v: unknown, p: string, vId: string): v is VisualAuthority;
export function visualInspectionData(v: unknown, p: string): v is VisualInspection;

export function visualSaveOperationData(v: unknown, p: string): v is VisualSaveOperation;

export function visualReviewStateData(v: unknown, p: string, vId: string): v is VisualReviewState;
export function visualJson(v: unknown): string;
export function visualTicketData(v: unknown): v is VisualTicket;
