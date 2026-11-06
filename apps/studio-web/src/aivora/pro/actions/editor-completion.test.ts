import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { editorCompletionCurrent } from "./editor-completion";
it("allows only the same applied version and original view to announce a delayed save", () => {
  const film = sampleFilm(),
    origin = { projectId: film.id, page: "script" as const, sceneId: film.scenes[0]!.id };
  expect(editorCompletionCurrent(film, origin, film, origin)).toBe(true);
  expect(editorCompletionCurrent(film, origin, { ...film }, origin)).toBe(false);
  expect(editorCompletionCurrent(film, origin, film, { ...origin, page: "board" })).toBe(false);
  expect(
    editorCompletionCurrent(film, origin, film, { ...origin, sceneId: film.scenes[1]!.id }),
  ).toBe(false);
});
