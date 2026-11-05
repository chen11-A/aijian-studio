import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import {
  assemblePipelineFilm,
  makePipelinePortraits,
  makePipelineStill,
  type PipelineMediaContext,
} from "./pipeline-media-actions";
import { requestShotStill, type requestStill } from "./workflow";
import type * as Workflow from "./workflow";
import { sceneLocationTargets } from "../film/location-reference";

vi.mock("./workflow", async (original) => ({
  ...(await original<typeof Workflow>()),
  requestShotStill: vi.fn(),
}));

function fixture() {
  let film = sampleFilm();
  film = {
    ...film,
    characters: [{ ...film.characters[0]!, identity: "青年女性，短发", portraits: [] }],
    shots: [{ ...film.shots[0]!, poster: "", stills: [], takes: [] }],
  };
  const context: PipelineMediaContext = {
    signal: new AbortController().signal,
    isCurrent: () => true,
    current: () => film,
    commitPartial: async (next) => {
      film = next;
    },
  };
  return { film, context };
}

it("creates and persists a missing scene location before its actual pipeline image request", async () => {
  const { film, context } = fixture();
  film.locations = [];
  const planned = sceneLocationTargets(film)[1]!;
  const generate = vi.fn(async () => {
    expect(context.current().locations).toHaveLength(1);
    expect(context.current().locations[0]!.sceneId).toBe(planned.sceneId);
    return { url: "/media/scene-reference.png", reason: "" };
  });
  const result = await makePipelinePortraits(film, `location:${planned.id}`, context, generate);
  expect(result).toMatchObject({ status: "done", code: "LOCATION_IMAGE_DONE" });
  expect(generate).toHaveBeenCalledOnce();
  expect(context.current().locations[0]).toMatchObject({
    id: planned.id,
    sceneId: planned.sceneId,
    referenceImage: "/media/scene-reference.png",
  });
});

