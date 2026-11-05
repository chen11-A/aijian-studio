import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { planWriterDraft, writerDraftInput } from "./writer";
import type { AgentReply } from "../workflow";

type Request = (agent: "writer", context: string, instruction: string) => Promise<AgentReply>;
function fixture() {
  const film = sampleFilm();
  film.scenes = [{ ...film.scenes[0]!, text: "雨夜书店。\n林晚说：“你来晚了。”\n刹车声传来。" }];
  return film;
}
it("retains original paragraph context and ending while returning scenes only as a proposal", async () => {
  const film = fixture();
  const before = structuredClone(film);
  const input = writerDraftInput(film, "write", "请保留所有台词");
  const request = vi.fn<Request>().mockResolvedValue({
    text: JSON.stringify({ scenes: [{ title: "雨夜书店", text: "林晚说：“你来晚了。”" }] }),
    detail: "",
  });
  const result = await planWriterDraft(input, { connected: true, request });
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]![0]).toBe("writer");
  expect(request.mock.calls[0]![1]).toContain("原文段落：");
  expect(request.mock.calls[0]![1]).toContain("刹车声传来。");
  expect(request.mock.calls[0]![2]).toBe(
    "写成短剧，按地点和时间分场，保留全部台词与结尾。请保留所有台词",
  );
  expect(result.event).toBe("scenes");
  expect(result.scenes?.map((scene) => scene.text).join("\n")).toContain("你来晚了。");
  expect(result.scenes?.map((scene) => scene.text).join("\n")).toContain("刹车声传来。");
  expect(film).toEqual(before);
});

it("keeps the existing story/title/chat fallbacks and adapt instruction", async () => {
  const film = fixture();
  film.scenes = [];
  const input = writerDraftInput(film, "adapt", "  一个雨夜的故事  ");
  expect(input).toMatchObject({
    story: film.title,
    idea: "一个雨夜的故事",
    asked: "一个雨夜的故事",
    chat: "一个雨夜的故事",
  });
  expect(writerDraftInput(film, "write", "").asked).toBe("按地点和时间把现有剧本分成几场");
  const request = vi.fn<Request>().mockResolvedValue({ text: null, detail: "" });
  await planWriterDraft(input, { connected: false, request });
  expect(request.mock.calls[0]![2]).toContain("把原文改成短剧");
});

it.each(["write", "adapt"] as const)(
  "retains the %s offline proposal when no model text is available",
  async (kind) => {
    const request = vi.fn<Request>().mockResolvedValue({ text: null, detail: "offline" });
    const result = await planWriterDraft(writerDraftInput(fixture(), kind, ""), {
      connected: false,
      request,
    });
    expect(result.scenes?.length).toBeGreaterThan(0);
    expect(result.event).toBe("offline");
    expect(result.notice).toContain("点「放入剧本」才会写入");
    expect(request).toHaveBeenCalledOnce();
  },
);

it.each(["malformed", "empty"])(
  "rejects %s connected output without replacing the script",
  async (kind) => {
    const result = await planWriterDraft(writerDraftInput(fixture(), "write", ""), {
      connected: true,
      request: async () => ({
        text: kind === "malformed" ? "not JSON" : null,
        detail: "模型未返回",
      }),
    });
    expect(result.scenes).toBeNull();
    expect(result.event).toBe("rejected");
    expect(result.notice).toContain("这次没有改剧本");
  },
);

it("preserves the request-echo rejection", async () => {
  const input = writerDraftInput(fixture(), "write", "请把现有剧本分成场次");
  // Empty source is intentional: the parser must not replace this model echo with source slices.
  input.story = "";
  const result = await planWriterDraft(input, {
    connected: true,
    request: async () => ({
      text: JSON.stringify({ scenes: [{ title: "请求", text: input.asked }] }),
      detail: "",
    }),
  });
  expect(result.scenes).toBeNull();
  expect(result.notice).toBe("模型把请求原文当成了结果，这次没有改剧本。");
});

it("converts request exceptions into the existing failure result for the workspace finally", async () => {
  const result = await planWriterDraft(writerDraftInput(fixture(), "write", ""), {
    connected: true,
    request: async () => {
      throw new Error("network");
    },
  });
  expect(result).toEqual({
    scenes: null,
    notice: "编剧请求失败，没有改动剧本，可以重试。",
    event: "rejected",
  });
});
