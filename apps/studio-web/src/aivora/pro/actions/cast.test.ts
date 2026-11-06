import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { castExtractionStory, extractAndMergeCast, type CastExtractionHost } from "./cast";

function fixture() {
  const film = sampleFilm();
  film.characters = [];
  film.locations = [];
  film.scenes = [{ ...film.scenes[0]!, text: "林晚说：你来晚了。", where: "" }];
  return film;
}
function setup(connected = true) {
  const base = fixture();
  let live: FilmProject | null = base;
  const host: CastExtractionHost = {
    connected,
    request: vi.fn<CastExtractionHost["request"]>().mockResolvedValue({
      text: JSON.stringify({
        characters: [{ name: "林国栋", identity: "父亲", gender: "male", age_band: "elder" }],
        locations: [{ name: "旧书店", prompt: "雨夜书店" }],
      }),
      detail: "",
    }),
    current: () => live,
    valid: vi.fn(() => true),
    noticeCurrent: vi.fn(() => true),
    apply: vi.fn((film: FilmProject) => {
      live = film;
    }),
    notice: vi.fn(),
  };
  return {
    base,
    host,
    setLive: (film: FilmProject | null) => {
      live = film;
    },
  };
}

it("extracts only missing cast/location sets and preserves source paragraphs", () => {
  const film = fixture();
  film.scenes.push({ ...film.scenes[0]!, id: "next", text: "刹车声传来。" });
  expect(castExtractionStory(film)).toBe("林晚说：你来晚了。\n刹车声传来。");
  film.scenes = [];
  expect(castExtractionStory(film)).toBeNull();
  const complete = sampleFilm();
  complete.locations = [{ id: "loc", name: "书店", prompt: "书店", ambience: "" }];
  expect(castExtractionStory(complete)).toBeNull();
});

it("applies offline cast synchronously before its promise resolves", async () => {
  const { base, host } = setup(false);
  const pending = extractAndMergeCast(base, castExtractionStory(base)!, host);
  expect(host.apply).toHaveBeenCalledOnce();
  expect(host.current()?.characters.map((person) => person.name)).toContain("林晚");
  expect(host.request).not.toHaveBeenCalled();
  await pending;
});

it("merges the actual response into current edits and preserves explicit voice traits", async () => {
  const { base, host, setLive } = setup();
  const pending = extractAndMergeCast(base, castExtractionStory(base)!, host);
  const edited = { ...base, title: "手改标题", shots: [...base.shots] };
  setLive(edited);
  await pending;
  expect(host.request).toHaveBeenCalledWith(
    "writer",
    "林晚说：你来晚了。",
    expect.stringContaining("age_band"),
  );
  expect(host.current()).toMatchObject({
    title: "手改标题",
    characters: [{ name: "林国栋", gender: "男", ageBand: "老年" }],
  });
  expect(host.current()?.shots).toBe(edited.shots);
  expect(host.current()?.locations[0]?.name).toBe("旧书店");
  expect(base.characters).toEqual([]);
});

it.each(["epoch", "project", "closed"])("discards late cast after %s changes", async (change) => {
  const { base, host, setLive } = setup();
  const pending = extractAndMergeCast(base, castExtractionStory(base)!, host);
  if (change === "epoch") host.valid = () => false;
  if (change === "project") setLive({ ...base, id: "other" });
  if (change === "closed") setLive(null);
  await pending;
  expect(host.apply).not.toHaveBeenCalled();
  expect(host.notice).not.toHaveBeenCalled();
});

it.each(["invalid", "empty", "rejected"])(
  "never substitutes guessed cast for a %s model reply",
  async (kind) => {
    const { base, host } = setup();
    host.request =
      kind === "rejected"
        ? vi.fn<CastExtractionHost["request"]>().mockRejectedValue(new Error("provider failed"))
        : vi.fn<CastExtractionHost["request"]>().mockResolvedValue({
            text: kind === "empty" ? '{"characters":[],"locations":[]}' : "unstructured",
            detail: "",
          });
    await extractAndMergeCast(base, castExtractionStory(base)!, host);
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.current()?.characters).toEqual([]);
    expect(host.notice).toHaveBeenCalledWith(
      kind === "rejected" ? "人物提取失败，可以重试。" : "没有认出人物和场景，没有写入猜测。",
    );
  },
);

it("does not replace a newer notice with a failed cast response", async () => {
  const { base, host } = setup();
  host.request = vi
    .fn<CastExtractionHost["request"]>()
    .mockResolvedValue({ text: null, detail: "failure" });
  const pending = extractAndMergeCast(base, castExtractionStory(base)!, host);
  host.noticeCurrent = () => false;
  await pending;
  expect(host.notice).not.toHaveBeenCalled();
  expect(host.apply).not.toHaveBeenCalled();
});
