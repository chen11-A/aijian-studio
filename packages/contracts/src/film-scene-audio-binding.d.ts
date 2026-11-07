export type SceneAudioBinding = {
  schemaVersion: 1;
  sceneId: string;
  selectionSha256: string;
};
export type SceneAudioClockSource = {
  shotId: string;
  takeId: string;
  sceneId: string;
  startSeconds: number;
  durationSeconds: number;
  nativeSha256: string;
  visualSha256: string;
};
/** Creative consistency only, never file ownership or execution authorization. */
export function sceneAudioBinding(value: unknown): SceneAudioBinding;
/** Hash the exact UTF-8 JSON. Requires a contiguous scene and a complete actual ordered clock. */
export function sceneAudioSelectionInput(
  sceneId: string,
  rows: readonly SceneAudioClockSource[],
): string;
