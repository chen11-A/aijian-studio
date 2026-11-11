/** Same two values as studio-web `sound-export-decision.ts`. Absent means an older record. */
export const EXPORT_AUDIO_DECISIONS = ["SILENT_BY_USER", "WITH_AUDIO"] as const;
export type ExportAudioDecision = (typeof EXPORT_AUDIO_DECISIONS)[number];

/** Expired audio cannot be waived. There is no argument that means "export it anyway". */
export function exportBlockedByStaleMaterial(limitations: readonly string[]): boolean {
  return (
    limitations.includes("STALE_CLIP_IGNORED") || limitations.includes("SCENE_AUDIO_BINDING_STALE")
  );
}

/** Old export records omit the field. A present value must be one of the two decisions. */
export function readStoredAudioDecision(record: object): ExportAudioDecision | undefined {
  if (!Object.hasOwn(record, "audioDecision")) return undefined;
  const value = (record as { audioDecision?: unknown }).audioDecision;
  if (value === "SILENT_BY_USER" || value === "WITH_AUDIO") return value;
  throw new Error("INVALID_AUDIO_DECISION");
}
