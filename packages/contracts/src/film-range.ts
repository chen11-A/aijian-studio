/** Seconds relative to one selected source take. Subtitle layout is not speech alignment. */
export type FilmRangePlan = {
  requested: { start: number; end: number };
  effective: { start: number; end: number };
  duration: number;
  generationSeconds: number;
  frameRate: 24 | 25 | 30;
  speech: "preserve-original-audio";
};
export type FilmRangeGateway = {
  prepareFilmRange: (input: {
    projectId: string;
    shotId: string;
    takeId: string;
    expectedHash: string;
    start: number;
    end: number;
  }) => Promise<
    | { kind: "READY"; planId: string; plan: FilmRangePlan }
    | {
        kind: "FAILED";
        code:
          | "CLEAN_SOURCE_REQUIRED"
          | "INVALID_RANGE"
          | "SOURCE_UNVERIFIED"
          | "UNSUPPORTED_SOURCE"
          | "PROJECT_CHANGED"
          | "TOOLS_UNAVAILABLE";
      }
  >;
  generateFilmRange: (input: {
    projectId: string;
    planId: string;
    expectedHash: string;
    confirmed: true;
    prompt: string;
  }) => Promise<
    | { kind: "GENERATED"; project: unknown; segmentTakeId: string }
    | {
        kind: "FAILED";
        code: "PROJECT_CHANGED" | "BACKUP_FAILED" | "GENERATION_UNCONFIRMED";
        requestMayHaveRun: boolean;
      }
  >;
  finishFilmRange: (input: {
    projectId: string;
    planId: string;
    segmentTakeId: string;
    expectedHash: string;
  }) => Promise<
    | { kind: "SPLICED"; project: unknown }
    | { kind: "PARTIAL"; project: unknown }
    | {
        kind: "FAILED";
        code: "PROJECT_CHANGED" | "SOURCE_UNVERIFIED" | "SPLICE_FAILED";
        segmentRetained: true;
      }
  >;
  discardFilmRange: (projectId: string, planId: string) => Promise<void>;
};
