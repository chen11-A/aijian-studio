/** Shared pure guards: API types still come from the generated OpenAPI schema. */
import { hasValidCreativeLibraryReferences } from "./creative-library-references.js";
import { hasValidCreativeLibraryEnvironment } from "./creative-library-environment.js";
const BASE_KEYS = ["schema_version", "project_id", "episode_id", "characters", "world", "scenes"];
const RELATION_KEYS = [
  "relationship_id",
  "ordinal",
  "from_character_id",
  "to_character_id",
  "label",
  "description",
];
const COSTUME_KEYS = ["costume_id", "ordinal", "character_id", "name", "description"];
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
/** @param {Record<string, unknown>} value @param {readonly string[]} keys */
const exact = (value, keys) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
/** @param {unknown} value @param {number} max @param {boolean} [required] */
const text = (value, max, required = false) =>
  typeof value === "string" &&
  [...value].length <= max &&
  !/\p{Surrogate}/u.test(value) &&
  (!required || value.trim().length > 0);

/** @param {Record<string, unknown>} value */
export function hasCreativeLibraryContentKeys(value) {
  return value.schema_version === "1.0.0"
    ? exact(value, BASE_KEYS)
    : value.schema_version === "1.1.0"
      ? exact(value, [...BASE_KEYS, "relationships", "costumes"])
      : value.schema_version === "1.2.0"
        ? exact(value, [...BASE_KEYS, "relationships", "costumes", "references"])
        : value.schema_version === "1.3.0" &&
          exact(value, [
            ...BASE_KEYS,
            "relationships",
            "costumes",
            "references",
            "scene_variants",
            "environment_references",
          ]);
}

/** @param {Record<string, unknown>} value @param {readonly string[]} characterIds */
export function hasValidCreativeLibraryDetails(value, characterIds) {
  if (value.schema_version === "1.0.0") return true;
  if (
    !["1.1.0", "1.2.0", "1.3.0"].includes(value.schema_version) ||
    !Array.isArray(value.relationships) ||
    !Array.isArray(value.costumes) ||
    value.relationships.length > 2000 ||
    value.costumes.length > 2000
  )
    return false;
  const characters = new Set(characterIds);
  const relations = new Set();
  const costumes = new Set();
  return (
    value.relationships.every((item, i) => {
      if (
        !record(item) ||
        !exact(item, RELATION_KEYS) ||
        typeof item.relationship_id !== "string" ||
        !/^rel_[0-9a-f]{32}$/.test(item.relationship_id) ||
        relations.has(item.relationship_id) ||
        item.ordinal !== i + 1 ||
        typeof item.from_character_id !== "string" ||
        !characters.has(item.from_character_id) ||
        typeof item.to_character_id !== "string" ||
        !characters.has(item.to_character_id) ||
        item.from_character_id === item.to_character_id ||
        !text(item.label, 120, true) ||
        !text(item.description, 20000)
      )
        return false;
      relations.add(item.relationship_id);
      return true;
    }) &&
    value.costumes.every((item, i) => {
      if (
        !record(item) ||
        !exact(item, COSTUME_KEYS) ||
        typeof item.costume_id !== "string" ||
        !/^cst_[0-9a-f]{32}$/.test(item.costume_id) ||
        costumes.has(item.costume_id) ||
        item.ordinal !== i + 1 ||
        typeof item.character_id !== "string" ||
        !characters.has(item.character_id) ||
        !text(item.name, 120, true) ||
        !text(item.description, 20000)
      )
        return false;
      costumes.add(item.costume_id);
      return true;
    }) &&
    (value.schema_version === "1.1.0" || hasValidCreativeLibraryReferences(value, characterIds)) &&
    hasValidCreativeLibraryEnvironment(value)
  );
}
