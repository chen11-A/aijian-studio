/** Pure exact-reference guards; no file, provider or approval operation. */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const KEYS = [
  "reference_id",
  "ordinal",
  "character_id",
  "costume_id",
  "asset_id",
  "asset_version_id",
  "asset_sha256",
  "label",
];
/** @param {Record<string, unknown>} value @param {readonly string[]} characterIds */
export function hasValidCreativeLibraryReferences(value, characterIds) {
  if (
    !Array.isArray(value.references) ||
    value.references.length > 2000 ||
    !Array.isArray(value.costumes)
  )
    return false;
  const characters = new Set(characterIds);
  const costumes = new Map();
  for (const item of value.costumes) {
    if (
      !record(item) ||
      typeof item.costume_id !== "string" ||
      typeof item.character_id !== "string"
    )
      return false;
    costumes.set(item.costume_id, item.character_id);
  }
  const seen = new Set();
  return value.references.every((item, i) => {
    if (
      !record(item) ||
      Object.keys(item).length !== KEYS.length ||
      !KEYS.every((key) => Object.hasOwn(item, key)) ||
      typeof item.reference_id !== "string" ||
      !/^crf_[0-9a-f]{32}$/.test(item.reference_id) ||
      seen.has(item.reference_id) ||
      item.ordinal !== i + 1 ||
      typeof item.character_id !== "string" ||
      !characters.has(item.character_id) ||
      !(
        item.costume_id === null ||
        (typeof item.costume_id === "string" && costumes.get(item.costume_id) === item.character_id)
      ) ||
      typeof item.asset_id !== "string" ||
      !/^asset_[0-9a-f]{32}$/.test(item.asset_id) ||
      typeof item.asset_version_id !== "string" ||
      !/^asv_[0-9a-f]{32}$/.test(item.asset_version_id) ||
      typeof item.asset_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.asset_sha256) ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      [...item.label].length > 120 ||
      /\p{Surrogate}/u.test(item.label)
    )
      return false;
    seen.add(item.reference_id);
    return true;
  });
}
