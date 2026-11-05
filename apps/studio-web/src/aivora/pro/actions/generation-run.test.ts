import { expect, it, vi } from "vitest";
import { sampleFilm, writeFilm, readFilm, type FilmProject } from "../../film/project";
import { prepareVideoQueue } from "../../film/generation-queue";
import {
  applyVideoResponse,
  runPreparedGeneration,
  type GenerationRunHost,
} from "./generation-run";

function setup(versions = 1) {
  const base = sampleFilm();
  base.shots = [
    {
      ...base.shots[0]!,
      takes: [],
      selectedTakeId: "",
      poster: "/films/frame.png",
      line: "",
      lines: [],
    },
  ];
  const queue = prepareVideoQueue(base, base.shots, versions, false);
  let live: FilmProject | null = queue.film;
  const events: string[] = [];
  const host: GenerationRunHost = {
    current: () => live,
    valid: () => true,
    apply: vi.fn(async (film: FilmProject) => {
      live = film;
      events.push(`apply:${film.shots[0]?.takes[0]?.status}`);
    }),
    persist: vi.fn(async (film: FilmProject) => {
      events.push(`persist:${film.shots[0]?.takes[0]?.status}`);
    }),
    stopped: () => false,
    paused: () => false,
    cancelled: () => false,
    request: vi.fn<GenerationRunHost["request"]>().mockImplementation(async () => {
      events.push("request");
      return { data: { status: "SUCCEEDED", output_path: "/films/video.mp4" }, request_id: "test" };
    }),
    notice: vi.fn(),
    completed: vi.fn(),
    continuity: vi
      .fn<NonNullable<GenerationRunHost["continuity"]>>()
      .mockImplementation(async (_film, shot) => {
        events.push("continuity");
        return shot;
      }),
    frame: vi
      .fn<NonNullable<GenerationRunHost["frame"]>>()
      .mockImplementation(async (_film, shot) => {
        events.push("frame");
        return shot;
      }),
  };
  return {
    queue,
    host,
    events,
    setLive: (film: FilmProject | null) => {
      live = film;
    },
  };
}

it("persists queued and running states before dispatch and prepares continuity before the first frame", async () => {
  const { queue, host, events } = setup();
  await runPreparedGeneration(queue, host);
  expect(events).toEqual([
    "persist:queued",
    "continuity",
    "frame",
    "apply:running",
    "persist:running",
    "request",
    "apply:done",
  ]);
  expect(host.current()?.shots[0]?.takes[0]).toMatchObject({
    status: "done",
    videoPath: "/films/video.mp4",
  });
  expect(host.completed).toHaveBeenCalledWith({
    shotId: queue.film.shots[0]!.id,
    done: true,
    message: "",
  });
});

it("awaits durable partial commits before sending even when ordinary persistence is a no-op", async () => {
  const { queue, host, events } = setup();
  const apply = host.apply;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  host.apply = vi.fn(async (film) => {
    await barrier;
    await apply(film);
  });
  host.persist = vi.fn(async () => undefined);
  const run = runPreparedGeneration(queue, host);
  await vi.waitFor(() => expect(host.apply).toHaveBeenCalledOnce());
  expect(host.request).not.toHaveBeenCalled();
  release();
  await run;
  expect(events.indexOf("apply:running")).toBeLessThan(events.indexOf("request"));
});

it("leaves paused work queued when pause arrives during the running-state save", async () => {
  const { queue, host } = setup();
  host.persist = vi.fn(async (film) => {
    if (film.shots[0]?.takes[0]?.status === "running") host.paused = () => true;
  });
  await runPreparedGeneration(queue, host);
  expect(host.request).not.toHaveBeenCalled();
  expect(host.current()?.shots[0]?.takes[0]?.status).toBe("queued");
  expect(host.notice).toHaveBeenCalledWith(expect.objectContaining({ code: "GENERATION_PAUSED" }));
});

it("does not dispatch when a queued version is cancelled", async () => {
  const { queue, host } = setup();
  host.cancelled = () => true;
  await runPreparedGeneration(queue, host);
  expect(host.request).not.toHaveBeenCalled();
  expect(host.current()?.shots[0]?.takes[0]?.status).not.toBe("done");
});

