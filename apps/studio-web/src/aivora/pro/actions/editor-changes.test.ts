import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import {
  applyEditorSuggestion,
  createPageUndoHistory,
  diffEditorSuggestion,
  undoEditorReceipt,
} from "./editor-changes";

const proposal = () => {
  const film = sampleFilm();
  const next = structuredClone(film);
  next.shots[0]!.picture = "雨滴落在旧书封面。";
  next.shots[0]!.action = "林晚合上书。";
  const selection = {
    projectId: film.id,
    page: "board" as const,
    sceneId: film.shots[0]!.sceneId,
    shotId: film.shots[0]!.id,
  };
  return { film, next, selection, diff: diffEditorSuggestion(film, next, selection) };
};
describe("field suggestions and page undo", () => {
  it("shows exact before and after values and applies atomically only to an unchanged baseline", () => {
    const { film, diff } = proposal();
    expect(diff.unsupported).toEqual([]);
    expect(diff.changes.map((change) => change.field)).toEqual(["picture", "action"]);
    expect(diff.changes[0]!.before.value).toBe(film.shots[0]!.picture);
    const edited = structuredClone(film);
    edited.shots[0]!.action = "用户后来改的动作";
    const blocked = applyEditorSuggestion(edited, diff);
    expect(blocked.film).toBe(edited);
    expect(blocked.receipt).toBeNull();
    expect(blocked.conflicts).toHaveLength(1);
  });
  it("undo preserves later edits and generated assets, and never restores a complete old project", () => {
    const { film, diff } = proposal();
    const applied = applyEditorSuggestion(film, diff);
    expect(applied.receipt).not.toBeNull();
    const latest = structuredClone(applied.film);
    latest.title = "后来改的作品名";
    latest.shots[0]!.picture = "用户后来改的画面";
    latest.shots[0]!.poster = "/real/generated-frame.png";
    latest.jobs = [
      ...latest.jobs,
      {
        id: "new-job",
        shotId: latest.shots[0]!.id,
        take: 1,
        kind: "video",
        status: "queued",
        prompt: "",
        reason: "",
      },
    ];
    const undone = undoEditorReceipt(latest, applied.receipt!);
    expect(undone.film.title).toBe(latest.title);
    expect(undone.film.shots[0]!.picture).toBe(latest.shots[0]!.picture);
    expect(undone.film.shots[0]!.action).toBe(film.shots[0]!.action);
    expect(undone.film.shots[0]!.poster).toBe(latest.shots[0]!.poster);
    expect(undone.film.jobs).toEqual(latest.jobs);
    expect(undone.conflicts).toHaveLength(1);
  });
  it("isolates undo by project and page and refuses stale cross-project receipts", () => {
    const { film, diff } = proposal();
    const applied = applyEditorSuggestion(film, diff);
    const history = createPageUndoHistory();
    history.record(applied.receipt!);
    expect(history.canUndo(film.id, "board")).toBe(true);
    expect(history.canUndo(film.id, "cast")).toBe(false);
    const other = { ...applied.film, id: "another-project" };
    expect(history.undo(other, "board").film).toBe(other);
    expect(undoEditorReceipt(other, applied.receipt!).conflicts).toEqual(["PROJECT_MISMATCH"]);
    expect(history.undo(applied.film, "board").film.shots[0]!.picture).toBe(film.shots[0]!.picture);
    expect(history.canUndo(film.id, "board")).toBe(false);
  });
  it("rejects additions, deletion, reordering, out-of-scope edits and generated-field replacement", () => {
    const { film, next, selection } = proposal();
    const variants = [
      { ...next, shots: next.shots.slice(1) },
      { ...next, shots: [...next.shots].reverse() },
      { ...next, shots: [...next.shots, { ...next.shots[0]!, id: "new" }] },
      {
        ...next,
        shots: next.shots.map((shot, index) =>
          index === 1 ? { ...shot, picture: "other selected shot" } : shot,
        ),
      },
      { ...next, jobs: [] },
    ];
    // Always create an actual job change, regardless of the fixture's initial jobs.
    variants[4] = {
      ...next,
      jobs: [
        { id: "fake", shotId: "", take: 0, kind: "video", status: "done", prompt: "", reason: "" },
      ],
    };
    for (const variant of variants) {
      const diff = diffEditorSuggestion(film, variant, selection);
      expect(diff.unsupported.length).toBeGreaterThan(0);
      expect(applyEditorSuggestion(film, diff).film).toBe(film);
    }
  });
  it("pins a shot-only selection to its scene and rejects it after the shot moves", () => {
    const { film, next, selection } = proposal();
    const diff = diffEditorSuggestion(film, next, {
      projectId: film.id,
      page: "board",
      shotId: selection.shotId,
    });
    expect(diff.selection.sceneId).toBe(selection.sceneId);
    const moved = structuredClone(film);
    moved.shots[0]!.sceneId = film.scenes.find((scene) => scene.id !== selection.sceneId)!.id;
    expect(applyEditorSuggestion(moved, diff).conflicts).toEqual(["SELECTION_MISMATCH"]);
    expect(applyEditorSuggestion(moved, diff).film).toBe(moved);
  });
  it("does not let a receipt target a different shot than its declared selection", () => {
    const { film, diff } = proposal();
    const other = film.shots[1]!;
    const changed = structuredClone(diff);
    changed.changes[0]!.target = { collection: "shots", id: other.id };
    changed.changes[0]!.before = { present: true, value: other.picture };
    expect(applyEditorSuggestion(film, changed).film).toBe(film);
    expect(applyEditorSuggestion(film, changed).receipt).toBeNull();
  });

  it("restores an absent optional field without removing unrelated new fields", () => {
    const { film, selection } = proposal();
    delete film.shots[0]!.delivery;
    const next = structuredClone(film);
    next.shots[0]!.delivery = "轻声";
    const applied = applyEditorSuggestion(film, diffEditorSuggestion(film, next, selection));
    const undone = undoEditorReceipt(applied.film, applied.receipt!);
    expect(Object.hasOwn(undone.film.shots[0]!, "delivery")).toBe(false);
  });
});