it("persists exactly the requested portrait angle before completing its target", async () => {
  const { film, context } = fixture();
  let finish!: () => void;
  const durable = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const commit = context.commitPartial;
  context.commitPartial = vi.fn(async (next) => {
    await durable;
    await commit(next);
  });
  const generate = vi.fn(async () => ({ url: "https://example.invalid/front.png", reason: "" }));
  let completed = false;
  const pending = makePipelinePortraits(
    film,
    `${film.characters[0]!.id}@正面`,
    context,
    generate,
  ).then((result) => {
    completed = true;
    return result;
  });
  await vi.waitFor(() => expect(context.commitPartial).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  expect(context.current().characters[0]!.portraits).toEqual([]);
  finish();
  expect(await pending).toMatchObject({ status: "done" });
  expect(generate).toHaveBeenCalledOnce();
  expect(context.current().characters[0]!.portraits.map((item) => item.view)).toEqual(["正面"]);
  await makePipelinePortraits(
    context.current(),
    `${film.characters[0]!.id}@正面`,
    context,
    generate,
  );
  expect(generate).toHaveBeenCalledOnce();
});

it("passes the saved front anchor through the pipeline's real request adapter", async () => {
  const { film, context } = fixture();
  let count = 0;
  const generate = vi.fn<typeof requestStill>(async () => ({
    url: `/media/portrait-${++count}.png`,
    reason: "",
  }));
  expect(
    await makePipelinePortraits(film, `${film.characters[0]!.id}@脸部`, context, generate),
  ).toMatchObject({ status: "done" });
  expect(generate.mock.calls.map((call) => call[3])).toEqual([[], ["/media/portrait-1.png"]]);
  expect(context.current().characters[0]!.portraits.map((portrait) => portrait.view)).toEqual([
    "正面",
    "脸部",
  ]);
});

it("retains the portrait queue's single retry and never marks a failed angle done", async () => {
  const { film, context } = fixture();
  const generate = vi.fn(async () => ({ url: "", reason: "fixture refusal" }));
  expect(
    await makePipelinePortraits(film, `${film.characters[0]!.id}@脸部`, context, generate),
  ).toMatchObject({ status: "failed", code: "PORTRAIT_BATCH_PARTIAL" });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(context.current().characters[0]!.portraits).toEqual([]);
});

it("waits for the still's durable write before reporting success", async () => {
  const { film, context } = fixture();
  vi.mocked(requestShotStill).mockResolvedValueOnce({
    url: "https://example.invalid/still.png",
    reason: "",
    diagnostics: { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 },
  });
  let finish!: () => void;
  const durable = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const commit = context.commitPartial;
  context.commitPartial = vi.fn(async (next) => {
    await durable;
    await commit(next);
  });
  let completed = false;
  const pending = makePipelineStill(film, film.shots[0]!.id, context).then((result) => {
    completed = true;
    return result;
  });
  await vi.waitFor(() => expect(context.commitPartial).toHaveBeenCalledOnce());
  expect(completed).toBe(false);
  finish();
  expect(await pending).toMatchObject({ status: "done" });
  expect(context.current().shots[0]!.poster).toBe("https://example.invalid/still.png");
});

it("does not assemble a subset and still uses the audio path for a single clip", async () => {
  const { film, context } = fixture();
  const assemble = vi.fn(async () => ({ path: "/fixture/final.mp4", reason: "" }));
  expect(await assemblePipelineFilm(film, [], context, assemble)).toMatchObject({
    status: "blocked",
    code: "PIPELINE_MISSING_VIDEO",
  });
  expect(assemble).not.toHaveBeenCalled();
  expect(await assemblePipelineFilm(film, ["/fixture/shot.mp4"], context, assemble)).toMatchObject({
    status: "done",
    path: "/fixture/final.mp4",
  });
  expect(assemble).toHaveBeenCalledOnce();
});

it("keeps a partial assembly available without claiming that audio succeeded", async () => {
  const { film, context } = fixture();
  const assemble = vi.fn(async () => ({
    path: "/fixture/partial.mp4",
    reason: "fixture audio failure",
  }));
  const result = await assemblePipelineFilm(film, ["/fixture/shot.mp4"], context, assemble);
  expect(result).toMatchObject({ status: "needs-input", code: "ASSEMBLY_PARTIAL" });
  expect(result.film?.assemblyPath).toBe("/fixture/partial.mp4");
  expect(result.detail).not.toContain("fixture audio failure");
});

it("generates only the selected location through the actual bridge, with no images and the complete style", async () => {
  const { film, context } = fixture();
  film.styleZh = "完整画风：雨夜冷光，木质纹理，保留胶片颗粒。";
  film.locations = [
    { id: "one", name: "书店", prompt: "书架", ambience: "" },
    { id: "two", name: "街道", prompt: "路灯", ambience: "" },
  ];
  const generateFilmStill = vi.fn<
    NonNullable<NonNullable<typeof window.aijian>["generateFilmStill"]>
  >(async () => ({ path: "/media/street.png", reason: "" }));
  const previous = window.aijian;
  window.aijian = { ...previous, generateFilmStill } as typeof window.aijian;
  try {
    expect(await makePipelinePortraits(film, "location:two", context)).toMatchObject({
      status: "done",
      code: "LOCATION_IMAGE_DONE",
    });
    expect(generateFilmStill).toHaveBeenCalledOnce();
    expect(generateFilmStill.mock.calls[0]).toEqual([
      film.seriesId,
      expect.stringContaining(film.styleZh),
      film.aspectRatio,
      [],
    ]);
    expect(String(generateFilmStill.mock.calls[0]?.[1])).toContain("空镜，没有人物。街道。路灯");
    expect(context.current().locations[0]!.referenceImage).toBeUndefined();
    expect(context.current().locations[1]!.referenceImage).toContain("street.png");
    expect(await makePipelinePortraits(context.current(), "location:two", context)).toMatchObject({
      status: "done",
    });
    expect(generateFilmStill).toHaveBeenCalledOnce();
  } finally {
    window.aijian = previous;
  }
});

it("never completes failed or cancelled location generation", async () => {
  const { film, context } = fixture();
  film.locations = [{ id: "one", name: "书店", prompt: "书架", ambience: "" }];
  const refused = vi.fn(async () => ({ url: "", reason: "private refusal" }));
  expect(await makePipelinePortraits(film, "location:one", context, refused)).toMatchObject({
    status: "failed",
    code: "LOCATION_IMAGE_FAILED",
  });
  expect(refused).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  context.signal = controller.signal;
  const result = await makePipelinePortraits(film, "location:one", context, async () => {
    controller.abort();
    return { url: "/media/late.png", reason: "" };
  });
  expect(result).toMatchObject({ status: "uncertain", code: "PIPELINE_REQUEST_STALE" });
  expect(context.current().locations[0]!.referenceImage).toBeUndefined();
});
