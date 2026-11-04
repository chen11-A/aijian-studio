import { expect, it } from "vitest";
import { FILM_KEY, readFilm, sampleFilm, upgradeFilm, writeFilm } from "./project";
import { applyContinuityChecks, continuityRisks, type ContinuityInput } from "./continuity-rules";

function fixture(): ContinuityInput {
  const film = sampleFilm();
  const person = { ...film.characters[0]!, name: "沈砚", identity: "沈砚穿黑色风衣，左眉有旧伤。" };
  const shots = film.shots.slice(0, 2).map((shot, index) => ({
    ...shot,
    id: `shot-${index + 1}`,
    sceneId: "scene-1",
    characters: [person.name],
    picture: person.identity,
    action: "",
    performance: "",
    blocking: "",
    facing: "",
    promptZh: "",
    takes: [],
    continuity: undefined,
  }));
  return { ...film, characters: [person], shots, props: [] };
}

it("flags a deleted fixed appearance sentence and clears the rule after it is restored", () => {
  const film = fixture();
  film.shots[1]!.picture = "沈砚站在门边。";
  expect(continuityRisks(film)["shot-2"]).toEqual([
    { kind: "missing_look", text: "沈砚的固定外貌句未出现在本镜中文描述中，请核对是否遗漏。" },
  ]);
  const checked = applyContinuityChecks(film);
  expect(checked.shots[1]!.continuity).toHaveLength(1);
  checked.shots[1]!.picture = film.characters[0]!.identity;
  expect(applyContinuityChecks(checked).shots[1]!.continuity).toEqual([]);
  expect(film.shots[1]!.continuity).toBeUndefined();
});

it("checks the explicit Chinese prompt and skips unnamed/offscreen characters", () => {
  const film = fixture();
  film.shots[0]!.promptZh = "沈砚走进门。";
  film.shots[1]!.characters = [];
  film.shots[1]!.picture = "空镜。";
  expect(continuityRisks(film)["shot-1"]?.map((note) => note.kind)).toContain("missing_look");
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
});

it("reports an explicit same-character prop-hand change with text evidence", () => {
  const film = fixture();
  film.shots[0]!.action = "沈砚左手持刀。";
  film.shots[1]!.action = "沈砚右手持刀。";
  expect(continuityRisks(film)["shot-2"]).toEqual([
    { kind: "prop", text: "沈砚持刀的文字由左手变为右手，未写换手过程，请核对道具衔接。" },
  ]);
  film.shots[1]!.action += "沈砚已换手。";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
});

it("reports gaze changes only with named directional evidence and no described turn", () => {
  const film = fixture();
  film.shots[0]!.facing = "沈砚看向画左。";
  film.shots[1]!.facing = "沈砚看向画右。";
  expect(continuityRisks(film)["shot-2"]?.map((note) => note.kind)).toEqual(["gaze"]);
  film.shots[1]!.action = "沈砚回头。";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
});

it("checks explicit camera sides rather than inventing a 180-degree violation from screen positions", () => {
  const film = fixture();
  film.shots[0]!.blocking = "机位在轴线左侧。";
  film.shots[1]!.blocking = "摄影机位于轴线右侧。";
  expect(continuityRisks(film)["shot-2"]?.map((note) => note.kind)).toEqual(["axis"]);
  film.shots[1]!.blocking += "使用过轴镜头。";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
  film.shots[0]!.blocking = "沈砚在画左。";
  film.shots[1]!.blocking = "沈砚在画右。";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
});

it("does not carry directional evidence across scenes or guess from vague prose", () => {
  const film = fixture();
  film.shots[0]!.action = "沈砚左手持刀。沈砚看向画左。机位在轴线左侧。";
  film.shots[1]!.action = "沈砚右手持刀。沈砚看向画右。机位在轴线右侧。";
  film.shots[1]!.sceneId = "scene-2";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
  film.shots[1]!.sceneId = "scene-1";
  film.shots[1]!.action = "他握紧东西，看着远处。";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
});

it("does not attribute another named person's hands to the current character", () => {
  const film = fixture();
  film.characters.push({ ...film.characters[0]!, id: "other", name: "林晚" });
  film.shots[0]!.action = "沈砚看着林晚左手持刀。";
  film.shots[1]!.action = "沈砚右手持刀。";
  expect(continuityRisks(film)["shot-2"]).toEqual([]);
});

