import { afterEach, expect, it, vi } from "vitest";
import { createGenerationExecutionSession } from "./actions/generation-execution";
import { sampleFilm, type FilmProject } from "../film/project";
import {
  ensureContinuityFrame,
  type ContinuityFrameHost,
  type ContinuityShot,
} from "./continuity-frame";

afterEach(() => {
  delete window.aijian;
});
function setup() {
  let film = sampleFilm();
  const source = {
    ...film.shots[0]!,
    id: "previous",
    selectedTakeId: "take-1",
    takes: [
      {
        id: "take-1",
        shotId: "previous",
        index: 1,
        status: "done" as const,
        videoPath: "/story/one.mp4",
        videoUrl: "",
        stillUrl: "",
        prompt: "",
        reason: "",
        createdAt: "",
      },
    ],
  };
  const shot: ContinuityShot = {
    ...film.shots[1]!,
    id: "current",
    sceneId: source.sceneId,
    poster: "/media/preview.png",
    continuityFromShotId: source.id,
  };
  film = { ...film, shots: [source, shot] };
  const extract = vi.fn<NonNullable<ContinuityFrameHost["extract"]>>(async () => ({
    path: "/films/tail.png",
    sourceVideoPath: "/story/one.mp4",
  }));
  const apply = vi.fn<ContinuityFrameHost["apply"]>(async (next) => {
    film = next;
  });
  const host: ContinuityFrameHost = { current: () => film, valid: () => true, apply, extract };
  return {
    host,
    extract,
    apply,
    shot: () => film.shots[1] as ContinuityShot,
    film: () => film,
    edit: (next: FilmProject) => {
      film = next;
    },
  };
}

it("uses the local extraction bridge and records the actual frame and selected-take provenance", async () => {
  const env = setup();
  const generateFilmStill = vi.fn();
  const createStoryFilm = vi.fn();
  window.aijian = {
    extractFilmLastFrame: env.extract,
    generateFilmStill,
    createStoryFilm,
  } as unknown as Window["aijian"];
  delete env.host.extract;
  const next = await ensureContinuityFrame(env.film(), env.shot(), env.host);
  expect(env.extract).toHaveBeenCalledExactlyOnceWith(env.film().seriesId, "/story/one.mp4");
  expect(next.poster).toBe("/films/tail.png");
  expect(next.continuityFrame).toEqual({
    sourceShotId: "previous",
    sourceTakeId: "take-1",
    sourceVideoPath: "/story/one.mp4",
    path: "/films/tail.png",
  });
  expect(env.apply).toHaveBeenCalledOnce();
  expect(generateFilmStill).not.toHaveBeenCalled();
  expect(createStoryFilm).not.toHaveBeenCalled();
});

it("does nothing without an explicit continuity mark", async () => {
  const env = setup();
  delete env.shot().continuityFromShotId;
  expect(await ensureContinuityFrame(env.film(), env.shot(), env.host)).toBe(env.shot());
  expect(env.extract).not.toHaveBeenCalled();
  expect(env.apply).not.toHaveBeenCalled();
});

it("reuses exact provenance but extracts again for a different selected previous take", async () => {
  const env = setup();
  await ensureContinuityFrame(env.film(), env.shot(), env.host);
  await ensureContinuityFrame(env.film(), env.shot(), env.host);
  expect(env.extract).toHaveBeenCalledOnce();
  env.edit({
    ...env.film(),
    shots: env.film().shots.map((shot) =>
      shot.id === "previous"
        ? {
            ...shot,
            selectedTakeId: "take-2",
            takes: [
              ...shot.takes,
              { ...shot.takes[0]!, id: "take-2", videoPath: "/story/two.mp4" },
            ],
          }
        : shot,
    ),
  });
  env.extract.mockResolvedValueOnce({
    path: "/films/tail-two.png",
    sourceVideoPath: "/story/two.mp4",
  });
  const next = await ensureContinuityFrame(env.film(), env.shot(), env.host);
  expect(env.extract).toHaveBeenCalledTimes(2);
  expect(next.continuityFrame?.sourceTakeId).toBe("take-2");
  expect(next.poster).toBe("/films/tail-two.png");
});

