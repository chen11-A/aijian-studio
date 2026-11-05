import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { pipelineSceneName, pipelineTargetName } from "./pipelineNames";

describe("pipelineTargetName", () => {
  const film = sampleFilm();
  const person = film.characters[0]!;
  const shot = film.shots[0]!;
  const scene = film.scenes.find((item) => item.id === shot.sceneId)!;

  it("names every kind of target GPT's pipeline uses", () => {
    expect(pipelineTargetName(film, "all")).toBe("整部作品");
    expect(pipelineTargetName(film, "script")).toBe("剧本");
    expect(pipelineTargetName(film, "cast")).toBe("人物");
    expect(pipelineTargetName(film, "art")).toBe("画风和外貌");
    expect(pipelineTargetName(film, `${person.id}@正面`)).toBe(`${person.name} · 正面`);
    expect(pipelineTargetName(film, shot.id)).toBe(`第 ${scene.no} 场第 ${shot.no} 个镜头`);
    expect(pipelineTargetName(film, scene.id)).toBe(`第 ${scene.no} 场「${scene.title}」`);
  });

  it("names a place, and leaves anything unknown unnamed", () => {
    const withPlace = {
      ...film,
      locations: [{ id: "loc-1", name: "巷口", prompt: "", ambience: "" }],
    };
    expect(pipelineTargetName(withPlace, "location:loc-1")).toBe("场景「巷口」");
    expect(pipelineTargetName(film, "location:nope")).toBe("");
    expect(pipelineTargetName(film, "nobody@正面")).toBe("");
    expect(pipelineTargetName(film, "something-else")).toBe("");
    expect(pipelineSceneName(film, "gone")).toBe("");
  });
});
