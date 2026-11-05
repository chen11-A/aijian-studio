import { expect, it } from "vitest";
import { parseDirectorShots, sampleFilm } from "./project";
import {
  formatShotBudget,
  mergeAdjacentShots,
  sceneShotBudget,
  shotMergeBlockReasons,
} from "./director-continuity";
import { applyDirectorPlan, repairDirectorCoverage } from "../pro/director-workflow";
const shots = () =>
  parseDirectorShots(
    JSON.stringify({
      shots: Array.from({ length: 19 }, (_, i) => ({ picture: `画面${i}`, seconds: 15 })),
    }),
    "scene-1",
    "",
    [],
    false,
  )!;
it("reports actual blocked pairs without truncating and persists saved scene budget", async () => {
  const rows = shots();
  const report = sceneShotBudget("scene-1", rows);
  expect(report).toMatchObject({ count: 19, ok: false, limit: 16 });
  expect(report.blockedPairs).toHaveLength(18);
  expect(report.blockedPairs[0]).toEqual({
    shotIds: [rows[0]!.id, rows[1]!.id],
    reasons: ["DURATION_OVER_15S"],
  });
  expect(formatShotBudget(report, rows)).toContain("第1镜、第2镜：合并后超过15秒");
  const film = sampleFilm();
  const scene = { ...film.scenes[0]!, id: "scene-1", text: "" };
  film.scenes = [scene];
  film.shots = [];
  const saved = applyDirectorPlan(film, rows, scene.id);
  expect(JSON.parse(JSON.stringify(saved)).scenes[0].shotBudget).toEqual(report);
  const repaired = await repairDirectorCoverage(scene, rows, async () => {
    throw new Error("offline");
  });
  expect(repaired.shots).toBe(rows);
  expect(repaired.shotBudget).toEqual(report);
  expect(sceneShotBudget(scene.id, rows.slice(0, 16))).toMatchObject({
    ok: true,
    blockedPairs: [],
  });
});
it("shares merge reasons and protects selected versions and continuity assets", () => {
  const rows = shots()
    .slice(0, 2)
    .map((s) => ({ ...s, seconds: 3 }));
  rows[0]!.selectedTakeId = "selected";
  expect(shotMergeBlockReasons(rows[0]!, rows[1]!)).toContain("HAS_SELECTED_TAKE");
  expect(mergeAdjacentShots(rows, 1)).toHaveLength(2);
  rows[0]!.selectedTakeId = "";
  rows[0]!.continuityFrame = { url: "asset" } as unknown as NonNullable<
    (typeof rows)[number]["continuityFrame"]
  >;
  expect(shotMergeBlockReasons(rows[0]!, rows[1]!)).toContain("HAS_CONTINUITY_FRAME");
  expect(mergeAdjacentShots(rows, 1)).toHaveLength(2);
  delete rows[0]!.continuityFrame;
  rows[1]!.styleNote = "different";
  expect(shotMergeBlockReasons(rows[0]!, rows[1]!)).toContain("STYLE_MISMATCH");
});