it.each(["running", "no-selection", "remote"])(
  "blocks an unavailable previous video (%s) without inventing a still",
  async (mode) => {
    const env = setup();
    const previous = env.film().shots[0]!;
    if (mode === "running") previous.takes[0]!.status = "running";
    if (mode === "no-selection") previous.selectedTakeId = "";
    if (mode === "remote") previous.takes[0]!.videoPath = "https://example.com/video.mp4";
    await expect(ensureContinuityFrame(env.film(), env.shot(), env.host)).rejects.toMatchObject({
      code: "CONTINUITY_SOURCE_NOT_READY",
    });
    expect(env.extract).not.toHaveBeenCalled();
    expect(env.apply).not.toHaveBeenCalled();
  },
);

it.each(["cross-scene", "not-adjacent"])(
  "rejects invalid source relationships (%s)",
  async (mode) => {
    const env = setup();
    if (mode === "cross-scene") env.shot().sceneId = "other-scene";
    else env.film().shots.splice(1, 0, { ...env.film().shots[0]!, id: "intervening" });
    const target = env.film().shots.find((shot) => shot.id === "current") as ContinuityShot;
    await expect(ensureContinuityFrame(env.film(), target, env.host)).rejects.toMatchObject({
      code: "CONTINUITY_SOURCE_INVALID",
    });
    expect(env.extract).not.toHaveBeenCalled();
  },
);

it.each(["selected-version", "user-edit", "project"])(
  "rejects a late result after %s changes",
  async (mode) => {
    const env = setup();
    let resolve!: (value: { path: string; sourceVideoPath: string }) => void;
    env.extract.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = ensureContinuityFrame(env.film(), env.shot(), env.host);
    if (mode === "selected-version") env.film().shots[0]!.selectedTakeId = "take-2";
    if (mode === "user-edit") env.shot().picture = "用户改写镜头";
    if (mode === "project") env.edit({ ...env.film(), id: "other-project" });
    resolve({ path: "/films/late.png", sourceVideoPath: "/story/one.mp4" });
    await expect(pending).rejects.toMatchObject({ code: "CONTINUITY_REQUEST_STALE" });
    expect(env.apply).not.toHaveBeenCalled();
  },
);

it("does not persist a remote frame or a frame from the wrong source video", async () => {
  const env = setup();
  for (const result of [
    { path: "https://example.com/frame.png", sourceVideoPath: "/story/one.mp4" },
    { path: "/films/frame.png", sourceVideoPath: "/story/different.mp4" },
  ]) {
    env.extract.mockResolvedValueOnce(result);
    await expect(ensureContinuityFrame(env.film(), env.shot(), env.host)).rejects.toMatchObject({
      code: "CONTINUITY_FRAME_INVALID",
    });
  }
  expect(env.apply).not.toHaveBeenCalled();
});

