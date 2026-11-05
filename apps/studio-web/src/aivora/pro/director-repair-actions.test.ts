import { describe, expect, it } from "vitest";
import { offlineShots, type FilmShot } from "../film/project";
import { withShotActions } from "../film/shot-actions";
import { repairDirectorCoverage } from "./director-workflow";

const scene = {
  id: "scene-2",
  title: "门口",
  where: "门口 · 夜",
  text: `${"背景。".repeat(100)}\n警笛远去。`,
};
const shot = (id: string, picture: string, actions: string[]): FilmShot =>
  withShotActions(
    {
      ...offlineShots("人物站住。", scene.id)[0]!,
      id,
      picture,
      line: "",
      lines: [],
      speaker: "",
      poster: "",
      stills: [],
      takes: [],
      selectedTakeId: "",
      userFields: [],
    },
    actions,
  );
const reply = (shots: object[]) => async () => ({ text: JSON.stringify({ shots }), detail: "" });
const tail = { id: "tail", picture: "警笛远去。", seconds: 10 };

describe("3JR-B04 repair keeps every movement and safe identities", () => {
  it("refuses an inserted shot that would break a protected adjacent continuity link", async () => {
    const first = shot("scene-2-shot-4", "第一镜。", ["抬手。"]);
    const second = {
      ...shot("scene-2-shot-12", "第二镜。", ["后退。"]),
      poster: "/saved.png",
      continuityFromShotId: first.id,
    };
    const existing = [first, second];
    const result = await repairDirectorCoverage(
      scene,
      existing,
      reply([
        { picture: first.picture, action: first.action, seconds: 10 },
        { picture: "新插入。", seconds: 10 },
        { picture: second.picture, action: second.action, seconds: 10 },
        tail,
      ]),
    );
    expect(result.repaired).toBe(false);
    expect(result.shots).toBe(existing);
  });

  it("rejects an answer that keeps the main action but drops the second movement", async () => {
    const existing = [shot("old", "人物站着。", ["抬手。", "挡开。"])];
    const result = await repairDirectorCoverage(
      scene,
      existing,
      reply([{ picture: "人物站着。", action: "抬手。", seconds: 10 }, tail]),
    );
    expect(result.repaired).toBe(false);
    expect(result.shots).toBe(existing);
  });

  it("rejects reversed words or removed punctuation, not just missing beats", async () => {
    const existing = [shot("old", "人物站着。", ["抬手。", "挡开。", "后退。"])];
    for (const action of ["抬手。后退。挡开。", "抬手挡开后退"]) {
      const result = await repairDirectorCoverage(
        scene,
        existing,
        reply([{ picture: "人物站着。", action, seconds: 10 }, tail]),
      );
      expect(result.repaired).toBe(false);
      expect(result.shots).toBe(existing);
    }
  });

  it("protects the full action on a rendered shot even when the answer moves its second beat elsewhere", async () => {
    const existing = [{ ...shot("old", "人物站着。", ["抬手。", "挡开。"]), poster: "/saved.png" }];
    const result = await repairDirectorCoverage(
      scene,
      existing,
      reply([
        { picture: "人物站着。", action: "抬手。", seconds: 10 },
        { picture: "另一镜。", action: "挡开。", seconds: 10 },
        tail,
      ]),
    );
    expect(result.repaired).toBe(false);
    expect(result.shots).toBe(existing);
  });

  it("renumbers fresh repaired drafts and maps an existing valid continuity reference", async () => {
    const first = shot("scene-2-shot-4", "第一镜。", ["抬手。", "挡开。"]);
    const second = {
      ...shot("scene-2-shot-12", "第二镜。", ["后退。"]),
      continuityFromShotId: first.id,
    };
    const result = await repairDirectorCoverage(
      scene,
      [first, second],
      reply([
        { picture: first.picture, action: "抬手。\n挡\n开。", seconds: 10 },
        { picture: second.picture, action: second.action, seconds: 10 },
        tail,
      ]),
    );
    expect(result.repaired).toBe(true);
    expect(result.shots.map((item) => item.id)).toEqual([
      "scene-2-shot-1",
      "scene-2-shot-2",
      "scene-2-shot-3",
    ]);
    expect(result.shots.map((item) => item.no)).toEqual([1, 2, 3]);
    expect(result.shots[1]!.continuityFromShotId).toBe("scene-2-shot-1");
    expect(result.shots[0]!.actionBeats).toEqual(first.actionBeats);
  });

  it("does not guess a fresh draft's unknown or cross-scene continuity reference", async () => {
    const first = shot("scene-2-shot-4", "第一镜。", ["抬手。"]);
    for (const continuityFromShotId of ["unknown", "scene-1-shot-4"]) {
      const second = { ...shot("scene-2-shot-12", "第二镜。", ["后退。"]), continuityFromShotId };
      const result = await repairDirectorCoverage(
        scene,
        [first, second],
        reply([
          { picture: first.picture, action: first.action, seconds: 10 },
          { picture: second.picture, action: second.action, connect_previous: true, seconds: 10 },
          tail,
        ]),
      );
      expect(result.repaired).toBe(true);
      expect(result.shots[1]!.continuityFromShotId).toBeUndefined();
    }
  });

  it("keeps protected IDs and assets, while mapping new candidate links to those real IDs", async () => {
    const first = shot("scene-2-shot-4", "第一镜。", ["抬手。"]);
    const second = {
      ...shot("scene-2-shot-12", "第二镜。", ["后退。"]),
      poster: "/saved.png",
      continuityFromShotId: first.id,
      continuityFrame: {
        sourceShotId: first.id,
        sourceTakeId: "take-old",
        sourceVideoPath: "/old.mp4",
        path: "/saved.png",
      },
    };
    const result = await repairDirectorCoverage(
      scene,
      [first, second],
      reply([
        { picture: first.picture, action: first.action, seconds: 10 },
        { picture: second.picture, action: second.action, seconds: 10 },
        { ...tail, connect_previous: true },
      ]),
    );
    expect(result.repaired).toBe(true);
    expect(result.shots[0]!.id).toBe(first.id);
    expect(result.shots[1]).toMatchObject({
      id: second.id,
      poster: second.poster,
      continuityFromShotId: first.id,
      continuityFrame: second.continuityFrame,
    });
    expect(result.shots[2]!.continuityFromShotId).toBe(second.id);
    expect(result.shots[2]!.id).not.toBe("scene-2-shot-3");
  });
});
