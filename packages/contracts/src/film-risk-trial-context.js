import { dialogueEvidenceContext } from "./film-dialogue-split-plan.js";
export const trialObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const rows = (value) => {
  if (!Array.isArray(value) || value.some((item) => !trialObject(item)))
    throw Error("UNSUPPORTED_SCOPE");
  return value;
};
/** Every shot is retained. A human result is never applied to an ambiguously repaired project. */
export function riskTrialShots(record) {
  record = trialObject(record);
  if (!record) throw Error("UNSUPPORTED_SCOPE");
  const shots = rows(record.shots),
    scenes = rows(record.scenes);
  if (shots.length > 256 || scenes.length > 256) throw Error("UNSUPPORTED_SCOPE");
  for (const group of [shots, scenes]) {
    const ids = new Set();
    for (const row of group) {
      if (typeof row.id !== "string" || !row.id || ids.has(row.id))
        throw Error("UNSUPPORTED_SCOPE");
      ids.add(row.id);
    }
  }
  for (const shot of shots) {
    if (!scenes.some((scene) => scene.id === shot.sceneId) || !Array.isArray(shot.takes))
      throw Error("UNSUPPORTED_SCOPE");
    // A generated prior-shot frame is not a reviewed fixed reference for another shot.
    if (shot.continuityFromShotId) throw Error("UNSUPPORTED_SCOPE");
  }
  return shots;
}
/** Global creative decisions, excluding only runtime/output data. Per-target references are
 * checked separately, so this run's output cannot invalidate another independent target. */
export function riskTrialCreative(record) {
  record = trialObject(record);
  if (!record) throw Error("UNSUPPORTED_SCOPE");
  const keys = [
    "id",
    "backendProjectId",
    "title",
    "sourceText",
    "writerPlan",
    "stylePreset",
    "styleZh",
    "styleRevision",
    "artDesign",
    "costumes",
    "narrationVoiceId",
    "takesPerShot",
    "parallelism",
    "maxRetryRounds",
    "draft",
    "aspectRatio",
    "scenes",
    "characters",
    "locations",
    "props",
    "unassignedBeats",
    "audioMix",
    "subtitleStyle",
    "cover",
  ];
  const clips = riskTrialClips(record).filter((clip) => !clip.shotId);
  return {
    version: 1,
    ...Object.fromEntries(keys.map((key) => [key, record[key]])),
    shots: riskTrialShots(record).map((shot) => [shot.id, shot.sceneId, shot.no]),
    audioClips: clips,
  };
}
function riskTrialClips(record) {
  return Array.isArray(record.audioClips)
    ? record.audioClips.map((value) => {
        const clip = trialObject(value);
        if (!clip) throw Error("UNSUPPORTED_SCOPE");
        return Object.fromEntries(
          Object.entries(clip).filter(([key]) => !["waveform", "libraryAsset"].includes(key)),
        );
      })
    : [];
}
/** Reuse the production creative/reference projection. Status/output transitions of another
 * target are absent, but this target's own poster/stills, people and locations remain bound. */
export function riskTrialTarget(record, shot) {
  record = trialObject(record);
  shot = trialObject(shot);
  if (!record || !shot) throw Error("UNSUPPORTED_SCOPE");
  const selected = typeof shot.selectedTakeId === "string" ? shot.selectedTakeId : "";
  const context = dialogueEvidenceContext(record, String(shot.id), selected);
  if (!context) throw Error("UNSUPPORTED_SCOPE");
  return {
    ...context,
    creative: Object.fromEntries(
      Object.entries(shot).filter(
        ([key]) =>
          !["takes", "selectedTakeId", "poster", "posterPosition", "stills", "continuity"].includes(
            key,
          ),
      ),
    ),
    audioClips: riskTrialClips(record).filter((clip) => clip.shotId === shot.id),
  };
}
