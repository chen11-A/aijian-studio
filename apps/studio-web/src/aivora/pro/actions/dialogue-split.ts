import { dialogueSplitContext } from "@aijian/contracts/film-dialogue-split-plan";
import type { FilmProject } from "../../film/project";
import { planDialogueSplit, type DialogueSplitPlan } from "../../film/dialogue-split-plan";
import { historyRecordHash } from "./persistent-history";
export type DialogueSplitPreview =
  | Exclude<DialogueSplitPlan, { kind: "READY" }>
  | (Extract<DialogueSplitPlan, { kind: "READY" }> & {
      projectId: string;
      sourceShotId: string;
      sceneId: string;
      selectedTakeId: string;
      model: string;
      /** Display/CAS freshness only, not authorization to write or dispatch. */
      inputFingerprint: string;
    });
export type DialogueSplitOptions = { versions: number };
function capture(film: FilmProject, shotId: string, options: DialogueSplitOptions) {
  if (!options || Object.keys(options).sort().join() !== "versions") return null;
  return dialogueSplitContext(film, shotId, options.versions);
}
/** Offline only: never call previewVoice/speak, generation, persistence or mutate the film. */
export async function prepareDialogueSplitPreview(
  film: FilmProject,
  shotId: string,
  options: DialogueSplitOptions,
): Promise<DialogueSplitPreview> {
  const captured = capture(film, shotId, options);
  if (!captured) return { kind: "UNSUPPORTED", code: "INVALID_INPUT" };
  const plan = planDialogueSplit(captured.request);
  if (plan.kind !== "READY") return plan;
  const key = JSON.stringify(captured.semantic);
  const inputFingerprint = await historyRecordHash({
    ...captured.semantic,
    parts: plan.parts,
  }).catch(() => "");
  if (!inputFingerprint) return { kind: "UNSUPPORTED", code: "FINGERPRINT_UNAVAILABLE" };
  if (JSON.stringify(capture(film, shotId, options)?.semantic) !== key)
    return { kind: "UNSUPPORTED", code: "INPUT_CHANGED" };
  return { ...plan, ...captured.scope, inputFingerprint };
}
/** Recompute on live project/selection/versions before presenting or later accepting a preview. */
export async function dialogueSplitPreviewCurrent(
  film: FilmProject | null,
  shotId: string,
  options: DialogueSplitOptions,
  reviewed: DialogueSplitPreview,
): Promise<boolean> {
  if (!film || reviewed.kind !== "READY" || reviewed.sourceShotId !== shotId) return false;
  const latest = await prepareDialogueSplitPreview(film, shotId, options);
  return latest.kind === "READY" && latest.inputFingerprint === reviewed.inputFingerprint;
}
