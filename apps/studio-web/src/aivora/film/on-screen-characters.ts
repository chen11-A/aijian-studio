import type { FilmCharacter, FilmProject, FilmShot } from "./project";
import { shotActionText } from "./shot-actions";
import { directorOffscreenNames } from "./director-plan";

const escape = (value: string) => value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
const absence =
  "(?:不入画|未入画|不出镜|未出镜|不在画面(?:中|里)?|不在镜头(?:中|里)?|不出现在画面|未出现在画面|不在场|画外音|旁白|画外|镜头外|off[- ]screen|out of (?:the )?frame|not visible)";

/** Absence is a shot-level visual constraint, never inferred from a character's spoken line. */
function visualText(shot: FilmShot): string {
  const edited = shot.userFields.includes("picture") || shot.userFields.includes("action");
  return [
    shot.picture,
    shotActionText(shot),
    shot.blocking,
    shot.facing,
    shot.performance,
    // Speaker labels may explicitly say 画外音/旁白; spoken dialogue is never scanned.
    shot.speaker,
    ...(shot.lines ?? []).map((line) => line.speaker),
    ...(edited ? [] : [shot.promptZh, shot.directorFramePrompt, shot.directorVideoPrompt]),
  ]
    .filter(Boolean)
    .join("\n");
}

function explicitlyAbsent(text: string, name: string, names: readonly string[]): boolean {
  const other = names
    .filter((item) => item !== name)
    .map(escape)
    .join("|");
  const group = other ? `(?:(?:、|和|与|及|以及)\\s*(?:${other})\\s*)*` : "";
  const prefix = new RegExp(
    `${escape(name)}\\s*${group}(?:[（(：:]\\s*)?(?:全程|始终|仍然|仍|均|都)?\\s*(?:在|位于|处于)?\\s*(?:(?:的)?(?:声音|对白|台词)\\s*(?:从|在)?\\s*)?${absence}`,
    "giu",
  );
  for (const match of text.matchAll(prefix)) {
    // A negated absence is not an instruction to exclude the character.
    if (!/(?:不是|并非|并不是|不代表)\s*$/u.test(text.slice(0, match.index))) return true;
  }
  return new RegExp(
    `(?:${absence}\\s*[：:（(]\\s*|(?:不要拍到|不拍到|不要让|不让|不显示|不包含|画面(?:中)?没有)\\s*)${escape(name)}(?:[）)]|入画|出镜|[，,。；;\\s]|$)`,
    "iu",
  ).test(text);
}

/** Only explicit visual exclusions; voice casting and dialogue remain untouched. */
export function offscreenCharacterNames(shot: FilmShot, names: readonly string[]): string[] {
  const text = visualText(shot);
  const placedOff = new Set(directorOffscreenNames(shot));
  return [...new Set(names.filter((name) => name.trim()))].filter(
    (name) => placedOff.has(name) || explicitlyAbsent(text, name, names),
  );
}

/** An empty character list does not mean every person in the project is visible. */
export function onScreenCharacters(
  film: Pick<FilmProject, "characters">,
  shot: FilmShot,
): FilmCharacter[] {
  const names = film.characters.map((person) => person.name);
  const excluded = new Set(offscreenCharacterNames(shot, names));
  const declared = new Set([
    ...shot.characters,
    shot.speaker ?? "",
    ...(shot.lines ?? []).map((line) => line.speaker),
  ]);
  const picture = visualText(shot);
  return film.characters.filter(
    (person) =>
      !excluded.has(person.name) &&
      (declared.has(person.name) || (!shot.characters.length && picture.includes(person.name))),
  );
}

/** Drop stale positive visual instructions for an explicitly absent person, not stored source. */
export function withoutOffscreenVisuals(
  prompt: string,
  film: Pick<FilmProject, "characters">,
  shot: FilmShot,
): string {
  const names = film.characters.map((person) => person.name);
  const excluded = offscreenCharacterNames(shot, names);
  if (!excluded.length) return prompt;
  return (prompt.match(/[^。！？!?；;\n]+[。！？!?；;]?|\n/gu) ?? [])
    .filter((clause) =>
      excluded.every((name) => !clause.includes(name) || explicitlyAbsent(clause, name, names)),
    )
    .join("")
    .trim();
}

/** Final request boundary: cached prompts cannot override the current shot's exclusion. */
export function constrainVisualPrompt(
  prompt: string,
  film: Pick<FilmProject, "characters">,
  shot: FilmShot,
): string {
  const excluded = offscreenCharacterNames(
    shot,
    film.characters.map((person) => person.name),
  );
  if (!excluded.length) return prompt;
  const body = withoutOffscreenVisuals(prompt, film, shot);
  const restriction = `画面限制：${excluded.join("、")}不入画。`;
  return body.includes(restriction) ? body : [body, restriction].filter(Boolean).join("\n");
}
