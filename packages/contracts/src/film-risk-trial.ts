/** Human decisions about exact local footage, never a provider/quality or payment permission. */
export type FilmRiskTrialInput = {
  projectId: string;
  expectedHash: string;
  shotId: string;
  takeId: string;
};
export type FilmRiskTrialDecision = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  shotId: string;
  takeId: string;
  inputFingerprint: string;
  decision: "accepted" | "needs-changes";
  note: string;
  recordedAt: string;
};
export type FilmRiskTrialFailure = {
  kind: "FAILED";
  code:
    | "INVALID_INPUT"
    | "PROJECT_CHANGED"
    | "SOURCE_UNVERIFIED"
    | "TOOLS_UNAVAILABLE"
    | "BUSY"
    | "UNSUPPORTED_SCOPE"
    | "WRITE_FAILED"
    | "WRITE_UNCONFIRMED"
    | "REVIEW_STALE";
  unchanged: boolean;
};
export type FilmRiskTrialReady = {
  kind: "READY";
  projectId: string;
  projectHash: string;
  /** Owner/document-local media access only; never persist or export this token. */
  reviewId: string;
  shotId: string;
  takeId: string;
  label: string;
  versionLabel: string;
  durationSeconds: number;
  /** Full ordered checkpoint scope; not a count/authorization of new paid requests. */
  batchShotCount: number;
  inputFingerprint: string;
  existingDecision: FilmRiskTrialDecision | null;
  limitations: string[];
};
export type FilmRiskTrialRecordInput = {
  projectId: string;
  expectedHash: string;
  reviewId: string;
  decision: "accepted" | "needs-changes";
  note: string;
};
export type FilmRiskTrialCheckInput = {
  projectId: string;
  expectedHash: string;
  decisionId: string;
  /** Only the pending target is rechecked after earlier independent targets complete. */
  targetShotId?: string;
};
export type FilmRiskTrialGateway = {
  prepareFilmRiskTrial(
    input: FilmRiskTrialInput,
  ): Promise<FilmRiskTrialReady | FilmRiskTrialFailure>;
  readFilmRiskTrialMedia(
    projectId: string,
    reviewId: string,
  ): Promise<{ kind: "MEDIA"; bytes: Uint8Array } | FilmRiskTrialFailure>;
  recordFilmRiskTrialDecision(
    input: FilmRiskTrialRecordInput,
  ): Promise<
    | { kind: "RECORDED"; project: Record<string, unknown>; decision: FilmRiskTrialDecision }
    | FilmRiskTrialFailure
  >;
  checkFilmRiskTrialDecision(
    input: FilmRiskTrialCheckInput,
  ): Promise<
    | { kind: "ACCEPTED"; projectId: string; decisionId: string; inputFingerprint: string }
    | FilmRiskTrialFailure
  >;
};
