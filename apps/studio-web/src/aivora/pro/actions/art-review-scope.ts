import type { FilmProject } from "../../film/project";
import type { ArtTransaction } from "./art-transaction";
/** Review consistency only. This snapshot never authorizes paths, files, paid work or facts. */
export function artReviewInput(film: FilmProject, tx: ArtTransaction): string {
  if (film.id !== tx.selection.projectId) throw Error("ART_REVIEW_PROJECT_CHANGED");
  const style = tx.changes.some(
    (row) => row.target.collection === "project" && row.field === "styleZh",
  );
  const targets = tx.changes.flatMap((row) => {
    const target = row.target;
    if (target.collection === "project") return [];
    if (!["characters", "locations", "props"].includes(target.collection))
      throw Error("ART_REVIEW_UNSUPPORTED");
    const matches = film[target.collection].filter((item) => item.id === target.id);
    if (matches.length !== 1) throw Error("ART_REVIEW_TARGET_CHANGED");
    return [
      {
        collection: target.collection,
        id: target.id,
        name: "name" in matches[0]! ? matches[0]!.name : "",
      },
    ];
  });
  const costumeNames = new Set((film.costumes ?? []).map((rule) => rule.name));
  for (const change of tx.changes)
    if (
      change.target.collection === "project" &&
      change.field === "costumes" &&
      Array.isArray(change.after.value)
    )
      for (const rule of change.after.value)
        if (rule && typeof rule === "object" && "name" in rule && typeof rule.name === "string")
          costumeNames.add(rule.name);
  return JSON.stringify({
    schemaVersion: 1,
    projectId: film.id,
    scope: { ...tx.selection },
    targets,
    // setFilmStyle marks every current shot. Reference paths/bytes are not read here;
    // only reference presence and its creative style state determine derived invalidation.
    style: style
      ? {
          revision: film.styleRevision ?? 0,
          shots: film.shots.map((shot) => shot.id),
          references: film.locations
            .filter((place) => Boolean(place.referenceImage))
            .map((place) => ({
              id: place.id,
              referenceStyleRevision: place.referenceStyleRevision,
            })),
        }
      : null,
    // The original resolver consumes scene source/range evidence, not media or save metadata.
    costumes: tx.recomputeCostumes
      ? {
          rules: (film.costumes ?? []).map(({ id, name, description, ranges }) => ({
            id,
            name,
            description,
            ranges,
          })),
          scenes: film.scenes.map((scene) => ({
            id: scene.id,
            text: scene.text,
            writerSourceText: scene.writerSourceText,
            sourceParagraphIds: scene.sourceParagraphIds,
            writerParagraphIds: scene.writerParagraphIds,
            covered: scene.paragraphCoverage?.ok,
            textProtected: scene.userFields.includes("text"),
          })),
          people: film.characters
            .filter((person) => costumeNames.has(person.name))
            .map((person) => ({
              id: person.id,
              name: person.name,
              protected: person.userFields.filter((field) =>
                ["identity", "costume", "costumes"].includes(field),
              ),
            })),
        }
      : null,
    // New location references are displayed using the request's actual scene labels.
    references: tx.additions.flatMap((addition) =>
      addition.collection === "locations"
        ? (addition.referencingSceneIds ?? []).map((id) => {
            const rows = film.scenes.filter((scene) => scene.id === id);
            if (rows.length !== 1) throw Error("ART_REVIEW_REFERENCE_CHANGED");
            return { id, no: rows[0]!.no, title: rows[0]!.title, where: rows[0]!.where };
          })
        : [],
    ),
  });
}
export function artReviewCurrent(film: FilmProject, tx: ArtTransaction, expected: string): boolean {
  try {
    return artReviewInput(film, tx) === expected;
  } catch {
    return false;
  }
}
