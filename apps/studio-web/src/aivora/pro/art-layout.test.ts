import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { artFromModel } from "../film/phase2";
import { sampleFilm, upgradeFilm } from "../film/project";
import { storyFilmBatches } from "../film/operations";
import {
  locationReference,
  makeLocationReferences,
  withLocationLayout,
} from "../film/location-reference";
import { applyArtDraft, requestShotStill } from "./workflow";

const examples = JSON.parse(
  readFileSync(resolve(__dirname, "../film/fixtures/claude-6a77ebd-examples.json"), "utf8"),
) as {
  examples: {
    role: string;
    example: { id: string; output: { locations: { name: string; layout: string }[] } };
  }[];
};

it.each(examples.examples.filter((entry) => entry.role === "art"))(
  "preserves real art example $example.id layouts through save and media prompts",
  async ({ example }) => {
    let film = applyArtDraft({ ...sampleFilm(), locations: [] }, artFromModel(example.output)!);
    expect(example.output.locations.length).toBeGreaterThan(0);
    for (const location of example.output.locations) {
      expect(film.locations.find((item) => item.name === location.name)).toMatchObject({
        layout: location.layout,
        artFields: { layout: location.layout },
      });
    }
    film = upgradeFilm(JSON.parse(JSON.stringify(film)))!;
    const place = film.locations[0]!;
    film.scenes[0]!.where = place.name;
    film.shots = [
      {
        ...film.shots[0]!,
        sceneId: film.scenes[0]!.id,
        picture: "站在门口",
        action: "",
        line: "",
        lines: [],
        speaker: "",
        characters: [],
        performance: "",
      },
    ];
    const generate = vi.fn<
      (prompt: string, references: string[]) => Promise<{ url: string; reason: string }>
    >(async () => ({ url: "/media/location.png", reason: "" }));
    await makeLocationReferences({
      base: film,
      locationIds: [place.id],
      current: () => film,
      apply: (next) => {
        film = next;
      },
      generate,
    });
    expect(generate.mock.calls[0]?.[0]).toContain(place.layout);
    expect(film.locations[0]!.referenceLayout).toBe(place.layout);
    const shot = film.shots[0]!;
    expect(storyFilmBatches(film, [shot], false)[0]!.shots![0]!.prompt).toContain(place.layout);
    const previous = window.aijian;
    const generateFilmStill = vi.fn<
      NonNullable<NonNullable<typeof window.aijian>["generateFilmStill"]>
    >(async () => ({ path: "/media/first.png", reason: "" }));
    window.aijian = { ...previous, generateFilmStill } as typeof window.aijian;
    try {
      await requestShotStill(film, shot, withLocationLayout("起始画面", film, shot));
      const prompt = generateFilmStill.mock.calls[0]![1];
      expect(prompt).toContain(place.layout);
      expect(prompt.match(/【场景布局】/gu)).toHaveLength(1);
    } finally {
      window.aijian = previous;
    }
  },
);

it("protects explicit and inferred layout edits and invalidates only changed AI layouts", () => {
  const draft = (layout: string) => artFromModel({ locations: [{ name: "书店", layout }] })!;
  const base = applyArtDraft({ ...sampleFilm(), locations: [] }, draft("门在右边"));
  base.locations[0]!.referenceImage = "/media/location.png";
  base.locations[0]!.referenceStyleRevision = base.styleRevision ?? 0;
  base.locations[0]!.referenceLayout = "门在右边";
  const changed = applyArtDraft(base, draft("门在左边"));
  expect(changed.locations[0]).toMatchObject({
    layout: "门在左边",
    referenceImage: "/media/location.png",
    referenceStyleRevision: -1,
  });
  for (const explicit of [false, true]) {
    const edited = {
      ...base,
      locations: [
        { ...base.locations[0]!, layout: "用户的门在中央", userFields: explicit ? ["layout"] : [] },
      ],
    };
    const next = applyArtDraft(edited, draft("门在左边"));
    expect(next.locations[0]!.layout).toBe("用户的门在中央");
    expect(next.locations[0]!.userFields).toContain("layout");
    next.scenes[0]!.where = "书店";
    next.shots[0]!.sceneId = next.scenes[0]!.id;
    expect(locationReference(next, next.shots[0]!)).toBeNull();
  }
});

it("keeps same words in dialogue, replaces only generated layout blocks and never guesses a place", () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  film.locations = [{ id: "loc", name: "书店", prompt: "", ambience: "", layout: "门" }];
  film.scenes.find((scene) => scene.id === shot.sceneId)!.where = "书店";
  const first = withLocationLayout("他说：“门开了。”", film, shot);
  film.locations[0]!.layout = "左边是门";
  const second = withLocationLayout(first, film, shot);
  expect(second).toContain("他说：“门开了。”");
  expect(second.match(/【场景布局】/gu)).toHaveLength(1);
  expect(second).toContain("左边是门");
  film.scenes.find((scene) => scene.id === shot.sceneId)!.where = "旧书店";
  expect(withLocationLayout(first, film, shot)).toBe("他说：“门开了。”");
});

it("rejects a generated location reply when its layout changes while waiting", async () => {
  let film = sampleFilm();
  film.locations = [{ id: "loc", name: "书店", prompt: "空书架", ambience: "", layout: "门在左" }];
  const apply = vi.fn();
  const result = await makeLocationReferences({
    base: film,
    locationIds: ["loc"],
    current: () => film,
    apply,
    generate: async () => {
      film = { ...film, locations: [{ ...film.locations[0]!, layout: "门在右" }] };
      return { url: "/media/stale.png", reason: "" };
    },
  });
  expect(apply).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    done: 0,
    failed: 1,
    failures: [{ locationId: "loc", code: "REQUEST_STALE" }],
  });
});
