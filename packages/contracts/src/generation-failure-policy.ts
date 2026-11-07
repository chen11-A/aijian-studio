/** Non-monetary, explicit protection for actual Grok video submissions only. */
export type GenerationFailurePolicy = {
  state: "UNCONFIGURED" | "CONFIGURED";
  revision: number;
  failure_limit: number | null;
  scope: "GROK_VIDEO_SUBMIT_FAILURES";
};
export type ConfigureGenerationFailurePolicy = { expected_revision: number; failure_limit: number };

export type GenerationFailurePolicyResult =
  | { kind: "POLICY"; policy: GenerationFailurePolicy }
  | {
      kind: "FAILED";
      code: "POLICY_CHANGED" | "PROJECT_NOT_FOUND" | "UNAVAILABLE" | "WRITE_UNCONFIRMED";
    };
