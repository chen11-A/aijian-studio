import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject, type FilmShot } from "../../film/project";
import { prepareVideoQueue } from "../../film/generation-queue";
import { compileSevenPartVideo } from "../../film/seven-part-video";
import { runPreparedGeneration, type GenerationRunHost } from "./generation-run";
function fixture(existing: boolean | "failed" | "cancelled" = false, versions = 1) {
  const film = sampleFilm();
  film.characters = [];
  film.props = [];
  film.locations = [];
  const shot: FilmShot = {
    ...film.shots[0]!,
    characters: [],
    line: "",
    lines: [],
    picture: "街面的雨水。",
    action: "雨水沿路流动。",
    performance: "",
    userFields: ["picture", "action"],
    directorPlan: undefined,
    actionPlan: undefined,
    performancePlan: undefined,
    poster: "/media/old-frame.png",
    seconds: 4,
    selectedTakeId: existing === true ? "original" : "",
    takes: [],
  };
  if (existing)
    shot.takes = [
      {
        id: "original",
        shotId: shot.id,
        index: 1,
        status: existing === true ? "done" : "failed",
        videoPath: existing === true ? "/media/original.mp4" : "",
        videoUrl: "",
        stillUrl: "",
        prompt: "old",
        reason: existing === "cancelled" ? "已取消" : "",
        createdAt: "",
      },
    ];
  film.shots = [shot];
  shot.reviewedVideoPrompt = compileSevenPartVideo(film, shot).draft;
  const queue = prepareVideoQueue(film, [shot], versions, false);
  let current: FilmProject = queue.film;
  const request = vi.fn<GenerationRunHost["request"]>(async () => ({
    data: { status: "SUCCEEDED", output_path: "/media/new.mp4" },
    request_id: "synthetic-video-request",
  }));
  const host: GenerationRunHost = {
    current: () => current,
    valid: () => true,
    apply: async (next) => {
      current = next;
    },
    persist: vi.fn(async () => undefined),
    stopped: () => false,
    paused: () => false,
    cancelled: () => false,
    request,
    notice: vi.fn(),
    completed: vi.fn(),
    continuity: vi.fn(async (_film, shot) => shot),
    frame: vi.fn(async (_film, shot) => shot),
  };
  return {
    film,
    shot,
    queue,
    host,
    request,
    current: () => current,
    set: (next: FilmProject) => {
      current = next;
    },
  };
}
it.each([false, true])(
  "real dispatch uses reviewed text and retains prior versions (old take: %s)",
  async (existing) => {
    const f = fixture(existing, 2);
    const original = structuredClone(f.shot.reviewedVideoPrompt);
    await runPreparedGeneration(f.queue, f.host);
    expect(f.request).toHaveBeenCalledTimes(2);
    for (const [body] of f.request.mock.calls)
      expect(body.shots![0]!.prompt).toContain(original!.text);
    expect(f.current().shots[0]!.reviewedVideoPrompt).toEqual(original);
    if (existing) expect(f.current().shots[0]!.takes[0]!.videoPath).toBe("/media/original.mp4");
  },
);
it.each(["selection", "picture", "removed-review"])(
  "refuses a real dispatch after current %s changed instead of borrowing the queue exception",
  async (mode) => {
    const f = fixture();
    f.host.frame = async (_film, shot) => {
      const changed = {
        ...shot,
        ...(mode === "selection"
          ? { selectedTakeId: "user-choice" }
          : mode === "picture"
            ? { picture: "后来编辑" }
            : { reviewedVideoPrompt: undefined }),
      };
      f.set({ ...f.current(), shots: [changed] });
      return changed;
    };
    await expect(runPreparedGeneration(f.queue, f.host)).rejects.toThrow(/重新整理/);
    expect(f.request).not.toHaveBeenCalled();
  },
);

it.each(["failed", "cancelled"] as const)(
  "allows a fresh confirmed request with only retained unusable %s history and keeps that history",
  async (kind) => {
    const f = fixture(kind, 2),
      old = structuredClone(f.shot.takes[0]);
    await runPreparedGeneration(f.queue, f.host);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.current().shots[0]!.takes[0]).toEqual(old);
    expect(f.current().shots[0]!.takes).toHaveLength(3);
  },
);
it("does not replace an unselected but usable old version through the automatic-identity exception", async () => {
  const f = fixture(true);
  f.shot.selectedTakeId = "";
  f.shot.reviewedVideoPrompt = compileSevenPartVideo(f.film, f.shot).draft;
  const queue = prepareVideoQueue(f.film, [f.shot], 1, false);
  f.set(queue.film);
  await expect(runPreparedGeneration(queue, f.host)).rejects.toThrow(/重新整理/);
  expect(f.request).not.toHaveBeenCalled();
  expect(f.current().shots[0]!.takes[0]!.videoPath).toBe("/media/original.mp4");
});

it("rejects the automatic selection exception if an old failed take gains usable media before dispatch, preserving the late media", async () => {
  const f = fixture("failed");
  f.host.frame = async (_film, shot) => {
    const changed = {
      ...shot,
      takes: shot.takes.map((take) =>
        take.id === "original"
          ? { ...take, status: "done" as const, videoPath: "/media/late-original.mp4" }
          : take,
      ),
    };
    f.set({ ...f.current(), shots: [changed] });
    return changed;
  };
  await expect(runPreparedGeneration(f.queue, f.host)).rejects.toThrow(/重新整理/);
  expect(f.request).not.toHaveBeenCalled();
  expect(f.current().shots[0]!.takes[0]!.videoPath).toBe("/media/late-original.mp4");
});