it("rejects late results after the run loses its project or abort owner", async () => {
  const { queue, host, setLive } = setup();
  host.request = vi.fn<GenerationRunHost["request"]>().mockImplementation(async () => {
    host.valid = () => false;
    setLive({ ...queue.film, id: "other" });
    return { data: { status: "SUCCEEDED", output_path: "/films/late.mp4" }, request_id: "test" };
  });
  await runPreparedGeneration(queue, host);
  expect(host.current()?.id).toBe("other");
  expect(host.completed).not.toHaveBeenCalled();
  expect(host.current()?.shots[0]?.takes[0]?.videoPath).not.toBe("/films/late.mp4");
});

it("executes versions sequentially and retains the first selected successful version", async () => {
  const { queue, host } = setup(2);
  await runPreparedGeneration(queue, host);
  expect(host.request).toHaveBeenCalledTimes(2);
  expect(vi.mocked(host.request).mock.calls.map(([body]) => body.regenerate)).toEqual([
    false,
    true,
  ]);
  expect(host.current()?.shots[0]?.selectedTakeId).toBe(queue.groups[0]!.takes[0]!.id);
  expect(host.current()?.shots[0]?.takes.every((take) => take.status === "done")).toBe(true);
});

it.each([
  "",
  "preview.png",
  "/films/preview.png",
  "https://example.com/video.mp4",
  "data:video/mp4;base64,AA==",
  "blob:video",
  "/films/bad\0.mp4",
])("does not treat %j or a thumbnail as a completed video", (output) => {
  const { queue } = setup();
  const shot = queue.film.shots[0]!;
  const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
    status: "SUCCEEDED",
    output_path: output,
    preview_image: "data:image/png;base64,AA==",
  });
  expect(result.done).toBe(false);
  expect(result.film.shots[0]?.takes[0]).toMatchObject({
    status: "failed",
    stillUrl: "data:image/png;base64,AA==",
    videoUrl: "",
  });
  expect(result.film.shots[0]?.selectedTakeId).toBe("");
});

it.each([
  "/films/video.mp4",
  "C:\\films\\video.mp4",
  "aivora-media://local/?path=%2Ffilms%2Fvideo.webm",
])("accepts a successful local video output %s", (output) => {
  const { queue } = setup();
  const shot = queue.film.shots[0]!;
  const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
    status: "SUCCEEDED",
    output_path: output,
  });
  expect(result.done).toBe(true);
  expect(result.film.shots[0]?.selectedTakeId).toBe(shot.takes[0]!.id);
});

it("preserves user edits and selected completed versions while recording an unsuccessful thumbnail", () => {
  const { queue } = setup(2);
  const shot = queue.film.shots[0]!;
  shot.takes[0] = { ...shot.takes[0]!, status: "done", videoPath: "/films/chosen.mp4" };
  shot.selectedTakeId = shot.takes[0]!.id;
  const latest = { ...queue.film, title: "手改标题" };
  const result = applyVideoResponse(latest, shot, shot.takes[1]!, {
    status: "FAILED",
    output_path: "/films/not-done.mp4",
    preview_image: "https://example.com/preview.png",
  });
  expect(result.done).toBe(false);
  expect(result.film.title).toBe("手改标题");
  expect(result.film.shots[0]?.selectedTakeId).toBe(shot.takes[0]!.id);
  expect(result.film.shots[0]?.takes[1]?.stillUrl).toContain("preview.png");
});

it("propagates persistence failures without sending a request", async () => {
  const { queue, host } = setup();
  host.persist = vi.fn(async () => {
    throw new Error("disk failed");
  });
  await expect(runPreparedGeneration(queue, host)).rejects.toThrow("disk failed");
  expect(host.request).not.toHaveBeenCalled();
});

it("retains unrelated audio while applying successful narration and measured duration", () => {
  const { queue } = setup();
  const shot = queue.film.shots[0]!;
  shot.line = "这句台词需要配音。";
  const prior = queue.film.audioClips;
  const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
    status: "SUCCEEDED",
    output_path: "/films/video.mp4",
    voice_path: "/films/voice.wav",
    duration_seconds: "8",
    preview_image: "data:image/png;base64,AA==",
  });
  expect(result.film.shots[0]).toMatchObject({
    seconds: 8,
    poster: "data:image/png;base64,AA==",
    sound: { source: "dub" },
  });
  expect(result.film.audioClips).toEqual(
    expect.arrayContaining(
      prior.filter((clip) => !(clip.lane === "dialogue" && clip.shotId === shot.id)),
    ),
  );
  expect(result.film.audioClips).toContainEqual(
    expect.objectContaining({
      lane: "dialogue",
      path: "/films/voice.wav",
      takeId: shot.takes[0]!.id,
    }),
  );
});

