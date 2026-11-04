import { describe, it, expect, vi } from "vitest";
import { sampleFilm } from "../film/project";
import {
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

it("sends a first-frame request with references from every visible person and discloses the five-image limit", async () => {
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
  expect(generate).toHaveBeenCalledWith(film.seriesId, "frame", "9:16", [
    "https://example.test/0/0.png",
    "https://example.test/1/0.png",
    "https://example.test/0/1.png",
    "https://example.test/1/1.png",
    "https://example.test/0/2.png",
  ]);
  expect(made.reason).toContain("首帧选用 5 张");
  film.characters = Array.from({ length: 6 }, (_, index) => ({
    ...film.characters[0]!,
    name: `person${index}`,
  }));
  shot.characters = film.characters.map((person) => person.name);
  const rejected = await requestShotStill(film, shot, "frame");
  expect(rejected.url).toBe("");
  expect(rejected.reason).toContain("超过 5 位角色");
  expect(generate).toHaveBeenCalledTimes(1);
});
