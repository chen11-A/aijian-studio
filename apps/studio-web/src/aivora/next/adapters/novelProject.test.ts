import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { shotLines } from "../../film/director-continuity";
import { upgradeFilm } from "../../film/project";
import { novelProject, novelScenes } from "./novelProject";

function novel(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not say where this test file is");
  return readFileSync(
    join(
      dirname(testPath),
      "../../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt",
    ),
    "utf8",
  );
}

describe("novelProject", () => {
  it("has the shape the task book asks for: 3 scenes, 7 people, 28 shots, 149 seconds", () => {
    const film = novelProject();
    expect(film.scenes.map((scene) => scene.title)).toEqual(["雨夜旧书店", "码头仓库", "医院走廊"]);
    expect(film.characters.map((person) => person.name)).toEqual([
      "林晚",
      "沈砚",
      "林国栋",
      "周烈",
      "打手甲",
      "打手乙",
      "阿婆",
    ]);
    expect(film.shots).toHaveLength(28);
    expect(film.shots.reduce((sum, shot) => sum + shot.seconds, 0)).toBe(149);
    expect(new Set(film.shots.map((shot) => shot.id)).size).toBe(28);
  });

  it("uses the novel itself as the scene text and quotes every line from it", () => {
    const source = novel();
    const film = novelProject();
    expect(film.sourceText).toBe(source.trim());
    expect(novelScenes()).toHaveLength(3);
    for (const scene of film.scenes) expect(source).toContain(scene.text);
    const names = new Set(film.characters.map((person) => person.name));
    for (const shot of film.shots) {
      for (const line of shotLines(shot)) {
        expect(source, shot.id).toContain(`“${line.text}”`);
        expect(names.has(line.speaker), `${shot.id} ${line.speaker}`).toBe(true);
      }
      for (const name of shot.characters) expect(names.has(name), shot.id).toBe(true);
    }
    for (const beat of film.unassignedBeats ?? []) expect(source).toContain(beat.text);
  });

  it("keeps the two problems the 3j fixes show: a missing tail in scene 1 and loose moves", () => {
    const film = novelProject();
    const [first, second, third] = film.scenes;
    expect(first?.coverage).toMatchObject({ ok: false, missingLines: [] });
    expect(first?.coverage?.missingTail).toContain("刹车声");
    expect(second?.coverage?.ok).toBe(true);
    expect(third?.coverage?.ok).toBe(true);
    expect(film.unassignedBeats).toHaveLength(2);
  });

  it("has nothing generated, so every picture frame shows its empty state", () => {
    const film = novelProject();
    expect(film.shots.every((shot) => shot.takes.length === 0 && shot.stills.length === 0)).toBe(
      true,
    );
    expect(film.shots.every((shot) => !shot.poster)).toBe(true);
    expect(film.characters.every((person) => person.portraits.length === 0)).toBe(true);
    expect(film.jobs).toEqual([]);
  });

  it("survives the same upgrade the app runs when it opens a saved project", () => {
    const film = novelProject();
    const opened = upgradeFilm(JSON.parse(JSON.stringify(film)));
    expect(opened?.shots).toHaveLength(28);
    expect(opened?.scenes.map((scene) => scene.title)).toEqual(film.scenes.map((s) => s.title));
    expect(opened?.characters.map((person) => person.gender)).toEqual(
      film.characters.map((person) => person.gender),
    );
  });
});
