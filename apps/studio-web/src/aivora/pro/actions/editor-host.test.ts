import { describe, expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import type { EditorSelection } from "./editor-context";
import { createEditorHost } from "./editor-host";
function setup() {
  let film = sampleFilm();
  let selection: EditorSelection = {
    projectId: film.id,
    page: "board",
    sceneId: film.shots[0]!.sceneId,
    shotId: film.shots[0]!.id,
  };
  const save = vi.fn(async () => true as boolean | null);
  const host = createEditorHost({
    current: () => film,
    selection: () => selection,
    applyLive: (next) => {
      film = next;
    },
    save,
  });
  const propose = () => {
    const request = host.capture()!;
    const next = structuredClone(film);
    next.shots[0]!.picture = "新的画面";
    return { request, diff: host.preview(request, next)! };
  };
  return {
    host,
    save,
    propose,
    film: () => film,
    select: (next: EditorSelection) => {
      selection = next;
    },
    selection: () => selection,
    change: (next: typeof film) => {
      film = next;
    },
  };
}
describe("editor suggestion host", () => {
  it("keeps the reviewed baseline and rejects changed fields", async () => {
    const s = setup(),
      { request, diff } = s.propose();
    expect(diff.changes[0]!.after.value).toBe("新的画面");
    s.film().shots[0]!.picture = "后来手改";
    expect((await s.host.apply(request.id)).status).toBe("rejected");
    expect(s.save).not.toHaveBeenCalled();
  });
  it("rejects switched shots, projects and superseded requests", async () => {
    const s = setup(),
      { request } = s.propose(),
      original = s.selection();
    s.select({ ...original, shotId: s.film().shots[1]!.id });
    expect((await s.host.apply(request.id)).status).toBe("rejected");
    s.select({ ...original, projectId: "other" });
    expect((await s.host.apply(request.id)).status).toBe("rejected");
    s.select(original);
    s.host.capture();
    expect((await s.host.apply(request.id)).conflicts).toContain("REQUEST_STALE");
  });
  it("respects a newly locked field even when its text equals the baseline", async () => {
    const s = setup(),
      { request } = s.propose();
    s.film().shots[0]!.userFields.push("picture");
    expect((await s.host.apply(request.id)).conflicts[0]).toMatch(/^LOCKED:/);
    expect(s.save).not.toHaveBeenCalled();
  });
  it("undo is page/project isolated and preserves generated media and other later edits", async () => {
    const s = setup(),
      old = s.film().shots[0]!.picture,
      { request } = s.propose();
    expect((await s.host.apply(request.id)).status).toBe("saved");
    s.film().shots[0]!.poster = "/later.png";
    s.film().title = "later title";
    const original = s.selection();
    s.select({ ...original, page: "cast" });
    expect(s.host.canUndo()).toBe(false);
    expect((await s.host.undo()).status).toBe("rejected");
    s.select({ ...original, projectId: "other" });
    expect((await s.host.undo()).status).toBe("rejected");
    s.select(original);
    expect((await s.host.undo()).status).toBe("saved");
    expect(s.film().shots[0]!.picture).toBe(old);
    expect(s.film().shots[0]!.poster).toBe("/later.png");
    expect(s.film().title).toBe("later title");
  });
  it.each(["failed", "deferred"])("does not claim completion on %s persistence", async (mode) => {
    const s = setup(),
      { request } = s.propose();
    if (mode === "failed") s.save.mockRejectedValueOnce(new Error("disk"));
    else s.save.mockResolvedValueOnce(null);
    expect((await s.host.apply(request.id)).status).toBe("applied_unsaved");
    expect(s.film().shots[0]!.picture).toBe("新的画面");
    expect(s.host.canUndo()).toBe(true);
  });
  it("rejects attempts to clear user locks in the proposal", async () => {
    const s = setup();
    s.film().shots[0]!.userFields = ["action"];
    const request = s.host.capture()!;
    const next = structuredClone(s.film());
    next.shots[0]!.userFields = [];
    expect(s.host.preview(request, next)!.unsupported).toContain("LOCK_METADATA_CHANGED");
    expect((await s.host.apply(request.id)).status).toBe("rejected");
    expect(s.film().shots[0]!.userFields).toEqual(["action"]);
  });
  it("blocks undo when the user locks the applied field without changing its value", async () => {
    const s = setup(),
      { request } = s.propose();
    await s.host.apply(request.id);
    s.film().shots[0]!.userFields.push("picture");
    expect((await s.host.undo()).conflicts[0]).toMatch(/^LOCKED:/);
    expect(s.film().shots[0]!.picture).toBe("新的画面");
  });
  it("rejects mixed structural edits and absent board selection", async () => {
    const s = setup(),
      request = s.host.capture()!;
    const next = structuredClone(s.film());
    next.shots.pop();
    next.shots[0]!.picture = "changed";
    expect(s.host.preview(request, next)!.unsupported).toContain("shots:STRUCTURE_CHANGED");
    expect((await s.host.apply(request.id)).status).toBe("rejected");
    s.select({ projectId: s.film().id, page: "board" });
    expect(s.host.capture()).toBeNull();
  });
});
