// Task center, export check, sound, take picker, subtitle style and cover components. Every
// value comes in through props and every action goes out through a callback; nothing here
// calls the desktop bridge, the network or storage.
export { CoverEditor, TITLE_MAX_LENGTH, type CoverEditorProps } from "./CoverEditor";
export { ExportCheck, issueWhere, type ExportCheckProps, type ShotSpan } from "./ExportCheck";
export {
  detailRows,
  QC_ACTIONS,
  QC_TYPE_LABEL,
  readQcReport,
  type QcAction,
  type QcIssue,
  type QcReadResult,
  type QcReport,
  type QcSeverity,
} from "./qcReport";
export { clockLabel, durationLabel, shotLabel, videoLine } from "./shot";
export { MOODS, SoundPanel, type Mood, type SoundPanelProps } from "./SoundPanel";
export { SuggestionCard, type SuggestionCardProps } from "./SuggestionCard";
export {
  SUBTITLE_STYLES,
  SubtitleStyle,
  wrapLine,
  type SubtitleStyleOption,
  type SubtitleStyleProps,
} from "./SubtitleStyle";
export {
  MAX_TAKES,
  TakePicker,
  type TakeNote,
  type TakeOption,
  type TakePickerProps,
  type TakeVerdict,
} from "./TakePicker";
export {
  primaryAction,
  TaskCenter,
  taskLabel,
  unitFor,
  type TaskCenterProps,
  type TaskItem,
  type TaskKind,
  type TaskRecovery,
  type TaskStatus,
} from "./TaskCenter";
export {
  clampVolume,
  dbToVolume,
  DEFAULT_LANE_VOLUMES,
  LANE_LABEL,
  SOUND_LANES,
  volumeToDb,
  type LaneVolumes,
  type SoundLane,
} from "./volume";
