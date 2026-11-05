// Pure functions that turn a parsed project.json into the data props of the next/ components.
// They read only what they are given; the host adds the callbacks. See ../INTEGRATION.md.
export { coverEditorData, type CoverEditorData, type CoverEditorOptions } from "./coverEditor";
export { exportCheckData, type ExportCheckData, type ExportCheckOptions } from "./exportCheck";
export { mediaUrl } from "./media";
export { exportedShots, sceneName, shotName, takeInUse } from "./names";
export {
  readProject,
  type ProjectClip,
  type ProjectJob,
  type ProjectRead,
  type ProjectScene,
  type ProjectShot,
  type ProjectTake,
  type ProjectView,
} from "./read";
export type { Adapted, EmptyState } from "./result";
export { soundPanelData, type SoundPanelData } from "./soundPanel";
export {
  suggestionCounts,
  suggestionDiff,
  type SuggestionCounts,
  type SuggestionItem,
  type SuggestionRow,
} from "./suggestionDiff";
export {
  subtitleStyleData,
  type SubtitleStyleData,
  type SubtitleStyleOptions,
} from "./subtitleStyle";
export { takePickerData, type TakePickerData, type TakePickerOptions } from "./takePicker";
export { taskCenterData, type TaskCenterData, type TaskCenterOptions } from "./taskCenter";
