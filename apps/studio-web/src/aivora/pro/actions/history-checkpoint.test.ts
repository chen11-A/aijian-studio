import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { historyCheckpoint } from "./history-checkpoint";
import type { EditorSelection } from "./editor-context";
it.each(["new-film", "new-page", "new-shot"])(
  "does not commit a stale timer after %s before cleanup runs",
  (kind) => {
    vi.useFakeTimers();
    try {
      const film = sampleFilm();
      let current = film;
      let selection: EditorSelection = {
        projectId: film.id,
        page: "board",
        sceneId: film.shots[0]!.sceneId,
        shotId: film.shots[0]!.id,
      };
      const commit = vi.fn();
      const callback = historyCheckpoint(film, selection, {
        current: () => current,
        selection: () => selection,
        commit,
      });
      setTimeout(callback, 500);
      if (kind === "new-film") current = { ...film, title: "new synchronous edit" };
      if (kind === "new-page") selection = { ...selection, page: "cast" };
      if (kind === "new-shot") selection = { ...selection, shotId: film.shots[1]!.id };
      // No clearTimeout/React effect cleanup: the callback itself must reject stale ownership.
      vi.advanceTimersByTime(500);
      expect(commit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);
it("commits a current checkpoint under its captured page", () => {
  const film = sampleFilm(),
    selection: EditorSelection = { projectId: film.id, page: "script" };
  const commit = vi.fn();
  expect(
    historyCheckpoint(film, selection, {
      current: () => film,
      selection: () => ({ ...selection }),
      commit,
    })(),
  ).toBe(true);
  expect(commit).toHaveBeenCalledExactlyOnceWith(film, selection);
});
