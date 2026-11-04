import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { stageProgress } from "./stageProgress";

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
