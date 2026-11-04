import { describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import {
  blankFilm,
  keyframePrompt,
  parseDirectorShots,
  sampleFilm,
  upgradeFilm,
  videoPrompt,
} from "./project";
import { mergeAdjacentShots } from "./director-continuity";
import { directorPlanPrompt, mergeDirectorPlans } from "./director-plan";
import { assignActionBeats, motionPrompt, parseWriterScenes, storyFilmBatches } from "./operations";
import { assignPerformance } from "./phase2";
import { applyPerformancePlans } from "./performance-plan";
import { directorRequestInput, requestDirectorDraft } from "../pro/actions/director";
import { requestShotStill } from "../pro/workflow";

type DirectorFixture = {
  id: string;
  output: { scenes: { scene_id: string; shots: Record<string, unknown>[] }[] };
};
type WriterFixture = { input: { paragraphs: { id: string; text: string }[] }; output: unknown };
const directors = fixtures.examples.filter((item) => item.role === "director");
const writers = fixtures.examples.filter((item) => item.role === "writer");
const row = (extra: Record<string, unknown> = {}) => ({
  id: "scene-1-shot-1",
  picture: "甲站在窗前。",
  seconds: 3,
  purpose: "等待来信",
  emotion: "忐忑",
  characters: ["甲"],
  positions: [{ name: "甲", position: "画左", depth: "前景", visible: "半身" }],
  ...extra,
});
const parse = (rows: Record<string, unknown>[], source = "") =>
  parseDirectorShots(JSON.stringify({ shots: rows }), "scene-1", source, [], false)!;

describe("typed director plan", () => {
  it.each(directors)("preserves actual optional fields from $example.id", ({ example }) => {
    const fixture = example as unknown as DirectorFixture;
    const raw = fixture.output.scenes[0]!;
    const writer = writers[directors.findIndex((item) => item.example.id === fixture.id)]!
      .example as unknown as WriterFixture;
    const source = writer.input.paragraphs.map((p) => `[${p.id}] ${p.text}`).join("\n");
    const scene = parseWriterScenes(JSON.stringify(writer.output), source)![0]!;
    const shots = parseDirectorShots(
      JSON.stringify({ shots: raw.shots }),
      raw.scene_id,
      scene.text,
      [scene],
      false,
    )!;
    expect(shots).toHaveLength(raw.shots.length);
    raw.shots.forEach((original, index) => {
      const shot = shots[index]!;
      const segment = shot.directorPlan!.segments[0]!;
      expect(segment).toMatchObject({
        purpose: original.purpose,
        emotion: original.emotion,
        positions: original.positions,
        sourceParagraphHints: [original.source],
        verifiedSourceParagraphIds: [original.source],
      });
      expect(segment.referenceHints).toEqual(
        (original.reference_images as { token: string; asset_id: string }[]).map((r) => ({
          token: r.token,
          assetId: r.asset_id,
        })),
      );
      if (original.line)
        expect(segment.dialogueCues).toEqual([
          {
            speaker: original.speaker,
            text: original.line,
            atSeconds: original.line_at,
            timingStatus: "specified",
          },
        ]);
      expect(shot.directorFramePrompt).toBe(original.start_frame_prompt);
      expect(shot.directorVideoPrompt).toBe(original.video_prompt);
    });
    const film = { ...blankFilm(), scenes: [scene], shots };
    expect(
      upgradeFilm(JSON.parse(JSON.stringify(film)))!.shots.map((shot) => shot.directorPlan),
    ).toEqual(shots.map((shot) => shot.directorPlan));
  });

  it("sends purpose, emotion and positions through real still and video request builders", async () => {
    const shot = parse(
      [
        row({
          line: "等到了。",
          speaker: "甲",
          line_at: 0.4,
          source: "P101",
          reference_images: [{ token: "<IMAGE_99>", asset_id: "unresolved" }],
        }),
      ],
      "甲说：“等到了。”",
    )[0]!;
    const film = {
      ...blankFilm(),
      characters: [{ ...sampleFilm().characters[0]!, name: "甲" }],
      shots: [shot],
    };
    const generate = vi.fn(async (...args: unknown[]) => ({
      path: "/tmp/frame.png",
      reason: String(args.length),
    }));
    const old = window.aijian;
    window.aijian = { ...old, generateFilmStill: generate } as NonNullable<typeof window.aijian>;
    try {
      await requestShotStill(film, shot, keyframePrompt(shot, film));
      const payload = generate.mock.calls[0]?.[1];
      expect(JSON.stringify(payload)).toContain("等待来信");
      expect(JSON.stringify(payload)).toContain("甲，画左，前景，半身");
      expect(JSON.stringify(payload)).not.toContain("unresolved");
    } finally {
      window.aijian = old;
    }
    for (const prompt of [
      videoPrompt(shot),
      motionPrompt(shot),
      storyFilmBatches(film, [shot], false)[0]!.shots![0]!.prompt,
    ]) {
      expect(prompt).toContain("等待来信");
      expect(prompt).toContain("忐忑");
      expect(prompt).toContain("甲，画左，前景，半身");
      expect(prompt).toContain("约0.4秒");
      expect(prompt).toContain("等到了。");
      expect(prompt).not.toContain("IMAGE_99");
      expect(prompt).not.toContain("unresolved");
    }
  });

  it("keeps every line and accepts only explicit per-line timing for multiple speakers", () => {
    const shot = parse(
      [
        row({
          characters: ["甲", "乙"],
          line_at: 1,
          lines: [
            { speaker: "甲", text: "别走。", line_at: 0 },
            { speaker: "乙", text: "我等你。", line_at: 1.5 },
          ],
        }),
      ],
      "甲说：“别走。”\n乙说：“我等你。”",
    )[0]!;
    expect(shot.line).toBe("别走。\n我等你。");
    expect(shot.directorPlan!.segments[0]!.unassignedLineAt).toBe(1);
    const prompt = directorPlanPrompt(shot, "video");
    expect(prompt).toContain("约0秒，甲：");
    expect(prompt).toContain("约1.5秒，乙：");
    expect(prompt).not.toContain("约1秒");
    const ambiguous = parse(
      [
        row({
          line_at: 1,
          lines: [
            { speaker: "甲", text: "别走。" },
            { speaker: "乙", text: "我等你。" },
          ],
        }),
      ],
      "甲说：“别走。”\n乙说：“我等你。”",
    )[0]!;
    expect(directorPlanPrompt(ambiguous, "video")).not.toContain("秒");
    expect(ambiguous.lines).toHaveLength(2);
  });

  it("keeps unknown or invalid timing for review without inventing timing or dialogue", () => {
    for (const line_at of [-1, 3, 20, "稍后", null]) {
      const shot = parse([row({ line: "别走。", speaker: "甲", line_at })], "甲说：“别走。”")[0]!;
      expect(directorPlanPrompt(shot, "video")).not.toContain("秒");
      expect(shot.directorPlan!.segments[0]!.dialogueCues[0]!.timingStatus).toBe(
        line_at === null ? "unspecified" : "needs_review",
      );
    }
    const invented = parse([row({ line: "凭空增加的对白", line_at: 1 })], "甲说：“别走。”")[0]!;
    expect(invented.directorPlan!.segments[0]!.dialogueCues).toEqual([]);
    expect(directorPlanPrompt(invented, "video")).not.toContain("凭空");
  });

  it("retains merged segment order and local timing, with offsets only while durations remain valid", () => {
    const left = parse(
      [row({ line: "别走。", speaker: "甲", line_at: 0.5, source: "P101" })],
      "甲说：“别走。”",
    )[0]!;
    const right = parse(
      [
        row({
          id: "scene-1-shot-2",
          line: "我等你。",
          speaker: "甲",
          line_at: 0.2,
          purpose: "答应等待",
          positions: [{ name: "甲", position: "画右", depth: "后景", visible: "全身" }],
          source: "P102",
        }),
      ],
      "甲说：“我等你。”",
    )[0]!;
    const merged = mergeAdjacentShots([left, right], 1)[0]!;
    expect(merged.directorPlan!.segments.map((segment) => segment.sourceParagraphHints)).toEqual([
      ["P101"],
      ["P102"],
    ]);
    expect(merged.line).toBe("别走。\n我等你。");
    expect(directorPlanPrompt(merged, "video")).toContain("约3.2秒");
    expect(directorPlanPrompt(merged, "frame")).not.toContain("画右");
    const shortened = { ...merged, seconds: 4 };
    shortened.directorPlan = mergeDirectorPlans(left, right, shortened);
    expect(shortened.directorPlan!.timingStatus).toBe("needs_review");
    expect(directorPlanPrompt(shortened, "video")).not.toContain("秒");
    const stale = { ...left, picture: "用户另写画面" };
    const remerged = mergeAdjacentShots([stale, right], 1)[0]!;
    expect(directorPlanPrompt(remerged, "video")).toBe("");
  });

  it("disables stale plans after marked or unmarked manual edits", () => {
    const shot = parse([row({ line: "别走。", line_at: 0.2 })])[0]!;
    expect(directorPlanPrompt({ ...shot, picture: "手改" }, "frame")).toBe("");
    expect(directorPlanPrompt({ ...shot, seconds: 5 }, "video")).toContain("等待来信");
    expect(directorPlanPrompt({ ...shot, seconds: 5 }, "video")).not.toContain("秒");
    expect(directorPlanPrompt({ ...shot, userFields: ["promptZh"] }, "video")).toBe("");
    expect(directorPlanPrompt({ ...shot, sceneId: "scene-2" }, "video")).toBe("");
  });

  it("does not invent a new visible character or reuse timing after duration normalization", () => {
    const shot = parse(
      [
        row({
          seconds: 8,
          line: "别走。",
          speaker: "甲",
          line_at: 7,
          positions: [{ name: "未出场的人", position: "画右", depth: "后景", visible: "全身" }],
        }),
      ],
      "甲说：“别走。”",
    )[0]!;
    expect(shot.seconds).not.toBe(8);
    expect(shot.directorPlan!.timingStatus).toBe("needs_review");
    expect(shot.directorPlan!.segments[0]!.positions[0]!.name).toBe("未出场的人");
    expect(directorPlanPrompt(shot, "video")).not.toContain("约7秒");
    expect(directorPlanPrompt(shot, "video")).toContain("等待来信");
    const unchanged = parse([row({ positions: [{ name: "未出场的人", position: "画右" }] })])[0]!;
    expect(directorPlanPrompt(unchanged, "frame")).not.toContain("未出场的人");
  });

  it("keeps director spatial guidance through real acting and action enrichment before generation", () => {
    const shot = parse(
      [row({ line: "别走。", speaker: "甲", line_at: 0.4 })],
      "甲说：“别走。”",
    )[0]!;
    const performance = [
      {
        shot_id: shot.id,
        who: "甲",
        emotion: "焦急",
        face: ["皱眉"],
        eyes: "望着门",
        hands: "攥紧信",
        breath: "缓慢",
        voice: { tone: "低声", speed: "慢" },
      },
    ];
    const planned = applyPerformancePlans([shot], performance).shots[0]!;
    const note = assignPerformance(performance, [shot], ["甲"])[0]!;
    const acted = { ...planned, performance: note.performance, delivery: note.delivery };
    expect(acted.performance).not.toBe(shot.performance);
    expect(acted.delivery).not.toBe(shot.delivery);
    const actions = assignActionBeats([acted], shot.sceneId, [
      { shotId: shot.id, text: "甲低头看信" },
    ]);
    expect(actions.unassignedBeats).toEqual([]);
    const enriched = actions.shots[0]!;
    expect(enriched.action).not.toBe(shot.action);
    expect(motionPrompt(enriched)).toContain("等待来信");
    expect(motionPrompt(enriched)).toContain("甲，画左，前景，半身");
    expect(motionPrompt(enriched)).toContain("皱眉");
    expect(motionPrompt(enriched)).toContain("约0.4秒");
    expect(directorPlanPrompt({ ...enriched, picture: "手改画面" }, "video")).toBe("");
    expect(directorPlanPrompt({ ...enriched, userFields: ["action"] }, "video")).toBe("");
  });

  it("validates declared source membership in the unchanged scene through the real director request", async () => {
    const scene = parseWriterScenes(
      JSON.stringify({
        scenes: [{ title: "窗前", text: "甲等待", source_paragraphs: ["P101", "P102"] }],
      }),
      "[P101] 甲说：“别走。”\n[P102] 甲说：“我等你。”",
    )![0]!;
    const film = { ...blankFilm(), scenes: [scene] };
    const reply = JSON.stringify({
      scenes: [{ scene_id: scene.id, shots: [row({ source: ["P101", "P102", "P999"] })] }],
    });
    const request = vi.fn(async () => ({ text: reply, detail: "" }));
    const result = await requestDirectorDraft(
      directorRequestInput(film, scene.id, scene.text, scene.text),
      { request, current: () => true, progress: vi.fn() },
    );
    expect(result.shots![0]!.directorPlan!.segments[0]!.verifiedSourceParagraphIds).toEqual([
      "P101",
      "P102",
    ]);
    expect(result.shots![0]!.directorPlan!.segments[0]!.sourceParagraphHints).toContain("P999");
    const modified = { ...scene, text: "手改正文" };
    const unverified = parseDirectorShots(reply, scene.id, modified.text, [modified])![0]!;
    expect(unverified.directorPlan!.segments[0]!.verifiedSourceParagraphIds).toEqual([]);
    expect(
      parse([row({ source: "P101" })])[0]!.directorPlan!.segments[0]!.verifiedSourceParagraphIds,
    ).toEqual([]);
  });
});
