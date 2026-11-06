import { describe, expect, it } from "vitest";
import { blankFilm, parseDirectorShots, upgradeFilm } from "./project";
import { mergeAdjacentShots } from "./director-continuity";
import { shotActions, shotActionText, withShotActions } from "./shot-actions";
import { storyFilmBatches } from "./operations";

describe("3JR-B04 generated identity and main action", () => {
  it("numbers new parsed shots continuously and remaps a verified previous-shot link", () => {
    const shots = parseDirectorShots(
      JSON.stringify({
        shots: [
          { id: "scene-2-shot-9", picture: "书架", seconds: 3 },
          { id: "scene-2-shot-12", picture: "门口", seconds: 3 },
          {
            id: "scene-2-shot-20",
            picture: "走廊",
            seconds: 3,
            continuity_from_shot_id: "scene-2-shot-12",
          },
        ],
      }),
      "scene-2",
    )!;
    expect(shots.map((shot) => shot.id)).toEqual([
      "scene-2-shot-1",
      "scene-2-shot-2",
      "scene-2-shot-3",
    ]);
    expect(shots.map((shot) => shot.no)).toEqual([1, 2, 3]);
    expect(shots[2]!.continuityFromShotId).toBe("scene-2-shot-2");
  });

  it("keeps one main action while retaining ordered movement in storage and requests", () => {
    const parsed = parseDirectorShots(
      '{"shots":[{"picture":"沈砚反制","action":"扣住手腕\\n拧落铁棍","seconds":3},{"picture":"继续反制","action":"侧身避开","seconds":3}]}',
      "scene-1",
      "",
      [],
      false,
    )!;
    expect(parsed[0]!.action).toBe("扣住手腕");
    expect(shotActions(parsed[0]!)).toEqual(["扣住手腕", "拧落铁棍"]);
    const shot = mergeAdjacentShots(parsed, 1)[0]!;
    expect(shot.action).toBe("扣住手腕");
    expect(shotActions(shot)).toEqual(["扣住手腕", "拧落铁棍", "侧身避开"]);
    const film = { ...blankFilm(), shots: [shot] };
    const restored = upgradeFilm(JSON.parse(JSON.stringify(film)))!;
    expect(shotActionText(restored.shots[0]!)).toBe("扣住手腕\n拧落铁棍\n侧身避开");
    expect(storyFilmBatches(restored, restored.shots, false)[0]!.shots[0]!.action).toBe(
      shotActions(shot).join(" "),
    );
    expect(shotActions({ ...shot, action: "用户改为停手" })).toEqual(["用户改为停手"]);
  });

  it("migrates old multiline actions without renaming existing media identities", () => {
    const base = blankFilm();
    const shot = parseDirectorShots('{"shots":[{"picture":"反制"}]}', "scene-1")![0]!;
    base.shots = [
      { ...shot, id: "scene-1-shot-12", poster: "aivora-media://kept.png", action: "抬手\n挡住" },
    ];
    const restored = upgradeFilm(JSON.parse(JSON.stringify(base)))!;
    expect(restored.shots[0]).toMatchObject({
      id: "scene-1-shot-12",
      poster: "aivora-media://kept.png",
      action: "抬手",
      actionBeats: ["抬手", "挡住"],
    });
    expect(withShotActions(shot, ["肘击", "肘击"]).actionBeats).toEqual(["肘击", "肘击"]);
  });
});
