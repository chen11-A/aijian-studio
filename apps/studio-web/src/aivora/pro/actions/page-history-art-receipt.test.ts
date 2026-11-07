import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { setFilmStyle } from "../../film/style-bible";
import { prepareArtTransaction, applyArtTransaction } from "./art-transaction";
import { createEditorPageHistory } from "./page-history";
function fixture(add = false) {
  const base = sampleFilm(),
    scope = { projectId: base.id, page: "cast" as const };
  const draft = setFilmStyle(base, "暖色胶片");
  if (add)
    draft.locations = [
      ...draft.locations,
      { id: "new-location", name: "新的室内", prompt: "木质房间", ambience: "雨声" },
    ];
  const tx = prepareArtTransaction(base, draft, scope),
    applied = applyArtTransaction(base, tx);
  if (!applied.receipt) throw Error("ART_FIXTURE_REJECTED");
  const history = createEditorPageHistory(),
    token = history.recordArt(applied.receipt);
  return { base, scope, tx, applied: applied.film, history, token };
}
it("takes only the exact art receipt out of past while preserving unrelated newer edits, late media and real redo", () => {
  const f = fixture(),
    latest = structuredClone(f.applied);
  latest.title = "用户新标题";
  latest.shots[0]!.poster = "/late.png";
  f.history.record(f.applied, latest, f.scope);
  const undone = f.history.undoArtReceipt(latest, f.scope, f.token);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film.styleZh).toBe(f.base.styleZh);
  expect(undone.film.title).toBe("用户新标题");
  expect(undone.film.shots[0]!.poster).toBe("/late.png");
  expect(f.history.artReceiptState(f.scope, f.token)).toBe("undone");
  expect(f.history.undoArtReceipt(undone.film, f.scope, f.token).receipt).toBeNull();
  const redo = f.history.redo(undone.film, f.scope);
  expect(redo.film.styleZh).toBe("暖色胶片");
  expect(redo.film.shots[0]!.poster).toBe("/late.png");
  expect(f.history.artReceiptState(f.scope, f.token)).toBe("applied");
  const again = f.history.undoArtReceipt(redo.film, f.scope, f.token);
  expect(again.receipt).not.toBeNull();
  const title = f.history.undo(again.film, f.scope);
  expect(title.film.title).toBe(f.base.title);
});
it.each(["after", "scope", "project", "added-media", "added-reference"])(
  "refuses later %s changes atomically and retains the receipt",
  (mode) => {
    const f = fixture(true),
      live = structuredClone(f.applied),
      scope = { ...f.scope };
    if (mode === "after") live.styleZh = "后来画风";
    if (mode === "scope") scope.page = "script" as typeof scope.page;
    if (mode === "project") live.id = "another-project";
    if (mode === "added-media") live.locations.at(-1)!.referenceImage = "/late-location.png";
    if (mode === "added-reference") live.scenes[0]!.where = "新的室内";
    const result = f.history.undoArtReceipt(live, scope, f.token);
    expect(result.film).toBe(live);
    expect(result.receipt).toBeNull();
    expect(f.history.artReceiptState(f.scope, f.token)).toBe("applied");
  },
);
it("retires old art tokens on reset and keeps them distinct from direction/global undo", () => {
  const f = fixture();
  const undone = f.history.undo(f.applied, f.scope);
  expect(f.history.artReceiptState(f.scope, f.token)).toBe("undone");
  expect(f.history.undoArtReceipt(undone.film, f.scope, f.token).receipt).toBeNull();
  f.history.redo(undone.film, f.scope);
  expect(f.history.artReceiptState(f.scope, f.token)).toBe("applied");
  f.history.clear();
  expect(f.history.artReceiptState(f.scope, f.token)).toBe("missing");
  expect(f.history.recordArt(f.tx)).not.toBe(f.token);
});
