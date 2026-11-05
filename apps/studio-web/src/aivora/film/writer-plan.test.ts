import { describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import { blankFilm, upgradeFilm } from "./project";
import { applyWriterPlan, parseWriterScenes } from "./operations";
import { parseWriterPlan } from "./writer-plan";
import { writerSceneContext } from "./writer-elements";
import { planWriterDraft, writerDraftInput } from "../pro/actions/writer";
import {
  prepareWriterTransaction,
  applyStoryStructureTransaction,
  undoStoryStructureTransaction,
} from "../pro/actions/story-structure-transaction";
import { runPipelineAgentAction } from "../pro/pipeline-agent-actions";

type Example = {
  input: { paragraphs: { id: string; text: string }[] };
  output: {
    title: string;
    logline: string;
    hook: string;
    cliffhanger: string;
    dialogue_count: number;
    characters: {
      name: string;
      identity: string;
      gender: string;
      age_band: string;
      first_paragraph: string;
      brief: string;
    }[];
    locations: { name: string; prompt: string }[];
    scenes: Record<string, unknown>[];
  };
};
const examples = fixtures.examples.filter((row) => row.role === "writer");
function setup(example = examples[0]!.example) {
  const { input, output } = example as unknown as Example;
  const source = input.paragraphs.map((p) => `[${p.id}] ${p.text}`).join("\n");
  const reply = JSON.stringify(output);
  const base = { ...blankFilm(), sourceText: source };
  const scenes = parseWriterScenes(reply, source)!;
  const plan = parseWriterPlan(reply, source)!;
  return { base, scenes, plan, reply, source, output };
}
describe("same-reply writer design and operational projection", () => {
  it.each(examples)(
    "projects frozen design fixture $example.id, confirms atomically and hydrates",
    ({ example }) => {
      const { base, scenes, plan, output } = setup(example);
      expect(plan).toMatchObject({
        title: output.title,
        logline: output.logline,
        hook: output.hook,
        cliffhanger: output.cliffhanger,
        declaredDialogueCount: output.dialogue_count,
      });
      output.scenes.forEach((raw, i) =>
        expect(scenes[i]!.writerPlan).toEqual({
          sourceSceneId: raw.id,
          sourceNo: raw.no,
          title: raw.title,
          place: raw.place,
          interior: raw.interior,
          time: raw.time,
          weather: raw.weather,
          characters: raw.characters,
          mood: raw.mood,
          keyEvent: raw.key_event,
          proposedText: raw.text,
          proposedDialogue: raw.dialogue,
          beats: raw.beats,
          estimatedSeconds: raw.est_seconds,
        }),
      );
      const tx = prepareWriterTransaction(base, scenes, plan);
      const result = applyStoryStructureTransaction(base, tx);
      expect(result.conflicts).toEqual([]);
      for (const raw of output.characters)
        expect(result.film.characters).toContainEqual(
          expect.objectContaining({
            name: raw.name,
            identity: raw.identity,
            gender: raw.gender === "未知" ? "" : raw.gender,
            ageBand: raw.age_band === "未知" ? "" : raw.age_band,
            writerPlan: {
              name: raw.name,
              identity: raw.identity,
              gender: raw.gender,
              ageBand: raw.age_band,
              firstParagraph: raw.first_paragraph,
              brief: raw.brief,
            },
          }),
        );
      for (const raw of output.locations)
        expect(result.film.locations).toContainEqual(expect.objectContaining(raw));
      expect(result.film.title).toBe(base.title);
      const restored = upgradeFilm(JSON.parse(JSON.stringify(result.film)))!;
      expect(restored.writerPlan).toEqual(plan);
      expect(restored.characters).toEqual(result.film.characters);
      expect(restored.scenes).toEqual(result.film.scenes);
      expect(undoStoryStructureTransaction(result.film, tx).film).toEqual(base);
      expect(writerSceneContext(scenes[0])).toContain('"estimatedSeconds":');
      expect(writerSceneContext({ ...scenes[0]!, text: "改稿" })).toBe("");
    },
  );
  it("protects user fields and existing media while applying same-reply traits", () => {
    const { base, plan } = setup();
    const applied = applyWriterPlan(base, plan);
    const first = applied.characters[0]!;
    first.identity = "用户外貌";
    first.gender = "男";
    first.ageBand = "老年";
    first.voiceId = "user-voice";
    first.userFields = ["identity", "gender", "ageBand", "voiceId"];
    first.portraits = [{ view: "正面", prompt: "", url: "aivora-media://face.png" }];
    const place = applied.locations[0]!;
    place.prompt = "用户地点";
    place.referenceImage = "aivora-media://place.png";
    const next = applyWriterPlan(applied, plan);
    expect(next.characters[0]).toEqual(first);
    expect(next.locations[0]).toEqual(place);
    const unlocked = {
      ...applied,
      characters: [{ ...first, userFields: [], gender: "" as const, ageBand: "" as const }],
    };
    expect(applyWriterPlan(unlocked, plan).characters[0]!.gender).toBe(plan.characters[0]!.gender);
    expect(applyWriterPlan(unlocked, plan).characters[0]!.identity).toBe("用户外貌");
  });
  it("rejects stale cast/media edits and undo as a whole without partial scene changes", () => {
    const { base, scenes, plan } = setup();
    const tx = prepareWriterTransaction(base, scenes, plan);
    const newer = applyWriterPlan(base, plan);
    expect(applyStoryStructureTransaction(newer, tx)).toMatchObject({
      film: newer,
      conflicts: ["WRITER_ASSETS_CHANGED"],
    });
    const applied = applyStoryStructureTransaction(base, tx).film;
    const edited = structuredClone(applied);
    edited.characters[0]!.portraits.push({ view: "正面", prompt: "", url: "new" });
    expect(undoStoryStructureTransaction(edited, tx)).toMatchObject({
      film: edited,
      conflicts: ["WRITER_ASSETS_CHANGED"],
    });
  });
  it("manual draft carries metadata but does not apply before confirmation", async () => {
    const { base, reply, plan } = setup();
    const result = await planWriterDraft(writerDraftInput(base, "write", ""), {
      connected: true,
      request: vi.fn().mockResolvedValue({ text: reply }),
    });
    expect(result.writerPlan?.characters).toEqual(plan.characters);
    expect(base.characters).toEqual([]);
  });
  it("pipeline writes original writer characters without a second cast request", async () => {
    const { base, reply, plan } = setup();
    const request = vi.fn().mockResolvedValue({ text: reply });
    const result = await runPipelineAgentAction(
      base,
      { step: "writer", targetId: "script" },
      { request, valid: () => true },
    );
    expect(result.film?.writerPlan).toEqual(plan);
    expect(result.film?.characters).toHaveLength(plan.characters.length);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not recast people absent from this writer reply", () => {
    const { base, plan } = setup();
    const cast = applyWriterPlan(base, plan).characters[0]!;
    const unrelated = {
      ...cast,
      name: "用户已有角色",
      gender: "" as const,
      ageBand: "" as const,
      voiceId: "custom",
      writerPlan: undefined,
    };
    const next = applyWriterPlan({ ...base, characters: [unrelated] }, plan);
    expect(next.characters.find((person) => person.name === unrelated.name)).toEqual(unrelated);
  });
  it("keeps absent optional metadata absent", () => {
    expect(parseWriterPlan('{"scenes":[]}', "source")).toEqual({
      sourceText: "source",
      characters: [],
      locations: [],
    });
  });
});
