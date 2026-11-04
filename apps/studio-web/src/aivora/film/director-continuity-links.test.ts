import { describe, expect, it } from "vitest";
import { blankFilm, parseDirectorShots, upgradeFilm } from "./project";

const row = (extra: Record<string, unknown> = {}) => ({
  picture: "连续动作",
  seconds: 3,
  ...extra,
});
const parse = (shots: Record<string, unknown>[], source = "") =>
  parseDirectorShots(JSON.stringify({ shots }), "scene-1", source)!;

describe("director previous-frame connections", () => {
  it("resolves boolean connections to final deduplicated IDs", () => {
    const shots = parse([
      row({ id: "scene-1-shot-1" }),
      row({ id: "scene-1-shot-1", connect_previous: true }),
      row({ connect_previous: true }),
    ]);
    expect(shots[1]!.id).not.toBe(shots[0]!.id);
    expect(shots[1]!.continuityFromShotId).toBe(shots[0]!.id);
    expect(shots[2]!.continuityFromShotId).toBe(shots[1]!.id);
    expect(shots.every((shot) => Object.getOwnPropertySymbols(shot).length === 0)).toBe(true);
  });

  it("accepts only an unambiguous explicit immediate predecessor", () => {
    expect(
      parse([row({ id: "source-a" }), row({ continuity_from_shot_id: "source-a" })])[1]!
        .continuityFromShotId,
    ).toBe("scene-1-shot-1");
    for (const id of ["unknown", "scene-2-shot-1"]) {
      expect(
        parse([row(), row({ continuity_from_shot_id: id })])[1]!.continuityFromShotId,
      ).toBeUndefined();
    }
    const duplicate = parse([
      row({ id: "scene-1-shot-1" }),
      row({ id: "scene-1-shot-1" }),
      row({ continuity_from_shot_id: "scene-1-shot-1" }),
    ]);
    expect(duplicate[2]!.continuityFromShotId).toBeUndefined();
    expect(
      parse([row(), row(), row({ continuity_from_shot_id: "scene-1-shot-1" })])[2]!
        .continuityFromShotId,
    ).toBeUndefined();
  });

  it("does not connect a first shot or cross scenes", () => {
    const shots = parseDirectorShots(
      JSON.stringify({
        scenes: [
          {
            scene_id: "scene-1",
            shots: [row({ connect_previous: true }), row({ connect_previous: true })],
          },
          {
            scene_id: "scene-2",
            shots: [row({ connect_previous: true }), row({ connect_previous: true })],
          },
        ],
      }),
      "scene-1",
      "",
      [
        { id: "scene-1", title: "甲", text: "", where: "" },
        { id: "scene-2", title: "乙", text: "", where: "" },
      ],
    )!;
    expect(shots.map((shot) => shot.continuityFromShotId)).toEqual([
      undefined,
      "scene-1-shot-1",
      undefined,
      "scene-2-shot-1",
    ]);
  });

  it("declines a swallowed connection and records why after merging", () => {
    const shots = parse([row(), row({ connect_previous: true })], "短场");
    expect(shots).toHaveLength(1);
    expect(shots[0]!.continuityFromShotId).toBeUndefined();
    expect(shots[0]!.continuity?.text).toContain("合镜");
  });

  it("connects a singleton to the final merged predecessor but rejects ambiguous explicit IDs", () => {
    for (const explicit of [false, true]) {
      const shots = parse(
        [
          row(),
          row(),
          row({
            size: "特写",
            connect_previous: true,
            ...(explicit ? { continuity_from_shot_id: "scene-1-shot-2" } : {}),
          }),
        ],
        "长".repeat(100),
      );
      expect(shots).toHaveLength(2);
      expect(shots[1]!.continuityFromShotId).toBe(explicit ? undefined : shots[0]!.id);
    }
  });

  it("persists the resolved connection and extracted frame provenance", () => {
    const film = blankFilm();
    film.shots = parse([row(), row({ connect_previous: true })]);
    const frame = {
      sourceShotId: film.shots[0]!.id,
      sourceTakeId: "take-1",
      sourceVideoPath: "/films/first.mp4",
      path: "/films/last.png",
    };
    film.shots[1]!.continuityFrame = frame;
    const restored = upgradeFilm(JSON.parse(JSON.stringify(film)))!;
    expect(restored.shots[1]!.continuityFromShotId).toBe(film.shots[0]!.id);
    expect(restored.shots[1]!.continuityFrame).toEqual(frame);
  });

  it("leaves ordinary shots without continuity fields or parser metadata", () => {
    const shots = parse([row(), row({ connect_previous: false })]);
    for (const shot of shots) {
      expect(shot).not.toHaveProperty("continuityFromShotId");
      expect(shot).not.toHaveProperty("continuity");
      expect(Object.getOwnPropertySymbols(shot)).toEqual([]);
    }
  });
});