it("a protected run reuses an unchanged continuity frame and still resolves its stage", async () => {
  const env = setup();
  await ensureContinuityFrame(env.film(), env.shot(), env.host);
  env.extract.mockClear();
  env.apply.mockClear();
  const execution = createGenerationExecutionSession(
    {
      prepareFilmGenerationExecution: async (input) => ({
        kind: "PREPARED",
        executionId: "protected",
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        targets: [
          {
            shotId: "current",
            videoSlotIds: ["slot"],
            slotPreparations: ["slot"].map((videoSlotId) => ({
              videoSlotId,
              preparation: "CLIENT_IMAGES" as const,
            })),
            preparation: "CLIENT_IMAGES",
          },
        ],
        stages: [
          {
            kind: "continuity-frame",
            stageId: "local-frame",
            targetId: "current",
            sourceShotId: "previous",
          },
        ],
      }),
      retireFilmGenerationExecution: async () => ({ kind: "RETIRED" }),
    },
    () => true,
  );
  await execution.prepare({
    projectId: env.film().id,
    expectedProjectHash: "a".repeat(64),
    mode: "video",
    targets: [{ shotId: "current", versions: 1 }],
  });
  env.host.execution = execution;
  const resolveStage = vi.spyOn(execution, "continuity");
  const again = await ensureContinuityFrame(env.film(), env.shot(), env.host);
  expect(resolveStage).toHaveBeenCalledExactlyOnceWith("current", "previous");
  expect(env.extract).not.toHaveBeenCalled();
  expect(env.apply).not.toHaveBeenCalled();
  expect(again.poster).toBe("/films/tail.png");
  expect(again.continuityFrame).toEqual({
    sourceShotId: "previous",
    sourceTakeId: "take-1",
    sourceVideoPath: "/story/one.mp4",
    path: "/films/tail.png",
  });
});

it("a protected first extract uses the issued stage and records continuity provenance", async () => {
  const env = setup();
  const execution = createGenerationExecutionSession(
    {
      prepareFilmGenerationExecution: async (input) => ({
        kind: "PREPARED",
        executionId: "protected",
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        targets: [
          {
            shotId: "current",
            videoSlotIds: ["slot"],
            slotPreparations: [{ videoSlotId: "slot", preparation: "CLIENT_IMAGES" as const }],
            preparation: "CLIENT_IMAGES",
          },
        ],
        stages: [
          {
            kind: "continuity-frame",
            stageId: "local-frame",
            targetId: "current",
            sourceShotId: "previous",
          },
        ],
      }),
      retireFilmGenerationExecution: async () => ({ kind: "RETIRED" }),
    },
    () => true,
  );
  await execution.prepare({
    projectId: env.film().id,
    expectedProjectHash: "a".repeat(64),
    mode: "video",
    targets: [{ shotId: "current", versions: 1 }],
  });
  env.host.execution = execution;
  const next = await ensureContinuityFrame(env.film(), env.shot(), env.host);
  expect(env.extract).toHaveBeenCalledExactlyOnceWith(env.film().seriesId, "/story/one.mp4", {
    executionId: "protected",
    stageId: "local-frame",
  });
  expect(next.continuityFrame).toEqual({
    sourceShotId: "previous",
    sourceTakeId: "take-1",
    sourceVideoPath: "/story/one.mp4",
    path: "/films/tail.png",
  });
});

it("reuse throws when the protected continuity stage is missing", async () => {
  const env = setup();
  await ensureContinuityFrame(env.film(), env.shot(), env.host);
  env.extract.mockClear();
  const execution = createGenerationExecutionSession(
    {
      prepareFilmGenerationExecution: async (input) => ({
        kind: "PREPARED",
        executionId: "protected",
        projectId: input.projectId,
        projectHash: input.expectedProjectHash,
        targets: [
          {
            shotId: "current",
            videoSlotIds: ["slot"],
            slotPreparations: [{ videoSlotId: "slot", preparation: "CLIENT_IMAGES" as const }],
            preparation: "CLIENT_IMAGES",
          },
        ],
        stages: [],
      }),
      retireFilmGenerationExecution: async () => ({ kind: "RETIRED" }),
    },
    () => true,
  );
  await execution.prepare({
    projectId: env.film().id,
    expectedProjectHash: "a".repeat(64),
    mode: "video",
    targets: [{ shotId: "current", versions: 1 }],
  });
  env.host.execution = execution;
  await expect(ensureContinuityFrame(env.film(), env.shot(), env.host)).rejects.toMatchObject({
    code: "GENERATION_EXECUTION_STAGE_UNAVAILABLE",
  });
  expect(env.extract).not.toHaveBeenCalled();
});
