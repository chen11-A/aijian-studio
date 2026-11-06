import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { applyEditorSuggestion, diffEditorSuggestion } from "./editor-changes";
import { createEditorPageHistory } from "./page-history";

describe("5-3-03 field history labels", () => {
  it("describes a field undo and redo while preserving later media and other page edits", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.shots[0]!.picture = "修改后的画面";
    edited.shots[0]!.userFields = ["picture"];
    const scope = { projectId: before.id, page: "board" as const };
    expect(history.record(before, edited, scope)).toEqual([]);
    const live = structuredClone(edited);
    live.shots[0]!.poster = "/later-picture.png";
    live.title = "稍后修改的作品名";

    const undone = history.undo(live, scope);
    expect(undone).toMatchObject({ conflicts: [], label: "修改镜头 1 的画面" });
    expect(undone.film.shots[0]!.picture).toBe(before.shots[0]!.picture);
    expect(undone.film.shots[0]!.poster).toBe("/later-picture.png");
    expect(undone.film.title).toBe(live.title);

    const redone = history.redo(undone.film, scope);
    expect(redone).toMatchObject({ conflicts: [], label: "修改镜头 1 的画面" });
    expect(redone.film.shots[0]!.picture).toBe(edited.shots[0]!.picture);
    expect(redone.film.shots[0]!.poster).toBe("/later-picture.png");
    expect(redone.film.title).toBe(live.title);
  });

  it("describes only the successful fields of a partial undo and its redo", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.shots[0]!.picture = "第一次修改画面";
    edited.shots[0]!.action = "第一次修改动作";
    const scope = { projectId: before.id, page: "board" as const };
    expect(history.record(before, edited, scope)).toEqual([]);
    const live = structuredClone(edited);
    live.shots[0]!.picture = "后来独立修改的画面";

    const undone = history.undo(live, scope);
    expect(undone.conflicts).toHaveLength(1);
    expect(undone).toHaveProperty("label", "修改镜头 1 的动作");
    expect(undone.film.shots[0]!.picture).toBe(live.shots[0]!.picture);
    expect(undone.film.shots[0]!.action).toBe(before.shots[0]!.action);
    const redone = history.redo(undone.film, scope);
    expect(redone).toMatchObject({ conflicts: [], label: "修改镜头 1 的动作" });
    expect(redone.film.shots[0]!.picture).toBe(live.shots[0]!.picture);
    expect(redone.film.shots[0]!.action).toBe(edited.shots[0]!.action);
  });

  it("does not return a success label when every field conflicts or the project differs", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.shots[0]!.picture = "第一次修改";
    const scope = { projectId: before.id, page: "board" as const };
    expect(history.record(before, edited, scope)).toEqual([]);
    const live = structuredClone(edited);
    live.shots[0]!.picture = "后来修改";

    const refused = history.undo(live, scope);
    expect(refused.conflicts).toHaveLength(1);
    expect(refused.film).toBe(live);
    expect(refused).not.toHaveProperty("label");
    expect(history.canUndo(scope)).toBe(true);
    expect(history.undo({ ...live, id: "another-project" }, scope)).not.toHaveProperty("label");
  });

  it("describes all changed rows in a debounced page edit rather than just the selection", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.shots[0]!.seconds += 1;
    edited.shots[1]!.seconds += 2;
    const scope = {
      projectId: before.id,
      page: "board" as const,
      shotId: before.shots[1]!.id,
    };
    expect(history.record(before, edited, scope)).toEqual([]);

    const undone = history.undo(edited, scope);
    expect(undone).toMatchObject({ conflicts: [], label: "修改 2 个镜头的时长" });
    expect(undone.film.shots[0]!.seconds).toBe(before.shots[0]!.seconds);
    expect(undone.film.shots[1]!.seconds).toBe(before.shots[1]!.seconds);
  });

  it("groups the scalar action and its ordered beats without exposing internal field names", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.shots[0]!.action = "抬手";
    edited.shots[0]!.actionBeats = ["抬手", "转身"];
    const scope = { projectId: before.id, page: "board" as const };
    expect(history.record(before, edited, scope)).toEqual([]);

    const undone = history.undo(edited, scope);
    expect(undone).toMatchObject({ conflicts: [], label: "修改镜头 1 的动作" });
    expect(undone.film.shots[0]!.actionBeats).toEqual(before.shots[0]!.actionBeats);
  });

  it("also labels applied assistant field receipts without including their contents", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = { ...before, title: "不应进入操作说明的作品内容" };
    const scope = { projectId: before.id, page: "script" as const };
    const applied = applyEditorSuggestion(before, diffEditorSuggestion(before, edited, scope));
    expect(applied.receipt).not.toBeNull();
    history.recordReceipt(applied.receipt!);

    const undone = history.undo(applied.film, scope);
    expect(undone).toMatchObject({ conflicts: [], label: "修改作品名称" });
    expect(undone.film.title).toBe(before.title);
    expect(history.redo(undone.film, scope)).toMatchObject({
      conflicts: [],
      label: "修改作品名称",
      film: { title: edited.title },
    });
  });

  it("describes an edit protection change when no content field was changed", () => {
    const history = createEditorPageHistory();
    const before = sampleFilm();
    const edited = structuredClone(before);
    edited.shots[0]!.userFields = ["picture"];
    const scope = { projectId: before.id, page: "board" as const };
    expect(history.record(before, edited, scope)).toEqual([]);
    const undone = history.undo(edited, scope);
    expect(undone).toMatchObject({ conflicts: [], label: "修改镜头 1 的编辑保护" });
    expect(undone.film.shots[0]!.userFields).toEqual(before.shots[0]!.userFields);
  });
});
