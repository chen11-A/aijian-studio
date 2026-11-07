import type { FilmProject, FilmShot } from "./project";
import { constrainVisualPrompt, onScreenCharacters } from "./on-screen-characters";
import { withShotCostumes } from "./costume-rules";
import { locationReference, withLocationLayout } from "./location-reference";
import { firstFrameReferences } from "./operations";
import { withStyleBible } from "./style-bible";

/** The single pure request producer used by both the editor and native prerequisite
 * verification. It selects actual visible references and never performs a request. */
export function shotStillInput(film: FilmProject, shot: FilmShot, prompt: string) {
  const visualFilm = { ...film, characters: onScreenCharacters(film, shot) };
  const visible = visualFilm.characters.filter((person) =>
    person.portraits.some((portrait) => portrait.url),
  );
  const portraitLimit = locationReference(visualFilm, shot) ? 4 : 5;
  if (visible.length > portraitLimit) return { kind: "FAILED" as const, code: "STILL_CAST_LIMIT" };
  return {
    kind: "READY" as const,
    prompt: withStyleBible(
      constrainVisualPrompt(
        withShotCostumes(
          withLocationLayout(
            prompt.replace(/[^。！？\n]*<IMAGE_\d+>[^。！？\n]*[。！？]?/gi, "").trim(),
            film,
            shot,
          ),
          film,
          shot,
        ),
        film,
        shot,
      ),
      film.styleZh,
    ),
    aspectRatio: film.aspectRatio === "16:9" ? ("16:9" as const) : ("9:16" as const),
    // One portrait per visible person before extra views; never omit a person.
    references: firstFrameReferences(visualFilm, shot),
  };
}
