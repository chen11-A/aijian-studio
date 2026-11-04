import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { planArtDraft, type ArtActionHost } from "./art";

function reply(film = sampleFilm()) {
  return JSON.stringify({
    prompt_block_zh: "低饱和雨夜电影感",
    identities: [{ name: film.characters[0]!.name, identity: "黑色长衣，短发。" }],
    locations: [{ name: "书店", prompt: "旧书架", ambience: "雨声" }],
    props: [{ name: "照片", note: "旧合影" }],
  });
}

it("requests the same art context and returns a draft without applying or mutating the film", async () => {
  const film = sampleFilm();
  const before = structuredClone(film);
  const request = vi
    .fn<ArtActionHost["request"]>()
    .mockResolvedValue({ text: reply(film), detail: "" });
  const result = await planArtDraft(film, { request, current: () => true });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "art",
    `画风：${film.styleZh}\n人物：${film.characters.map((person) => person.name).join("、")}`,
    "写出画风、每人一句固定外貌、场景和道具。只输出 JSON。",
  );
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected art draft");
  expect(result.draft.styleZh).toBe("低饱和雨夜电影感");
  expect(result.draft.characters[0]!.identity).toBe("黑色长衣，短发。");
  expect(result.draft.locations.some((location) => location.name === "书店")).toBe(true);
  expect(result.draft.props.some((prop) => prop.name === "照片")).toBe(true);
  expect(result.lines).toContain("画风：低饱和雨夜电影感");
  expect(film).toEqual(before);
});

it("retains user-locked character appearance when producing the draft", async () => {
  const film = sampleFilm();
  film.characters[0]!.userFields = ["identity"];
  const identity = film.characters[0]!.identity;
  const result = await planArtDraft(film, {
    request: async () => ({ text: reply(film), detail: "" }),
    current: () => true,
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.draft.characters[0]!.identity).toBe(identity);
});

it.each(["not JSON", "{}", "[]"])(
  "rejects malformed/empty model content (%s) with the existing notice",
  async (text) => {
    expect(
      await planArtDraft(sampleFilm(), {
        request: async () => ({ text, detail: "ignored" }),
        current: () => true,
      }),
    ).toEqual({ status: "rejected", notice: "美术没有按格式返回，这次没有改作品。" });
  },
);

it("preserves the provider failure notice without inventing an offline art draft", async () => {
  expect(
    await planArtDraft(sampleFilm(), {
      request: async () => ({ text: null, detail: "需要重新登录。" }),
      current: () => true,
    }),
  ).toEqual({ status: "rejected", notice: "需要重新登录。 这次没有改作品。" });
});

it("discards a late reply after the turn or assistant scope changes", async () => {
  const film = sampleFilm();
  let current = true;
  let finish!: (result: { text: string; detail: string }) => void;
  const request = vi.fn<ArtActionHost["request"]>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = planArtDraft(film, { request, current: () => current });
  current = false;
  finish({ text: reply(film), detail: "" });
  expect(await pending).toEqual({ status: "stale" });
});

it("keeps request exceptions visible to the existing foreground error boundary", async () => {
  const error = new Error("request failed");
  await expect(
    planArtDraft(sampleFilm(), {
      request: async () => {
        throw error;
      },
      current: () => true,
    }),
  ).rejects.toBe(error);
});
