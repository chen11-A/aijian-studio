import { describe, it, expect, vi } from "vitest";
import { blankFilm, FILM_KEY, readFilm, sampleFilm } from "../film/project";
import {
  assembleCurrentFilm,
  generateMissingPortraits,
  middlePath,
  portraitReferences,
  retryDirectorTimeout,
} from "./workflow";

describe("generation recovery", () => {
  it("retries a stalled director exactly once and reports progress", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ text: null, detail: "timeout", code: "TEXT_TIMEOUT" })
      .mockResolvedValueOnce({ text: "shots", detail: "" });
    const progress = vi.fn();
    expect((await retryDirectorTimeout(request, progress)).text).toBe("shots");
    expect(request).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("2 / 2"));
    const timeout = vi
      .fn()
      .mockResolvedValue({ text: null, detail: "timeout", code: "TEXT_TIMEOUT" });
    await retryDirectorTimeout(timeout, progress);
    expect(timeout).toHaveBeenCalledTimes(2);
    const cancel = vi
      .fn()
      .mockResolvedValue({ text: null, detail: "cancelled", code: "TEXT_CANCELLED" });
    await retryDirectorTimeout(cancel, progress);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("attempts every missing portrait, preserves successes, and retries only failures", async () => {
    let film = sampleFilm();
    const id = film.characters[0]!.id;
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ url: "", reason: "rejected" })
      .mockResolvedValue({ url: "/portrait.png", reason: "" });
    const notice = vi.fn();
    await generateMissingPortraits(
      film,
      id,
      () => film,
      (next) => {
        film = next;
      },
      generate,
      notice,
    );
    expect(generate).toHaveBeenCalledTimes(4);
    expect(film.characters[0]!.portraits).toHaveLength(3);
    expect(notice).toHaveBeenLastCalledWith(expect.stringContaining("还有 1 张未完成"));
    generate.mockClear();
    await generateMissingPortraits(
      film,
      id,
      () => film,
      (next) => {
        film = next;
      },
      generate,
      notice,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(film.characters[0]!.portraits).toHaveLength(4);
  });

  it("does not write a late portrait into a different project", async () => {
    const film = sampleFilm();
    let current = film;
    const apply = vi.fn();
    await generateMissingPortraits(
      film,
      film.characters[0]!.id,
      () => current,
      apply,
      async () => {
        current = { ...film, id: "different-project" };
        return { url: "/late.png", reason: "" };
      },
      vi.fn(),
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps reference images including the sole portrait and caps the video reference set at 13", () => {
    const film = sampleFilm();
    film.characters = Array.from({ length: 5 }, (_, i) => ({
      ...film.characters[0]!,
      id: `c${i}`,
      name: `person${i}`,
      portraits: ["正面", "侧面", "背面", "脸部"].map((view, j) => ({
        view,
        prompt: "portrait",
        url: `https://example.test/${i}/${j}.png`,
      })),
    }));
    expect(portraitReferences(film)).toHaveLength(13);
    const shot = { ...film.shots[0]!, characters: ["person0"] };
    expect(portraitReferences(film, shot)).toHaveLength(4);
    film.characters[0]!.portraits = film.characters[0]!.portraits.slice(0, 1);
    expect(portraitReferences(film, shot)).toEqual(["https://example.test/0/0.png"]);
    expect(middlePath("C:/very/long/directory/name/export", 20)).toMatch(
      /^C:\/very\/l…me\/export$/,
    );
  });
});

it("keeps image reference limits in diagnostics and gives a short actionable reason", async () => {
  const { requestShotStill } = await import("./workflow");
  const film = sampleFilm();
  film.characters = [0, 1].map((index) => ({
    ...film.characters[0]!,
    id: `c${index}`,
    name: `person${index}`,
    portraits: ["正面", "侧面", "背面", "脸部"].map((view, angle) => ({
      view,
      prompt: "portrait",
      url: `https://example.test/${index}/${angle}.png`,
    })),
  }));
  const shot = { ...film.shots[0]!, characters: ["person0", "person1"] };
  const generate = vi.fn(async () => ({ path: "/tmp/still.png", reason: "" }));
  window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
  const made = await requestShotStill(film, shot, "frame");
  expect(generate).toHaveBeenCalledWith(
    film.seriesId,
    `frame\n【画风说明】\n${film.styleZh}\n【画风说明结束】`,
    "16:9",
    [
      "https://example.test/0/0.png",
      "https://example.test/1/0.png",
      "https://example.test/0/1.png",
      "https://example.test/1/1.png",
      "https://example.test/0/2.png",
    ],
  );
  expect(made.reason).toBe("画面已生成。");
  expect(made.diagnostics).toEqual({ referenceCount: 5, imageLimit: 5, videoReferenceLimit: 13 });
  film.characters = Array.from({ length: 6 }, (_, index) => ({
    ...film.characters[0]!,
    name: `person${index}`,
  }));
  shot.characters = film.characters.map((person) => person.name);
  const rejected = await requestShotStill(film, shot, "frame");
  expect(rejected.url).toBe("");
  expect(rejected.reason).toBe("这一镜人物太多，请拆成更少人物的镜头后重试。");
  expect(rejected.reason).not.toMatch(/模型|上限|首帧|\d/u);
  expect(rejected.diagnostics).toEqual({
    referenceCount: 0,
    imageLimit: 5,
    videoReferenceLimit: 13,
  });
  expect(generate).toHaveBeenCalledTimes(1);
});

