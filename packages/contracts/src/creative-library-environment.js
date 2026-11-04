/** Closed environment guards; originals are checked by the existing backend store. */
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {Record<string, unknown>} v @param {readonly string[]} keys */
const exact = (v, keys) =>
  Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
/** @param {unknown} v @param {number} max @param {boolean} [required] */
const text = (v, max, required = false) =>
  typeof v === "string" &&
  [...v].length <= max &&
  !/\p{Surrogate}/u.test(v) &&
  (!required || !!v.trim());
/** @param {unknown} v @param {string} prefix */
const id = (v, prefix) => typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(v);
const VARIANT_KEYS = [
  "variant_id",
  "ordinal",
  "scene_id",
  "name",
  "view",
  "time_of_day",
  "weather",
  "state",
  "continuity",
];
const REFERENCE_KEYS = [
  "reference_id",
  "ordinal",
  "scene_id",
  "variant_id",
  "asset_id",
  "asset_version_id",
  "asset_sha256",
  "label",
];

/** @param {Record<string, unknown>} value */
export function hasValidCreativeLibraryEnvironment(value) {
  if (value.schema_version !== "1.3.0") return true;
  if (
    !Array.isArray(value.scene_variants) ||
    value.scene_variants.length > 2000 ||
    !Array.isArray(value.environment_references) ||
    value.environment_references.length > 2000 ||
    !Array.isArray(value.scenes)
  )
    return false;
  if (!value.scenes.every((item) => record(item) && id(item.scene_id, "loc"))) return false;
  const scenes = new Set(value.scenes.map((item) => item.scene_id));
  const variants = new Map();
  if (
    !value.scene_variants.every((item, i) => {
      if (
        !record(item) ||
        !exact(item, VARIANT_KEYS) ||
        !id(item.variant_id, "scv") ||
        variants.has(item.variant_id) ||
        item.ordinal !== i + 1 ||
        !scenes.has(item.scene_id) ||
        !text(item.name, 120, true) ||
        ![item.view, item.time_of_day, item.weather].every((v) => text(v, 240)) ||
        ![item.state, item.continuity].every((v) => text(v, 20000))
      )
        return false;
      variants.set(item.variant_id, item.scene_id);
      return true;
    })
  )
    return false;
  const references = new Set();
  return value.environment_references.every((item, i) => {
    if (
      !record(item) ||
      !exact(item, REFERENCE_KEYS) ||
      !id(item.reference_id, "erf") ||
      references.has(item.reference_id) ||
      item.ordinal !== i + 1 ||
      !(item.scene_id === null
        ? item.variant_id === null
        : scenes.has(item.scene_id) &&
          (item.variant_id === null || variants.get(item.variant_id) === item.scene_id)) ||
      !id(item.asset_id, "asset") ||
      !id(item.asset_version_id, "asv") ||
      typeof item.asset_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.asset_sha256) ||
      !text(item.label, 120, true)
    )
      return false;
    references.add(item.reference_id);
    return true;
  });
}
