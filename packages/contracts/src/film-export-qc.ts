import type { FilmDeliveryEvidenceResult } from "./film-delivery-evidence.js";

/** Renderer sends identities and presentation settings, never execution or output paths. */
export type FilmExportQcSettings = {
  aspects: ("16:9" | "9:16")[];
  quality: "720p" | "1080p";
  subtitles: "burn" | "srt" | "none";
  style: "white" | "bar" | "yellow" | "film";
  aiMark: boolean;
  /** Omitted by older callers means explicitly off. Main checks the persisted setting. */
  autoAdjustVolume?: boolean;
};
export type FilmExportQcInput = {
  projectId: string;
  expectedSelection: { shotId: string; takeId: string }[];
  settings: FilmExportQcSettings;
};
export type FilmExportQcFailure = {
  kind: "FAILED";
  code:
    | "AUDIO_MIX_LIMIT"
    | "INVALID_INPUT"
    | "PROJECT_CHANGED"
    | "MISSING_MEDIA"
    | "CLEAN_COPY_REQUIRED"
    | "TOOLS_UNAVAILABLE"
    | "CHECK_FAILED"
    | "RECEIPT_STALE"
    | "PUBLISH_FAILED"
    | "QC_BLOCKED"
    | "SOURCE_UNVERIFIED"
    | "BUSY"
    | "OPERATION_STOPPED";
};
export type FilmExportQcPrepared = {
  kind: "READY";
  qcReceipt: string;
  outputs: { aspectRatio: "16:9" | "9:16"; report: unknown }[];
  shots: { id: string; label: string; start: number; end: number }[];
  fileName: string;
  unverified: string[];
};
export type FilmExportQcPublishInput = FilmExportQcInput & { qcReceipt: string };
export type FilmExportQcPublishResult =
  | {
      kind: "PUBLISHED" | "PARTIAL";
      /** Absent means legacy did not provide evidence; never synthesize it in renderer. */
      deliveryEvidence?: FilmDeliveryEvidenceResult;
      outputs: {
        aspectRatio: "16:9" | "9:16";
        path: string;
        subtitlePath?: string;
        coverPath?: string;
      }[];
    }
  | { kind: "CANCELLED" }
  | FilmExportQcFailure;
export type FilmExportQcGateway = {
  prepareFilmExport: (
    input: FilmExportQcInput,
    operationId?: string,
  ) => Promise<FilmExportQcPrepared | FilmExportQcFailure>;
  publishFilmExport: (
    input: FilmExportQcPublishInput,
    operationId?: string,
  ) => Promise<FilmExportQcPublishResult>;
  discardFilmExport: (qcReceipt: string) => Promise<void>;
  cancelFilmExportOperation: (operationId: string) => Promise<FilmExportCancelAck>;
  onFilmExportProgress: (listener: (event: FilmExportProgressEvent) => void) => () => void;
};

/** Independent execution feed; these values never enter receipt/semantic-input hashing. */
export type FilmExportPhase =
  | "preparing"
  | "joining"
  | "mixing"
  | "rendering"
  | "checking"
  | "tagging"
  | "checking-final"
  | "waitingReview"
  | "publishing"
  | "completed"
  | "partial"
  | "failed"
  | "unknown";
export type FilmExportProgressMeasure =
  | { kind: "units"; completed: number; total: number; unit: "镜头" | "画幅" }
  | { kind: "media-time"; outTimeSeconds: number; durationSeconds: number };
export type FilmExportProgressEvent = {
  operationId: string;
  projectId: string;
  seq: number;
  phase: FilmExportPhase;
  progress?: FilmExportProgressMeasure;
  cancelState: "available" | "requested" | "stopped" | "unavailable";
  published: { aspectRatio: "16:9" | "9:16"; label?: string }[];
};
export type FilmExportCancelAck = {
  kind: "REQUESTED" | "UNAVAILABLE" | "NOT_FOUND" | "STOPPED";
  snapshot?: FilmExportProgressEvent;
};
