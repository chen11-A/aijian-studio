import { describe, expect, it, vi } from "vitest";
import { blankFilm, sampleFilm } from "../film/project";
import { runPipelineAgentAction, type PipelineAgentHost } from "./pipeline-agent-actions";
const ok = (value: unknown) => ({ text: JSON.stringify(value), detail: "" });
function host(value: unknown): PipelineAgentHost {
  return { valid: () => true, request: vi.fn(async () => ok(value)), notify: vi.fn() };
}
function sourceFilm() {
  const film = blankFilm();
  film.sourceText = "甲甲说：“别走。”\n警笛响起。";
  film.scenes[0]!.text = film.sourceText;
  return film;
}
describe("persistent pipeline text actions", () => {
  it("separates writer script and cast snapshots without losing source or dialogue", async () => {
    const film = sourceFilm();
    const script = await runPipelineAgentAction(
      film,
      { step: "writer", targetId: "script" },
      host({
        scenes: [
          {
            id: "scene-1",
            title: "雨夜",
            text: film.sourceText,
            source_paragraphs: ["P01", "P02"],
          },
        ],
      }),
    );
    expect(script.status).toBe("done");
    expect(script.film?.scenes.map((scene) => scene.text).join("\n")).toBe(film.sourceText);
    expect(film.characters).toEqual([]);
    const cast = await runPipelineAgentAction(
      script.film!,
      { step: "writer", targetId: "cast" },
      host({
        characters: [{ name: "甲甲", identity: "中年男子", gender: "男", ageBand: "中年" }],
        locations: [],
      }),
    );
    expect(cast.status).toBe("done");
    expect(cast.film?.characters[0]).toMatchObject({ name: "甲甲", gender: "男", ageBand: "中年" });
  });
  it("returns explicit failures without provider text or partial successful snapshots", async () => {
    const bad = host(null);
    bad.request = vi.fn(async () => {
      throw new Error("SECRET provider body");
    });
    const result = await runPipelineAgentAction(
      sourceFilm(),
      { step: "writer", targetId: "script" },
      bad,
    );
    expect(result).toMatchObject({ status: "failed", code: "WRITER_REQUEST_FAILED" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.film).toBeUndefined();
  });
  it("blocks a late answer after project or content changes", async () => {
    let valid = true;
    const options = host({});
    options.valid = () => valid;
    options.request = vi.fn(async () => {
      valid = false;
      return ok({ prompt_block_zh: "late" });
    });
    expect(
      await runPipelineAgentAction(sampleFilm(), { step: "art", targetId: "art" }, options),
    ).toEqual({ status: "blocked", code: "REQUEST_STALE" });
  });
  it("applies parsed art while preserving manual identities", async () => {
    const film = sampleFilm();
    film.characters[0]!.userFields = ["identity"];
    const result = await runPipelineAgentAction(
      film,
      { step: "art", targetId: "art" },
      host({
        prompt_block_zh: "水墨",
        identities: [{ name: film.characters[0]!.name, identity: "替换" }],
      }),
    );
    expect(result.film?.styleZh).toBe("水墨");
    expect(result.film?.characters[0]?.identity).toBe(film.characters[0]?.identity);
  });
  it("retries stalled director once and runs only director with complete dialogue and tail", async () => {
    const film = sourceFilm();
    const scene = film.scenes[0]!;
    const options = host({});
    options.request = vi
      .fn()
      .mockResolvedValueOnce({ text: null, detail: "", code: "TEXT_STALLED" })
      .mockResolvedValueOnce(
        ok({
          shots: [
            { picture: scene.text, lines: [{ speaker: "甲甲", text: "别走。" }], seconds: 4 },
          ],
        }),
      );
    const result = await runPipelineAgentAction(
      film,
      { step: "director", targetId: scene.id },
      options,
    );
    expect(result.status).toBe("done");
    expect(result.film?.scenes[0]?.coverage?.ok).toBe(true);
    expect(options.request).toHaveBeenCalledTimes(2);
    expect(vi.mocked(options.request).mock.calls.every((call) => call[0] === "director")).toBe(
      true,
    );
    expect(options.notify).toHaveBeenCalledWith(
      expect.objectContaining({ code: "STALL_RETRYING" }),
    );
  });
  it("retains incomplete coverage as blocked after one failed repair", async () => {
    const film = sourceFilm();
    const options = host({ shots: [{ picture: "门口", seconds: 3 }] });
    const result = await runPipelineAgentAction(
      film,
      { step: "director", targetId: film.scenes[0]!.id },
      options,
    );
    expect(result).toMatchObject({ status: "blocked", code: "COVERAGE_INCOMPLETE" });
    expect(result.film?.scenes[0]?.coverage?.ok).toBe(false);
    expect(options.request).toHaveBeenCalledTimes(2);
  });
  it("keeps idless fight beats unassigned and cannot attach fighting to a dialogue shot", async () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    const scene = film.scenes.find((scene) => scene.id === shot.sceneId)!;
    scene.text = "打斗，铁棍挥起。";
    shot.picture = "林晚问：报警？";
    shot.action = "";
    shot.line = "报警？";
    shot.lines = [];
    const options = host({
      shots: [{ shot_id: shot.id, nodes: [{ text: "挥铁棍" }] }],
      beats: [{ text: "肘击" }],
    });
    const result = await runPipelineAgentAction(
      film,
      { step: "action", targetId: scene.id },
      options,
    );
    expect(result).toMatchObject({ status: "blocked", code: "ACTION_UNASSIGNED" });
    expect(result.film?.shots.find((item) => item.id === shot.id)?.action).toBe("");
    expect(result.film?.unassignedBeats?.length).toBeGreaterThan(0);
    expect(vi.mocked(options.request).mock.calls[0]?.[1]).toContain(shot.id);
    const noFight = {
      ...film,
      scenes: film.scenes.map((item) => ({
        ...item,
        text: "书店打烊。",
        title: "书店",
        where: "书店",
        tags: [],
      })),
    };
    const skip = host({});
    await runPipelineAgentAction(noFight, { step: "action", targetId: scene.id }, skip);
    expect(skip.request).not.toHaveBeenCalled();
  });
  it("requires an explicit performance row for every target, then saves provenance separately", async () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    film.shots = [shot];
    expect(
      (
        await runPipelineAgentAction(
          film,
          { step: "performance", targetId: shot.sceneId },
          host([
            { id: "wrong", emotion: "冷静", face: ["皱眉"] },
            { id: "other", face: ["抬眉"] },
          ]),
        )
      ).code,
    ).toBe("PERFORMANCE_UNASSIGNED");
    const result = await runPipelineAgentAction(
      film,
      { step: "performance", targetId: shot.sceneId },
      host([{ id: shot.id, emotion: "冷静", face: ["皱眉"] }]),
    );
    expect(result.status).toBe("done");
    expect(result.film?.shots[0]?.performanceSource).toBe("agent:performance");
    expect(result.film?.shots[0]?.performancePlan?.scopeCues[0]?.face).toEqual(["皱眉"]);
    expect(result.film?.shots[0]?.performance).toContain("本镜表演：");
    expect(result.film?.shots[0]?.performance).not.toContain("来自表演");
  });
  it("requires bilingual prompts, restores identity locks, and leaves other shots intact", async () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    const result = await runPipelineAgentAction(
      film,
      { step: "prompter", targetId: shot.id },
      host({ keyframe: { prompt_zh: "近景。", prompt_en: "Close-up." } }),
    );
    expect(result.status).toBe("done");
    expect(result.film?.shots[0]?.promptEn).toBe("Close-up.");
    expect(result.film?.shots[0]?.promptZh).toContain(film.characters[0]!.identity);
    expect(result.film?.shots.slice(1)).toEqual(film.shots.slice(1));
    expect(
      (
        await runPipelineAgentAction(
          film,
          { step: "prompter", targetId: shot.id },
          host({ prompt_zh: "只有中文" }),
        )
      ).code,
    ).toBe("PROMPTER_PARSE_FAILED");
  });
  it("does not start requests when cancelled or the target is missing", async () => {
    const options = host({});
    const controller = new AbortController();
    controller.abort();
    options.signal = controller.signal;
    expect(
      (await runPipelineAgentAction(blankFilm(), { step: "art", targetId: "art" }, options)).status,
    ).toBe("blocked");
    expect(options.request).not.toHaveBeenCalled();
    expect(
      await runPipelineAgentAction(
        blankFilm(),
        { step: "director", targetId: "missing" },
        host({}),
      ),
    ).toMatchObject({ status: "blocked", code: "SCENE_NOT_FOUND" });
  });
});

