import type { FilmProject, FilmScene, FilmShot } from "./project";
import { onScreenCharacters } from "./on-screen-characters";

export type CostumeRule = {
  id: string;
  name: string;
  title: string;
  description: string;
  ranges: { sceneId: string; from: string; to: string }[];
  artDescription?: string;
  userFields?: string[];
};
export type CostumeRisk = {
  costumeId: string;
  sceneId: string;
  code:
    | "COSTUME_SOURCE_UNVERIFIED"
    | "COSTUME_RANGE_INVALID"
    | "COSTUME_WITHIN_SCENE_CHANGE"
    | "COSTUME_CONFLICT";
};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const paragraph = (value: string) => (/^P\d+$/u.test(value) ? Number(value.slice(1)) : NaN);

/** Preserve original paragraph scopes; scene positions and shot numbers are never substitutes. */
export function parseCostumes(value: unknown): CostumeRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = text(row.costume_id);
    const name = text(row.name);
    const description = text(row.description);
    if (!id || !name || !description) return [];
    const ranges = Array.isArray(row.ranges)
      ? row.ranges.map((entry) => {
          const range =
            entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          return { sceneId: text(range.scene_id), from: text(range.from), to: text(range.to) };
        })
      : [];
    return [{ id, name, title: text(row.title), description, ranges, artDescription: description }];
  });
}

function reliable(scene: FilmScene): boolean {
  const ids = scene.sourceParagraphIds ?? [];
  const original = scene.writerParagraphIds ?? [];
  return Boolean(
    scene.writerSourceText &&
    scene.text === scene.writerSourceText &&
    !scene.userFields.includes("text") &&
    scene.paragraphCoverage?.ok &&
    ids.length &&
    ids.length === original.length &&
    new Set(ids).size === ids.length &&
    ids.every((id, index) => id === original[index] && Number.isFinite(paragraph(id))),
  );
}

export function resolveCostumes(film: FilmProject): {
  accepted: { sceneId: string; rule: CostumeRule }[];
  risks: CostumeRisk[];
} {
  const accepted: { sceneId: string; rule: CostumeRule }[] = [];
  const risks: CostumeRisk[] = [];
  const rules = film.costumes ?? [];
  for (const rule of rules) {
    if (!rule.ranges.length)
      risks.push({ costumeId: rule.id, sceneId: "", code: "COSTUME_RANGE_INVALID" });
    for (const range of rule.ranges) {
      const risk = (code: CostumeRisk["code"]) =>
        risks.push({ costumeId: rule.id, sceneId: range.sceneId, code });
      const from = paragraph(range.from);
      const to = paragraph(range.to);
      if (
        !range.sceneId ||
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < 1 ||
        from > to
      ) {
        risk("COSTUME_RANGE_INVALID");
        continue;
      }
      const scene = film.scenes.find((scene) => scene.id === range.sceneId);
      if (
        !scene ||
        !reliable(scene) ||
        scene.sourceParagraphIds!.some((id) =>
          film.scenes.some(
            (other) => other.id !== scene.id && other.sourceParagraphIds?.includes(id),
          ),
        )
      ) {
        risk("COSTUME_SOURCE_UNVERIFIED");
        continue;
      }
      const ids = scene.sourceParagraphIds!.map(paragraph);
      const inside = ids.filter((id) => id >= from && id <= to);
      if (inside.length !== ids.length) {
        risk(inside.length ? "COSTUME_WITHIN_SCENE_CHANGE" : "COSTUME_RANGE_INVALID");
        continue;
      }
      // Conflicting clothes in any overlapping portion of the scene make whole-scene application unsafe.
      const conflicts = rules.some(
        (other) =>
          other !== rule &&
          other.name === rule.name &&
          other.description !== rule.description &&
          other.ranges.some(
            (scope) =>
              scope.sceneId === scene.id &&
              ids.some((id) => id >= paragraph(scope.from) && id <= paragraph(scope.to)),
          ),
      );
      if (conflicts || rules.filter((other) => other.id === rule.id).length > 1) {
        risk("COSTUME_CONFLICT");
        continue;
      }
      accepted.push({ sceneId: scene.id, rule });
    }
  }
  return { accepted, risks };
}

export function mergeCostumes(film: FilmProject, incoming: CostumeRule[]): FilmProject {
  const ids = new Set(incoming.map((rule) => rule.id));
  const costumes = [
    ...(film.costumes ?? []).filter((rule) => !ids.has(rule.id)),
    ...incoming.map((rule) => {
      const old = film.costumes?.find((item) => item.id === rule.id);
      // A whole rule may be edited: preserve its scope as well as its description.
      if (
        old &&
        (old.userFields?.length ||
          (old.description &&
            (old.artDescription === undefined || old.description !== old.artDescription)))
      )
        return old;
      const ranges = [...(old?.ranges ?? []), ...rule.ranges].filter(
        (range, index, all) =>
          all.findIndex((other) => JSON.stringify(other) === JSON.stringify(range)) === index,
      );
      return { ...rule, ranges };
    }),
  ];
  const next = { ...film, costumes };
  return { ...next, costumeRisks: resolveCostumes(next).risks };
}

export function withShotCostumes(prompt: string, film: FilmProject, shot: FilmShot): string {
  const body = prompt.replace(/(?:^|\n)【本镜服装】\n[\s\S]*?\n【本镜服装结束】(?=\n|$)/gu, "");
  if (
    shot.userFields.some((field) =>
      ["picture", "action", "costume", "costumes", "promptZh", "promptEn"].includes(field),
    )
  )
    return body;
  const visible = new Set(onScreenCharacters(film, shot).map((person) => person.name));
  const rows = resolveCostumes(film)
    .accepted.filter(({ sceneId, rule }) => {
      const people = film.characters.filter((person) => person.name === rule.name);
      return (
        sceneId === shot.sceneId &&
        visible.has(rule.name) &&
        people.length === 1 &&
        !people[0]!.userFields.some((field) => ["identity", "costume", "costumes"].includes(field))
      );
    })
    .map(({ rule }) => `${rule.name}：${rule.description}`);
  return rows.length
    ? `${body}\n【本镜服装】\n${[...new Set(rows)].join("\n")}\n【本镜服装结束】`
    : body;
}
