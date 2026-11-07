import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { setFilmStyle } from "../../film/style-bible";
import { prepareArtTransaction } from "./art-transaction";
import { artReviewInput, artReviewCurrent } from "./art-review-scope";
function fixture() {
  const film = sampleFilm(),
    tx = prepareArtTransaction(film, setFilmStyle(film, "暖色胶片"), {
      projectId: film.id,
      page: "cast",
    });
  return { film, tx, input: artReviewInput(film, tx) };
}
it("keeps late shot media, portraits, save metadata and unrelated cache out of the creative derived admission", () => {
  const f = fixture(),
    live = structuredClone(f.film);
  live.shots[0]!.poster = "/late.png";
  live.shots[0]!.takes = [];
  live.characters[0]!.portraits = [];
  live.savedAt = "later";
  expect(artReviewCurrent(live, f.tx, f.input)).toBe(true);
});
it.each(["shot", "reference", "revision"])(
  "requires review again before an unreviewed %s derived impact",
  (mode) => {
    const f = fixture(),
      live = structuredClone(f.film);
    if (mode === "shot") live.shots.push({ ...structuredClone(live.shots[0]!), id: "new-shot" });
    if (mode === "reference")
      live.locations.push({
        id: "new-place",
        name: "新场景",
        prompt: "",
        ambience: "",
        referenceImage: "/late-reference.png",
      });
    if (mode === "revision") live.styleRevision = (live.styleRevision ?? 0) + 1;
    expect(artReviewCurrent(live, f.tx, f.input)).toBe(false);
  },
);
it("does not mistake replacing an already reviewed reference file for an extra creative effect", () => {
  const f = fixture();
  f.film.locations = [
    {
      id: "place",
      name: "室内",
      prompt: "",
      ambience: "",
      referenceImage: "/first.png",
      referenceStyleRevision: 0,
    },
  ];
  const input = artReviewInput(f.film, f.tx),
    live = structuredClone(f.film);
  live.locations[0]!.referenceImage = "/later.png";
  expect(artReviewCurrent(live, f.tx, input)).toBe(true);
});
it("binds the original costume resolver inputs, not the entire mutable film", () => {
  const f = fixture();
  f.tx.recomputeCostumes = true;
  const input = artReviewInput(f.film, f.tx),
    live = structuredClone(f.film);
  live.title = "新标题";
  live.shots[0]!.poster = "/late.png";
  expect(artReviewCurrent(live, f.tx, input)).toBe(true);
  live.scenes[0]!.text = "后来改写的服装范围来源";
  expect(artReviewCurrent(live, f.tx, input)).toBe(false);
});

it.each(["ambience", "prompt"] as const)(
  "does not treat late reference bytes as an extra effect for a non-style %s transaction",
  (field) => {
    const film = sampleFilm();
    film.locations = [{ id: "review-place", name: "房间", prompt: "原描述", ambience: "原环境" }];
    const draft = structuredClone(film);
    draft.locations[0]![field] = "新创作内容";
    const tx = prepareArtTransaction(film, draft, { projectId: film.id, page: "cast" });
    const baseline = artReviewInput(film, tx),
      live = structuredClone(film);
    live.locations[0]!.referenceImage = "/late.png";
    expect(artReviewCurrent(live, tx, baseline)).toBe(true);
  },
);
