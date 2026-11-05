import { expect, it } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import { sampleFilm, upgradeFilm } from "./project";
import { applyTextReview, captureReviewInput } from "./review-report";
const reviews = fixtures.examples.filter((entry) => entry.role === "review");
type Reply = {
  verdict: string;
  issues: string[];
  shots: {
    shot_id: string;
    takes: { take_id: string; seen_frames: boolean }[];
    recommend: { take_id: string; reason: string };
    next_try: unknown;
  }[];
};
function fixture(reply: Reply) {
  const film = sampleFilm();
  const template = film.shots[0]!;
  film.shots = reply.shots.map((row) => ({
    ...template,
    id: row.shot_id,
    takes: row.takes.map((take, index) => ({
      id: take.take_id,
      shotId: row.shot_id,
      index,
      status: "done" as const,
      stillUrl: "",
      videoPath: `/media/${take.take_id}.mp4`,
      videoUrl: "",
      prompt: "original",
      createdAt: "",
      reason: "",
    })),
  }));
  return film;
}
it.each(reviews)(
  "preserves real $example.id structured details without granting visual evidence or editing film",
  ({ example }) => {
    const reply = example.output as unknown as Reply;
    const film = fixture(reply);
    const original = structuredClone(film);
    const input = captureReviewInput(
      film,
      film.shots.map((shot) => shot.id),
      "only written descriptions",
    );
    const result = applyTextReview(film, input, reply);
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.report).toMatchObject({
      evidence: "text-only",
      visualVerified: false,
      verdict: reply.verdict,
      issues: reply.issues,
      shots: reply.shots,
      rejected: [],
    });
    expect(result.film.shots).toEqual(original.shots);
    expect(film).toEqual(original);
    expect(upgradeFilm(JSON.parse(JSON.stringify(result.film)))!.reviewReports).toEqual([
      result.report,
    ]);
  },
);
it("rejects unknown shot/take recommendations while retaining them as rejected claims", () => {
  const reply = structuredClone(reviews[0]!.example.output) as unknown as Reply;
  const film = fixture(reply);
  reply.shots[0]!.takes[0]!.take_id = "not-generated";
  reply.shots[0]!.recommend.take_id = "not-generated";
  reply.shots[1]!.shot_id = "invented-shot";
  const result = applyTextReview(
    film,
    captureReviewInput(film, [film.shots[0]!.id], "text"),
    reply,
  );
  expect(result.status).toBe("done");
  if (result.status !== "done") return;
  expect(result.report.rejected.map((item) => item.reason)).toEqual([
    "REVIEW_TAKE_UNKNOWN_OR_DUPLICATE",
    "REVIEW_RECOMMENDATION_UNVERIFIED",
    "REVIEW_SHOT_UNKNOWN_OR_DUPLICATE",
  ]);
  expect(result.report.shots[0]!.recommend).toBeNull();
});
it("refuses stale content, changed takes and cross-project results", () => {
  const reply = reviews[0]!.example.output as unknown as Reply;
  for (const mode of ["project", "picture", "take", "scene"]) {
    const film = fixture(reply);
    const input = captureReviewInput(film, [film.shots[0]!.id], "exact request");
    if (mode === "project") film.id = "another";
    if (mode === "picture") film.shots[0]!.picture += "edited";
    if (mode === "scene")
      film.scenes.find((scene) => scene.id === film.shots[0]!.sceneId)!.text += "原文改变";
    if (mode === "take") film.shots[0]!.takes[0]!.videoPath = "/media/replaced.mp4";
    expect(applyTextReview(film, input, reply)).toEqual({
      status: "blocked",
      code: "REVIEW_INPUT_STALE",
    });
    expect(film.reviewReports).toBeUndefined();
  }
});
it("supports existing text-only replies and does not infer a visual pass", () => {
  const film = sampleFilm();
  const input = captureReviewInput(film, [film.shots[0]!.id], "text");
  const result = applyTextReview(film, input, { verdict: "可用", issues: ["文字建议"] });
  expect(result).toMatchObject({
    status: "done",
    report: { visualVerified: false, evidence: "text-only", shots: [] },
  });
  expect(applyTextReview(film, input, {})).toEqual({ status: "blocked", code: "REVIEW_INVALID" });
  expect(applyTextReview(film, input, { verdict: 123, issues: [null], shots: [null] })).toEqual({
    status: "blocked",
    code: "REVIEW_INVALID",
  });
});
