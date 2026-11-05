import type { DirectorSourceRef } from "./director-plan";
import type { FilmShot } from "./project";

export type DirectorSourceReview = {
  /** This checks model attribution, never proves that invented prose is true. */
  evidence: "declared-paragraph-order";
  status: "ordered" | "needs_review";
  hints: string[];
  issues: ("source-unavailable" | "source-missing" | "source-unknown" | "source-out-of-order")[];
};

/** Parse-time review of explicit paragraph claims. No text is deleted or reordered. */
export function inspectDirectorSources(
  scene: DirectorSourceRef & { id: string },
  shots: readonly Pick<FilmShot, "id" | "sceneId" | "directorPlan">[],
): { shotId: string; review: DirectorSourceReview }[] {
  const ids = scene.sourceParagraphIds ?? [];
  const trusted = Boolean(
    ids.length &&
    new Set(ids).size === ids.length &&
    scene.writerSourceText === scene.text &&
    !scene.userFields?.includes("text"),
  );
  const order = new Map(ids.map((id, index) => [id, index]));
  let furthest = -1;
  return shots
    .filter((shot) => shot.sceneId === scene.id)
    .map((shot) => {
      const hints =
        shot.directorPlan?.segments.flatMap((segment) => segment.sourceParagraphHints) ?? [];
      const issues = new Set<DirectorSourceReview["issues"][number]>();
      if (!trusted) issues.add("source-unavailable");
      if (!hints.length) issues.add("source-missing");
      if (trusted) {
        for (const hint of hints) {
          const at = order.get(hint);
          if (at === undefined) {
            issues.add("source-unknown");
            continue;
          }
          if (at < furthest) issues.add("source-out-of-order");
          furthest = Math.max(furthest, at);
        }
      }
      return {
        shotId: shot.id,
        review: {
          evidence: "declared-paragraph-order",
          status: issues.size ? "needs_review" : "ordered",
          hints: [...hints],
          issues: [...issues],
        },
      };
    });
}
