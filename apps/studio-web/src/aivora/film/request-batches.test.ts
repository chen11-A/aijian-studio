import { describe, expect, it, vi } from "vitest";
import { parseWriterScenes } from "./operations";
import {
  agentRequestBatches,
  combineAgentBatchReplies,
  completeAgentBatched,
  splitSourceText,
  TEXT_REQUEST_LIMIT,
} from "./request-batches";

const novel =
  Array.from({ length: 100 }, (_, i) =>
    `[P${String(i + 1).padStart(2, "0")}] ${String(i).padStart(3, "0")}：雨夜来客走进书店。`.padEnd(
      74,
      "雨",
    ),
  ).join("\n") + "\n";

describe("lossless subscription request batches", () => {
  it.each(["writer", "director"] as const)(
    "sends a 7500-character novel once through %s",
    async (agent) => {
      expect(novel.length).toBe(7500);
      const context = `画风：写实\n场次 id：scene-7\n原文段落：\n${novel}`;
      const batches = agentRequestBatches(agent, context, "按原文处理，逐句保留台词。");
      expect(batches.length).toBeGreaterThan(1);
      expect(batches.map((batch) => batch.source).join("")).toBe(novel);
      expect(batches.every((batch) => batch.text.length <= TEXT_REQUEST_LIMIT)).toBe(true);
      const execute = vi.fn(async (text: string) => {
        const ids = [...text.matchAll(/\[(P\d+)\]/g)].map((match) => match[1]);
        return {
          text: JSON.stringify(
            agent === "writer"
              ? { scenes: [{ source_paragraphs: ids, title: ids[0] }] }
              : { shots: ids.map((id) => ({ id, picture: id, line: `${id}。还没说完。` })) },
          ),
          detail: "",
        };
      });
      const reply = await completeAgentBatched(
        agent,
        context,
        "按原文处理，逐句保留台词。",
        execute,
      );
      const parsed = JSON.parse(reply.text ?? "null");
      const ids =
        agent === "writer"
          ? parsed.scenes.flatMap(
              (scene: { source_paragraphs: string[] }) => scene.source_paragraphs,
            )
          : parsed.shots.map((shot: { id: string }) => shot.id);
      expect(ids).toEqual(
        Array.from({ length: 100 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
      );
      expect(execute).toHaveBeenCalledTimes(batches.length);
    },
  );

  it("preserves one huge paragraph, punctuation, whitespace and surrogate pairs", () => {
    const source = `  “${"雨🌧️".repeat(25_000)}。第二句还在同一对引号中。”\n\n尾段。  `;
    const chunks = splitSourceText(source, 4000);
    expect(chunks.join("")).toBe(source);
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
    expect(chunks.every((chunk) => !/[\ud800-\udbff]$/.test(chunk))).toBe(true);
    expect(() => splitSourceText("test", 0)).toThrow();
    expect(splitSourceText("", 3)).toEqual([]);
  });

  it("keeps a split long paragraph assigned and retains its original ending after parsing", async () => {
    const source = `雨夜书店。${"雨".repeat(16000)}林晚说：“第一句话。第二句话不能丢。”警笛远去。`;
    const context = `原文段落：\n[P01] ${source}`;
    const batches = agentRequestBatches("writer", context, "按段分场");
    expect(batches.slice(1).every((batch) => batch.text.includes("继续原段 [P01]"))).toBe(true);
    const reply = await completeAgentBatched("writer", context, "按段分场", async () => ({
      text: JSON.stringify({
        scenes: [{ title: "书店", place: "书店", text: "本批片段", source_paragraphs: ["P01"] }],
      }),
      detail: "",
    }));
    const parsed = parseWriterScenes(reply.text ?? "", source);
    expect(parsed?.map((scene) => scene.text).join("")).toContain(source);
    expect(parsed?.[0]?.paragraphCoverage?.duplicateParagraphs).toContain("P01");
    expect(parsed?.[0]?.paragraphCoverage?.ok).toBe(false);
  });

  it("combines cast names and preserves later fields without manufacturing conflicting traits", () => {
    expect(
      JSON.parse(
        combineAgentBatchReplies("writer", [
          '{"characters":[{"name":"林晚","identity":"短发","gender":"女"}],"locations":[]}',
          '{"characters":[{"name":"林晚","identity":"风衣","gender":"女"},{"name":"周烈"}],"locations":[{"name":"码头"}]}',
        ]) ?? "null",
      ),
    ).toEqual({
      characters: [{ name: "林晚", identity: "短发\n风衣", gender: "女" }, { name: "周烈" }],
      locations: [{ name: "码头" }],
    });
    expect(
      combineAgentBatchReplies("writer", [
        '{"characters":[{"name":"林晚","gender":"女"}]}',
        '{"characters":[{"name":"林晚","gender":"男"}]}',
      ]),
    ).toBeNull();
    expect(
      combineAgentBatchReplies("action", [
        '{"beats":[{"shot_id":"a"}]}',
        '{"beats":[{"shot_id":"b"}]}',
      ]),
    ).toBe('{"beats":[{"shot_id":"a"},{"shot_id":"b"}]}');
  });

  it("retains explicit flat director scene ids across batches", () => {
    expect(
      JSON.parse(
        combineAgentBatchReplies(
          "director",
          [
            '{"scene_id":"scene-1","shots":[{"id":"a"}]}',
            '{"scene_id":"scene-2","shots":[{"id":"b"}]}',
          ],
          "scene-1",
        ) ?? "null",
      ),
    ).toEqual({
      scenes: [
        { scene_id: "scene-1", shots: [{ id: "a" }] },
        { scene_id: "scene-2", shots: [{ id: "b" }] },
      ],
    });
  });

  it("preserves oversized cast/context and user instructions instead of rejecting them", () => {
    const context = "人物：" + "外貌".repeat(9000);
    const user = "要求".repeat(6000);
    const batches = agentRequestBatches("writer", context, user);
    expect(batches.map((batch) => batch.source).join("")).toBe(`${context}\n\n用户要求：\n${user}`);
    expect(batches.every((batch) => batch.text.length <= TEXT_REQUEST_LIMIT)).toBe(true);
  });

  it("does not publish earlier partial replies when a later request fails", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"scenes":[{}]}', detail: "" })
      .mockResolvedValue({ text: null, detail: "请重新登录。", code: "REAUTH_REQUIRED" });
    expect(await completeAgentBatched("writer", novel.repeat(3), "分场", execute)).toEqual({
      text: null,
      detail: "请重新登录。",
      code: "REAUTH_REQUIRED",
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete batch schemas without dropping the final batch", async () => {
    const execute = vi.fn().mockResolvedValue({ text: "这次没有生成", detail: "" });
    expect(await completeAgentBatched("director", novel, "拆镜", execute)).toMatchObject({
      text: null,
      code: "BATCH_RESPONSE_INVALID",
    });
    expect(combineAgentBatchReplies("writer", ['{"scenes":[{}]}', "null"])).toBeNull();
    expect(combineAgentBatchReplies("director", ['{"shots":[]}', "null"])).toBeNull();
    expect(combineAgentBatchReplies("action", ["{}", "{}"])).toBeNull();
  });

  it("keeps mixed scene and flat director responses on the requested scene", () => {
    expect(
      JSON.parse(
        combineAgentBatchReplies(
          "director",
          [
            '{"scenes":[{"scene_id":"scene-7","shots":[{"id":"a"}]}]}',
            '{"shots":[{"id":"b"}]}',
            '[{"id":"c"}]',
          ],
          "scene-7",
        ) ?? "null",
      ),
    ).toEqual({
      scenes: [
        { scene_id: "scene-7", shots: [{ id: "a" }] },
        { scene_id: "scene-7", shots: [{ id: "b" }] },
        { scene_id: "scene-7", shots: [{ id: "c" }] },
      ],
    });
    expect(combineAgentBatchReplies("writer", ['[{"title":"A"}]', '[{"title":"B"}]'])).toBe(
      '{"scenes":[{"title":"A"},{"title":"B"}]}',
    );
  });

  it("leaves a short request and reply untouched", async () => {
    const execute = vi.fn().mockResolvedValue({ text: "plain reply", detail: "" });
    expect(await completeAgentBatched("writer", "short story", "分场", execute)).toEqual({
      text: "plain reply",
      detail: "",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
