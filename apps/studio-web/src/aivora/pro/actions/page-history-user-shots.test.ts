import { describe, expect, it } from "vitest";
import type { AudioClip } from "../../film/audio";
import { moveShot, moveShotTo, removeShot } from "../../film/operations";
import { sampleFilm, type FilmProject } from "../../film/project";
import { diffEditorStructure, diffUserShotEdit } from "./editor-structure";
import { createEditorPageHistory } from "./page-history";

/** Shots 1–4 in scene 02, 5–6 in scene 03; shot 2 has a chosen video, a still and a voice clip. */
function film(): FilmProject {
  const base = sampleFilm();
  base.shots = base.shots.map((shot, index) =>
    index < 4 ? shot : { ...shot, sceneId: "03", no: index - 3 },
  );
  const second = base.shots[1]!;
  base.shots[1] = {
    ...second,
    poster: "aivora-media://local/?path=%2Fstory%2Fshot-2.png",
    stills: [{ id: "still-2", prompt: "", url: "aivora-media://local/?path=%2Fs.png" }],
    takes: [
      {
        id: "take-2",
        shotId: second.id,
        index: 1,
        status: "done",
        stillUrl: "",
        videoPath: "/story/shot-2-film.mp4",
        videoUrl: "",
        prompt: "",
        createdAt: "",
        reason: "",
        cleanVideoPath: "/story/shot-2-film-clean.mp4",
      },
    ],
    selectedTakeId: "take-2",
  };
  const clip: AudioClip = {
    id: "voice-2",
    lane: "dialogue",
    shotId: second.id,
    takeId: "take-2",
    label: "",
    startSeconds: 3,
    durationSeconds: 2,
    offsetSeconds: 0,
    gainDb: 0,
    path: "/story/shot-2-voice.wav",
  };
  base.audioClips = [clip];
  return base;
}

const order = (value: FilmProject) => value.shots.map((shot) => `${shot.id}#${shot.no}`);

describe("5-3-05 moveShotTo", () => {
  it("moves a shot inside its scene in one change and keeps the scene where it was", () => {
    const base = film();
    const moved = moveShotTo(base, "02-shot-4", 0);
    expect(order(moved)).toEqual([
      "02-shot-4#1",
      "02-shot-1#2",
      "02-shot-2#3",
      "02-shot-3#4",
      "02-shot-5#1",
      "02-shot-6#2",
    ]);
    // Another scene's shots stay the same objects.
    expect(moved.shots[4]).toBe(base.shots[4]);
    expect(moveShotTo(base, "02-shot-4", 4)).toBe(base);
    expect(moveShotTo(base, "02-shot-4", 3)).toBe(base);
    expect(moveShotTo(base, "missing", 0)).toBe(base);
    // One step is the same move, and the scene no longer jumps to the end of the film.
    expect(order(moveShot(base, "02-shot-1", 1))).toEqual(order(moveShotTo(base, "02-shot-1", 1)));
    expect(moveShot(base, "02-shot-1", -1)).toBe(base);
  });
});

