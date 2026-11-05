import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { createEditorPageHistory } from "./page-history";

it("keeps per-page field undo and redo without restoring later media", () => {
  const history = createEditorPageHistory();
  const before = sampleFilm(),
    edited = structuredClone(before);
  edited.shots[0]!.picture = "edited picture";
  edited.shots[0]!.userFields = ["picture"];
  const scope = { projectId: before.id, page: "board" as const };
  expect(history.record(before, edited, scope)).toEqual([]);
  const live = structuredClone(edited);
  live.shots[0]!.poster = "/later.png";
  live.title = "new title";
  expect(history.undo(live, { ...scope, page: "script" }).film).toBe(live);
  expect(history.undo({ ...live, id: "other" }, scope).conflicts).toContain("PROJECT_MISMATCH");
  const undone = history.undo(live, scope).film;
  expect(undone.shots[0]!.picture).toBe(before.shots[0]!.picture);
  expect(undone.shots[0]!.poster).toBe("/later.png");
  expect(undone.title).toBe("new title");
  expect(history.redo(undone, scope).film.shots[0]!.picture).toBe("edited picture");
});

it("refuses mixed structural history without restoring a snapshot", () => {
  const history = createEditorPageHistory(),
    before = sampleFilm();
  const after = { ...before, shots: before.shots.slice(1) };
  const scope = { projectId: before.id, page: "board" as const };
  expect(history.record(before, after, scope)).toContain("STRUCTURAL_HISTORY_UNSUPPORTED");
  expect(history.undo(after, scope).film).toBe(after);
});

it("undoes a scoped pure shot insertion but refuses to delete subsequent media", () => {
  const history = createEditorPageHistory(),
    before = sampleFilm();
  const added = {
    ...structuredClone(before.shots[0]!),
    id: "new-history-shot",
    no: 99,
    poster: "",
    stills: [],
    takes: [],
    selectedTakeId: "",
  };
  const after = { ...before, shots: [...before.shots, added] };
  const scope = { projectId: before.id, page: "board" as const, sceneId: added.sceneId };
  expect(history.record(before, after, scope)).toEqual([]);
  const live = structuredClone(after);
  live.shots.at(-1)!.poster = "/later.png";
  expect(history.undo(live, scope).film).toBe(live);
  const undone = history.undo(after, scope);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film.shots).toEqual(before.shots);
});

it("protects newly user-locked fields when undoing an AI receipt", () => {
  const history = createEditorPageHistory(),
    before = sampleFilm();
  const shot = before.shots[0]!;
  const scope = {
    projectId: before.id,
    page: "board" as const,
    shotId: shot.id,
    sceneId: shot.sceneId,
  };
  history.recordReceipt({
    selection: scope,
    changes: [
      {
        target: { collection: "shots", id: shot.id },
        field: "promptEn",
        before: { present: false, value: undefined },
        after: { present: true, value: "new prompt" },
      },
    ],
  });
  shot.promptEn = "new prompt";
  shot.userFields.push("promptEn");
  expect(history.undo(before, scope).conflicts).toContain("FIELD_LOCKED");
});
