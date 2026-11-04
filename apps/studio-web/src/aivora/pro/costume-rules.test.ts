import { expect, it, vi } from "vitest";
import fixtures from "../film/fixtures/claude-6a77ebd-examples.json";
import { artFromModel } from "../film/phase2";
import { parseWriterScenes, storyFilmBatches } from "../film/operations";
import { sampleFilm, upgradeFilm } from "../film/project";
import {
  mergeCostumes,
  parseCostumes,
  resolveCostumes,
  withShotCostumes,
} from "../film/costume-rules";
import { applyArtDraft, requestShotStill } from "./workflow";

type Writer = {
  input: { paragraphs: { id: string; text: string }[] };
  output: { scenes: unknown[] };
};
const arts = fixtures.examples.filter((entry) => entry.role === "art");
function fixture() {
  const writers = fixtures.examples
    .filter((entry) => entry.role === "writer")
    .map((entry) => entry.example as unknown as Writer);
  const source = writers
    .flatMap((entry) => entry.input.paragraphs)
    .map(({ id, text }) => `[${id}] ${text}`)
    .join("\n");
  let film = sampleFilm();
  film.sourceText = source;
  film.scenes = parseWriterScenes(
    JSON.stringify({ scenes: writers.flatMap((entry) => entry.output.scenes) }),
    source,
  )!;
  film.characters = ["林晚", "沈砚", "周烈", "打手甲", "打手乙", "阿婆"].map((name, index) => ({
    ...film.characters[0]!,
    id: `person-${index}`,
    name,
    userFields: [],
  }));
  film.shots = film.scenes.map((scene, index) => ({
    ...film.shots[0]!,
    id: `shot-${index}`,
    sceneId: scene.id,
    picture: "走到门前",
    action: "",
    line: "",
    lines: [],
    speaker: "",
    characters: ["林晚", "沈砚"],
    userFields: [],
    performance: "",
  }));
  for (const art of arts) film = applyArtDraft(film, artFromModel(art.example.output)!);
  return film;
}

it("retains all three real costume replies and original scopes, with in-scene changes left for review", () => {
  expect(arts).toHaveLength(3);
  const film = upgradeFilm(JSON.parse(JSON.stringify(fixture())))!;
  const result = resolveCostumes(film);
  expect(film.scenes.every((scene) => scene.paragraphCoverage?.ok)).toBe(true);
  expect(film.costumes!.find((rule) => rule.id === "cos_linwan_cardigan")!.ranges).toHaveLength(3);
  expect(
    result.accepted.some(
      (entry) => entry.sceneId === "scene-1" && entry.rule.id === "cos_shenyan_coat",
    ),
  ).toBe(true);
  expect(
    result.accepted.some((entry) => entry.sceneId === "scene-2" && entry.rule.name === "沈砚"),
  ).toBe(false);
  expect(
    result.accepted.some((entry) => entry.sceneId === "scene-3" && entry.rule.name === "林晚"),
  ).toBe(false);
  expect(result.risks).toContainEqual({
    costumeId: "cos_shenyan_shirt",
    sceneId: "scene-2",
    code: "COSTUME_WITHIN_SCENE_CHANGE",
  });
  expect(result.risks).toContainEqual({
    costumeId: "cos_linwan_coat_over",
    sceneId: "scene-3",
    code: "COSTUME_WITHIN_SCENE_CHANGE",
  });
  expect(film.costumeRisks).toEqual(result.risks);
});

it("passes only reliable whole-scene clothes into actual still and video requests", async () => {
  const film = fixture();
  const shot = film.shots[0]!;
  const description = film.costumes!.find((rule) => rule.id === "cos_shenyan_coat")!.description;
  expect(storyFilmBatches(film, [shot], false)[0]!.shots![0]!.prompt).toContain(description);
  const previous = window.aijian;
  const generateFilmStill = vi.fn<
    NonNullable<NonNullable<typeof window.aijian>["generateFilmStill"]>
  >(async () => ({ path: "/media/frame.png", reason: "" }));
  window.aijian = { ...previous, generateFilmStill } as typeof window.aijian;
  try {
    await requestShotStill(film, shot, withShotCostumes("画面", film, shot));
    const prompt = generateFilmStill.mock.calls[0]![1];
    expect(prompt).toContain(description);
    expect(prompt.match(/【本镜服装】/gu)).toHaveLength(1);
  } finally {
    window.aijian = previous;
  }
  const second = withShotCostumes("画面", film, film.shots[1]!);
  expect(second).toContain("林晚：");
  expect(second).not.toContain("沈砚：");
});

it("rejects edited, ambiguous and incomplete source ownership rather than trusting scene numbers", () => {
  for (const mode of ["edited", "missing", "duplicate", "incomplete"]) {
    const film = fixture();
    const scene = film.scenes[0]!;
    if (mode === "edited") scene.text += "用户改动";
    if (mode === "missing") scene.sourceParagraphIds = [];
    if (mode === "duplicate")
      film.scenes[1]!.sourceParagraphIds!.push(scene.sourceParagraphIds![0]!);
    if (mode === "incomplete") scene.sourceParagraphIds!.pop();
    expect(withShotCostumes("画面", film, film.shots[0]!)).toBe("画面");
    expect(
      resolveCostumes(film).risks.some(
        (risk) => risk.sceneId === scene.id && risk.code === "COSTUME_SOURCE_UNVERIFIED",
      ),
    ).toBe(true);
  }
});

it("preserves user appearance, costume and shot edits without altering source descriptions", () => {
  const film = fixture();
  const shot = film.shots[0]!;
  for (const field of ["identity", "costume"]) {
    film.characters.find((person) => person.name === "沈砚")!.userFields = [field];
    expect(withShotCostumes("画面", film, shot)).not.toContain("沈砚：");
  }
  shot.userFields = ["picture"];
  expect(withShotCostumes("用户镜头", film, shot)).toBe("用户镜头");
  const old = film.costumes![0]!;
  old.description = "用户指定蓝衬衣";
  const updated = mergeCostumes(film, [{ ...old, description: "AI换成红衬衣" }]);
  expect(updated.costumes!.find((rule) => rule.id === old.id)!.description).toBe("用户指定蓝衬衣");
});

it("keeps malformed ranges as review risks and blocks contradictory whole-scene costumes", () => {
  const film = fixture();
  const rules = parseCostumes([
    {
      costume_id: "bad",
      name: "沈砚",
      description: "红衣",
      ranges: [{ scene_id: "scene-1", from: "P15", to: "P01" }],
    },
    { costume_id: "unknown", name: "沈砚", description: "蓝衣", scene_range: "1-2" },
  ]);
  expect(resolveCostumes({ ...film, costumes: rules }).risks).toHaveLength(2);
  const conflict = parseCostumes([
    {
      costume_id: "conflict",
      name: "沈砚",
      description: "红衣",
      ranges: [{ scene_id: "scene-1", from: "P01", to: "P15" }],
    },
  ]);
  const changed = mergeCostumes(film, conflict);
  expect(withShotCostumes("画面", changed, changed.shots[0]!)).not.toContain("沈砚：");
  expect(resolveCostumes(changed).risks.some((risk) => risk.code === "COSTUME_CONFLICT")).toBe(
    true,
  );
});
