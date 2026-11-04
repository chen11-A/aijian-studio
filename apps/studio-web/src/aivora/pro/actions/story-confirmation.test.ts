import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import {
  prepareDirectorConfirmation,
  applyStoryConfirmation,
  undoStoryConfirmation,
} from "./story-confirmation";
import { createEditorPageHistory } from "./page-history";
function fixture() {
  const film = sampleFilm();
  film.scenes = film.scenes.slice(0, 2).map((scene) => ({ ...scene, userFields: [] }));
  film.jobs = [];
  film.audioClips = [];
  film.shots = film.scenes.map((scene, index) => ({
    ...film.shots[0]!,
    id: `${scene.id}-shot-1`,
    sceneId: scene.id,
    no: 1,
    picture: `old ${index}`,
    source: "agent:director",
    userFields: [],
    poster: "",
    stills: [],
    takes: [],
    selectedTakeId: "",
    continuityFrame: undefined,
    continuityFromShotId: undefined,
  }));
  const proposed = film.shots.map((shot) => ({ ...shot, picture: `new ${shot.id}` }));
  const tx = prepareDirectorConfirmation(film, proposed);
  return { film, proposed, tx };
}
it("applies and undoes all reviewed scenes together under the actual request page", () => {
  const { film, proposed, tx } = fixture();
  expect(tx.unsupported).toEqual([]);
  const applied = applyStoryConfirmation(film, tx);
  expect(applied.conflicts).toEqual([]);
  expect(applied.film.shots.map((shot) => shot.picture)).toEqual(
    proposed.map((shot) => shot.picture),
  );
  const history = createEditorPageHistory(),
    origin = { projectId: film.id, page: "script" as const, sceneId: film.scenes[0]!.id };
  history.recordStory(applied.receipt!, origin);
  expect(history.canUndo({ ...origin, page: "board" })).toBe(false);
  expect(history.undo(applied.film, origin).film.shots.map((shot) => shot.picture)).toEqual(
    film.shots.map((shot) => shot.picture),
  );
});
it("rejects a later-scene conflict without partially applying an earlier scene", () => {
  const { film, tx } = fixture();
  film.shots[1]!.picture = "later user edit";
  const result = applyStoryConfirmation(film, tx);
  expect(result.film).toBe(film);
  expect(result.receipt).toBeNull();
  expect(film.shots[0]!.picture).toBe("old 0");
});
it("rejects unknown scene and duplicate shot IDs", () => {
  const { film, proposed } = fixture();
  expect(
    prepareDirectorConfirmation(film, [{ ...proposed[0]!, sceneId: "unknown" }]).unsupported,
  ).toContain("INVALID_SCOPE_IDS");
  expect(prepareDirectorConfirmation(film, [proposed[0]!, proposed[0]!]).unsupported).toContain(
    "INVALID_SCOPE_IDS",
  );
});
it("keeps all new work if any scene blocks group undo", () => {
  const { film, tx } = fixture();
  const applied = applyStoryConfirmation(film, tx);
  applied.film.shots[0]!.poster = "/later.png";
  const undone = undoStoryConfirmation(applied.film, tx);
  expect(undone.film).toBe(applied.film);
  expect(undone.receipt).toBeNull();
  expect(undone.film.shots[1]!.picture).toContain("new ");
});
