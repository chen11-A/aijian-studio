import { expect, it } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import {
  applyPerformancePlans,
  parsePerformancePlans,
  performancePlanPrompt,
  type ShotPerformancePlan,
} from "./performance-plan";
import { sampleFilm, upgradeFilm, type FilmProject } from "./project";
import { hydrateFilm } from "../pro/workflow";

type Other = { name: string; face: string[]; eyes: string; hands: string };
type Row = {
  shot_id: string;
  who: string;
  emotion: string;
  intensity: number;
  face: string[];
  face_at: number[];
  eyes: string;
  gaze: string;
  hold_s: number | null;
  hands: string;
  breath: string;
  voice: { tone: string; pace: string; pauses: string; emotion: string } | null;
  others: Other[];
  prompt_addon: string;
};
type Input = {
  shots: { shot_id: string; characters: string[]; speaker: string; seconds: number }[];
};
const examples = fixtures.examples.filter((entry) => entry.role === "performance");

/** Reconstruct every actual fixture field from its persisted declaration or execution projection. */
function sourceRow(id: string, plan: ShotPerformancePlan) {
  const main = plan.people.filter((person) => person.declarations?.role === "primary");
  expect(main).toHaveLength(1);
  const person = main[0]!;
  return {
    shot_id: id,
    who: person.name,
    emotion: person.emotion,
    intensity: person.intensity,
    face: person.face,
    face_at: person.faceAt,
    eyes: person.eyes,
    gaze: person.gaze,
    hold_s: person.declarations!.holdS,
    hands: person.hands,
    breath: person.breath,
    voice: person.declarations!.voice,
    others: plan.people
      .filter((person) => person.declarations?.role === "other")
      .map((person) => ({
        name: person.name,
        face: person.face,
        eyes: person.eyes,
        hands: person.hands,
      })),
    prompt_addon: plan.promptAddon,
  };
}
async function roundTrip(film: FilmProject) {
  return hydrateFilm(upgradeFilm(JSON.parse(JSON.stringify(film)))!);
}

it.each(examples)(
  "$example.id keeps every output path through project JSON, upgrade and hydrate",
  async ({ example }) => {
    const rows = example.output as unknown as Row[];
    const input = example.input as unknown as Input;
    const film = sampleFilm();
    film.shots = rows.map((row) => {
      const original = input.shots.find((shot) => shot.shot_id === row.shot_id)!;
      return {
        ...film.shots[0]!,
        id: row.shot_id,
        sceneId: row.shot_id.split("-shot-")[0]!,
        characters: original.characters,
        speaker: original.speaker,
        seconds: original.seconds,
        lines: [],
        line: "",
        userFields: [],
        takes: [],
      };
    });
    film.scenes = [{ ...film.scenes[0]!, id: film.shots[0]!.sceneId }];
    const parsed = parsePerformancePlans(rows);
    rows.forEach((row, index) =>
      expect(sourceRow(parsed[index]!.shotId, parsed[index]!.plan)).toEqual(row),
    );
    const result = applyPerformancePlans(film.shots, rows);
    expect(result.state.unassigned).toEqual([]);
    film.shots = result.shots;
    film.scenes[0]!.performanceState = result.state;
    const restored = await roundTrip(film);
    rows.forEach((row, index) => {
      const plan = restored.shots[index]!.performancePlan!;
      expect(sourceRow(plan.sourceId!, plan)).toEqual(row);
      expect(plan.people[0]!.voice).toEqual(
        row.voice ?? { tone: "", pace: "", pauses: "", emotion: "" },
      );
      expect(plan.people[0]!.holdSeconds).toBe(row.hold_s ?? undefined);
      for (const other of plan.people.filter((person) => person.declarations?.role === "other")) {
        expect(other.declarations).not.toHaveProperty("holdS");
        expect(other.declarations).not.toHaveProperty("voice");
      }
    });
  },
);

it("audits the complete real-fixture population rather than a selected subset", () => {
  const rows = examples.flatMap((entry) => entry.example.output as unknown as Row[]);
  expect(rows).toHaveLength(35);
  expect(rows.flatMap((row) => row.face)).toHaveLength(55);
  expect(rows.flatMap((row) => row.others)).toHaveLength(14);
  expect(rows.filter((row) => row.hold_s === null)).toHaveLength(23);
  expect(rows.filter((row) => row.voice === null)).toHaveLength(13);
});

it.each(["UNKNOWN_SHOT", "USER_EDITED", "DUPLICATE_SHOT"] as const)(
  "keeps all source declarations in the rejected %s path after hydrate",
  async (reason) => {
    const row = (examples[0]!.example.output as unknown as Row[]).find((row) => row.others.length)!;
    const film = sampleFilm();
    const shot = {
      ...film.shots[0]!,
      id: row.shot_id,
      characters: [row.who],
      userFields: reason === "USER_EDITED" ? ["performance"] : [],
    };
    const shots =
      reason === "UNKNOWN_SHOT"
        ? [
            { ...shot, id: "unrelated-1" },
            { ...shot, id: "unrelated-2" },
          ]
        : [shot];
    const applied = applyPerformancePlans(shots, reason === "DUPLICATE_SHOT" ? [row, row] : [row]);
    film.shots = applied.shots;
    film.scenes[0]!.performanceState = applied.state;
    const restored = await roundTrip(film);
    const rejected = restored.scenes[0]!.performanceState!.unassigned;
    expect(rejected.length).toBeGreaterThan(0);
    for (const item of rejected) {
      expect(item.reason).toBe(reason);
      expect(sourceRow(item.shotId, item.plan)).toEqual(row);
    }
  },
);

it("distinguishes missing, explicit null and empty voice without changing executable cues", () => {
  const rows = parsePerformancePlans([
    { shot_id: "a", who: "甲", face: ["抬眼"] },
    { shot_id: "b", who: "甲", face: ["抬眼"], hold_s: null, voice: null },
    { shot_id: "c", who: "甲", face: ["抬眼"], voice: {} },
  ]);
  expect(rows[0]!.plan.people[0]!.declarations).toEqual({ role: "primary" });
  expect(rows[1]!.plan.people[0]!.declarations).toEqual({
    role: "primary",
    holdS: null,
    voice: null,
  });
  expect(rows[2]!.plan.people[0]!.declarations).toEqual({ role: "primary", voice: {} });
  const shot = { ...sampleFilm().shots[0]!, characters: ["甲"], userFields: [] };
  const prompts = rows.map((row) => performancePlanPrompt({ ...shot, performancePlan: row.plan }));
  expect(new Set(prompts).size).toBe(1);
});