it("normalizes surrounding output whitespace once while retaining filename spaces", () => {
  const { queue } = setup();
  const shot = queue.film.shots[0]!;
  const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
    status: "SUCCEEDED",
    output_path: "  /films/my video.mp4 ",
  });
  expect(result.done).toBe(true);
  expect(result.film.shots[0]?.takes[0]).toMatchObject({
    videoPath: "/films/my video.mp4",
    videoUrl: "aivora-media://local/?path=%2Ffilms%2Fmy%20video.mp4",
  });
});

it("preserves measured legacy take lengths without truncating the saved timeline", () => {
  const { queue } = setup();
  const shot = queue.film.shots[0]!;
  shot.lines = [
    { speaker: "甲", text: "第一句。" },
    { speaker: "乙", text: "最后一句。" },
  ];
  shot.line = shot.lines.map((line) => line.text).join("\n");
  const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
    status: "SUCCEEDED",
    output_path: "/films/long.mp4",
    voice_path: "/films/combined.wav",
    duration_seconds: 21.5,
  });
  expect(result.film.shots[0]!.seconds).toBe(21.5);
  expect(
    result.film.audioClips.find((clip) => clip.shotId === shot.id && clip.lane === "dialogue"),
  ).toMatchObject({ path: "/films/combined.wav", durationSeconds: 21.5 });
  writeFilm(localStorage, result.film);
  const restored = readFilm(localStorage)!;
  expect(restored.shots[0]!.seconds).toBe(21.5);
  expect(restored.shots[0]!.lines).toEqual(shot.lines);
  expect(restored.shots[0]!.takes[0]!.durationSeconds).toBe(21.5);
});

it("keeps the timing failure and next step in the actual failed job without leaking codes", () => {
  const { queue } = setup();
  const shot = queue.film.shots[0]!;
  const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
    status: "FAILED",
    message: "DIALOGUE_VIDEO_LIMIT",
    user_message: {
      code: "DIALOGUE_VIDEO_LIMIT",
      text: "DIALOGUE_VIDEO_LIMIT",
      detail: "这一镜对白约 18 秒，视频最多 15 秒；请拆分对白。",
    },
  });
  expect(result.done).toBe(false);
  expect(result.message).toContain("18 秒");
  expect(result.message).toContain("拆分");
  expect(result.message).not.toContain("DIALOGUE_VIDEO_LIMIT");
  expect(result.film.jobs.find((job) => job.shotId === shot.id)!.reason).toBe(result.message);
});

it.each(["甲", "乙"])(
  "3JR-B07 writes a real voice track for canonical lines with empty legacy line (%s)",
  (secondSpeaker) => {
    const { queue } = setup();
    const shot = queue.film.shots[0]!;
    shot.line = "";
    shot.speaker = "过时的人物";
    shot.lines = [
      { speaker: "甲", text: "第一句。还有一句。" },
      { speaker: secondSpeaker, text: "最后一句。" },
    ];
    const result = applyVideoResponse(queue.film, shot, shot.takes[0]!, {
      status: "SUCCEEDED",
      output_path: "/films/dialogue.mp4",
      voice_path: "/films/dialogue.wav",
      duration_seconds: 8,
    });
    expect(result.film.audioClips.find((clip) => clip.shotId === shot.id)).toMatchObject({
      lane: "dialogue",
      path: "/films/dialogue.wav",
      durationSeconds: 8,
      takeId: shot.takes[0]!.id,
    });
    expect(result.film.shots[0]).toMatchObject({
      line: "第一句。还有一句。\n最后一句。",
      lines: shot.lines,
      speaker: secondSpeaker === "甲" ? "甲" : "",
      sound: { source: "dub" },
    });
    writeFilm(localStorage, result.film);
    const restored = readFilm(localStorage)!;
    expect(restored.shots[0]!.line).toBe("第一句。还有一句。\n最后一句。");
    expect(restored.shots[0]!.lines).toEqual(shot.lines);
    expect(restored.audioClips.find((clip) => clip.shotId === shot.id)?.path).toBe(
      "/films/dialogue.wav",
    );
  },
);
