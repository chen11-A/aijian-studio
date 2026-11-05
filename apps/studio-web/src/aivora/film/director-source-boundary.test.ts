import { beforeEach, describe, expect, it } from "vitest";
import { blankFilm, offlineShots, parseDirectorShots } from "./project";
import { applyContinuityChecks } from "./continuity-rules";
import { readSaved, saveFilm } from "./library";
import { hydrateFilm } from "../pro/workflow";

beforeEach(() => window.localStorage.clear());

function fixture() {
  const film = blankFilm();
  const text = "车先到。随后打斗。最后逃走。".repeat(30);
  const scene = {
    ...film.scenes[0]!,
    text,
    writerSourceText: text,
    sourceParagraphIds: ["P101", "P102", "P103"],
  };
  film.scenes = [scene];
  const rows = [
    { id: "fight", picture: "打斗继续", action: "挡开", source: "P102", seconds: 3 },
    { id: "arrival", picture: "车刚到达", action: "停车", source: "P101", seconds: 3 },
    { id: "escape", picture: "最后逃走", action: "逃跑", source: "P103", seconds: 3 },
  ];
  return { film, scene, rows };
}

describe("3JR-B10 parser, persistence and C13 source-risk boundary", () => {
  it.each([false, true])(
    "keeps out-of-order evidence through parsing and save (wrapped=%s)",
    async (wrapped) => {
      const { film, scene, rows } = fixture();
      const reply = wrapped ? { scenes: [{ scene_id: scene.id, shots: rows }] } : { shots: rows };
      const shots = parseDirectorShots(JSON.stringify(reply), scene.id, scene.text, [scene])!;
      expect(shots).toHaveLength(3);
      expect(shots[1]!.picture).toBe("车刚到达");
      expect(shots[1]!.sourceReview).toMatchObject({
        evidence: "declared-paragraph-order",
        status: "needs_review",
        hints: ["P101"],
        issues: ["source-out-of-order"],
      });
      const checked = applyContinuityChecks({ ...film, shots });
      expect(checked.shots[1]!.continuity).toContainEqual({
        kind: "cut",
        text: "文字与记录检查：这一镜引用了前面已经拍过的原文，请核对情节顺序。",
      });
      await saveFilm(checked);
      const restored = await hydrateFilm((await readSaved(film.id))!);
      expect(restored.shots.map((shot) => shot.sourceReview)).toEqual(
        shots.map((shot) => shot.sourceReview),
      );
      expect(restored.shots[1]!.continuity).toEqual(checked.shots[1]!.continuity);
    },
  );

  it("rechecks changed scene provenance but does not create source warnings for legacy shots", () => {
    const { film, scene, rows } = fixture();
    const shots = parseDirectorShots(JSON.stringify({ shots: rows }), scene.id, scene.text, [
      scene,
    ])!;
    const changed = applyContinuityChecks({
      ...film,
      scenes: [{ ...scene, text: "用户改稿" }],
      shots,
    });
    expect(
      changed.shots[0]!.continuity?.some((note) => note.text.includes("原文出处还需核对")),
    ).toBe(true);
    const legacy = applyContinuityChecks({ ...film, shots: offlineShots("用户旧稿", scene.id) });
    expect(
      legacy.shots.some((shot) => shot.continuity?.some((note) => note.text.includes("原文出处"))),
    ).toBe(false);
  });
});
