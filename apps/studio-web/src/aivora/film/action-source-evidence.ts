import type { FilmScene, FilmShot } from "./project";
import { shotLines } from "./director-continuity";

export type ActionSourceScene = Pick<
  FilmScene,
  "id" | "text" | "writerSourceText" | "writerParagraphIds" | "sourceParagraphIds" | "userFields"
>;

const normalize = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");
const unquote = (text: string) => text.replace(/[“「"][^”」"]*[”」"]/gu, "");

/** Explicit paragraph provenance is usable only while its saved source snapshot is unchanged. */
export function actionSourcePassages(shot: FilmShot, scene?: ActionSourceScene): string[] {
  if (
    !scene ||
    scene.id !== shot.sceneId ||
    scene.writerSourceText !== scene.text ||
    scene.userFields.includes("text")
  )
    return [];
  const ids = scene.writerParagraphIds ?? [];
  const paragraphs = scene.text.split("\n");
  if (!ids.length || ids.length !== paragraphs.length || new Set(ids).size !== ids.length)
    return [];
  const reliable = new Set(scene.sourceParagraphIds ?? []);
  const hints =
    shot.directorPlan?.segments.flatMap((segment) => segment.sourceParagraphHints) ?? [];
  return [...new Set(hints)].flatMap((id) => {
    const index = ids.indexOf(id);
    return reliable.has(id) && index >= 0 ? [paragraphs[index]!] : [];
  });
}

/** A dialogue mention, character name, or shared weapon is not evidence of an action shot. */
export function sourceSupportsActionShot(
  shot: FilmShot,
  cue: string,
  sourceText: string,
  scene: ActionSourceScene | undefined,
  overlaps: (cue: string, evidence: string) => boolean,
  evidence: (text: string) => string,
): boolean {
  const normalizedCue = evidence(cue);
  if (!normalizedCue || !overlaps(normalizedCue, evidence(sourceText))) return false;
  const visual = unquote(shot.picture);
  const dialogueOnly = shotLines(shot).length > 0 || /说|问|回答|对白|对话|开口/.test(visual);
  const declared = actionSourcePassages(shot, scene);
  // An explicit source paragraph can supply the movement missing from a terse silent frame.
  if (!dialogueOnly && declared.some((text) => overlaps(normalizedCue, evidence(text))))
    return true;
  // Without paragraph provenance, require substantial visual words from the very same
  // source sentence as the movement; do not match a neighbouring sentence or spoken line.
  let anchor = normalize(visual);
  for (const name of shot.characters) anchor = anchor.replaceAll(normalize(name), "");
  anchor = anchor.replace(/铁棍|钢条|钢管|折叠刀|匕首|刀锋|刀|拳头|手臂|镜头|画面/gu, "");
  if (anchor.length < 6) return false;
  return sourceText
    .split(/[。！？\n]/u)
    .some(
      (sentence) =>
        overlaps(normalizedCue, evidence(sentence)) &&
        normalize(unquote(sentence)).includes(anchor),
    );
}
