import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { applyDirectorPlan } from "../director-workflow";
import { buildLegacyStoryboard, type LegacyStoryboardHost } from "./legacy-storyboard";

function setup() {
  const base = sampleFilm();
  base.scenes = [{ ...base.scenes[0]!, title: "书店", text: "林晚说：你来晚了。", where: "书店" }];
  base.shots = [];
  let live: FilmProject | null = base;
  const host: LegacyStoryboardHost = {
    current: () => live,
    valid: () => true,
    request: vi.fn<LegacyStoryboardHost["request"]>().mockImplementation(async (agent) => ({
      text:
        agent === "writer"
          ? JSON.stringify({
              scenes: [{ title: "书店", place: "书店", text: "林晚说：你来晚了。" }],
            })
          : JSON.stringify({
              shots: [{ picture: "林晚站在书店", line: "你来晚了。", seconds: 3 }],
            }),
      detail: "",
    })),
    apply: vi.fn((film: FilmProject) => {
      live = film;
    }),
    fillCast: vi.fn<LegacyStoryboardHost["fillCast"]>().mockResolvedValue(),
    enrich: vi
      .fn<LegacyStoryboardHost["enrich"]>()
      .mockImplementation(async (_film, _id, shots) => shots),
    merge: (film, sceneId, shots) => applyDirectorPlan(film, shots, sceneId),
    progress: vi.fn(),
    notify: vi.fn(),
  };
  return {
    base,
    host,
    setLive: (film: FilmProject | null) => {
      live = film;
    },
  };
}

it("writes and directs through existing parsing and merge without requesting media", async () => {
  const { base, host } = setup();
  const result = await buildLegacyStoryboard(base, host);
  expect(result.kind).toBe("ready");
  expect(host.request).toHaveBeenCalledWith(
    "writer",
    `画风：${base.styleZh}`,
    expect.stringContaining("写成短剧"),
  );
  expect(host.fillCast).toHaveBeenCalledOnce();
  expect(host.enrich).toHaveBeenCalled();
  expect(host.current()?.shots.length).toBeGreaterThan(0);
  expect(host.current()?.shots.map((shot) => shot.no)).toEqual(
    host.current()?.shots.map((_shot, index) => index + 1),
  );
  expect(
    vi
      .mocked(host.request)
      .mock.calls.every(([agent]) => agent === "writer" || agent === "director"),
  ).toBe(true);
});

it.each(["writer", "director", "enrich"])(
  "preserves edits made during %s instead of applying a stale result",
  async (step) => {
    const { base, host, setLive } = setup();
    const original = host.request;
    host.request = vi.fn<LegacyStoryboardHost["request"]>().mockImplementation(async (...args) => {
      if (args[0] === step) setLive({ ...host.current()!, title: "用户手改" });
      return original(...args);
    });
    if (step === "enrich")
      host.enrich = vi
        .fn<LegacyStoryboardHost["enrich"]>()
        .mockImplementation(async (_film, _id, shots) => {
          setLive({ ...host.current()!, title: "用户手改" });
          return shots;
        });
    const result = await buildLegacyStoryboard(base, host);
    expect(result).toMatchObject({
      kind: "stopped",
      text: expect.stringContaining("保留了你的修改"),
    });
    expect(host.current()?.title).toBe("用户手改");
    expect(host.current()?.shots).toEqual([]);
    if (step === "director") expect(host.enrich).not.toHaveBeenCalled();
  },
);

it("stops silently on project switch before director enrichment", async () => {
  const { base, host, setLive } = setup();
  const original = host.request;
  host.request = vi.fn<LegacyStoryboardHost["request"]>().mockImplementation(async (...args) => {
    if (args[0] === "director") setLive({ ...base, id: "other" });
    return original(...args);
  });
  expect(await buildLegacyStoryboard(base, host)).toEqual({ kind: "stale" });
  expect(host.enrich).not.toHaveBeenCalled();
  expect(host.current()?.id).toBe("other");
});

