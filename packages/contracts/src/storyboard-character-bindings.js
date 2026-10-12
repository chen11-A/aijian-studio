/** Closed DRAFT choices. This does not verify files, identity approval or rights. */
const KEYS = [
  "shot_id",
  "ordinal",
  "duration_frames",
  "title",
  "description",
  "action",
  "dialogue",
  "camera",
  "script_scene_id",
  "character_ids",
  "location_id",
];
/** @param {unknown} id */
const referenceId = (id) => typeof id === "string" && /^crf_[0-9a-f]{32}$/.test(id);
/** @param {Record<string, unknown>} shot @param {unknown} schema */
export function hasStoryboardShotKeys(shot, schema) {
  const keys =
    schema === "1.0.0"
      ? KEYS
      : schema === "1.1.0" || schema === "1.2.0"
        ? [...KEYS, "character_bindings"]
        : schema === "1.3.0" || schema === "1.4.0" || schema === "1.5.0"
          ? [
              ...KEYS,
              "character_bindings",
              "coverage_notes",
              "continuity_notes",
              "transition_notes",
              ...(schema === "1.4.0" || schema === "1.5.0" ? ["environment_binding"] : []),
            ]
          : [];
  return (
    keys.length > 0 &&
    Object.keys(shot).length === keys.length &&
    keys.every((key) => Object.hasOwn(shot, key))
  );
}
/** @param {Record<string, unknown>} shot @param {unknown} schema */
export function hasValidStoryboardBindings(shot, schema) {
  if (schema === "1.0.0") return true;
  if (
    (schema !== "1.1.0" &&
      schema !== "1.2.0" &&
      schema !== "1.3.0" &&
      schema !== "1.4.0" &&
      schema !== "1.5.0") ||
    !Array.isArray(shot.character_ids) ||
    !Array.isArray(shot.character_bindings) ||
    shot.character_bindings.length > 500
  )
    return false;
  const seen = new Set();
  const characters = shot.character_ids;
  return shot.character_bindings.every((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).length !== 3 ||
      !["character_id", "costume_id", "reference_ids"].every((key) => Object.hasOwn(item, key)) ||
      typeof item.character_id !== "string" ||
      !/^chr_[0-9a-f]{32}$/.test(item.character_id) ||
      seen.has(item.character_id) ||
      !characters.includes(item.character_id) ||
      !(
        item.costume_id === null ||
        (typeof item.costume_id === "string" && /^cst_[0-9a-f]{32}$/.test(item.costume_id))
      ) ||
      !Array.isArray(item.reference_ids) ||
      item.reference_ids.length > 2000 ||
      new Set(item.reference_ids).size !== item.reference_ids.length ||
      !item.reference_ids.every(referenceId)
    )
      return false;
    seen.add(item.character_id);
    return true;
  });
}

/** @param {Record<string,unknown>} content */
export function hasStoryboardContentKeys(content) {
  const base = [
    "schema_version",
    "project_id",
    "episode_id",
    "fps",
    "script_version_id",
    "creative_library_version_id",
    "shots",
  ];
  const keys =
    content.schema_version === "1.2.0" ||
    content.schema_version === "1.3.0" ||
    content.schema_version === "1.4.0" ||
    content.schema_version === "1.5.0"
      ? [...base, "visual_bible_pin"]
      : base;
  return (
    ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"].includes(
      String(content.schema_version),
    ) &&
    Object.keys(content).length === keys.length &&
    keys.every((k) => Object.hasOwn(content, k))
  );
}
/** @param {Record<string,unknown>} content */
export function hasValidStoryboardVisualPin(content) {
  if (
    content.schema_version !== "1.2.0" &&
    content.schema_version !== "1.3.0" &&
    content.schema_version !== "1.4.0" &&
    content.schema_version !== "1.5.0"
  )
    return true;
  const pin = content.visual_bible_pin;
  if (pin === null) return true;
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) return false;
  const v = /** @type {Record<string,unknown>} */ (pin);
  return (
    Object.keys(v).length === 2 &&
    typeof v.version_id === "string" &&
    /^ver_[0-9a-f]{32}$/.test(v.version_id) &&
    typeof v.content_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(v.content_hash) &&
    typeof content.creative_library_version_id === "string" &&
    /^ver_[0-9a-f]{32}$/.test(content.creative_library_version_id)
  );
}

/** @param {Record<string, unknown>} shot @param {unknown} schema */
export function hasValidStoryboardPlanning(shot, schema) {
  if (schema !== "1.3.0" && schema !== "1.4.0" && schema !== "1.5.0") return true;
  return ["coverage_notes", "continuity_notes", "transition_notes"].every((key) => {
    const value = shot[key];
    return (
      typeof value === "string" &&
      [...value].length <= 20000 &&
      new globalThis.TextDecoder().decode(new globalThis.TextEncoder().encode(value)) === value
    );
  });
}

/** @param {Record<string,unknown>} shot @param {unknown} schema */
export function hasValidStoryboardEnvironment(shot, schema) {
  if (schema !== "1.4.0" && schema !== "1.5.0") return true;
  const binding = shot.environment_binding;
  return (
    !!binding &&
    typeof binding === "object" &&
    !Array.isArray(binding) &&
    Object.keys(binding).length === 2 &&
    ["variant_id", "reference_ids"].every((k) => Object.hasOwn(binding, k)) &&
    (binding.variant_id === null ||
      (typeof binding.variant_id === "string" &&
        /^scv_[0-9a-f]{32}$/.test(binding.variant_id) &&
        shot.location_id !== null)) &&
    Array.isArray(binding.reference_ids) &&
    binding.reference_ids.length <= 2000 &&
    new Set(binding.reference_ids).size === binding.reference_ids.length &&
    binding.reference_ids.every((id) => typeof id === "string" && /^erf_[0-9a-f]{32}$/.test(id))
  );
}
/** Existing G5 does not sign independent world/state reference choices.
 * @param {Record<string,unknown>} content */
export function hasValidStoryboardEnvironmentBasis(content) {
  if (content.schema_version !== "1.4.0" && content.schema_version !== "1.5.0") return true;
  if (!Array.isArray(content.shots)) return false;
  let chosen = false;
  for (const shot of content.shots) {
    if (
      !shot ||
      typeof shot !== "object" ||
      Array.isArray(shot) ||
      !hasValidStoryboardEnvironment(shot, content.schema_version)
    )
      return false;
    const binding = shot.environment_binding;
    chosen ||= binding.variant_id !== null || binding.reference_ids.length > 0;
  }
  return (
    !chosen ||
    (typeof content.creative_library_version_id === "string" &&
      /^ver_[0-9a-f]{32}$/.test(content.creative_library_version_id) &&
      (content.schema_version === "1.5.0" || content.visual_bible_pin === null))
  );
}