it("keeps sanitized rejected combat separate from multiple ID-bound pipeline shots", async () => {
  const film = sampleFilm();
  const scene = film.scenes.find((item) => item.id === film.shots[0]!.sceneId)!;
  scene.tags = ["打斗"];
  const first = film.shots[0]!;
  const second = film.shots[1]!;
  second.sceneId = scene.id;
  first.picture = "林晚在书店说话。";
  first.action = "";
  first.userFields = [];
  second.picture = "沈砚打斗闪避。";
  second.action = "";
  second.userFields = [];
  const firstSfx = structuredClone(first.sound.sfx);
  const result = await runPipelineAgentAction(
    film,
    { step: "action", targetId: scene.id },
    host({
      beats: [
        { shot_id: second.id, text: "保留原文：肘击" },
        { shot_id: first.id, text: "保留原文：挥铁棍" },
      ],
    }),
  );
  expect(result.status).toBe("blocked");
  expect(result.code).toBe("ACTION_UNASSIGNED");
  expect(result.film?.shots.find((shot) => shot.id === first.id)?.action).toBe("");
  expect(result.film?.shots.find((shot) => shot.id === first.id)?.sound.sfx).toEqual(firstSfx);
  expect(result.film?.shots.find((shot) => shot.id === second.id)?.action).toBe("肘击");
  expect(result.film?.unassignedBeats).toContainEqual({ sceneId: scene.id, text: "挥铁棍" });
  expect(JSON.stringify(result.film)).not.toContain("保留原文：");
});

