import { expect, it, vi } from "vitest";
import { sampleFilm } from "./project";
import { firstFrameReferences, shotReference } from "./operations";

it("reserves a real scene image at both provider reference limits", () => {
  const film = sampleFilm();
  const scene = film.scenes[0]!;
  film.locations = [
    {
      id: "place",
      name: scene.where,
      prompt: "",
      ambience: "",
      referenceImage: "https://images.test/scene.png",
      referenceStyleRevision: 0,
    },
  ];
  film.characters = Array.from({ length: 5 }, (_, index) => ({
    ...film.characters[0]!,
    id: `cast-${index}`,
    name: `人物${index}`,
    portraits: (["正面", "侧面", "背面", "脸部"] as const).map((view, angle) => ({
      view,
      prompt: "",
      url: `https://images.test/${index}-${angle}.png`,
    })),
  }));
  const shot = {
    ...film.shots[0]!,
    sceneId: scene.id,
    characters: film.characters.map((person) => person.name),
    speaker: "人物4",
    lines: [],
    picture: "所有人在场",
    action: "",
    actionBeats: [],
    performance: "",
    directorFramePrompt: "",
    directorVideoPrompt: "",
    promptZh: "",
    poster: "https://images.test/frame.png",
    stills: [],
  };
  const stills = firstFrameReferences(film, shot);
  expect(stills).toHaveLength(5);
  expect(stills[0]).toBe("https://images.test/4-0.png");
  expect(stills[4]).toBe("https://images.test/scene.png");
  const video = shotReference(shot, film);
  expect(video.still).toBe(shot.poster);
  expect(video.references).toHaveLength(13);
  expect(video.references[12]).toEqual({
    url: "https://images.test/scene.png",
    who: scene.where,
    kind: "location",
  });
  expect(new Set(video.references.map((ref) => ref.url)).size).toBe(13);
  film.locations = [];
  expect(firstFrameReferences(film, shot)).toHaveLength(5);
  expect(shotReference(shot, film).references).toHaveLength(13);
});

it("does not silently omit a fifth visible person to fit the scene reference", async () => {
  const { requestShotStill } = await import("../pro/workflow");
  const film = sampleFilm();
  film.characters = Array.from({ length: 5 }, (_, index) => ({
    ...film.characters[0]!,
    name: `人物${index}`,
    portraits: [{ view: "正面", prompt: "", url: `https://images.test/${index}.png` }],
  }));
  const shot = {
    ...film.shots[0]!,
    characters: film.characters.map((person) => person.name),
    speaker: "",
    lines: [],
  };
  const scene = film.scenes.find((row) => row.id === shot.sceneId)!;
  film.locations = [
    {
      id: "scene",
      name: scene.where,
      prompt: "",
      ambience: "",
      referenceImage: "https://images.test/scene.png",
      referenceStyleRevision: 0,
    },
  ];
  const generate = vi.fn();
  const previous = window.aijian;
  window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
  try {
    const result = await requestShotStill(film, shot, "大家在场");
    expect(result.url).toBe("");
    expect(result.reason).toContain("人物太多");
    expect(generate).not.toHaveBeenCalled();
  } finally {
    window.aijian = previous;
  }
});
