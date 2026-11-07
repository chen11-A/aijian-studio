import type { FilmProject } from "../../film/project";
import { shotLines } from "../../film/director-continuity";
import { shotReference } from "../../film/operations";
import { VIDEO_DRAFT_MODEL, VIDEO_MODEL } from "../capabilities";
import {
  dialogueVideoCap,
  planDialogueSplit,
  type DialogueSplitPlan,
} from "../../film/dialogue-split-plan";
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
  if (
    !film ||
    !Array.isArray(film.shots) ||
    !options ||
    Object.keys(options).sort().join() !== "versions"
  )
    return null;
  const matches = film.shots.filter((shot) => shot.id === shotId);
  if (matches.length !== 1) return null;
  const shot = matches[0]!,
    model = film.draft ? VIDEO_DRAFT_MODEL : VIDEO_MODEL;
  const refs = shotReference(shot, film),
    cap = dialogueVideoCap(model, Boolean(refs.still || refs.references.length));
  if (!cap) return null;
  const lines = shotLines(shot).map((line) => ({ speaker: line.speaker, text: line.text }));
  const scope = {
    projectId: film.id,
    sourceShotId: shot.id,
    sceneId: shot.sceneId,
    selectedTakeId: shot.selectedTakeId,
    model,
  };
  const semantic = {
    version: "dialogue-split-preview-v1",
    scope,
    versions: options.versions,
    cap,
    lines,
    shot: {
      seconds: shot.seconds,
      picture: shot.picture,
      action: shot.action,
      characters: shot.characters,
      speaker: shot.speaker,
      delivery: shot.delivery,
      userFields: shot.userFields,
      selectedTakeId: shot.selectedTakeId,
      poster: shot.poster,
      takes: shot.takes.map((take) => ({
        id: take.id,
        status: take.status,
        videoPath: take.videoPath,
        cleanVideoPath: take.cleanVideoPath,
      })),
      stills: shot.stills.map((still) => ({ id: still.id, url: still.url })),
    },
  };
  return { scope, semantic, request: { lines, maxVideoSeconds: cap, versions: options.versions } };
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
