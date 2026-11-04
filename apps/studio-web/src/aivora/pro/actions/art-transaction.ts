import type { FilmProject, FilmLocation, FilmProp } from "../../film/project";
import { resolveCostumes } from "../../film/costume-rules";
import { setFilmStyle } from "../../film/style-bible";
import type { EditorSelection } from "./editor-context";
import type { EditorFieldChange } from "./editor-changes";

type ArtCollection = "characters" | "locations" | "props";
export type ArtTransaction = {
  selection: EditorSelection;
  changes: EditorFieldChange[];
  additions: (
    { collection: "locations"; row: FilmLocation } | { collection: "props"; row: FilmProp }
  )[];
  unsupported: string[];
  recomputeCostumes: boolean;
};
const fields = {
  project: ["styleZh", "costumes"],
  characters: ["identity", "gender", "ageBand", "voiceId", "voiceCode"],
  locations: [
    "name",
    "prompt",
    "ambience",
    "layout",
    "artFields",
    "userFields",
    "referenceStyleRevision",
  ],
  props: ["name", "note", "artFields", "userFields"],
} satisfies { project: (keyof FilmProject)[] } & {
  [K in ArtCollection]: (keyof FilmProject[K][number])[];
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown) => value as Record<string, unknown>;
const get = (row: Record<string, unknown>, key: string) => ({
  present: Object.hasOwn(row, key),
  value: structuredClone(row[key]),
});

/** Fixed request-time baseline. Only explicitly known art metadata may differ. */
export function prepareArtTransaction(
  base: FilmProject,
  proposed: FilmProject,
  selection: EditorSelection,
): ArtTransaction {
  const tx: ArtTransaction = {
    selection: structuredClone(selection),
    changes: [],
    additions: [],
    unsupported: [],
    recomputeCostumes:
      !same(base.costumes, proposed.costumes) || !same(base.costumeRisks, proposed.costumeRisks),
  };
  if (base.id !== proposed.id || base.id !== selection.projectId) {
    tx.unsupported.push("PROJECT_MISMATCH");
    return tx;
  }
  function compare(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    target: EditorFieldChange["target"],
    allowed: readonly string[],
    derived: readonly string[] = [],
  ) {
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const left = get(before, field),
        right = get(after, field);
      if (same(left, right) || derived.includes(field)) continue;
      if (!allowed.includes(field)) {
        tx.unsupported.push(`UNSUPPORTED:${target.collection}:${field}`);
        continue;
      }
      tx.changes.push({ target, field, before: left, after: right });
    }
  }
  for (const collection of ["characters", "locations", "props"] as const) {
    const original = base[collection],
      next = proposed[collection];
    const existing = new Set(original.map((row) => row.id));
    if (
      existing.size !== original.length ||
      new Set(next.map((row) => row.id)).size !== next.length ||
      !same(
        original.map((row) => row.id),
        next.filter((row) => existing.has(row.id)).map((row) => row.id),
      )
    ) {
      tx.unsupported.push(`${collection}:STRUCTURE_CHANGED`);
      continue;
    }
    for (const old of original) {
      const row = next.find((row) => row.id === old.id);
      if (!row) {
        tx.unsupported.push(`${collection}:REMOVED`);
        continue;
      }
      compare(record(old), record(row), { collection, id: old.id }, fields[collection]);
    }
    for (const row of next.filter((row) => !existing.has(row.id))) {
      if (collection === "characters") tx.unsupported.push("characters:ADDED");
      else if (collection === "locations")
        tx.additions.push({ collection, row: structuredClone(row as FilmLocation) });
      else tx.additions.push({ collection, row: structuredClone(row as FilmProp) });
    }
  }
  const styled = setFilmStyle(base, proposed.styleZh);
  if (
    !same(styled.styleRevision, proposed.styleRevision) ||
    !same(
      styled.shots.map((row) => row.regenerationRequired),
      proposed.shots.map((row) => row.regenerationRequired),
    )
  )
    tx.unsupported.push("INVALID_STYLE_DERIVATION");
  if (
    !same(base.costumeRisks, proposed.costumeRisks) &&
    !same(resolveCostumes(proposed).risks, proposed.costumeRisks)
  )
    tx.unsupported.push("INVALID_COSTUME_DERIVATION");
  for (const collection of ["locations", "props"] as const) {
    const added = tx.additions.filter((item) => item.collection === collection);
    if (new Set(added.map((item) => item.row.name)).size !== added.length)
      tx.unsupported.push("DUPLICATE_ADDED_NAME");
  }
  const left = { ...base },
    right = { ...proposed };
  // These are derived by setFilmStyle/resolveCostumes from the latest live film on apply/undo.
  for (const key of [
    "characters",
    "locations",
    "props",
    "shots",
    "styleRevision",
    "costumeRisks",
  ] as const) {
    delete record(left)[key];
    delete record(right)[key];
  }
  compare(record(left), record(right), { collection: "project" }, fields.project);
  if (
    !same(
      base.shots.map(({ regenerationRequired: _derived, ...shot }) => shot),
      proposed.shots.map(({ regenerationRequired: _derived, ...shot }) => shot),
    )
  )
    tx.unsupported.push("SHOTS_CHANGED");
  return tx;
}

