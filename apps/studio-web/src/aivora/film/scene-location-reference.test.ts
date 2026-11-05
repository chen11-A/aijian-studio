import { describe, expect, it, vi } from "vitest";
import { blankFilm, offlineShots } from "./project";
import {
  ensureSceneReferences,
  locationImageCurrent,
  locationReference,
  prepareSceneLocations,
  sceneLocationTargets,
} from "./location-reference";

function fixture() {
  const film = blankFilm();
  film.locations = [];
  film.scenes = [
    {
      ...film.scenes[0]!,
      id: "first",
      title: "雨夜书店",
      where: "书店 · 夜",
      text: "雨点敲打书店玻璃。",
    },
    {
      ...film.scenes[0]!,
      id: "second",
      title: "清晨书店",
      where: "书店 · 晨",
      text: "阳光透进书店窗户。",
    },
  ];
  film.shots = film.scenes.flatMap((scene) => offlineShots(scene.text, scene.id));
  return film;
}

describe("3JR-B08 explicit scene reference coverage", () => {
  it("plans every real scene without pretending location descriptions are completed images", () => {
    const film = fixture();
    const planned = prepareSceneLocations(film);
    expect(planned.locations.map((place) => place.sceneId)).toEqual(["first", "second"]);
    expect(planned.locations.every((place) => !place.referenceImage)).toBe(true);
    expect(film.locations).toEqual([]);
    expect(prepareSceneLocations(planned)).toBe(planned);
    expect(sceneLocationTargets(film).map((place) => place.id)).toEqual(
      planned.locations.map((place) => place.id),
    );
  });

  it("saves the selected scene's association first, generates only it, then reuses its current image", async () => {
    let film = fixture();
    const events: string[] = [];
    const apply = async (next: typeof film) => {
      film = next;
      events.push("save");
    };
    const generate = vi.fn(async (prompt: string) => {
      events.push("generate");
      expect(film.locations).toHaveLength(1);
      expect(prompt).toContain(film.scenes[1]!.text);
      expect(prompt).not.toContain(film.scenes[0]!.text);
      return { url: "/media/second.png", reason: "" };
    });
    const result = await ensureSceneReferences({
      base: film,
      sceneIds: ["second"],
      current: () => film,
      apply,
      generate,
    });
    expect(result).toMatchObject({ total: 1, done: 1, failed: 0 });
    expect(events).toEqual(["save", "generate", "save"]);
    expect(film.locations[0]!.sceneId).toBe("second");
    const second = film.shots.find((shot) => shot.sceneId === "second")!;
    expect(locationReference(film, second)?.url).toBe("/media/second.png");
    expect(locationReference(film, film.shots[0]!)).toBeNull();
    await ensureSceneReferences({
      base: film,
      sceneIds: ["second"],
      current: () => film,
      apply,
      generate,
    });
    expect(generate).toHaveBeenCalledOnce();
    film = {
      ...film,
      scenes: film.scenes.map((scene) =>
        scene.id === "second" ? { ...scene, text: "室内熄灯。" } : scene,
      ),
    };
    expect(locationImageCurrent(film, film.locations[0]!)).toBe(false);
  });

  it("does not borrow partially matching locations, and preserves existing media", () => {
    const film = fixture();
    film.locations = [
      {
        id: "old",
        name: "书店",
        prompt: "",
        ambience: "",
        referenceImage: "/media/old.png",
        referenceStyleRevision: 0,
      },
    ];
    const prepared = prepareSceneLocations(film);
    expect(prepared.locations).toHaveLength(3);
    expect(prepared.locations[0]).toBe(film.locations[0]);
    expect(locationReference(prepared, prepared.shots[0]!)).toBeNull();
  });

  it("records failures instead of zero-target success or fabricated references", async () => {
    let film = fixture();
    const generate = vi.fn(async () => ({ url: "", reason: "refused" }));
    const result = await ensureSceneReferences({
      base: film,
      sceneIds: ["first", "second"],
      current: () => film,
      apply: (next) => {
        film = next;
      },
      generate,
    });
    expect(result).toMatchObject({ total: 2, done: 0, failed: 2 });
    expect(generate).toHaveBeenCalledTimes(4);
    expect(film.locations.every((place) => !place.referenceImage)).toBe(true);
  });

  it("never starts generation before a durable scene association save", async () => {
    const film = fixture();
    const generate = vi.fn();
    const result = await ensureSceneReferences({
      base: film,
      sceneIds: ["first"],
      current: () => film,
      apply: async () => {
        throw new Error("disk");
      },
      generate,
    });
    expect(result).toMatchObject({
      done: 0,
      failed: 1,
      failures: [{ locationId: "first", code: "LOCATION_SAVE_FAILED" }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects an image returned after its scene text changed", async () => {
    let film = fixture();
    const result = await ensureSceneReferences({
      base: film,
      sceneIds: ["first"],
      current: () => film,
      apply: (next) => {
        film = next;
      },
      generate: async () => {
        film = {
          ...film,
          scenes: film.scenes.map((scene) =>
            scene.id === "first" ? { ...scene, text: "现在是在医院走廊。" } : scene,
          ),
        };
        return { url: "/media/old-bookshop.png", reason: "" };
      },
    });
    expect(result).toMatchObject({ done: 0, failed: 1 });
    expect(result.failures[0]!.code).toBe("REQUEST_STALE");
    expect(film.locations[0]!.referenceImage).toBeUndefined();
  });

  it("does not invent a location picture when a scene has no source setting", async () => {
    let film = fixture();
    film.scenes[0] = { ...film.scenes[0]!, where: "", text: "" };
    const generate = vi.fn();
    const result = await ensureSceneReferences({
      base: film,
      sceneIds: ["first"],
      current: () => film,
      apply: (next) => {
        film = next;
      },
      generate,
    });
    expect(result).toMatchObject({ done: 0, failed: 1 });
    expect(result.failures[0]!.code).toBe("LOCATION_SOURCE_REQUIRED");
    expect(generate).not.toHaveBeenCalled();
  });
});