it("reports invalid cuts and stale selected-take provenance without claiming visual discontinuity", () => {
  const film = fixture();
  const shot = film.shots[1]!;
  shot.continuityFromShotId = "not-previous";
  expect(continuityRisks(film)[shot.id]?.map((note) => note.kind)).toEqual(["cut"]);
  shot.continuityFromShotId = "shot-1";
  shot.poster = "/media/frame.png";
  shot.continuityFrame = {
    sourceShotId: "shot-1",
    sourceTakeId: "old",
    sourceVideoPath: "/media/old.mp4",
    path: shot.poster,
  };
  film.shots[0]!.selectedTakeId = "new";
  film.shots[0]!.takes = [
    {
      id: "new",
      shotId: "shot-1",
      index: 1,
      status: "done",
      videoPath: "/media/new.mp4",
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  expect(continuityRisks(film)[shot.id]?.[0]?.text).toContain("当前选定版本");
  shot.continuityFrame.sourceTakeId = "new";
  shot.continuityFrame.sourceVideoPath = "/media/new.mp4";
  expect(continuityRisks(film)[shot.id]).toEqual([]);
});

it("migrates and preserves the existing B04 cut note as a separate C13 array item", () => {
  const film = fixture();
  const cut = {
    kind: "cut" as const,
    text: "未自动衔接：首镜、合镜或前镜标识不明确，请确认紧邻前镜后重试。",
  };
  film.shots[1]!.continuity = cut;
  film.shots[1]!.picture = "只剩动作。";
  const checked = applyContinuityChecks(film);
  expect(checked.shots[1]!.continuity).toHaveLength(2);
  expect(checked.shots[1]!.continuity?.[0]).toEqual(cut);
  expect(checked.shots[1]!.continuity?.[1]?.kind).toBe("missing_look");
  expect(applyContinuityChecks(checked)).toEqual(checked);
  checked.shots[1]!.picture = film.characters[0]!.identity;
  expect(applyContinuityChecks(checked).shots[1]!.continuity).toEqual([cut]);
});

it("keeps independent rule kinds as separate array entries and does not mutate input", () => {
  const film = fixture();
  film.shots[0]!.action = "沈砚左手持刀。沈砚看向画左。机位在轴线左侧。";
  film.shots[1]!.picture = "沈砚站定。";
  film.shots[1]!.action = "沈砚右手持刀。沈砚看向画右。机位在轴线右侧。";
  film.shots[1]!.continuityFromShotId = "invalid";
  const snapshot = structuredClone(film);
  const checked = applyContinuityChecks(film);
  expect(checked.shots[1]!.continuity?.map((note) => note.kind)).toEqual([
    "missing_look",
    "prop",
    "gaze",
    "axis",
    "cut",
  ]);
  expect(film).toEqual(snapshot);
});

it("does not use negated or quoted instructions as hand or gaze evidence", () => {
  const film = fixture();
  film.shots[0]!.action = "沈砚左手持刀。沈砚看向画左。";
  for (const action of [
    "沈砚并非右手持刀。沈砚不看向画右。",
    "沈砚说“右手持刀”。沈砚说“看向画右”。",
  ]) {
    film.shots[1]!.action = action;
    expect(continuityRisks(film)["shot-2"]).toEqual([]);
  }
});

it("upgrades a stored legacy director reminder to a C13 array and preserves it on resave", () => {
  const film = sampleFilm();
  const cut = { kind: "cut", text: "旧导演提醒：请确认前镜。" };
  window.localStorage.setItem(
    FILM_KEY,
    JSON.stringify({ ...film, shots: [{ ...film.shots[0], continuity: cut }] }),
  );
  const loaded = readFilm(window.localStorage)!;
  expect(loaded.shots[0]!.continuity).toEqual([cut]);
  const checked = applyContinuityChecks(loaded);
  writeFilm(window.localStorage, checked);
  const reloaded = readFilm(window.localStorage)!;
  expect(reloaded.shots[0]!.continuity?.[0]).toEqual(cut);
  expect(Array.isArray(reloaded.shots[0]!.continuity)).toBe(true);
  window.localStorage.removeItem(FILM_KEY);
});

it("retains each valid C13 array note while discarding malformed persisted entries", () => {
  const film = sampleFilm();
  const valid = [
    { kind: "prop", text: "核对持刀手。" },
    { kind: "axis", text: "核对轴线。" },
  ];
  window.localStorage.setItem(
    FILM_KEY,
    JSON.stringify({
      ...film,
      shots: [
        {
          ...film.shots[0],
          continuity: [
            ...valid,
            null,
            { kind: "unknown", text: "invalid" },
            { kind: "cut", text: 42 },
            { kind: "cut", text: " " },
          ],
        },
      ],
    }),
  );
  expect(readFilm(window.localStorage)!.shots[0]!.continuity).toEqual(valid);
  expect(upgradeFilm(film)!.shots[0]!.continuity).toBeUndefined();
  window.localStorage.removeItem(FILM_KEY);
});

it("preserves film and shot references when repeated checks make no changes", () => {
  const film = fixture();
  const clean = applyContinuityChecks(film);
  expect(clean).toBe(film);
  expect(clean.shots).toBe(film.shots);
  film.shots[1]!.picture = "缺少外貌的镜头。";
  const checked = applyContinuityChecks(film);
  expect(checked).not.toBe(film);
  expect(checked.shots[0]).toBe(film.shots[0]);
  const repeated = applyContinuityChecks(checked);
  expect(repeated).toBe(checked);
  expect(repeated.shots).toBe(checked.shots);
  expect(repeated.shots[1]).toBe(checked.shots[1]);
});