it.each([false, true])(
  "3JR-B01 accepts only a lossless in-budget compression (compressed=%s)",
  async (compressed) => {
    const film = blankFilm();
    const scene = film.scenes[0]!;
    const shots = Array.from({ length: 17 }, (_, i) => ({
      picture: `第${i + 1}段原文动作。`,
      seconds: 15,
    }));
    scene.text = shots.map((shot) => shot.picture).join("\n");
    const combined = [
      { ...shots[0]!, picture: shots[0]!.picture + shots[1]!.picture },
      ...shots.slice(2),
    ];
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok({ shots }))
      .mockResolvedValueOnce(ok({ shots: compressed ? combined : shots }));
    const result = await runPipelineAgentAction(
      film,
      { step: "director", targetId: scene.id },
      { request, valid: () => true },
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![2]).toContain("最多16镜");
    expect(request.mock.calls[1]![2]).toContain("最多16镜");
    expect(result.status).toBe(compressed ? "done" : "blocked");
    if (!compressed) {
      expect(result.code).toBe("DIRECTOR_OVER_BUDGET");
      expect(result.detail).toContain("第1镜、第2镜：合并后超过15秒");
      expect(result.detail).not.toMatch(/DURATION_|scene-.*shot/);
      expect(result.film!.scenes[0]!.shotBudget?.blockedPairs).toHaveLength(16);
    } else expect(result.film!.scenes[0]!.shotBudget).toMatchObject({ ok: true, blockedPairs: [] });
    expect(result.film!.shots).toHaveLength(compressed ? 16 : 17);
    expect(result.film!.scenes[0]!.coverage?.ok).toBe(true);
    const represented = result.film!.shots.map((shot) => shot.picture).join("\n");
    for (const shot of shots) expect(represented).toContain(shot.picture);
  },
);