it("takes the latest cast result and retains unrelated edits merged during extraction", async () => {
  const { base, host, setLive } = setup();
  host.fillCast = vi.fn<LegacyStoryboardHost["fillCast"]>().mockImplementation(async (film) => {
    setLive({
      ...film,
      characters: film.characters.map((person) => ({ ...person, identity: "手改人物外貌" })),
    });
  });
  expect((await buildLegacyStoryboard(base, host)).kind).toBe("ready");
  const director = vi.mocked(host.request).mock.calls.find(([agent]) => agent === "director");
  expect(director?.[1]).toContain("手改人物外貌");
  expect(host.current()?.characters[0]?.identity).toBe("手改人物外貌");
});

it("stops when source scenes change during cast extraction", async () => {
  const { base, host, setLive } = setup();
  host.fillCast = vi.fn<LegacyStoryboardHost["fillCast"]>().mockImplementation(async (film) => {
    setLive({ ...film, scenes: film.scenes.map((scene) => ({ ...scene, text: "用户新原文" })) });
  });
  expect((await buildLegacyStoryboard(base, host)).kind).toBe("stopped");
  expect(host.enrich).not.toHaveBeenCalled();
  expect(host.current()?.scenes[0]?.text).toBe("用户新原文");
});

it("accepts equivalent object copies and save metadata changes", async () => {
  const { base, host, setLive } = setup();
  const original = host.request;
  host.request = vi.fn<LegacyStoryboardHost["request"]>().mockImplementation(async (...args) => {
    setLive({
      ...structuredClone(host.current()!),
      directory: "/saved/work",
      backendProjectId: "billing-created-during-request",
    });
    return original(...args);
  });
  expect((await buildLegacyStoryboard(base, host)).kind).toBe("ready");
});

it.each(["writer", "director"])(
  "stops on malformed %s without offline substitution",
  async (agent) => {
    const { base, host } = setup();
    const original = host.request;
    host.request = vi
      .fn<LegacyStoryboardHost["request"]>()
      .mockImplementation(async (...args) =>
        args[0] === agent ? { text: "invalid", detail: "格式失败" } : original(...args),
      );
    expect(await buildLegacyStoryboard(base, host)).toEqual({ kind: "stopped", text: "格式失败" });
    expect(host.current()?.shots).toEqual([]);
  },
);

it("propagates unexpected request failures to the workspace foreground cleanup", async () => {
  const { base, host } = setup();
  const failure = new Error("request failed");
  host.request = vi.fn<LegacyStoryboardHost["request"]>().mockRejectedValue(failure);
  await expect(buildLegacyStoryboard(base, host)).rejects.toBe(failure);
  expect(host.apply).not.toHaveBeenCalled();
});

it("sends verified P101 source prose and structured dialogue through the legacy director request", async () => {
  const { base, host } = setup();
  base.scenes = [{ ...base.scenes[0]!, text: "[P101] 甲说：“别走。”\n[P102] 门关了。" }];
  host.request = vi.fn<LegacyStoryboardHost["request"]>().mockImplementation(async (agent) => ({
    text:
      agent === "writer"
        ? JSON.stringify({
            scenes: [
              {
                title: "书店",
                place: "书店",
                text: "甲说话，门关了。",
                source_paragraphs: ["P101", "P102"],
                elements: [
                  {
                    type: "dialogue",
                    speaker: "甲",
                    kind: "画外音",
                    line: "别走。",
                    source: "P101",
                  },
                ],
              },
            ],
          })
        : null,
    detail: "stop after inspecting the actual director request",
  }));
  await buildLegacyStoryboard(base, host);
  const request = vi.mocked(host.request).mock.calls.find(([agent]) => agent === "director");
  expect(request).toBeDefined();
  expect(request![1]).toContain("[P101] 甲说：“别走。”");
  expect(request![1]).toContain("[P102] 门关了。");
  expect(request![1]).not.toContain("[P01]");
  expect(request![1]).toContain('"speaker":"甲"');
  expect(request![1]).toContain('"kind":"画外音"');
  expect(request![1]).toContain('"sourceParagraphIds":["P101"]');
});
