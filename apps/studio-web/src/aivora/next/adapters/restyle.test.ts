import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmShot } from "../../film/project";
import { needsRestyle } from "./restyle";

const made = (shot: FilmShot): FilmShot => ({
  ...shot,
  takes: [
    {
      id: "t",
      shotId: shot.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/a.mp4",
      videoUrl: "file:///a.mp4",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ],
  selectedTakeId: "t",
});
const flag = (shot: FilmShot) =>
  ({ ...shot, regenerationRequired: { code: "STYLE_CHANGED", styleRevision: 2 } }) as FilmShot;

describe("needsRestyle", () => {
  const shot = sampleFilm().shots[0]!;
  it("is true only for a made shot that GPT marked after a style change", () => {
    expect(needsRestyle(flag(made(shot)))).toBe(true);
    expect(needsRestyle(made(shot))).toBe(false);
    expect(needsRestyle(flag(shot))).toBe(false);
  });
});
