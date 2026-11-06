import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject, type FilmShot } from "../../film/project";
import { prepareVideoQueue } from "../../film/generation-queue";
import { compileSevenPartVideo } from "../../film/seven-part-video";
import { runPreparedGeneration, type GenerationRunHost } from "./generation-run";
function fixture(existing = false, versions = 1) {
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
    selectedTakeId: existing ? "original" : "",
    takes: [],
  };
  if (existing)
    shot.takes = [
      {
        id: "original",
        shotId: shot.id,
        index: 1,
        status: "done",
        videoPath: "/media/original.mp4",
        videoUrl: "",
        stillUrl: "",
        prompt: "old",
        reason: "",
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
