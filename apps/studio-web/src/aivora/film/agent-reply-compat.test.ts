import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import { parseDirectorShots } from "./project";
import { parseWriterScenes } from "./operations";
import { parseAgentReplyText, normalizeAgentReply } from "./agent-reply-compat";
import { actionFromModel, assignPerformance, artFromModel, qcFromModel } from "./phase2";
import { beatsForShot } from "./operations";

it("normalizes object and array envelopes without dropping fields or assigning ids", () => {
  const shots = [{ picture: "门口", extra: "retained" }];
  expect(normalizeAgentReply("director", shots)).toEqual({ shots });
  expect(normalizeAgentReply("writer", shots)).toEqual({ scenes: shots });
  expect(normalizeAgentReply("performance", shots)).toEqual({ shots });
  const scenes = [{ scene_id: "s", shots }];
  expect(normalizeAgentReply("director", scenes)).toEqual({ scenes });
  const object = { scenes, extra: "retained" };
  expect(normalizeAgentReply("director", object)).toBe(object);
  expect(normalizeAgentReply("action", "invalid")).toBeNull();
});
it("preserves unmatched beats and nodes and merges only an explicit node identity", () => {
  const result = actionFromModel({
    shots: [
      {
        shot_id: "fight",
        nodes: [
          { node_id: "n1", actor: "甲", move: "挥铁棍", direction: "从左到右" },
          { node_id: "n2", actor: "乙", move: "闪开" },
        ],
      },
    ],
    beats: [
      { node_id: "n1", text: "甲持铁棍攻击", feasibility: "难", workaround: "分镜" },
      { text: "警笛响起" },
    ],
  })!;
  expect(result).toHaveLength(3);
  expect(result[0]).toMatchObject({ shotId: "fight", feasibility: "难", workaround: "分镜" });
  expect(result[0]!.text).toContain("挥铁棍");
  expect(result[0]!.text).toContain("甲持铁棍攻击");
  expect(result[1]).toMatchObject({ shotId: "fight", text: "乙，闪开" });
  expect(result[2]).not.toHaveProperty("shotId");
  expect(beatsForShot(result, 1, "unrelated")).toBe("");
});
it("accepts a mixed top-level action array without positional fallback", () => {
  const result = actionFromModel([
    { shot_id: "s1", nodes: [{ move: "举手" }] },
    { shot_id: "s2", text: "退后" },
    { text: "未归属动作" },
  ])!;
  expect(result.map((row) => row.shotId)).toEqual(["s1", "s2", undefined]);
  expect(result.map((row) => row.text)).toEqual(["举手", "退后", "未归属动作"]);
});

describe("24 real design examples (not provider evidence)", () => {
  expect(fixtures.examples).toHaveLength(24);
  for (const entry of fixtures.examples) {
    it(`${entry.role}/${entry.example.id}: source envelope and supported projection`, () => {
      expect(entry.sourceBlob).toMatch(/^[a-f0-9]{40}$/);
      const output: unknown = entry.example.output;
      if (entry.role === "action") {
        const source = output as {
          shots: { shot_id: string; nodes: { node_id: string; move: string }[] }[];
          beats: { text: string }[];
        };
        const rows = actionFromModel(output)!;
        expect(rows.length).toBeGreaterThan(0);
        for (const shot of source.shots)
          for (const node of shot.nodes) {
            expect(
              rows.some((row) => row.shotId === shot.shot_id && row.text.includes(node.move)),
            ).toBe(true);
          }
        for (const beat of source.beats)
          expect(rows.some((row) => row.text.includes(beat.text))).toBe(true);
      } else if (entry.role === "performance") {
        const source = output as { shot_id: string; face: string[] }[];
        const parsed = assignPerformance(
          output,
          source.map((row) => ({ id: row.shot_id })),
        );
        expect(parsed).toHaveLength(source.length);
        source.forEach((row, index) =>
          row.face.forEach((face) => expect(parsed[index]!.performance).toContain(face)),
        );
      } else if (entry.role === "art") {
        expect(artFromModel(output)).not.toBeNull();
      } else if (entry.role === "review") {
        expect(qcFromModel(output)).not.toBeNull();
      } else if (entry.role === "writer") {
        const source = entry.example.input as unknown as { paragraphs: { text: string }[] };
        const text = source.paragraphs.map((row) => row.text).join("\n\n");
        const out = output as { scenes: unknown[] };
        const objectResult = parseWriterScenes(JSON.stringify(output), text);
        expect(objectResult?.length).toBeGreaterThan(0);
        expect(parseWriterScenes(JSON.stringify(out.scenes), text)).toEqual(objectResult);
        const saved = objectResult!.map((scene) => scene.text).join("\n");
        for (const row of source.paragraphs) expect(saved).toContain(row.text);
      } else if (entry.role === "director") {
        const input = entry.example.input as unknown as {
          scenes: {
            id: string;
            title: string;
            paragraphs: { text: string }[];
            lines: { line: string }[];
          }[];
        };
        const scenes = input.scenes.map((scene) => ({
          id: scene.id,
          title: scene.title,
          where: scene.title,
          text: scene.paragraphs.map((row) => row.text).join("\n"),
        }));
        const out = output as { scenes: unknown[] };
        const objectResult = parseDirectorShots(
          JSON.stringify(output),
          scenes[0]!.id,
          scenes[0]!.text,
          scenes,
        );
        expect(objectResult?.length).toBeGreaterThan(0);
        expect(
          parseDirectorShots(JSON.stringify(out.scenes), scenes[0]!.id, scenes[0]!.text, scenes),
        ).toEqual(objectResult);
        for (const source of input.scenes) {
          const lines = objectResult!
            .filter((shot) => shot.sceneId === source.id)
            .flatMap((shot) => shot.lines?.map((line) => line.text) ?? []);
          for (const line of source.lines) expect(lines).toContain(line.line);
        }
      } else {
        // Sound and continuity currently have no role executor: preserve fixtures, do not claim execution.
        expect(["sound", "continuity"]).toContain(entry.role);
        expect(output).toBeTypeOf("object");
      }
    });
  }
});

it("reads a fenced director array without losing extra fields or quoted dialogue", () => {
  const shots = [
    {
      id: "one",
      picture: "门边",
      dialogue: [{ speaker: "甲", text: "别走。等我。" }],
      blocking: [{ who: "甲", position: "画左" }],
      extra: "ignored",
    },
  ];
  const text = "甲说：“别走。等我。”";
  const encoded = "```json\n" + JSON.stringify(shots) + "\n```";
  expect(parseAgentReplyText("director", encoded)).toEqual({ shots });
  const result = parseDirectorShots(encoded, "s1", text)!;
  expect(result[0]?.blocking).toContain("画左");
  expect(result[0]?.lines).toEqual([{ speaker: "甲", text: "别走。等我。" }]);
  expect(parseAgentReplyText("director", "[broken")).toBeNull();
});

it("retains nested performances and structured micro expressions", () => {
  const parsed = assignPerformance(
    {
      shots: [
        {
          shot_id: "shot-a",
          performances: [
            { micro_expressions: [{ text: "眉头收紧" }, "嘴角抿住"], hands: "握住栏杆" },
          ],
        },
      ],
    },
    [{ id: "shot-a" }],
  );
  expect(parsed[0]?.performance).toContain("眉头收紧");
  expect(parsed[0]?.performance).toContain("嘴角抿住");
  expect(parsed[0]?.performance).toContain("握住栏杆");
});
