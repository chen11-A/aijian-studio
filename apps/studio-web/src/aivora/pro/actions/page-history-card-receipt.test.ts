import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { createEditorPageHistory } from "./page-history";
import { applyShotDirection, prepareShotDirection } from "./shot-direction-transaction";
function fixture() {
  const film = sampleFilm(),
    shot = film.shots[0]!;
  const scope = {
    projectId: film.id,
    page: "board" as const,
    sceneId: shot.sceneId,
    shotId: shot.id,
  };
  const tx = prepareShotDirection(
    film,
    { ...shot, performance: "新的表演", performanceSource: "agent:performance" },
    scope,
    "performance",
  );
  const applied = applyShotDirection(film, tx);
  if (!applied.receipt) throw Error("FIXTURE_REJECTED");
  const history = createEditorPageHistory();
  const token = history.recordDirection(applied.receipt);
  return { film, shot, scope, tx, applied: applied.film, history, token };
}
it("undoes only the exact card receipt, preserving unrelated newer edits, future and late media", () => {
  const f = fixture(),
    later = structuredClone(f.applied);
  later.title = "后来标题";
  later.shots[0]!.poster = "/late.png";
  later.shots[1]!.picture = "另一个镜头的新画面";
  f.history.record(f.applied, later, f.scope);
  const undone = f.history.undoDirectionReceipt(later, f.scope, f.token);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film.title).toBe("后来标题");
  expect(undone.film.shots[0]!.poster).toBe("/late.png");
  expect(undone.film.shots[0]!.performance).toBe(f.shot.performance);
  expect(f.history.directionReceiptState(f.scope, f.token)).toBe("undone");
  const old = f.history.undoDirectionReceipt(undone.film, f.scope, f.token);
  expect(old.film).toBe(undone.film);
  expect(old.receipt).toBeNull();
  const redone = f.history.redo(undone.film, f.scope);
  expect(redone.film.title).toBe("后来标题");
  expect(redone.film.shots[0]!.performance).toBe("新的表演");
  expect(f.history.directionReceiptState(f.scope, f.token)).toBe("applied");
  const titleUndo = f.history.undoDirectionReceipt(redone.film, f.scope, f.token);
  const latest = f.history.undo(titleUndo.film, f.scope);
  expect(latest.film.title).toBe("后来标题");
  expect(latest.film.shots[1]!.picture).toBe(f.film.shots[1]!.picture);
  expect(latest.film.shots[0]!.performance).toBe(f.shot.performance);
});
it.each(["after", "state", "lock", "scope", "project"])(
  "refuses %s conflicts atomically and retains the same receipt",
  (mode) => {
    const f = fixture(),
      live = structuredClone(f.applied),
      scope = { ...f.scope };
    if (mode === "after") live.shots[0]!.performance = "手工新表演";
    if (mode === "state")
      live.scenes.find((row) => row.id === f.scope.sceneId)!.performanceState = { unassigned: [] };
    if (mode === "lock") live.shots[0]!.userFields.push("performance");
    if (mode === "scope") scope.shotId = "another";
    if (mode === "project") live.id = "another";
    const result = f.history.undoDirectionReceipt(live, scope, f.token);
    expect(result.film).toBe(live);
    expect(result.receipt).toBeNull();
    expect(f.history.directionReceiptState(f.scope, f.token)).toBe("applied");
  },
);
it("tracks the token through toolbar undo/redo and invalidates old tokens after history reset", () => {
  const f = fixture();
  const toolbar = f.history.undo(f.applied, f.scope);
  expect(f.history.directionReceiptState(f.scope, f.token)).toBe("undone");
  expect(f.history.undoDirectionReceipt(toolbar.film, f.scope, f.token).receipt).toBeNull();
  const redo = f.history.redo(toolbar.film, f.scope);
  expect(f.history.directionReceiptState(f.scope, f.token)).toBe("applied");
  f.history.clear();
  expect(f.history.directionReceiptState(f.scope, f.token)).toBe("missing");
  expect(f.history.undoDirectionReceipt(redo.film, f.scope, f.token).film).toBe(redo.film);
  expect(f.history.recordDirection(f.tx)).not.toBe(f.token);
});
it("preserves an existing unrelated future entry when undoing the card and then redoing both actions", () => {
  const f = fixture(),
    edited = structuredClone(f.applied);
  edited.shots[1]!.picture = "后来的另一镜";
  f.history.record(f.applied, edited, f.scope);
  const before = f.history.undo(edited, f.scope).film;
  expect(before.shots[1]!.picture).toBe(f.film.shots[1]!.picture);
  const card = f.history.undoDirectionReceipt(before, f.scope, f.token);
  expect(card.receipt).not.toBeNull();
  const redoCard = f.history.redo(card.film, f.scope).film;
  expect(redoCard.shots[0]!.performance).toBe("新的表演");
  expect(redoCard.shots[1]!.picture).toBe(f.film.shots[1]!.picture);
  const redoOther = f.history.redo(redoCard, f.scope).film;
  expect(redoOther.shots[1]!.picture).toBe("后来的另一镜");
  expect(f.history.canRedo(f.scope)).toBe(false);
});