describe("5-3 the user's own shot changes can be undone", () => {
  const board = (base: FilmProject, shotId?: string) => ({
    projectId: base.id,
    page: "board" as const,
    sceneId: "02",
    ...(shotId ? { shotId } : {}),
  });

  it("takes back a dragged card, with its numbers, and puts it again", () => {
    const history = createEditorPageHistory();
    const before = film();
    const after = moveShotTo(before, "02-shot-4", 0);
    // The focused card is another one, as when the user drags while one is open.
    expect(history.record(before, after, board(before, "02-shot-1"))).toEqual([]);
    const undone = history.undo(after, board(before, "02-shot-1"));
    expect(undone.conflicts).toEqual([]);
    expect(undone).toMatchObject({ label: "挪动镜头 4" });
    expect(undone.film.shots).toEqual(before.shots);
    const redone = history.redo(undone.film, board(before));
    expect(redone.conflicts).toEqual([]);
    expect(order(redone.film)).toEqual(order(after));
  });

  it("takes back several deleted cards at once, even apart, in their places", () => {
    const history = createEditorPageHistory();
    const before = film();
    const after = ["02-shot-1", "02-shot-3"].reduce((next, id) => removeShot(next, id), before);
    expect(history.record(before, after, board(before, "02-shot-1"))).toEqual([]);
    const undone = history.undo(after, board(before));
    expect(undone).toMatchObject({ conflicts: [], label: "删掉 2 个镜头" });
    expect(undone.film.shots).toEqual(before.shots);
  });

  it("puts back a shot cut on the edit page with its video, still and voice", () => {
    const history = createEditorPageHistory();
    const before = film();
    const scope = { projectId: before.id, page: "edit" as const, shotId: "02-shot-2" };
    const after = removeShot(before, "02-shot-2");
    expect(history.record(before, after, scope)).toEqual([]);
    // The page's selection after the cut no longer names the shot.
    const undone = history.undo(after, { projectId: before.id, page: "edit" });
    expect(undone).toMatchObject({ conflicts: [], label: "剪掉镜头 2" });
    expect(undone.film.shots[1]).toEqual(before.shots[1]);
    expect(undone.film.shots[1]!.takes[0]!.videoPath).toBe("/story/shot-2-film.mp4");
    expect(undone.film.audioClips).toEqual(before.audioClips);
    const redone = history.redo(undone.film, { projectId: before.id, page: "edit" });
    expect(redone.conflicts).toEqual([]);
    expect(redone.film.shots.map((shot) => shot.id)).not.toContain("02-shot-2");
  });

  it("does not put a shot back over later changes to its scene or to what pointed at it", () => {
    const before = film();
    const after = removeShot(before, "02-shot-2");
    const edited = new Map([
      [
        "TARGET_EDITED",
        { ...after, shots: after.shots.map((s, i) => (i === 0 ? { ...s, picture: "改了" } : s)) },
      ],
      ["DEPENDENCIES_CHANGED", { ...after, audioClips: [] }],
      ["STRUCTURE_STALE", moveShotTo(after, "02-shot-6", 0)],
    ]);
    for (const [code, live] of edited) {
      const history = createEditorPageHistory();
      expect(history.record(before, after, board(before, "02-shot-2"))).toEqual([]);
      const result = history.undo(live, board(before));
      expect(result.conflicts).toEqual([code]);
      expect(result.film).toBe(live);
    }
  });

  it("still refuses a change across scenes or to anything besides shots", () => {
    const before = film();
    const twoScenes = removeShot(removeShot(before, "02-shot-1"), "02-shot-5");
    expect(diffUserShotEdit(before, twoScenes, board(before)).unsupported).toEqual([
      "OUTSIDE_SCOPE_STRUCTURE",
    ]);
    const otherEdited = {
      ...removeShot(before, "02-shot-1"),
      shots: removeShot(before, "02-shot-1").shots.map((shot) =>
        shot.id === "02-shot-6" ? { ...shot, picture: "另一场改了" } : shot,
      ),
    };
    expect(diffUserShotEdit(before, otherEdited, board(before)).unsupported).toEqual([
      "OUTSIDE_SCOPE_EDIT",
    ]);
    const alsoTitle = { ...removeShot(before, "02-shot-1"), title: "新片名" };
    expect(diffUserShotEdit(before, alsoTitle, board(before)).unsupported).toEqual([
      "OTHER_COLLECTION_CHANGED",
    ]);
    expect(
      diffUserShotEdit(before, removeShot(before, "02-shot-1"), {
        projectId: before.id,
        page: "board",
      }).unsupported,
    ).toEqual(["SELECTION_REQUIRED"]);
    const history = createEditorPageHistory();
    expect(history.record(before, twoScenes, board(before))).toContain(
      "STRUCTURAL_HISTORY_UNSUPPORTED",
    );
  });

  it("leaves an assistant's suggestion as strict as before", () => {
    const before = film();
    const after = removeShot(before, "02-shot-2");
    expect(
      diffEditorStructure(before, after, board(before), { collection: "shots" }).unsupported,
    ).toEqual(["DEPENDENT_WORK_EXISTS"]);
  });
});