it("keeps an unavailable desktop reason free of reference diagnostics", async () => {
  const { requestShotStill } = await import("./workflow");
  const previous = window.aijian;
  try {
    delete window.aijian;
    const film = sampleFilm();
    const made = await requestShotStill(film, film.shots[0]!, "frame");
    expect(made.url).toBe("");
    expect(made.reason).toBe("请打开安装好的 AIVORA 再出图。");
    expect(made.reason).not.toMatch(/模型|上限|首帧|\d/u);
    expect(made.diagnostics).toMatchObject({ imageLimit: 5, videoReferenceLimit: 13 });
  } finally {
    window.aijian = previous;
  }
});

it("preserves the image failure reason without adding reference counts", async () => {
  const { requestShotStill } = await import("./workflow");
  const previous = window.aijian;
  try {
    window.aijian = {
      generateFilmStill: vi.fn(async () => ({ path: "", reason: "请重新登录后重试。" })),
    } as unknown as Window["aijian"];
    const film = sampleFilm();
    const made = await requestShotStill(film, film.shots[0]!, "frame");
    expect(made.url).toBe("");
    expect(made.reason).toBe("请重新登录后重试。");
    expect(made.reason).not.toMatch(/模型|上限|首帧|\d/u);
    expect(made.diagnostics).toMatchObject({ imageLimit: 5, videoReferenceLimit: 13 });
  } finally {
    window.aijian = previous;
  }
});

it("does not write a late assembled cut into another project", async () => {
  const base = sampleFilm();
  let current = base;
  let resolve!: (value: { path: string; reason: string }) => void;
  const assembleFilm = vi.fn(
    () =>
      new Promise<{ path: string; reason: string }>((done) => {
        resolve = done;
      }),
  );
  const previous = window.aijian;
  window.aijian = { ...previous, assembleFilm } as NonNullable<typeof window.aijian>;
  const apply = vi.fn();
  const notice = vi.fn();
  try {
    const pending = assembleCurrentFilm(
      base,
      ["a.mp4", "b.mp4"],
      () => current,
      apply,
      notice,
      () => true,
    );
    current = { ...base, id: "another-project" };
    resolve({ path: "/old-project/cut.mp4", reason: "old result" });
    await pending;
    expect(apply).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  } finally {
    window.aijian = previous;
  }
});

it("shares one deadline across the retry and aborts a request still awaiting headers", async () => {
  vi.useFakeTimers();
  try {
    const controls: { deadlineAt: number; signal: AbortSignal }[] = [];
    const pending = retryDirectorTimeout(
      async (control) => {
        controls.push(control);
        if (controls.length === 1) return { text: null, detail: "", code: "TEXT_STALLED" };
        return new Promise(() => undefined);
      },
      vi.fn(),
      undefined,
      { totalMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(controls).toHaveLength(2);
    expect(controls[0]!.deadlineAt).toBe(controls[1]!.deadlineAt);
    expect(controls[1]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).code).toBe("TEXT_TIMEOUT");
    expect(controls[1]!.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("propagates cancellation without retrying or leaving deadline timers", async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const request = vi.fn((control: { signal: AbortSignal }) => {
      signal = control.signal;
      return new Promise<never>(() => undefined);
    });
    const pending = retryDirectorTimeout(request, vi.fn(), undefined, {
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending).code).toBe("TEXT_CANCELLED");
    expect(signal?.aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("UIR-03 emits one short status sentence without technical details or duplicate fallback", async () => {
  const { stillFailureNotice } = await import("./workflow");
  const { normalizeNotice, NOTICE_TEXT } = await import("../film/notices");
  for (const reason of [
    "请打开安装好的 AIVORA 再出图。",
    NOTICE_TEXT.STILL_CAST_LIMIT,
    "图片模型不可用，上限 5 张；最多 13 张参考图。",
    "请重新登录会员。",
    "模型拒绝了这一张。",
  ]) {
    const result = normalizeNotice(stillFailureNotice(new Error(reason)));
    expect(result.detail).toBeUndefined();
    expect(result.text).not.toMatch(/模型|上限|首帧选用|\d/);
    expect(result.text.match(/。/g)).toHaveLength(1);
  }
});

it("keeps rejection distinct from an ordinary still failure in plain status copy", async () => {
  const { stillFailureNotice } = await import("./workflow");
  expect(stillFailureNotice(new Error("模型拒绝了这一张。"))).toEqual({
    code: "STILL_REJECTED",
    text: "这张画面未获准生成，请调整画面描述后重试。",
  });
  expect(stillFailureNotice(new Error("出图没有成功，可以重试。"))).toEqual({
    code: "STILL_FAILED",
    text: "画面未完成，可以重试。",
  });
});

it("starts new projects in landscape", () => {
  expect(blankFilm().aspectRatio).toBe("16:9");
});

it.each(["9:16", undefined] as const)(
  "preserves legacy portrait projects and still requests when saved aspect is %s",
  async (aspectRatio) => {
    const { requestShotStill } = await import("./workflow");
    const previousApi = window.aijian;
    const previousFilm = localStorage.getItem(FILM_KEY);
    const saved = { ...sampleFilm(), aspectRatio };
    const generate = vi.fn(async () => ({ path: "/tmp/portrait.png", reason: "" }));
    try {
      localStorage.setItem(FILM_KEY, JSON.stringify(saved));
      const restored = readFilm(localStorage);
      expect(restored?.aspectRatio).toBe("9:16");
      if (!restored) throw new Error("legacy project was not restored");
      window.aijian = { generateFilmStill: generate } as unknown as Window["aijian"];
      await requestShotStill(restored, restored.shots[0]!, "legacy frame");
      expect(generate).toHaveBeenCalledExactlyOnceWith(
        restored.seriesId,
        expect.stringContaining("legacy frame"),
        "9:16",
        expect.any(Array),
      );
    } finally {
      window.aijian = previousApi;
      if (previousFilm === null) localStorage.removeItem(FILM_KEY);
      else localStorage.setItem(FILM_KEY, previousFilm);
    }
  },
);
