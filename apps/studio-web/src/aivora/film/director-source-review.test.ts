import { describe, expect, it } from "vitest";
import { inspectDirectorSources } from "./director-source-review";
import { blankFilm, offlineShots } from "./project";
import { parseDirectorPlan } from "./director-plan";

const scene = {
  id: "scene-1",
  text: "车先到。随后打斗。最后逃走。",
  writerSourceText: "车先到。随后打斗。最后逃走。",
  sourceParagraphIds: ["P101", "P102", "P103"],
};
function shot(id: string, source?: string | string[]) {
  const base = { ...offlineShots("动作。", scene.id)[0]!, id };
  return { ...base, directorPlan: parseDirectorPlan({ source }, base, scene) };
}

describe("3JR-B10 explicit director source attribution", () => {
  it("flags a prior arrival inserted after the fight without deleting either shot", () => {
    const shots = [shot("fight", "P102"), shot("arrival", "P101"), shot("escape", "P103")];
    const before = structuredClone(shots);
    const result = inspectDirectorSources(scene, shots);
    expect(result[1]).toMatchObject({
      shotId: "arrival",
      review: { status: "needs_review", issues: ["source-out-of-order"] },
    });
    expect(result[2]!.review.status).toBe("ordered");
    expect(shots).toEqual(before);
  });

  it("accepts repeated beats from the same paragraph and ordered merged segments", () => {
    const result = inspectDirectorSources(scene, [
      shot("a", "P101"),
      shot("b", "P101"),
      shot("c", ["P102", "P103"]),
    ]);
    expect(result.every((entry) => entry.review.status === "ordered")).toBe(true);
    expect(result.every((entry) => entry.review.evidence === "declared-paragraph-order")).toBe(
      true,
    );
  });

  it("does not guess missing or unknown source IDs from shot positions", () => {
    const result = inspectDirectorSources(scene, [shot("a"), shot("b", "P999")]);
    expect(result[0]!.review.issues).toContain("source-missing");
    expect(result[1]!.review.issues).toContain("source-unknown");
    expect(result.every((entry) => entry.review.status === "needs_review")).toBe(true);
  });

  it("refuses stale source ownership and ignores other scenes", () => {
    const changed = { ...scene, text: "后来改稿" };
    expect(inspectDirectorSources(changed, [shot("a", "P101")])[0]!.review.issues).toContain(
      "source-unavailable",
    );
    const other = { ...shot("other", "P103"), sceneId: blankFilm().id };
    expect(inspectDirectorSources(scene, [other, shot("a", "P101")])).toHaveLength(1);
  });
});
