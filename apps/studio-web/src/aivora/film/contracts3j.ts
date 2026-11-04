/** Interface contracts for Claude's UI. Future contracts do not enable features. */
export type UiNotice = { code: string; text: string; detail?: string };

export type SceneCoverage = {
  sceneId: string;
  ok: boolean;
  lastLine: string;
  missingLines: string[];
  missingTail: string | null;
};

export type { TaskItem, BatchProgress } from "@aijian/contracts/task-progress";

export type ExportCheckIssue = {
  id: string;
  severity: "warn" | "block";
  time: number;
  timeLabel: string;
  end: number;
  type: string;
  message: string;
  suggestion: string;
  action: string;
  detail: Record<string, unknown>;
  scope?: string;
  cue?: number;
  estimated?: boolean;
  nextCue?: number;
};

export type ExportCheckReport = {
  schemaVersion: 1;
  media: { duration: number; width: number; height: number };
  audio: {
    present: boolean;
    integratedLufs: number | null;
    truePeakDbtp: number | null;
  };
  assumptions: {
    streams: string;
    black: string;
    freeze: string;
    silence: string;
    loudness: string;
    subtitleLayout: Record<string, unknown> | null;
  };
  issues: ExportCheckIssue[];
};

export type ShotSpan = { id: string; start: number; end: number };
/** Volume values are 0–100; no mixer implementation is supplied in 3j. */
export type SceneSound = {
  mood: string;
  master: number;
  lanes: { dialogue: number; ambience: number; sfx: number; score: number };
  duckMusic: boolean;
};
export type TakeOption = {
  id: string;
  label: string;
  status: "ready" | "generating" | "failed";
  verdict?: "可用" | "建议重做" | "必须重做";
  notes?: string[];
  imageUrl?: string;
  statusText?: string;
};
export type TakeSelection = {
  options: TakeOption[];
  aiChoiceId?: string;
  selectedId?: string;
};
export type LipSyncState = {
  lipSync: "none" | "pending" | "done" | "failed";
  lipSyncReason?: string;
};
export type PipelineStep = {
  id:
    | "writer"
    | "art"
    | "portraits"
    | "director"
    | "action"
    | "performance"
    | "prompter"
    | "stills"
    | "review"
    | "video";
  label: string;
  status: "queued" | "running" | "done" | "failed";
  done: number;
  total: number;
};
export type PipelineProgress = { steps: PipelineStep[]; current?: PipelineStep["id"] };
export type ContinuityNote = {
  kind: "missing_look" | "prop" | "gaze" | "axis" | "cut";
  text: string;
};
/** Actual media preset replacement is deferred to 4b. */
export type SubtitleStyleId = "white" | "bar" | "yellow" | "film";

/** C6: UI input only. No cover rendering or media service is implemented in 3j. */
export type CoverInput = {
  title: string;
  subtitle: string;
  aiMark: boolean;
  /** Empty when no background has been selected. */
  backgroundUrl: string;
};
