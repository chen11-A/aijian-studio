import type { FilmProject } from "./project";

export type ReviewInput = { projectId: string; shotIds: string[]; snapshot: string; text: string };
export type ReviewRecord = Record<string, unknown>;
export type TextReviewReport = {
  input: ReviewInput;
  evidence: "text-only";
  visualVerified: false;
  verdict: string;
  issues: unknown[];
  shots: ReviewRecord[];
  rejected: { reason: string; value: ReviewRecord }[];
};
const object = (value: unknown): ReviewRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ReviewRecord) : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
function snapshot(film: FilmProject, ids: string[]): string {
  return JSON.stringify({
    style: film.styleZh,
    characters: film.characters,
    scenes: film.scenes
      .filter((scene) =>
        film.shots.some((shot) => ids.includes(shot.id) && shot.sceneId === scene.id),
      )
      .map((scene) => ({ id: scene.id, text: scene.text })),
    shots: ids.map((id) => film.shots.find((shot) => shot.id === id) ?? null),
  });
}
export function captureReviewInput(
  film: FilmProject,
  shotIds: string[],
  text: string,
): ReviewInput {
  return {
    projectId: film.id,
    shotIds: [...new Set(shotIds)],
    snapshot: snapshot(film, [...new Set(shotIds)]),
    text,
  };
}

/** Model observations are preserved as claims, never promoted to visual evidence. */
export function applyTextReview(
  film: FilmProject,
  input: ReviewInput,
  value: unknown,
):
  | { status: "done"; film: FilmProject; report: TextReviewReport }
  | { status: "blocked"; code: string } {
  if (film.id !== input.projectId || snapshot(film, input.shotIds) !== input.snapshot)
    return { status: "blocked", code: "REVIEW_INPUT_STALE" };
  const row = object(value);
  if (
    !row ||
    (!(typeof row.verdict === "string" && row.verdict.trim()) &&
      !list(row.issues).some((item) => typeof item === "string" && item.trim()) &&
      !list(row.shots).some((item) => object(item)))
  )
    return { status: "blocked", code: "REVIEW_INVALID" };
  const report: TextReviewReport = {
    input: structuredClone(input),
    evidence: "text-only",
    visualVerified: false,
    verdict: typeof row.verdict === "string" ? row.verdict : "",
    issues: structuredClone(list(row.issues)),
    shots: [],
    rejected: [],
  };
  const seen = new Set<string>();
  for (const raw of list(row.shots)) {
    const entry = object(raw);
    if (!entry) continue;
    const id = typeof entry.shot_id === "string" ? entry.shot_id : "";
    const shot = film.shots.find((shot) => shot.id === id);
    const reject = (reason: string, value: ReviewRecord) =>
      report.rejected.push({ reason, value: structuredClone(value) });
    if (!shot || !input.shotIds.includes(id) || seen.has(id)) {
      reject("REVIEW_SHOT_UNKNOWN_OR_DUPLICATE", entry);
      continue;
    }
    seen.add(id);
    const takes: ReviewRecord[] = [];
    const takeIds = new Set<string>();
    for (const rawTake of list(entry.takes)) {
      const take = object(rawTake);
      if (!take) continue;
      const takeId = typeof take.take_id === "string" ? take.take_id : "";
      if (
        !shot.takes.some((item) => item.id === takeId && item.shotId === id) ||
        takeIds.has(takeId)
      ) {
        reject("REVIEW_TAKE_UNKNOWN_OR_DUPLICATE", take);
        continue;
      }
      takeIds.add(takeId);
      takes.push(structuredClone(take));
    }
    const recommendation = object(entry.recommend);
    const recommendValid =
      recommendation &&
      typeof recommendation.take_id === "string" &&
      takeIds.has(recommendation.take_id);
    if (recommendation && !recommendValid)
      reject("REVIEW_RECOMMENDATION_UNVERIFIED", recommendation);
    report.shots.push({
      ...structuredClone(entry),
      takes,
      recommend: recommendValid ? structuredClone(recommendation) : null,
    });
  }
  return {
    status: "done",
    report,
    film: { ...film, reviewReports: [...(film.reviewReports ?? []), report] },
  };
}
