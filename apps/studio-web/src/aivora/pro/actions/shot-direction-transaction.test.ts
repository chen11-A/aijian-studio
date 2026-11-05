import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import {
  prepareShotDirection,
  applyShotDirection,
  undoShotDirection,
} from "./shot-direction-transaction";
function fixture(role: "action" | "performance" = "action") {
  const film = sampleFilm(),
    shot = film.shots[0]!,
    scene = film.scenes.find((row) => row.id === shot.sceneId)!;
  scene.actionState = {
    propsAfter: [{ name: "旧道具", shotId: "other-shot", left: "桌上" }],
    safetyNotes: ["旧安全提示"],
    unassigned: [],
  };
  scene.performanceState = {
    unassigned: [],
    voiceReviews: [{ shotId: "other-shot", reason: "旧提示" }],
  };
  film.unassignedBeats = [
    { sceneId: scene.id, text: "旧未分配" },
    { sceneId: "other-scene", text: "别场动作" },
  ];
  const selection = {
    projectId: film.id,
    page: "board" as const,
    sceneId: scene.id,
    shotId: shot.id,
  };
  const proposed = {
    ...shot,
    ...(role === "action"
      ? {
          action: "新动作",
          actionPlan: { nodes: [], injuries: [], propsAfter: [], promptAddon: "新计划" },
          source: "agent:action",
        }
      : {
          performance: "新表演",
          performancePlan: { people: [], scopeCues: [], promptAddon: "新表演计划" },
          performanceSource: "agent:performance",
          source: "agent:performance",
        }),
  };
  const tx = prepareShotDirection(
    film,
    proposed,
    selection,
    role,
    role === "action"
      ? {
          propsAfter: [{ name: "新道具", shotId: shot.id, right: "手中" }],
          safetyNotes: ["新安全提示"],
          unassigned: [],
        }
      : { unassigned: [], voiceReviews: [{ shotId: shot.id, reason: "新提示" }] },
    [{ sceneId: scene.id, text: "新未分配" }],
  );
  return { film, shot, scene, tx };
}
it.each(["action", "performance"] as const)(
  "applies typed %s data and preserves other shot state/media",
  (role) => {
    const { film, shot, scene, tx } = fixture(role);
    shot.poster = "/later.png";
    const result = applyShotDirection(film, tx);
    expect(result.conflicts).toEqual([]);
    expect(result.film.shots[0]!.poster).toBe("/later.png");
    if (role === "action") {
      expect(result.film.shots[0]!.actionPlan?.promptAddon).toBe("新计划");
      expect(
        result.film.scenes.find((row) => row.id === scene.id)!.actionState!.propsAfter,
      ).toHaveLength(2);
      expect(result.film.unassignedBeats?.map((row) => row.text)).toEqual([
        "别场动作",
        "旧未分配",
        "新未分配",
      ]);
    } else {
      expect(result.film.shots[0]!.performancePlan?.promptAddon).toBe("新表演计划");
      expect(
        result.film.scenes.find((row) => row.id === scene.id)!.performanceState!.voiceReviews,
      ).toHaveLength(2);
    }
    const undo = undoShotDirection(result.film, tx);
    expect(undo.conflicts).toEqual([]);
    expect(undo.film.shots[0]!.poster).toBe("/later.png");
    expect(undo.film.shots[0]![role]).toBe(shot[role]);
  },
);
it.each(["field", "lock", "state", "unassigned", "project"])(
  "atomically refuses later %s changes",
  (kind) => {
    const { film, shot, scene, tx } = fixture();
    if (kind === "field") shot.action = "手改";
    if (kind === "lock") shot.userFields.push("actionPlan");
    if (kind === "state") scene.actionState!.safetyNotes.push("后来提示");
    if (kind === "unassigned")
      film.unassignedBeats!.push({ sceneId: scene.id, text: "后来未分配" });
    if (kind === "project") film.id = "other";
    const result = applyShotDirection(film, tx);
    expect(result.film).toBe(film);
    expect(result.receipt).toBeNull();
  },
);
it("preserves later other-scene unassigned beats through apply and undo", () => {
  const { film, tx } = fixture();
  film.unassignedBeats!.push({ sceneId: "other-scene", text: "后来别场动作" });
  const applied = applyShotDirection(film, tx);
  expect(applied.conflicts).toEqual([]);
  const undone = undoShotDirection(applied.film, tx);
  expect(undone.film.unassignedBeats).toContainEqual({
    sceneId: "other-scene",
    text: "后来别场动作",
  });
});

it("rejects a different shot id without any positional fallback", () => {
  const { film, shot, tx } = fixture();
  const wrong = prepareShotDirection(film, { ...shot, id: "foreign-shot" }, tx.selection, "action");
  expect(applyShotDirection(film, wrong).conflicts).toContain("SELECTION_MISMATCH");
  film.shots.push({ ...shot });
  expect(applyShotDirection(film, tx).conflicts).toContain("SELECTION_MISMATCH");
});

it("retains user provenance and field locks when applying an unrelated direction", () => {
  const { film, shot, tx } = fixture();
  shot.source = "user";
  shot.userFields = ["picture"];
  const proposed = { ...shot, action: "新动作", source: "agent:action" };
  const safe = prepareShotDirection(film, proposed, tx.selection, "action");
  const result = applyShotDirection(film, safe);
  expect(result.conflicts).toEqual([]);
  expect(result.film.shots[0]!.source).toBe("user");
  expect(result.film.shots[0]!.userFields).toEqual(["picture"]);
  expect(result.film.shots[0]!.action).toBe("新动作");
});

it("preserves a delivery locked at review while applying performance, and rejects a new delivery lock", () => {
  const { film, shot, tx } = fixture("performance");
  shot.delivery = "用户语气";
  shot.userFields = ["delivery"];
  const proposed = { ...shot, performance: "新表演", delivery: "模型语气" };
  const safe = prepareShotDirection(film, proposed, tx.selection, "performance");
  const result = applyShotDirection(film, safe);
  expect(result.conflicts).toEqual([]);
  expect(result.film.shots[0]!.delivery).toBe("用户语气");
  expect(result.film.shots[0]!.performance).toBe("新表演");
  shot.userFields = [];
  const late = prepareShotDirection(film, proposed, tx.selection, "performance");
  shot.userFields = ["delivery"];
  expect(applyShotDirection(film, late).conflicts).toContain("FIELD_LOCKED");
});

it.each(["picture", "lines", "characters", "seconds"])(
  "rejects changed request input %s without blocking media-only changes",
  (key) => {
    const { film, shot, tx } = fixture();
    if (key === "picture") shot.picture = "用户改了画面";
    if (key === "lines") shot.lines = [{ speaker: "林晚", text: "新台词" }];
    if (key === "characters") shot.characters = ["新人物"];
    if (key === "seconds") shot.seconds += 1;
    expect(applyShotDirection(film, tx).conflicts).toContain("INPUT_CHANGED");
  },
);
it("undo keeps later input edits while restoring only confirmed direction fields", () => {
  const { film, tx } = fixture();
  const applied = applyShotDirection(film, tx);
  applied.film.shots[0]!.picture = "后来改的画面";
  const undone = undoShotDirection(applied.film, tx);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film.shots[0]!.picture).toBe("后来改的画面");
});
