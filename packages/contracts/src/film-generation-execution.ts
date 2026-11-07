/** Native-owned execution scope for automatic prerequisites of an explicitly confirmed
 * video run. These handles are transient locators, never portable authorization. */
export type FilmGenerationExecutionInput = {
  projectId: string;
  expectedProjectHash: string;
  mode: "video" | "pipeline";
  targets: readonly { shotId: string; versions: 1 | 2 | 3 }[];
};

/** The native dependency graph determines the targets served by each image stage. A
 * renderer cannot declare that set, an account, a digest, or a successful artifact. */
export type FilmGenerationImageStage = {
  stageId: string;
  kind: "location-reference" | "portrait" | "shot-frame";
  targetId: string;
  view?: "正面" | "侧面" | "背面" | "脸部";
};

export type FilmGenerationExecutionFailure =
  | "INVALID_INPUT"
  | "BUSY"
  | "PROJECT_CHANGED"
  | "SOURCE_UNVERIFIABLE"
  | "ACCOUNT_UNAVAILABLE"
  | "UNSUPPORTED_SCOPE"
  | "EXECUTION_UNAVAILABLE"
  | "CREATION_UNCONFIGURED"
  | "CREATION_INPUT_UNVERIFIABLE"
  | "CREATION_INPUT_FAILURE_LIMIT"
  | "CREATION_ATTEMPT_ALREADY_RESERVED"
  | "WRITE_UNCONFIRMED";

export type FilmGenerationExecutionResult =
  | {
      kind: "PREPARED";
      executionId: string;
      projectId: string;
      projectHash: string;
      stages: readonly FilmGenerationImageStage[];
      targets: readonly { shotId: string; videoSlotIds: readonly string[] }[];
    }
  | { kind: "FAILED"; code: FilmGenerationExecutionFailure };

/** Optional fifth still argument. Only an issued stage can consume a prerequisite slot. */
export type FilmGenerationStillExecution = { executionId: string; stageId: string };

/** Optional fourth StoryFilm argument; the third dialogue-evidence scope is unchanged.
 * Native binds the slot once to the exact canonical queued/running take. */
export type FilmGenerationVideoExecution = {
  executionId: string;
  videoSlotId: string;
  shotId: string;
  takeId: string;
};

export type FilmGenerationExecutionGateway = {
  prepareFilmGenerationExecution(
    input: FilmGenerationExecutionInput,
  ): Promise<FilmGenerationExecutionResult>;
  /** Retires future native dispatch. It neither stops an already sent HTTP request
   * nor acknowledges provider cancellation or releases an uncertain reservation. */
  retireFilmGenerationExecution(input: {
    executionId: string;
    /** Single-job cancellation; omission retires the whole execution. */
    videoSlotId?: string;
  }): Promise<
    { kind: "RETIRED" } | { kind: "FAILED"; code: "INVALID_INPUT" | "EXECUTION_UNAVAILABLE" }
  >;
};
