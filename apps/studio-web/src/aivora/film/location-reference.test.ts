import { describe, expect, it, vi } from "vitest";
import { blankFilm, parseDirectorShots, upgradeFilm } from "./project";
import { firstFrameReferences, shotReference, storyFilmBatches } from "./operations";
import { locationReference, makeLocationReferences } from "./location-reference";

function fixture() {
  const film = blankFilm();
  film.scenes[0]!.where = "书店";
  film.locations = [{ id: "loc-1", name: "书店", prompt: "木书架", ambience: "雨声" }];
  film.shots = parseDirectorShots(
    JSON.stringify({ shots: [{ picture: "走到书架", characters: ["甲"], speaker: "甲" }] }),
    film.scenes[0]!.id,
  )!;
  film.characters = [
    {
      id: "person-1",
      name: "甲",
      identity: "短发",
      voiceId: "",
      source: "user",
      userFields: [],
      portraits: [{ view: "正面", prompt: "", url: "/films/person.png" }],
    },
  ];
  return film;
}

describe("location reference images", () => {
  it("uses only a saved image for the exact scene and current style, with portrait priority", () => {
    const film = fixture();
    const shot = film.shots[0]!;
    expect(locationReference(film, shot)).toBeNull();
    film.locations[0]!.referenceImage = "/films/bookshop.png";
    film.locations[0]!.referenceStyleRevision = 0;
    shot.poster = "/films/first.png";
    expect(shotReference(shot, film)).toEqual({
      still: "/films/first.png",
      references: [
        { url: "/films/person.png", who: "甲" },
        { url: "/films/bookshop.png", who: "书店", kind: "location" },
      ],
    });
    expect(firstFrameReferences(film, shot)).toEqual(["/films/person.png", "/films/bookshop.png"]);
    const payload = storyFilmBatches(film, [shot], false)[0]!.shots![0]!;
    expect(payload.references).toEqual(["/films/person.png", "/films/bookshop.png"]);
    expect(payload.prompt).toContain("书店的场景空镜");
    expect(payload.prompt).not.toContain("书店的定妆照");
    expect(upgradeFilm(JSON.parse(JSON.stringify(film)))!.locations[0]!.referenceImage).toBe(
      "/films/bookshop.png",
    );
    film.styleRevision = 1;
    expect(locationReference(film, shot)).toBeNull();
    expect(film.locations[0]!.referenceImage).toBe("/films/bookshop.png");
  });

  it("does not guess locations or mistake prompt text and transient previews for images", () => {
    const film = fixture();
    const shot = film.shots[0]!;
    for (const image of [
      "木书架空镜",
      "blob:preview",
      "data:image/png;base64,AA",
      "http://example.com/image.png",
    ]) {
      film.locations[0]!.referenceImage = image;
      film.locations[0]!.referenceStyleRevision = 0;
      expect(locationReference(film, shot)).toBeNull();
    }
    film.locations[0]!.referenceImage = "https://example.com/bookshop.png";
    film.scenes[0]!.where = "街道";
    expect(locationReference(film, shot)).toBeNull();
    film.scenes[0]!.where = "书店";
    film.locations.push({ ...film.locations[0]!, id: "duplicate" });
    expect(locationReference(film, shot)).toBeNull();
  });

  it("keeps a separate first frame and never exceeds either reference limit", () => {
    const film = fixture();
    const shot = film.shots[0]!;
    film.locations[0]!.referenceImage = "/films/place.png";
    film.locations[0]!.referenceStyleRevision = 0;
    film.characters[0]!.portraits = Array.from({ length: 14 }, (_, i) => ({
      view: String(i),
      prompt: "",
      url: `/films/person-${i}.png`,
    }));
    shot.poster = "/films/first.png";
    expect(shotReference(shot, film).references).toHaveLength(13);
    expect(shotReference(shot, film).still).toBe("/films/first.png");
    expect(firstFrameReferences(film, shot).length).toBeLessThanOrEqual(5);
    film.locations[0]!.referenceImage = "/films/person-0.png";
    expect(
      shotReference(shot, film).references.filter((item) => item.url === "/films/person-0.png"),
    ).toHaveLength(1);
  });

  it("retries once, continues other locations and saves every successful image", async () => {
    let film = fixture();
    film.locations.push({ id: "loc-2", name: "街道", prompt: "路灯", ambience: "" });
    film.scenes.push({ ...film.scenes[0]!, id: "scene-2", where: "街道" });
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("private provider body"))
      .mockResolvedValueOnce({ url: "", reason: "failed" })
      .mockResolvedValueOnce({ url: "/films/street.png", reason: "ok" });
    const apply = vi.fn((next) => {
      film = next;
    });
    const result = await makeLocationReferences({
      base: film,
      current: () => film,
      apply,
      generate,
    });
    expect(result).toMatchObject({
      total: 2,
      done: 1,
      failed: 1,
      cancelled: false,
      failures: [{ locationId: "loc-1", code: "LOCATION_IMAGE_FAILED" }],
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[0]![0]).toContain("空镜，没有人物");
    expect(generate.mock.calls[0]![1]).toEqual([]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(film.locations[1]!.referenceImage).toBe("/films/street.png");
    expect(film.locations[0]!.referenceImage).toBeUndefined();
    const repeat = await makeLocationReferences({
      base: film,
      current: () => film,
      apply,
      generate: async () => ({ url: "/films/bookshop.png", reason: "ok" }),
    });
    expect(repeat.total).toBe(1);
  });

  it("rejects a late reply after content edits or a project switch", async () => {
    for (const changeProject of [false, true]) {
      let film = fixture();
      const apply = vi.fn();
      const result = await makeLocationReferences({
        base: film,
        current: () => film,
        apply,
        generate: async () => {
          film = changeProject ? { ...film, id: "other" } : { ...film, styleRevision: 1 };
          return { url: "/films/stale.png", reason: "ok" };
        },
      });
      expect(apply).not.toHaveBeenCalled();
      expect(result.done).toBe(0);
      expect(result.cancelled).toBe(changeProject);
      if (!changeProject) expect(result.failures[0]!.code).toBe("REQUEST_STALE");
    }
  });

  it("does not spend generation requests on ambiguous duplicate locations", async () => {
    const film = fixture();
    film.locations.push({ ...film.locations[0]!, id: "duplicate" });
    const generate = vi.fn();
    const result = await makeLocationReferences({
      base: film,
      current: () => film,
      apply: vi.fn(),
      generate,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ done: 0, failed: 2 });
    expect(result.failures.every((item) => item.code === "LOCATION_AMBIGUOUS")).toBe(true);
  });

  it("awaits durable saves and reports save failure without claiming success", async () => {
    const film = fixture();
    const result = await makeLocationReferences({
      base: film,
      current: () => film,
      generate: async () => ({ url: "/films/place.png", reason: "ok" }),
      apply: async () => {
        throw new Error("disk full");
      },
    });
    expect(result.done).toBe(0);
    expect(result.failures).toEqual([{ locationId: "loc-1", code: "LOCATION_SAVE_FAILED" }]);
  });
});
