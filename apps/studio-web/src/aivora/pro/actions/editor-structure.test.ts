import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { applyEditorStructure, diffEditorStructure, undoEditorStructure } from "./editor-structure";

function setup() {
  const film = sampleFilm();
  film.jobs = [];
  film.audioClips = [];
  film.unassignedBeats = [];
  film.shots = film.shots.map((shot) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    takes: [],
    stills: [],
    poster: "",
    selectedTakeId: "",
    continuityFrame: undefined,
    continuityFromShotId: undefined,
  }));
  const sceneId = film.shots[0]!.sceneId;
  film.shots.push({ ...film.shots[0]!, id: "other-scene-shot", sceneId: film.scenes[1]!.id });
  const selection = { projectId: film.id, page: "board" as const, sceneId };
  return { film, sceneId, selection };
}

describe("scoped structural suggestions", () => {
  it("adds, removes and reorders the reviewed scene's shots without restoring unrelated edits on undo", () => {
    const { film, sceneId, selection } = setup();
    const scoped = film.shots.filter((shot) => shot.sceneId === sceneId);
    const proposed = structuredClone(film);
    const added = { ...scoped[0]!, id: "new-shot", picture: "新镜头" };
    proposed.shots = [
      added,
      ...scoped.slice(1).reverse(),
      ...film.shots.filter((shot) => shot.sceneId !== sceneId),
    ];
    const tx = diffEditorStructure(film, proposed, selection, { collection: "shots" });
    expect(tx.unsupported).toEqual([]);
    const applied = applyEditorStructure(film, tx);
    expect(applied.conflicts).toEqual([]);
    expect(applied.film.shots).toEqual(proposed.shots);
    const live = structuredClone(applied.film);
    live.title = "应用建议后改的标题";
    const other = live.shots.find((shot) => shot.sceneId !== sceneId)!;
    other.picture = "别的场次后续编辑";
    const undone = undoEditorStructure(live, applied.receipt!);
    expect(undone.conflicts).toEqual([]);
    expect(undone.film.title).toBe(live.title);
    expect(undone.film.shots.find((shot) => shot.id === other.id)?.picture).toBe(other.picture);
    expect(undone.film.shots.filter((shot) => shot.sceneId === sceneId)).toEqual(scoped);
  });
  it("takes back a placement after the derived continuity notes changed, but not a person's note (3JR-B01)", () => {
    const { film, sceneId, selection } = setup();
    const scoped = film.shots.filter((shot) => shot.sceneId === sceneId);
    const proposed = structuredClone(film);
    const placed = { ...scoped[0]!, id: "placed-shot", picture: "导演放进来的镜头" };
    proposed.shots = [placed, ...film.shots.filter((shot) => shot.sceneId !== sceneId)];
    const tx = diffEditorStructure(film, proposed, selection, { collection: "shots" });
    const applied = applyEditorStructure(film, tx);
    expect(applied.conflicts).toEqual([]);
    // setFilm runs applyContinuityChecks after every change and writes a derived note.
    const derived = structuredClone(applied.film);
    derived.shots.find((shot) => shot.id === "placed-shot")!.continuity = [
      { kind: "cut", text: "文字与记录检查：这一镜的原文出处还需核对，不能据此确认情节没有新增。" },
    ];
    const undone = undoEditorStructure(derived, applied.receipt!);
    expect(undone.conflicts).toEqual([]);
    expect(undone.film.shots.filter((shot) => shot.sceneId === sceneId)).toEqual(scoped);
    // A note a person wrote is an edit, and still blocks the undo.
    const written = structuredClone(applied.film);
    written.shots.find((shot) => shot.id === "placed-shot")!.continuity = [
      { kind: "prop", text: "刀在左手" },
    ];
    expect(undoEditorStructure(written, applied.receipt!).conflicts).toEqual(["TARGET_EDITED"]);
  });
  it("creates the first shots in an explicitly selected empty scene and safely undoes them", () => {
    const { film, sceneId, selection } = setup();
    const template = film.shots[0]!;
    film.shots = film.shots.filter((shot) => shot.sceneId !== sceneId);
    const next = structuredClone(film);
    next.shots.unshift({ ...template, id: "first-new-shot" });
    const applied = applyEditorStructure(
      film,
      diffEditorStructure(film, next, selection, { collection: "shots" }),
    );
    expect(applied.conflicts).toEqual([]);
    expect(undoEditorStructure(applied.film, applied.receipt!).film.shots).toEqual(film.shots);
  });
  it.each(["media", "task", "edit", "new-row"])(
    "refuses undo after later %s work instead of deleting it",
    (kind) => {
      const { film, sceneId, selection } = setup();
      const proposed = structuredClone(film);
      const insertAt =
        proposed.shots.reduce(
          (last, shot, index) => (shot.sceneId === sceneId ? index : last),
          -1,
        ) + 1;
      proposed.shots.splice(insertAt, 0, { ...film.shots[0]!, id: "new-shot" });
      const applied = applyEditorStructure(
        film,
        diffEditorStructure(film, proposed, selection, { collection: "shots" }),
      );
      const live = structuredClone(applied.film);
      const added = live.shots.find((shot) => shot.id === "new-shot")!;
      if (kind === "media") added.poster = "/new/frame.png";
      if (kind === "edit") added.picture = "用户后来修改";
      if (kind === "task")
        live.jobs.push({
          id: "later-job",
          shotId: added.id,
          take: 1,
          kind: "video",
          status: "queued",
          prompt: "",
          reason: "",
        });
      if (kind === "new-row") live.shots.push({ ...added, id: "later-shot" });
      const undone = undoEditorStructure(live, applied.receipt!);
      expect(undone.film).toBe(live);
      expect(undone.receipt).toBeNull();
      expect(undone.conflicts.length).toBeGreaterThan(0);
    },
  );
  it("allows an explicitly reviewed scene group to reorder and split but refuses deleting scenes with shots", () => {
    const { film } = setup();
    const withShots = structuredClone(film);
    film.shots = [];
    const selection = { projectId: film.id, page: "script" as const, sceneId: film.scenes[0]!.id };
    const next = structuredClone(film);
    next.scenes = [...next.scenes].reverse();
    next.scenes.push({ ...film.scenes[0]!, id: "new-scene", title: "拆出的场次" });
    const tx = diffEditorStructure(film, next, selection, {
      collection: "scenes",
      ids: film.scenes.map((scene) => scene.id),
    });
    const applied = applyEditorStructure(film, tx);
    expect(applied.conflicts).toEqual([]);
    expect(undoEditorStructure(applied.film, applied.receipt!).film.scenes).toEqual(film.scenes);
    const deleted = { ...withShots, scenes: withShots.scenes.slice(1) };
    const unsafe = diffEditorStructure(withShots, deleted, selection, { collection: "scenes" });
    expect(applyEditorStructure(withShots, unsafe).conflicts).toEqual(["DEPENDENT_WORK_EXISTS"]);
  });
  it("rejects a new shot whose continuity points to the deleted shot", () => {
    const { film, selection } = setup();
    const next = structuredClone(film);
    const deletedId = next.shots[0]!.id;
    next.shots[0] = { ...next.shots[0]!, id: "replacement", continuityFromShotId: deletedId };
    expect(diffEditorStructure(film, next, selection, { collection: "shots" }).unsupported).toEqual(
      ["INVALID_CONTINUITY_REFERENCE"],
    );
  });
  it("requires explicit selection and rejects duplicate IDs, foreign-scene and other-collection changes", () => {
    const { film, selection } = setup();
    const next = structuredClone(film);
    next.shots.push({ ...next.shots[0]! });
    expect(diffEditorStructure(film, next, selection, { collection: "shots" }).unsupported).toEqual(
      ["DUPLICATE_OR_EMPTY_ID"],
    );
    expect(
      diffEditorStructure(
        film,
        film,
        { projectId: film.id, page: "board" },
        { collection: "shots" },
      ).unsupported,
    ).toEqual(["SELECTION_REQUIRED"]);
    const foreign = structuredClone(film);
    foreign.shots.find((shot) => shot.sceneId !== selection.sceneId)!.picture = "越界";
    expect(
      diffEditorStructure(film, foreign, selection, { collection: "shots" }).unsupported,
    ).toEqual(["OUTSIDE_SCOPE_EDIT"]);
    expect(
      diffEditorStructure(film, { ...film, title: "另一项修改" }, selection, {
        collection: "shots",
      }).unsupported,
    ).toEqual(["OTHER_COLLECTION_CHANGED"]);
  });
  it("rejects stale structure and cross-project replay and does not destroy existing generated assets", () => {
    const { film, selection } = setup();
    const next = structuredClone(film);
    next.shots.shift();
    const tx = diffEditorStructure(film, next, selection, { collection: "shots" });
    const live = structuredClone(film);
    live.shots.reverse();
    expect(applyEditorStructure(live, tx).conflicts).toEqual(["STRUCTURE_STALE"]);
    expect(applyEditorStructure({ ...film, id: "another" }, tx).conflicts).toEqual([
      "PROJECT_MISMATCH",
    ]);
    film.shots[0]!.poster = "/existing/media.png";
    const assetTx = diffEditorStructure(film, next, selection, { collection: "shots" });
    expect(applyEditorStructure(film, assetTx).conflicts).toEqual(["DEPENDENT_WORK_EXISTS"]);
  });
});