export function applyArtTransaction(film: FilmProject, tx: ArtTransaction) {
  return change(film, tx, false);
}
export function undoArtTransaction(film: FilmProject, tx: ArtTransaction) {
  return change(film, tx, true);
}
function change(current: FilmProject, tx: ArtTransaction, inverse: boolean) {
  const reject = (...conflicts: string[]) => ({ film: current, receipt: null, conflicts });
  if (current.id !== tx.selection.projectId) return reject("PROJECT_MISMATCH");
  if (tx.unsupported.length) return reject(...tx.unsupported);
  const find = (film: FilmProject, target: EditorFieldChange["target"]) =>
    target.collection === "project"
      ? record(film)
      : record(film[target.collection].find((row) => row.id === target.id));
  for (const item of tx.changes) {
    const row = find(current, item.target);
    if (!row || !same(get(row, item.field), inverse ? item.after : item.before))
      return reject(`FIELD_CHANGED:${item.target.collection}:${item.field}`);
    const locks = Array.isArray(row.userFields) ? row.userFields : [];
    if (locks.includes(item.field)) return reject(`FIELD_LOCKED:${item.field}`);
    if (item.field === "userFields") {
      // Art may add inferred locks, but cannot remove a user's existing lock.
      const oldLocks = Array.isArray(item.before.value) ? item.before.value : [];
      const newLocks = Array.isArray(item.after.value) ? item.after.value : [];
      if (oldLocks.some((lock) => !newLocks.includes(lock))) return reject("LOCK_METADATA_CHANGED");
    }
  }
  const costumeChange = tx.changes.find(
    (item) => item.target.collection === "project" && item.field === "costumes",
  );
  if (costumeChange) {
    const rules = costumeChange.after.value as FilmProject["costumes"];
    const previous = costumeChange.before.value as FilmProject["costumes"];
    const changed = (rules ?? []).filter(
      (rule) =>
        !same(
          rule,
          previous?.find((old) => old.id === rule.id),
        ),
    );
    if (
      changed.some((rule) =>
        current.characters.some(
          (person) =>
            person.name === rule.name &&
            person.userFields.some((field) => ["identity", "costume", "costumes"].includes(field)),
        ),
      )
    )
      return reject("FIELD_LOCKED:costumes");
  }
  for (const addition of tx.additions) {
    const matches = current[addition.collection].filter(
      (row) => row.id === addition.row.id || row.name === addition.row.name,
    );
    if (inverse ? matches.length !== 1 || !same(matches[0], addition.row) : matches.length > 0)
      return reject("ADDED_ENTITY_CHANGED");
  }
  let film = structuredClone(current);
  for (const item of tx.changes) {
    const row = find(film, item.target),
      value = inverse ? item.before : item.after;
    if (item.target.collection === "project" && item.field === "styleZh") continue;
    if (value.present) row[item.field] = structuredClone(value.value);
    else delete row[item.field];
  }
  for (const addition of tx.additions) {
    if (addition.collection === "locations")
      film.locations = inverse
        ? film.locations.filter((row) => row.id !== addition.row.id)
        : [...film.locations, structuredClone(addition.row)];
    else
      film.props = inverse
        ? film.props.filter((row) => row.id !== addition.row.id)
        : [...film.props, structuredClone(addition.row)];
  }
  const style = tx.changes.find(
    (item) => item.target.collection === "project" && item.field === "styleZh",
  );
  if (style) {
    film = setFilmStyle(film, String((inverse ? style.before : style.after).value ?? ""));
    film.locations = film.locations.map((row) =>
      row.referenceImage ? { ...row, referenceStyleRevision: -1 } : row,
    );
  }
  if (tx.recomputeCostumes) film.costumeRisks = resolveCostumes(film).risks;
  return { film, receipt: tx, conflicts: [] as string[] };
}
