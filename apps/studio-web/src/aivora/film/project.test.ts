import { describe, expect, it } from "vitest";
import { offlineRotation } from "../shot-plan";
import {
  applyShots,
  assistantPrompt,
  agentRequest,
  blankFilm,
  keyframePrompt,
  offlineShots,
  sampleFilm,
} from "./project";

describe("film project", () => {
  it("gives each shot its own keyframe and the character's looks", () => {
    const film = sampleFilm();
    const first = film.shots[0]!;
    const second = film.shots[1]!;
    const a = keyframePrompt(first, film);
    const b = keyframePrompt(second, film);
    expect(a).not.toBe(b);
    expect(a).toContain("起始画面");
    expect(a).toContain("林骁");
    expect(b).toContain(second.picture.slice(0, 8));
    film.characters[0]!.name = "阿宁";
    film.characters[0]!.identity = "阿宁，短发，灰外套";
    film.shots[1]!.characters = ["阿宁"];
    expect(keyframePrompt(film.shots[1]!, film)).toContain("阿宁，短发");
  });

  it("keeps a line the user edited", () => {
    const film = blankFilm();
    film.shots = [
      {
        ...offlineShots("只有风。", "scene-1")[0]!,
        source: "user",
        userFields: ["picture"],
        picture: "用户写的雨",
      },
    ];
    const incoming = offlineShots("只有风。", "scene-1");
    incoming[0]!.picture = "模型想改";
    const next = applyShots(film, incoming, "scene-1");
    expect(next.shots.some((shot) => shot.picture === "用户写的雨")).toBe(true);
    expect(next.shots.some((shot) => shot.picture === "模型想改")).toBe(false);
  });

  it("does not invent the sample cast when the story never names them", () => {
    const shots = offlineShots("雨夜巷战\n巷口只有风。", "scene-1");
    const text = shots.map((shot) => shot.picture).join(" ");
    expect(text).not.toContain("林夏");
    expect(text).not.toContain("阿凯");
    expect(offlineRotation("雨夜巷战")).toHaveLength(6);
  });

  it("puts the project in front of the assistant and the director", () => {
    const film = sampleFilm();
    const prompt = assistantPrompt("这一场怎么写", film);
    expect(prompt).toContain("雨夜巷战");
    expect(prompt).toContain("这一场怎么写");
    expect(prompt).toContain("不要改作品");
    expect(agentRequest("director", "画风", "拆开")).toContain("你是短剧导演");
  });
});
