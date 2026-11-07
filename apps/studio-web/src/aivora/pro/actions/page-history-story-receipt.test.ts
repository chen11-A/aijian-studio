import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { prepareDirectorConfirmation, applyStoryConfirmation } from "./story-confirmation";
import { createEditorPageHistory } from "./page-history";
function fixture() {
  const film = sampleFilm();
  film.scenes = film.scenes.slice(0, 2);
  film.jobs = [];
  film.audioClips = [];
  film.shots = film.scenes.map((scene, index) => ({
    ...film.shots[0]!,
    id: `director-origin-${index}`,
    sceneId: scene.id,
    no: 1,
    picture: `原画面${index}`,
    source: "agent:director",
    userFields: [],
    poster: "",
    stills: [],
    takes: [],
    selectedTakeId: "",
  }));
  const origin = {
    projectId: film.id,
    page: "board" as const,
    sceneId: film.scenes[0]!.id,
    shotId: film.shots[0]!.id,
  };
  const tx = prepareDirectorConfirmation(film, [{ ...film.shots[0]!, picture: "新画面" }]);
  const applied = applyStoryConfirmation(film, tx);
  expect(applied.receipt).not.toBeNull();
  const history = createEditorPageHistory(),
    token = history.recordStory(applied.receipt!, origin);
  return { film, origin, applied: applied.film, history, token };
}
it("targets only its own original story entry and preserves an unrelated newer entry and late media", () => {
  const f = fixture(),
    live = structuredClone(f.applied);
  live.title = "新标题";
  live.shots[1]!.picture = "别场新画面";
  live.shots[1]!.poster = "/late.png";
  f.history.record(f.applied, live, f.origin);
  const undo = f.history.undoStoryReceipt(live, f.origin, f.token);
  expect(undo.receipt).not.toBeNull();
  expect(undo.film.shots[0]!.picture).toBe(f.film.shots[0]!.picture);
  expect(undo.film.shots[1]!.poster).toBe("/late.png");
  expect(undo.film.title).toBe("新标题");
  expect(f.history.storyReceiptState(f.origin, f.token)).toBe("undone");
  const again = f.history.redo(undo.film, f.origin);
  expect(again.film.shots[0]!.picture).toBe("新画面");
  expect(again.film.title).toBe("新标题");
  expect(f.history.storyReceiptState(f.origin, f.token)).toBe("applied");
  const ownAgain = f.history.undo(again.film, f.origin);
  expect(ownAgain.film.title).toBe("新标题");
  const other = f.history.undo(ownAgain.film, f.origin);
  expect(other.film.shots[1]!.picture).toBe(f.film.shots[1]!.picture);
  expect(other.film.title).toBe("新标题");
});
it.each(["source", "after", "media", "scope", "project"])(
  "refuses a %s conflict without consuming a different entry",
  (mode) => {
    const f = fixture(),
      live = structuredClone(f.applied),
      scope = { ...f.origin };
    if (mode === "source") live.scenes[0]!.text = "新原文";
    if (mode === "after") live.shots[0]!.picture = "用户新画面";
    if (mode === "media") live.shots[0]!.poster = "/late-target.png";
    if (mode === "scope") scope.shotId = f.film.shots[1]!.id;
    if (mode === "project") live.id = "another-project";
    const result = f.history.undoStoryReceipt(live, scope, f.token);
    expect(result.receipt).toBeNull();
    expect(result.film).toBe(live);
    expect(f.history.storyReceiptState(f.origin, f.token)).toBe("applied");
  },
);
it("tracks toolbar undo and reset without reusing a retired token", () => {
  const f = fixture();
  expect(f.history.undo(f.applied, f.origin).conflicts).toEqual([]);
  expect(f.history.storyReceiptState(f.origin, f.token)).toBe("undone");
  expect(f.history.undoStoryReceipt(f.applied, f.origin, f.token).receipt).toBeNull();
  f.history.clear();
  expect(f.history.storyReceiptState(f.origin, f.token)).toBe("missing");
  const next = f.history.recordStory(
    prepareDirectorConfirmation(f.film, [{ ...f.film.shots[0]!, picture: "另一次" }]),
    f.origin,
  );
  expect(next).not.toBe(f.token);
});
