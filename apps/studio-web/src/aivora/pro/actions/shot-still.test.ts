import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { taskSnapshot } from "../../film/task-progress";
import { generateShotStill, type ShotStillHost } from "./shot-still";

afterEach(() => {
  delete window.aijian;
  vi.useRealTimers();
});
function setup() {
  const base = sampleFilm();
  const shot = { ...base.shots[0]!, stills: [], poster: "/films/initial.png" };
  base.shots = [shot];
  let live: FilmProject | null = base;
  const host: ShotStillHost = {
    current: () => live,
    valid: () => true,
    apply: vi.fn((film: FilmProject) => {
      live = film;
    }),
    request: vi.fn<NonNullable<ShotStillHost["request"]>>().mockResolvedValue({
      url: "/films/new.png",
      reason: "画面已生成。",
      diagnostics: { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 },
    }),
  };
  return {
    base,
    shot,
    host,
    setLive: (film: FilmProject | null) => {
      live = film;
    },
  };
}

it("queues on the first invocation and marks completion after applying the image", async () => {
  const { base, shot, host } = setup();
  const pending = generateShotStill(base, shot, host);
  expect(taskSnapshot().tasks.find((task) => task.id === `still:${shot.id}`)?.status).toBe(
    "queued",
  );
  await pending;
  expect(host.current()?.shots[0]?.poster).toBe("/films/new.png");
  expect(taskSnapshot().tasks.find((task) => task.id === `still:${shot.id}`)?.status).toBe("done");
});

it("appends to current candidates and keeps an intervening poster selection", async () => {
  const { base, shot, host, setLive } = setup();
  const pending = generateShotStill(base, shot, host);
  setLive({
    ...base,
    title: "用户标题",
    shots: [
      {
        ...shot,
        poster: "/films/chosen.png",
        stills: [{ id: "other", prompt: "另一候选", url: "/films/chosen.png" }],
      },
    ],
  });
  const result = await pending;
  expect(host.current()?.title).toBe("用户标题");
  expect(host.current()?.shots[0]?.poster).toBe("/films/chosen.png");
  expect(host.current()?.shots[0]?.stills.map((still) => still.url)).toEqual([
    "/films/chosen.png",
    "/films/new.png",
  ]);
  expect(result.notice).toContain("保留了你选择的首帧");
});

it.each(["picture", "style", "scene", "reference"])(
  "rejects old output when %s input changes",
  async (change) => {
    const { base, shot, host, setLive } = setup();
    const pending = generateShotStill(base, shot, host);
    const changed = structuredClone(base);
    if (change === "picture") {
      changed.shots[0]!.picture = "用户改画面";
      changed.shots[0]!.userFields = ["picture"];
    }
    if (change === "style") changed.styleZh = "水墨";
    if (change === "scene") changed.shots[0]!.sceneId = "other-scene";
    if (change === "reference") {
      changed.characters[0]!.portraits = [
        { view: "正面", prompt: "", url: "https://example.com/new-face.png" },
      ];
      changed.shots[0]!.characters = [changed.characters[0]!.name];
    }
    setLive(changed);
    await expect(pending).rejects.toMatchObject({ code: "SHOT_STILL_INPUT_CHANGED" });
    expect(host.apply).not.toHaveBeenCalled();
    expect(taskSnapshot().tasks.find((task) => task.id === `still:${shot.id}`)?.status).toBe(
      "failed",
    );
  },
);

it.each(["project", "removed", "cancel"])(
  "rejects a late image after %s changes",
  async (change) => {
    const { base, shot, host, setLive } = setup();
    const pending = generateShotStill(base, shot, host);
    if (change === "project") setLive({ ...base, id: "other" });
    if (change === "removed") setLive({ ...base, shots: [] });
    if (change === "cancel") host.valid = () => false;
    await expect(pending).rejects.toThrow("WORK_STALE");
    expect(host.apply).not.toHaveBeenCalled();
  },
);

it("uses the existing request chain and forwards portrait references to desktop", async () => {
  const { base, shot, host } = setup();
  base.characters[0]!.portraits = [
    { view: "正面", prompt: "", url: "https://example.com/face.png" },
  ];
  shot.characters = [base.characters[0]!.name];
  const generateFilmStill = vi.fn(async () => ({ path: "/films/real-result.png", reason: "" }));
  window.aijian = { generateFilmStill } as unknown as Window["aijian"];
  delete host.request;
  await generateShotStill(base, shot, host);
  expect(generateFilmStill).toHaveBeenCalledWith(
    base.seriesId,
    expect.any(String),
    base.aspectRatio,
    expect.arrayContaining(["https://example.com/face.png"]),
  );
  expect(host.current()?.shots[0]?.poster).toContain("real-result.png");
});

it("reports failure without adding a candidate when no image is returned", async () => {
  const { base, shot, host } = setup();
  host.request = vi.fn<NonNullable<ShotStillHost["request"]>>().mockResolvedValue({
    url: "",
    reason: "denied",
    diagnostics: { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 },
  });
  await expect(generateShotStill(base, shot, host)).rejects.toThrow("denied");
  expect(host.apply).not.toHaveBeenCalled();
});

it("does not apply an image that arrives after the task timeout", async () => {
  vi.useFakeTimers();
  const { base, shot, host } = setup();
  let release!: (result: Awaited<ReturnType<NonNullable<ShotStillHost["request"]>>>) => void;
  host.request = vi.fn<NonNullable<ShotStillHost["request"]>>().mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = generateShotStill(base, shot, host);
  const failure = expect(pending).rejects.toThrow("TASK_TIMEOUT");
  await vi.advanceTimersByTimeAsync(300_000);
  await failure;
  release({
    url: "/films/late.png",
    reason: "",
    diagnostics: { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 },
  });
  await Promise.resolve();
  expect(host.apply).not.toHaveBeenCalled();
});

it("preserves a poster chosen while the provider request is already in flight", async () => {
  const { base, shot, host, setLive } = setup();
  let release!: (result: Awaited<ReturnType<NonNullable<ShotStillHost["request"]>>>) => void;
  host.request = vi.fn<NonNullable<ShotStillHost["request"]>>().mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = generateShotStill(base, shot, host);
  await vi.waitFor(() => expect(host.request).toHaveBeenCalledOnce());
  setLive({
    ...base,
    shots: [
      {
        ...shot,
        poster: "/films/user.png",
        stills: [{ id: "user", prompt: "chosen", url: "/films/user.png" }],
      },
    ],
  });
  release({
    url: "/films/provider.png",
    reason: "",
    diagnostics: { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 },
  });
  await pending;
  expect(host.current()?.shots[0]?.poster).toBe("/films/user.png");
  expect(host.current()?.shots[0]?.stills.map((item) => item.url)).toEqual([
    "/films/user.png",
    "/films/provider.png",
  ]);
});
