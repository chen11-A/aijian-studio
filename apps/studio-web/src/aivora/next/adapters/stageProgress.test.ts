import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { hasChosenVideo, stageProgress, stageTabs } from "./stageProgress";

const portraits = (url = "file:///p.png") =>
  ["正面", "侧面", "背面", "脸部"].map((view) => ({ view, prompt: "", url }));

describe("stageProgress", () => {
  it("is not done anywhere for an empty work", () => {
    const film = sampleFilm();
    const empty: FilmProject = {
      ...film,
      scenes: film.scenes.map((scene) => ({ ...scene, text: "" })),
      shots: [],
      characters: [],
    };
    expect(stageProgress(empty)).toEqual({ script: false, cast: false, board: false });
  });

  it("calls the script done once every scene with words has shots", () => {
    const film = sampleFilm();
    const written = film.scenes.filter((scene) => scene.text.trim());
    const covered = written.every((scene) => film.shots.some((shot) => shot.sceneId === scene.id));
    expect(stageProgress(film).script).toBe(covered);
    const all: FilmProject = {
      ...film,
      scenes: film.scenes.map((scene) =>
        film.shots.some((shot) => shot.sceneId === scene.id) ? scene : { ...scene, text: "" },
      ),
    };
    expect(stageProgress(all).script).toBe(true);
  });

  it("needs an appearance and all four portraits for every character", () => {
    const film = sampleFilm();
    const ready: FilmProject = {
      ...film,
      characters: film.characters.map((person) => ({
        ...person,
        identity: person.identity || "男，三十岁",
        portraits: portraits(),
      })),
    };
    expect(stageProgress(ready).cast).toBe(true);
    const missing: FilmProject = {
      ...ready,
      characters: ready.characters.map((person, index) =>
        index === 0 ? { ...person, portraits: portraits().slice(0, 3) } : person,
      ),
    };
    expect(stageProgress(missing).cast).toBe(false);
  });

  it("calls the storyboard done only when every shot has a video", () => {
    const film = sampleFilm();
    expect(stageProgress(film).board).toBe(false);
    const done: FilmProject = {
      ...film,
      shots: film.shots.map((shot) => ({
        ...shot,
        selectedTakeId: `${shot.id}-take`,
        takes: [
          {
            id: `${shot.id}-take`,
            shotId: shot.id,
            index: 1,
            status: "done",
            stillUrl: "",
            videoPath: "/tmp/a.mp4",
            videoUrl: "file:///tmp/a.mp4",
            prompt: "",
            createdAt: "",
            reason: "",
          },
        ],
      })),
    };
    expect(stageProgress(done).board).toBe(true);
  });
});

describe("stageTabs", () => {
  it("ticks 角色与场景 only when everyone has a front portrait, and counts until then", () => {
    const film = sampleFilm();
    const none = stageTabs({
      ...film,
      characters: film.characters.map((p) => ({ ...p, portraits: [] })),
    });
    expect(none.cast).toEqual({ done: false, have: 0, total: film.characters.length });
    const front = stageTabs({
      ...film,
      characters: film.characters.map((p) => ({
        ...p,
        portraits: [{ view: "正面", prompt: "", url: "file:///f.png" }],
      })),
    });
    expect(front.cast.done).toBe(film.characters.length > 0);
  });

  it("counts scenes with words and shots whose chosen version has a video", () => {
    const film = sampleFilm();
    const tabs = stageTabs(film);
    expect(tabs.script).toEqual({
      done: film.scenes.every((scene) => scene.text.trim()),
      have: film.scenes.filter((scene) => scene.text.trim()).length,
      total: film.scenes.length,
    });
    expect(tabs.board).toEqual({ done: false, have: 0, total: film.shots.length });
    const [first] = film.shots;
    const take = {
      id: "t1",
      shotId: first!.id,
      index: 1,
      status: "done" as const,
      stillUrl: "",
      videoPath: "/a.mp4",
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    };
    expect(hasChosenVideo({ ...first!, takes: [take], selectedTakeId: "t1" })).toBe(true);
    expect(hasChosenVideo({ ...first!, takes: [take], selectedTakeId: "other" })).toBe(false);
    expect(hasChosenVideo({ ...first!, takes: [take], selectedTakeId: "" })).toBe(true);
  });
});
